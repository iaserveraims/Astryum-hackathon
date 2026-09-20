/**
 * institutional/api — typed client of /api/institutional (prepare-only).
 *
 * Every POST can come back as a typed REFUSAL (409: pre-flight verdicts,
 * credential gate, CLAIM_NOT_READY) and the surfaces paint those verdicts —
 * they are the product speaking, not errors to swallow. The DENIED moment of
 * scene 4 is literally one of these refusals rendered large.
 */

import { getApiBase } from '../env';
import { PasskeyAccountError } from './passkeyErrors';
import { noteCouncilOrderDelivery, noteFlareInstructionDelivery } from '../xaman/liveRequests';
import { notePayloadExpiryMin } from '../wallet/handoffRelease';

const API_BASE = getApiBase();

/**
 * Un `fetch` con TOPE (2026-09-11). El catálogo y el estado de pote pueden
 * quedarse colgados minutos si el backend está escaneando en frío o el RPC
 * público limita: sin tope, el cometa de Running giraba hasta que el proxy
 * cortaba. Con tope, la espera muerta se convierte en «no pude leer» a tiempo.
 */
function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortController === 'undefined') return undefined;
  const c = new AbortController();
  setTimeout(() => c.abort(new Error(`timeout ${ms}ms`)), ms);
  return c.signal;
}
const CATALOG_TIMEOUT_MS = 60_000;
const POTE_STATE_TIMEOUT_MS = 30_000;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// ── shapes (mirror of the backend service) ──────────────────────────────────

export interface PoteVenue {
  id: number;
  target: string;
  kind: 'erc4626' | 'compoundv2' | 'erc4626queued';
  readyAt: number;
  retired: boolean;
  basis: string;
  value: string;
  queuedTotal: string;
}

export interface PoteTicket {
  id: number;
  receiver: string;
  assets: string;
  maturity: number;
  claimed: boolean;
}

export interface PoteState {
  pote: string;
  name: string;
  symbol: string;
  shareDecimals: number;
  asset: { address: string; symbol: string; decimals: number };
  totalAssets: string;
  totalSupply: string;
  sharePrice: string;
  cooldownSeconds: number;
  bufferFloorBps: number;
  /** Tope de posición por cuenta, en unidades base (V2). '0' = sin tope; null = el pote no lo expone (v1). */
  maxDepositPerUser?: string | null;
  freeBalance: string;
  earmarkedAssets: string;
  totalClaimable: string;
  maxVenueBps: number;
  venues: PoteVenue[];
  tickets: PoteTicket[];
  governance: {
    council: string;
    constitutionRef: string;
    /** El director EFECTIVO: en un pote v2 es el de la jaula (el asiento del pote está vacío por diseño). */
    director: string;
    directorUntil: number;
    payees: Array<{ account: string; bps: number }>;
    /** La jaula que gobierna este pote (v2), o null si el consejo es un bridge directo (v1). */
    cage?: string | null;
  };
  holder?: { address: string; shares: string };
}

export interface UnsignedCall {
  to: string;
  data: string;
  value: string;
  chainId: number;
  label: string;
}

export interface Disclosure {
  disclosedToUser: true;
  title: string;
  lines: string[];
}

export interface Refusal {
  status: number;
  error: string;
  detail?: string;
  /** CLAIM_NOT_READY extras */
  maturity?: number;
  remainingSeconds?: number;
  /**
   * Seat refusals of a 0xFE prepare (it.14, R5 1.6): `true` ⇔ this session may
   * free the seat by displacing the unsigned draft that holds it. Absent = the
   * server did not say, which is NOT permission (lib/xaman/seatRefusal).
   */
  retryable?: boolean;
  /** How long the draft holding the seat can still be signed. */
  secondsLeft?: number;
  /**
   * it.16 (R5 5.4): the memo of the 0xFE that HOLDS the seat. The server sends
   * it ONLY to the session that prepared that payment or that proves the
   * account — it names a payment — and with it the screen can offer «Free the
   * seat» instead of a ~604 s wait (`lib/xaman/seatRefusal`).
   */
  memoHex?: string;
  /** The ledger the draft dies at, when the server sends it (diagnostic only). */
  lastLedgerSequence?: number;
  /** Some routes name the code `code` rather than `error`; both are read. */
  code?: string;
  /** 409 SAME_ORDER_RECENTLY_LAUNCHED: how long ago the same order went out. */
  minutesAgo?: number;
  /** The same, as an instant, when the server sends one instead. */
  launchedAt?: string;
  /** /multisign/prepare: why the server could not classify the tx as an exit. */
  exitClassification?: string;
  /**
   * it. 21 (it. 20 §3.5) — THE `Retry-After` NOBODY WAS READING.
   *
   * `ACCOUNT_BUSY` answers 503 WITH a `Retry-After` header, and
   * `PROOF_STORE_UNREADABLE` answers 503 promising «try again» — and the screens
   * showed neither a button nor a number, only the server's `detail`. Both the
   * header and any body field are read here so `describeRetryableRefusal`
   * (lib/xaman/seatRefusal) can say when, not just that.
   */
  retryAfterSeconds?: number;
  /**
   * it. 21 (it. 20 §2.7) — 409 `DUPLICATE_CHECK_UNREADABLE` names its own escape.
   * `true` ⇔ the server will accept the same compose again with
   * `confirmAnotherOrder: true`. Rendered as a SEPARATE decision from the retry.
   */
  confirmAnotherOrder?: boolean;
  /** Everything else the server answered, for readers that need an unnamed field. */
  body?: Record<string, unknown>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; refusal: Refusal };

async function post<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  const res = await fetch(`${API_BASE}/institutional${path}`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const resBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // it. 21 (§3.9): the server owns the payload's expiry, and every prepare that
  // composes a 0xFE answers it. Learnt here so the next mint uses ITS number.
  // it. 27 (§3): …AGAINST THE MEMO IT BELONGS TO. Without it the number was only
  // ever learnt tab-wide, and a ceremony's 1440 is above the ordinary clamp — so
  // this door, which is precisely the one that composes a council pote's exit,
  // dropped the very value the sitting needs and the payload fell back to a
  // hand-written constant. The row's own answer carries the memo; it travels.
  // it. 31 (§5): …and whether that window was READ or merely defaulted
  // (`signerListRead`), so a short window alone never passes for a verdict.
  notePayloadExpiryMin(resBody.payloadExpiryMin, resBody.memoHex, resBody.signerListRead);
  if (!res.ok) {
    // it. 21 (§3.5): 503 + `Retry-After` is the server telling us WHEN. The
    // header is the authority; a body field is the fallback.
    // Defensive: a hand-built response in a test (and an older polyfill) may
    // carry no `headers` at all, and a missing header is not a reason to throw
    // inside a refusal path — the body's own field still speaks.
    const headerRetry = Number(res.headers?.get?.('Retry-After'));
    const bodyRetry = resBody.retryAfterSeconds ?? resBody.retryAfter;
    const retryAfterSeconds =
      Number.isFinite(headerRetry) && headerRetry > 0
        ? Math.round(headerRetry)
        : typeof bodyRetry === 'number' && Number.isFinite(bodyRetry) && bodyRetry > 0
          ? Math.round(bodyRetry)
          : undefined;
    return {
      ok: false,
      refusal: {
        status: res.status,
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
        confirmAnotherOrder: resBody.confirmAnotherOrder === true ? true : undefined,
        body: resBody,
        error: String(resBody.error ?? `HTTP ${res.status}`),
        detail: typeof resBody.detail === 'string' ? resBody.detail : undefined,
        maturity: typeof resBody.maturity === 'number' ? resBody.maturity : undefined,
        remainingSeconds: typeof resBody.remainingSeconds === 'number' ? resBody.remainingSeconds : undefined,
        retryable: typeof resBody.retryable === 'boolean' ? resBody.retryable : undefined,
        secondsLeft: typeof resBody.secondsLeft === 'number' ? resBody.secondsLeft : undefined,
        // it.16 (R5 5.4): read defensively — absent on every route that has not
        // caught up, and absent on purpose for a session that does not own the seat.
        memoHex: typeof resBody.memoHex === 'string' ? resBody.memoHex : undefined,
        lastLedgerSequence: typeof resBody.lastLedgerSequence === 'number' ? resBody.lastLedgerSequence : undefined,
        code: typeof resBody.code === 'string' ? resBody.code : undefined,
        minutesAgo: typeof resBody.minutesAgo === 'number' ? resBody.minutesAgo : undefined,
        launchedAt: typeof resBody.launchedAt === 'string' ? resBody.launchedAt : undefined,
        exitClassification: typeof resBody.exitClassification === 'string' ? resBody.exitClassification : undefined,
      },
    };
  }
  // A composed 0xFE: what the server said about the executor that carries it to
  // Flare, so the global banner promises a delivery only when somebody said the
  // executor runs (it.14, R2 2.6). A body that is not a 0xFE is ignored in there.
  //
  // it. 19 (R3 N4 / R5 R7) — READ DEFENSIVELY, AND SAY IT ONCE FOR BOTH SHAPES.
  // `serverDelivery.executorEnabled` first, a top-level `executorEnabled` after,
  // and NOTHING invented when neither travels: the registry keeps «nobody told
  // us» apart from «the executor is stopped», because only the second accuses
  // anyone. The exits of a pote (`/pote-exit`, `/pote-claim-exit`,
  // `/pote-creator-exit`) come through HERE, so the day their routes start
  // sending the field the banner picks it up with no further wiring.
  const composed = (resBody.xrplTx ?? resBody.xrplPayment) as unknown;
  const declared =
    (resBody.serverDelivery as { executorEnabled?: unknown; recorded?: unknown } | undefined) ??
    (typeof resBody.executorEnabled === 'boolean' ? { executorEnabled: resBody.executorEnabled } : undefined);
  noteFlareInstructionDelivery(composed, declared);
  // A COUNCIL ORDER is a Payment with a 32-byte memo, not a `FE…` one: the call
  // above ignores it, so the other half of the same truth is told here. Each
  // note ignores the other's transaction shape.
  noteCouncilOrderDelivery(composed, declared);
  return { ok: true, data: resBody as T };
}

// ── reads ────────────────────────────────────────────────────────────────────

/**
 * Un pote del catálogo, tal y como lo devuelve `GET /institutional/potes`
 * (AstryumPoteCatalogService, leído de la factory on-chain).
 *
 * `unreadable` NO es «vacío» ni «roto»: es «ahora no se sabe». Se pinta igual,
 * marcado — esconderlo lo borraría del catálogo de su propio dueño sin decir
 * por qué, que es lo que pasó con la jaula sin registrar el 22-ago.
 */
export interface PoteCatalogEntry {
  pote: string;
  name: string | null;
  symbol: string | null;
  asset: { address: string; symbol: string; decimals: number } | null;
  totalAssets: string | null;
  cooldownSeconds: number | null;
  bufferFloorBps: number | null;
  maxVenueBps: number | null;
  venues: Array<{ id: number; target: string; kind: number; readyInSeconds: number; retired: boolean }>;
  councilXrplAddress: string | null;
  gated: boolean;
  unreadable: boolean;
  /** 'v1' = pote suelto de la factory de potes · 'v2' = pote de una JAULA. */
  generation?: 'v1' | 'v2';
  /** La jaula que lo gobierna (solo v2). */
  cage?: string | null;
  /** Tope de posición por cuenta, en base units (V2). '0' = sin tope; null = no lo expone. */
  maxDepositPerUser?: string | null;
  /**
   * El tick, leído del ledger XRPL. `null` significa **no lo sé**: puede que no
   * tenga credencial o puede que la lectura fallara — el backend los junta a
   * propósito, porque no saberlo no es saber que no. Nunca pintar «sin
   * verificar» a partir de este null.
   */
  credential?: { issuer: string; type: string; state: string } | null;
}

/**
 * El catálogo entero, en ORDEN DE CREACIÓN. No reordenar aquí: ordenar es
 * elegir, y elegir por el usuario es la diferencia entre publicar un catálogo y
 * recomendar un producto.
 */
export async function listPotes(withCredentials = false): Promise<PoteCatalogEntry[]> {
  // La lista PELADA se comparte (2026-09-11): el shell, la estantería de
  // Running, las wallets y la comunidad la piden en la misma carga — antes eran
  // cuatro descargas del catálogo entero y cuatro escaneos en el backend.
  // Con credenciales (la directory) va aparte: consulta el ledger XRPL por consejo.
  if (!withCredentials) return listPotesShared();
  return fetchPotes('?withCredentials=1');
}

/** El servidor contesta 202 «calentando» mientras lee el catálogo en frío
 *  (tras un arranque). Se vuelve a preguntar cada pocos segundos, hasta 10
 *  min: la espera se ve como lectura (cometa), no como fallo. */
const CATALOG_WARM_POLL_MS = 5_000;
const CATALOG_WARM_MAX_MS = 10 * 60_000;

async function fetchPotes(qs: string): Promise<PoteCatalogEntry[]> {
  const startedAt = Date.now();
  for (;;) {
    const res = await fetch(`${API_BASE}/institutional/potes${qs}`, {
      headers: authHeaders(),
      credentials: 'include',
      signal: timeoutSignal(CATALOG_TIMEOUT_MS),
    });
    if (res.status === 202) {
      if (Date.now() - startedAt > CATALOG_WARM_MAX_MS) throw new Error('CATALOG_WARMING_TIMEOUT');
      await new Promise((r) => setTimeout(r, CATALOG_WARM_POLL_MS));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { potes?: PoteCatalogEntry[] } | PoteCatalogEntry[];
    return Array.isArray(body) ? body : (body.potes ?? []);
  }
}

const POTES_TTL_MS = 30_000;
let potesCache: { at: number; value: PoteCatalogEntry[] } | null = null;
let potesInflight: Promise<PoteCatalogEntry[]> | null = null;

function listPotesShared(): Promise<PoteCatalogEntry[]> {
  if (potesCache && Date.now() - potesCache.at < POTES_TTL_MS) return Promise.resolve(potesCache.value);
  if (potesInflight) return potesInflight;
  const p = fetchPotes('')
    .then((value) => {
      potesCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      if (potesInflight === p) potesInflight = null;
    });
  potesInflight = p;
  return p;
}

/** Tras una escritura (entrar, salir, crear): la siguiente lectura va al servidor. */
export function invalidatePotesCatalog(): void {
  potesCache = null;
}

export async function getPoteState(pote: string, account?: string): Promise<PoteState> {
  const qs = account ? `?pote=${pote}&account=${account}` : `?pote=${pote}`;
  const res = await fetch(`${API_BASE}/institutional/pote-state${qs}`, {
    headers: authHeaders(),
    credentials: 'include',
    signal: timeoutSignal(POTE_STATE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PoteState;
}

export interface CredentialGateRead {
  pote: string;
  gated: boolean;
  open?: boolean;
  issuerAllowlistConfigured?: boolean;
  credentials?: Array<{ issuer: string; credentialType: string; state: string; expiresAtISO: string | null }>;
}

export async function getCredentialGate(pote: string, account: string): Promise<CredentialGateRead> {
  const res = await fetch(
    `${API_BASE}/institutional/credential-gate?pote=${pote}&account=${encodeURIComponent(account)}`,
    { headers: authHeaders(), credentials: 'include' }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as CredentialGateRead;
}

// ── prepares ─────────────────────────────────────────────────────────────────

export interface PreparedCalls {
  calls: UnsignedCall[];
  disclosure: Disclosure;
}

export function prepareDeposit(input: {
  pote: string;
  amountBase: string;
  receiver: string;
  xrplAccount?: string;
}): Promise<ApiResult<PreparedCalls>> {
  return post('/pote-deposit/prepare', input);
}

export interface PreparedRedeem extends PreparedCalls {
  mode: 'sync' | 'request';
  estAssetsBase?: string;
  maturityISO?: string;
}

export function prepareRedeem(input: {
  pote: string;
  sharesBase: string;
  receiver: string;
  owner: string;
}): Promise<ApiResult<PreparedRedeem>> {
  return post('/pote-redeem/prepare', input);
}

export interface PreparedClaim extends PreparedCalls {
  venueClaims: Array<{ venueId: number; period: number }>;
  notes: string[];
}

export function prepareClaimRedeem(input: { pote: string; ticketId: number }): Promise<ApiResult<PreparedClaim>> {
  return post('/pote-claim-redeem/prepare', input);
}

export function prepareDirect(input: {
  pote: string;
  venueId: number;
  amountBase: string;
}): Promise<ApiResult<PreparedCalls>> {
  return post('/pote-direct/prepare', input);
}

export function prepareRecall(input: {
  pote: string;
  venueId: number;
  amountBase: string;
}): Promise<ApiResult<PreparedCalls>> {
  return post('/pote-recall/prepare', input);
}

// ── ceremonia de credencial (escena 2: emisor crea, sujeto acepta) ──────────

export interface PreparedCredentialTx {
  txjson: Record<string, unknown>;
  signer: 'issuer' | 'subject';
  disclosure: Disclosure;
}

export function prepareCredentialIssue(input: {
  issuer: string;
  subject: string;
  credentialType?: string;
  expirationDays?: number;
  /** Enlace (https/ipfs) a la VC/QEAA del emisor; viaja como URI de la XLS-70. */
  uri?: string;
}): Promise<ApiResult<PreparedCredentialTx>> {
  return post('/credential-issue/prepare', input);
}

export function prepareCredentialAccept(input: {
  issuer: string;
  subject: string;
  credentialType?: string;
}): Promise<ApiResult<PreparedCredentialTx>> {
  return post('/credential-accept/prepare', input);
}

// ── el perfil PÚBLICO del gestor (auto-declarado + hechos del ledger) ───────

/** Persona o agente de IA — auto-declarado por el dueño probado de la cuenta. */
export type ActorKind = 'human' | 'agent';

export interface ManagerPublicProfileData {
  account: string;
  profile: {
    displayName: string;
    entity?: string | null;
    bio?: string | null;
    avatarUrl?: string | null;
    website?: string | null;
    twitter?: string | null;
    actorKind?: ActorKind;
    updatedAtISO: string;
  } | null;
  /** HECHOS del ledger: credenciales vigentes, hasta cuándo, y su prueba (URI). */
  credentials: Array<{ type: string; issuer: string; expiresAtISO: string | null; uri: string | null }>;
  /** El recuento PÚBLICO de apoyos (servidor), y si el usuario logueado apoya. */
  endorsements?: number;
  endorsedByMe?: boolean;
}

export async function readManagerProfile(account: string): Promise<ManagerPublicProfileData> {
  const res = await fetch(`${API_BASE}/institutional/manager-profile?account=${encodeURIComponent(account)}`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ManagerPublicProfileData;
}

export function saveManagerProfile(input: {
  account: string;
  displayName: string;
  entity?: string;
  bio?: string;
  avatarUrl?: string;
  website?: string;
  twitter?: string;
  actorKind?: ActorKind;
  /** true = el servidor copia la foto de la CUENTA (Settings → Perfil) como avatar del gestor. */
  useAccountAvatar?: boolean;
}): Promise<ApiResult<{ ok: true; account: string; updatedAtISO: string }>> {
  return post('/manager-profile', input);
}

// ── la COMUNIDAD (fundador 8-sep): quién lleva bóvedas, con cara y con apoyos ─

export interface CommunityActor {
  account: string;
  profile: {
    displayName: string;
    entity?: string | null;
    bio?: string | null;
    avatarUrl?: string | null;
    website?: string | null;
    twitter?: string | null;
    actorKind: ActorKind;
    updatedAtISO: string;
  } | null;
  /** Recuento público de apoyos: lo cuenta el servidor, jamás un navegador. */
  endorsements: number;
  endorsedByMe: boolean;
}

export type VaultImageKind = 'emblem' | 'profile' | 'none';

/** La imagen elegida para un pote por el dueño probado de su consejo. */
export interface VaultImageRecord {
  pote: string;
  /** El consejo que la puso. SOLO se aplica si coincide con el consejo del pote en el catálogo. */
  account: string;
  kind: VaultImageKind;
  emblem: string | null;
}

export async function readCommunity(): Promise<{ actors: CommunityActor[]; vaultImages: VaultImageRecord[] }> {
  const res = await fetch(`${API_BASE}/institutional/community`, { headers: authHeaders(), credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { actors: CommunityActor[]; vaultImages: VaultImageRecord[] };
}

/** Apoyar (o retirar el apoyo) a un gestor: un voto por usuario, contado en el servidor. */
export function endorseManager(input: { account: string; on: boolean }): Promise<ApiResult<{ ok: true; account: string; endorsements: number; endorsedByMe: boolean }>> {
  return post('/manager-endorse', input);
}

/** La imagen de una bóveda: emblema de la casa, tu foto de perfil, o ninguna (el interrogante). */
export function saveVaultImage(input: { account: string; pote: string; kind: VaultImageKind; emblem?: string }): Promise<ApiResult<{ ok: true; pote: string; kind: VaultImageKind; emblem: string | null }>> {
  return post('/vault-image', input);
}

// ── detección de realidad para el wizard (el ledger manda, la UI re-detecta) ─

/** ¿Está anclada la constitución de esta cuenta (DID XLS-40)? */
export async function readCouncilAnchor(account: string): Promise<{ anchored: boolean; sha256?: string; uri?: string }> {
  const res = await fetch(`${API_BASE}/institutional/council/anchor?account=${encodeURIComponent(account)}`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { anchored: boolean; sha256?: string; uri?: string };
}

/** ¿Tiene esta cuenta su jaula nacida en la factory? (null = aún no) */
/** Un nacimiento FIRMADO que la factory aún no conoce: «ya firmaste, no hay nada que firmar». */
export interface BirthInFlight {
  signedAt: string;
  signedTxHash: string | null;
}

export async function readCouncilCage(council: string): Promise<{ cage: string | null; birthInFlight: BirthInFlight | null }> {
  const res = await fetch(`${API_BASE}/institutional/cages?council=${encodeURIComponent(council)}`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { cage?: { cage?: string } | string | null; birthInFlight?: { signedAt?: unknown; signedTxHash?: unknown } | null };
  const c = body.cage;
  const b = body.birthInFlight;
  const birthInFlight: BirthInFlight | null =
    b && typeof b.signedAt === 'string' ? { signedAt: b.signedAt, signedTxHash: typeof b.signedTxHash === 'string' ? b.signedTxHash : null } : null;
  return { cage: typeof c === 'string' ? c : (c?.cage ?? null), birthInFlight };
}

// ── el registro de venues de Astryum (el scanner) — leer y gobernar ─────────

export interface RegistryVenueRow {
  chainId: number;
  target: string;
  kind: 'erc4626' | 'compoundv2' | 'erc4626queued' | 'unknown';
  kindCode: number;
  status: 'active' | 'pending' | 'removed';
  activeAt: number;
}

export interface VenueRegistryState {
  registry: string;
  timelockSeconds: number;
  governor: string;
  venues: RegistryVenueRow[];
}

export async function readVenueRegistry(): Promise<VenueRegistryState> {
  const res = await fetch(`${API_BASE}/institutional/venue-registry`, { headers: authHeaders(), credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as VenueRegistryState;
}

export interface PreparedEvmCall {
  call: { to: string; data: string; value: string; chainId: number; label: string };
  disclosure: Disclosure;
}

export function prepareVenuePropose(input: { target: string; kind: string | number; chainId?: number }): Promise<ApiResult<PreparedEvmCall>> {
  return post('/venue-registry/propose/prepare', input);
}

export function prepareVenueActivate(input: { target: string; chainId?: number }): Promise<ApiResult<PreparedEvmCall>> {
  return post('/venue-registry/activate/prepare', input);
}

export function prepareVenueRemove(input: { target: string; chainId?: number }): Promise<ApiResult<PreparedEvmCall>> {
  return post('/venue-registry/remove/prepare', input);
}

// ── nacimiento del pote (escena 1): una firma del consejo XRPL ──────────────

export interface PoteBirthHandoff {
  account: string;
  which: 'A' | 'B';
  predicted: { bridge: string; vault: string };
  factory: string;
  personalAccount: string;
  xrplPayment: Record<string, unknown>;
  memoHex: string;
  userOpData: string;
  net: { grossXrp: string; supplyUBA: string; firstPrincipalXrp: string };
  disclosure: Disclosure & { facts?: Record<string, unknown> };
}

export function preparePoteCreate(input: {
  account: string;
  amountXrp: string;
  which: 'A' | 'B';
}): Promise<ApiResult<PoteBirthHandoff>> {
  return post('/pote-create/prepare', input);
}

// ── entrada/salida atómicas XRP↔pote (0xFE) ─────────────────────────────────

export interface XrpFundHandoff {
  account: string;
  pote: string;
  receiver: string;
  xrplPayment: Record<string, unknown>;
  memoHex: string;
  userOpData: string;
  personalAccount: string;
  net: { grossXrp: string; supplyUBA: string; fxrp: string };
  disclosure: Disclosure & { facts?: Record<string, unknown> };
}

/**
 * Meter XRP en el pote con UNA firma en Xaman.
 *
 * `receiver` es OPCIONAL desde el 24-ago. Sin él, las participaciones van a la
 * Personal Account que le corresponde a esa cuenta XRPL — resuelta on-chain por
 * el backend, no tecleada aquí. Es el modo no-custodial: no hay nada que copiar
 * y por tanto nada que copiar mal.
 *
 * Se sigue pudiendo pasar (modo custodial: el operador deposita a nombre de su
 * cliente), y entonces el disclosure lo advierte con todas las letras.
 */
export function preparePoteFundXrp(input: {
  account: string;
  pote: string;
  amountXrp: string;
  receiver?: string;
}): Promise<ApiResult<XrpFundHandoff>> {
  return post('/pote-fund-xrp/prepare', input);
}

/**
 * MISMA firma Xaman, SIN mint: mete en el pote el FXRP que la Personal Account
 * YA tiene (fromSmartAccount). El pago XRPL es solo el carrier del 0xFE; su mint
 * neto se une al FXRP existente. `amountFxrp` es lo que ya hay en la PA.
 */
export function preparePoteFundFromPa(input: {
  account: string;
  pote: string;
  amountFxrp: string;
  carrierXrp: string;
  receiver?: string;
}): Promise<ApiResult<XrpFundHandoff>> {
  return post('/pote-fund-xrp/prepare', { ...input, fromSmartAccount: true });
}

/** El FXRP LIBRE que la Personal Account ya tiene (para el carril «pagar con
 *  FXRP de la PA, sin mint»). null si no se pudo leer — sin cifra, sin toggle. */
export async function readPaFreeFxrp(personalAccount: string): Promise<number | null> {
  try {
    const res = await fetch(`${API_BASE}/flare-demo/pa-fxrp/${encodeURIComponent(personalAccount)}`, {
      headers: authHeaders(),
      credentials: 'include',
    });
    if (!res.ok) return null;
    const b = (await res.json()) as { freeFxrp?: number };
    return typeof b.freeFxrp === 'number' && Number.isFinite(b.freeFxrp) ? b.freeFxrp : null;
  } catch {
    return null;
  }
}

/** La vuelta completa: sale del pote y se desmintea a XRP, en una sola firma. */
export interface PoteExitHandoff {
  account: string;
  pote: string;
  personalAccount: string;
  /**
   * Lo que el backend COMPUSO (la unidad del copy sale de aquí, `exitCopy`):
   * 'sync' = redeem + unmint a XRP ahora; 'sync-fxrp' = redeem, el FXRP se queda
   * en la PA; 'request' = pote con cooldown, abre ticket; 'claim' = cobro de ticket.
   */
  mode?: 'sync' | 'sync-fxrp' | 'request' | 'claim';
  /** true solo si el lote desmintea a XRP nativo (sync, y claim con unmint). */
  unminted?: boolean;
  /** Cuándo será reclamable el ticket (solo en 'request'). */
  maturityISO?: string;
  xrplTx: Record<string, unknown>;
  memoHex: string;
  userOpData: string;
  /** A council-signed exit forwards this to /multisign/prepare (no classification needed). */
  exitToken?: string | null;
  exitTokenExpiresAt?: string;
  exit: {
    sharesBase: string;
    sharesHuman: string;
    previewedUBA: string;
    unmintUBA: string;
    marginUBA: string;
    marginBps: number;
    /**
     * GROSS — before the FAssets redemption fee (it.14, R3 3.2). It used to
     * arrive already net while three screens subtracted the fee again: two
     * different «net» figures on the same card. The net one has its own field.
     */
    xrpOutHuman: string;
    /** NET of the redemption fee, computed by the server. Absent = it could not size it. */
    xrpOutNetHuman?: string;
    /** true = queda saldo en el pote después de esta salida. */
    partial: boolean;
  };
  disclosure: Disclosure & { facts?: Record<string, unknown> };
}

/**
 * Sacar el capital del pote de vuelta a la cuenta XRPL, en una firma.
 *
 * El destino NO se pasa: es siempre la misma `account` que firma. El capital
 * vuelve por donde vino, y quien quiera moverlo a otro sitio lo hace después
 * desde su propia wallet.
 *
 * `sharesBase` es opcional — sin él sale todo lo que se pueda ahora mismo
 * (`maxRedeem`, que ya está capado por el colchón líquido del pote).
 */
export function preparePoteExit(input: {
  account: string;
  pote: string;
  sharesBase?: string;
  amountXrpForMint?: string;
  marginBps?: number;
  /** true = además desmintea a XRP nativo; por defecto el FXRP se queda en la PA. */
  unmint?: boolean;
}): Promise<ApiResult<PoteExitHandoff>> {
  return post('/pote-exit/prepare', input);
}

/**
 * COBRAR un ticket de salida de cola por 0xFE: la PA hace `claimRedeem` y
 * desmintea a XRP en la misma firma Xaman. Solo para tickets cuyo receiver es tu
 * Personal Account (el segundo paso de la salida no-custodial en potes de cola).
 */
export function preparePoteClaimExit(input: {
  account: string;
  pote: string;
  ticketId: number;
  amountXrpForMint?: string;
  marginBps?: number;
  /** true = además desmintea a XRP nativo; por defecto el FXRP se queda en la PA. */
  unmint?: boolean;
}): Promise<ApiResult<PoteExitHandoff>> {
  return post('/pote-claim-exit/prepare', input);
}

export interface XrpExitPrepared {
  call: UnsignedCall;
  mode?: 'redeemWithTag' | 'redeemAmount';
  tag?: number | null;
  tagSource?: 'registry' | 'client' | 'none';
  disclosure: Disclosure;
}

/**
 * What the server took on for a composed council order (it.13). Only
 * `recorded && executorEnabled` means the relay watcher delivers it to Flare
 * without this screen; anything else — or the field absent (older backend) —
 * means the screen that signs it is the one that must see it delivered.
 */
export interface CouncilOrderServerDelivery {
  recorded: boolean;
  executorEnabled: boolean;
}

/** The notes every council-order prepare may carry besides the order itself. */
export interface CouncilOrderServerNotes {
  serverDelivery?: CouncilOrderServerDelivery;
  /** Exits only, when the server could not remember the order: keep the screen open or relay by hash. */
  recoveryWarning?: string;
  /** Exits only: another order of this account is already in flight. */
  inFlightWarning?: string;
  /**
   * Exits only (it.14, K2): the SAME order (same action, same parameters) was
   * launched for this council a moment ago. An exit is never refused, so it
   * travels as a warning beside `recoveryWarning` — the person checks the other
   * one before signing this, or the capital moves twice.
   */
  duplicateWarning?: string;
  /** Exits only: the token that lets /multisign/prepare take the exit door for exactly this tx. */
  exitToken?: string | null;
  /** When that token stops verifying (15 min). */
  exitTokenExpiresAt?: string;
}

/** 409 of a non-exit prepare when the SAME order was launched for this council a moment ago. */
export const SAME_ORDER_RECENTLY_LAUNCHED = 'SAME_ORDER_RECENTLY_LAUNCHED';
/** The it.13 name of the same refusal (guard by TIME, not by content) — still answered by older deploys. */
export const COUNCIL_ORDER_IN_FLIGHT = 'COUNCIL_ORDER_IN_FLIGHT';
/** 409 del nacimiento de la jaula: el 0xFE ya firmado sigue en vuelo (2026-09-15). */
export const CAGE_BIRTH_IN_FLIGHT = 'CAGE_BIRTH_IN_FLIGHT';
/** 429: this council's queue of live orders is full. */
export const TOO_MANY_PENDING_ORDERS = 'TOO_MANY_PENDING_ORDERS';

/**
 * Is this refusal «the same order already went out» — the one the person may
 * override with `confirmAnotherOrder`? Both names are read: it.14 replaced the
 * time-based guard (`COUNCIL_ORDER_IN_FLIGHT`) with the content-based one, and a
 * frontend that only knew the new name would swallow the old deploy's 409 into
 * the generic refusal panel, with no way to confirm.
 */
export function isCouncilOrderInFlight(r: { status?: number; error?: string } | null | undefined): boolean {
  return !!r && (r.error === SAME_ORDER_RECENTLY_LAUNCHED || r.error === COUNCIL_ORDER_IN_FLIGHT || r.error === CAGE_BIRTH_IN_FLIGHT);
}

/** Is this the 429 «this council already has too many live orders»? */
export function isTooManyPendingOrders(r: { status?: number; error?: string } | null | undefined): boolean {
  return !!r && r.error === TOO_MANY_PENDING_ORDERS;
}

/** 409: the duplicate check could NOT RUN — retryable, and it names its own escape. */
export const DUPLICATE_CHECK_UNREADABLE = 'DUPLICATE_CHECK_UNREADABLE';

/**
 * it. 21 (it. 20 §2.7) — is this «we could not check», as opposed to «we checked
 * and it is a repeat»? The two arrive at the same door and need OPPOSITE
 * sentences: one names a duplicate that exists, the other admits we never
 * looked. Conflating them would have the screen assert a fact nobody has.
 */
export function isDuplicateCheckUnreadable(r: { error?: string; code?: string } | null | undefined): boolean {
  return !!r && (r.error === DUPLICATE_CHECK_UNREADABLE || r.code === DUPLICATE_CHECK_UNREADABLE);
}

/**
 * Both refusals the person may answer with `confirmAnotherOrder: true`. The
 * consoles gate on THIS, so a deploy that starts sending the 409 of a check it
 * could not run does not silently lose its affordance in the generic panel.
 */
export function mayConfirmAnotherOrder(
  r: { status?: number; error?: string; code?: string } | null | undefined,
): boolean {
  return isCouncilOrderInFlight(r) || isDuplicateCheckUnreadable(r);
}

/**
 * How many minutes ago the same order went out, for the confirm's sentence:
 * `minutesAgo` when the server counts it, `launchedAt` when it sends the instant
 * instead. Null = it said neither, and the copy says «recently» rather than
 * inventing a number.
 */
export function sameOrderMinutesAgo(
  r: { minutesAgo?: unknown; launchedAt?: unknown } | null | undefined,
  now: number = Date.now(),
): number | null {
  const mins = r?.minutesAgo;
  if (typeof mins === 'number' && Number.isFinite(mins) && mins >= 0) return Math.max(0, Math.round(mins));
  const at = r?.launchedAt;
  if (typeof at === 'string' && at) {
    const ms = now - new Date(at).getTime();
    if (Number.isFinite(ms) && ms >= 0) return Math.max(0, Math.round(ms / 60_000));
  }
  return null;
}

export interface CouncilOrderPrepared extends CouncilOrderServerNotes {
  account: string;
  xrplTx: Record<string, unknown>;
  /** `orderData` = abi.encode(nonce, vaultCalldata): lo que `bridge.execute`
   *  necesita para ejecutar la orden en Flare. Se lo pasamos al relay tras firmar. */
  order: { summary: string; nonce: number; bridge: string; vault: string; orderData: string };
  disclosure: Disclosure & { note?: string };
}

/** Compone la orden de consejo XRPL para dirigir/recuperar (firma el consejo en Xaman). */
export async function preparePoteCouncilOrder(input: {
  council: string;
  action: 'direct-to' | 'recall';
  venueId: number;
  amount: string;
  /** Only after the person explicitly confirmed composing beside an order in flight (409 COUNCIL_ORDER_IN_FLIGHT). */
  confirmAnotherOrder?: boolean;
}): Promise<ApiResult<CouncilOrderPrepared>> {
  const res = await post<CouncilOrderPrepared>('/pote-council-order/prepare', input);
  // At prepare time, per order: what the banner may promise if its screen goes away.
  if (res.ok) noteCouncilOrderDelivery(res.data.xrplTx, res.data.serverDelivery);
  return res;
}

/**
 * Dispara el relay de la orden de consejo YA firmada: paga la prueba FDC y llama
 * a `bridge.execute` (el paso que faltaba — sin esto la orden se firma en XRPL
 * pero nunca se ejecuta en Flare). Fire-and-forget: el backend responde 202 y el
 * FDC tarda ~2-5 min. El endpoint vive en /xrpl-defi (infra de órdenes de Legacy).
 */
export async function relayCouncilOrder(
  xrplTxHash: string,
  orderData?: string,
): Promise<{ ok: boolean; status: number; detail?: string }> {
  const res = await fetch(`${API_BASE}/xrpl-defi/council-order/relay`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify({ xrplTxHash, orderData }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, detail: typeof body.detail === 'string' ? body.detail : undefined };
}

export type CouncilOrderFateState = 'unknown' | 'composed' | 'validated' | 'relaying' | 'executed' | 'failed';

export interface CouncilOrderFate {
  memo: string;
  state: CouncilOrderFateState;
  xrplTxHash?: string;
  detail?: string;
}

/** `ok:false` = could not read (503, any other non-OK, network, malformed body) — never «unknown». */
export type CouncilOrderFateRead = { ok: true; fate: CouncilOrderFate } | { ok: false; status: number };

const FATE_STATES: ReadonlySet<string> = new Set(['unknown', 'composed', 'validated', 'relaying', 'executed', 'failed']);

/** The fields of a fate body, and nothing invented. A state outside the vocabulary is unreadable. */
export function parseCouncilOrderFateBody(memo: string, data: unknown): CouncilOrderFateRead {
  const d = (data ?? {}) as { state?: unknown; xrplTxHash?: unknown; detail?: unknown; memo?: unknown };
  if (typeof d.state !== 'string' || !FATE_STATES.has(d.state)) return { ok: false, status: 0 };
  return {
    ok: true,
    fate: {
      memo: typeof d.memo === 'string' && d.memo ? d.memo : memo,
      state: d.state as CouncilOrderFateState,
      ...(typeof d.xrplTxHash === 'string' && d.xrplTxHash ? { xrplTxHash: d.xrplTxHash } : {}),
      ...(typeof d.detail === 'string' && d.detail ? { detail: d.detail } : {}),
    },
  };
}

/**
 * GET /institutional/council-order/fate?memo=<hex> — what became of a composed
 * council order (it.13): read after a stale verdict, BEFORE offering to prepare
 * it again, because the pinned seat may have been spent by a sibling request of
 * the same order that is being delivered right now.
 */
export async function readCouncilOrderFate(memo: string, fetchImpl: typeof fetch = fetch): Promise<CouncilOrderFateRead> {
  try {
    const res = await fetchImpl(`${API_BASE}/institutional/council-order/fate?memo=${encodeURIComponent(memo)}`, {
      headers: authHeaders(),
      credentials: 'include',
    });
    if (!res.ok) return { ok: false, status: res.status };
    return parseCouncilOrderFateBody(memo, await res.json());
  } catch {
    return { ok: false, status: 0 };
  }
}

export interface CreatorExitPrepared {
  account: string;
  pote: string;
  personalAccount: string;
  xrplTx: Record<string, unknown>;
  memoHex: string;
  userOpData: string;
  /** The exit token of this composed 0xFE: forwarded to /multisign/prepare so a
   *  council quorum can sign the exit without depending on any classification. */
  exitToken?: string | null;
  exitTokenExpiresAt?: string;
  redeem: { shares: string; estFxrp: string };
  order: { summary: string };
  disclosure: Disclosure & { note?: string };
}

/**
 * Compone el 0xFE que saca el capital GÉNESIS del creador (la PA del consejo
 * redime sus participaciones → FXRP fuera del pote). Lo firma el quórum del
 * consejo en Xaman; Astryum no firma.
 */
export function preparePoteCreatorExit(input: {
  account: string;
  pote?: string;
  amountXrpForMint?: string;
  /** Solo si el 0xFE anterior en ese asiento de nonce NO se firmó (regla dura). */
  supersede?: boolean;
}): Promise<ApiResult<CreatorExitPrepared>> {
  return post('/pote-creator-exit/prepare', input);
}

export interface CouncilAnchorPrepared {
  account: string;
  xrplTx: Record<string, unknown>;
  disclosure: Disclosure & { note?: string };
}

export function prepareCouncilAnchor(input: {
  account: string;
  documentSha256Hex: string;
  documentUri?: string;
}): Promise<ApiResult<CouncilAnchorPrepared>> {
  return post('/council/anchor/prepare', input);
}

export function preparePoteExitXrp(input: {
  amountFxrpBase: string;
  xrplDestination: string;
  /** Si viene: redeemWithTag → el XRP llega al omnibus del exchange con el tag del user. */
  destinationTag?: number;
  /** pote + holder → el backend saca el tag del registro on-chain (userGate→tagOf). */
  pote?: string;
  holder?: string;
}): Promise<ApiResult<XrpExitPrepared>> {
  return post('/pote-exit-xrp/prepare', input);
}

// ── passkey del usuario: cuenta contrafactual + relay de la firma ───────────

export interface PasskeyAccountRead {
  account: string;
  deployed: boolean;
}

export async function getPasskeyAccount(pubKeyX: string, pubKeyY: string): Promise<PasskeyAccountRead> {
  let res: Response;
  try {
    res = await fetch(
      `${API_BASE}/institutional/passkey/account?x=${encodeURIComponent(pubKeyX)}&y=${encodeURIComponent(pubKeyY)}`,
      { headers: authHeaders(), credentials: 'include' }
    );
  } catch {
    throw new PasskeyAccountError(0, null);
  }
  if (!res.ok) {
    // El código del servidor decide el texto (sesión caducada ≠ ruta ausente ≠ RPC caído).
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new PasskeyAccountError(res.status, typeof body?.error === 'string' ? body.error : null);
  }
  return (await res.json()) as PasskeyAccountRead;
}

export interface RelayResult {
  account: string;
  deployedNow: boolean;
  deployTxHash?: string;
  execTxHash: string;
}

export function relayPasskeyBatch(input: {
  pubKeyX: string;
  pubKeyY: string;
  calls: Array<{ target: string; value: string; data: string }>;
  sig: { authenticatorData: string; clientDataPre: string; clientDataPost: string; r: string; s: string };
}): Promise<ApiResult<RelayResult>> {
  return post('/passkey/relay', input);
}

// ── La jaula v2 (AstryumCage) ────────────────────────────────────────────────

export interface CageTarget {
  chainId: number;
  target: string;
}

/**
 * El alta de un cliente en el registro KYC de un partner: el call SIN FIRMAR
 * (`setApprovedWithTag`). Lo firma el ADMIN del registro; Astryum jamás.
 */
export function prepareKycRegister(input: {
  registry: string;
  user: string;
  tag: number;
  approved?: boolean;
}): Promise<ApiResult<{ call: UnsignedCall; disclosure: Disclosure }>> {
  return post('/kyc/register/prepare', input);
}

/** Una jaula, tal y como la devuelve `GET /institutional/cages`. */
export interface CageSummary {
  cage: string;
  authority: string;
  asset: string;
  registry: string;
  treasury: string;
  creationFee: string;
  /** Política de Astryum: tope de payees que esta jaula puede dar a sus potes (2000 hoy). */
  maxPayeeBpsAllowed: number;
  /** Potes que nacen sin fee de creación (3 en esta generación) y cuántos quedan. */
  freePotes: number;
  freePotesLeft: number;
  /** true ⇔ nació sin lista propia: sigue al registro de Astryum tal y como esté. */
  registryOnly: boolean;
  chainId: number;
  constitutionRef: string;
  director: string;
  directorUntil: number;
  /** Vacía cuando `registryOnly`. */
  allowedTargets: CageTarget[];
  potes: string[];
  succeeded: boolean;
  successor: string;
  successorEta: number;
}

export type CageCatalogEntry = CageSummary | { cage: string; unreadable: true };

/** Los términos que Astryum fijó en la factory: lo que toda jaula hereda al nacer. */
export interface CageTerms {
  creationFee: string;
  treasury: string;
  registry: string;
  freePotesPerCage?: number;
  maxPayeeBpsAllowed?: number;
}

export type RegistryVenueStatus = 'active' | 'pending' | 'removed';
export type RegistryVenueKind = 'erc4626' | 'compoundv2' | 'erc4626queued' | 'unknown';

/** Una entrada de la whitelist de Astryum (el scanner), tal y como la publica la cadena. */
export interface RegistryVenue {
  chainId: number;
  target: string;
  kind: RegistryVenueKind;
  kindCode: number;
  status: RegistryVenueStatus;
  activeAt: number;
}

/**
 * La whitelist de Astryum, leída de la cadena, en orden de alta y con estado.
 * Es lo que un gestor ve al elegir dónde puede trabajar su pote. Lanza si no se
 * pudo leer: «no pude leer» no es «vacía».
 */
export async function listRegistryVenues(): Promise<{
  factory: string;
  registry: string;
  timelockSeconds: number;
  governor: string;
  venues: RegistryVenue[];
}> {
  const res = await fetch(`${API_BASE}/institutional/registry/venues`, { headers: authHeaders(), credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { factory: string; registry: string; timelockSeconds: number; governor: string; venues: RegistryVenue[] };
}

export async function listCages(): Promise<{
  factory: string;
  terms: CageTerms | null;
  cages: CageCatalogEntry[];
}> {
  const res = await fetch(`${API_BASE}/institutional/cages`, { headers: authHeaders(), credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { factory: string; terms: CageTerms | null; cages: CageCatalogEntry[] };
}

/** La jaula de UNA cuenta XRPL, o `cage: null` si aún no la tiene. */
export async function getCageOf(council: string): Promise<{
  factory: string;
  council: string;
  bridge?: string;
  cage: CageSummary | { cage: string; unreadable: true } | null;
}> {
  const res = await fetch(`${API_BASE}/institutional/cages?council=${encodeURIComponent(council)}`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { factory: string; council: string; bridge?: string; cage: CageSummary | { cage: string; unreadable: true } | null };
}

export interface CageBirthHandoff {
  account: string;
  predicted: { bridge: string; cage: string };
  factory: string;
  terms: CageTerms;
  personalAccount: string;
  xrplPayment: Record<string, unknown>;
  memoHex: string;
  userOpData: string;
  net: { grossXrp: string; supplyUBA: string; landsInPa: string };
  params: { asset: string; constitutionRef: string; allowedTargets: CageTarget[] };
  disclosure: Disclosure & { facts?: Record<string, unknown> };
}

/** Una jaula nace de UNA firma de su cuenta XRPL (0xFE). Sin génesis: no custodia. */
export function prepareCageCreate(input: {
  account: string;
  amountXrp: string;
  /** Vacía = la jaula sigue al registro de Astryum tal y como esté cada día. */
  allowedTargets: CageTarget[];
  asset?: string;
  /** VC off-ledger del partner (JWT) para la puerta del título de gestor, si aplica. */
  managerCredentialJwt?: string;
  /** Solo tras confirmar componer al lado de un nacimiento firmado en vuelo (409 CAGE_BIRTH_IN_FLIGHT). */
  confirmAnotherOrder?: boolean;
}): Promise<ApiResult<CageBirthHandoff>> {
  return post('/cage-create/prepare', input);
}

export type CageOrderAction =
  | 'create-pote'
  | 'accept-pote'
  | 'propose-venue'
  | 'retire-venue'
  | 'evacuate'
  | 'set-max-venue-bps'
  | 'set-payees'
  | 'set-user-gate'
  | 'set-max-deposit'
  | 'direct-to'
  | 'recall'
  | 'move'
  | 'cede'
  | 'end-cession'
  | 'set-constitution-ref'
  | 'register-remote-wallet'
  | 'register-remote-pote'
  | 'propose-successor'
  | 'cancel-successor'
  | 'execute-succession';

export interface CageOrderPrepared extends CouncilOrderServerNotes {
  account: string;
  xrplTx: Record<string, unknown>;
  /** `orderData` = abi.encode(nonce, cageCalldata): lo que el relay entrega a `bridge.execute`. */
  order: { summary: string; nonce: number; bridge: string; cage: string; orderData: string; orderHash: string; action: CageOrderAction };
  disclosure: Disclosure & { note?: string; facts?: Record<string, unknown> };
}

/** Cualquier orden de una cuenta a SU jaula. Tras firmar, disparar el relay con `order.orderData`. */
export async function prepareCageOrder(input: {
  council: string;
  action: CageOrderAction;
  params: Record<string, unknown>;
  /** VC off-ledger del partner (JWT) para la puerta del título de gestor, si aplica. */
  managerCredentialJwt?: string;
  /** Only after the person explicitly confirmed composing beside an order in flight (409 COUNCIL_ORDER_IN_FLIGHT). */
  confirmAnotherOrder?: boolean;
}): Promise<ApiResult<CageOrderPrepared>> {
  const res = await post<CageOrderPrepared>('/cage-order/prepare', input);
  // At prepare time, per order: what the banner may promise if its screen goes away.
  if (res.ok) noteCouncilOrderDelivery(res.data.xrplTx, res.data.serverDelivery);
  return res;
}

// ── La VC off-ledger del gestor, guardada por navegador (conveniencia) ───────
// El gestor la pega una vez (se la dio el partner regulado); se adjunta a las
// órdenes de gobierno. Nunca es estado de verdad — solo su presentación.
const MGR_VC_KEY = 'astryum-manager-vc';

export function storedManagerVc(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage.getItem(MGR_VC_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function setStoredManagerVc(jwt: string): void {
  try {
    if (jwt.trim()) window.localStorage.setItem(MGR_VC_KEY, jwt.trim());
    else window.localStorage.removeItem(MGR_VC_KEY);
  } catch {
    /* sin memoria: se vuelve a pegar */
  }
}
