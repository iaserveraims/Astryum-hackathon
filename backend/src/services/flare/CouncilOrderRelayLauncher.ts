/**
 * CouncilOrderRelayLauncher — the ONE place a council-order relay starts.
 *
 * Two callers share it: POST /xrpl-defi/council-order/relay (the live
 * ceremony) and POST /council/proposals/:id/submitted (the async inbox). The
 * 2026-07-29 incident — an order validated on XRPL that never executed on
 * Flare because the browser was the only trigger — is why the launch lives
 * server-side: once the broadcast is reported, the relay no longer depends on
 * any browser staying open.
 *
 * The launcher also absorbs the broadcast→validation gap: a browser reports
 * the hash seconds before the ledger validates the tx, and the relay rightly
 * answers "not validated yet". That answer is a WAIT, not a verdict — the
 * launcher retries for a bounded window before surfacing the error state.
 */

import { kvDelete, kvList, kvUpsert } from '../persistence/backgroundJobKv';

export interface CouncilRelayState {
  state: 'relaying' | 'executed' | 'error';
  detail?: string;
  flareTxHash?: string;
}

// In-memory per XRPL tx — UI enrichment only; the on-chain consumedTxId read
// stays the settlement truth (see /council-order/status).
const relayState = new Map<string, CouncilRelayState>();

/**
 * PERSISTED list of orders whose relay was launched and has not been seen
 * executed. This memory is what makes the delivery survive us: the in-process
 * map dies with the process, so a backend restart mid-round — or a launch that
 * exhausted its retries — used to leave a quorum-signed order waiting for a
 * human to notice an alert and press a button (founder, 2026-08-03: "si es un
 * botón para que el user lo arregle solo, no debe de ser así").
 */
const PENDING_JOB = 'legacy-order-pending';

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

async function rememberPending(hash: string, orderData?: string): Promise<void> {
  const existing = (await kvList(PENDING_JOB, 500)).find((r) => r.xrplTxHash === hash) as
    | PendingOrder
    | undefined;
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

/**
 * Answers that mean "not yet", never "no".
 *
 * Two different clocks lag behind the ledger and both say something that reads
 * like a verdict:
 *  · the XRPL node — "the tx is not validated yet" (seconds);
 *  · the FDC VERIFIER — `INVALID: TRANSACTION DOES NOT EXIST`, because it
 *    answers from its OWN index of XRPL, which is minutes behind. On
 *    2026-08-03 a council order validated at 15:04 was refused by the verifier
 *    at 15:05 with those words, and the relay gave up on a transaction that
 *    was sitting on mainnet with its three signatures.
 *
 * Treating either as final is the same mistake the 31-jul `txnNotFound`
 * incident taught: only an authority that CAN see the transaction gets to say
 * it is wrong.
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
export async function retryPendingCouncilOrders(): Promise<{ checked: number; relaunched: number }> {
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
  if (rows.length === 0) return { checked: 0, relaunched: 0 };

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
  return { checked: rows.length, relaunched };
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
