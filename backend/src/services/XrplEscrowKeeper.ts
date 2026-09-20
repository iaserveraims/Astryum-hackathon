/**
 * XrplEscrowKeeper — el keeper de escrows propio (Ola 3 de la economía
 * agéntica; gate fundador §8.3 resuelto con la vía (a) de Legacy 2026-07-13).
 *
 * Taxonomía: EJECUTOR puro. EscrowFinish y EscrowCancel son PERMISSIONLESS en
 * XRPL — cualquiera puede enviarlos cuando el tiempo lo permite, y el ledger
 * decide a dónde va el XRP (Finish → SIEMPRE al Destination del escrow;
 * Cancel → SIEMPRE al Owner que lo creó). El keeper no puede desviar un drop:
 * dispara lo que cualquier tercero podría disparar, con SU PROPIA cuenta y su
 * propia fee (economía B — jamás capital de usuario).
 *
 * ── Frontera MiCA (leer antes de tocar) ──────────────────────────────────────
 * Este servicio FIRMA y TRANSMITE transacciones XRPL — las SUYAS. La seed de
 * XRPL_KEEPER_SEED es una cuenta operativa de Astryum (como la clave de gas
 * del executor 0xFE en Flare), JAMÁS una clave de usuario (invariante #1
 * intacto). No es "execution of orders on behalf of clients": no hay orden de
 * cliente — hay una operación permissionless cuyo resultado fija el ledger,
 * idéntico lo envíe Astryum, xrpl.services o un desconocido. La frontera
 * "Astryum never broadcasts" de MICA_BOUNDARIES §2.2 se refiere a TRANSACCIONES
 * DE USUARIO (las que mueven capital bajo autorización del usuario) y sigue
 * intacta: este módulo no toca XRPLProvider (que sigue lanzando
 * BROADCAST_FORBIDDEN) ni ningún carril prepare-only. Ver MICA_BOUNDARIES.md
 * §2 (nota del keeper) — actualizado en el mismo cambio que este archivo.
 *
 * ── Política determinista (cero discreción, reglas del ledger) ──────────────
 *   FinishAfter ≤ now < CancelAfter  y sin Condition → EscrowFinish
 *   now ≥ CancelAfter                                → EscrowCancel
 *   Condition presente                               → solo Cancel al expirar
 *     (el preimage lo custodia el consejo FUERA de Astryum — el backend no
 *     puede ni debe finalizar escrows condicionados)
 * El propio ledger hace de árbitro: Finish pasado CancelAfter y Cancel antes
 * de CancelAfter fallan con tecNO_PERMISSION.
 *
 * Config:
 *   XRPL_KEEPER_ENABLED=true         — flag (#10: nada sin flag)
 *   XRPL_KEEPER_SEED=s…              — cuenta PROPIA del keeper (paga sus fees);
 *                                      vale family seed o secret numbers de Xaman
 *   XRPL_KEEPER_ACCOUNTS=rA,rB       — cuentas cuyos escrows vigila
 *   XRPL_KEEPER_INTERVAL_MIN=60      — cadencia del tick
 *
 * Con el flag ENCENDIDO y la config rota (sin seed, seed que no abre cuenta, sin
 * cuentas válidas) el keeper NO arranca — pero tampoco se calla: avisa a ops y
 * late FALLANDO para el Sentinel. Ver `announceNotStarted` (G11).
 *
 * ── Atribución: estas tx van SIN el SourceTag del proyecto ──────────────────
 * Las firma una cuenta OPERATIVA de Astryum y las dispara un cron. Las bases
 * del Make Waves definen la unidad de actividad por el FIRMANTE — *«An Active
 * User means an XRPL address that has signed at least 1 transaction carrying
 * your Source Tag»* (T&C v1.0 §6) — y prohíben *«self-dealing, scripted
 * transactions or other forms of metric manipulation»* (§7) bajo pena de
 * descalificación. Etiquetar estas tx metería nuestra propia dirección en el
 * recuento de cuentas activas del proyecto: +1 dirección frente a un listón de
 * 300, a cambio de exponer el premio entero. Por eso los builders reciben
 * `attribution: 'operational'` (ver config/xrplSourceTag). La actividad real
 * del usuario ya está atribuida: el EscrowCreate lo firmó él, con tag.
 */

import { rippleTimeToISOTime } from 'xrpl';
import {
  buildEscrowCancel,
  buildEscrowFinish,
} from '../connectors/protocols/xrpl/XrplEscrowService';
import { xrplProvider } from '../integrations/providers/chain/XRPLProvider';
import { diagnoseXrplSecret } from '../utils/xrplSecret';
import { opsAlert } from './OpsAlertService';
import { markAgentTick } from './ops/agentHeartbeats';

const SOURCE = 'xrpl-escrow-keeper';
const AGENT_TITLE = 'Keeper de escrows XRPL';

/** tec codes that mean "ya no procede" — otro lo hizo o aún no toca. No son fallos. */
const BENIGN_TEC = new Set(['tecNO_TARGET', 'tecNO_PERMISSION', 'tecNO_ENTRY']);

export interface KeeperEscrow {
  owner: string;
  previousTxnID: string;
  finishAfter?: number; // ripple time
  cancelAfter?: number; // ripple time
  hasCondition: boolean;
}

export type KeeperAction = 'finish' | 'cancel' | null;

/**
 * La política, pura y testeable. `nowMs` en epoch ms; los tiempos del escrow
 * en ripple time (el offset lo resuelve rippleTimeToISOTime).
 */
export function decideEscrowAction(escrow: KeeperEscrow, nowMs: number): KeeperAction {
  const finishAtMs =
    escrow.finishAfter !== undefined ? Date.parse(rippleTimeToISOTime(escrow.finishAfter)) : undefined;
  const cancelAtMs =
    escrow.cancelAfter !== undefined ? Date.parse(rippleTimeToISOTime(escrow.cancelAfter)) : undefined;

  if (cancelAtMs !== undefined && nowMs >= cancelAtMs) return 'cancel';
  if (escrow.hasCondition) return null; // el preimage no vive aquí — solo cancel al expirar
  if (finishAtMs !== undefined && nowMs >= finishAtMs) return 'finish';
  return null;
}

function parseAccounts(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(s));
}

/**
 * Why a key does not open its account, carrying NO fragment of the key.
 *
 * xrpl.js echoes the offending character when base58 fails (`Unknown letter:
 * "-"`) and that character is a character OF THE SECRET. Invariant #2 (no
 * secret in logs, ever) does not have a "just one letter" exception, and this
 * reason travels to the log, to the ops inbox and to Discord. Our own codes
 * (`XRPL_SECRET_NUMBERS_*`) only name formats and group positions, so they pass
 * through — they are the actionable ones; anything else collapses to a fixed
 * phrase that still tells the operator what to look at.
 */
export function safeSeedReason(error: string | undefined): string {
  if (error && /^XRPL_SECRET_NUMBERS_/.test(error)) return error;
  return 'no es un family seed (s…) legible ni unos secret numbers de Xaman';
}

export class XrplEscrowKeeper {
  private timer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  /** Escrows ya resueltos (o descartados como benignos) en este proceso. */
  private done = new Set<string>();
  private lastRunAt: Date | null = null;
  private submitted: Array<{ action: string; owner: string; txHash: string; at: string }> = [];
  /** Por qué NO arrancó teniendo el flag encendido. null = o corre, o está apagado a propósito. */
  private notStartedReason: string | null = null;
  private alarmTimer: NodeJS.Timeout | null = null;

  /** La cadencia esperada del tick, en ms — la misma que se le promete al Sentinel. */
  private intervalMs(): number {
    return Math.max(Number(process.env.XRPL_KEEPER_INTERVAL_MIN || 60), 5) * 60_000;
  }

  start(): void {
    if (this.timer || this.alarmTimer) return;
    if (process.env.XRPL_KEEPER_ENABLED !== 'true') {
      // Silencio POR DISEÑO: un carril apagado por flag no puede echarse de menos.
      console.log('[xrpl-escrow-keeper] apagado (XRPL_KEEPER_ENABLED != true)');
      return;
    }
    if (!process.env.XRPL_KEEPER_SEED) {
      this.announceNotStarted(
        'XRPL_KEEPER_ENABLED=true pero falta XRPL_KEEPER_SEED — el keeper NO arrancó',
        'Pon XRPL_KEEPER_SEED en Railway (family seed s… o los secret numbers de Xaman de la cuenta PROPIA del ' +
          'keeper, la que paga sus fees) y redespliega. Si ya no quieres el keeper, apágalo de verdad con ' +
          'XRPL_KEEPER_ENABLED=false: así el aviso se calla sin mentir.',
      );
      return;
    }
    // La seed se valida AQUÍ, no el día que haya un escrow que vencer: derivar la
    // cuenta es la única prueba de que esta clave puede firmar algo (ver xrplSecret,
    // donde formato y algoritmo ya han mordido). La cuenta es dato público; la
    // clave no sale ni en el error (safeSeedReason).
    const seed = diagnoseXrplSecret(process.env.XRPL_KEEPER_SEED);
    if (!seed.address) {
      this.announceNotStarted(
        `XRPL_KEEPER_SEED no abre ninguna cuenta (formato leído: ${seed.format}; ${safeSeedReason(seed.error)}) — ` +
          'el keeper NO arrancó',
        'Revisa XRPL_KEEPER_SEED en Railway: se acepta el family seed (s…) o los 8 grupos de 6 dígitos de Xaman. ' +
          'El panel de admin del executor tiene el mismo diagnóstico para la clave del anchor si quieres comparar.',
      );
      return;
    }
    if (parseAccounts(process.env.XRPL_KEEPER_ACCOUNTS).length === 0) {
      this.announceNotStarted(
        'XRPL_KEEPER_ENABLED=true pero XRPL_KEEPER_ACCOUNTS no trae ninguna dirección r… válida — el keeper NO arrancó',
        'Pon en XRPL_KEEPER_ACCOUNTS las cuentas cuyos escrows se vigilan, separadas por comas (rA,rB). ' +
          'Si ya no quieres el keeper, apágalo con XRPL_KEEPER_ENABLED=false.',
      );
      return;
    }
    const everyMs = this.intervalMs();
    this.bootTimer = setTimeout(() => void this.tick(), 45_000); // no compite con el boot
    if (typeof this.bootTimer.unref === 'function') this.bootTimer.unref();
    this.timer = setInterval(() => void this.tick(), everyMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    console.log(
      `[xrpl-escrow-keeper] keeper permissionless en marcha desde ${seed.address} — tick cada ${everyMs / 60_000}min`,
    );
  }

  /**
   * G11 (auditoría 2026-08-17) — the operator asked for it and it did not run.
   *
   * WHAT FAILED IN SILENCE: with XRPL_KEEPER_ENABLED=true but no seed, an
   * unusable seed or no valid accounts, start() did a console.error and RETURNED
   * WITHOUT EVER CALLING markAgentTick. agentHeartbeats watches only agents that
   * announced themselves at least once — "you cannot miss what never said it was
   * there" — a rule written for rails switched OFF BY FLAG. Here the flag is ON,
   * so the keeper was indistinguishable from a rail nobody turned on: intent and
   * reality diverged with nothing but one boot line in the logs, and an escrow
   * that should have been finished (XRP to the Destination) or cancelled (XRP
   * back to the Owner) could sit unattended for weeks with every gauge green.
   *
   * THE SIGNAL, and why it is not just one alert:
   *  · opsAlert once, at boot → ops inbox (persisted) + Discord, naming the env
   *    var to fix. A log line is not a signal: nobody reads logs on a good day.
   *  · a FAILING heartbeat that keeps beating on the keeper's own cadence → the
   *    Sentinel `agentes` probe reports it as failing and escalates to critical
   *    after 3 beats, for as long as the misconfiguration lasts. It MUST be
   *    refreshed: a single stale heartbeat would trip the probe's other branch
   *    and claim "su ciclo se ha parado — reinicia el servicio", which is false
   *    (the cycle never started; a restart fixes nothing). Being loud is not
   *    enough — the reason has to be true too.
   *  · `timer` stays null on purpose: the keeper is NOT running and must not
   *    look like it is. Only the alarm beats; nothing here signs anything.
   */
  private announceNotStarted(reason: string, runbook: string): void {
    console.error(`[${SOURCE}] ${reason}`);
    this.notStartedReason = reason;
    this.beatNotStarted();
    this.alarmTimer = setInterval(() => this.beatNotStarted(), this.intervalMs());
    if (typeof this.alarmTimer.unref === 'function') this.alarmTimer.unref();
    // Nunca puede tumbar el arranque del proceso: opsAlert ya se traga sus fallos,
    // el .catch es el cinturón por si un día deja de hacerlo.
    void opsAlert(SOURCE, 'warn', reason, {
      key: 'no-arranca',
      runbook,
      facts: { flag: 'XRPL_KEEPER_ENABLED=true', arrancado: false },
    }).catch(() => undefined);
  }

  /** El latido de la divergencia: el operador lo quiso encendido y no corre. */
  private beatNotStarted(): void {
    if (!this.notStartedReason) return;
    markAgentTick(SOURCE, {
      title: AGENT_TITLE,
      everyMs: this.intervalMs(),
      ok: false,
      detail: this.notStartedReason,
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.alarmTimer) clearInterval(this.alarmTimer);
    this.timer = null;
    this.bootTimer = null;
    this.alarmTimer = null;
    this.notStartedReason = null;
  }

  async tick(): Promise<void> {
    this.lastRunAt = new Date();
    const accounts = parseAccounts(process.env.XRPL_KEEPER_ACCOUNTS);
    const failed: string[] = [];
    for (const account of accounts) {
      try {
        await this.sweepAccount(account);
      } catch (e) {
        failed.push(`${account}: ${(e as Error).message}`);
        console.error(`[xrpl-escrow-keeper] sweep de ${account} falló: ${(e as Error).message}`);
      }
    }
    // Latido para el Sentinel (2026-08-03): este keeper avisaba de lo que hacía,
    // pero no de que seguía vivo. Si su ciclo se para, nadie lo notaba.
    try {
      markAgentTick(SOURCE, {
        title: AGENT_TITLE,
        everyMs: this.intervalMs(),
        ok: failed.length === 0,
        ...(failed.length > 0 ? { detail: failed.join(' · ') } : {}),
      });
    } catch {
      /* el latido nunca puede tumbar el tick que lo emite */
    }
  }

  private async sweepAccount(account: string): Promise<void> {
    const positions = await xrplProvider.getDeFiPositions(account);
    const now = Date.now();
    for (const p of positions) {
      if (p.type !== 'escrow') continue;
      const d = p.details as {
        owner?: string;
        previousTxnID?: string;
        finishAfter?: number;
        cancelAfter?: number;
        hasCondition?: boolean;
      };
      if (!d.owner || !d.previousTxnID || this.done.has(d.previousTxnID)) continue;
      const escrow: KeeperEscrow = {
        owner: d.owner,
        previousTxnID: d.previousTxnID,
        finishAfter: d.finishAfter,
        cancelAfter: d.cancelAfter,
        hasCondition: d.hasCondition === true,
      };
      const action = decideEscrowAction(escrow, now);
      if (!action) continue;
      await this.execute(action, escrow);
    }
  }

  /** Firma con la cuenta PROPIA del keeper y transmite. Nunca claves de usuario. */
  private async execute(action: 'finish' | 'cancel', escrow: KeeperEscrow): Promise<void> {
    const seed = process.env.XRPL_KEEPER_SEED;
    if (!seed) return; // start() ya lo exige; guard por si el env cambió en caliente

    const offerSequence = await xrplProvider.getEscrowCreateSequence(escrow.previousTxnID);
    if (offerSequence === null) {
      this.done.add(escrow.previousTxnID); // sin secuencia no hay tx que componer
      return;
    }

    const { Client } = await import('xrpl');
    const { xrplWalletFromSecret } = await import('../utils/xrplSecret');
    // NUNCA Wallet.fromSeed suelto: xrpl.js 4.5 deriva ed25519 por defecto y con
    // una seed secp256k1 (la de Xaman) firmaría desde OTRA cuenta. Ver xrplSecret.
    const wallet = xrplWalletFromSecret(seed);
    const build = action === 'finish' ? buildEscrowFinish : buildEscrowCancel;
    const { xrplTx } = build({
      account: wallet.classicAddress,
      owner: escrow.owner,
      offerSequence,
      // Cuenta propia + cron ⇒ jamás el tag del proyecto (cabecera §Atribución).
      attribution: 'operational',
    });

    const client = new Client(process.env.XRPL_WS_URL || 'wss://xrplcluster.com', {
      connectionTimeout: 10_000,
    });
    try {
      await client.connect();
      const prepared = await client.autofill(xrplTx as never);
      const signed = wallet.sign(prepared);
      const res = await client.submitAndWait(signed.tx_blob);
      const result = (res.result.meta as { TransactionResult?: string })?.TransactionResult ?? '?';
      if (result === 'tesSUCCESS') {
        this.done.add(escrow.previousTxnID);
        this.submitted.push({
          action,
          owner: escrow.owner,
          txHash: res.result.hash,
          at: new Date().toISOString(),
        });
        await opsAlert(
          SOURCE,
          'info',
          `Escrow${action === 'finish' ? ' liberado (Finish → Destination)' : ' cancelado (Cancel → Owner)'} de ${escrow.owner} — tx ${res.result.hash}`,
        );
      } else if (BENIGN_TEC.has(result)) {
        // Otro keeper llegó antes o la ventana aún no abre en el reloj del
        // ledger — permissionless significa exactamente esto. No es un fallo.
        this.done.add(escrow.previousTxnID);
        console.log(`[xrpl-escrow-keeper] ${action} de ${escrow.previousTxnID} → ${result} (benigno, se descarta)`);
      } else {
        await opsAlert(
          SOURCE,
          'warn',
          `${action} del escrow ${escrow.previousTxnID} devolvió ${result} — revisar (se reintenta en el próximo tick)`,
        );
      }
    } finally {
      await client.disconnect().catch(() => undefined);
    }
  }

  status(): {
    /** Lo que el operador PIDIÓ (el flag), no lo que pasa. */
    enabled: boolean;
    /** Lo que de verdad corre. `enabled && !running` es la divergencia de G11. */
    running: boolean;
    /** El motivo cuando el flag está encendido y no corre; null si no aplica. */
    notStartedReason: string | null;
    lastRunAt: string | null;
    resolvedCount: number;
    submitted: Array<{ action: string; owner: string; txHash: string; at: string }>;
  } {
    return {
      enabled: process.env.XRPL_KEEPER_ENABLED === 'true',
      running: this.timer !== null,
      notStartedReason: this.notStartedReason,
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      resolvedCount: this.done.size,
      submitted: [...this.submitted],
    };
  }
}

export const xrplEscrowKeeper = new XrplEscrowKeeper();
