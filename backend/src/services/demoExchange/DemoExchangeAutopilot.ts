/**
 * DemoExchangeAutopilot — the "exchange backend" of the Demo Exchange: a loop
 * that watches the omnibus, credits deposits by tag, and fulfils client
 * requests by signing with THE SIMULATED EXCHANGE KEY (`DemoExchangeSigner`):
 *
 *   put-to-work  →  0xFE from the omnibus to the Core Vault carrying
 *                   [approve, pote.deposit(supplyUBA, receiver = client account)]
 *                   → the executor mints FXRP and deposits; shares to the client
 *   withdraw     →  Payment omnibus → the client's registered own XRPL wallet
 *
 * With this loop the custodial flow needs two human actions in total: the
 * client deposits (their wallet, their signature) and taps "put to work" —
 * or none after the deposit when they set auto-invest. Everything else is
 * what a real exchange backend does with its hot key.
 *
 * Discipline (BuildSpec §, founder 2026-08-26):
 *   · the key refuses (see the signer's policy) — every refusal is a receipt;
 *   · a signed 0xFE is NEVER re-sent (DirectMintingDelayed / slow executor =
 *     wait): the request goes 'signed' with its hash and only flips to 'done'
 *     when the MasterAccountController reports the XRPL tx consumed;
 *   · a NonceSeatTaken from the handoff builder means "an earlier 0xFE of this
 *     omnibus is still in flight" → the request stays pending, with the reason;
 *   · heartbeat for the Sentinel on every tick.
 */

import { ethers } from 'ethers';
import { markAgentTick } from '../ops/agentHeartbeats';
import type { AlertLevel, AlertOptions } from '../OpsAlertService';
import { listRuns, loadRun, requestsOf, saveRun, applyMovements, newId, withRunLock, type ClientRequest, type DemoRun } from './DemoExchangeStore';
import { reservedDrops, sweepDeskPayments, type Against, type LedgerView } from './availableBalance';
import { againstFor } from './submissionJournal';
import { syncOmnibus, makeReceipt } from './DemoExchangeSync';
import { assessPayment, readOmnibusAppointment, readSignerConfig, recordSpend, releaseSpend, reserveSpend, signAndSubmit, spentToday, sweepStaleReservations } from './DemoExchangeSigner';
import { flareProvider } from './DemoRunVerifier';

const SOURCE = 'demo-exchange-autopilot';
/**
 * Ledgers the autopilot's own 0xFE stays signable (it. 14, R1 1.1). The builder
 * stamps it on the Payment AND on the nonce-seat record, so the seat lives exactly
 * as long as the payment can land: the loop signs and submits within seconds, and
 * a submission that never enters a ledger is provably dead ~80 s later, instead of
 * holding (or losing) a seat by a clock nobody can check.
 */
const AUTOPILOT_FE_LEDGER_WINDOW = 20;
const AGENT_TITLE = 'Demo Exchange · autopilot (simulated exchange backend)';
const REGISTRY_ABI = ['function approved(address) view returns (bool)'];
const POTE_GATE_ABI = ['function userGate() view returns (address)'];
const MAC_ABI = ['function isTransactionIdUsed(bytes32) view returns (bool)'];

export interface AutopilotStatus {
  enabled: boolean;
  running: boolean;
  signerAddress: string | null;
  seedPresent: boolean;
  signerError?: string;
  attribution: 'user' | 'operational';
  maxTxXrp: number;
  dailyCapXrp: number;
  /** null = the spend ledger could not be read (never «nothing spent»). */
  spentTodayXrp: number | null;
  intervalMs: number;
  lastTickAt: string | null;
  lastError: string | null;
  fulfilled: Array<{ at: string; runId: string; kind: string; clientId: string; drops: string; txHash: string }>;
}

function intervalMs(): number {
  return Math.max(Number(process.env.DEMO_EXCHANGE_AUTOPILOT_INTERVAL_MS || 20_000), 10_000);
}

/**
 * it. 27 — UNA PETICIÓN PUEDE ENVEJECER PARA SIEMPRE Y EL AGENTE SEGUÍA VERDE.
 *
 * `refuse(final=false)` deja la petición `pending` con su motivo y no avisa a
 * nadie: ni al canal de ops, ni al latido (que se declara `ok` mientras el tick
 * no lance). Sí toca un reloj —pone `updatedAt` a «ahora» en cada rechazo—, y
 * por eso la edad se mide desde `createdAt` (it. 29, `noteStaleRequests`). Un
 * cliente cuya entrada murió en `NO_CLIENT_ACCOUNT`,
 * o cuya salida no se pudo firmar, podía quedarse ahí días sin que nadie se
 * enterara: el bucle «funcionaba» perfectamente, sirviendo a nadie.
 *
 * Un pago de este bucle se resuelve en segundos. Media hora es una eternidad a
 * esa escala: lo que lleva tanto esperando necesita ojos humanos.
 */
function staleRequestMs(): number {
  const min = Number(process.env.DEMO_EXCHANGE_STALE_REQUEST_MIN ?? 30);
  return (Number.isFinite(min) && min > 0 ? min : 30) * 60_000;
}

/**
 * Today's spend of the exchange key, and whether we could read it at all
 * (it. 23, 1.7). `unreadable` carries the reason so the refusal — or the receipt
 * of a payout that went anyway — can name it. Never «0 spent today».
 *
 * it. 25 (B.3) — Y AHORA TAMPOCO UN CERO DE MENTIRA HACIA DENTRO. Devolvía
 * `0n` al fallar la lectura, y ese cero viajaba hasta la política como si fuera
 * un hecho: durante una caída de base de datos el tope quedaba SUSPENDIDO
 * entero, sin ninguna cota — ni de importe ni de número de pagos — y sin que
 * nadie lo notara. `null` es lo único que sabemos: nada. Quien firma operativa
 * PROPIA se para en seco; la salida de un cliente ni consulta este número.
 */
async function readSpendBudget(now = new Date()): Promise<{ spentDrops: bigint | null; unreadable: string | null }> {
  try {
    return { spentDrops: await spentToday(now), unreadable: null };
  } catch (e) {
    return { spentDrops: null, unreadable: (e as Error).message.slice(0, 120) || 'unknown error' };
  }
}

/**
 * it. 31 — ¿queda algo VIVO en esta toma que el ledger o la llave deban
 * resolver? Es lo único que justifica leer el ledger por una toma cerrada:
 * peticiones pendientes o firmadas sin final, y reservas de mesa abiertas.
 */
export function hasLiveWork(run: Pick<DemoRun, 'requests' | 'deskPayments'>): boolean {
  if ((run.requests ?? []).some((r) => r.status === 'pending' || r.status === 'submitting' || r.status === 'signed')) return true;
  return (run.deskPayments ?? []).some((p) => p.status === 'prepared' || p.status === 'signed');
}

/**
 * it. 33 — is there a desk reservation the ledger can close on its own? Only a
 * `prepared` row with a LastLedgerSequence: a payout the desk composed, or a
 * put-to-work the server composed (memo + LLS). Anything else has its own door.
 */
export function deskSweepDue(run: Pick<DemoRun, 'deskPayments'>): boolean {
  return (run.deskPayments ?? []).some((p) => p.status === 'prepared' && typeof p.lastLedgerSequence === 'number');
}

export class DemoExchangeAutopilot {
  private timer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  private ticking = false;
  private lastTickAt: string | null = null;
  private lastError: string | null = null;
  private fulfilled: AutopilotStatus['fulfilled'] = [];
  /** Peticiones que llevan demasiado esperando, recogidas en el tick en curso (it. 27). */
  private staleThisTick: string[] = [];

  start(): void {
    if (this.timer) return;
    // El interruptor del MÓDULO tiene que apagar también al firmante. Sin esto,
    // `INSTITUTIONAL_POTES_ENABLED=false` devolvía 503 en todas las rutas HTTP
    // mientras este bucle seguía escaneando y FIRMANDO pagos del ómnibus: el
    // apagado no apagaba. Invariante #10 se cumple para la superficie entera o
    // no se cumple.
    if (process.env.INSTITUTIONAL_POTES_ENABLED !== 'true') {
      console.log('[demo-exchange-autopilot] apagado (INSTITUTIONAL_POTES_ENABLED != true)');
      return;
    }
    const cfg = readSignerConfig();
    if (!cfg.enabled) {
      console.log('[demo-exchange-autopilot] apagado (DEMO_EXCHANGE_AUTOSIGN_ENABLED != true)');
      return;
    }
    if (!cfg.address) {
      console.error(`[demo-exchange-autopilot] NO arranca: ${cfg.seedPresent ? cfg.error : 'falta DEMO_EXCHANGE_OMNIBUS_SEED'}`);
      return;
    }
    const every = intervalMs();
    this.bootTimer = setTimeout(() => void this.tick(), 15_000);
    if (typeof this.bootTimer.unref === 'function') this.bootTimer.unref();
    this.timer = setInterval(() => void this.tick(), every);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    console.log(`[demo-exchange-autopilot] en marcha como ómnibus ${cfg.address} — tick cada ${every / 1000}s · tope ${Number(cfg.maxTxDrops) / 1e6} XRP/tx · ${Number(cfg.dailyCapDrops) / 1e6} XRP/día`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    this.timer = null;
    this.bootTimer = null;
  }

  async status(): Promise<AutopilotStatus> {
    const cfg = readSignerConfig();
    return {
      enabled: cfg.enabled,
      running: this.timer !== null,
      signerAddress: cfg.address,
      seedPresent: cfg.seedPresent,
      signerError: cfg.error,
      attribution: cfg.attribution,
      maxTxXrp: Number(cfg.maxTxDrops) / 1e6,
      dailyCapXrp: Number(cfg.dailyCapDrops) / 1e6,
      // it. 21: the daily spend is read STRICTLY now (a swallowed error used to
      // read as «0 spent today» and hand the key its whole cap back). A status
      // panel must not 500 because of that: it says «unknown» and the SIGNING
      // path, which is the one that matters, still refuses when it cannot read.
      spentTodayXrp: await spentToday()
        .then((d) => Number(d) / 1e6)
        .catch(() => null),
      intervalMs: intervalMs(),
      lastTickAt: this.lastTickAt,
      lastError: this.lastError,
      fulfilled: this.fulfilled.slice(-20),
    };
  }

  /**
   * One pass over every open run with autopilot on. Safe to call by hand.
   *
   * it. 21 (3.1) — A TICK THAT COULD NOT EVEN READ ITS LIST IS NOT A GREEN TICK.
   * Since `listRuns` reads STRICTLY (it. 19), a database outage makes this method
   * THROW before the loop starts. The `try/finally` had no `catch`, so `errors`
   * stayed empty, `markAgentTick` reported **ok** for a pass that served nobody,
   * and the rejection died as an `unhandledRejection` (the interval calls this
   * with a bare `void`). The failure is caught here, kept in `lastError`, sent to
   * the heartbeat as `ok: false`, and named in `failed` so the on-demand route
   * can answer 503 instead of «0 runs, all good».
   */
  async tick(): Promise<{ runs: number; actions: number; failed?: string }> {
    if (this.ticking) return { runs: 0, actions: 0 };
    this.ticking = true;
    this.lastTickAt = new Date().toISOString();
    this.staleThisTick = [];
    let actions = 0;
    let runs = 0;
    let failed: string | null = null;
    const errors: string[] = [];
    try {
      const cfg = readSignerConfig();
      // it. 25 (B.4) — LAS RESERVAS HUÉRFANAS SE DEVUELVEN ANTES DE SERVIR A
      // NADIE. Una reserva que nadie liquidó ni devolvió (un reinicio entre la
      // firma y el veredicto del ledger) se come el tope para siempre y deja la
      // operativa propia estrangulada al día siguiente. Esto solo ABRE tope: no
      // puede negar nada, y menos una salida.
      await this.sweepOrphanReservations();
      // The list only says WHICH runs to serve. Each run is served inside its
      // lock from a FRESH load and saved before the lock is released: a route
      // (verify, omnibus, a client request) can never interleave a stale save
      // with what this tick signed (withRunLock, single-instance assumption).
      const all = await listRuns();
      for (const listed of all) {
        // it. 31 — UNA TOMA CERRADA NO ES UN INTERRUPTOR SOBRE LA SALIDA.
        // Este bucle saltaba toda toma `closed` ANTES de servir y antes de
        // mirar su cola: `PATCH /runs/:id {status:'closed'}` dejaba una
        // retirada aceptada con 201 («the autopilot will fulfil it on its next
        // tick») pendiente para siempre, con el latido verde y ops mudo. La
        // salida no se gatea ni por un interruptor nuestro: una toma cerrada
        // se sirve SOLO PARA SALIR (`serveRun` lee `run.status`: paga
        // retiradas, resuelve lo ya firmado, no abre entradas nuevas) y su cola
        // envejece en voz alta como la de cualquier otra. Lo único que se
        // ahorra es el trabajo de una toma archivada SIN nada vivo: ni una
        // lectura del ledger por ella.
        if (listed.status !== 'open' && !hasLiveWork(listed)) continue;
        if (!listed.autopilot) {
          // it. 29 — LA TOMA MANUAL TAMBIÉN ENVEJECE, Y ES LA QUE MÁS OJOS PIDE.
          // El comentario del paso 4 de `serveRun` prometía «se mira SIEMPRE,
          // tenga o no este backend la llave», pero este `continue` saltaba la
          // toma entera antes de llegar allí: una petición olvidada en una toma
          // sin autopiloto —la que POR DEFINICIÓN espera a una persona— no podía
          // sonar jamás. `listRuns` ya devuelve la toma completa, así que mirar
          // su cola no cuesta ninguna lectura más. No se firma nada ni se guarda
          // nada: `noteStaleRequests` no muta.
          this.noteStaleRequests(listed);
          // it. 33 (agente C, 3) — EL BARRIDO DE MESA CORRE TAMBIÉN AQUÍ. La
          // reserva de mesa con memo existe SOLO en tomas que sirve una persona
          // (la compone `prepare-put-to-work`, la puerta del escritorio), y el
          // 409 del dueño (`DESK_PAYMENT_NOT_RELEASABLE_HERE`) le promete sin
          // condición que «once that ledger is past, the exchange proves it
          // absent and releases it on its own». Ese barrido vivía en el paso 0
          // de `serveRun`, que este `continue` nunca alcanzaba en manual: la
          // promesa era falsa justo donde aplicaba. Aquí no se firma nada ni se
          // escanea nada: se lee el ledger validado, se PRUEBA (ventana entera)
          // y se suelta o se asienta lo que el ledger ya decidió. Bajo el lock,
          // de una carga fresca, y guardando solo si algo cambió.
          if (deskSweepDue(listed)) {
            try {
              actions += await withRunLock(listed.runId, async () => {
                const run = await loadRun(listed.runId);
                if (!run || run.autopilot || !deskSweepDue(run)) return 0;
                return this.sweepDeskOnly(run);
              });
            } catch (e) {
              errors.push(`${listed.label} (desk sweep): ${(e as Error).message}`);
            }
          }
          continue;
        }
        runs++;
        try {
          actions += await withRunLock(listed.runId, async () => {
            const run = await loadRun(listed.runId);
            if (!run || !run.autopilot) return 0;
            if (run.status !== 'open' && !hasLiveWork(run)) return 0;
            return this.serveRun(run, cfg.address);
          });
        } catch (e) {
          errors.push(`${listed.label}: ${(e as Error).message}`);
        }
      }
      this.lastError = errors.length ? errors.join(' · ') : null;
    } catch (e) {
      // The pass never ran (the run list, the signer config): say so instead of
      // letting an empty `errors` array paint the agent green.
      failed = `the tick could not run: ${(e as Error).message}`;
      errors.push(failed);
      this.lastError = errors.join(' · ');
      console.error(`[demo-exchange-autopilot] tick failed: ${(e as Error).message}`);
    } finally {
      this.ticking = false;
      try {
        // it. 27: un tick que no lanzó pero que dejó a alguien esperando media
        // hora NO es un tick verde. La cola envejecida entra en el latido con el
        // mismo peso que un error: es el Sentinel quien tiene que verlo, no el
        // cliente descubriendo que su dinero lleva ahí desde ayer.
        const detail = [...errors, ...this.staleThisTick].join(' · ');
        markAgentTick(SOURCE, {
          title: AGENT_TITLE,
          everyMs: intervalMs(),
          ok: errors.length === 0 && this.staleThisTick.length === 0,
          ...(detail ? { detail } : {}),
        });
      } catch {
        /* the heartbeat never breaks the tick */
      }
    }
    return { runs, actions, ...(failed ? { failed } : {}) };
  }

  private async serveRun(run: DemoRun, signerAddress: string | null): Promise<number> {
    let actions = 0;
    // it. 31 — una toma cerrada se sirve SOLO PARA SALIR: retiradas y lo que ya
    // estaba firmado (el ledger decide). Ninguna entrada nueva, ninguna
    // operativa propia (auto-invest, aceptación de credenciales).
    const exitOnly = run.status !== 'open';
    // 0. a prepared desk payout closes by its LastLedgerSequence only against a
    //    ledger index read BEFORE the scan (availableBalance.LedgerView).
    //    it. 31: y una reserva de mesa de put-to-work CON memo pasada de su LLS
    //    también se prueba aquí (antes solo la cerraba el DELETE de admin).
    const view: LedgerView = {};
    if ((run.deskPayments ?? []).some((p) => p.status === 'prepared' && typeof p.lastLedgerSequence === 'number')) {
      const { currentValidatedLedgerIndex } = await import('./OmnibusWatcher');
      const idx = await currentValidatedLedgerIndex();
      if (idx) view.validatedLedgerIndex = idx;
    }
    // 1. the watcher: credits by tag, receipts for what arrived / left
    const sync = await syncOmnibus(run, { maxPages: 2 });
    if (sync.credited.length) actions += sync.credited.length;
    // A prepared desk payout past its LLS closes only on an EXHAUSTIVE read of
    // its window (the 2-page scan above can miss it on a busy omnibus).
    // it. 31 — LA RESERVA DE MESA CON MEMO RETENÍA LA SALIDA INDEFINIDAMENTE.
    // `deskPaymentOpen` jamás cierra un put-to-work por ledger, y su única
    // prueba (`provePutToWorkRelease`) solo la pedía el DELETE de admin: desde
    // que caducaba su payload (~6 min) hasta que un fundador se acordara, el
    // saldo del cliente seguía «reservado por pagos en vuelo». El paso 0 ya
    // prueba y barre payouts pasados de LLS; ahora hace lo mismo con los
    // put-to-work de mesa compuestos (memo + LLS) cuya ventana pasó: la
    // ventana se lee ENTERA (hasta su LLS), y solo un «absent» probado suelta.
    // it. 33: la misma pieza corre en las tomas manuales (`sweepDeskOnly`).
    actions += await this.proveAndSweepDesk(run, view);
    // 2. standing instructions: a credited deposit of an auto-invest client becomes a request
    for (const m of sync.credited) {
      if (m.kind !== 'deposit') continue;
      const client = run.clients.find((c) => c.id === m.clientId);
      if (!client?.autoInvest) continue;
      if (exitOnly) {
        // Cerrada: la instrucción permanente no abre una entrada. Se dice en un
        // recibo (uno por depósito acreditado) y el XRP se queda en la casilla,
        // retirable como siempre.
        run.receipts.push(makeReceipt(run, { step: 'NOTE', chain: 'none', clientId: client.id, note: 'Auto-invest held: this exchange desk is closed — no new entries are executed; the deposit stays at the exchange and can be withdrawn.', expect: { code: 'RUN_CLOSED', txHash: m.txHash } }));
        actions++;
        continue;
      }
      const pending = requestsOf(run).some((r) => r.clientId === client.id && r.kind === 'put-to-work' && (r.status === 'pending' || r.status === 'submitting'));
      if (pending) continue;
      // El KYC del exchange también aquí: sin esto, el toggle «Auto» era la
      // puerta trasera del gate — el capital entraba al pote sin credencial.
      // Se DICE en un recibo (uno por depósito acreditado): un salto callado
      // dejaría al operador creyendo que el autopilot no vio el depósito.
      const { checkClientCredential, clientCredentialGateEnabled, isCredentialRefusal } = await import('./clientCredentialGate');
      if (clientCredentialGateEnabled()) {
        const verdict = await checkClientCredential(run, client);
        if (isCredentialRefusal(verdict)) {
          run.receipts.push(
            makeReceipt(run, {
              step: 'NOTE',
              chain: 'none',
              clientId: client.id,
              note: `Auto-invest held: ${verdict.code} — ${verdict.detail}`,
              expect: { code: verdict.code, txHash: m.txHash },
            }),
          );
          actions++;
          continue;
        }
      }
      requestsOf(run).push({ id: newId('rq'), kind: 'put-to-work', clientId: client.id, drops: m.drops, status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), reason: 'auto-invest: standing instruction of the client' });
      actions++;
    }
    // 2b. el KYC por casilla que la raíz YA emitió, lo acepta la caja (solo con SU llave)
    if (!exitOnly && signerAddress && run.omnibusAddress === signerAddress) {
      actions += await this.acceptIssuedSlotCredentials(run);
    }
    // 3. requests → the key (only if this backend holds THIS run's omnibus key)
    if (signerAddress && run.omnibusAddress === signerAddress) {
      for (const req of requestsOf(run)) {
        // it. 25 (B.2) — UNA PETICIÓN QUE REVIENTA NO SE LLEVA POR DELANTE A LAS
        // DEMÁS. Sin esto, cualquier excepción subía hasta el `catch` POR TOMA
        // del tick: los clientes que iban detrás en la cola no se servían, y el
        // `saveRun` del final de este método ni se ejecutaba, así que también se
        // perdían los abonos que el vigía acababa de escribir. Aquí se queda,
        // con su frase, y la cola sigue.
        try {
          if (req.status === 'pending' && exitOnly && req.kind === 'put-to-work') {
            // it. 31: en una toma cerrada una ENTRADA no se ejecuta. Cerrar la
            // petición (final) libera lo que retuviera y deja recibo; el XRP
            // sigue en la casilla y sale por la puerta de siempre.
            actions += await this.refuseClosedEntry(run, req);
          } else if (req.status === 'pending') {
            actions += await this.fulfil(run, req, view);
          } else if (req.status === 'submitting') {
            // Signed and persisted, outcome not read yet: the ledger decides —
            // never a second signature.
            actions += await this.resolveSubmitting(run, req);
          } else if (req.status === 'signed' && req.kind === 'put-to-work' && req.txHash) {
            if (await this.mintExecuted(req.txHash)) {
              req.status = 'done';
              req.updatedAt = new Date().toISOString();
              actions++;
            }
          }
        } catch (e) {
          // El estado NO se toca: lo que estuviera firmado sigue firmado y el
          // ledger sigue mandando. Solo se deja dicho por qué no avanzó.
          const detail = (e as Error).message.slice(0, 140);
          req.reason = `NOT_SERVED_THIS_TICK: ${detail} — nothing is refused; the next tick serves it again`;
          req.updatedAt = new Date().toISOString();
          console.error(`[demo-exchange-autopilot] ${req.kind} ${req.id} threw (${detail}) — the rest of the queue continues`);
          void this.alertOps(req.kind === 'withdraw' ? 'critical' : 'warn', `a ${req.kind} request threw and was not served this tick`, {
            key: `request-threw:${req.id}`,
            runbook: 'Mira el motivo en la petición. El siguiente tick la vuelve a servir. Si es una salida y urge: RETIRA la petición pendiente (DELETE /api/demo-exchange/runs/:id/clients/:cid/requests/:rid) y paga con POST /runs/:id/withdraw/prepare.',
            facts: { run: run.label, request: req.id, client: req.clientId, kind: req.kind, drops: req.drops, detail },
          });
        }
      }
    }
    // 4. lo que lleva demasiado esperando suena en ops y ensucia el latido.
    //    Se mira SIEMPRE, tenga o no este backend la llave de esta toma: una
    //    petición olvidada en una toma ajena sigue siendo dinero parado.
    this.noteStaleRequests(run);
    await saveRun(run);
    return actions;
  }

  /**
   * The post-scan half of step 0, shared by `serveRun` and the manual-run sweep
   * (it. 33): prove prepared payouts past their LLS over their whole window,
   * settle/release what the ledger decided, and prove desk put-to-works past
   * their LLS. Needs `view.validatedLedgerIndex` read BEFORE any scan; without
   * it nothing closes. Mutates `run`; returns how many actions it took.
   */
  private async proveAndSweepDesk(run: DemoRun, view: LedgerView): Promise<number> {
    let actions = 0;
    const idx = view.validatedLedgerIndex;
    if (typeof idx === 'number' && (run.deskPayments ?? []).some((p) => p.kind === 'withdraw' && p.status === 'prepared' && typeof p.lastLedgerSequence === 'number' && idx > p.lastLedgerSequence)) {
      const { proveDeskPayouts } = await import('./deskPaymentProof');
      const proofs = await proveDeskPayouts(run, idx);
      view.payoutsProvenAbsent = proofs.provenAbsent;
      actions += proofs.settled.length;
    }
    if (sweepDeskPayments(run, view)) actions++;
    if (typeof idx === 'number') actions += await this.sweepDeskPutToWorkPastLls(run, idx);
    return actions;
  }

  /**
   * it. 33 (agente C, 3) — the desk sweep for a run this backend does NOT serve
   * (no autopilot): no scan, no signature, no entries. It reads the validated
   * ledger, proves what is past its LastLedgerSequence over its whole window and
   * closes only what the ledger decided. Saves only when something changed.
   * Returns how many actions it took.
   */
  private async sweepDeskOnly(run: DemoRun): Promise<number> {
    const view: LedgerView = {};
    const { currentValidatedLedgerIndex } = await import('./OmnibusWatcher');
    const idx = await currentValidatedLedgerIndex();
    if (!idx) return 0; // no ledger read, no proof, nothing released (it. 8)
    view.validatedLedgerIndex = idx;
    const actions = await this.proveAndSweepDesk(run, view);
    if (actions > 0) await saveRun(run);
    return actions;
  }

  /** Is the live loop running (a timer armed by `start()`)? What a 201 may promise depends on it (it. 33). */
  isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * it. 27 — LO QUE ENVEJECE SE DICE EN VOZ ALTA.
   *
   * No cambia ningún estado y no puede negar nada: solo mira la edad de lo que
   * sigue abierto y lo cuenta. Una SALIDA parada es `critical` (el dinero de una
   * persona está esperando a nuestra infraestructura); una ENTRADA parada es
   * `warn` y normalmente se explica sola en su motivo: una cuenta Flare que el
   * cliente aún no ha creado, un pote que no ha nacido. `opsAlert` deduplica por
   * `key`, así que esto no repite el mismo aviso cada veinte segundos.
   */
  private noteStaleRequests(run: DemoRun, now = Date.now()): void {
    const ttl = staleRequestMs();
    for (const req of requestsOf(run)) {
      if (req.status !== 'pending' && req.status !== 'submitting') continue;
      // it. 29 — LA EDAD SE MIDE DESDE QUE LA PETICIÓN EXISTE, no desde el
      // último rechazo. Medía por `updatedAt`, y `refuse()` lo pone a «ahora» en
      // su primera línea SIEMPRE, también con `final === false` — que es
      // exactamente lo que le pasa a todos los estados que esta alarma nombra
      // como su motivo de existir (`NO_CLIENT_ACCOUNT`, `NO_POTE`,
      // `ABOVE_DAILY_CAP`, `NONCE_SEAT_TAKEN`…). Corriendo en el MISMO tick que
      // los produce, la antigüedad volvía a cero cada veinte segundos y la
      // alarma no podía sonar nunca. `createdAt` no lo toca nadie.
      const since = Date.parse(req.createdAt || req.updatedAt);
      if (!Number.isFinite(since) || now - since <= ttl) continue;
      const ageMin = Math.round((now - since) / 60_000);
      const exit = req.kind === 'withdraw';
      this.staleThisTick.push(`${req.kind} ${req.id} (${run.label}) waiting ${ageMin} min: ${req.reason ?? 'no reason recorded'}`);
      // it. 31: el latido la lleva cada tick; el aviso, una vez por media hora.
      if (!this.alertGate(`stale:${req.id}`, now)) continue;
      void this.alertOps(exit ? 'critical' : 'warn', `a ${req.kind} request has been waiting ${ageMin} min without being served`, {
        key: `request-stale:${req.id}`,
        runbook: exit
          ? 'El dinero de una persona lleva ese tiempo parado. Mira el motivo en la petición. Para pagarlo a mano: primero RETIRA la petición pendiente (DELETE /api/demo-exchange/runs/:id/clients/:cid/requests/:rid, que solo cede si nada suyo está firmado) y luego compón el pago con POST /runs/:id/withdraw/prepare. Mientras la petición siga viva, el 409 PAYMENT_IN_FLIGHT es correcto: evita pagar dos veces.'
          : 'Una entrada lleva ese tiempo sin poder firmarse; el motivo de la petición lo dice (cuenta Flare del cliente sin crear, pote sin nacer, asiento ocupado). Desde la it. 27 una entrada pendiente ya NO retiene la salida de su dueño, así que su dinero puede salir igual. Si ya no la quiere, se retira con DELETE /api/demo-exchange/runs/:id/clients/:cid/requests/:rid.',
        facts: { run: run.label, request: req.id, client: req.clientId, kind: req.kind, status: req.status, drops: req.drops, ageMinutes: ageMin, reason: (req.reason ?? '').slice(0, 160) },
      });
    }
  }

  /** Aceptaciones de KYC ya firmadas: su ventana evita una segunda firma mientras el ledger decide. */
  private readonly acceptWindows = new Map<string, number>();

  /**
   * El KYC por casilla que la RAÍZ ya emitió lo ACEPTA la caja (fundador 14-sep:
   * «darle la credencial KYC cuando se crea la cuenta… el exchange siempre en
   * autopilot»). La raíz firma UNA vez en Xaman y jamás vive en caliente;
   * aceptar es un acto de la propia caja, con la llave que este backend ya
   * tiene. La puerta es `assessCredentialAccept`: solo un CredentialAccept
   * exacto, de la raíz del run, del tipo de una casilla suya. Emitir, jamás.
   */
  private async acceptIssuedSlotCredentials(run: DemoRun): Promise<number> {
    if (process.env.DEMO_EXCHANGE_AUTO_ACCEPT_KYC === 'false' || run.clients.length === 0) return 0;
    const gate = await import('./clientCredentialGate');
    if (!gate.clientCredentialGateEnabled()) return 0;
    // it. 25 (B.3) — EL RADIO DE LA OPERATIVA PROPIA CUANDO EL TOPE ES ILEGIBLE.
    //
    // it. 29 — POR QUÉ ESTA CEREMONIA NO SE APUNTA EN EL LIBRO DEL DÍA, DICHO.
    // El comentario anterior afirmaba que «cuesta reserva del ledger», y de ahí
    // se leía que este acto pasaba por `reserveSpend`/`recordSpend`. No lo hace,
    // y no debe: el libro del día cuenta lo que esta llave PAGA (`assessPayment`
    // compara un `Amount` contra el tope), y un `CredentialAccept` no paga a
    // nadie. Lo que consume es reserva de propietario del XRPL —0,2 XRP que se
    // BLOQUEAN en la propia cuenta del ómnibus mientras el objeto exista, no XRP
    // que se van— más la comisión de la transacción. Ninguna de las dos es un
    // pago, así que `spentToday()` es «lo que esta llave ha pagado hoy», no «lo
    // que le ha costado a la casa». La auditoría de la ceremonia vive donde
    // corresponde: un recibo E3_CREDENTIAL con su hash, más abajo.
    //
    // Lo que sí depende del libro: mientras no se pueda leer NI ESCRIBIR no hay
    // cota alguna sobre lo que esta llave firma, y la operativa propia espera al
    // siguiente tick. Las entradas ya fallan cerradas por su cuenta en `fulfil`.
    // Por aquí no pasa ninguna salida de ningún cliente, y ninguna se detiene.
    const budget = await readSpendBudget();
    if (budget.unreadable || budget.spentDrops === null) {
      console.error(`[demo-exchange-autopilot] libro de gasto ilegible (${budget.unreadable ?? 'unknown'}) — la caja no acepta credenciales este tick; las salidas de clientes siguen saliendo`);
      void this.alertOps('warn', 'the daily spend ledger is unreadable — the exchange key holds ALL of its own operation this tick (client payouts keep going out)', {
        key: `own-operation-held:${run.runId}`,
        runbook: 'Levanta la base de datos. Sin el libro del día no hay tope que honrar, así que la llave no gasta en nada propio (entradas, aceptación de credenciales). Las salidas de clientes no dependen de esto y siguen.',
        facts: { run: run.label, detail: budget.unreadable ?? 'unknown' },
      });
      return 0;
    }
    const { assessCredentialAccept, signForSubmission, submitSignedBlob } = await import('./DemoExchangeSigner');
    const ACCEPT_WINDOW_MS = 120_000;
    const slotTypes = run.clients.map((c) => gate.credentialSpecForClient(run, c).credentialType);
    let actions = 0;
    for (const client of run.clients) {
      const verdict = await gate.checkClientCredential(run, client);
      if (!gate.isCredentialRefusal(verdict) || verdict.code !== 'CLIENT_CREDENTIAL_PENDING') continue;
      const credentialType = verdict.spec.credentialType;
      const key = `${run.omnibusAddress}:${credentialType}`;
      const now = Date.now();
      if ((this.acceptWindows.get(key) ?? 0) > now) continue;
      const tx = {
        TransactionType: 'CredentialAccept',
        Account: run.omnibusAddress,
        Issuer: run.councilAddress,
        CredentialType: Buffer.from(credentialType, 'utf8').toString('hex').toUpperCase(),
      };
      const policy = assessCredentialAccept({ tx, run, signer: readSignerConfig(), slotTypes });
      if (!policy.ok) {
        this.acceptWindows.set(key, now + ACCEPT_WINDOW_MS);
        run.receipts.push(makeReceipt(run, { step: 'NOTE', chain: 'none', clientId: client.id, note: `Autopilot did not accept ${credentialType} — ${policy.code}: ${policy.reason}`, expect: { code: policy.code ?? 'REFUSED', credentialType } }));
        actions++;
        continue;
      }
      let signed;
      try {
        signed = await signForSubmission(tx);
      } catch {
        continue; // nada firmado: el siguiente tick lo vuelve a intentar
      }
      this.acceptWindows.set(key, now + ACCEPT_WINDOW_MS);
      try {
        const sent = await submitSignedBlob(signed.txBlob);
        gate.clearClientCredentialCache();
        if (sent.result === 'tesSUCCESS') {
          run.receipts.push(makeReceipt(run, { step: 'E3_CREDENTIAL', chain: 'xrpl', txHash: signed.hash, clientId: client.id, note: `Autopilot: the omnibus accepted ${credentialType}, issued by the exchange root. The client signed nothing.`, expect: { subject: run.omnibusAddress, issuer: run.councilAddress, credentialType } }));
          actions++;
        } else if (sent.result !== 'tecDUPLICATE') {
          run.receipts.push(makeReceipt(run, { step: 'NOTE', chain: 'none', clientId: client.id, note: `Autopilot: accepting ${credentialType} — the ledger answered ${sent.result} (${signed.hash})`, expect: { code: sent.result, credentialType } }));
          actions++;
        }
      } catch {
        /* enviada o no, la ventana evita una segunda firma; la próxima lectura decide */
      }
    }
    return actions;
  }

  private async mintExecuted(xrplHash: string): Promise<boolean> {
    try {
      const provider = flareProvider();
      const { resolveMasterAccountController } = await import('../../connectors/protocols/flare/FlareSmartAccountService');
      const mac = new ethers.Contract(await resolveMasterAccountController(provider), MAC_ABI, provider);
      return Boolean(await mac.isTransactionIdUsed('0x' + xrplHash.toLowerCase()));
    } catch {
      return false;
    }
  }

  /**
   * it. 23 (1.7) — «I COULD NOT READ MY OWN CAP» IS A FACT THAT MUST BE VISIBLE.
   *
   * A payout is never held for it (the cap protects our key, not the client's
   * way out), so the only honest alternative to stopping it is saying it out
   * loud: a NOTE receipt on the run — the desk's own audit trail — plus the
   * process log. `once`: the same request does not stack a receipt per tick.
   */
  private noteCapUnread(run: DemoRun, req: ClientRequest, detail: string, consequence: string): void {
    const note = `Autopilot: the daily spend ledger of the exchange key could not be read/written (${detail}) — ${consequence}. The daily cap bounds what Astryum's own key PAYS; it never gates a client's exit, and a client payout never counts against its total. Reconcile today's entries by hand from the omnibus history.`;
    const already = run.receipts.some((r) => r.step === 'NOTE' && r.note === note && r.clientId === req.clientId);
    if (!already) run.receipts.push(makeReceipt(run, { step: 'NOTE', chain: 'none', clientId: req.clientId, note, expect: { code: 'SPEND_LEDGER_UNREADABLE', kind: req.kind, drops: req.drops } }));
    console.error(`[demo-exchange-autopilot] spend ledger unreadable (${detail}) — ${consequence} (${req.kind} ${req.id})`);
    // it. 25 (B.3) — EL RASTRO NO PUEDE VIVIR SOLO EN LA BASE DE DATOS QUE NO
    // CONTESTA. El recibo de arriba se guarda con la toma, en la misma base que
    // acaba de fallar: si el fallo es ese, el único aviso se pierde con él. Sale
    // además por el canal de ops, que no depende de ella.
    void this.alertOps('critical', `the daily spend ledger of the exchange key could not be read/written — ${consequence}`, {
      key: `spend-ledger-unreadable:${run.runId}`,
      runbook:
        "Levanta la base de datos y reconcilia el total del día a mano contra el historial del ómnibus. Mientras no se pueda leer, la operativa PROPIA (entradas y ceremonias) está parada; las salidas de clientes siguen saliendo — el tope acota nuestra llave, jamás la salida de nadie.",
      facts: { run: run.label, request: req.id, kind: req.kind, drops: req.drops, detail },
    });
  }

  /**
   * El canal de ops. Ni lanza ni se espera: un aviso caído no puede tumbar un
   * tick, y muchísimo menos el pago de un cliente.
   */
  private async alertOps(level: AlertLevel, message: string, opts: AlertOptions = {}): Promise<void> {
    try {
      const { opsAlert } = await import('../OpsAlertService');
      await opsAlert(SOURCE, level, message, opts);
    } catch {
      /* el log de proceso ya lo dijo */
    }
  }

  /**
   * The reservation becomes a settled spend once the ledger says the payment
   * entered (it. 23, 1.4). Idempotent per hash, so a replay from the journal
   * never counts the same XRP twice.
   *
   * It must not THROW here: the payment has already moved the client's money and
   * the receipts below are the record of it. A write that fails is said out loud
   * instead of aborting the bookkeeping of something that already happened.
   *
   * it. 29 — Y SE DICE LO QUE DE VERDAD QUEDA ATRÁS. Esto hablaba del «lado
   * estrecho del tope» para los dos casos, y de un PAYOUT no es cierto desde la
   * it. 27: un payout reserva CERO contra el tope (`countsAgainstCap`), así que
   * no hay drops de más reteniendo nada — lo único que falta es la fase del
   * apunte de auditoría. En una ENTRADA sí: sus drops siguen contados como
   * 'reserved' hasta que un barrido los devuelva, que es el lado seguro.
   */
  private async settleSpend(run: DemoRun, req: ClientRequest, drops: bigint, hash: string, purpose: 'put-to-work' | 'payout'): Promise<void> {
    try {
      await recordSpend(drops, hash, purpose);
    } catch (e) {
      this.noteCapUnread(run, req, (e as Error).message.slice(0, 100), `${hash.slice(0, 12)}… settled on the ledger but its spend could not be marked settled`);
    }
  }

  /**
   * Gives a RESERVED spend back when the ledger proved the payment never moved
   * the XRP (it. 23, 1.4). Best-effort on purpose: this runs after the ledger
   * has already spoken, and a reconciliation that throws must not undo the
   * bookkeeping of a settled — or provably dead — payment. A reservation that
   * survives is the SAFE side (the cap stays tighter) and dies at midnight UTC.
   */
  private async giveSpendBack(txHash: string | undefined): Promise<void> {
    if (!txHash) return;
    try {
      await releaseSpend(txHash);
    } catch (e) {
      console.error(`[demo-exchange-autopilot] the reserved spend of ${txHash.slice(0, 12)}… could not be given back: ${(e as Error).message}`);
    }
  }

  /**
   * it. 25 (B.4) — EL BARRIDO DE RESERVAS HUÉRFANAS, una vez por tick.
   *
   * Best-effort y jamás fatal: si el libro del día no se puede leer, el tick
   * sigue (las entradas ya fallan cerradas por su cuenta, y ninguna salida
   * depende de este número). Lo barrido se dice por el canal de ops porque una
   * reserva huérfana es siempre la huella de un vuelo cortado a la mitad: hay un
   * pago cuya suerte NADIE llegó a escribir, y alguien tiene que mirarlo contra
   * el historial del ómnibus.
   */
  private async sweepOrphanReservations(): Promise<void> {
    try {
      const swept = await sweepStaleReservations();
      if (!swept.length) return;
      const total = swept.reduce((acc, r) => acc + BigInt(r.drops), BigInt(0));
      console.error(`[demo-exchange-autopilot] ${swept.length} reserva(s) huérfana(s) devueltas al tope (${Number(total) / 1e6} XRP): ${swept.map((r) => `${r.txHash.slice(0, 12)}…@${r.day}`).join(', ')}`);
      await this.alertOps('warn', `${swept.length} orphan spend reservation(s) were given back to the daily cap (${Number(total) / 1e6} XRP)`, {
        key: `spend-orphans:${swept.map((r) => r.txHash).sort().join(',').slice(0, 60)}`,
        runbook: 'Cada hash de abajo se firmó y nadie escribió su final. Búscalo en el historial del ómnibus: si entró, ese XRP salió de verdad y el total del día está corto; si no, no pasó nada. El tope vuelve a estar abierto para la operativa propia.',
        facts: { count: swept.length, xrp: Number(total) / 1e6, hashes: swept.map((r) => `${r.txHash}@${r.day}`).join(' '), oldestMinutes: Math.round(Math.max(...swept.map((r) => r.ageMs)) / 60_000) },
      });
    } catch (e) {
      console.error(`[demo-exchange-autopilot] el barrido de reservas huérfanas no pudo correr: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  /**
   * it. 31 — UNA PETICIÓN QUE NO SE PUEDE SEGUIR SE DICE, UNA VEZ POR MEDIA HORA.
   * Un 'submitting' sin hash (o un entry del journal sin hash/ventana) no se
   * puede resolver contra el ledger ni firmar de nuevo: reservaba en silencio.
   * `opsAlert` deduplica por `key`; el log de proceso lo acota `alertGate`.
   */
  private noteUnfollowable(run: DemoRun, req: ClientRequest, entry?: { txHash?: unknown; lastLedgerSequence?: unknown } | null): void {
    if (!this.alertGate(`unfollowable:${req.id}`)) return;
    void this.alertOps(req.kind === 'withdraw' ? 'critical' : 'warn', `a ${req.kind} request is marked signed but cannot be followed on the ledger (no hash or no LastLedgerSequence)`, {
      key: `request-unfollowable:${req.id}`,
      runbook: 'El journal (o la petición) dice que se firmó algo pero no guarda hash o ventana. Búscalo en el historial del ómnibus por importe y fecha: si entró, regístralo; si no puede haber entrado, ciérrala como operador con DELETE /api/demo-exchange/runs/:id/clients/:cid/requests/:rid?closeMalformed=1 (it. 33: marca el entry expired con código, suelta el asiento, deja recibo y avisa a ops; el dueño no puede, porque no puede saber). Nada se firma de nuevo por sí solo.',
      facts: { run: run.label, request: req.id, client: req.clientId, kind: req.kind, drops: req.drops, status: req.status, hash: String(entry?.txHash ?? req.txHash ?? ''), lastLedgerSequence: String(entry?.lastLedgerSequence ?? req.lastLedgerSequence ?? '') },
    });
  }

  /** Última emisión por clave, para que un estado que dura días no escriba tres líneas de log cada 20 s. */
  private readonly alertedAt = new Map<string, number>();

  /**
   * it. 31 — LA COTA DEL CRÍTICO PERMANENTE. Un estado legítimo y largo (una
   * entrada en `NO_CLIENT_ACCOUNT` puede durar días) volvía a llamar a
   * `opsAlert` en cada tick: el canal deduplicaba, pero cada llamada escribía
   * su línea, su runbook y «alerta repetida» — ~13k líneas de log al día por
   * petición vieja. Se re-emite cada `staleRequestMs()` (30 min): suficiente
   * para que ops vea que sigue ahí, y nada más. El latido lo lleva cada tick
   * igual: eso es un estado, no un aviso.
   */
  private alertGate(key: string, now = Date.now()): boolean {
    const last = this.alertedAt.get(key) ?? 0;
    if (now - last < staleRequestMs()) return false;
    if (this.alertedAt.size > 5_000) this.alertedAt.clear();
    this.alertedAt.set(key, now);
    return true;
  }

  /**
   * it. 31 — el paso 0 barre también los put-to-work DE MESA pasados de su LLS.
   * Solo filas `prepared` de `put-to-work` con memo Y LastLedgerSequence (las
   * que el servidor compuso), y solo cuando el ledger validado leído ANTES del
   * scan ya pasó esa ventana. La prueba es la misma que la del DELETE de admin
   * (`provePutToWorkRelease`): la ventana entera leída hasta el LLS; «absent»
   * suelta (y libera el asiento del ómnibus por la lectura del propio store),
   * «executed» asienta y debita una vez. Cualquier otro veredicto — ilegible,
   * firmado fuera del ledger, un 0xFE sin explicar — deja la reserva como está:
   * nada se suelta sin prueba (it. 8). Mutates; returns how many closed.
   */
  private async sweepDeskPutToWorkPastLls(run: DemoRun, validatedLedgerIndex: number): Promise<number> {
    const due = (run.deskPayments ?? []).filter(
      (p) => p.kind === 'put-to-work' && p.status === 'prepared' && Boolean(p.memoHex) && typeof p.lastLedgerSequence === 'number' && validatedLedgerIndex > p.lastLedgerSequence,
    );
    if (!due.length) return 0;
    const { provePutToWorkRelease, settlePutToWorkByProof } = await import('./deskPaymentProof');
    let closed = 0;
    for (const p of due) {
      let verdict;
      try {
        verdict = await provePutToWorkRelease(run, p);
      } catch (e) {
        // it. 33 (7): un estado que dura se dice una vez por media hora, y llega
        // a ops — antes, una línea de log por tick y nadie avisado.
        this.noteDeskReservationStuck(run, p, `could not be proven: ${(e as Error).message.slice(0, 120)}`);
        continue;
      }
      const nowIso = new Date().toISOString();
      if (verdict.kind === 'executed') {
        settlePutToWorkByProof(run, p, verdict, nowIso);
        closed++;
      } else if (verdict.kind === 'release') {
        p.status = 'released';
        // 18-sep: el autopilot sale de la vista, y este barrido corre también en
        // exchanges a los que no sirve (sweepDeskOnly): solo LEE el ledger y
        // suelta, no firma nada. Se dice así, no «el autopilot».
        p.closedBy = `${verdict.proof} — swept by the exchange backend (it signs nothing)`;
        p.updatedAt = nowIso;
        run.receipts.push(makeReceipt(run, {
          step: 'NOTE',
          chain: 'none',
          clientId: p.clientId,
          note: `The desk reservation of ${Number(p.drops) / 1e6} XRP (0xFE memo ${String(p.memoHex).slice(0, 12)}…) was released by the exchange backend, which signs nothing here: its LastLedgerSequence ${p.lastLedgerSequence} is past and the omnibus window was read in full — no such 0xFE left. Nothing moved; the XRP it was holding is available again.`,
          expect: { kind: p.kind, drops: p.drops, lastLedgerSequence: p.lastLedgerSequence ?? '', memoHex: String(p.memoHex) },
        }));
        // The seat: the dispatch WAS handed to Xaman, so the store frees it only
        // on its own reading of the memo's window (it. 20, R1 B1) — best-effort.
        try {
          const { releaseQueuedHandoffByMemo } = await import('../flare/DirectMintHandoffStore');
          await releaseQueuedHandoffByMemo(String(p.memoHex));
        } catch {
          /* the seat's own LastLedgerSequence still ends it */
        }
        closed++;
      } else {
        const detail = 'detail' in verdict ? ` — ${String(verdict.detail).slice(0, 120)}` : '';
        this.noteDeskReservationStuck(run, p, `stays reserved: ${verdict.kind}${detail}`);
      }
    }
    return closed;
  }

  /**
   * it. 33 (agente C, 7) — a desk reservation past its window that the sweep
   * could NOT close (unreadable window, an unexplained 0xFE, signed off-ledger)
   * keeps holding its client's XRP — including against their withdrawal. That
   * was a `console.error` per tick and nothing else: ~4k lines a day and no
   * human told. Gated like the other long states (`alertGate`, once per
   * `staleRequestMs()`), and sent to ops with the one door that closes it.
   */
  private noteDeskReservationStuck(run: DemoRun, p: { id: string; clientId: string; drops: string; lastLedgerSequence?: number; memoHex?: string }, why: string): void {
    if (!this.alertGate(`desk-sweep:${p.id}`)) return;
    console.error(`[demo-exchange-autopilot] desk put-to-work ${p.id} past its LastLedgerSequence ${why}`);
    void this.alertOps('warn', `a desk put-to-work reservation is past its LastLedgerSequence and the sweep could not close it — it keeps holding its client's XRP`, {
      key: `desk-reservation-stuck:${p.id}`,
      runbook: 'La reserva retiene el saldo del cliente (también frente a su retirada). Mira el ómnibus por el memo: si el 0xFE entró, regístralo (POST /runs/:id/put-to-work/record); si no puede haber entrado, ciérrala contra el ledger con DELETE /api/demo-exchange/runs/:id/desk-payments/:pid. El barrido lo vuelve a intentar cada tick.',
      facts: { run: run.label, deskPayment: p.id, client: p.clientId, drops: p.drops, lastLedgerSequence: String(p.lastLedgerSequence ?? ''), memoHex: String(p.memoHex ?? '').slice(0, 24), why: why.slice(0, 200) },
    });
  }

  /**
   * it. 31 — UN ENTRY `failed` DEL JOURNAL ES UN PAGO QUE EL LEDGER RECHAZÓ: los
   * drops nunca salieron, y aun así se agrupaba con «lo firmado» en la puerta
   * del dueño (409). Con el bucle apagado no había reconciliador ni puerta de
   * admin. Esto es la reconciliación que el tick haría (`finishSubmission` con
   * el código validado: journal, asiento, gasto reservado, negativa final con
   * recibo), ofrecida a la ruta para que el DELETE del dueño CEDA en vez de
   * remitir a un tick que quizá no existe. No firma nada ni lee la red.
   */
  async closeFailedSubmission(run: DemoRun, req: ClientRequest, entry: { txHash: string; lastLedgerSequence: number; submittedAtLedger: number; memoHex?: string; userOpHash?: string; supplyUBA?: string; code?: string }): Promise<void> {
    req.txHash = entry.txHash;
    req.lastLedgerSequence = entry.lastLedgerSequence;
    req.submittedAtLedger = entry.submittedAtLedger;
    req.memoHex = entry.memoHex;
    req.userOpHash = entry.userOpHash;
    req.supplyUBA = entry.supplyUBA;
    const client = run.clients.find((c) => c.id === req.clientId);
    await this.finishSubmission(run, req, client, entry.code ?? 'FAILED');
  }

  /**
   * it. 31 — una ENTRADA pendiente en una toma cerrada. `pending` no es prueba
   * (it. 29): un guardado concurrente devuelve a 'pending' una petición YA
   * firmada, y cerrarla «final» perdería el rastro de un pago vivo. Primero el
   * journal, como en `fulfil`: si dice que se firmó, se sigue el ledger; si no se
   * puede leer, se espera; solo lo que nadie firmó se cierra con RUN_CLOSED.
   */
  private async refuseClosedEntry(run: DemoRun, req: ClientRequest): Promise<number> {
    let replayed: number | null;
    try {
      replayed = await this.replayJournal(run, req);
    } catch (e) {
      return this.refuse(run, req, 'JOURNAL_UNREADABLE', `the submission journal could not be read (${(e as Error).message.slice(0, 80)}) — this desk is closed and nothing is signed, but whether it already was is unknown; the next tick reads it again`, false);
    }
    if (replayed !== null) return replayed;
    return this.refuse(run, req, 'RUN_CLOSED', 'this exchange desk is closed — no new entries are executed; the XRP stays at the exchange and can be withdrawn', true);
  }

  private refuse(run: DemoRun, req: ClientRequest, code: string, reason: string, final: boolean): number {
    req.updatedAt = new Date().toISOString();
    req.reason = `${code}: ${reason}`;
    if (final) {
      req.status = 'refused';
      run.receipts.push(makeReceipt(run, { step: 'NOTE', chain: 'none', clientId: req.clientId, note: `Autopilot refused ${req.kind} of ${Number(req.drops) / 1e6} XRP — ${code}: ${reason}`, expect: { code, kind: req.kind, drops: req.drops } }));
      return 1;
    }
    return 0; // stays pending; the reason is visible on the request
  }

  private async fulfil(run: DemoRun, req: ClientRequest, view: LedgerView = {}): Promise<number> {
    // The durable journal outlives a run that a stale save clobbered back to
    // 'pending' (the run lock closes that in-process; the journal still holds
    // across a restart). Never sign a request the journal says the omnibus key
    // already signed — and never sign one whose journal entry could not be READ:
    // «could not read» is not «never signed».
    let replayed: number | null;
    try {
      replayed = await this.replayJournal(run, req);
    } catch (e) {
      return this.refuse(run, req, 'JOURNAL_UNREADABLE', `the submission journal could not be read (${(e as Error).message.slice(0, 80)}) — nothing is signed until it can be`, false);
    }
    if (replayed !== null) return replayed;
    const client = run.clients.find((c) => c.id === req.clientId);
    if (!client) return this.refuse(run, req, 'CLIENT_NOT_FOUND', 'the client left the run', true);
    const drops = BigInt(req.drops);
    if (drops > BigInt(client.xrpOnExchangeDrops || '0')) {
      return this.refuse(run, req, 'INSUFFICIENT_LEDGER_BALANCE', `the ledger holds ${Number(client.xrpOnExchangeDrops || '0') / 1e6} XRP for this client`, false);
    }
    // What is already in flight for this client (a submitting request whose
    // outcome is unread, a desk payment handed to Xaman, a pending request ahead
    // in the queue) is not debited yet but is spoken for: the raw balance let
    // «withdraw X» and «put X to work» both be signed (productizer it. 6).
    // `req.kind` viaja a propósito (it. 27): una ENTRADA cuya falta de firma se
    // puede PROBAR no retiene la SALIDA de su dueño. Al revés sí: una salida
    // pendiente retiene la entrada, esté donde esté en la cola (`reservedDrops`).
    //
    // it. 29 — la prueba es el JOURNAL, no el `status`. `replayJournal`, arriba,
    // ya se niega a firmar ESTA petición sin poder leerlo; sería incoherente
    // eximir a las DEMÁS entradas de la cola por lo que diga un run que un
    // guardado concurrente puede haber devuelto a 'pending'. Mismo fallo cerrado.
    let against: Against;
    try {
      against = await againstFor(run, client.id, req.kind);
    } catch (e) {
      return this.refuse(run, req, 'JOURNAL_UNREADABLE', `the submission journal could not be read (${(e as Error).message.slice(0, 80)}) — what else of this client is signed is unknown, so nothing is composed on top of it`, false);
    }
    const reserved = reservedDrops(run, client.id, req.id, view, against);
    if (drops + reserved > BigInt(client.xrpOnExchangeDrops || '0')) {
      return this.refuse(run, req, 'INSUFFICIENT_AVAILABLE_BALANCE', `the ledger holds ${Number(client.xrpOnExchangeDrops || '0') / 1e6} XRP for this client, of which ${Number(reserved) / 1e6} XRP are reserved by payments still in flight — waiting for them to settle`, false);
    }
    const cfg = readSignerConfig();
    const provider = flareProvider();
    // it. 23 (1.7) — THE CAP IS READ AFTER THE BRANCH, AND ITS FAILURE MEANS
    // DIFFERENT THINGS ON EACH SIDE.
    //
    // it. 21 made this read STRICT (a swallowed error read as «0 spent today»
    // and handed a signing key its whole cap back). But it sat HERE, above the
    // branch, so the throw reached the PAYOUT too: it died in the tick's
    // `errors.push`, the client's withdrawal stayed pending with no refusal and
    // no sentence, and every other client of the run waited behind it.
    //
    // The daily cap bounds OUR key. It is not, and can never be, a gate on a
    // client's way out. So:
    //   · put-to-work (an entry, our key spending) → fails CLOSED, visibly: a
    //     refusal with its reason on the request, retried next tick;
    //   · payout (the client's money going home) → PROCEEDS, and the fact that
    //     we could not read our own ledger is written into the run's receipts.
    const budget = await readSpendBudget();

    if (req.kind === 'put-to-work') {
      // it. 25 (B.3): `null` es «no lo sé», y sin el número no hay tope que
      // honrar. Antes viajaba un 0 de mentira hasta la política.
      if (budget.unreadable || budget.spentDrops === null) {
        return this.refuse(
          run,
          req,
          'SPEND_LEDGER_UNREADABLE',
          `today's spend of the exchange key could not be read (${budget.unreadable ?? 'the number came back unknown'}), so its daily cap cannot be honoured — nothing was signed; the next tick reads it again`,
          false,
        );
      }
      const spent = budget.spentDrops;
      // El KYC de la casilla se relee AL EJECUTAR, no solo al pedir: una credencial
      // que caducó o se revocó entre la petición y este tick no firma. La negativa
      // es FINAL para liberar la reserva — una petición colgada reservaría saldo y
      // podría estorbar una retirada, y la salida jamás se gatea. Un ledger
      // ilegible, en cambio, se reintenta en el siguiente tick.
      const { checkClientCredential, clientCredentialGateEnabled, isCredentialRefusal } = await import('./clientCredentialGate');
      if (clientCredentialGateEnabled()) {
        const verdict = await checkClientCredential(run, client);
        if (isCredentialRefusal(verdict)) return this.refuse(run, req, verdict.code, verdict.detail, verdict.code !== 'CREDENTIALS_UNREADABLE');
      }
      if (!run.poteAddress) return this.refuse(run, req, 'NO_POTE', 'the pote is not born yet', false);
      if (!client.passkeyAccount) return this.refuse(run, req, 'NO_CLIENT_ACCOUNT', 'the client has no Flare account yet (Face ID)', false);
      const [{ readDirectMintParams, computeNetMint, buildDirectMintHandoff, NonceSeatTakenError }, { readPoteState }] = await Promise.all([
        import('../../connectors/protocols/flare/FlareDirectMintService'),
        import('../flare/AstryumPoteStateService'),
      ]);
      const state = await readPoteState({ rpcUrl: process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc', pote: run.poteAddress, provider });
      // The on-chain gate, IF the pote carries one. KYC itself is the exchange's
      // own business (it verified this client long before this point); what is
      // read here is only whether the contract would revert.
      // Un fallo de lectura NO es «no hay puerta»: si el RPC no contesta, no se
      // puede probar la aprobación, y no poder probarla nunca puede abrir la
      // puerta. Por eso se distingue `readFailed` de `configured:false`.
      let gateReadFailed = false;
      let gateAddr = run.registryAddress ?? '';
      if (!gateAddr) {
        gateAddr = await new ethers.Contract(run.poteAddress, POTE_GATE_ABI, provider)
          .userGate()
          .catch(() => {
            gateReadFailed = true;
            return '';
          });
      }
      const gateConfigured = Boolean(gateAddr && gateAddr !== ethers.ZeroAddress);
      let gateApproved = false;
      if (gateConfigured) {
        gateApproved = await new ethers.Contract(gateAddr, REGISTRY_ABI, provider)
          .approved(client.passkeyAccount)
          .then((v: boolean) => Boolean(v))
          .catch(() => {
            gateReadFailed = true;
            return false;
          });
      }
      const onChainGate = { configured: gateConfigured, approved: gateApproved, readFailed: gateReadFailed };
      const params = await readDirectMintParams(provider);
      let net;
      try {
        net = computeNetMint(drops, params, undefined);
      } catch (e) {
        return this.refuse(run, req, 'AMOUNT_TOO_SMALL', (e as Error).message, true);
      }
      const erc20 = new ethers.Interface(['function approve(address spender, uint256 amount) returns (bool)']);
      const pote = new ethers.Interface(['function deposit(uint256 assets, address receiver) returns (uint256)']);
      const innerCalls = [
        { to: ethers.getAddress(state.asset.address), calldata: erc20.encodeFunctionData('approve', [run.poteAddress, net.supplyUBA]), value: '0' },
        { to: ethers.getAddress(run.poteAddress), calldata: pote.encodeFunctionData('deposit', [net.supplyUBA, client.passkeyAccount]), value: '0' },
      ];
      // La política PRIMERO, sobre el pago que se va a construir. Construir el
      // handoff PERSISTE la fila y ocupa el asiento PA+nonce del ómnibus: si se
      // evaluaba después, cualquier negativa (tope diario, receiver no aprobado)
      // dejaba un asiento huérfano bloqueado durante HANDOFF_SEAT_TTL_MIN, y como
      // la PA sale de la dirección del ÓMNIBUS ese asiento lo comparten TODOS los
      // clientes de la toma: una petición negada paraba a todos.
      const policyInput = {
        purpose: 'put-to-work' as const,
        run,
        signer: cfg,
        coreVaultAddress: params.paymentAddress,
        receiver: client.passkeyAccount,
        onChainGate,
        spentTodayDrops: spent,
        spendLedgerPersisted: Boolean(process.env.DATABASE_URL),
        // La designación del consejo (relacional; no-op con el flag apagado).
        appointment: await readOmnibusAppointment(run.omnibusAddress, run.councilAddress),
      };
      // El pago que `buildDirectMintHandoff` va a producir, tal cual: al Core
      // Vault, por los drops de la petición, y sin DestinationTag (regla FAssets).
      const preflight = assessPayment({
        ...policyInput,
        tx: { Account: run.omnibusAddress, Destination: params.paymentAddress, Amount: drops.toString() },
      });
      if (!preflight.ok) {
        return this.refuse(run, req, preflight.code ?? 'REFUSED', preflight.reason ?? '', preflight.code !== 'ABOVE_DAILY_CAP');
      }

      let handoff;
      try {
        // The omnibus seed signs this 0xFE below: operational, never the project tag.
        // The builder stamps the LastLedgerSequence and records it on the seat (R1 1.1).
        //
        // it. 19 (R1 1.1, REGRESIÓN) — `serverComposed` EN LOS DOS LADOS. Este
        // tick es «flujo servidor de una cuenta operativa», y desde la it. 17 eso
        // le daba derecho a apartar SOLA, sin 409 y sin aviso, cualquier fila que
        // nadie probado hubiera preparado — incluida la de la MESA, que el
        // fundador puede tener abierta en Xaman en ese mismo instante. Dos
        // Payments firmables en el mismo nonce, con el XRP del cliente ya en el
        // Core Vault. Marcando también esta fila como compuesta por el servidor,
        // ninguna de las dos desplaza a la otra: la que llegue segunda espera
        // (NONCE_SEAT_TAKEN → 'an earlier 0xFE … is still in flight'), que es lo
        // que hacía antes de la it. 17 y lo que debe hacer.
        handoff = await buildDirectMintHandoff(
          provider,
          {
            xrplAddress: run.omnibusAddress,
            grossXrpDrops: drops,
            innerCalls,
            action: 'demo-exchange-autopilot',
            attribution: 'operational',
            lastLedgerWindow: AUTOPILOT_FE_LEDGER_WINDOW,
            serverComposed: true,
          },
          { params },
        );
      } catch (e) {
        if (e instanceof NonceSeatTakenError) return this.refuse(run, req, 'NONCE_SEAT_TAKEN', 'an earlier 0xFE of the omnibus is still in flight — waiting', false);
        return this.refuse(run, req, 'HANDOFF_FAILED', (e as Error).message.slice(0, 160), false);
      }
      // Y la palabra final sobre el pago REAL que se va a firmar, no sobre el
      // previsto: el pre-flight ahorra el asiento, este autoriza los bytes.
      const tx = handoff.xrplPayment as unknown as Record<string, unknown>;
      // The seat and the payment must bound the SAME window: a Payment whose
      // LastLedgerSequence the seat does not know (or that the signer would
      // re-stamp) is exactly the gap a twin was composed through. Without a
      // readable ledger nothing is signed this tick — the seat is freed and the
      // request stays pending with its reason.
      const handoffLls = (handoff as { lastLedgerSequence?: number | null }).lastLedgerSequence;
      if (typeof handoffLls !== 'number' || tx.LastLedgerSequence !== handoffLls) {
        await this.releaseUnsignedSeat(handoff.memoHex);
        return this.refuse(
          run,
          req,
          'LEDGER_UNREADABLE',
          'the validated XRP Ledger could not be read when the 0xFE was composed, so its window is unknown — nothing was signed; the next tick composes it again',
          false,
        );
      }
      const verdict = assessPayment({ ...policyInput, tx });
      if (!verdict.ok) return this.refuse(run, req, verdict.code ?? 'REFUSED', verdict.reason ?? '', verdict.code !== 'ABOVE_DAILY_CAP');
      // xrpl.org, Reliable Transaction Submission: SIGN, PERSIST the hash, THEN
      // submit. Before, a submit that threw after the payment left skipped the
      // save and left the request 'pending' — the next tick signed a SECOND,
      // different payment. Now a throw leaves a 'submitting' request that the
      // ledger resolves (resolveSubmitting).
      const { signForSubmission, submitSignedBlob } = await import('./DemoExchangeSigner');
      let signed;
      try {
        signed = await signForSubmission(tx);
      } catch (e) {
        // Nothing was signed (the signer refuses to change the window the seat
        // recorded, and refuses to sign one already past): free the seat.
        await this.releaseUnsignedSeat(handoff.memoHex);
        return this.refuse(run, req, 'SIGN_FAILED', `${(e as Error).message.slice(0, 120)} — nothing was signed`, false);
      }
      if (signed.lastLedgerSequence !== handoffLls) {
        // A signature EXISTS for bytes the seat does not bound: it is never
        // submitted, and the seat is NOT freed — only its own window may end it.
        return this.refuse(run, req, 'SIGN_FAILED', `the signed payment carries LastLedgerSequence ${signed.lastLedgerSequence}, not the ${handoffLls} its nonce seat records — nothing was submitted`, false);
      }
      await this.persistSubmission(run, req, signed, { memoHex: handoff.memoHex, userOpHash: handoff.userOpHash, supplyUBA: net.supplyUBA.toString() });
      // it. 23 (1.4) — THE SPEND IS WRITTEN BEFORE THE BLOB LEAVES.
      // It used to be written by `finishSubmission`, AFTER `submitSignedBlob`,
      // with a `kvUpsert` that swallows its own failure: a lost write handed the
      // cap back and the next tick signed over it. The reservation is written
      // here — after the journal, so every reserved hash is one the ledger can
      // later resolve, and the reconciliation (`releaseSpend`) can find it.
      // An ENTRY whose reservation could not be written does not go.
      try {
        await reserveSpend(drops, signed.hash, 'put-to-work');
      } catch (e) {
        return this.refuse(
          run,
          req,
          'SPEND_NOT_RESERVED',
          `the daily spend of the exchange key could not be written (${(e as Error).message.slice(0, 100)}), so this payment was NOT submitted — the ledger closes ${signed.hash.slice(0, 12)}… at LastLedgerSequence ${signed.lastLedgerSequence} and the next tick composes it again`,
          false,
        );
      }
      try {
        const sent = await submitSignedBlob(signed.txBlob);
        return await this.finishSubmission(run, req, client, sent.result);
      } catch (e) {
        req.reason = `submitted; outcome not read yet (${(e as Error).message.slice(0, 80)}) — the ledger decides on the next tick`;
        req.updatedAt = new Date().toISOString();
        return 1;
      }
    }

    // payout
    if (!client.xrplAddress) return this.refuse(run, req, 'CLIENT_HAS_NO_XRPL_WALLET', 'the client has no own wallet on file', true);
    // The destination must be PROVEN, not merely on file: a deposit the watcher
    // credited FROM that very wallet, or the owner's own signature over it (SIWE
    // login wallet / signed WalletBinding) when it was written — see payoutProof.
    // Without either an operator pays out by hand.
    const { payoutWalletProven } = await import('./payoutProof');
    if (!payoutWalletProven(run, client.id, client.xrplAddress, client)) {
      return this.refuse(run, req, 'PAYOUT_WALLET_NOT_PROVEN', 'no deposit from this wallet was ever credited to the client, and the client never proved it with their own signature — an operator pays it out by hand from the Exchange tab', true);
    }
    const { withSourceTag } = await import('../../config/xrplSourceTag');
    // The omnibus seed signs the payout: operational, never the project tag.
    const tx = withSourceTag({ TransactionType: 'Payment', Account: run.omnibusAddress, Destination: client.xrplAddress, Amount: req.drops }, 'operational');
    const { readDirectMintParams } = await import('../../connectors/protocols/flare/FlareDirectMintService');
    const params = await readDirectMintParams(provider).catch(() => null);
    // it. 25 (B.1) — NI `spentTodayDrops` NI `spendLedgerPersisted` VIAJAN AQUÍ,
    // y su ausencia es la afirmación: el tope diario y el tope por transacción
    // son protecciones de la llave operativa de Astryum —aplican a ENTRADAS y
    // operativa propia— y el payout del cliente es su dinero y sale. La política
    // ya no los mira en una salida (`capApplies`); no pasarlos deja dicho, en el
    // sitio donde se lee, que no es un descuido.
    const verdict = assessPayment({
      tx,
      purpose: 'payout',
      run,
      signer: cfg,
      coreVaultAddress: params?.paymentAddress ?? '',
      appointment: await readOmnibusAppointment(run.omnibusAddress, run.councilAddress),
    });
    if (!verdict.ok) {
      // it. 27 — ESTA LÍNEA ESTÁ MUERTA, Y SE QUEDA DICHO AQUÍ EN LUGAR DE
      // BORRARLA. Desde la it. 25 `appointmentApplies('payout')` es `false`, así
      // que `assessPayment` no puede devolver `APPOINTMENT_UNREADABLE` en una
      // salida: `retryable` vale SIEMPRE `false`. El comentario anterior seguía
      // explicando un reintento que ya no existe.
      //
      // Que valga siempre `false` es correcto hoy: en una salida solo quedan
      // veredictos que no cambian por esperar (`DESTINATION_NOT_ALLOWED`,
      // `BAD_AMOUNT`, `WRONG_SIGNER`, `SIGNER_DISABLED`), y cerrar la petición
      // LIBERA su reserva en vez de dejarla colgada. Si algún día un veredicto
      // de salida vuelve a depender de una lectura nuestra, este es el sitio
      // donde se le vuelve a dar vida — no en la política.
      const retryable = verdict.code === 'APPOINTMENT_UNREADABLE';
      return this.refuse(run, req, verdict.code ?? 'REFUSED', verdict.reason ?? '', !retryable);
    }
    // it. 23 (1.7) — A FAILED READ OF OURS NEVER HOLDS A CLIENT'S MONEY. It is
    // recorded instead: the run's receipt book says the payout went out while
    // our own daily ledger was unreadable, so the desk can reconcile the cap by
    // hand. Silence here would be the worst of both — no cap and no trace.
    //
    // it. 27 — PERO EL RECIBO SE ESCRIBE CUANDO EL PAGO SALE, NO ANTES. Estaba
    // aquí, encima de la firma, afirmando «the payout went out anyway» sobre un
    // pago que todavía no existía: si `signForSubmission` o `persistSubmission`
    // fallaban un renglón más abajo —y los dos tienen su propia rama de fallo—
    // el libro de recibos, que es el rastro que leen `/proof` y el verificador,
    // quedaba afirmando un pago que NUNCA salió. Y como `noteCapUnread`
    // deduplica por texto exacto, la mentira se quedaba fija: ningún tick
    // posterior la corregía. Se escribe abajo, después de que el blob se entregue
    // al nodo, y con la frase que corresponda a lo que de verdad pasó.
    // Same reliable submission as put-to-work: sign, persist, then submit.
    //
    // it. 25 (B.2) — UN `throw` AQUÍ PARABA LA COLA ENTERA. El tramo de
    // put-to-work captura cada paso por petición; este no capturaba ninguno, así
    // que un nodo XRPL que no contesta al firmar, o un `writeSubmission` que no
    // puede escribir, lanzaba desde `fulfil` hasta el `catch` POR TOMA del tick:
    // la retirada se quedaba `pending` SIN frase (nadie sabía por qué) y los
    // demás clientes de esa toma no se servían ese tick — ni siquiera se
    // guardaba lo que el vigía acababa de acreditar, porque el `saveRun` del
    // final de `serveRun` no llegaba a ejecutarse.
    //
    // Se captura por petición, con motivo legible, y el tick sigue con los
    // demás. Nada de esto es un gate: no hay ninguna regla negando la salida —
    // es un reintento mecánico del siguiente tick, y suena el canal de ops
    // porque el dinero de una persona está esperando a nuestra infraestructura.
    const { signForSubmission, submitSignedBlob } = await import('./DemoExchangeSigner');
    let signed;
    try {
      signed = await signForSubmission(tx);
    } catch (e) {
      void this.alertOps('critical', "a client's payout could not be SIGNED — their money is waiting on us", {
        key: `payout-not-signed:${req.id}`,
        runbook: 'Mira el nodo XRPL (XRPL_WS_URL) y la llave del ómnibus. El siguiente tick lo vuelve a intentar solo. Nada se firmó. Si urge pagar a mano: RETIRA primero la petición pendiente (DELETE /api/demo-exchange/runs/:id/clients/:cid/requests/:rid) y luego POST /runs/:id/withdraw/prepare; mientras viva, esa ruta responde 409 PAYMENT_IN_FLIGHT, y hace bien.',
        facts: { run: run.label, request: req.id, client: req.clientId, drops: req.drops, to: client.xrplAddress, detail: (e as Error).message.slice(0, 160) },
      });
      return this.refuse(run, req, 'PAYOUT_NOT_SIGNED_YET', `the payout could not be signed this tick (${(e as Error).message.slice(0, 120)}) — nothing was signed and nothing is refused; the next tick tries again`, false);
    }
    try {
      await this.persistSubmission(run, req, signed, {});
    } catch (e) {
      // Firmado pero NO enviado (el blob muere en su LastLedgerSequence) y sin
      // registro durable. No se envía a ciegas: sin journal, el siguiente tick
      // firmaría un SEGUNDO pago y el cliente cobraría dos veces. Se reintenta
      // entero, que es un tick de espera, no una negativa.
      void this.alertOps('critical', "a client's payout was signed but could NOT be recorded, so it was not submitted — their money is waiting on us", {
        key: `payout-not-recorded:${req.id}`,
        runbook: 'Es la base de datos: el pago NO salió y su blob muere solo en su LastLedgerSequence. Levanta la base y el siguiente tick lo firma de nuevo. Si urge pagar a mano: RETIRA primero la petición pendiente (DELETE /api/demo-exchange/runs/:id/clients/:cid/requests/:rid, que comprueba el journal y solo cede si nada está firmado) y luego POST /runs/:id/withdraw/prepare.',
        facts: { run: run.label, request: req.id, client: req.clientId, drops: req.drops, to: client.xrplAddress, hash: signed.hash, detail: (e as Error).message.slice(0, 160) },
      });
      return this.refuse(run, req, 'PAYOUT_NOT_RECORDED', `the payout was signed but could not be recorded (${(e as Error).message.slice(0, 120)}), so it was NOT submitted — ${signed.hash.slice(0, 12)}… dies at LastLedgerSequence ${signed.lastLedgerSequence} and the next tick signs it again`, false);
    }
    // The spend is reserved BEFORE the blob leaves (it. 23, 1.4) — but on the way
    // OUT a ledger we cannot write is OUR problem, not the client's: it is noted
    // and the payment goes. (An entry, above, does not.)
    //
    // it. 31 — Y ESE APUNTE TAMBIÉN SE ESCRIBE CUANDO EL PAGO SALE, NO ANTES.
    // La it. 29 dejó aquí un `noteCapUnread(... "and was submitted anyway")`
    // ANTES de `submitSignedBlob`, cuarenta líneas debajo del párrafo que
    // explica por qué eso no puede ser (it. 27): si el nodo no conecta, el pago
    // nunca sale, el siguiente tick lo declara `expired` y firma otro hash — y
    // el libro de recibos (`/proof`, documento de due diligence) y la alerta
    // crítica de ops quedan afirmando un envío que no existió, fijos, porque
    // `noteCapUnread` deduplica por texto exacto. El fallo se GUARDA aquí y se
    // dice abajo, con la frase que corresponda a lo que de verdad pasó.
    let spendNotReserved: string | null = null;
    try {
      await reserveSpend(drops, signed.hash, 'payout');
    } catch (e) {
      spendNotReserved = (e as Error).message.slice(0, 100);
    }
    const short = signed.hash.slice(0, 12);
    let sent: { result: string };
    try {
      sent = await submitSignedBlob(signed.txBlob);
    } catch (e) {
      // El envío lanzó: puede haber entrado o no, y el recibo dice exactamente
      // eso — jamás que el pago salió (it. 27). El ledger lo resuelve en el
      // siguiente tick (`resolveSubmitting`).
      // it. 29: NO «no se contó contra el tope» — un payout no lo engorda nunca
      // (it. 27). Lo que falló es su APUNTE de auditoría, que es otra cosa.
      if (spendNotReserved) this.noteCapUnread(run, req, spendNotReserved, `the payout ${short}… left no audit entry in today's spend ledger (a payout never counts against the cap, so no total is short); it was signed and handed to the XRPL node, and its outcome is not read yet`);
      if (budget.unreadable) this.noteCapUnread(run, req, budget.unreadable, `the payout ${short}… was signed and handed to the XRPL node, and its outcome is not read yet`);
      req.reason = `handed to the XRPL node; whether it entered is not read yet (${(e as Error).message.slice(0, 80)}) — the ledger decides on the next tick`;
      req.updatedAt = new Date().toISOString();
      return 1;
    }
    // El pago ya está en el nodo: AHORA el recibo puede afirmarlo (it. 27).
    if (spendNotReserved) this.noteCapUnread(run, req, spendNotReserved, `the payout ${short}… left no audit entry in today's spend ledger (a payout never counts against the cap, so no total is short) and was submitted anyway`);
    if (budget.unreadable) this.noteCapUnread(run, req, budget.unreadable, `the payout ${short}… was submitted anyway`);
    try {
      return await this.finishSubmission(run, req, client, sent.result);
    } catch (e) {
      // Enviado y contestado; lo que falló es la contabilidad. El estado sigue
      // `submitting` con su hash: el siguiente tick la termina desde el ledger.
      req.reason = `submitted (${sent.result}); its bookkeeping could not finish (${(e as Error).message.slice(0, 80)}) — the ledger decides on the next tick`;
      req.updatedAt = new Date().toISOString();
      return 1;
    }
  }

  /**
   * The bookkeeping of a submission whose validated result is known — shared by
   * the submit that answered and by a later tick that read it off the ledger.
   * `applyMovements` is idempotent per (kind, hash), so the watcher having seen
   * the payment first never counts it twice.
   */
  private async finishSubmission(
    run: DemoRun,
    req: ClientRequest,
    client: DemoRun['clients'][number] | undefined,
    result: string,
  ): Promise<number> {
    const hash = req.txHash ?? '';
    if (result !== 'tesSUCCESS') {
      await this.markJournal(req, 'failed', result);
      await this.releaseSeat(req);
      // The ledger refused it: the Amount never left the omnibus, so the drops
      // reserved before submitting go back to today's cap (it. 23, 1.4).
      await this.giveSpendBack(hash);
      return this.refuse(run, req, 'XRPL_' + result, `the ledger answered ${result} (${hash})`, true);
    }
    const drops = BigInt(req.drops);
    // A replay (journal) can finish the same payment twice: spend and movements
    // are idempotent per hash; the receipt is pushed only once — per CLIENT: a
    // receipt of the same hash booked to another client (the watcher followed a
    // re-pointed wallet) is not this client's debit.
    const hasReceipt = (step: string) =>
      run.receipts.some((r) => r.step === step && (r.txHash ?? '').toUpperCase() === hash.toUpperCase() && r.clientId === client?.id);
    if (req.kind === 'put-to-work') {
      await this.settleSpend(run, req, drops, hash, 'put-to-work');
      if (client && !hasReceipt('E5_PUT_TO_WORK')) {
        applyMovements(run, [{ kind: 'put-to-work', clientId: client.id, drops: req.drops, txHash: hash }]);
        run.receipts.push(makeReceipt(run, { step: 'E5_PUT_TO_WORK', chain: 'xrpl', txHash: hash, clientId: client.id, note: 'Autopilot (simulated exchange backend): 0xFE signed with the exchange key; the client signs nothing; shares to the client account.', expect: { drops: req.drops, receiver: client.passkeyAccount ?? '', pote: run.poteAddress ?? '', supplyUBA: req.supplyUBA ?? '' } }));
      }
      req.status = 'signed';
    } else {
      await this.settleSpend(run, req, drops, hash, 'payout');
      if (client && !hasReceipt('E8_WITHDRAW')) {
        applyMovements(run, [{ kind: 'withdraw', clientId: client.id, drops: req.drops, txHash: hash }]);
        run.receipts.push(makeReceipt(run, { step: 'E8_WITHDRAW', chain: 'xrpl', txHash: hash, clientId: client.id, note: 'Autopilot (simulated exchange backend): payout signed with the exchange key to the client own wallet.', expect: { drops: req.drops, to: client.xrplAddress ?? '' } }));
      }
      req.status = 'done';
    }
    await this.markJournal(req, 'settled');
    req.reason = undefined;
    req.lastLedgerSequence = undefined;
    req.submittedAtLedger = undefined;
    req.updatedAt = new Date().toISOString();
    this.fulfilled.push({ at: req.updatedAt, runId: run.runId, kind: req.kind, clientId: req.clientId, drops: req.drops, txHash: hash });
    return 1;
  }

  /** A 'submitting' request, one tick later: read the ledger, never sign again blind. */
  private async resolveSubmitting(run: DemoRun, req: ClientRequest): Promise<number> {
    // Without its hash and LastLedgerSequence a submission cannot be followed;
    // it stays put rather than be re-signed on a guess.
    // it. 31: y se DICE por qué se queda — antes reservaba en silencio para
    // siempre, sin frase ni alerta.
    if (!req.txHash || typeof req.lastLedgerSequence !== 'number') {
      this.noteUnfollowable(run, req);
      return 0;
    }
    const { lookupSubmission } = await import('./DemoExchangeSigner');
    const { resolveSubmission } = await import('./submissionVerdict');
    const { lookup, validatedLedgerIndex } = await lookupSubmission(req.txHash, req.submittedAtLedger, req.lastLedgerSequence);
    const verdict = resolveSubmission({ lookup, validatedLedgerIndex, lastLedgerSequence: req.lastLedgerSequence });
    const client = run.clients.find((c) => c.id === req.clientId);
    if (verdict.kind === 'settled') return this.finishSubmission(run, req, client, 'tesSUCCESS');
    if (verdict.kind === 'failed') return this.finishSubmission(run, req, client, verdict.code);
    if (verdict.kind === 'expired') {
      await this.markJournal(req, 'expired');
      await this.releaseSeat(req);
      // Proven dead (searched in full, past its LastLedgerSequence): the drops
      // reserved before submitting never left, so the cap gets them back
      // (it. 23, 1.4). This is also the path of a reservation whose blob was
      // never submitted at all (a write that failed after the journal).
      await this.giveSpendBack(req.txHash);
      const dead = req.txHash;
      req.status = 'pending';
      req.reason = `the signed payment ${dead} expired without entering a ledger (LastLedgerSequence ${req.lastLedgerSequence} passed, full range searched) — safe to sign again`;
      req.txHash = undefined;
      req.lastLedgerSequence = undefined;
      req.submittedAtLedger = undefined;
      req.memoHex = undefined;
      req.userOpHash = undefined;
      req.supplyUBA = undefined;
      req.updatedAt = new Date().toISOString();
      return 1;
    }
    return 0; // wait — in flight, not fully searched, or no node answered
  }

  /**
   * Frees the omnibus nonce seat of a 0xFE that was composed but NEVER signed
   * (an unreadable ledger, a signer that refused). Best-effort: the seat's own
   * LastLedgerSequence is the safety net.
   */
  private async releaseUnsignedSeat(memoHex: string | undefined): Promise<void> {
    if (!memoHex) return;
    try {
      const { releaseQueuedHandoffByMemo } = await import('../flare/DirectMintHandoffStore');
      // it. 19 — same reason as the desk's: the autopilot's 0xFE is signed here
      // with Astryum's own seed and was never handed to a wallet, so no twin can
      // come from freeing it at once (DirectMintHandoffStore.neverHandedOut).
      await releaseQueuedHandoffByMemo(memoHex, { neverHandedOut: true });
    } catch {
      /* the seat's LastLedgerSequence still ends it */
    }
  }

  /**
   * Signed-and-persisted, in this order: the durable JOURNAL first (no run save
   * can erase it), then the request fields, then the RUN, and only once the run
   * is stored, the nonce seat is marked signed.
   *
   * The seat is marked LAST on purpose (it. 14, R1 1.5): marking it first and
   * then failing the save (P2028 with `connection_limit=1`) left a seat declared
   * SIGNED — which no supersede may ever displace — holding a blob that was never
   * sent and that this loop could not follow. With this order a failed save
   * leaves a seat still bounded by its own window and a journal entry the next
   * tick replays; nothing is submitted until the run records it.
   */
  private async persistSubmission(
    run: DemoRun,
    req: ClientRequest,
    signed: { hash: string; lastLedgerSequence: number; submittedAtLedger: number },
    extra: { memoHex?: string; userOpHash?: string; supplyUBA?: string },
  ): Promise<void> {
    const { writeSubmission } = await import('./submissionJournal');
    await writeSubmission({
      requestId: req.id,
      runId: run.runId,
      kind: req.kind,
      clientId: req.clientId,
      drops: req.drops,
      txHash: signed.hash,
      lastLedgerSequence: signed.lastLedgerSequence,
      submittedAtLedger: signed.submittedAtLedger,
      memoHex: extra.memoHex,
      userOpHash: extra.userOpHash,
      supplyUBA: extra.supplyUBA,
      status: 'submitting',
      updatedAt: new Date().toISOString(),
    });
    beginSubmission(req, signed, extra);
    await saveRun(run);
    if (extra.memoHex) {
      const { markHandoffSignedByMemo } = await import('../flare/DirectMintHandoffStore');
      await markHandoffSignedByMemo(extra.memoHex, signed.hash);
    }
  }

  /** Best-effort status update of the journal entry of this request. */
  private async markJournal(req: ClientRequest, status: 'settled' | 'failed' | 'expired', code?: string): Promise<void> {
    try {
      const { readSubmission, writeSubmission } = await import('./submissionJournal');
      const entry = await readSubmission(req.id);
      if (!entry) return;
      await writeSubmission({ ...entry, status, code: code ?? entry.code, updatedAt: new Date().toISOString() });
    } catch {
      /* the ledger still decides on the next read */
    }
  }

  /** A 'pending' request the journal says was already signed: restore it and follow the ledger. */
  private async replayJournal(run: DemoRun, req: ClientRequest): Promise<number | null> {
    const { readSubmission } = await import('./submissionJournal');
    const { journalPlan } = await import('./submissionVerdict');
    const entry = await readSubmission(req.id);
    const plan = journalPlan(entry);
    if (plan === 'fulfil' || !entry) return null;
    // it. 31 — UN ENTRY MALFORMADO NO SE CONVIERTE EN UN 'submitting' SIN HASH.
    // Sin hash o sin ventana nadie puede seguirlo en el ledger ni probarlo
    // muerto; restaurarlo como 'submitting' lo dejaba reservando para siempre
    // y mudo. Se queda 'pending' con su motivo (no se firma: el journal dice
    // que algo se firmó) y suena en ops: esto lo reconcilia una persona.
    if (typeof entry.txHash !== 'string' || !entry.txHash || typeof entry.lastLedgerSequence !== 'number') {
      this.noteUnfollowable(run, req, entry);
      req.reason = `JOURNAL_ENTRY_MALFORMED: the submission journal says this request was signed but its entry has no hash or no LastLedgerSequence — it cannot be followed on the ledger nor signed again; an operator reconciles it by hand against the omnibus history and closes it (DELETE /api/demo-exchange/runs/:id/clients/:cid/requests/:rid?closeMalformed=1)`;
      req.updatedAt = new Date().toISOString();
      return 1;
    }
    req.txHash = entry.txHash;
    req.lastLedgerSequence = entry.lastLedgerSequence;
    req.submittedAtLedger = entry.submittedAtLedger;
    req.memoHex = entry.memoHex;
    req.userOpHash = entry.userOpHash;
    req.supplyUBA = entry.supplyUBA;
    const client = run.clients.find((c) => c.id === req.clientId);
    if (plan === 'finish-settled') return this.finishSubmission(run, req, client, 'tesSUCCESS');
    if (plan === 'finish-failed') return this.finishSubmission(run, req, client, entry.code ?? 'FAILED');
    req.status = 'submitting';
    req.reason = 'restored from the submission journal after a concurrent save — the ledger decides';
    req.updatedAt = new Date().toISOString();
    await this.resolveSubmitting(run, req);
    return 1;
  }

  /**
   * Frees the 0xFE nonce seat of a put-to-work that will never execute.
   * `markHandoffParkedByUserOpHash`, not `markHandoffsSuperseded`: the seat was
   * marked SIGNED before submitting, and the latter skips signed rows — which
   * left a dead payment holding the omnibus seat (iteration 3). Best-effort.
   */
  private async releaseSeat(req: ClientRequest): Promise<void> {
    if (!req.userOpHash) return;
    try {
      const { markHandoffParkedByUserOpHash } = await import('../flare/DirectMintHandoffStore');
      await markHandoffParkedByUserOpHash(req.userOpHash);
    } catch {
      /* the seat TTL still frees it */
    }
  }
}

/** Marks a request as signed-and-persisted, before its payment is submitted. */
function beginSubmission(
  req: ClientRequest,
  signed: { hash: string; lastLedgerSequence: number; submittedAtLedger: number },
  extra: { memoHex?: string; userOpHash?: string; supplyUBA?: string },
): void {
  req.status = 'submitting';
  req.txHash = signed.hash;
  req.lastLedgerSequence = signed.lastLedgerSequence;
  req.submittedAtLedger = signed.submittedAtLedger;
  req.memoHex = extra.memoHex;
  req.userOpHash = extra.userOpHash;
  req.supplyUBA = extra.supplyUBA;
  req.reason = undefined;
  req.updatedAt = new Date().toISOString();
}

export const demoExchangeAutopilot = new DemoExchangeAutopilot();
