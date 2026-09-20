/**
 * availableBalance — what a client of the demo exchange can still ask the
 * omnibus to pay, given what is already IN FLIGHT. Pure: no RPC, no DB.
 */

import { deskPaymentsOf, movementKey, requestsOf, type ClientRequest, type DemoRun, type DeskPayment } from './DemoExchangeStore';

const ZERO = BigInt(0);

export interface LedgerView {
  /**
   * The validated ledger index read BEFORE the omnibus scan whose results are in
   * `run`. Only with it may a prepared withdraw close by its LastLedgerSequence:
   * a payment that could still enter a ledger the scan did not cover must keep
   * reserving. Absent = no ledger closes anything.
   */
  validatedLedgerIndex?: number;
  /**
   * Prepared withdraws whose EXHAUSTIVE omnibus read over their ledger window
   * proved the payment absent (deskPaymentProof.proveDeskPayouts). Past its
   * LastLedgerSequence alone a payout is NOT closed: a page-capped scan can miss
   * a validated payout and the client would be paid again.
   */
  payoutsProvenAbsent?: ReadonlySet<string>;
}

function applied(run: DemoRun, kind: 'withdraw' | 'put-to-work', txHash?: string): boolean {
  if (!txHash) return false;
  return (run.appliedTxHashes ?? []).includes(movementKey(kind, txHash));
}

/**
 * Las dos direcciones en las que puede pedirse el dinero de un cliente: una
 * ENTRADA (`put-to-work`, que lo manda a trabajar) y una SALIDA (`withdraw`,
 * que lo devuelve a su propia wallet). No retienen igual — ver `requestReserves`.
 */
export type AgainstKind = 'withdraw' | 'put-to-work';

/**
 * Qué se va a componer, y QUÉ SE PUDO PROBAR sobre lo que ya hay en la cola.
 *
 * La asimetría de la es correcta, pero se apoyaba en `status === 'pending'`, que no es
 * una prueba de que nada esté firmado: un guardado concurrente del run devuelve
 * a 'pending' una petición cuyo pago YA se firmó y sigue vivo en su ventana
 * (`submissionJournal`). Componer entonces la salida de esos mismos drops hacía
 * pagar dos veces al ómnibus. Ahora la exención la concede una prueba:
 */
export interface Against {
  kind: AgainstKind;
  provenUnsigned?: ReadonlySet<string>;
  /**
   * Ids que el journal declaró FIRMADOS Y CAPACES DE MOVER DINERO ('submitting'
   * o 'settled'). No cambia ninguna reserva —esas ya retienen por no estar en
   * `provenUnsigned`; solo evita que el 409 nombre como palanca una puerta que
   * no va a ceder. Un entry `failed` (validado ≠ tes, drops nunca
   * salidos) NO está aquí — va en `provenUnsigned`, y su puerta reconcilia.
   */
  provenSigned?: ReadonlySet<string>;
}

/**
 * Una reserva de MESA de la que no se compuso nada: `prepared`, `put-to-work`,
 * sin memo y sin hash. No hay bytes firmados en ninguna parte, así que no hay
 * doble pago que evitar — y es también lo único que su dueño puede soltar sin
 * leer el ledger (`DELETE /runs/:id/clients/:cid/desk-payments/:pid`).
 */
export function deskReservationNothingSigned(p: DeskPayment): boolean {
  return p.kind === 'put-to-work' && p.status === 'prepared' && !p.memoHex && !p.txHash;
}

/** Is this desk payment still able to move (or still unmirrored) money? */
export function deskPaymentOpen(run: DemoRun, p: DeskPayment, view: LedgerView = {}, against?: Against): boolean {
  if (p.status === 'settled' || p.status === 'released') return false;
  if (applied(run, p.kind, p.txHash)) return false;
  // LA MISMA ASIMETRÍA EN LA MESA. Una reserva de `put-to-work` que la
  // mesa abrió y abandonó (`POST /runs/:id/desk-payments` crea `prepared` SIN un
  // solo byte firmado) retenía el saldo de su dueño para siempre: no caduca por
  // ledger —solo un `withdraw` cierra ahí abajo, su única puerta era un DELETE
  // de admin que además contesta 503 mientras el XRPL no se lea, y el 409 ni
  // nombraba una palanca. Frente a la SALIDA de su dueño no retiene nada,
  // exactamente por el mismo motivo que una entrada pendiente sin firma.
  if (against?.kind === 'withdraw' && deskReservationNothingSigned(p)) return false;
  // Only a WITHDRAW closes by the ledger, and only with proof: past its
  // LastLedgerSequence (view read before the read) AND proven absent by an
  // exhaustive read of its window. A put-to-work (0xFE, no LLS) never closes
  // here — its release needs deskPaymentProof.provePutToWorkRelease.
  if (
    p.kind === 'withdraw' &&
    p.status === 'prepared' &&
    typeof p.lastLedgerSequence === 'number' &&
    typeof view.validatedLedgerIndex === 'number' &&
    view.validatedLedgerIndex > p.lastLedgerSequence &&
    view.payoutsProvenAbsent?.has(p.id) === true
  ) {
    return false;
  }
  return true;
}

/**
 * Close what the ledger closed: 'signed'/'prepared' entries whose hash the
 * mirror applied → 'settled'; prepared withdraws past their LastLedgerSequence
 * AND proven absent over their window → 'released'. Mutates; returns how many.
 */
export function sweepDeskPayments(run: DemoRun, view: LedgerView = {}, nowIso = new Date().toISOString()): number {
  let changed = 0;
  for (const p of run.deskPayments ?? []) {
    if (p.status === 'settled' || p.status === 'released') continue;
    if (applied(run, p.kind, p.txHash)) {
      p.status = 'settled';
      p.updatedAt = nowIso;
      changed++;
    } else if (!deskPaymentOpen(run, p, view)) {
      p.status = 'released';
      p.updatedAt = nowIso;
      changed++;
    }
  }
  return changed;
}

/**
 * Does this request still hold drops the mirror has not debited?
 *
 * UNA ENTRADA QUE NADIE LLEGÓ A FIRMAR NO RETIENE LA SALIDA DE SU DUEÑO.
 */
export function requestReserves(run: DemoRun, r: ClientRequest, against?: Against): boolean {
  if (r.status === 'submitting') return !applied(run, r.kind, r.txHash);
  if (r.status !== 'pending') return false;
  if (against?.kind !== 'withdraw' || r.kind !== 'put-to-work') return true;
  // Un 'pending' con hash no debería existir, pero si lo hay, hay bytes firmados.
  if (r.txHash) return true;
  return !(against.provenUnsigned?.has(r.id) === true);
}

export interface InFlight {
  source: 'request' | 'desk';
  id: string;
  kind: 'withdraw' | 'put-to-work';
  status: string;
  drops: string;
  txHash?: string;
  /**
   * Tiene una puerta que puede soltarla sin leer el ledger: una petición
   * 'pending' sin hash que el journal —si se leyó— no declara firmada
   * (DELETE .../requests/:rid, que vuelve a comprobar el journal antes de
   * ceder) o una reserva de mesa sin memo ni hash
   * (DELETE .../clients/:cid/desk-payments/:pid). El 409 lo usa para NOMBRAR la
   * palanca en vez de dejar un callejón (para las peticiones para
   * las reservas de mesa).
   */
  releasable?: boolean;
}

/**
 * Everything of this client that may still move omnibus money.
 *
 * `against` = qué se va a componer. Con `'withdraw'` una entrada meramente
 * pendiente no aparece aquí: no hay ningún pago suyo que pueda pagarse dos
 * veces (`requestReserves`), así que no puede ser motivo de un
 * `PAYMENT_IN_FLIGHT` contra la salida de su dueño. Sin `against` —re-apuntar
 * una wallet de cobro, re-abrir una ficha— se sigue viendo TODO, que es lo
 * estricto y lo que esas puertas necesitan.
 */
export function paymentsInFlight(run: DemoRun, clientId: string, view: LedgerView = {}, exceptRequestId?: string, against?: Against): InFlight[] {
  const out: InFlight[] = [];
  for (const r of requestsOf(run)) {
    if (r.clientId !== clientId || r.id === exceptRequestId) continue;
    if (!requestReserves(run, r, against)) continue;
    // `releasable` jamás contradice al journal: si se leyó y dice que esta
    // petición lleva firma, no se nombra una puerta que no va a ceder.
    const journalSaysSigned = against?.provenSigned?.has(r.id) === true;
    out.push({ source: 'request', id: r.id, kind: r.kind, status: r.status, drops: r.drops, txHash: r.txHash, releasable: r.status === 'pending' && !r.txHash && !journalSaysSigned });
  }
  for (const p of deskPaymentsOf(run)) {
    if (p.clientId !== clientId) continue;
    if (deskPaymentOpen(run, p, view, against)) out.push({ source: 'desk', id: p.id, kind: p.kind, status: p.status, drops: p.drops, txHash: p.txHash, releasable: deskReservationNothingSigned(p) });
  }
  return out;
}

/**
 * Drops reserved for this client by payments in flight.
 *
 * With `exceptRequestId` (the autopilot deciding whether to sign THAT request)
 * the queue is FIFO: every 'submitting' request and every open desk payment
 * counts, but a 'pending' request only counts if it is AHEAD of the one being
 * served. Counting pending requests behind it too would let two pending requests
 * reserve each other and neither would ever be signed.
 */
export function reservedDrops(run: DemoRun, clientId: string, exceptRequestId?: string, view: LedgerView = {}, against?: Against): bigint {
  let reserved = ZERO;
  const requests = requestsOf(run);
  const selfIndex = exceptRequestId ? requests.findIndex((r) => r.id === exceptRequestId) : -1;
  requests.forEach((r, i) => {
    if (r.clientId !== clientId || r.id === exceptRequestId) return;
    if (!requestReserves(run, r, against)) return;
    // FIFO entre pendientes… salvo una SALIDA. Si una retirada
    // pendiente se saltara por ir detrás en la cola, la entrada de delante se
    // firmaría con el dinero que su dueño ya ha pedido de vuelta, y la retirada
    // quedaría luego `INSUFFICIENT_LEDGER_BALANCE` para siempre. La salida pesa
    // esté donde esté en la cola; la entrada no pesa nunca contra ella. Con la
    // asimetría completa no hay bloqueo mutuo: alguna de las dos avanza siempre.
    if (r.status === 'pending' && r.kind !== 'withdraw' && selfIndex >= 0 && i > selfIndex) return;
    reserved += BigInt(r.drops);
  });
  for (const p of deskPaymentsOf(run)) {
    if (p.clientId === clientId && deskPaymentOpen(run, p, view, against)) reserved += BigInt(p.drops);
  }
  return reserved;
}

/** The client's mirror balance minus what is reserved in flight, never negative. */
export function availableDrops(run: DemoRun, clientId: string, exceptRequestId?: string, view: LedgerView = {}, against?: Against): bigint {
  const client = run.clients.find((c) => c.id === clientId);
  if (!client) return ZERO;
  const left = BigInt(client.xrpOnExchangeDrops || '0') - reservedDrops(run, clientId, exceptRequestId, view, against);
  return left < ZERO ? ZERO : left;
}

export function dropsToXrpText(drops: bigint | string): string {
  const n = typeof drops === 'bigint' ? drops : BigInt(drops || '0');
  const whole = n / BigInt(1_000_000);
  const frac = (n % BigInt(1_000_000)).toString().padStart(6, '0');
  return `${whole.toString()}.${frac}`;
}
