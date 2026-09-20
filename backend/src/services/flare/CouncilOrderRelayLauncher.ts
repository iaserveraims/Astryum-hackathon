/**
 * CouncilOrderRelayLauncher — the ONE place a council-order relay starts.
 *
 * Two callers share it: POST /xrpl-defi/council-order/relay (the live
 * ceremony) and POST /council/proposals/:id/submitted (the async inbox). The
 * incident — an order validated on XRPL that never executed on
 * Flare because the browser was the only trigger — is why the launch lives
 * server-side: once the broadcast is reported, the relay no longer depends on
 * any browser staying open.
 */

import { kvDelete, kvList, kvListStrict, kvUpsert } from '../persistence/backgroundJobKv';

export interface CouncilRelayState {
  state: 'relaying' | 'executed' | 'error';
  detail?: string;
  flareTxHash?: string;
  /** El puente ya va por delante de esta orden: no se reintenta, hay que componerla de nuevo. */
  stale?: boolean;
}

// In-memory per XRPL tx — UI enrichment only; the on-chain consumedTxId read
// stays the settlement truth (see /council-order/status).
const relayState = new Map<string, CouncilRelayState>();
// When THIS process last started a relay for a tx (ms). Feeds the in-flight guard.
const launchedAtByHash = new Map<string, number>();

/**
 * PERSISTED list of orders whose relay was launched and has not been seen
 * executed. This memory is what makes the delivery survive us: the in-process
 * map dies with the process, so a backend restart mid-round — or a launch that
 * exhausted its retries — used to leave a quorum-signed order waiting for a
 * human to notice an alert and press a button.
 */
const PENDING_JOB = 'legacy-order-pending';
/**
 * Las órdenes ABANDONADAS: el puente ya no puede ejecutarlas (nonce superado).
 * Persistente, porque el vigía re-adopta desde la bandeja (`emittedCouncilOrders`)
 * cualquier orden emitida en 14 días — sin esta lista volvería a la cola en la
 * siguiente pasada.
 */
const ABANDONED_JOB = 'legacy-order-abandoned';

/** The FDC only attests transactions younger than 14 days. Past that the order
 *  cannot be delivered at all and the council has to sign again — so the
 *  watcher stops trying and says so ONCE, loudly, well before the deadline. */
const FDC_ATTESTATION_WINDOW_MS = 14 * 86_400_000;
const WARN_BEFORE_DEADLINE_MS = 3 * 86_400_000;

interface PendingOrder extends Record<string, unknown> {
  xrplTxHash: string;
  orderData?: string;
  firstSeenAt: string;
  attempts: number;
  lastDetail?: string;
}

/**
 * UN PARPADEO DE LA BASE NO PUEDE REJUVENECER UNA ORDEN.
 *
 * Esta función leía con `kvList`, que es BLANDO: se traga el error y devuelve
 * `[]`. Con la base caída un instante, `existing` salía `undefined` y la fila se
 * reescribía como si la orden fuese nueva — `firstSeenAt` volvía a «ahora»,
 * `attempts` a 1, y `orderData` se caía del payload porque su único respaldo era
 * justo ese `existing`.
 */
async function rememberPending(hash: string, orderData?: string): Promise<void> {
  let existing: PendingOrder | undefined;
  try {
    existing = (await kvListStrict(PENDING_JOB, 500)).find((r) => r.xrplTxHash === hash) as
      | PendingOrder
      | undefined;
  } catch (e) {
    console.error(
      `[legacy-relay] no se pudo leer la lista de pendientes para ${hash}: ${(e as Error)?.message ?? e} — ` +
        'no se reescribe la fila (reescribirla reiniciaría firstSeenAt y con él la ventana del FDC)',
    );
    try {
      const { opsAlert } = await import('../OpsAlertService');
      await opsAlert(
        'legacy-relay',
        'warn',
        `no pude leer la lista de órdenes pendientes al registrar ${hash}: esta pasada no persiste nada`,
        {
          key: `relay-remember-unreadable:${hash}`,
          facts: { xrplTxHash: hash },
          runbook:
            'El relé de esta orden sigue vivo en este proceso y el vigía la re-adopta desde la bandeja con su ' +
            'fecha real. Si esto se repite, mirar la base: el riesgo NO es perder la orden, es que su reloj de ' +
            '14 días del FDC vuelva a empezar.',
        },
      );
    } catch {
      /* el canal nunca empeora el fallo que reporta */
    }
    return;
  }
  await kvUpsert(PENDING_JOB, 'xrplTxHash', hash, {
    xrplTxHash: hash,
    ...(orderData ? { orderData } : existing?.orderData ? { orderData: existing.orderData } : {}),
    firstSeenAt: existing?.firstSeenAt ?? new Date().toISOString(),
    attempts: (existing?.attempts ?? 0) + 1,
  });
}

async function forgetPending(hash: string): Promise<void> {
  await kvDelete(PENDING_JOB, 'xrplTxHash', hash);
}

async function rememberAbandoned(hash: string, detail: string): Promise<void> {
  try {
    await kvUpsert(ABANDONED_JOB, 'xrplTxHash', hash, { xrplTxHash: hash, detail, abandonedAt: new Date().toISOString() });
  } catch (e) {
    console.error(`[legacy-relay] no se pudo anotar la orden abandonada ${hash}: ${(e as Error)?.message ?? e}`);
  }
}

async function abandonedHashes(): Promise<Set<string>> {
  try {
    const rows = await kvList(ABANDONED_JOB, 500);
    return new Set(rows.map((r) => String(r.xrplTxHash ?? '').toUpperCase()).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Un veredicto del puente (RelayStale) — por forma, porque los tests simulan el módulo del relé. */
function isStaleVerdict(e: unknown): e is Error & { stale: true } {
  return !!e && typeof e === 'object' && (e as { stale?: unknown }).stale === true;
}

/**
 * Answers that mean "not yet", never "no".
 *
 * Two different clocks lag behind the ledger and both say something that reads
 * like a verdict:
 *  · the XRPL node — "the tx is not validated yet" (seconds);
 *  · the FDC VERIFIER — `INVALID: TRANSACTION DOES NOT EXIST`, because it
 *    answers from its OWN index of XRPL, which is minutes behind. A council order validated at 15:04 was refused by the verifier
 *    at 15:05 with those words, and the relay gave up on a transaction that
 *    was sitting on mainnet with its three signatures.
 */
const RETRYABLE_PATTERNS = [
  /not validated yet/i,
  /TRANSACTION DOES NOT EXIST/i,
  /prepareRequest failed/i, // verifier hiccup — never a statement about the tx
];

function isWaitNotVerdict(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? '');
  return RETRYABLE_PATTERNS.some((re) => re.test(msg));
}

export function getCouncilOrderRelayState(xrplTxHash: string): CouncilRelayState | null {
  return relayState.get(xrplTxHash.toUpperCase()) ?? null;
}

/**
 * Start (or join) the fire-and-forget relay for one signed council order.
 * Idempotent: a hash already relaying is never launched twice, and the relay
 * itself answers 'already-executed' for consumed orders — a duplicate launch
 * can never re-pay the FDC fee.
 */
export function launchCouncilOrderRelay(
  xrplTxHash: string,
  orderDataOverride?: string,
  opts?: { waitMs?: number; maxAttempts?: number },
): { started: boolean; state: 'relaying' } {
  const key = xrplTxHash.toUpperCase();
  // The XRPL side settles in seconds; the FDC verifier's index takes minutes.
  // The window covers the slow one — an order that waits is still an order.
  const waitMs = opts?.waitMs ?? 15_000;
  const maxAttempts = opts?.maxAttempts ?? 40; // ~10 min of "not yet" before giving up
  if (relayState.get(key)?.state === 'relaying') return { started: false, state: 'relaying' };
  relayState.set(key, { state: 'relaying' });
  launchedAtByHash.set(key, Date.now());
  void rememberPending(key, orderDataOverride); // sobrevive al proceso
  void (async () => {
    try {
      const { relayCouncilOrder, RelayAbort } = await import('./LegacyOrderRelayService');
      for (let attempt = 1; ; attempt++) {
        try {
          const out = await relayCouncilOrder({
            xrplTxHash,
            ...(orderDataOverride ? { orderDataOverride } : {}),
          });
          relayState.set(key, {
            state: 'executed',
            ...(out.flareTxHash ? { flareTxHash: out.flareTxHash } : {}),
          });
          void forgetPending(key); // entregada: deja de reintentarse
          return;
        } catch (e) {
          const notYet = e instanceof RelayAbort && isWaitNotVerdict(e);
          if (!notYet || attempt >= maxAttempts) throw e;
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }
    } catch (e) {
      const detail = String((e as Error)?.message ?? e).slice(0, 500);
      if (isStaleVerdict(e)) {
        // VEREDICTO, no espera: el puente ya va por delante de esta orden. Se
        // deja de reintentar para siempre y se dice como tarea humana — hay que
        // componerla de nuevo y firmarla.
        relayState.set(key, { state: 'error', detail, stale: true });
        void forgetPending(key);
        void rememberAbandoned(key, detail);
        try {
          const { opsAlert } = await import('../OpsAlertService');
          await opsAlert(
            'legacy-relay',
            'critical',
            `la orden del consejo ${key} ya no se puede ejecutar: ${detail}`,
            {
              key: `relay-stale:${key}`,
              facts: { xrplTxHash: key },
              runbook:
                'El puente ya ejecutó otra orden de esta cuenta antes que ésta (o era un duplicado firmado dos veces). ' +
                'No se reintenta más. Hay que COMPONER LA ORDEN DE NUEVO desde la mesa y firmarla; el XRP de la orden ' +
                'caducada ya está gastado y el capital no se ha movido.',
            },
          );
        } catch {
          /* el canal nunca puede empeorar el fallo que está reportando */
        }
        return;
      }
      relayState.set(key, { state: 'error', detail });
      // La orden SIGUE en la lista de pendientes: el vigía de abajo la volverá
      // a intentar sola. El aviso es información, no una tarea — nadie tiene
      // que pulsar nada para que se entregue.
      try {
        const { opsAlert } = await import('../OpsAlertService');
        await opsAlert(
          'legacy-relay',
          'warn',
          `el relé de la orden del consejo ${key} no ha podido entregarla todavía: ${detail}`,
          {
            key: `relay-error:${key}`,
            facts: { xrplTxHash: key },
            runbook:
              'No hay que hacer nada: el vigía la reintenta solo cada 5 min mientras el FDC pueda atestiguarla ' +
              '(14 días desde la firma), y reutiliza la attestation ya pagada. Solo te avisaré otra vez si se acerca ' +
              'ese plazo — entonces sí haría falta que el consejo volviera a firmar. El XRP del consejo no se ha movido.',
          },
        );
      } catch {
        /* el canal nunca puede empeorar el fallo que está reportando */
      }
    }
  })();
  return { started: true, state: 'relaying' };
}

/**
 * Las órdenes del consejo EMITIDAS desde la bandeja, dentro de la ventana del
 * FDC. Fuente independiente del proceso: sobrevive a reinicios y a despliegues
 * (una orden emitida antes de que existiera este vigía se recupera igual).
 * Best-effort — sin DB devuelve nada y el vigía se apoya solo en su lista.
 */
async function emittedCouncilOrders(): Promise<Array<{ hash: string; at: string }>> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const { prisma } = await import('../../database/prismaClient');
    const since = new Date(Date.now() - FDC_ATTESTATION_WINDOW_MS);
    const rows = await prisma.councilProposal.findMany({
      where: { status: 'submitted', txHash: { not: null }, updatedAt: { gte: since } },
      select: { txHash: true, txjson: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    return rows
      .filter((r) => r.txHash && /^[0-9A-F]{64}$/i.test(r.txHash) && isCouncilOrderPayment(r.txjson))
      .map((r) => ({ hash: String(r.txHash).toUpperCase(), at: r.updatedAt.toISOString() }));
  } catch (e) {
    console.error(`[legacy-relay] no se pudo leer las propuestas emitidas: ${(e as Error).message}`);
    return [];
  }
}

/**
 * El vigía que hace que nadie tenga que pulsar nada.
 *
 * Recorre las órdenes lanzadas y aún no consumidas por el puente y las vuelve
 * a lanzar. Cubre los tres huecos que dejaba el lanzamiento solo:
 *   · el backend se reinició a media ronda (el estado vivía en memoria),
 *   · el lanzamiento agotó sus reintentos (verifier lento de más),
 *   · nadie tenía la pestaña abierta cuando falló.
 *
 * Barato y seguro: la verdad es `consumedTxId` on-chain, el relé es idempotente
 * y una attestation ya pagada se reutiliza — reintentar no cuesta fee nueva.
 * Se rinde SOLO cuando el FDC ya no puede atestiguar (14 días), y ahí sí avisa
 * como tarea humana: hay que volver a firmar.
 */
export async function retryPendingCouncilOrders(): Promise<{ checked: number; relaunched: number; recovered?: number }> {
  // Primero, las órdenes COMPUESTAS para firma simple cuyo relé nadie lanzó (la
  // pantalla que firmaba se cerró o se recargó): si el ledger ya las validó, se
  // lanzan aquí y desde ese momento las vigila la lista de pendientes de abajo.
  let recovered = 0;
  try {
    recovered = (await sweepComposedCouncilOrders()).launched;
  } catch (e) {
    console.error(`[legacy-relay] barrido de órdenes compuestas falló: ${(e as Error)?.message ?? e}`);
  }
  const rows = (await kvList(PENDING_JOB, 200)) as PendingOrder[];
  // Además de lo que este proceso lanzó, las órdenes EMITIDAS desde la bandeja:
  // están en la tabla de propuestas con su hash, así que una orden anterior a
  // este vigía —o emitida por otra instancia— también se recupera sola. Sin
  // esto, el arreglo solo valdría para las órdenes futuras.
  for (const p of await emittedCouncilOrders()) {
    if (!rows.some((r) => String(r.xrplTxHash).toUpperCase() === p.hash)) {
      rows.push({ xrplTxHash: p.hash, firstSeenAt: p.at, attempts: 0 });
    }
  }
  if (rows.length === 0) return { checked: 0, relaunched: 0, recovered };

  // Las abandonadas no vuelven a la cola aunque la bandeja las traiga (nonce
  // superado: el puente jamás las ejecutará).
  const abandoned = await abandonedHashes();
  let relaunched = 0;
  const { ethers } = await import('ethers');
  const { legacyStackConfig } = await import('../../connectors/protocols/xrpl/XrplCouncilOrderService');
  // El puente del env es solo un ATAJO para el corto-circuito «ya consumida»
  // — vale para las órdenes del consejo fundacional. Para una orden de un
  // Legacy nacido del factory este puente responde false y simplemente se
  // relanza: el relé resuelve el puente correcto por el REMITENTE y contesta
  // 'already-executed' él mismo (idempotente, sin fee nueva). Y sin env stack
  // (instalación solo-factory) el vigía SIGUE relanzando en vez de rendirse.
  let bridge: { consumedTxId: (id: string) => Promise<boolean> } | null = null;
  try {
    const cfg = legacyStackConfig();
    bridge = new ethers.Contract(
      cfg.bridge,
      ['function consumedTxId(bytes32) view returns (bool)'],
      new ethers.JsonRpcProvider(cfg.rpcUrl),
    ) as unknown as NonNullable<typeof bridge>;
  } catch {
    bridge = null; // sin stack env — el corto-circuito no aplica, el relé decide
  }

  for (const row of rows) {
    const hash = String(row.xrplTxHash ?? '');
    if (!/^[0-9A-F]{64}$/i.test(hash)) {
      await forgetPending(hash);
      continue;
    }
    if (abandoned.has(hash.toUpperCase())) {
      await forgetPending(hash);
      continue;
    }
    // Verdad on-chain primero: si ya está consumida, deja de vigilarla.
    // (Solo el puente del env — un false aquí no es veredicto para órdenes de
    // otros Legacies; su verdad la da el relé al resolver por remitente.)
    if (bridge) {
      try {
        if (await bridge.consumedTxId(('0x' + hash).toLowerCase())) {
          relayState.set(hash, { state: 'executed' });
          await forgetPending(hash);
          continue;
        }
      } catch {
        continue; // Flare ilegible ahora mismo — se reintenta en la próxima pasada
      }
    }

    const age = Date.now() - Date.parse(String(row.firstSeenAt ?? ''));
    if (Number.isFinite(age) && age > FDC_ATTESTATION_WINDOW_MS) {
      await forgetPending(hash);
      try {
        const { opsAlert } = await import('../OpsAlertService');
        await opsAlert(
          'legacy-relay',
          'critical',
          `la orden del consejo ${hash} ya no se puede entregar: el FDC solo atestigua transacciones de menos de 14 días`,
          {
            key: `relay-expired:${hash}`,
            facts: { xrplTxHash: hash, intentos: row.attempts ?? 0 },
            runbook:
              'Esto SÍ necesita a la familia: hay que componer la orden de nuevo y que el quórum la firme. ' +
              'El capital no se ha movido y la fee de orden de la anterior ya está gastada.',
          },
        );
      } catch {
        /* el canal nunca empeora el fallo que reporta */
      }
      continue;
    }
    if (
      Number.isFinite(age) &&
      age > FDC_ATTESTATION_WINDOW_MS - WARN_BEFORE_DEADLINE_MS
    ) {
      try {
        const { opsAlert } = await import('../OpsAlertService');
        await opsAlert(
          'legacy-relay',
          'warn',
          `la orden del consejo ${hash} lleva ${Math.floor(age / 86_400_000)} días sin entregarse; el FDC deja de poder atestiguarla a los 14`,
          {
            key: `relay-deadline:${hash}`,
            facts: { xrplTxHash: hash, intentos: row.attempts ?? 0 },
            runbook: 'Sigo reintentando solo. Si llega al día 14 habrá que volver a firmarla con el quórum.',
          },
        );
      } catch {
        /* idem */
      }
    }

    if (relayState.get(hash)?.state === 'relaying') continue; // ya está en ello
    launchCouncilOrderRelay(hash, typeof row.orderData === 'string' ? row.orderData : undefined);
    relaunched++;
  }
  return { checked: rows.length, relaunched, recovered };
}

/**
 * EL VIGÍA DE LAS ÓRDENES COMPUESTAS — la entrega que ya no depende
 * de que la pantalla que firmó siga abierta.
 */
export async function sweepComposedCouncilOrders(opts?: {
  now?: number;
  rpc?: import('./ComposedCouncilOrderStore').AccountTxRpc;
}): Promise<{ checked: number; launched: number; forgotten: number }> {
  const out = { checked: 0, launched: 0, forgotten: 0 };
  const executorOn = process.env.FLARE_EXECUTOR_ENABLED === 'true';
  const store = await import('./ComposedCouncilOrderStore');
  type Rec = import('./ComposedCouncilOrderStore').ComposedCouncilOrder;
  const now = opts?.now ?? Date.now();
  await store.pruneComposedOrderFates(now);
  const records = await store.listComposedCouncilOrders();
  out.checked = records.length;
  if (records.length === 0) return out;

  const forget = async (
    r: Rec,
    fate?: { state: 'executed' | 'failed'; xrplTxHash?: string; detail?: string },
  ): Promise<void> => {
    // The fate goes FIRST: if the forget then loses its CAS (a re-composition), the
    // live record still wins every read; a forgotten record without a fate would
    // answer 'unknown' to someone deciding whether to compose again.
    if (fate) {
      await store.rememberComposedOrderFate({
        memoHex: r.memoHex,
        council: r.council,
        state: fate.state,
        ...(fate.xrplTxHash ? { xrplTxHash: fate.xrplTxHash } : {}),
        ...(fate.detail ? { detail: fate.detail } : {}),
        at: new Date(now).toISOString(),
        // Lo que la orden ERA viaja con su destino, para que la guarda de
        // duplicados siga viendo «esta orden ya salió» cuando el registro ya no está.
        ...(r.action ? { action: r.action } : {}),
        ...(r.contentKey ? { contentKey: r.contentKey } : {}),
        ...(r.launchedAt ? { launchedAt: r.launchedAt } : {}),
      });
    }
    if (await store.forgetComposedCouncilOrder(r)) out.forgotten++;
  };

  const byCouncil = new Map<string, Rec[]>();
  for (const r of records) {
    const list = byCouncil.get(r.council) ?? [];
    list.push(r);
    byCouncil.set(r.council, list);
  }

  for (const [council, group] of byCouncil) {
    const unfound: Rec[] = [];
    for (const r of group) {
      const age = now - Date.parse(r.composedAt);
      if (!Number.isFinite(age) || age > store.COMPOSED_ORDER_TTL_MS) {
        await forget(r);
        continue;
      }
      if (r.launchedXrplTxHash) {
        const hash = r.launchedXrplTxHash.toUpperCase();
        const st = relayState.get(hash)?.state;
        if (st === 'executed') {
          await forget(r, { state: 'executed', xrplTxHash: hash });
        } else if (!executorOn) {
          // Validada y esperando al relayer: ni se entrega ni se olvida.
          continue;
        } else if (st !== 'relaying') {
          // Reinicio o error agotado: el relé es idempotente y reusa la attestation.
          launchCouncilOrderRelay(hash, r.orderData);
          out.launched++;
        }
        continue;
      }
      unfound.push(r);
    }
    if (unfound.length === 0) continue;

    const from = Math.min(
      ...unfound.map((r) =>
        r.scannedThroughLedger && r.scannedThroughLedger >= r.composedLedgerIndex
          ? r.scannedThroughLedger + 1
          : r.composedLedgerIndex,
      ),
    );
    let scan: Awaited<ReturnType<typeof store.scanCouncilPayments>>;
    try {
      scan = await store.scanCouncilPayments(council, { ledgerIndexMin: from }, opts?.rpc);
    } catch (e) {
      // «No pude leer» no es «no está»: ni se lanza ni se olvida nada.
      console.error(`[legacy-relay] account_tx de ${council} ilegible: ${(e as Error)?.message ?? e}`);
      continue;
    }

    for (const r of unfound) {
      const hits = scan.matches.filter((m) => m.memoHex === r.memoHex);
      const ok = hits.find((m) => m.result === 'tesSUCCESS');
      if (ok) {
        const hash = ok.hash.toUpperCase();
        const st = relayState.get(hash)?.state;
        if (!executorOn) {
          console.log(`[legacy-relay] orden compuesta ${r.memoHex.slice(0, 12)}… validada en ${hash} — el relayer está apagado: marcada, sin entregar`);
        } else if (st !== 'relaying' && st !== 'executed') {
          launchCouncilOrderRelay(hash, r.orderData);
          out.launched++;
          console.log(`[legacy-relay] orden compuesta ${r.memoHex.slice(0, 12)}… validada en ${hash} — relé lanzado sin navegador`);
        }
        // CAS: if the record changed meanwhile, the next pass finds the same hit again
        // (the relay is idempotent, and 'relaying' is never launched twice).
        await store.updateComposedCouncilOrder(
          { ...r, launchedXrplTxHash: hash, launchedAt: new Date(now).toISOString() },
          r,
        );
        continue;
      }
      const unreadable = hits.filter((m) => !store.isReadableResult(m.result));
      if (unreadable.length > 0) {
        // Una entrada del memo SIN resultado legible: no es un tec, es «no pude leerla».
        // Ni se olvida ni se avanza por encima de ella: la próxima pasada la relee.
        const known = unreadable.map((m) => m.ledgerIndex).filter((li): li is number => typeof li === 'number');
        if (known.length > 0) {
          const through = Math.min(scan.searchedThroughLedger, Math.min(...known) - 1);
          if (through >= r.composedLedgerIndex && through > (r.scannedThroughLedger ?? 0)) {
            await store.updateComposedCouncilOrder({ ...r, scannedThroughLedger: through }, r);
          }
        }
        continue;
      }
      if (hits.length > 0) {
        // Validada con fallo (tec*): aplicó, gastó su asiento; el puente no tiene nada que ejecutar.
        await forget(r, {
          state: 'failed',
          xrplTxHash: hits[0].hash.toUpperCase(),
          detail: `validated with ${hits[0].result}: the order applied without effect, nothing reaches Flare`,
        });
        continue;
      }
      if (r.lastLedgerSequence !== null && scan.searchedThroughLedger >= r.lastLedgerSequence) {
        // Su ventana entera está leída y no está: esta orden ya no puede entrar en ningún ledger.
        await forget(r, {
          state: 'failed',
          detail: `its ledger window (LastLedgerSequence ${r.lastLedgerSequence}) closed without it: it can never validate`,
        });
        continue;
      }
      if ((r.scannedThroughLedger ?? 0) < scan.searchedThroughLedger) {
        await store.updateComposedCouncilOrder({ ...r, scannedThroughLedger: scan.searchedThroughLedger }, r);
      }
    }
  }
  return out;
}

/* ── After a 'stale' verdict: is the order already on its way? ────────────── */

/** A launched order not seen executed within this window counts as in flight. */
export const COUNCIL_ORDER_IN_FLIGHT_WINDOW_MS = 30 * 60_000;

/** The window in which composing the SAME order again is treated as a double. */
export const SAME_ORDER_WINDOW_MS = 30 * 60_000;

export interface RecentSameOrder {
  memoHex: string;
  xrplTxHash: string;
  /** ISO time the server saw it validated on the XRP Ledger. */
  launchedAt: string;
  /**
   * Where its delivery to Flare stands: 'executed' is NOT safety, it is the danger.
   * 'error' is told apart from 'relaying' — a delivery that did not
   * finish is a RECOVERY, and telling that person «composing it again would move the
   * capital a second time» describes the opposite of what happened.
   */
  state: 'validated' | 'relaying' | 'executed' | 'error';
  action?: string;
}

/**
 * THE DUPLICATE GUARD LOOKS AT THE ORDER,
 * NOT AT ITS RELAY.
 */
export async function recentSameCouncilOrder(
  council: string,
  contentKey: string,
  opts?: { now?: number },
): Promise<RecentSameOrder | null> {
  if (!council || !contentKey) return null;
  const now = opts?.now ?? Date.now();
  const store = await import('./ComposedCouncilOrderStore');
  let best: (RecentSameOrder & { at: number }) | null = null;
  const consider = (candidate: RecentSameOrder, at: number) => {
    if (!Number.isFinite(at) || now - at >= SAME_ORDER_WINDOW_MS || now - at < -60_000) return;
    if (!best || at > best.at) best = { ...candidate, at };
  };

  try {
    for (const r of await store.listComposedCouncilOrdersForCouncil(council, { contentKey })) {
      if (!r.launchedXrplTxHash || !r.launchedAt) continue;
      const hash = r.launchedXrplTxHash.toUpperCase();
      const relay = relayState.get(hash)?.state;
      consider(
        {
          memoHex: r.memoHex,
          xrplTxHash: hash,
          launchedAt: r.launchedAt,
          state: relay === 'executed' ? 'executed' : relay === 'error' ? 'error' : relay === 'relaying' ? 'relaying' : 'validated',
          ...(r.action ? { action: r.action } : {}),
        },
        Date.parse(r.launchedAt),
      );
    }
  } catch (e) {
    console.error(`[legacy-relay] duplicate read for ${council} failed: ${(e as Error)?.message ?? e}`);
    return null;
  }

  try {
    // The sweep FORGETS an executed order: without its fate the guard would go blind
    // precisely on the orders that already moved capital.
    for (const f of await store.listComposedOrderFatesForCouncil(council, { contentKey })) {
      if (f.state !== 'executed' || !f.xrplTxHash) continue;
      const at = Date.parse(String(f.launchedAt ?? f.at));
      consider(
        {
          memoHex: f.memoHex,
          xrplTxHash: String(f.xrplTxHash).toUpperCase(),
          launchedAt: new Date(at).toISOString(),
          state: 'executed',
          ...(f.action ? { action: String(f.action) } : {}),
        },
        at,
      );
    }
  } catch (e) {
    console.error(`[legacy-relay] duplicate fate read for ${council} failed: ${(e as Error)?.message ?? e}`);
  }
  if (!best) return null;
  const { at: _at, ...rest } = best as RecentSameOrder & { at: number };
  void _at;
  return rest;
}

/**
 * THE COMPOSE DOOR WAS BLIND FOR FIVE MINUTES.
 *
 * `recentSameCouncilOrder` only sees what the SWEEP marked: a record grows
 * `launchedXrplTxHash` / `launchedAt` when the background scan finds its Payment on
 * XRPL, and that scan runs every five minutes. Inside that window — precisely the
 * minutes in which a family re-composes after a stalled QR — the guard answered «no
 * duplicate» about an order that was already on the ledger and on its way to Flare.
 */
export const LEDGER_DUP_MAX_MEMOS = 3;

export async function ledgerDuplicateCheck(
  council: string,
  contentKey: string,
  opts?: {
    now?: number;
    /** The fate budget's key — the same one `GET /council-order/fate` uses (a session). */
    sessionKey?: string;
    read?: typeof readCouncilOrderFateLimited;
    list?: (typeof import('./ComposedCouncilOrderStore'))['listComposedCouncilOrdersForCouncil'];
  },
): Promise<{ recent: RecentSameOrder | null; unreadable: string | null; retryAfterSeconds?: number }> {
  if (!council || !contentKey) return { recent: null, unreadable: null };
  const now = opts?.now ?? Date.now();
  let records: Awaited<ReturnType<(typeof import('./ComposedCouncilOrderStore'))['listComposedCouncilOrdersForCouncil']>>;
  try {
    const list = opts?.list ?? (await import('./ComposedCouncilOrderStore')).listComposedCouncilOrdersForCouncil;
    records = await list(council, { contentKey });
  } catch (e) {
    return {
      recent: null,
      unreadable: `the record of this council's recent orders could not be read (${(e as Error)?.message ?? e})`,
    };
  }
  const candidates = records
    .filter((r) => !r.launchedXrplTxHash && r.contentKey === contentKey)
    .map((r) => ({ r, at: Date.parse(r.composedAt) }))
    .filter((c) => Number.isFinite(c.at) && now - c.at < SAME_ORDER_WINDOW_MS && now - c.at > -60_000)
    .sort((a, b) => b.at - a.at)
    .slice(0, LEDGER_DUP_MAX_MEMOS);
  if (candidates.length === 0) return { recent: null, unreadable: null };

  const read = opts?.read ?? readCouncilOrderFateLimited;
  // ── THE COMPOSE READS HAVE THEIR OWN ALLOWANCE ────────
  //
  // The budget is per SESSION KEY, and the routes hand this check the very key the
  // screen's `GET /council-order/fate` polling spends: a page that polls a couple of
  // orders exhausts it, and then the duplicate check of a COMPOSE cannot run — which
  // is precisely when the same order is about to go out twice. Prefixing the key
  // gives composing its own allowance, so the UI's polling can never spend the reads
  // this guard needs (and vice versa: a compose loop cannot blind the fate screen).
  const sessionKey = `compose:${opts?.sessionKey ?? council}`;
  let unreadable: string | null = null;
  /**
   * WHEN the check could run again. The commonest reason this
   * read fails is our OWN allowance (`CouncilOrderFateRateLimitedError`), and it
   * knows exactly how many seconds are left — the number that turns «the manager is
   * blocked for about a minute with no button» into a countdown the screen can show
   * beside «Compose another order anyway». It was being thrown away in the string.
   */
  let retryAfterSeconds: number | undefined;
  for (const { r, at } of candidates) {
    let fate: CouncilOrderFate;
    try {
      fate = await read(r.memoHex, sessionKey);
    } catch (e) {
      const after = (e as { retryAfterSeconds?: unknown })?.retryAfterSeconds;
      if (typeof after === 'number' && Number.isFinite(after) && after > 0) {
        retryAfterSeconds = Math.max(retryAfterSeconds ?? 0, Math.ceil(after));
      }
      unreadable = `the XRP Ledger could not be checked for an order composed ${Math.max(
        0,
        Math.round((now - at) / 60_000),
      )} min ago (${(e as Error)?.message ?? e})`;
      continue;
    }
    if (fate.state === 'validated' || fate.state === 'relaying' || fate.state === 'executed') {
      return {
        recent: {
          memoHex: r.memoHex,
          xrplTxHash: (fate.xrplTxHash ?? '').toUpperCase(),
          // The sweep has not stamped `launchedAt` yet, so the composition time is the
          // honest anchor for «how long ago»: it is never later than the validation.
          launchedAt: r.composedAt,
          state: fate.state,
          ...(r.action ? { action: r.action } : {}),
        },
        unreadable: null,
      };
    }
  }
  return { recent: null, unreadable, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) };
}

export type CouncilDuplicateVerdict =
  | { proceed: true; duplicateWarning: string | null; recent: RecentSameOrder | null }
  | {
      proceed: false;
      status: 409;
      body:
        | { error: 'SAME_ORDER_RECENTLY_LAUNCHED'; detail: string; xrplTxHash: string; memoHex: string; launchedAt: string; state: string }
        /**
         * The check itself could not run (the fate budget is
         * spent, the node is down, the store threw). A NON-exit does not pass as
         * «checked»; the caller is told what happened and offered the one escape a
         * person can take: `confirmAnotherOrder`.
         */
        | {
            error: 'DUPLICATE_CHECK_UNREADABLE';
            detail: string;
            retryable: true;
            confirmAnotherOrder: true;
            /**
             * Seconds until the check can run again, when the
             * reason it could not run is OUR OWN read allowance. Present only then —
             * a store that threw has no schedule, and inventing one would be a
             * promise. The screen shows it as a countdown beside the two real exits
             * («Try again» and «Compose another order anyway»).
             */
            retryAfterSeconds?: number;
          };
    };

/**
 * WHAT A SECOND ORDER WOULD ACTUALLY DO.
 *
 * «Composing it again would move the capital a second time» was served for every
 * repeat, and for two families of order it is simply false:
 *   · actions that move NO capital — `set-user-gate` (who may enter), `cede` and
 *     `end-cession` (who holds a delegated authority). Applying them twice changes
 *     nothing about anybody's money; the cost is a signature and an FDC round.
 *   · a delivery sitting in `error`: that order did NOT arrive, and the person
 *     re-composing is RECOVERING it. Telling them they are about to double-spend
 *     describes the opposite of what happened, and pushes them away from the one
 *     thing that works (relaying the order that is already on the ledger).
 */
const NON_CAPITAL_COUNCIL_ACTIONS: ReadonlySet<string> = new Set(['set-user-gate', 'cede', 'end-cession']);

export function duplicateOrderSentence(recent: RecentSameOrder, minutes: number, action?: string): string {
  const where = `This account already signed THIS SAME order ${minutes} min ago and it is on the XRP Ledger (${recent.xrplTxHash}`;
  if (recent.state === 'error') {
    return (
      `${where}). Its delivery to Flare did not finish, and the server retries it on its own — that order is what has ` +
      'to arrive, so composing a second one is not how it is recovered: relay that one by its hash, or wait. If you ' +
      'really want another order like it, confirm it.'
    );
  }
  const executed = recent.state === 'executed' ? ', already executed on Flare' : '';
  if (action && NON_CAPITAL_COUNCIL_ACTIONS.has(action)) {
    return (
      `${where}${executed}). This order moves no capital, so a second one would not move it twice — it would apply the ` +
      'same change again, at the cost of another signature and another FDC round. Check how that one ended first; if ' +
      'you really want another order like it, confirm it.'
    );
  }
  return (
    `${where}${executed}). Composing it again would move the capital a second time. Check how that one ended first; ` +
    'if you really want another order like it, confirm it.'
  );
}

/**
 * The verdict both compose doors share. A NON-exit repeating an order that already
 * went out is refused 409 `SAME_ORDER_RECENTLY_LAUNCHED` unless the caller sends
 * `confirmAnotherOrder: true` — a person saying «yes, I want a second one». An EXIT
 * always proceeds and only carries `duplicateWarning`: «LA SALIDA JAMÁS SE GATEA»,
 * and bringing capital back twice takes nothing from the holder.
 */
export async function councilDuplicateOrderVerdict(input: {
  council: string;
  contentKey: string;
  isExit: boolean;
  /** The action being composed (copy): what the second order would actually do. */
  action?: string;
  confirmAnotherOrder?: boolean;
  now?: number;
  /** Injectable so a route's tests can stand in for the store read. */
  find?: typeof recentSameCouncilOrder;
  /**
   * The ledger half of the question, for the minutes the sweep has not
   * covered. `null` disables it (a caller that has already asked).
   */
  ledgerCheck?: typeof ledgerDuplicateCheck | null;
  /** The fate budget's key for that ledger read (a session). */
  sessionKey?: string;
}): Promise<CouncilDuplicateVerdict> {
  const find = input.find ?? recentSameCouncilOrder;
  let recent = await find(input.council, input.contentKey, { now: input.now });
  let unreadable: string | null = null;
  let retryAfterSeconds: number | undefined;
  if (!recent && input.ledgerCheck !== null) {
    const checked = await (input.ledgerCheck ?? ledgerDuplicateCheck)(input.council, input.contentKey, {
      ...(input.now !== undefined ? { now: input.now } : {}),
      ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
    });
    recent = checked.recent;
    unreadable = checked.unreadable;
    const after = (checked as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    if (typeof after === 'number' && Number.isFinite(after) && after > 0) retryAfterSeconds = Math.ceil(after);
  }
  if (!recent) {
    if (unreadable) {
      // ── «NO PUDE COMPROBARLO» NO ES «COMPROBADO» ──────
      //
      // WHAT SHIPPED: a failed check came back as a WARNING and the order was
      // composed. On the exact scenario this guard exists for — the family
      // re-composing minutes after a stalled QR, with the fate budget already spent
      // by the screen's own polling — the second order went out with a sentence
      // nobody had to acknowledge. A duplicate that moves capital twice is not a
      // warning-shaped risk.
      const line =
        `${unreadable}. So this door cannot promise that the same order did not already go out minutes ago — check ` +
        'the account on an explorer, or check the order you last composed, before signing.';
      if (input.isExit || input.confirmAnotherOrder === true) {
        return { proceed: true, duplicateWarning: `DUPLICATE_CHECK_UNREADABLE: ${line}`, recent: null };
      }
      return {
        proceed: false,
        status: 409,
        body: {
          error: 'DUPLICATE_CHECK_UNREADABLE',
          detail:
            'The check for an identical order already on its way could not be run: ' +
            `${line} Nothing was composed. ` +
            (retryAfterSeconds
              ? `That check has its own read allowance and it is spent: it can run again in ${retryAfterSeconds}s. `
              : '') +
            'Try again in a moment, or compose it anyway if you know this order has not gone out.',
          retryable: true,
          confirmAnotherOrder: true,
          ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
        },
      };
    }
    return { proceed: true, duplicateWarning: null, recent: null };
  }
  const minutes = Math.max(0, Math.round(((input.now ?? Date.now()) - Date.parse(recent.launchedAt)) / 60_000));
  const detail = duplicateOrderSentence(recent, minutes, input.action ?? recent.action);
  if (input.isExit) return { proceed: true, duplicateWarning: detail, recent };
  if (input.confirmAnotherOrder === true) return { proceed: true, duplicateWarning: null, recent };
  return {
    proceed: false,
    status: 409,
    body: {
      error: 'SAME_ORDER_RECENTLY_LAUNCHED',
      detail,
      xrplTxHash: recent.xrplTxHash,
      memoHex: recent.memoHex,
      launchedAt: recent.launchedAt,
      state: recent.state,
    },
  };
}

/**
 * ⛔ SUPERSEDED by `recentSameCouncilOrder` (finding 2.2) and no longer
 * asked by any compose door — kept, never deleted: it is the only reader of the
 * in-process `launchedAtByHash` map and the shape the tests pin.
 *
 * THE DOUBLE ORDER AFTER 'stale'. Payload A
 * validates and is relayed; payload B (same seat) dies tefPAST_SEQ; «prepare it
 * again» composes C with the NEXT nonce — the capital moves twice. This answers,
 * for one council, the most recent order whose relay was LAUNCHED less than 30 min
 * ago and has not been seen executed. Best-effort: an unreadable store answers
 * null (the composition's own record step refuses a non-exit when the database is
 * down).
 */
export async function councilOrderInFlight(
  council: string,
  opts?: { now?: number },
): Promise<{ memoHex: string; xrplTxHash: string; launchedAt: string; relay: CouncilRelayState | null } | null> {
  const now = opts?.now ?? Date.now();
  const store = await import('./ComposedCouncilOrderStore');
  let records: Awaited<ReturnType<typeof store.listComposedCouncilOrdersForCouncil>>;
  try {
    records = await store.listComposedCouncilOrdersForCouncil(council);
  } catch (e) {
    console.error(`[legacy-relay] in-flight read for ${council} failed: ${(e as Error)?.message ?? e}`);
    return null;
  }
  let best: { memoHex: string; xrplTxHash: string; launchedAt: string; relay: CouncilRelayState | null; at: number } | null = null;
  for (const r of records) {
    if (!r.launchedXrplTxHash) continue;
    const hash = r.launchedXrplTxHash.toUpperCase();
    const relay = relayState.get(hash) ?? null;
    if (relay?.state === 'executed') continue;
    const at = r.launchedAt ? Date.parse(r.launchedAt) : launchedAtByHash.get(hash) ?? NaN;
    if (!Number.isFinite(at) || now - at >= COUNCIL_ORDER_IN_FLIGHT_WINDOW_MS || now - at < -60_000) continue;
    if (!best || at > best.at) best = { memoHex: r.memoHex, xrplTxHash: hash, launchedAt: new Date(at).toISOString(), relay, at };
  }
  if (!best) return null;
  const { at: _at, ...rest } = best;
  void _at;
  return rest;
}

export type CouncilOrderFateState = 'unknown' | 'composed' | 'validated' | 'relaying' | 'executed' | 'failed';

export interface CouncilOrderFate {
  memo: string;
  state: CouncilOrderFateState;
  xrplTxHash?: string;
  detail?: string;
}

/** «Could not read» — the route answers 503, never 'unknown'. */
export class CouncilOrderFateUnreadableError extends Error {
  readonly code = 'COUNCIL_ORDER_FATE_UNREADABLE';
  constructor(detail: string) {
    super(detail);
    this.name = 'CouncilOrderFateUnreadableError';
  }
}

/** Pages of `account_tx` one fate read may spend (a GET must stay bounded). */
export const FATE_SCAN_MAX_PAGES = 5;

/**
 * The fate of one composed order, by its memo:
 *  · the live record, launched → the relay state (executed / relaying), or
 *    'validated' when this process holds no relay state for it;
 *  · the live record, not launched → a BOUNDED `account_tx` read from the ledger
 *    it was composed on: tesSUCCESS → validated; tec* → failed; window closed or
 *    its pinned Sequence already spent without it → failed; otherwise composed;
 *  · no record → the fate the sweep left when it forgot it; none → 'unknown'.
 * Any read that fails — the store, the fate, the ledger, an entry without a
 * readable result, a history longer than the bound — throws
 * `CouncilOrderFateUnreadableError`. Read-only: it launches nothing.
 */
export async function readCouncilOrderFate(
  memoHex: string,
  opts?: { rpc?: import('./ComposedCouncilOrderStore').AccountTxRpc },
): Promise<CouncilOrderFate> {
  const memo = memoHex.trim().replace(/^0x/i, '').toUpperCase();
  const store = await import('./ComposedCouncilOrderStore');
  const rpc =
    opts?.rpc ??
    (async (method: string, params: Record<string, unknown>) => {
      const { xrplJsonRpc } = await import('./DirectMintExecutorService');
      return (await xrplJsonRpc(method, params, undefined, { requireFresh: true })) as Record<string, unknown>;
    });

  let record: Awaited<ReturnType<typeof store.getComposedCouncilOrderStrict>>;
  try {
    record = await store.getComposedCouncilOrderStrict(memo);
  } catch (e) {
    throw new CouncilOrderFateUnreadableError(`the order memory could not be read: ${(e as Error)?.message ?? e}`);
  }

  const fromRelay = (hash: string): CouncilOrderFate | null => {
    const st = relayState.get(hash);
    if (st?.state === 'executed') return { memo, state: 'executed', xrplTxHash: hash };
    if (st?.state === 'relaying') return { memo, state: 'relaying', xrplTxHash: hash };
    if (st?.state === 'error') {
      return {
        memo,
        state: 'relaying',
        xrplTxHash: hash,
        detail: `the last delivery attempt did not finish (${st.detail ?? 'no detail'}); the server retries it on its own`,
      };
    }
    return null;
  };

  if (!record) {
    let fate: Awaited<ReturnType<typeof store.readComposedOrderFateStrict>>;
    try {
      fate = await store.readComposedOrderFateStrict(memo);
    } catch (e) {
      throw new CouncilOrderFateUnreadableError(`the order fate could not be read: ${(e as Error)?.message ?? e}`);
    }
    if (!fate) return { memo, state: 'unknown' };
    return {
      memo,
      state: fate.state,
      ...(fate.xrplTxHash ? { xrplTxHash: fate.xrplTxHash } : {}),
      ...(fate.detail ? { detail: fate.detail } : {}),
    };
  }

  if (record.launchedXrplTxHash) {
    const hash = record.launchedXrplTxHash.toUpperCase();
    return (
      fromRelay(hash) ?? {
        memo,
        state: 'validated',
        xrplTxHash: hash,
        // With the relayer off the server is NOT delivering it — saying so is
        // the difference between «wait» and «nothing is coming unless you relay it».
        detail:
          process.env.FLARE_EXECUTOR_ENABLED === 'true'
            ? 'validated on the XRP Ledger; the server delivers it to Flare'
            : 'validated on the XRP Ledger; the delivery relayer is OFF on this server, so it waits — relay it by hash, or wait until the relayer is on (within the 14-day FDC window)',
      }
    );
  }

  // For a pinned single-sign order, the account's Sequence read BEFORE the scan
  // tells whether its seat is already spent (by the ledger the scan then covers).
  let seat: { sequence: number; ledger: number } | null = null;
  if (record.lastLedgerSequence !== null) {
    try {
      const info = await rpc('account_info', { account: record.council, ledger_index: 'validated' });
      const sequence = Number((info.account_data as { Sequence?: unknown } | undefined)?.Sequence);
      const ledger = Number(info.ledger_index);
      if (info.validated !== false && Number.isSafeInteger(sequence) && Number.isSafeInteger(ledger)) seat = { sequence, ledger };
    } catch {
      seat = null; // only a refinement: without it the scan still decides
    }
  }

  let scan: Awaited<ReturnType<typeof store.scanCouncilPayments>>;
  try {
    scan = await store.scanCouncilPayments(
      record.council,
      { ledgerIndexMin: record.composedLedgerIndex, maxPages: FATE_SCAN_MAX_PAGES },
      rpc,
    );
  } catch (e) {
    throw new CouncilOrderFateUnreadableError(`the account history could not be read: ${(e as Error)?.message ?? e}`);
  }
  const hits = scan.matches.filter((m) => m.memoHex === memo);
  const ok = hits.find((m) => m.result === 'tesSUCCESS');
  if (ok) {
    const hash = ok.hash.toUpperCase();
    return (
      fromRelay(hash) ?? {
        memo,
        state: 'validated',
        xrplTxHash: hash,
        detail: 'validated on the XRP Ledger; the server delivers it to Flare',
      }
    );
  }
  if (hits.some((m) => !store.isReadableResult(m.result))) {
    throw new CouncilOrderFateUnreadableError('the ledger returned this order without a readable result');
  }
  if (hits.length > 0) {
    return {
      memo,
      state: 'failed',
      xrplTxHash: hits[0].hash.toUpperCase(),
      detail: `validated with ${hits[0].result}: the order applied without effect, nothing reaches Flare`,
    };
  }
  if (record.lastLedgerSequence !== null && scan.searchedThroughLedger >= record.lastLedgerSequence) {
    return { memo, state: 'failed', detail: 'its ledger window closed without it: it can never validate' };
  }
  if (seat && seat.sequence > record.sequence && scan.searchedThroughLedger >= seat.ledger) {
    return {
      memo,
      state: 'failed',
      detail: 'its Sequence was used by another transaction and it is not on the ledger: it can never validate',
    };
  }
  if (!scan.exhausted) {
    throw new CouncilOrderFateUnreadableError('the account history since this order was composed is longer than one bounded read');
  }
  return { memo, state: 'composed', detail: 'not on the validated ledger yet' };
}

/* ── The fate read, bounded (finding 2.5) ─────────────────────────── */

/** One CHAIN read per memo per this window; everyone else gets the cached answer. */
export const FATE_CACHE_MS = 15_000;
/** An unreadable answer is cached briefly too: a dead node must not be hammered. */
export const FATE_ERROR_CACHE_MS = 5_000;
/** Chain reads one session may cause per minute, across memos. */
export const FATE_READS_PER_SESSION_PER_MIN = 12;
const FATE_SESSION_WINDOW_MS = 60_000;

export class CouncilOrderFateRateLimitedError extends Error {
  readonly code = 'COUNCIL_ORDER_FATE_RATE_LIMITED';
  constructor(readonly retryAfterSeconds: number) {
    super(
      `Too many fate checks from this session in the last minute (the limit is ${FATE_READS_PER_SESSION_PER_MIN}). ` +
        `Nothing was read and nothing changed — try again in ${retryAfterSeconds}s. A repeated answer is served from ` +
        'cache for 15s, so a screen that polls does not need to ask more often than that.',
    );
    this.name = 'CouncilOrderFateRateLimitedError';
  }
}

type FateCacheEntry = { at: number; value?: CouncilOrderFate; error?: Error; pending?: Promise<CouncilOrderFate> };
const fateCache = new Map<string, FateCacheEntry>();
const fateSessionReads = new Map<string, number[]>();

/** Tests (and only tests) start from a clean limiter. */
export function _resetCouncilOrderFateLimiter(): void {
  fateCache.clear();
  fateSessionReads.clear();
}

function pruneFateMaps(now: number): void {
  if (fateCache.size > 2_000) {
    for (const [k, v] of fateCache) if (now - v.at > FATE_CACHE_MS && !v.pending) fateCache.delete(k);
  }
  if (fateSessionReads.size > 2_000) {
    for (const [k, v] of fateSessionReads) if (v.every((t) => now - t > FATE_SESSION_WINDOW_MS)) fateSessionReads.delete(k);
  }
}

/**
 * `GET /council-order/fate` behind a budget. The read costs an `account_info` plus
 * up to five `account_tx` pages on a FRESH node, and it was open to any session at
 * any rate: one loop could push the XRPL node into 429 and take the pins down with
 * it (finding 2.5).
 *
 * Two bounds, both in memory:
 *   · per MEMO: one chain read per `FATE_CACHE_MS`; concurrent askers join the same
 *     in-flight promise, later ones get the cached answer (an unreadable answer is
 *     cached for 5s and re-thrown, so «could not read» is still never «unknown»);
 *   · per SESSION: `FATE_READS_PER_SESSION_PER_MIN` chain reads a minute, after
 *     which the answer is 429 — never a wrong verdict.
 */
export async function readCouncilOrderFateLimited(
  memoHex: string,
  sessionKey: string,
  opts?: {
    now?: number;
    rpc?: import('./ComposedCouncilOrderStore').AccountTxRpc;
    /** Injectable so a route's tests can stand in for the read itself. */
    read?: typeof readCouncilOrderFate;
  },
): Promise<CouncilOrderFate> {
  const now = opts?.now ?? Date.now();
  const key = memoHex.trim().replace(/^0x/i, '').toUpperCase();
  pruneFateMaps(now);

  const cached = fateCache.get(key);
  if (cached?.pending) return cached.pending;
  if (cached && cached.value && now - cached.at < FATE_CACHE_MS) return cached.value;
  if (cached && cached.error && now - cached.at < FATE_ERROR_CACHE_MS) throw cached.error;

  const session = sessionKey || 'anonymous';
  const recent = (fateSessionReads.get(session) ?? []).filter((t) => now - t < FATE_SESSION_WINDOW_MS);
  if (recent.length >= FATE_READS_PER_SESSION_PER_MIN) {
    fateSessionReads.set(session, recent);
    const oldest = Math.min(...recent);
    throw new CouncilOrderFateRateLimitedError(Math.max(1, Math.ceil((FATE_SESSION_WINDOW_MS - (now - oldest)) / 1_000)));
  }
  recent.push(now);
  fateSessionReads.set(session, recent);

  const read = opts?.read ?? readCouncilOrderFate;
  const pending = (async () => {
    try {
      const value = opts?.rpc ? await read(memoHex, { rpc: opts.rpc }) : await read(memoHex);
      // Stamped with the clock of the CALL, the same one the freshness check uses.
      fateCache.set(key, { at: now, value });
      return value;
    } catch (e) {
      fateCache.set(key, { at: now, error: e as Error });
      throw e;
    }
  })();
  fateCache.set(key, { at: now, pending });
  return pending;
}

/**
 * Is this pinned txjson a council order? A council order is a Payment to the
 * configured order anchor carrying exactly one 32-byte memo (the keccak256 of
 * the committed bytes). Best-effort: an unset legacy stack means "not an
 * order", never an exception — the /submitted report must not fail on this.
 */
export function isCouncilOrderPayment(txjson: unknown): boolean {
  try {
    const tx = txjson as {
      TransactionType?: unknown;
      Destination?: unknown;
      Memos?: Array<{ Memo?: { MemoData?: unknown } }>;
    };
    if (!tx || tx.TransactionType !== 'Payment') return false;
    // Lazy require so merely loading this module never throws on an unset stack.
    // The anchor is NETWORK-level (shared by every Legacy's orders), so this
    // works without a deployed env stack — a factory-only install included.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { legacyNetworkConfig } = require('../../connectors/protocols/xrpl/XrplCouncilOrderService');
    if (tx.Destination !== legacyNetworkConfig().orderAnchor) return false;
    const memo = tx.Memos?.[0]?.Memo?.MemoData;
    return typeof memo === 'string' && /^[0-9A-Fa-f]{64}$/.test(memo);
  } catch {
    return false;
  }
}
