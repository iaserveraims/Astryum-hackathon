/**
 * Demo Exchange API client — talks to `/api/demo-exchange/*` and reuses the
 * institutional client for every prepare that touches capital. Same auth shape
 * as `lib/institutional/api.ts`: EVERY call carries the app session bearer
 * (`auth_token`) — the client self-serve routes (open an account, claim it,
 * requests, deposit instructions, receipts) require that SIWE session and act
 * only on the caller's own rows — plus the admin panel session when there is
 * one; the founder doors are decided server-side.
 */

import { getApiBase } from '../env';
import { noteFlareInstructionDelivery } from '../xaman/liveRequests';
import { notePayloadExpiryMin } from '../wallet/handoffRelease';
import { describeRetryableRefusal, describeSeatRefusal } from '../xaman/seatRefusal';

const API_BASE = getApiBase();

// Same session store as /app/admin (`astryum:adminSession`, sessionStorage,
// JSON {token, expiresAt}). The SIWE door needs no header: an account on
// ADMIN_EMAILS passes with the app's own bearer token.
const ADMIN_SESSION_STORE = 'astryum:adminSession';

export function readAdminSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(ADMIN_SESSION_STORE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string; expiresAt?: string };
    if (!parsed?.token) return null;
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() < Date.now() + 30_000) return null;
    return parsed.token;
  } catch {
    return null;
  }
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const tok = window.localStorage.getItem('auth_token');
    if (tok) h.Authorization = `Bearer ${tok}`;
    const adminSession = readAdminSessionToken();
    if (adminSession) h['x-admin-session'] = adminSession;
  }
  return h;
}

/** The one institutional prepare with no client yet: KYC + tag → registry (unsigned EVM call). */
export async function prepareKycRegister(input: { registry: string; user: string; tag: number; approved?: boolean }): Promise<Result<{ call: { to: string; data: string; value: string; chainId: number; label: string }; disclosure: { title: string; lines: string[] } }>> {
  const res = await fetch(`${API_BASE}/institutional/kyc/register/prepare`, {
    method: 'POST',
    headers: headers(),
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const j = (json ?? {}) as { error?: string; detail?: string };
    return { ok: false, refusal: { status: res.status, error: j.error ?? `HTTP_${res.status}`, detail: j.detail } };
  }
  return { ok: true, data: json as { call: { to: string; data: string; value: string; chainId: number; label: string }; disclosure: { title: string; lines: string[] } } };
}

export type DemoPolicy = 'A' | 'B';
export type ReceiptStep =
  | 'E1_ANCHOR' | 'E2_POTE' | 'E3_KYC' | 'E3_CREDENTIAL' | 'U1_DEPOSIT' | 'E5_PUT_TO_WORK'
  | 'E6_ORDER' | 'E7_DENIED' | 'U4_EXIT' | 'U4_EXIT_XRP' | 'E8_WITHDRAW' | 'NOTE';
export type ReceiptChain = 'xrpl' | 'flare' | 'none';

export interface Check { label: string; observed?: string; ok?: boolean; reason?: string }
export interface Receipt {
  id: string; runId: string; clientId?: string; step: ReceiptStep; chain: ReceiptChain;
  txHash?: string; explorerUrl?: string; at: string; note?: string;
  expect?: Record<string, string | number | boolean>; checks: Check[]; verifiedAt?: string;
}
export interface DemoClient {
  id: string; runId: string; label: string; tag: number; passkeyAccount?: string; xrplAddress?: string;
  kyc: 'none' | 'registry' | 'credential' | 'both'; xrpOnExchangeDrops: string; autoInvest?: boolean; createdAt: string;
  /** The row has an owner (never WHO — the server does not serve owner ids). */
  owned?: boolean;
  /** Unowned and holding a desk claim code: whoever presents the code becomes the owner. */
  claimable?: boolean;
  /** Owned by the session that asked (computed per request from the bearer). */
  mine?: boolean;
  /** How the payout wallet was proven when written. */
  xrplAddressProof?: 'session' | 'binding' | 'admin';
}
/** Una cuenta de esta llave en UN exchange (GET /runs/for-account, 18-sep). */
export interface ClientMembership { runId: string; exchange: RunSummary; client: DemoClient }
export interface ClientRequest {
  id: string; kind: 'put-to-work' | 'withdraw'; clientId: string; drops: string;
  status: 'pending' | 'submitting' | 'signed' | 'refused' | 'done'; createdAt: string; updatedAt: string; txHash?: string; reason?: string;
}
/**
 * An omnibus payment the founder desk composed by hand, recorded server-side:
 * it reserves the client's drops until the ledger settles it (the watcher
 * mirrors its hash), the ledger passes its LastLedgerSequence (payout), the mint
 * is recorded (put-to-work) or the desk releases it before handing it off.
 */
export interface DeskPayment {
  id: string; kind: 'withdraw' | 'put-to-work'; clientId: string; drops: string;
  status: 'prepared' | 'signed' | 'settled' | 'released'; lastLedgerSequence?: number; txHash?: string;
  /** put-to-work: the memo / userOpHash of the 0xFE the SERVER composed for this reservation. */
  memoHex?: string; userOpHash?: string;
  createdAtLedger?: number; closedBy?: string;
  createdAt: string; updatedAt: string;
}
/**
 * The unsigned 0xFE the server composed for a put-to-work reservation
 * (desk-payments/:pid/prepare-put-to-work). Its Payment carries a
 * LastLedgerSequence: past it, it can never be applied.
 */
export interface DeskPutToWorkHandoff {
  account: string; pote: string; receiver: string; xrplPayment: Record<string, unknown>;
  /**
   * it. 19 — ¿ENTREGA ESTE SERVIDOR la instrucción de este 0xFE? Lo manda la
   * ruta (`prepare-put-to-work`) y lo ingiere el registro de firmas en curso,
   * defensivamente: ausente = «no lo sé», que no acusa a nadie de nada.
   */
  serverDelivery?: { executorEnabled?: boolean };
  /**
   * it. 23 (1.2): the `expire` (MINUTES) this deployment measures the 0xFE seat
   * with. The payload must be minted with THIS number, never a hand-written 5.
   */
  payloadExpiryMin?: number;
  memoHex: string; userOpHash: string; personalAccount: string; lastLedgerSequence: number;
  net: { grossXrp: string; supplyUBA: string; fxrp: string };
  disclosure: { disclosedToUser: boolean; defibroSigns: boolean; title: string; lines: string[]; facts?: Record<string, unknown> };
}
/** An omnibus 0xFE the exchange marked as not a client movement. */
export interface ExternalFe { txHash: string; memoHex?: string; ledgerIndex?: number; note: string; markedAt: string }
/**
 * it. 33 (agente C, 2) — «NO PUDE USAR TU MARCA» EN EL LIBRO. `GET /runs/:id` (y
 * el alta self-serve) lo mandan al nivel de arriba del cuerpo cuando la marca de
 * toma de posesión del lector no se pudo usar: `mine` falla cerrado en todas las
 * filas, y esto es lo único que distingue «esa fila no es tuya» de «no pude
 * leer si lo es». `call()` lo pliega dentro del `run` para que viaje con él por
 * `setRun` sin tocar cada consumidor. Mismo cuerpo que el 503 del portal.
 */
export interface ViewerUnreadable {
  error?: string;
  retryable?: boolean;
  cause?: 'ahead-of-clock' | 'unreadable-mark' | 'read-failed' | string;
  detail?: string;
}
export interface DemoRun {
  runId: string; seq: number; label: string; councilAddress: string; omnibusAddress: string; policy: DemoPolicy;
  poteAddress?: string | null; bridgeAddress?: string | null; registryAddress?: string | null;
  createdAt: string; status: 'open' | 'closed'; autopilot?: boolean; clients: DemoClient[]; receipts: Receipt[];
  requests?: ClientRequest[]; deskPayments?: DeskPayment[]; appliedTxHashes: string[];
  /** Present only when the server could not use the reader's takeover mark (see `ViewerUnreadable`). */
  viewerUnreadable?: ViewerUnreadable;
}

/**
 * it. 33 (2) — THE ONE READER of `viewerUnreadable` for a client screen. Pure.
 *
 * «My row» is the one the server says is mine, else an unowned one with my
 * passkey (a claim prompt). With the mark unusable the server says `mine:false`
 * on EVERY row, so the owner of a funded row looked exactly like a stranger
 * with no account — and the screen offered «Open an account» (then 409
 * ACCOUNT_ALREADY_A_CLIENT). This answers the refusal the screen must show
 * instead — only when there IS an owned row for this passkey that the server
 * could not attribute; with no owned row, «open an account» is the truth.
 */
export function ownershipUnreadableFor(run: Pick<DemoRun, 'clients' | 'viewerUnreadable'>, account: string): Refusal | null {
  const u = run.viewerUnreadable;
  if (!u) return null;
  const byAccount = run.clients.filter((c) => c.passkeyAccount?.toLowerCase() === account.toLowerCase());
  if (byAccount.some((c) => c.mine)) return null;
  if (!byAccount.some((c) => c.owned)) return null;
  return {
    status: 503,
    error: typeof u.error === 'string' && u.error ? u.error : 'OWNERSHIP_UNREADABLE',
    retryable: true,
    ...(typeof u.detail === 'string' && u.detail.trim() ? { detail: u.detail } : {}),
  };
}
/** The server's own verdict on a wallet (the one the client routes apply). */
export interface WalletProofRow { address: string; proof: 'session' | 'binding' | null; unreadable: boolean }
export interface AutopilotStatus {
  enabled: boolean; running: boolean; signerAddress: string | null; seedPresent: boolean; signerError?: string;
  attribution: 'user' | 'operational'; maxTxXrp: number; dailyCapXrp: number;
  /**
   * it. 23 (3.2) — `null` ES UNA RESPUESTA, Y SE DICE. The backend has typed this
   * `number | null` since it. 21 (the spend ledger is read strictly, and «I could
   * not read it» must never pass for «nothing spent today» on the number that
   * bounds a key that signs). The frontend kept typing it `number`, so the
   * console printed the literal word «null» and the desk printed a blank —
   * a blank next to «/ 200 XRP today» reads as zero. `spentTodayText` is the one
   * reader: it says it in words, never a number and never nothing.
   */
  spentTodayXrp: number | null; intervalMs: number;
  lastTickAt: string | null; lastError: string | null;
  fulfilled: Array<{ at: string; runId: string; kind: string; clientId: string; drops: string; txHash: string }>;
}

/**
 * What the «spent today» gauge says. Pure, so both surfaces say the same thing:
 * the number when the server read it, and a sentence when it could not — never
 * «null», never a hole, never a 0 nobody measured.
 */
export function spentTodayText(status: Pick<AutopilotStatus, 'spentTodayXrp' | 'dailyCapXrp'> | null | undefined, t: (s: string) => string): string {
  if (!status) return '—';
  if (typeof status.spentTodayXrp !== 'number' || !Number.isFinite(status.spentTodayXrp)) {
    return t("today's spend could not be read — cap {n} XRP/day").replace('{n}', String(status.dailyCapXrp));
  }
  return `${status.spentTodayXrp} / ${status.dailyCapXrp} XRP`;
}
export interface RunSummary {
  runId: string; seq: number; label: string; councilAddress: string; omnibusAddress: string; policy: DemoPolicy;
  poteAddress: string | null; bridgeAddress: string | null; registryAddress: string | null; createdAt: string;
  status: 'open' | 'closed'; clients: number; receipts: number;
}
export interface Refusal {
  status: number; error: string; detail?: string;
  /** DESK_PAYMENT_UNACCOUNTED_ON_LEDGER: the omnibus 0xFE hashes nothing accounts for. */
  hashes?: string[];
  /** WAIT_FOR_LAST_LEDGER: the 0xFE can still land until this XRPL ledger (≈ secondsLeft). */
  lastLedgerSequence?: number;
  secondsLeft?: number;
  /** WAIT_FOR_LAST_LEDGER: ledgers left before that one closes. */
  ledgersLeft?: number;
  /** RECORD_NOT_YET_VISIBLE: the same call can simply be made again. */
  retryable?: boolean;
  /**
   * it. 16 (R5 5.4) — the seat-refusal contract, read defensively: some routes
   * name the code `code` instead of `error`, and `memoHex` (the 0xFE that HOLDS
   * the seat) is sent ONLY to the session that prepared it or that proves the
   * account. `describeSeatRefusal` needs both to say the right sentence and to
   * decide whether the surface may offer to free the seat.
   */
  code?: string;
  memoHex?: string;
  /**
   * it. 23 (3.3) — QUÉ LE FALTA A ESTA PUERTA, no solo que se cerró.
   * `OMNIBUS_OWNER_UNKNOWN` lo decide una puerta MÁS ESTRECHA que la que dejó
   * pasar: `requireAdmin` admite `x-admin-session` (o la llave estática) sin
   * poblar `req.siwe`, así que un fundador que abrió la mesa por ahí llegaba sin
   * usuario, toda dirección con dueño se leía «no atribuible» y el alta moría en
   * un 409 que no nombraba salida. El servidor manda ahora `needs` y
   * `sessionState`; la pantalla los convierte en un paso, no en un muro.
   */
  needs?: string;
  sessionState?: 'session' | 'no-session-presented' | 'session-not-verified';
  /**
   * it. 31 — LA PUERTA DEL DUEÑO, LEÍDA. `POST …/requests` (la única ruta que
   * una persona real toca) contesta ahora con lo que retiene su saldo y con los
   * ids que su propio DELETE puede soltar: una petición 'pending' sin firma
   * (`withdrawableRequestIds`) o una reserva de mesa sin memo ni hash
   * (`releasableDeskPaymentIds`). La consola los convierte en un botón
   * (`refusalDoors`); antes esta pantalla imprimía el `detail` y ahí acababa.
   */
  inFlight?: InFlightRow[];
  withdrawableRequestIds?: string[];
  releasableDeskPaymentIds?: string[];
  /** INSUFFICIENT_AVAILABLE_BALANCE: the numbers, so the sentence can carry them. */
  balanceDrops?: string;
  reservedDrops?: string;
  availableDrops?: string;
}
/** One omnibus payment of the client still able to move money (server shape, availableBalance.InFlight). */
export interface InFlightRow {
  source: 'request' | 'desk';
  id: string;
  kind: 'withdraw' | 'put-to-work';
  status: string;
  drops: string;
  txHash?: string;
  releasable?: boolean;
}
/** A door the owner can open from the console: the DELETE that cedes only if nothing was signed. */
export type RefusalDoor = { kind: 'request'; id: string } | { kind: 'desk'; id: string };

/**
 * it. 31 — the doors a refusal names, in the order the server named them. Pure.
 * Empty for every refusal that has none (a signed payment, a read of ours that
 * failed, anything else): the screen never invents a lever the server did not offer.
 */
export function refusalDoors(refusal: Pick<Refusal, 'withdrawableRequestIds' | 'releasableDeskPaymentIds'> | null | undefined): RefusalDoor[] {
  if (!refusal) return [];
  const out: RefusalDoor[] = [];
  for (const id of refusal.withdrawableRequestIds ?? []) if (typeof id === 'string' && id) out.push({ kind: 'request', id });
  for (const id of refusal.releasableDeskPaymentIds ?? []) if (typeof id === 'string' && id) out.push({ kind: 'desk', id });
  return out;
}
export type Result<T> = { ok: true; data: T } | { ok: false; refusal: Refusal };

/**
 * it. 31 — LA PUERTA DEL DUEÑO, DESDE LA CONSOLA DEL DUEÑO.
 *
 * El último rechazo de una petición (entrar en el vault / retirar), con lo que
 * hace falta para ofrecer una salida: el importe (para reintentar tal cual si el
 * servidor dijo `retryable`) y el propio rechazo (con `withdrawableRequestIds` /
 * `releasableDeskPaymentIds`, que la pantalla convierte en botones). Vive aquí
 * y no en el hook porque el hook arrastra la pila de wallets: esto es puro y se
 * prueba sin DOM.
 */
export interface RequestRefusal {
  kind: 'put-to-work' | 'withdraw';
  amountXrp: string;
  refusal: Refusal;
  doors: RefusalDoor[];
  retryable: boolean;
}

/** The subset of `demoApi` the doors need — injectable, so the wiring is testable without a DOM. */
export type DoorApi = Pick<typeof demoApi, 'withdrawRequest' | 'releaseOwnDeskPayment'>;

/**
 * it. 31 — opens ONE door the server named: the owner's DELETE that cedes only if
 * nothing was signed for it (a request, it. 27) or if no 0xFE was ever composed
 * (a desk reservation, it. 29). Moves no money. The hook calls it; a test can
 * call it with a fake api and see which DELETE runs.
 */
export async function openRefusalDoor(api: DoorApi, runId: string, clientId: string, door: RefusalDoor): Promise<Result<{ run: DemoRun; reconciled?: string }>> {
  return door.kind === 'request' ? api.withdrawRequest(runId, clientId, door.id) : api.releaseOwnDeskPayment(runId, clientId, door.id);
}

/**
 * it. 33 (agente C, 6) — WHAT THE DOOR SAYS IT DID, FROM WHAT THE SERVER SAID.
 *
 * The owner's DELETE of a request has TWO outcomes (it. 31): «nothing was ever
 * signed, taken out of the queue» and `reconciled: 'failed-on-ledger'` — a
 * payment WAS signed, the ledger refused it (validated ≠ tes, the drops never
 * left) and the door closed it with its ledger code. The hook printed the first
 * sentence for both: «Nothing had been signed for it» over a payment that had a
 * hash. Pure; the hook calls it with `r.data.reconciled`.
 */
export function doorOpenedNotice(door: RefusalDoor, reconciled: string | undefined, t: (s: string) => string): string {
  if (door.kind === 'desk') {
    return t('That reservation was released. No payment had been composed for it, so nothing was undone — the XRP it was holding is yours to use again.');
  }
  if (reconciled === 'failed-on-ledger') {
    return t('That request is closed. A payment had been signed for it, but the XRP Ledger refused it, so the XRP never left — nothing is in flight and it is yours to use again.');
  }
  if (reconciled) {
    return t('That request is closed: the exchange reconciled it against the ledger. The XRP it was holding is yours to use again.');
  }
  return t('That request was taken out of the queue. Nothing had been signed for it, so nothing was undone — the XRP it was holding is yours to use again.');
}

/** What the 201 promises, by who actually serves it — never «in a few seconds» when a person has to. */
export function requestAcceptedNotice(kind: 'put-to-work' | 'withdraw', servedBy: 'autopilot' | 'desk', t: (s: string) => string): string {
  if (kind === 'withdraw') {
    return servedBy === 'autopilot'
      ? t('Withdrawal requested. The exchange pays it out to your wallet in a few seconds.')
      : t('Withdrawal requested. The exchange pays it out to your wallet from its account; you will see it here when it lands.');
  }
  return servedBy === 'autopilot'
    ? t('Request sent. The exchange executes it from its omnibus in a few seconds; your shares appear here when the mint lands (~2–5 min).')
    : t('Request sent. The exchange executes it from its account by hand; your shares appear here when the mint lands.');
}

/**
 * it. 23 (3.3): el paso que resuelve `OMNIBUS_OWNER_UNKNOWN`. Pura, y `null`
 * para cualquier otra negativa — la pantalla no inventa un camino donde no lo hay.
 *
 * No es «reintentable»: repetir la misma llamada no cambia nada. Lo que la
 * cambia es traer la sesión de Astryum que PRUEBA que esa cuenta es tuya. Una
 * sesión de admin dice que operas el despliegue, no de quién es la dirección.
 */
export function omnibusOwnerUnknownStep(
  refusal: Pick<Refusal, 'error' | 'sessionState'> | null | undefined,
  t: (s: string) => string,
): string | null {
  if (!refusal || refusal.error !== 'OMNIBUS_OWNER_UNKNOWN') return null;
  return refusal.sessionState === 'session-not-verified'
    ? t('Your Astryum session did not verify (it expired, or it was closed). Sign in again with the account that owns that address, then create the profile again — nothing was created.')
    : t('Sign in to Astryum with the account that owns that address (or bind it there by signature, in Wallets), then create the profile again. An admin session proves you run this deployment, not that the address is yours — nothing was created.');
}

/**
 * El paso que resuelve la puerta de operador en el alta de la mesa (fundador
 * 18-sep: la estación 7 pintaba «NOT_AN_ADMIN» a secas). Crear la mesa sigue
 * siendo de los operadores del despliegue (`requireAdmin`), y desde el it. 7 la
 * puerta por email solo abre con un email VERIFICADO: una cuenta de contraseña
 * no pasa aunque su email esté en la lista.
 *
 * ⚠ La frase NO manda a entrar con Google/Apple. Ese login sobre una cuenta de
 * contraseña sin verificar es una TOMA DE POSESIÓN (it. 8,
 * `AuthService._takeOverSquattedAccount`): mueve wallets, reglas y MoneyFlows a
 * una cuenta de cuarentena y desactiva los vínculos firmados. Para el dueño
 * legítimo es destruir su montaje. La puerta que no toca nada es la llave del
 * panel. Pura; `null` para cualquier otra negativa.
 */
export function adminDoorStep(
  refusal: Pick<Refusal, 'error'> | null | undefined,
  t: (s: string) => string,
): string | null {
  if (!refusal) return null;
  if (refusal.error === 'ADMIN_SESSION_EXPIRED') {
    return t('Open the admin panel again in this same tab and enter the panel key, then create the profile again. Everything you did at the other stations stays on the ledger.');
  }
  if (refusal.error !== 'NOT_AN_ADMIN' && refusal.error !== 'ADMIN_KEY_REQUIRED') return null;
  return t('If you operate this deployment: a password account is not recognised by its email alone, even when the email is on the operators\' list. Open the admin panel in this same tab and enter the panel key, then create the profile again. Everything you did at the other stations stays on the ledger.');
}

const SIGN_IN_AGAIN = 'Sign in to your Astryum account first — opening or changing an exchange account needs your session.';
/** Refusals of the self-serve routes a client can actually meet, in words (the rest keep the server's detail). */
/**
 * El KYC de UNA casilla (diseño B, 14-sep): la credencial `KYC-<tag>` que la raíz
 * del exchange emite sobre el omnibus — quién, sobre qué cuenta, qué tipo — y si
 * el ledger dice que existe, está aceptada y vigente.
 */
export interface RunCredentialRow {
  clientId: string;
  tag: number;
  issuer: string;
  subject: string;
  credentialType: string;
  ok: boolean;
  /** Cuando pasa: 'valid' | 'expiring-soon', con su caducidad si la lleva. */
  state?: 'valid' | 'expiring-soon';
  expiresAtISO?: string | null;
  /** Cuando no pasa: el código del gate (CLIENT_NOT_CREDENTIALED, …) y su detalle. */
  code?: string;
  detail?: string;
}

const REFUSAL_TEXT: Record<string, string> = {
  missing_bearer_token: SIGN_IN_AGAIN,
  token_invalid: SIGN_IN_AGAIN,
  token_expired: 'Your session expired — sign in again.',
  session_not_found: SIGN_IN_AGAIN,
  session_revoked: 'Your session was closed — sign in again.',
  session_expired: 'Your session expired — sign in again.',
  CLAIM_CODE_REQUIRED: 'This account was opened by the exchange. Enter the claim code the exchange gave you to make it yours.',
  CLAIM_CODE_INVALID: 'That claim code does not open this account. Check it with the exchange.',
  NOT_YOUR_CLIENT: 'This exchange account belongs to another user.',
  ADMIN_ONLY_FIELD: 'Only the exchange can change that.',
  WALLET_NOT_PROVEN: 'That XRPL wallet is not proven to be yours. Sign in with it, or bind it to your account by signature in Wallets, then try again.',
  WALLET_PROOF_UNREADABLE: 'Your wallet bindings could not be read right now — nothing changed. Try again in a moment.',
  CLIENT_WALLET_ALREADY_SET: 'This account already has a withdrawal wallet on file; only the exchange can change it.',
  RUN_RECEIPTS_FULL: 'This exchange has no room for more receipts on this run.',
  // El KYC del exchange, UNA CREDENCIAL POR CASILLA (diseño B, 14-sep): la emite y
  // la acepta el exchange; el cliente no firma nada. Ninguna de estas frases vale
  // para una SALIDA: retirar no pasa por el gate, y decirlo evita leerlo como
  // «tu dinero se queda».
  CLIENT_NOT_CREDENTIALED:
    'The exchange has not registered the KYC of your account yet. It does it from its side — you sign nothing. Taking your money out never needs it.',
  CLIENT_CREDENTIAL_PENDING: 'The exchange issued the KYC of your account and is finishing registering it on the ledger. It works as soon as that is done.',
  CLIENT_CREDENTIAL_EXPIRED: 'The KYC of your account expired. The exchange renews it; taking your money out is open meanwhile.',
  CLIENT_HAS_NO_XRPL_WALLET: 'Register your own XRPL wallet first: withdrawals to self-custody are paid there.',
  CREDENTIALS_UNREADABLE: 'Your credential could not be checked against the XRP Ledger right now — this does not mean you have none. Nothing moved; try again.',
  // ── Opening an exchange profile (it. 19, R5 copy) ────────────────────────
  // These came back as the server's raw `detail` on the operator's screen. The
  // refusals of the omnibus declaration are the ones an operator actually meets
  // at the last station of the sign-up, so they get their own sentence here —
  // the screen never prints a code, and never the server's own prose.
  OMNIBUS_IS_THE_COUNCIL:
    'The omnibus has to be a different XRPL account from the council root: the root governs and signs the orders, the omnibus holds client XRP. One account doing both means whoever holds the cash-desk key also holds the exchange authority.',
  OMNIBUS_IS_ANOTHER_COUNCIL:
    'That address already governs another exchange here. One account cannot govern one exchange and hold the client XRP of another — use the omnibus account you created for this desk.',
  OMNIBUS_IS_A_CLIENT_WALLET:
    "That address is already on file as a client's own XRPL wallet. Declaring it as an omnibus would take over that person's account — use the omnibus account you created for this desk.",
  OMNIBUS_IS_A_USER_ACCOUNT:
    "That address already belongs to an Astryum user, and it is not yours. Declaring it would put their account behind this desk's transaction guard. Use the omnibus account you created for this desk — or sign in with that account first, if it really is yours.",
  // it. 21 (3.6): TIENE DUEÑO Y NO PUEDO ATRIBUIRLO — sin sesión, «de alguien» no
  // es «de otro». La frase pide lo que falta en vez de acusar a quien quizá sea
  // su dueño; no es reintentable tal cual (hace falta la sesión).
  OMNIBUS_OWNER_UNKNOWN:
    'That address already belongs to an Astryum account, and this request carries no session, so we cannot tell whether that account is yours. Sign in with the Astryum account that owns it — or bind it there by signature — and declare it again. Nothing was created.',
  // La puerta de operador (`requireAdmin`): una frase, jamás el código. El paso
  // que la resuelve, donde lo hay, lo dice `adminDoorStep`.
  NOT_AN_ADMIN: 'This is reserved to the operators of this deployment, and your Astryum session is not recognised as one. Nothing was changed.',
  ADMIN_KEY_REQUIRED: 'This is reserved to the operators of this deployment, and your Astryum session is not recognised as one. Nothing was changed.',
  ADMIN_SESSION_EXPIRED: 'Your admin panel session expired. Nothing was changed.',
  // «No pude leer» sobre un alta: nada se creó, y se puede reintentar tal cual.
  OMNIBUS_OWNERSHIP_UNREADABLE:
    'Whether that address already belongs to an Astryum user could not be read just now. Nothing was created — try again.',
  // it. 31 (4.2): this one is the FALLBACK only — see `SERVER_DETAIL_FIRST`.
  // The server's `detail` carries the cause (a mark dated ahead of its clock is
  // not «could not be read», and «try again» is not its only way forward).
  OWNERSHIP_UNREADABLE:
    'Whether this login was taken over could not be read just now. Nothing was changed — try again.',
  SEQ_HIGH_WATER_UNREADABLE: 'The exchange ledger marks could not be read just now. Nothing was created — try again.',
  TAG_RANGES_UNREADABLE: 'The assigned deposit-tag ranges could not be read just now. Nothing was created — try again.',
  RUN_MARKS_NOT_PERSISTED: 'The exchange ledger marks could not be recorded just now. Nothing was created — try again.',
  // it. 21 (3.2): la lectura estricta de las runs (it. 19) hacía que cinco rutas
  // contestaran 500 donde antes degradaban a lista vacía. Ahora son 503
  // reintentables, y esta es su frase: NADA cambió, solo no se pudo leer.
  RUN_UNREADABLE: 'The exchange ledger could not be read just now. Nothing was changed — try again in a moment.',
  // it. 33 (7): the request never left the browser (offline, DNS, a killed connection).
  NETWORK_UNREACHABLE: 'The exchange could not be reached from this device just now — the request never left. Nothing was changed; check your connection and try again.',
  RUN_NOT_PERSISTED: 'The exchange ledger could not record that just now. Nothing was recorded — try again.',
  RUN_VERSION_CONFLICT: 'Somebody else saved this exchange while you were working on it. Reload it and do it again — nothing was recorded.',
  AUTOPILOT_TICK_FAILED: 'The exchange backend could not complete a pass — it served nobody this time. Nothing was signed; try again.',
  // ── it. 31: los códigos que no tenían lector en la consola del cliente ──
  // Una toma cerrada no ejecuta ENTRADAS; la salida sigue abierta (el autopiloto
  // la sirve también cerrada). Decirlo evita leer «closed» como «tu dinero se queda».
  RUN_CLOSED: 'This exchange desk is closed: it takes no new entries into the vault. Your XRP stays in your account at the exchange and you can withdraw it at any time.',
  // Una reserva de la mesa con un 0xFE ya compuesto: puede firmarse y entrar, así
  // que SÍ retiene ese XRP —también frente a tu retirada— hasta que pase su
  // ventana en el ledger; entonces el exchange la prueba ausente y la suelta solo.
  DESK_PAYMENT_NOT_RELEASABLE_HERE:
    // it. 33 (3/7): «on its own» only while the exchange backend loop runs (it now
    // sweeps takes served by hand too); otherwise the desk does it. Said so.
    'This reservation already has a payment composed for it, so it may still be signed and land: it holds that XRP — including against your withdrawal — until its signing window on the XRP Ledger passes. Then the exchange proves it absent against the ledger and releases it — on its own while its backend loop is running, or by the desk otherwise; the desk can also close it against the ledger before that.',
  REQUEST_NOT_PENDING: 'That request already moved on — only a request with nothing signed can be taken out of the queue. The ledger decides the rest.',
  REQUEST_PENDING: 'You already have a request of this kind waiting. If it is stuck, take it out of the queue first and ask again.',
  RUN_HAS_LIVE_WORK: 'This desk still has client requests or reservations in flight. Serve them, withdraw them or prove them closed first — a closed desk keeps paying withdrawals, but nothing pending may be left behind a switch.',
  RUN_HAS_CLIENT_MONEY: 'This desk still holds client money or work in flight. Pay it out first; deleting it would discard the ledger mirror of what each client is owed.',
};

/**
 * Refusals that mean «I could not read, so I did nothing» — the same call can
 * simply be made again (it. 19, R5). The screen turns these into a «Try again»
 * button instead of leaving the operator staring at a sentence with no way out.
 */
const RETRYABLE_REFUSALS = new Set([
  'OWNERSHIP_UNREADABLE',
  'OMNIBUS_OWNERSHIP_UNREADABLE',
  'WALLET_PROOF_UNREADABLE',
  'CREDENTIALS_UNREADABLE',
  'SEQ_HIGH_WATER_UNREADABLE',
  'TAG_RANGES_UNREADABLE',
  'RUN_MARKS_NOT_PERSISTED',
  'RUN_UNREADABLE',
  'RUN_NOT_PERSISTED',
  'AUTOPILOT_TICK_FAILED',
  'RECORD_NOT_YET_VISIBLE',
]);

/** Can this refusal be answered by simply doing it again? (Nothing happened.) */
export function refusalIsRetryable(refusal: Refusal): boolean {
  return refusal.retryable === true || RETRYABLE_REFUSALS.has(refusal.error);
}

/**
 * it. 33 (7) — `fetch` threw (offline, DNS, CORS, a killed connection): no
 * status, no body. A `Refusal` the same readers turn into «could not read» +
 * «Try again» — the request never reached the server, so nothing changed.
 */
export function networkRefusal(e: unknown): Refusal {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return { status: 0, error: 'NETWORK_UNREACHABLE', retryable: true, ...(msg ? { detail: msg } : {}) };
}

/**
 * productizer it. 31 (agente D, 4.2) — CODES WHOSE SERVER `detail` WINS OVER OUR
 * FIXED SENTENCE, because the sentence is only true for ONE of the causes the
 * code covers. `OWNERSHIP_UNREADABLE` used to mean one thing (the database did
 * not answer); since it. 29 the server also sends it for a takeover mark dated
 * AHEAD of its clock — a row that was read perfectly well, that no re-link can
 * clear, and that heals on its own at a known instant. Its `detail` says
 * «dated later than our clock». `REFUSAL_TEXT.OWNERSHIP_UNREADABLE` («could not
 * be read just now … try again») was overwriting that in every one of the ~30
 * places that render through `describeRefusal`, so the it. 29 sentence never
 * reached a person. The it. 19 rule («our words, through t(); the server's prose
 * is the last resort») stands for every other code; here the server's prose is
 * the only one that knows which of three things happened. Without a `detail`
 * the fixed sentence still applies — a code is never shown raw.
 */
const SERVER_DETAIL_FIRST = new Set(['OWNERSHIP_UNREADABLE']);

/** A refusal as a sentence for the person in front of the screen. */
export function describeRefusal(refusal: Refusal, t: (s: string) => string): string {
  if (SERVER_DETAIL_FIRST.has(refusal.error) && typeof refusal.detail === 'string' && refusal.detail.trim().length > 0) {
    return refusal.detail;
  }
  const known = REFUSAL_TEXT[refusal.error];
  if (known) return t(known);
  // it. 31: la familia «una lectura NUESTRA falló» (SUBMISSION_JOURNAL_UNREADABLE
  // entre ellas) tiene su lector compartido; antes caía aquí como el `detail`
  // inglés del servidor, sin frase y sin «try again».
  const readFailure = describeRetryableRefusal(refusal, t);
  if (readFailure) return readFailure.text;
  return refusal.detail ?? refusal.error;
}

/**
 * it. 31 — the sentence for a refusal of `POST …/requests`, with its numbers and
 * a pointer to the doors when the server named any. Pure; falls back to
 * `describeRefusal` for everything else.
 */
export function describeRequestRefusal(refusal: Refusal, t: (s: string) => string): string {
  const doors = refusalDoors(refusal);
  const tail = doors.length ? ` ${t('You can take it out of the way below — that cedes only if nothing was signed for it.')}` : '';
  if (refusal.error === 'INSUFFICIENT_AVAILABLE_BALANCE' && refusal.availableDrops !== undefined && refusal.reservedDrops !== undefined && refusal.balanceDrops !== undefined) {
    return (
      t('{available} XRP are available now: {reserved} XRP of your {balance} XRP are held by a payment of yours still in flight.')
        .replace('{available}', dropsToXrp(refusal.availableDrops))
        .replace('{reserved}', dropsToXrp(refusal.reservedDrops))
        .replace('{balance}', dropsToXrp(refusal.balanceDrops)) + tail
    );
  }
  if (refusal.error === 'REQUEST_PENDING') return t(REFUSAL_TEXT.REQUEST_PENDING) + (doors.length ? '' : ` ${t('It carries a signed payment: the ledger decides it.')}`);
  return describeRefusal(refusal, t);
}

/**
 * The desk's refusals about an omnibus payment in flight, said with their
 * numbers (productizer it. 12): a put-to-work release before its
 * LastLedgerSequence waits for the ledger (2.3), and a record the backend's node
 * cannot see yet is retried, never read as «not this client's» (1.4).
 */
export function describeDeskRefusal(refusal: Refusal, t: (s: string) => string): string {
  // it. 16 (R5 5.4): a seat refusal is a SENTENCE, never a raw token. The desk
  // composes 0xFEs like any other surface and answered NONCE_SEAT_TAKEN…* with
  // the server's own code plus a paragraph of hashes. The shared reader owns the
  // wording (lib/xaman/seatRefusal); anything else keeps falling through.
  const seat = describeSeatRefusal(refusal, t);
  if (seat) return seat.text;
  if (refusal.error === 'WAIT_FOR_LAST_LEDGER') {
    const lls = typeof refusal.lastLedgerSequence === 'number' ? String(refusal.lastLedgerSequence) : '—';
    const secs = typeof refusal.secondsLeft === 'number' ? String(refusal.secondsLeft) : '?';
    return t('This 0xFE can still be signed and land until XRPL ledger {lls} (≈ {s} s). The reservation stays in flight: release it after that ledger — or, if it was signed, record it.')
      .replace('{lls}', lls)
      .replace('{s}', secs);
  }
  if (refusal.error === 'RECORD_NOT_YET_VISIBLE') {
    return t('The XRPL node the exchange reads does not show this 0xFE validated yet. Nothing was debited and the reservation is untouched — record it again in a few seconds.');
  }
  return describeRefusal(refusal, t);
}

/**
 * `recoveryWarning` of a council-order prepare (set when the server could not
 * record the order for its own delivery): plain text to show next to the order.
 * Absent / empty → null.
 */
export function councilOrderRecoveryWarning(prepared: unknown): string | null {
  const w = (prepared as { recoveryWarning?: unknown } | null | undefined)?.recoveryWarning;
  return typeof w === 'string' && w.trim() ? w.trim() : null;
}

/**
 * Everything the server attached to a composed council order that the person
 * signing has to see: it could not record the order for its own delivery
 * (`recoveryWarning`), or the same order — or another one — is already out
 * (`duplicateWarning` / `inFlightWarning`). Plain strings, in order, no duplicates.
 */
export function councilOrderServerWarnings(prepared: unknown): string[] {
  const p = (prepared ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  for (const key of ['recoveryWarning', 'duplicateWarning', 'inFlightWarning']) {
    const v = p[key];
    if (typeof v === 'string' && v.trim() && !out.includes(v.trim())) out.push(v.trim());
  }
  return out;
}

/**
 * The one-use token the server hands back with an EXIT it composed itself
 * (`/multisign/prepare` takes it instead of classifying the memo again). A
 * console that does not forward it turns a bad read — or a region — into a
 * closed exit, which an exit may never be (it. 14, R3 3.1).
 */
export function councilOrderExitToken(prepared: unknown): string | undefined {
  const v = (prepared as { exitToken?: unknown } | null | undefined)?.exitToken;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** 409 of a prepare when THE SAME order went out moments ago (it. 15; before: COUNCIL_ORDER_IN_FLIGHT). */
export const SAME_ORDER_RECENTLY_LAUNCHED = 'SAME_ORDER_RECENTLY_LAUNCHED';
/** Legacy name of the same refusal, still answered by older backends. */
export const COUNCIL_ORDER_IN_FLIGHT = 'COUNCIL_ORDER_IN_FLIGHT';

/** Is this «the same order is already out» — the one a person may confirm past (`confirmAnotherOrder`)? */
export function isSameOrderRecentlyLaunched(refusal: { error?: string } | null | undefined): boolean {
  return refusal?.error === SAME_ORDER_RECENTLY_LAUNCHED || refusal?.error === COUNCIL_ORDER_IN_FLIGHT;
}

/**
 * The refusals that ARE the cage's verdict on the order — the mandate refusing
 * before anyone signs: the venue is not listed, the buffer floor would be
 * crossed, the cap exceeded, the pote is not this cage's. Each mirrors a revert
 * of the contract (checkPoteDirectTo / the cage pre-flight), and only these are
 * recorded as E7 proof.
 *
 * Everything else — the same order already out (409), too many pending (429), an
 * order the server could not record (503), the region (451), a chain read that
 * failed (502), a network error — is the SERVER refusing to compose right now.
 * Recording one of those as «the cage says no» puts a denial the cage never gave
 * in the audit trail (it. 14, R2 2.4).
 */
export const CAGE_VERDICT_CODES: ReadonlySet<string> = new Set([
  'VENUE_UNKNOWN',
  'VENUE_RETIRED',
  'VENUE_NOT_READY',
  'INSUFFICIENT_FREE',
  'BUFFER_FLOOR_CROSSED',
  'ENTRY_CAP_EXCEEDED',
  'CAGE_ORDER_REFUSED',
]);

export function isCageVerdict(refusal: { status?: number; error?: string } | null | undefined): boolean {
  return Boolean(refusal && refusal.status === 409 && refusal.error && CAGE_VERDICT_CODES.has(refusal.error));
}

/** What each council-order refusal means, in words — never a raw code, never the server's Spanish. */
const COUNCIL_ORDER_REFUSAL_TEXT: Record<string, string> = {
  [SAME_ORDER_RECENTLY_LAUNCHED]: 'An order with this very action and these parameters went out a few minutes ago. Compose another one only if you mean to move the capital again.',
  [COUNCIL_ORDER_IN_FLIGHT]: 'An order with this very action and these parameters went out a few minutes ago. Compose another one only if you mean to move the capital again.',
  TOO_MANY_PENDING_ORDERS: 'This council already has too many orders waiting to be delivered. Nothing was composed — let them land (or be forgotten) and try again.',
  ORDER_RECOVERY_UNRECORDED: 'The server could not remember this order for its own delivery, so it did not compose it — nothing was signed. Try again in a moment.',
  GEOFENCE_BLOCKED: 'Directing capital is not available in this region. Nothing was composed; bringing capital back to the buffer is never blocked.',
  INSTITUTIONAL_DISABLED: 'The institutional module is switched off on this environment — nothing was composed.',
  COUNCIL_GOVERNS_A_CAGE: 'This council governs a cage: its orders are composed against the cage, not against a loose pote. Nothing was composed.',
  NO_CAGE: 'This council has no cage or pote the server can resolve yet. Nothing was composed.',
  NO_PERSONAL_ACCOUNT: 'This council has no Personal Account the server can resolve, and one is needed to pay the fee. Nothing was composed.',
  CAGE_FACTORY_UNCONFIGURED: 'This environment has no cage factory configured — nothing was composed.',
  CAGE_ORDER_INVALID: 'The order parameters are not valid for this action — nothing was composed.',
  CAGE_ORDER_REFUSED: 'The cage refuses this order: it does not govern that pote, or it was already handed over. Nothing was composed.',
  ORDER_PIN_UNREADABLE: 'The council account could not be read to pin the order sequence — nothing was composed. Try again.',
};

export function describeCouncilOrderRefusal(refusal: { status?: number; error?: string; detail?: string }, t: (s: string) => string): string {
  const known = refusal.error ? COUNCIL_ORDER_REFUSAL_TEXT[refusal.error] : undefined;
  if (known) return t(known);
  if (isCageVerdict(refusal)) return refusal.detail ?? refusal.error ?? '';
  return t('The order could not be composed right now, and nothing was signed. Try again; if it keeps happening, check the desk.');
}


/* ── exchange 2.0: las estructuras cautivas de un tenant ──────────────────── */

/** Design: docs/context/Astryum_Exchange_2_Estructuras_Bajo_El_Omnibus_2026-09-18.md */
export type StructureKind = 'box' | 'family' | 'enterprise' | 'agent';
/** 'sole' = la personal manda sola · 'shared' = es uno de varios en el quórum. */
export type StructureGovernance = 'sole' | 'shared';
export type BirthStepId = 'fund' | 'constitute' | 'rehearse' | 'designate' | 'close-door';

/** 'root' = la cuenta personal del titular · 'member' = su círculo · 'operator' = un tercero. */
export type SeatHolder = 'root' | 'member' | 'operator';

export interface StructureSeat {
  account: string;
  weight: number;
  /** De quién es el asiento. Aquí vive toda la cuestión de quién puede mover esto. */
  holder: SeatHolder;
}

export interface DemoStructure {
  id: string; runId: string; label: string; kind: StructureKind; governance: StructureGovernance;
  /** La cuenta PERSONAL que la comanda. */
  rootAddress: string;
  address: string; seats: StructureSeat[]; quorum: number;
  designation: boolean; carriesOwnCredentials: boolean; paysThroughCredentialGate: boolean;
  clientId?: string;
  fundingXrp: number; createdAt: string; doorClosedAt?: string;
  steps: Array<{ step: BirthStepId; txHash: string; ledgerIndex?: number; at: string; observed?: string }>;
}

export interface BirthRefusal { code: string; reason: string }
/** Verdades que hay que saber antes de firmar, aunque no paren nada. */
export interface BirthNote { code: string; text: string }

export interface BirthStep {
  id: BirthStepId;
  signer: 'funder' | 'structure-master' | 'structure-quorum' | 'root';
  tx: string;
  note: string;
  after: BirthStepId[];
  irreversible?: boolean;
}

export interface StructureAuthority {
  totalWeight: number; rootWeight: number; memberWeight: number; operatorWeight: number;
  rootAloneBinds: boolean; operatorAloneBinds: boolean; membersBindWithoutRoot: boolean;
  quorumMargin: number; canCloseDoor: boolean;
}

export interface BirthReservePlan {
  baseXrp: number; incrementXrp: number; standingObjects: number; transientObjects: number;
  rehearsalLockXrp: number; feeHeadroomXrp: number; fundingXrp: number;
  recoverableXrp: number; unrecoverableXrp: number;
}

export interface StructurePlan {
  ok: boolean;
  refusals: BirthRefusal[];
  notes: BirthNote[];
  steps: BirthStep[];
  reserve: BirthReservePlan | null;
  authority: StructureAuthority;
}

export interface StructureDeclaration {
  label: string; kind: StructureKind; governance: StructureGovernance;
  /** La cuenta personal que manda en ella. */
  rootAddress: string;
  address: string;
  seats: StructureSeat[]; quorum: number;
  designation?: boolean;
  /** ¿Paga ELLA MISMA a un destino con puerta de credencial? Entonces necesita credenciales propias. */
  paysThroughCredentialGate?: boolean;
  carriesOwnCredentials?: boolean;
  operatorMayBind?: boolean;
  armAnchorGate?: boolean; receivesThirdPartyReturns?: boolean;
  clientId?: string;
}

/** A row of the tenant's structures: what was declared, and what the LEDGER says. */
export interface StructureRow {
  structure: DemoStructure;
  progress: { done: BirthStepId[]; next: BirthStepId | null; total: number } | null;
  ledger: { hasSignerList: boolean; quorum: number | null; masterKeyDisabled: boolean; signers: Array<{ account: string; weight: number }> } | null;
  ledgerUnreadable: boolean;
  door: { allowed: boolean; reason?: string } | null;
}

export interface PreparedStructureStep {
  step: BirthStepId;
  signer: BirthStep['signer'];
  structureId: string;
  xrplTx: Record<string, unknown>;
  disclosure: { disclosedToUser: boolean; defibroSigns: boolean; note: string; facts: Record<string, unknown> };
}

async function call<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<Result<T>> {
  const res = await fetch(`${API_BASE}/demo-exchange${path}`, {
    method,
    headers: headers(),
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const j = (json ?? {}) as { error?: string; code?: unknown; detail?: string; hashes?: unknown; lastLedgerSequence?: unknown; secondsLeft?: unknown; ledgersLeft?: unknown; retryable?: unknown; memoHex?: unknown; needs?: unknown; sessionState?: unknown; inFlight?: unknown; withdrawableRequestIds?: unknown; releasableDeskPaymentIds?: unknown; balanceDrops?: unknown; reservedDrops?: unknown; availableDrops?: unknown };
    const hashes = Array.isArray(j.hashes) ? j.hashes.filter((h): h is string => typeof h === 'string') : undefined;
    // it. 31: the owner's doors travel with the 409 (POST …/requests, PAYMENT_IN_FLIGHT).
    const ids = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : undefined);
    const withdrawableRequestIds = ids(j.withdrawableRequestIds);
    const releasableDeskPaymentIds = ids(j.releasableDeskPaymentIds);
    const inFlight = Array.isArray(j.inFlight)
      ? (j.inFlight.filter((x): x is InFlightRow => Boolean(x) && typeof x === 'object' && typeof (x as InFlightRow).id === 'string') as InFlightRow[])
      : undefined;
    const dropsField = (v: unknown): string | undefined => (typeof v === 'string' && /^\d+$/.test(v) ? v : undefined);
    return {
      ok: false,
      refusal: {
        status: res.status,
        error: j.error ?? `HTTP_${res.status}`,
        detail: j.detail,
        ...(hashes && hashes.length ? { hashes } : {}),
        ...(typeof j.lastLedgerSequence === 'number' ? { lastLedgerSequence: j.lastLedgerSequence } : {}),
        ...(typeof j.secondsLeft === 'number' ? { secondsLeft: j.secondsLeft } : {}),
        ...(typeof j.ledgersLeft === 'number' ? { ledgersLeft: j.ledgersLeft } : {}),
        ...(j.retryable === true ? { retryable: true } : {}),
        ...(typeof j.code === 'string' ? { code: j.code } : {}),
        ...(typeof j.memoHex === 'string' ? { memoHex: j.memoHex } : {}),
        ...(typeof j.needs === 'string' ? { needs: j.needs } : {}),
        ...(typeof j.sessionState === 'string' ? { sessionState: j.sessionState as Refusal['sessionState'] } : {}),
        ...(inFlight && inFlight.length ? { inFlight } : {}),
        ...(withdrawableRequestIds && withdrawableRequestIds.length ? { withdrawableRequestIds } : {}),
        ...(releasableDeskPaymentIds && releasableDeskPaymentIds.length ? { releasableDeskPaymentIds } : {}),
        ...(dropsField(j.balanceDrops) !== undefined ? { balanceDrops: dropsField(j.balanceDrops) } : {}),
        ...(dropsField(j.reservedDrops) !== undefined ? { reservedDrops: dropsField(j.reservedDrops) } : {}),
        ...(dropsField(j.availableDrops) !== undefined ? { availableDrops: dropsField(j.availableDrops) } : {}),
      },
    };
  }
  // it. 17 (contrato con el agente D) — EL 0xFE DE LA MESA ENTRA EN EL MISMO
  // REGISTRO. El aviso global de firmas en curso solo promete entrega a Flare
  // cuando ALGUIEN dijo que el executor está en marcha (it. 14, R2 2.6), y
  // distingue «el servidor dijo que está parado» de «ninguna ruta manda el
  // campo» (it. 16, R3 3.2). Las rutas institucionales ya lo alimentaban; las
  // del exchange no, así que su 0xFE salía siempre con la frase prudente.
  //
  // Lectura DEFENSIVA por partida doble: el 0xFE de la mesa viaja anidado
  // (`handoff.xrplPayment`), y `serverDelivery.executorEnabled` puede no llegar
  // todavía — sin él el registro se queda en «unknown», que no acusa a nadie.
  // Un cuerpo que no es un 0xFE lo ignora el propio registro.
  if (json && typeof json === 'object') {
    const body = json as Record<string, unknown>;
    const handoff = (body.handoff && typeof body.handoff === 'object' ? body.handoff : {}) as Record<string, unknown>;
    const deliveryOf = (o: Record<string, unknown>): { executorEnabled?: unknown } | undefined =>
      (o.serverDelivery && typeof o.serverDelivery === 'object' ? (o.serverDelivery as { executorEnabled?: unknown }) : undefined) ??
      (typeof o.executorEnabled === 'boolean' ? { executorEnabled: o.executorEnabled } : undefined);
    noteFlareInstructionDelivery(
      handoff.xrplPayment ?? body.xrplPayment ?? body.xrplTx,
      deliveryOf(handoff) ?? deliveryOf(body),
    );
    // it. 23 (1.2) — LA MESA APRENDE LA CADUCIDAD DEL SERVIDOR, COMO LAS DEMÁS.
    // El asiento del 0xFE se mide con `HANDOFF_PAYLOAD_EXPIRY_MIN`, y la mesa
    // acuñaba su payload de Xaman con un `expire: 5` escrito a mano: baja esa
    // variable y el asiento se suelta con el payload TODAVÍA firmable — el
    // gemelo. Se aprende aquí (anidado o al nivel de arriba), igual que en
    // `lib/institutional/api.ts` y en `postHandoff`, así que ninguna pantalla
    // necesita enchufarlo a mano.
    // it. 27 (§3): con su memo. Sin él, el número se aprendía solo para la
    // pestaña — y el de una ceremonia (24 h) pasa del clamp ordinario, así que
    // se descartaba entero: la lectura del servidor no llegaba a ningún payload.
    // it. 31: and whether the server actually READ the SignerList for that row
    // ('single' | 'quorum' | 'unknown'). Without it the row stays 'unknown' and
    // the browser re-reads the ledger itself — the safe direction, but a read
    // the server already made. Same one-liner as v1Api and institutional/api.
    notePayloadExpiryMin(
      handoff.payloadExpiryMin ?? body.payloadExpiryMin,
      handoff.memoHex ?? body.memoHex,
      handoff.signerListRead ?? body.signerListRead,
    );
    // it. 33 (2): «could not use your mark» travels WITH the run it qualifies, so
    // every `setRun(r.data.run)` carries it and a mutation that answered a run
    // without it (its mark was usable, or it would have 503'd) clears it.
    if (body.run && typeof body.run === 'object' && body.viewerUnreadable && typeof body.viewerUnreadable === 'object') {
      (body.run as Record<string, unknown>).viewerUnreadable = body.viewerUnreadable;
    }
  }
  return { ok: true, data: json as T };
}

export const demoApi = {
  /* exchange 2.0 — structures (see the types above) */
  planStructure: (runId: string, input: StructureDeclaration) =>
    call<{ plan: StructurePlan; reserveFigures: { baseXrp: number; incrementXrp: number } }>('POST', `/runs/${runId}/structures/plan`, input),
  addStructure: (runId: string, input: StructureDeclaration) =>
    call<{ structure: DemoStructure; plan: StructurePlan }>('POST', `/runs/${runId}/structures`, input),
  listStructures: (runId: string) =>
    call<{ structures: StructureRow[]; reserveFigures: { baseXrp: number; incrementXrp: number } | null }>('GET', `/runs/${runId}/structures`),
  prepareStructureStep: (runId: string, structureId: string, step: BirthStepId) =>
    call<PreparedStructureStep>('POST', `/runs/${runId}/structures/${structureId}/steps/${step}/prepare`, {}),
  recordStructureStep: (runId: string, structureId: string, step: BirthStepId, txHash: string) =>
    call<{ structure: DemoStructure; verdict: { ok: boolean; observed: string; ledgerIndex?: number } }>('POST', `/runs/${runId}/structures/${structureId}/steps/${step}/record`, { txHash }),
  // Desde el 20-sep la lista es la de TUS exchanges. `all` es del panel de
  // operaciones de los fundadores: el backend solo lo honra con puerta de admin.
  listRuns: (opts: { all?: boolean } = {}) => call<{ runs: RunSummary[] }>('GET', opts.all ? '/runs?all=1' : '/runs'),
  createRun: (input: { label?: string; councilAddress: string; omnibusAddress: string; policy?: DemoPolicy; registryAddress?: string; poteAddress?: string }) =>
    call<{ run: DemoRun }>('POST', '/runs', input),
  getRun: (runId: string) => call<{ run: DemoRun }>('GET', `/runs/${runId}`),
  /** The exchange this Flare account is a client of — resolved from identity, never from a picker. */
  forAccount: (account: string) =>
    call<
      // 18-sep — cliente POR EXCHANGE: `memberships` = sus cuentas (una por
      // exchange) y `joinable` = los exchanges abiertos a los que esta llave aún
      // puede pedir acceso. Opcionales: un backend anterior no los manda.
      | { found: true; runId: string; exchange: RunSummary; client: DemoClient; others: number; memberships?: ClientMembership[]; joinable?: RunSummary[] }
      // heldElsewhere (14-sep): la llave YA es cliente ahí, pero con otra cuenta de Astryum (o hay que reclamarla).
      | { found: false; exchanges: RunSummary[]; joinable?: RunSummary[]; heldElsewhere?: { exchange: RunSummary; reclaimRequired: boolean } }
    >(
      'GET', `/runs/for-account?account=${encodeURIComponent(account)}`),
  patchRun: (runId: string, patch: { label?: string; status?: 'open' | 'closed'; poteAddress?: string; bridgeAddress?: string; registryAddress?: string; autopilot?: boolean; policy?: DemoPolicy }) =>
    call<{ run: DemoRun }>('PATCH', `/runs/${runId}`, patch),
  addRequest: (runId: string, clientId: string, input: { kind: 'put-to-work' | 'withdraw'; amountXrp: string }) =>
    call<{ request: ClientRequest; run: DemoRun; servedBy?: 'autopilot' | 'desk' }>('POST', `/runs/${runId}/clients/${clientId}/requests`, input),
  /**
   * it. 31 — LAS DOS PUERTAS DEL DUEÑO, QUE SOLO EXISTÍAN PARA `curl`.
   * Retirar una petición 'pending' de la que nada se firmó (it. 27; el servidor
   * vuelve a comprobar el journal y solo cede entonces), y soltar una reserva de
   * mesa de la que nunca se compuso un 0xFE (it. 29). Ninguna mueve dinero.
   */
  withdrawRequest: (runId: string, clientId: string, requestId: string) =>
    call<{ request: ClientRequest; run: DemoRun; reconciled?: string }>('DELETE', `/runs/${runId}/clients/${clientId}/requests/${requestId}`),
  /**
   * 18-sep — la MESA toma la petición del cliente para firmarla desde el omnibus
   * con un QR (sin autopilot). La misma cesión que `withdrawRequest` (nada
   * firmado; el journal manda), escrita como `TAKEN_BY_THE_DESK`. Solo operador.
   */
  takeRequest: (runId: string, clientId: string, requestId: string) =>
    call<{ request: ClientRequest; run: DemoRun }>('DELETE', `/runs/${runId}/clients/${clientId}/requests/${requestId}?takenByDesk=1`),
  releaseOwnDeskPayment: (runId: string, clientId: string, deskPaymentId: string) =>
    call<{ deskPayment: DeskPayment; run: DemoRun }>('DELETE', `/runs/${runId}/clients/${clientId}/desk-payments/${deskPaymentId}`),
  autopilot: () => call<AutopilotStatus>('GET', '/autopilot'),
  /** El KYC de cada casilla, leído del ledger (solo la atestación POSITIVA viaja). */
  runCredentials: (runId: string) =>
    call<{ required: boolean; clients: RunCredentialRow[] }>('GET', `/runs/${runId}/credentials`),
  autopilotTick: () => call<{ runs: number; actions: number; status: AutopilotStatus }>('POST', '/autopilot/tick', {}),
  resolvePote: (runId: string) => call<{ run: DemoRun; resolved: boolean }>('POST', `/runs/${runId}/resolve-pote`),
  deleteRun: (runId: string) => call<{ deleted: string }>('DELETE', `/runs/${runId}`),
  /** A founder (desk) alta answers a one-time `claimCode` — shown once, handed to the client out of band. */
  addClient: (runId: string, input: { label: string; passkeyAccount?: string; xrplAddress?: string }) =>
    call<{ client: DemoClient; run: DemoRun; claimCode?: string }>('POST', `/runs/${runId}/clients`, input),
  /** `claimCode` claims an unowned row; `issueClaimCode` (founders) answers a fresh one-time `claimCode`. */
  patchClient: (runId: string, clientId: string, patch: { label?: string; passkeyAccount?: string; xrplAddress?: string; kyc?: DemoClient['kyc']; autoInvest?: boolean; claimCode?: string; issueClaimCode?: boolean }) =>
    call<{ client: DemoClient; run: DemoRun; claimCode?: string }>('PATCH', `/runs/${runId}/clients/${clientId}`, patch),
  depositInstructions: (runId: string, clientId: string, amountXrp: string) =>
    call<{ client: { id: string; label: string; tag: number }; xrplTx: Record<string, unknown>; instructions: { destination: string; destinationTag: number; amountXrp: string; drops: string }; disclosure: { title: string; lines: string[] } }>(
      'POST', `/runs/${runId}/clients/${clientId}/deposit-instructions`, { amountXrp }),
  /** Refuses 409 PAYMENT_IN_FLIGHT while the client has a payment in flight; records the hand-off as a desk payment. */
  withdrawPrepare: (runId: string, clientId: string, amountXrp: string) =>
    call<{ xrplTx: Record<string, unknown>; payloadExpiryMin?: number; client: { id: string; label: string; tag: number }; deskPayment: DeskPayment; disclosure: { title: string; lines: string[] } }>(
      'POST', `/runs/${runId}/withdraw/prepare`, { clientId, amountXrp }),
  /** E5 by hand, step 1: reserve the client's drops BEFORE the 0xFE exists (same PAYMENT_IN_FLIGHT rule). */
  reserveDeskPayment: (runId: string, input: { clientId: string; kind: 'put-to-work'; amountXrp: string }) =>
    call<{ deskPayment: DeskPayment; run: DemoRun }>('POST', `/runs/${runId}/desk-payments`, input),
  /** E5 by hand, step 2: the SERVER composes the 0xFE of that reservation and stores its memo on it. */
  preparePutToWork: (runId: string, deskPaymentId: string) =>
    call<{ deskPayment: DeskPayment; run: DemoRun; handoff: DeskPutToWorkHandoff }>('POST', `/runs/${runId}/desk-payments/${deskPaymentId}/prepare-put-to-work`, {}),
  /** Mark an omnibus 0xFE as not a client movement (nothing debited; a reason is required and kept as a receipt). */
  markExternal0xfe: (runId: string, input: { txHash: string; note: string }) =>
    call<{ externalFe: ExternalFe; run: DemoRun; duplicate?: boolean }>('POST', `/runs/${runId}/desk-payments/external-0xfe`, input),
  /** The desk's door validated the payment on the ledger: keep its hash on the reservation. */
  reportDeskPaymentSigned: (runId: string, deskPaymentId: string, txHash: string) =>
    call<{ deskPayment: DeskPayment; run: DemoRun }>('POST', `/runs/${runId}/desk-payments/${deskPaymentId}/signed`, { txHash }),
  /** Release a reservation that never reached Xaman (Back). A signed one only with `force`. */
  releaseDeskPayment: (runId: string, deskPaymentId: string, force = false) =>
    call<{ deskPayment: DeskPayment; run: DemoRun }>('DELETE', `/runs/${runId}/desk-payments/${deskPaymentId}${force ? '?force=1' : ''}`),
  /** Which of these XRPL wallets the server considers proven to this session (needs the session). */
  walletProof: (addresses: string[]) =>
    call<{ sessionWallet: string | null; wallets: WalletProofRow[] }>('GET', `/wallet-proof?addresses=${encodeURIComponent(addresses.join(','))}`),
  addReceipt: (runId: string, input: { step: ReceiptStep; chain: ReceiptChain; txHash?: string; clientId?: string; note?: string; expect?: Record<string, string | number | boolean> }) =>
    call<{ receipt: Receipt; run: DemoRun }>('POST', `/runs/${runId}/receipts`, input),
  recordPutToWork: (runId: string, input: { clientId: string; drops: string; txHash: string; note?: string; deskPaymentId?: string }) =>
    call<{ receipt: Receipt | null; duplicate: boolean; run: DemoRun }>('POST', `/runs/${runId}/put-to-work/record`, input),
  scanOmnibus: (runId: string) =>
    call<{ omnibus: string; scannedAt: string; txs: Array<{ hash: string; account: string; destination: string; destinationTag?: number; drops: string; dateISO: string; result: string; validated: boolean; direction: 'in' | 'out'; memoHex?: string; kind: 'deposit' | 'return' | 'withdraw' | 'other'; clientId?: string; explorerUrl?: string }>; credited: Array<{ kind: string; clientId: string; drops: string; txHash: string }>; deskPaymentsSwept?: number; ledger: Array<{ id: string; label: string; tag: number; xrpOnExchangeDrops: string }> }>(
      'GET', `/runs/${runId}/omnibus`),
  verify: (runId: string, receiptId?: string) =>
    call<{ run: DemoRun; summary: { receipts: number; verified: number; failed: number } }>('POST', `/runs/${runId}/verify`, receiptId ? { receiptId } : {}),
  chain: (runId: string) =>
    call<{ readAt: string; pote: unknown; clients: Array<{ clientId: string; passkeyAccount?: string; shares?: string; sharesHuman?: string; registryApproved?: boolean; registryTag?: number; error?: string }>; council: { didAnchored: boolean; dataHex?: string } }>(
      'GET', `/runs/${runId}/chain`),
  proofUrl: (runId: string) => `${API_BASE}/demo-exchange/runs/${runId}/proof.md`,
  /** The proof document as text — fetched WITH the admin headers (a plain link cannot carry them). */
  proof: async (runId: string): Promise<Result<string>> => {
    const res = await fetch(`${API_BASE}/demo-exchange/runs/${runId}/proof.md`, { headers: headers(), credentials: 'include' });
    const text = await res.text();
    if (!res.ok) {
      let j: { error?: string; detail?: string } = {};
      try { j = JSON.parse(text); } catch { /* not json */ }
      return { ok: false, refusal: { status: res.status, error: j.error ?? `HTTP_${res.status}`, detail: j.detail } };
    }
    return { ok: true, data: text };
  },
};

export function dropsToXrp(drops: string | number | undefined, dp = 6): string {
  const n = Number(drops ?? 0) / 1e6;
  return Number.isFinite(n) ? n.toFixed(dp).replace(/\.?0+$/, '') || '0' : '0';
}

export function shortHash(h?: string, head = 8, tail = 6): string {
  if (!h) return '—';
  return h.length > head + tail + 1 ? `${h.slice(0, head)}…${h.slice(-tail)}` : h;
}
