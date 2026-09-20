/**
 * /api/demo-exchange — the SIMULATED exchange system behind the Demo Exchange
 * surface (BuildSpec Demo Exchange v2).
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { ethers } from 'ethers';
import { requireAdmin } from './adminPanel';
import { requireSiweAuth } from '../middleware/requireSiweAuth';
import { safeErrorDetail } from '../utils/safeError';
// The ONE payload window this deployment measures seats with.
import { handoffPayloadExpiryMin } from '../services/flare/handoffAuthority';
// NOTE (R5 5.1): this router no longer asks `attributionForSigner`
// whether an omnibus is «operational» — the run declares it and the 0xFE seat
// guard is told (operationalOmnibus). Attribution itself is unchanged: the desk
// payout and the desk 0xFE pass 'operational' explicitly (our own scripted
// account, never the project tag, T&C §7) and the CLIENT's deposit keeps the
// tag, because the client is the signer.
import { withSourceTag } from '../config/xrplSourceTag';
import { jurisdictionService } from '../services/JurisdictionService';
import {
  applyMovements,
  bumpSeqHighWater,
  deskPaymentsOf,
  DemoRunStoreError,
  findTagRangeClash,
  listRuns,
  loadRun,
  saveRun,
  deleteRun,
  newId,
  nextClientTag,
  nextRunSeq,
  readAssignedTagRanges,
  readSeqHighWater,
  recordAssignedTagRange,
  requestsOf,
  runTagRange,
  withRunLock,
  type AssignedTagRange,
  type DemoClient,
  type DemoRun,
  type DeskPayment,
  type ExternalFe,
  type ReceiptStep,
} from '../services/demoExchange/DemoExchangeStore';
import { deskReservationNothingSigned, dropsToXrpText, paymentsInFlight, reservedDrops, sweepDeskPayments, type Against, type AgainstKind, type InFlight } from '../services/demoExchange/availableBalance';
import { checkClientCredential, clientCredentialGateEnabled, isCredentialRefusal } from '../services/demoExchange/clientCredentialGate';

import {
  assessStructureAuthority,
  canCloseStructureDoor,
  planStructureBirth,
  type BirthStepId,
  type StructureBirthInput,
  type StructureGovernance,
  type StructureKind,
  type StructureSeat,
} from '../connectors/protocols/xrpl/XrplStructureBirth';
import {
  findStructure,
  nextStructureId,
  stepBlockedBy,
  stepsDone,
  structureByAddress,
  structureProgress,
  structuresOf,
  type DemoStructure,
} from '../services/demoExchange/structures';
import { StructureStepError, composeStructureStep, readAccountsExist, verifyStructureStep } from '../services/demoExchange/structureSteps';
import {
  DESK_PAYOUT_LEDGER_WINDOW,
  PUT_TO_WORK_LEDGER_WINDOW,
  applyPayoutProofs,
  judgePutToWorkRecord,
  knownOmnibusFe,
  probePreparedPayout,
  proveDeskPayouts,
  provePutToWorkRelease,
  putToWorkLedgerWindow,
  settlePayoutByProof,
  settlePutToWorkByProof,
} from '../services/demoExchange/deskPaymentProof';
import { findHandoffByMemo, readCoreVaultAddress, readXrplTx, type OmnibusHandoff, type ReportedTx } from '../services/demoExchange/deskPaymentReads';
import { againstFor, readSubmission } from '../services/demoExchange/submissionJournal';
import { journalPlan } from '../services/demoExchange/submissionVerdict';
import { ownershipPredatesTakeover, readTakeoverAt, TAKEOVER_AHEAD_OF_CLOCK_MESSAGE } from '../services/demoExchange/takeover';
import { registerRunOmnibusOperationalResolver, rememberDeclaredOmnibus, resyncDeclaredOmnibus } from '../services/demoExchange/operationalOmnibus';
import { currentValidatedLedgerIndex, scanOmnibus, type OmnibusTx } from '../services/demoExchange/OmnibusWatcher';
import { applyOmnibusScan, makeReceipt, syncOmnibus } from '../services/demoExchange/DemoExchangeSync';
import { explorerUrl, flareProvider, readClientFacts, verifyRun } from '../services/demoExchange/DemoRunVerifier';
import { renderProofMarkdown } from '../services/demoExchange/proofMarkdown';
import { demoExchangeAutopilot } from '../services/demoExchange/DemoExchangeAutopilot';
import { readSignerConfig } from '../services/demoExchange/DemoExchangeSigner';

const router = Router();

// STARTUP (R5 5.1): every run's declared omnibus becomes an account the
// 0xFE nonce-seat guard covers. `index-simple.ts` mounts this router eagerly at
// boot, so importing it IS the startup hook — no environment list, and a run
// created before this deploy is covered as soon as the store is read.
void registerRunOmnibusOperationalResolver();
// PUBLICADO — el
// anillo VER: las LECTURAS son públicas (runs, chain, proof, y el
// verify — que un juez pueda pulsar «verifícalo tú» ES el producto). Las
// MUTACIONES de operador siguen tras requireAdmin: abrirlas dejaría a cualquiera
// borrar un run o encender el autopilot (que firma con la llave del omnibus).
/**
 * Las rutas que un CLIENTE necesita para ser cliente por sí mismo.
 *
 * Ahora:
 *  · SESIÓN: cada una exige `requireSiweAuth` (401 sin ella). Un admin
 *    (`callerIsAdmin`) conserva todo el poder.
 *  · DUEÑO: la fila lleva `ownerUserId`. El alta self-serve la crea con dueño =
 *    la sesión. El alta del desk (admin) la crea SIN dueño y devuelve una sola
 *    vez un `claimCode` (solo se guarda su sha256); quien lo presente la
 *    reclama y pasa a ser su dueño. Toda otra mutación no-admin de una fila
 *    (PATCH, peticiones, instrucciones de depósito, recibos con clientId) exige
 *    sesión === dueño (403 NOT_YOUR_CLIENT). Filas legacy con passkey y sin
 *    dueño: solo un admin las asigna (o emite un código).
 *  · WALLET XRPL: escrita por un no-admin tiene que estar PROBADA para su
 *    sesión — su wallet de login SIWE o un WalletBinding activo y firmado de
 *    tipo 'xrpl'. Se fija una vez; esa firma cuenta como prueba de payout.
 *  · passkey: una por dueño (ACCOUNT_ALREADY_A_CLIENT solo contra filas del
 *    MISMO dueño). Reclamar sí, re-apuntar jamás.
 *  · recibos: evidencia de la toma — salvo los de MOVIMIENTO de dinero
 *    (U1/U4_XRP/E5/E8), que escribe el vigilante desde el ledger; tope de 500
 *    por run y `expect` acotado. Sin `clientId` solo el exchange.
 *  · altas self-serve: tope de filas por dueño en cada run.
 * Todo lo demás (borrar runs, autopilot, perfil del run) sigue tras admin.
 */
const CLIENT_SELF_SERVE: Array<{ m: string; re: RegExp }> = [
  { m: 'POST', re: /^\/runs\/[^/]+\/clients$/ },
  { m: 'PATCH', re: /^\/runs\/[^/]+\/clients\/[^/]+$/ },
  { m: 'POST', re: /^\/runs\/[^/]+\/clients\/[^/]+\/(requests|deposit-instructions)$/ },
  // RETIRAR de la cola una petición propia que nadie ha firmado es un
  // acto del cliente, como pedirla. Si solo pudiera hacerlo el escritorio, la
  // puerta no existiría para quien la necesita.
  { m: 'DELETE', re: /^\/runs\/[^/]+\/clients\/[^/]+\/requests\/[^/]+$/ },
  // Y soltar una RESERVA DE MESA de la que nunca se compuso nada. La
  // abre el escritorio, retiene el saldo de su dueño y su única puerta era un
  // DELETE de admin que además contesta 503 mientras el XRPL no se lea.
  { m: 'DELETE', re: /^\/runs\/[^/]+\/clients\/[^/]+\/desk-payments\/[^/]+$/ },
  { m: 'POST', re: /^\/runs\/[^/]+\/receipts$/ },
];

/** Set by the auth middleware on self-serve routes: the founder doors let this request through. */
const ADMIN_LOCAL = 'demoExchangeAdmin';

/**
 * ¿Nace un exchange con el autopilot encendido? (no — sale de la vista y
 * la mesa firma por QR.) Queda como constante de código, no como variable de
 * entorno: lo que decide qué se ve y cómo opera vive en código.
 */
const AUTOPILOT_AT_BIRTH: boolean = false;

router.use((req, res, next) => {
  // LAS LECTURAS DEJAN DE SER PÚBLICAS. Hasta hoy todo
  // GET —y POST …/verify— pasaba sin sesión: con el id de un run cualquiera leía
  // la ficha de cada cliente de un exchange ajeno (etiqueta, tag, r-address,
  // cuenta de passkey, saldo, KYC), su cadena, sus credenciales y un dossier en
  // markdown con todo ello; y `GET /runs` regalaba los ids. Ahora una lectura
  // pide lo mismo que el autoservicio: una puerta de fundador o una sesión. QUÉ
  // ve cada sesión lo decide cada ruta (`accessToRun`).
  const read = req.method === 'GET' || (req.method === 'POST' && /\/verify$/.test(req.path));
  const clientSelfServe = CLIENT_SELF_SERVE.some((r) => r.m === req.method && r.re.test(req.path));
  if (!read && !clientSelfServe) return requireAdmin(req, res, next);
  void (async () => {
    const admin = await callerIsAdmin(req);
    res.locals[ADMIN_LOCAL] = admin;
    if (admin) return next();
    return requireSiweAuth(req, res, next);
  })().catch(() => {
    if (!res.headersSent) res.status(401).json({ error: 'AUTH_CHECK_FAILED' });
  });
});
// The module switch (#10) guards EVERY route — reads included — so a founder
// cannot browse a ledger on an environment where the module is off. Before
// this middleware only 4 of 16 routes checked it (review).
router.use((_req, res, next) => {
  if (process.env.INSTITUTIONAL_POTES_ENABLED !== 'true') {
    return void res.status(503).json({ error: 'INSTITUTIONAL_DISABLED', detail: 'Set INSTITUTIONAL_POTES_ENABLED=true on this environment (#10).' });
  }
  next();
});

const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const HEX64 = /^(0x)?[0-9a-fA-F]{64}$/;
const XRP_AMOUNT_RE = /^\d+(\.\d{1,6})?$/;
const STEPS: ReceiptStep[] = ['E1_ANCHOR', 'E2_POTE', 'E3_KYC', 'E3_CREDENTIAL', 'U1_DEPOSIT', 'E5_PUT_TO_WORK', 'E6_ORDER', 'E7_DENIED', 'U4_EXIT', 'U4_EXIT_XRP', 'E8_WITHDRAW', 'NOTE'];
/** Steps only the watcher / autopilot write, from the ledger (never the open receipts route). U4_EXIT_XRP only on its XRPL side. */
const LEDGER_MOVEMENT_STEPS: ReceiptStep[] = ['U1_DEPOSIT', 'U4_EXIT_XRP', 'E5_PUT_TO_WORK', 'E8_WITHDRAW'];
/** The open receipts route cannot grow a run past this (a slow /verify was lengthened with fake receipts). */
export const MAX_RECEIPTS_PER_RUN = 500;
const MAX_EXPECT_KEYS = 20;
const MAX_EXPECT_VALUE_CHARS = 200;
const MAX_EXPECT_KEY_CHARS = 64;

/** Express 4 swallows async throws — wrap every handler (same fix as institutional.ts). */
function guarded(fn: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      // The run store could not PROVE a read or a save: the
      // request did not happen as far as the exchange ledger is concerned.
      if (err instanceof DemoRunStoreError) {
        console.error('[demo-exchange] run store refused:', err.message);
        // «I COULD NOT READ» IS RETRYABLE, AND IT SAYS SO. A read
        // that failed changed nothing, so the sentence must not claim a write was
        // attempted; and `retryable` is what turns this into a «Try again» button
        // on the client surface instead of a dead end (`refusalIsRetryable`).
        const reading = err.code === 'RUN_UNREADABLE';
        if (!res.headersSent)
          res.status(503).json({
            error: err.code,
            retryable: true,
            detail: reading
              ? `${err.message} — nothing was changed; try again`
              : `${err.message} — nothing was recorded; try again`,
          });
        return;
      }
      console.error('[demo-exchange] handler failed:', (err as Error).message);
      if (!res.headersSent) res.status(500).json({ error: 'DEMO_EXCHANGE_FAILED', detail: (err as Error).message });
    });
  };
}

/**
 * A SEAT WE COULD NOT READ IS NOT A SEAT THAT IS TAKEN.
 *
 * `SeatStateUnreadableError extends NonceSeatTakenError`, so
 * `e instanceof NonceSeatTakenError` matches BOTH — and this door mapped all of
 * them to a flat 409 «an earlier 0xFE is still in flight», which told the
 * operator a fact nobody had and offered no retry. The six institutional doors
 * and `flareDemo` already split them with `seatRefusalStatus`; this one was left
 * out of that sweep. Same helper, same body, same fields (`code`, `retryable`,
 * `secondsLeft`), so a deploy that starts sending a new seat code does not lose
 * its meaning here.
 */
function seatRefusalStatus(e: unknown): 409 | 503 {
  return (e as { unreadableSeatState?: boolean })?.unreadableSeatState === true ? 503 : 409;
}

function nonceSeatBody(e: unknown, tail: string): Record<string, unknown> {
  const seat = e as {
    code?: string;
    retryable?: boolean;
    lastLedgerSequence?: number;
    secondsLeft?: number;
    memoHex?: string;
    seatWarning?: string;
  };
  return {
    error: seat.code ?? 'NONCE_SEAT_TAKEN',
    ...(typeof seat.retryable === 'boolean' ? { retryable: seat.retryable } : {}),
    ...(seat.lastLedgerSequence !== undefined ? { lastLedgerSequence: seat.lastLedgerSequence } : {}),
    ...(seat.secondsLeft !== undefined ? { secondsLeft: seat.secondsLeft } : {}),
    ...(seat.memoHex ? { memoHex: seat.memoHex } : {}),
    ...(seat.seatWarning ? { seatWarning: seat.seatWarning } : {}),
    detail: `${safeErrorDetail(e).slice(0, 240)} — ${tail}`,
  };
}

function demoGate(res: Response): boolean {
  if (process.env.INSTITUTIONAL_POTES_ENABLED !== 'true') {
    res.status(503).json({ error: 'INSTITUTIONAL_DISABLED', detail: 'Set INSTITUTIONAL_POTES_ENABLED=true on this environment (#10).' });
    return false;
  }
  return true;
}

function bad(res: Response, detail: string): void {
  res.status(400).json({ error: 'INVALID_REQUEST', detail });
}

async function requireRun(req: Request, res: Response): Promise<DemoRun | null> {
  const run = await loadRun(String(req.params.id));
  if (!run) {
    res.status(404).json({ error: 'RUN_NOT_FOUND' });
    return null;
  }
  return run;
}

function xrpToDrops(amountXrp: string): string {
  const [whole, frac = ''] = amountXrp.split('.');
  return (BigInt(whole) * BigInt(1_000_000) + BigInt((frac + '000000').slice(0, 6))).toString();
}

function summary(run: DemoRun) {
  return {
    runId: run.runId,
    seq: run.seq,
    label: run.label,
    councilAddress: run.councilAddress,
    omnibusAddress: run.omnibusAddress,
    policy: run.policy,
    poteAddress: run.poteAddress ?? null,
    bridgeAddress: run.bridgeAddress ?? null,
    registryAddress: run.registryAddress ?? null,
    createdAt: run.createdAt,
    status: run.status,
    clients: run.clients.length,
    receipts: run.receipts.length,
  };
}

/* ── identity helpers ────────────────────────────────────────────────────── */

type Door = (req: Request, res: Response, next: NextFunction) => unknown;

/**
 * Would this door let the request through? Probes the middleware without
 * answering: any refusal it writes resolves false, `next()` resolves true, and
 * a door that never answers times out to false (fail-closed). A door that
 * authenticates (requireSiweAuth) leaves `req.siwe` populated on success.
 */
function passesDoor(req: Request, door: Door): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => done(false), 5000);
    const refuse = () => {
      done(false);
      return stub;
    };
    const stub = { status: () => stub, json: refuse, send: refuse, end: refuse, setHeader: () => stub, set: () => stub, header: () => stub, locals: {} };
    try {
      Promise.resolve(door(req, stub as unknown as Response, () => done(true))).catch(() => done(false));
    } catch {
      done(false);
    }
  });
}

/** Would the founder doors let this request through? */
function callerIsAdmin(req: Request): Promise<boolean> {
  return passesDoor(req, requireAdmin);
}

function isAdminRequest(res: Response): boolean {
  return res.locals[ADMIN_LOCAL] === true;
}

/* ── de quién es un exchange, y qué puede leer de él cada cual ── */

/** Quién mira, tal y como lo dejó el primer anillo: una puerta de fundador, una sesión, o las dos. */
type RunViewer = { admin: boolean; userId?: string };

async function viewerOf(req: Request, res: Response): Promise<RunViewer> {
  return { admin: isAdminRequest(res), userId: req.siwe?.userId ?? (await optionalSessionUserId(req)) };
}

/**
 * UN EXCHANGE ES DE QUIEN LO CREÓ. Los anteriores al no llevan creador;
 * crear siempre fue de admin, así que siguen siendo de los fundadores — de los
 * dos, porque no hay a quién atribuirlos. Uno nuevo es SOLO de su creador,
 * también entre fundadores: el panel de operaciones los ve todos con `?all=1`.
 */
export function ownsRun(run: Pick<DemoRun, 'createdByUserId'>, viewer: RunViewer): boolean {
  if (run.createdByUserId) return Boolean(viewer.userId) && run.createdByUserId === viewer.userId;
  return viewer.admin;
}

/**
 * Las fichas de cliente de ESTA cuenta en un run. Por `ownerUserId` a secas, sin
 * el filtro de toma de posesión: aquí se decide si puede LEER el exchange, y una
 * ficha anterior a una toma sigue siendo de su cuenta (se enseña `mine:false` y
 * se reclama). Con el filtro, un parpadeo de esa lectura convertía su exchange en
 * un 404.
 */
function memberClientIds(run: DemoRun, userId: string | undefined): Set<string> {
  if (!userId) return new Set();
  return new Set(run.clients.filter((c) => c.ownerUserId === userId).map((c) => c.id));
}

type RunAccess = { level: 'admin' | 'owner' } | { level: 'member'; clientIds: Set<string> } | { level: 'none' };

export function accessToRun(run: DemoRun, viewer: RunViewer): RunAccess {
  if (viewer.admin) return { level: 'admin' };
  if (ownsRun(run, viewer)) return { level: 'owner' };
  const clientIds = memberClientIds(run, viewer.userId);
  return clientIds.size > 0 ? { level: 'member', clientIds } : { level: 'none' };
}

/**
 * Carga el run y decide qué puede leer quien pregunta. Sin acceso contesta 404
 * `RUN_NOT_FOUND` — el mismo cuerpo que un id inventado: un exchange ajeno ni se
 * admite que existe.
 */
async function requireRunAccess(req: Request, res: Response): Promise<{ run: DemoRun; viewer: RunViewer; access: Exclude<RunAccess, { level: 'none' }> } | null> {
  const run = await requireRun(req, res);
  if (!run) return null;
  const viewer = await viewerOf(req, res);
  const access = accessToRun(run, viewer);
  if (access.level === 'none') {
    res.status(404).json({ error: 'RUN_NOT_FOUND' });
    return null;
  }
  return { run, viewer, access };
}

/** Solo el dueño del exchange o un fundador: lo que un cliente miembro no tiene por qué ver. */
async function requireRunOwner(req: Request, res: Response): Promise<{ run: DemoRun; viewer: RunViewer } | null> {
  const got = await requireRunAccess(req, res);
  if (!got) return null;
  if (got.access.level === 'member') {
    res.status(404).json({ error: 'RUN_NOT_FOUND' });
    return null;
  }
  return { run: got.run, viewer: got.viewer };
}

/**
 * Lo que ve un CLIENTE de su exchange: los datos del exchange que necesita para
 * operar (nombre, omnibus al que depositar, pote, política) y SOLO sus fichas,
 * sus recibos, sus peticiones y sus pagos de mesa. Nada de los demás clientes, ni
 * de las estructuras, ni del libro de conciliación del omnibus.
 */
function memberView<T extends Record<string, unknown>>(body: T, clientIds: Set<string>): T {
  const mineRows = (rows: unknown): unknown[] =>
    Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object' && clientIds.has(String((r as { clientId?: unknown }).clientId ?? ''))) : [];
  const out: Record<string, unknown> = { ...body };
  out.clients = Array.isArray(body.clients) ? body.clients.filter((c) => c && typeof c === 'object' && clientIds.has(String((c as { id?: unknown }).id ?? ''))) : [];
  out.receipts = mineRows(body.receipts);
  if ('requests' in body) out.requests = mineRows(body.requests);
  if ('deskPayments' in body) out.deskPayments = mineRows(body.deskPayments);
  delete out.externalFe;
  delete out.structures;
  delete out.provenDepositSenders;
  out.appliedTxHashes = [];
  return out as T;
}

/**
 * The SIWE user behind a PUBLIC request, if it carries a valid bearer — the same
 * verification `requireSiweAuth` does, without making the route require it.
 * No Authorization header → undefined (never the dev-bypass user).
 */
async function optionalSessionUserId(req: Request): Promise<string | undefined> {
  return (await readSessionIdentity(req)).userId;
}

/**
 * WHY THERE IS NO USER, NOT JUST THAT THERE IS NONE.
 *
 * `requireAdmin` has FOUR doors, and two of them (`x-admin-session`, the static
 * `x-admin-key`) prove the DEPLOYMENT's operator without identifying any Astryum
 * user: they never populate `req.siwe`. A founder who opened the desk that way
 * — a panel session, a script, a bearer that expired while the tab stayed open —
 * therefore reached `readOmnibusOwnership` with no user id, every owned address
 * read as `unattributable`, and the declaration died on a 409 that named no way
 * out. The narrower door decided what the wider one had already allowed.
 */
type SessionIdentity = {
  userId?: string;
  /** Why no user id: nothing was presented, or what was presented did not verify. */
  why: 'session' | 'no-session-presented' | 'session-not-verified';
};

async function readSessionIdentity(req: Request): Promise<SessionIdentity> {
  if (req.siwe?.userId) return { userId: req.siwe.userId, why: 'session' };
  if (!req.header('Authorization')) return { why: 'no-session-presented' };
  const ok = await passesDoor(req, requireSiweAuth);
  const userId = ok ? req.siwe?.userId : undefined;
  return userId ? { userId, why: 'session' } : { why: 'session-not-verified' };
}

/* ── claim codes (desk-created rows) ─────────────────────────────────────── */

function normalizeClaimCode(code: string): string {
  return code.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

export function hashClaimCode(code: string): string {
  return createHash('sha256').update(normalizeClaimCode(code)).digest('hex');
}

/** 80 random bits, shown ONCE as XXXX-XXXX-XXXX-XXXX-XXXX; only its sha256 is stored. */
function newClaimCode(): string {
  const raw = randomBytes(10).toString('hex').toUpperCase();
  return raw.match(/.{1,4}/g)!.join('-');
}

function claimCodeMatches(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashClaimCode(presented), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ── wallet proof ────────────────────────────────────────────────────────── */

interface WalletProof {
  proof: 'session' | 'binding' | null;
  /** The binding table could not be read — refuse, never assume. */
  unreadable: boolean;
}

/**
 * Is this XRPL address PROVEN to belong to the session user? Their SIWE login
 * wallet (the login signature proved it), or an active WalletBinding of theirs
 * on 'xrpl' with a stored signature. The plain `wallet` table is NOT proof.
 * Without DATABASE_URL only the session address counts.
 *
 * Takeover: a binding linked BEFORE the user's login was taken over
 * (`preferences.security.takeoverAt`) proves nothing about who holds the session
 * now — it is ignored. An unreadable user row is «unreadable», never «no takeover».
 */
async function proveXrplWallet(req: Request, address: string): Promise<WalletProof> {
  const session = req.siwe;
  if (!session?.userId) return { proof: null, unreadable: false };
  if (session.walletAddress && session.walletAddress === address) return { proof: 'session', unreadable: false };
  if (!process.env.DATABASE_URL) return { proof: null, unreadable: false };
  try {
    const takeoverAt = await readTakeoverAt(session.userId);
    const { prisma } = await import('../database/prismaClient');
    const row = await prisma.walletBinding.findFirst({
      where: {
        userId: session.userId,
        address,
        chainType: 'xrpl',
        isActive: true,
        signatureProof: { not: '' },
        ...(takeoverAt ? { linkedAt: { gte: takeoverAt } } : {}),
      },
      select: { id: true, linkedAt: true },
    });
    if (!row) return { proof: null, unreadable: false };
    // Defense in depth: whatever the query answered, a binding not PROVEN linked
    // after the takeover is not proof.
    if (takeoverAt) {
      const linked = new Date(row.linkedAt as unknown as string | Date).getTime();
      if (!Number.isFinite(linked) || linked < takeoverAt.getTime()) return { proof: null, unreadable: false };
    }
    return { proof: 'binding', unreadable: false };
  } catch {
    return { proof: null, unreadable: true };
  }
}

/* ── takeover of an owner's login ───────────────────────────────── */

const RECLAIM_DETAIL =
  'this exchange account became yours before your login was recovered from a security takeover — the exchange has to re-open it for you (a new claim code) before it can be used from this session';

/** The session user's takeover instant, STRICT: 503 when it cannot be read (writes it). Admin → no takeover. */
async function sessionTakeoverOr503(res: Response, userId: string | undefined, admin: boolean): Promise<{ at: Date | null } | null> {
  if (admin || !userId) return { at: null };
  // The WRITE doors used to answer with a `detail` that
  // truncated the error message at 80 chars («…so it cannot da») and carried no
  // `retryable`. Since the client now prefers the server's `detail` for this
  // code, that truncated fragment is what a person read on a withdrawal with
  // an ahead-of-clock mark. Same three causes, same honest sentences as the
  // portal: what happened, whose fault, what works (and what does not).
  const verdict = await viewerTakeoverVerdict(userId);
  if (verdict.unusable) {
    res.status(503).json(ownershipUnreadableBody(verdict.unusable));
    return null;
  }
  return { at: verdict.at };
}

/**
 * «NO PUDE LEER TU MARCA» NO ES «TU CUENTA
 * CAMBIÓ DE DUEÑO».
 */
type ViewerTakeoverVerdict =
  | { at: Date | null; unusable: null }
  | { at: null; unusable: { cause: 'ahead-of-clock' | 'unreadable-mark' | 'read-failed'; message: string } };

async function viewerTakeoverVerdict(userId: string | undefined): Promise<ViewerTakeoverVerdict> {
  if (!userId) return { at: null, unusable: null };
  try {
    return { at: await readTakeoverAt(userId), unusable: null };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    const message = typeof err?.message === 'string' ? err.message : '';
    const cause =
      err?.name === 'TakeoverUnreadableError'
        ? message === TAKEOVER_AHEAD_OF_CLOCK_MESSAGE
          ? ('ahead-of-clock' as const)
          : ('unreadable-mark' as const)
        : ('read-failed' as const);
    return { at: null, unusable: { cause, message } };
  }
}

/**
 * The 503 the portal owes when the viewer's takeover mark cannot be used. One
 * sentence per cause — each says only what is true of THAT cause, and names the
 * way forward that actually works. `retryable: true` on all three: the person
 * keeps the right to ask again, and nothing was changed by asking.
 */
const OWNERSHIP_UNREADABLE_DETAIL: Record<'ahead-of-clock' | 'unreadable-mark' | 'read-failed', string> = {
  'ahead-of-clock':
    "This sign-in's security record is dated later than our own clock, so the exchange cannot yet tell whether " +
    'your account here was opened before or after it last changed hands. Nothing was changed and nothing is lost: ' +
    'this clears on its own once our clock passes that date — try again later. Re-linking a wallet will not help, ' +
    'and no claim code is needed. If it persists, write to us: an administrator can check that date.',
  'unreadable-mark':
    "This sign-in's security record could not be read, so the exchange cannot tell whether your account here was " +
    'opened before or after it last changed hands. Nothing was changed and nothing is lost — a fault in what we ' +
    'stored, not in anything you did. Try again; if it keeps failing, write to us and an administrator can repair ' +
    'the record.',
  'read-failed':
    'Whether this sign-in was taken over could not be read just now — our database did not answer. Nothing was ' +
    'changed and nothing is lost: try again in a moment.',
};

function ownershipUnreadableBody(unusable: { cause: 'ahead-of-clock' | 'unreadable-mark' | 'read-failed' }): Record<string, unknown> {
  return {
    error: 'OWNERSHIP_UNREADABLE',
    retryable: true,
    cause: unusable.cause,
    // Wrote «dated later than our clock» so a person would read it; it
    // has to survive to the body, and the client must not overwrite it.
    detail: OWNERSHIP_UNREADABLE_DETAIL[unusable.cause],
  };
}

/**
 * The viewer's takeover instant for DISPLAY (`mine`): unusable → «now», so nothing shows as theirs.
 * no route calls this any more — the two readers (`GET /runs/:id`, the
 * self-serve alta) take the full verdict so the body can SAY the mark was
 * unusable. Kept, inert, for the next reader that only needs the instant.
 */
async function viewerTakeover(userId: string | undefined): Promise<Date | null> {
  const v = await viewerTakeoverVerdict(userId);
  return v.unusable ? new Date() : v.at;
}

/* ── does this XRPL account already belong to a person? (3.5) ────── */

type OmnibusOwnership =
  | { kind: 'free' }
  | { kind: 'caller' }
  | { kind: 'another-user'; via: 'account' | 'binding' }
  /**
   * THE ADDRESS HAS AN OWNER AND WE CANNOT SAY WHETHER IT IS THE
   * CALLER'S, because the caller brought no session. «Somebody's» is NOT «somebody
   * else's»: without a session every matching row read as a third party's and the
   * declaration died on a 409 nobody could act on — including the founder
   * declaring their OWN omnibus from a script or from an admin cookie alone
   * (`optionalSessionUserId` only answers for a SIWE bearer).
   */
  | { kind: 'unattributable'; via: 'account' | 'binding' }
  | { kind: 'unreadable'; detail: string };

/**
 * DECLARAR UN OMNIBUS ES PONERLO BAJO LA GUARDA DEL ASIENTO 0xFE, así que
 * declarar la cuenta de OTRA PERSONA la neutraliza: desde ese instante sus
 * hand-offs se leen como «flujos servidor de Astryum», y una salida suya sin
 * prueba recibe 403. Un admin no puede hacerle eso a un tercero con un
 * formulario, aunque sea admin: el alta comprueba si esa r-address ya es de
 * alguien — su cuenta de Astryum (`User.xrplAddress`, la wallet con la que
 * entra) o un `WalletBinding` activo y FIRMADO suyo — y solo la acepta si no es
 * de nadie o si es del propio solicitante (su omnibus, declarado por él).
 *
 * Lectura ESTRICTA: si la tabla no se puede leer, el alta se rechaza con 503.
 * Es una ENTRADA — no componer nada es reversible; neutralizar una cuenta ajena
 * no lo es. Sin `DATABASE_URL` (demo local, scripts) no hay usuarios que herir.
 */
async function readOmnibusOwnership(address: string, callerUserId: string | undefined): Promise<OmnibusOwnership> {
  if (!process.env.DATABASE_URL) return { kind: 'free' };
  try {
    const { prisma } = await import('../database/prismaClient');
    const [user, bindings] = await Promise.all([
      prisma.user.findFirst({ where: { xrplAddress: address }, select: { id: true } }),
      prisma.walletBinding.findMany({
        where: { address, chainType: 'xrpl', isActive: true, signatureProof: { not: '' } },
        select: { userId: true },
        take: 20,
      }),
    ]);
    // Sin sesión no hay a quién comparar: la única respuesta honesta es «tiene
    // dueño y no puedo atribuirlo». Se sigue negando (declarar la cuenta de otro
    // es irreversible), pero la frase pide lo que falta — la sesión — en vez de
    // acusar a quien quizá sea su dueño. Una dirección de nadie sigue siendo libre.
    if (!callerUserId) {
      if (user) return { kind: 'unattributable', via: 'account' };
      if (bindings.length > 0) return { kind: 'unattributable', via: 'binding' };
      return { kind: 'free' };
    }
    const otherBinding = bindings.find((b) => b.userId !== callerUserId);
    if (otherBinding) return { kind: 'another-user', via: 'binding' };
    if (user && user.id !== callerUserId) return { kind: 'another-user', via: 'account' };
    if ((user && user.id === callerUserId) || bindings.length > 0) return { kind: 'caller' };
    return { kind: 'free' };
  } catch (e) {
    return { kind: 'unreadable', detail: safeErrorDetail(e).slice(0, 200) };
  }
}

function refuseUnprovenWallet(res: Response, proof: WalletProof): void {
  if (proof.unreadable) {
    res.status(503).json({ error: 'WALLET_PROOF_UNREADABLE', detail: 'your wallet bindings could not be read right now — nothing was changed; try again' });
    return;
  }
  res.status(403).json({
    error: 'WALLET_NOT_PROVEN',
    detail: 'this XRPL wallet is not proven to be yours: sign in with it, or bind it to your account by signature (Wallets), then set it here',
  });
}

/* ── public shape of a run (never the claim hash, never the owner id) ────── */

export function publicClient(c: DemoClient, viewerUserId?: string, viewerTakeoverAt?: Date | null) {
  const { claimCodeHash, ownerUserId, ...rest } = c;
  return {
    ...rest,
    owned: Boolean(ownerUserId),
    claimable: !ownerUserId && Boolean(claimCodeHash),
    // A row that became the viewer's before their login was taken over is not theirs until re-claimed.
    mine: Boolean(viewerUserId && ownerUserId === viewerUserId && !ownershipPredatesTakeover(c, viewerTakeoverAt)),
  };
}

/** The founder desk's view of a run: memos and userOp hashes of in-flight 0xFEs included. */
export const OPERATOR_VIEW = { operator: true } as const;

/**
 * What a non-operator never sees of an omnibus payment in flight (R1 1.2):
 * the 0xFE memo and userOpHash of a composed hand-off. With the memo anyone could
 * report fake signatures against the omnibus nonce seat; an unsigned draft's bytes
 * are the exchange's business until they land (then the ledger shows them).
 */
function redactHandoffRefs<T extends { memoHex?: string; userOpHash?: string }>(row: T): Omit<T, 'memoHex' | 'userOpHash'> {
  const copy: T = { ...row };
  delete copy.memoHex;
  delete copy.userOpHash;
  return copy;
}

export function publicRun(run: DemoRun, viewerUserId?: string, viewerTakeoverAt?: Date | null, view: { operator?: boolean } = {}) {
  const { createdByUserId: _creator, ...rest } = run;
  void _creator;
  const base = { ...rest, clients: run.clients.map((c) => publicClient(c, viewerUserId, viewerTakeoverAt)) };
  if (view.operator) return base;
  return {
    ...base,
    ...(run.requests ? { requests: run.requests.map(redactHandoffRefs) } : {}),
    ...(run.deskPayments ? { deskPayments: run.deskPayments.map(redactHandoffRefs) } : {}),
  };
}

/** The /omnibus body for a non-operator: its `requests` without hand-off memos. */
function publicOmnibusBody(body: Record<string, unknown>): Record<string, unknown> {
  const requests = body.requests;
  if (!Array.isArray(requests)) return body;
  return { ...body, requests: requests.map((r) => (r && typeof r === 'object' ? redactHandoffRefs(r as { memoHex?: string; userOpHash?: string }) : r)) };
}

/* ── pote resolution ─────────────────────────────────────────────────────── */

interface ResolvedPote {
  bridge: string;
  pote?: string;
}

async function resolvePoteOf(councilAddress: string): Promise<ResolvedPote | null> {
  try {
    // Generation-first (v2 cage, then v1 pote factory): resolveRunPote owns the
    // ordering and its rationale. For a v2 council the bridge is the CAGE's
    // bridge (consumedTxId/nextNonce inherited — the E6 checks keep working),
    // and the pote is the cage's most recent one. A cage born without a pote
    // yet still records its bridge, so orders verify from the first minute.
    const { resolveRunPote } = await import('../services/demoExchange/resolveRunPote');
    const resolved = await resolveRunPote(flareProvider(), councilAddress);
    if (!resolved) return null;
    return { bridge: resolved.bridge, pote: resolved.pote ?? undefined };
  } catch {
    return null; /* the run keeps whatever it had; the UI shows "not born yet" */
  }
}

function applyResolvedPote(run: DemoRun, resolved: ResolvedPote | null): void {
  if (!resolved) return;
  run.bridgeAddress = resolved.bridge;
  if (resolved.pote) run.poteAddress = resolved.pote;
}

/* ── runs ────────────────────────────────────────────────────────────────── */

router.get('/runs', guarded(async (req, res) => {
  // SOLO LOS TUYOS. `?all=1` es del panel de operaciones de los fundadores
  // (/app/admin/demo-exchange) y solo lo honra una puerta de admin.
  const viewer = await viewerOf(req, res);
  const all = viewer.admin && String(req.query.all ?? '') === '1';
  const runs = await listRuns();
  res.json({ runs: runs.filter((r) => all || ownsRun(r, viewer)).map(summary) });
}));

router.post('/runs', guarded(async (req, res) => {
  if (!demoGate(res)) return;
  const { label, councilAddress, omnibusAddress, policy, registryAddress, poteAddress } = req.body ?? {};
  if (!XRPL_RE.test(String(councilAddress ?? ''))) return void bad(res, 'councilAddress must be an XRPL r-address (the exchange council)');
  if (!XRPL_RE.test(String(omnibusAddress ?? ''))) return void bad(res, 'omnibusAddress must be an XRPL r-address (the exchange omnibus)');
  // THE RUN DECLARES ITS OMNIBUS; the declaration IS the
  // authorization. This route is admin-only, so an operator naming their own
  // omnibus here is exactly as authoritative as an environment variable, and it
  // is the only thing they can actually do from the setup wizard. The previous
  // rule demanded the account already be in `ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS`
  // — a variable nobody can edit from a browser — so the sign-up died at its
  // last station; and the workaround made the operator's account operational
  // for SourceTag too, stripping the project tag off an account that is not
  // ours. The declaration is registered with the 0xFE nonce-seat guard instead
  // (operationalOmnibus), which is what that rule was protecting all along.
  // Only what is genuinely wrong is refused — an address that already lives in
  // another role — and that check reads the runs inside the lock, below.
  if (String(omnibusAddress) === String(councilAddress)) {
    return void res.status(409).json({
      error: 'OMNIBUS_IS_THE_COUNCIL',
      detail:
        'the omnibus must be a different XRPL account from the council root: the root governs (it signs the orders) and the omnibus holds client XRP. One account doing both means whoever holds the cash desk key also holds the exchange authority.',
    });
  }
  if (policy !== undefined && policy !== 'A' && policy !== 'B') return void bad(res, "policy must be 'A' or 'B'");
  if (registryAddress !== undefined && registryAddress !== '' && !EVM_RE.test(String(registryAddress))) return void bad(res, 'registryAddress must be a 0x address');
  if (poteAddress !== undefined && poteAddress !== '' && !EVM_RE.test(String(poteAddress))) return void bad(res, 'poteAddress must be a 0x address');

  // …NI LA CUENTA DE UNA PERSONA REAL. Las tres negativas de
  // arriba miran las runs; esta mira a los usuarios. Declarar aquí la r-address
  // de un tercero pondría su cuenta bajo la guarda del 0xFE de la mesa: sus
  // hand-offs pasarían a leerse como flujos nuestros y una salida suya sin
  // prueba recibiría 403 — una cuenta ajena neutralizada desde un formulario de
  // alta. Su propia cuenta sí puede declararla quien la prueba.
  // Quién crea el exchange: se lee UNA vez, sirve a la comprobación del omnibus de
  // abajo y queda escrito en el run como su dueño.
  let creatorUserId: string | undefined;
  {
    const identity = await readSessionIdentity(req);
    const callerUserId = identity.userId;
    creatorUserId = callerUserId;
    const owned = await readOmnibusOwnership(String(omnibusAddress), callerUserId);
    if (owned.kind === 'unreadable') {
      return void res.status(503).json({
        error: 'OMNIBUS_OWNERSHIP_UNREADABLE',
        retryable: true,
        detail: `whether ${String(omnibusAddress)} already belongs to an Astryum user could not be read (${owned.detail}) — nothing was created; try again`,
      });
    }
    if (owned.kind === 'unattributable') {
      // THE FOUNDER IS NOT WALLED, THEY ARE TOLD WHAT IS MISSING.
      // An admin session (or the static key) proves the operator of this
      // deployment, never WHICH Astryum user is asking, and only the second
      // claim can answer «is this address yours?». So the refusal names the
      // situation it is in and the one move that resolves it — and it is marked
      // NOT retryable, because waiting fixes nothing.
      const expired = identity.why === 'session-not-verified';
      return void res.status(409).json({
        error: 'OMNIBUS_OWNER_UNKNOWN',
        retryable: false,
        /** What the door needs: an Astryum session that proves the address is the caller's. */
        needs: 'astryum-session',
        sessionState: identity.why,
        detail:
          `${String(omnibusAddress)} is already ${owned.via === 'binding' ? 'bound by signature to' : 'the XRPL account of'} an Astryum user, ` +
          (expired
            ? 'and the Astryum session this request carried did not verify (it expired, or it was closed), so we cannot tell whether that user is you. Sign in again with the Astryum account that owns it and declare it again. '
            : 'and this request carries no Astryum session, so we cannot tell whether that user is you. An admin session proves you run this deployment, not that this address is yours. Sign in with the Astryum account that owns it (or bind it there by signature, in Wallets) and declare it again. ') +
          'Nothing was created.',
      });
    }
    if (owned.kind === 'another-user') {
      return void res.status(409).json({
        error: 'OMNIBUS_IS_A_USER_ACCOUNT',
        detail:
          `${String(omnibusAddress)} is already ${owned.via === 'binding' ? 'bound by signature to' : 'the XRPL account of'} an Astryum user, and it is not yours. ` +
          'Declaring it as an omnibus would put that person\'s account behind this desk\'s transaction guard. Use the omnibus account you created for this desk, or sign in with that account first if it really is yours.',
      });
    }
  }

  // CONECTA (omnibus VIVO): el run declara su rango de tags RESERVADO, elegido
  // para no chocar con los tags que el exchange ya usa. Sin rango, el espacio
  // clásico seq×100 (omnibus nuevo de demo).
  let tagBase: number | undefined;
  let tagCount: number | undefined;
  if (req.body?.tagBase !== undefined && req.body.tagBase !== '') {
    tagBase = Number(req.body.tagBase);
    if (!Number.isInteger(tagBase) || tagBase < 1 || tagBase > 0xfffffffe) return void bad(res, 'tagBase must be a uint32 destination tag (>=1)');
    if (req.body?.tagCount !== undefined && req.body.tagCount !== '') {
      tagCount = Number(req.body.tagCount);
      if (!Number.isInteger(tagCount) || tagCount < 1 || tagCount > 100_000) return void bad(res, 'tagCount must be 1..100000');
    }
    if (tagBase + (tagCount ?? 100) - 1 > 0xffffffff) return void bad(res, 'the tag range must fit uint32');
  }

  // La frontera del tenant: el ledger validado en el alta. Nada anterior puede
  // clasificarse como dinero de este run — en un omnibus vivo, el tráfico
  // legacy con un tag coincidente quedaría acreditado a un cliente demo.
  const sinceLedgerIndex = (await currentValidatedLedgerIndex()) ?? undefined;
  const resolved = poteAddress ? null : await resolvePoteOf(String(councilAddress));

  // seq allocation and the tag-overlap check read ALL runs: serialized, so two
  // concurrent creations cannot take the same seq / overlapping ranges.
  await withRunLock('__runs__', async () => {
    const existing = await listRuns();
    // The ONE thing a declaration may not do: take an address that already has
    // another role. Declaring it puts it under the 0xFE seat guard, so another
    // exchange's ROOT would stop being able to take its own seat, and a CLIENT's
    // own wallet would be told its own hand-offs are «Astryum's server flows» —
    // a user locked out of their own account by somebody else's sign-up form.
    const declared = String(omnibusAddress);
    for (const r of existing) {
      if (r.councilAddress === declared) {
        return void res.status(409).json({
          error: 'OMNIBUS_IS_ANOTHER_COUNCIL',
          detail: `${declared} is already the council root of the exchange "${r.label}" — an account cannot govern one exchange and hold the client XRP of another. Use the omnibus account you created for this desk.`,
        });
      }
      const asClient = r.clients.find((c) => c.xrplAddress === declared);
      if (asClient) {
        return void res.status(409).json({
          error: 'OMNIBUS_IS_A_CLIENT_WALLET',
          detail: `${declared} is already on file as the personal XRPL wallet of a client of "${r.label}" — declaring it as an omnibus would take over that person's account. Use the omnibus account you created for this desk.`,
        });
      }
    }
    // Never a seq that was ever handed out: a deleted run's tags (seq×100+n) stay
    // its clients' — a late tagged return must not land on a new run's client.
    let highWater: number;
    try {
      highWater = await readSeqHighWater();
    } catch (e) {
      return void res.status(503).json({ error: 'SEQ_HIGH_WATER_UNREADABLE', detail: `the run sequence mark could not be read (${safeErrorDetail(e).slice(0, 200)}) — nothing was created; try again` });
    }
    // Every tag range EVER assigned (a deleted run's included): read strictly —
    // «could not read» must not read as «free» and hand out a deleted run's tags.
    let assigned: AssignedTagRange[];
    try {
      assigned = await readAssignedTagRanges();
    } catch (e) {
      return void res.status(503).json({ error: 'TAG_RANGES_UNREADABLE', detail: `the assigned tag ranges could not be read (${safeErrorDetail(e).slice(0, 200)}) — nothing was created; try again` });
    }
    let seq = nextRunSeq(existing, highWater);

    // Dos runs sobre el MISMO omnibus jamás comparten tags — ni con un run VIVO ni
    // con uno BORRADO: el rango es la frontera de clasificación del watcher, y un
    // solape acreditaría a un cliente de este run el retorno tardío de otro.
    const omnibus = String(omnibusAddress);
    let mine = runTagRange({ seq, tagBase, tagCount });
    let clash = findTagRangeClash(mine, omnibus, existing, assigned, highWater);
    // A classic run (no declared range) owns no particular seq: skip the seqs
    // whose classic tags another range holds instead of refusing forever.
    for (let i = 0; clash && tagBase === undefined && i < 1000; i++) {
      seq += 1;
      mine = runTagRange({ seq });
      clash = findTagRangeClash(mine, omnibus, existing, assigned, highWater);
    }
    if (clash) {
      return void res.status(409).json({
        error: 'TAG_RANGE_OVERLAP',
        detail: `tags ${mine.base}…${mine.base + mine.count - 1} overlap ${clash.label} (${clash.base}…${clash.base + clash.count - 1}) ${clash.source === 'unrecorded-classic' ? 'on any omnibus' : 'on the same omnibus'}`,
      });
    }

    // El exchange iba SIEMPRE en autopilot: nacía encendido si
    // la llave de este backend abría SU omnibus. Nace APAGADO y
    // la mesa firma cada movimiento desde el omnibus con un QR de Xaman. El
    // autopilot queda construido e inerte (AUTOPILOT_AT_BIRTH); una run que ya
    // lo tenía encendido lo conserva hasta que se apague.
    const signerCfg = readSignerConfig();
    const run: DemoRun = {
      // El dueño, desde el primer byte (ver DemoRun.createdByUserId).
      createdByUserId: creatorUserId,
      autopilot: AUTOPILOT_AT_BIRTH && Boolean(signerCfg.enabled && signerCfg.address && signerCfg.address === String(omnibusAddress)),
      runId: newId('run'),
      seq,
      label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 60) : `take ${seq}`,
      councilAddress: String(councilAddress),
      omnibusAddress: String(omnibusAddress),
      policy: (policy as 'A' | 'B') ?? 'A',
      registryAddress: registryAddress ? ethers.getAddress(String(registryAddress)) : undefined,
      poteAddress: poteAddress ? ethers.getAddress(String(poteAddress)) : undefined,
      tagBase,
      tagCount,
      sinceLedgerIndex,
      createdAt: new Date().toISOString(),
      status: 'open',
      clients: [],
      receipts: [],
      appliedTxHashes: [],
    };
    if (!run.poteAddress) applyResolvedPote(run, resolved);
    // Both marks PROVEN persisted before the run exists (read-back inside each).
    try {
      await bumpSeqHighWater(seq);
      await recordAssignedTagRange({ runId: run.runId, seq, omnibusAddress: run.omnibusAddress, base: mine.base, count: mine.count, assignedAt: run.createdAt });
    } catch (e) {
      return void res.status(503).json({ error: 'RUN_MARKS_NOT_PERSISTED', detail: `the run sequence / tag range could not be recorded (${safeErrorDetail(e).slice(0, 200)}) — nothing was created; try again` });
    }
    await saveRun(run);
    // The declaration reaches the 0xFE nonce-seat guard NOW, not at the next
    // snapshot: from this line on, a stranger's hand-off against this omnibus is
    // refused (OPERATIONAL_ACCOUNT_HANDOFF_REFUSED) and the desk's own flows are
    // not. Persisted on the run itself — a restart rebuilds it from the store.
    rememberDeclaredOmnibus(run.omnibusAddress);
    res.status(201).json({ run: publicRun(run, undefined, undefined, OPERATOR_VIEW) });
  });
}));

/**
 * Which exchange is this account a client of? The client surface resolves its
 * exchange from the client's own identity (their passkey account) — never from
 * a picker. With a valid session bearer, the row OWNED by that user wins, then
 * an unowned row; a row owned by someone else is never returned to an
 * authenticated caller (a passkey address is public — anyone can put it on a
 * row). Without a session: first match, and the response says if there were
 * more.
 */
router.get('/runs/for-account', guarded(async (req, res) => {
  const account = String(req.query.account ?? '').trim();
  if (!EVM_RE.test(account)) return void bad(res, 'account must be the client Flare account (0x…)');
  const viewer = await optionalSessionUserId(req);
  // THE PORTAL DECIDES OWNERSHIP, so «could not use the mark» is
  // answered as what it is: a retryable 503 with the cause, never as «this row
  // predates a takeover» → `reclaimRequired: true` → a founder-only remedy with
  // no button. See `viewerTakeoverVerdict`.
  const takeover = await viewerTakeoverVerdict(viewer);
  if (takeover.unusable) return void res.status(503).json(ownershipUnreadableBody(takeover.unusable));
  const viewerTakeoverAt = takeover.at;
  const runs = await listRuns();
  let matches = runs.flatMap((r) =>
    r.clients
      .filter((c) => c.passkeyAccount && c.passkeyAccount.toLowerCase() === account.toLowerCase())
      .map((c) => ({ run: r, client: c })),
  );
  // Antes de filtrar: ¿esta llave YA es cliente en algún exchange? (para `heldElsewhere`)
  const anyMatch = matches[0];
  let staleOwn = false;
  if (viewer) {
    const own = matches.filter((m) => m.client.ownerUserId === viewer && !ownershipPredatesTakeover(m.client, viewerTakeoverAt));
    staleOwn = matches.some((m) => m.client.ownerUserId === viewer && ownershipPredatesTakeover(m.client, viewerTakeoverAt));
    matches = own.length ? own : matches.filter((m) => !m.client.ownerUserId);
  }
  // CLIENTE POR EXCHANGE: a qué exchanges abiertos puede esta llave
  // PEDIR ACCESO todavía. Los que no tienen NINGUNA fila con esta llave, de
  // nadie: donde ya hay una (aunque sea de otra sesión) no se ofrece una segunda
  // ficha para la misma llave — la razón del `heldElsewhere` de abajo.
  const withThisKey = new Set(
    runs.filter((r) => r.clients.some((c) => c.passkeyAccount && c.passkeyAccount.toLowerCase() === account.toLowerCase())).map((r) => r.runId),
  );
  const joinable = runs.filter((r) => r.status === 'open' && !withThisKey.has(r.runId)).map(summary);
  if (!matches.length) {
    // La llave YA tiene
    // ficha, pero no es de esta sesión. Sin esto el cliente caía en «abrir una
    // cuenta» y, con un solo exchange, a crear una SEGUNDA ficha para la misma
    // llave. Se dice DÓNDE está (lo mismo que ya ve una lectura anónima), jamás
    // DE QUIÉN; y si es suya pero anterior a una toma de posesión, que toca reclamarla.
    const heldElsewhere = anyMatch ? { exchange: summary(anyMatch.run), reclaimRequired: staleOwn } : undefined;
    return void res.json({ found: false, exchanges: runs.filter((r) => r.status === 'open').map(summary), joinable, ...(heldElsewhere ? { heldElsewhere } : {}) });
  }
  const first = matches[0];
  res.json({
    found: true,
    runId: first.run.runId,
    exchange: summary(first.run),
    client: publicClient(first.client, viewer, viewerTakeoverAt),
    others: matches.length - 1,
    // Todas sus cuentas (una por exchange), para que «Entrar» elija entre las
    // SUYAS — no un selector de identidad: la llave ya dijo quién es.
    memberships: matches.map((m) => ({ runId: m.run.runId, exchange: summary(m.run), client: publicClient(m.client, viewer, viewerTakeoverAt) })),
    joinable,
  });
}));

router.get('/runs/:id', guarded(async (req, res) => {
  const got = await requireRunAccess(req, res);
  if (!got) return;
  const { run, access } = got;
  const viewer = got.viewer.userId;
  // The desk reads the memo of the 0xFE it composed from here; nobody else does.
  const view = got.viewer.admin ? OPERATOR_VIEW : undefined;
  // «NO PUDE LEER TU MARCA» SE DICE, NO SOLO SE CALLA.
  // El display sigue fallando cerrado (nada se enseña como suyo: `mine:false`),
  // pero ese silencio tenía un consumidor: el libro del cliente se recarga cada
  // 20 s por esta ruta, `useExchangeClient` deriva «mi fila» de `mine`, y con la
  // fila del dueño en `owned:true, mine:false` la cuenta de una persona con XRP
  // dentro se convertía en «Open an account» — y si lo intentaba, 409
  // ACCOUNT_ALREADY_A_CLIENT. Un parpadeo del pooler bastaba. Ahora el cuerpo
  // lleva la causa (`viewerUnreadable`, el mismo veredicto y las mismas frases
  // que el portal), y el cliente pinta «could not read» con reintento.
  const takeover = await viewerTakeoverVerdict(viewer);
  const viewerTakeoverAt = takeover.unusable ? new Date() : takeover.at;
  const shaped = publicRun(run, viewer, viewerTakeoverAt, view);
  res.json({
    run: access.level === 'member' ? memberView(shaped, access.clientIds) : shaped,
    ...(takeover.unusable ? { viewerUnreadable: ownershipUnreadableBody(takeover.unusable) } : {}),
  });
}));

router.patch('/runs/:id', guarded(async (req, res) => {
  await withRunLock(String(req.params.id), async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    const { label, status, poteAddress, registryAddress, bridgeAddress, autopilot, policy } = req.body ?? {};
    if (typeof label === 'string' && label.trim()) run.label = label.trim().slice(0, 60);
    // CERRAR NO ES UN INTERRUPTOR SOBRE LO QUE YA ESTÁ EN VUELO.
    // Cerraba sin mirar nada: una retirada pendiente se quedaba detrás de un
    // `status !== 'open'` para siempre. Ahora (a) el autopiloto sirve SALIDAS
    // también en una toma cerrada, y (b) cerrar con peticiones vivas o reservas
    // de mesa abiertas se rechaza y las nombra: que se sirvan, se retiren
    // (DELETE del dueño) o se prueben (DELETE de admin) primero. Los SALDOS no
    // impiden cerrar: su salida sigue abierta (a). Reabrir siempre se puede.
    if (status === 'closed' && run.status !== 'closed') {
      // UNA ENTRADA PENDIENTE QUE NADIE FIRMÓ NO IMPIDE CERRAR: es
      // exactamente lo que el tick de una toma cerrada haría con ella
      // (`refuseClosedEntry` → RUN_CLOSED, final, con recibo), así que se hace
      // aquí, determinista y sin firmar nada. La prueba es la del tick: el
      // journal (`journalPlan === 'fulfil'`). Lo que el journal dice firmado, o
      // no se pudo leer, sigue contando como vivo — y se dice cuál.
      const now = new Date().toISOString();
      const closable: string[] = [];
      const unreadable: string[] = [];
      for (const r of requestsOf(run)) {
        if (r.status !== 'pending' || r.kind !== 'put-to-work' || r.txHash) continue;
        try {
          if (journalPlan(await readSubmission(r.id)) === 'fulfil') closable.push(r.id);
        } catch {
          unreadable.push(r.id);
        }
      }
      const live = liveWorkOf(run);
      live.requests = live.requests.filter((r) => !closable.includes(r.id));
      if (live.requests.length || live.deskPayments.length) {
        return void res.status(409).json({
          error: 'RUN_HAS_LIVE_WORK',
          detail: `this desk still has ${live.requests.length} client request(s) and ${live.deskPayments.length} desk reservation(s) in flight — serve them, withdraw them (DELETE /runs/:id/clients/:cid/requests/:rid) or prove them closed (DELETE /runs/:id/desk-payments/:pid) first. A closed desk keeps paying withdrawals, but it opens no new entries, so nothing pending is left behind a switch.${unreadable.length ? ` (${unreadable.length} pending entr${unreadable.length === 1 ? 'y' : 'ies'} could not be checked against the submission journal just now and count as live; try again in a moment.)` : ''}${closable.length ? ` ${closable.length} pending entr${closable.length === 1 ? 'y' : 'ies'} nobody signed would be closed by this switch and do not count.` : ''}`,
          requests: live.requests,
          deskPayments: live.deskPayments,
          ...(unreadable.length ? { retryable: true, journalUnreadableRequestIds: unreadable } : {}),
        });
      }
      for (const r of requestsOf(run)) {
        if (!closable.includes(r.id)) continue;
        r.status = 'refused';
        r.reason = 'RUN_CLOSED: this exchange desk was closed — no new entries are executed; the XRP stays at the exchange and can be withdrawn';
        r.updatedAt = now;
        run.receipts.push(makeReceipt(run, { step: 'NOTE', chain: 'none', clientId: r.clientId, note: `Desk closed: the pending put-to-work of ${dropsToXrpText(r.drops)} XRP (nothing signed for it, per the submission journal) was closed with RUN_CLOSED — the XRP stays at the exchange and can be withdrawn.`, expect: { code: 'RUN_CLOSED', kind: r.kind, drops: r.drops } }));
      }
    }
    if (status === 'open' || status === 'closed') run.status = status;
    // La política del run sigue al pote vivo: la jaula puede abrir un segundo
    // pote con otra ventana de salida (B → A para la toma).
    if (policy === 'A' || policy === 'B') run.policy = policy;
    if (typeof autopilot === 'boolean') {
      // The loop can only serve a run whose omnibus is the key it holds — say so
      // before the founder waits for a tick that will never sign.
      const cfg = readSignerConfig();
      if (autopilot && (!cfg.enabled || !cfg.address)) {
        return void res.status(409).json({ error: 'AUTOPILOT_UNAVAILABLE', detail: cfg.enabled ? (cfg.error ?? 'DEMO_EXCHANGE_OMNIBUS_SEED missing') : 'DEMO_EXCHANGE_AUTOSIGN_ENABLED is not true on this environment' });
      }
      if (autopilot && cfg.address !== run.omnibusAddress) {
        return void res.status(409).json({ error: 'AUTOPILOT_WRONG_OMNIBUS', detail: `the exchange key opens ${cfg.address}; this run's omnibus is ${run.omnibusAddress}` });
      }
      run.autopilot = autopilot;
    }
    if (typeof poteAddress === 'string' && EVM_RE.test(poteAddress)) run.poteAddress = ethers.getAddress(poteAddress);
    if (typeof bridgeAddress === 'string' && EVM_RE.test(bridgeAddress)) run.bridgeAddress = ethers.getAddress(bridgeAddress);
    if (typeof registryAddress === 'string' && EVM_RE.test(registryAddress)) run.registryAddress = ethers.getAddress(registryAddress);
    await saveRun(run);
    res.json({ run: publicRun(run, undefined, undefined, OPERATOR_VIEW) });
  });
}));

router.post('/runs/:id/resolve-pote', guarded(async (req, res) => {
  const snapshot = await requireRun(req, res);
  if (!snapshot) return;
  // The chain read (seconds) happens OUTSIDE the lock; only its result is applied to a fresh copy.
  const resolved = await resolvePoteOf(snapshot.councilAddress);
  await withRunLock(snapshot.runId, async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    applyResolvedPote(run, resolved);
    await saveRun(run);
    res.json({ run: publicRun(run, undefined, undefined, OPERATOR_VIEW), resolved: Boolean(run.poteAddress) });
  });
}));

router.delete('/runs/:id', guarded(async (req, res) => {
  const force = req.query.force === '1' || req.query.force === 'true';
  await withRunLock(String(req.params.id), async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    // BORRAR LA TOMA BORRA EL ESPEJO DE LO QUE SE DEBE A CADA CLIENTE.
    // No miraba saldos ni peticiones vivas: con 50 XRP de un cliente en el
    // ómnibus bajo su tag, borrar dejaba ese dinero sin ficha y una retirada
    // pendiente sin nadie que la sirviera. Sin `force` se rechaza y se nombra lo
    // que hay; con `force=1` (decisión explícita del fundador) se borra y queda
    // dicho en ops qué se descartó, porque después ya no hay dónde escribirlo.
    const live = liveWorkOf(run, { includeSigned: true });
    // LAS PARTICIPACIONES TAMBIÉN CUENTAN. `funded` miraba
    // solo `xrpOnExchangeDrops > 0`: un cliente cuyo XRP ya está EN EL POTE (la
    // entrada se ejecutó, el espejo quedó a 0) no contaba, y la toma se borraba
    // sin `force` con su ficha y su tag — que es lo que necesita su salida a XRP
    // por el ómnibus (U4_EXIT_XRP vuelve bajo SU tag). Cuenta ahora quien tuvo
    // una entrada ejecutada por esta mesa (recibo E5, petición done/signed,
    // reserva de mesa settled) sin ninguna salida suya registrada después.
    const funded = run.clients
      .map((c) => ({ id: c.id, label: c.label, tag: c.tag, xrpOnExchangeDrops: c.xrpOnExchangeDrops, inPote: clientCapitalInPote(run, c.id) }))
      .filter((c) => BigInt(c.xrpOnExchangeDrops || '0') > BigInt(0) || c.inPote);
    if (funded.length || live.requests.length || live.deskPayments.length) {
      if (!force) {
        const atExchange = funded.filter((c) => BigInt(c.xrpOnExchangeDrops || '0') > BigInt(0)).length;
        const inPote = funded.filter((c) => c.inPote).length;
        return void res.status(409).json({
          error: 'RUN_HAS_CLIENT_MONEY',
          detail: `this desk still holds client money or work in flight: ${atExchange} client(s) with XRP at the exchange, ${inPote} client(s) with capital put to work through this desk and no exit recorded since, ${live.requests.length} request(s) and ${live.deskPayments.length} desk reservation(s) open — pay them out first (a closed desk keeps paying withdrawals), or delete with ?force=1 to discard the ledger mirror knowingly; the omnibus balance on the XRP Ledger and the shares in each client's own account are untouched either way.`,
          clients: funded,
          requests: live.requests,
          deskPayments: live.deskPayments,
        });
      }
      try {
        const { opsAlert } = await import('../services/OpsAlertService');
        await opsAlert('demo-exchange', 'critical', `a desk run was DELETED by force with client money or work in flight — its ledger mirror is gone`, {
          key: `run-force-deleted:${run.runId}`,
          dedupe: false,
          runbook: 'El espejo de saldos ya no existe; el XRP sigue en el ómnibus bajo los tags de abajo. Si alguno es de un cliente, se le paga a mano desde el ómnibus.',
          facts: { run: run.label, runId: run.runId, omnibus: run.omnibusAddress, clients: funded.map((c) => `${c.label}#${c.tag}:${c.xrpOnExchangeDrops}${c.inPote ? ':in-pote' : ''}`).join(' '), requests: live.requests.map((r) => `${r.kind}:${r.id}:${r.status}`).join(' '), deskPayments: live.deskPayments.map((d) => `${d.kind}:${d.id}:${d.status}`).join(' ') },
        });
      } catch {
        /* the log below still says it */
      }
      console.error(`[demo-exchange] run ${run.runId} (${run.label}) deleted by FORCE with ${funded.length} funded client(s), ${live.requests.length} live request(s), ${live.deskPayments.length} open desk payment(s)`);
    }
    // Its seq and its tag range are never allocated again (a run created before
    // the marks existed records them here). Under the runs lock: a concurrent
    // creation cannot interleave. Not proven persisted → the run is NOT deleted.
    try {
      await withRunLock('__runs__', async () => {
        await bumpSeqHighWater(run.seq);
        const range = runTagRange(run);
        await recordAssignedTagRange({ runId: run.runId, seq: run.seq, omnibusAddress: run.omnibusAddress, base: range.base, count: range.count, assignedAt: run.createdAt });
      });
    } catch (e) {
      return void res.status(503).json({ error: 'RUN_MARKS_NOT_PERSISTED', detail: `the run sequence / tag range could not be recorded (${safeErrorDetail(e).slice(0, 200)}) — the run was not deleted; try again` });
    }
    await deleteRun(run.runId);
    // EL OLVIDO. El conjunto de cuentas operativas nunca retiraba
    // una: el omnibus de una run borrada seguía bajo la guarda del 0xFE para
    // siempre, y una salida desde esa cuenta sin prueba recibía 403 sin que
    // existiera ya ninguna mesa detrás. Se vuelve a leer ahora (no dentro de 15
    // s), y el propio resync poda el registro a mano de este proceso.
    await resyncDeclaredOmnibus();
    res.json({ deleted: run.runId });
  });
}));

/* ── clients (the exchange's own accounts — simulated) ──────────────────── */

/**
 * What is still in flight on a run: the facts a close/delete must name.
 * `includeSigned`: a 'signed' put-to-work (0xFE on the ledger, mint pending) is
 * already debited and the exit-only tick keeps following it in a closed run, so
 * CLOSING does not wait for it (an executor that never mints would otherwise
 * make the desk unclosable); DELETING would lose its record, so that one counts.
 */
function liveWorkOf(run: DemoRun, opts: { includeSigned?: boolean } = {}): { requests: Array<{ id: string; kind: string; clientId: string; status: string; drops: string }>; deskPayments: Array<{ id: string; kind: string; clientId: string; status: string; drops: string }> } {
  return {
    requests: requestsOf(run)
      .filter((r) => r.status === 'pending' || r.status === 'submitting' || (opts.includeSigned === true && r.status === 'signed'))
      .map((r) => ({ id: r.id, kind: r.kind, clientId: r.clientId, status: r.status, drops: r.drops })),
    deskPayments: deskPaymentsOf(run)
      .filter((d) => d.status === 'prepared' || d.status === 'signed')
      .map((d) => ({ id: d.id, kind: d.kind, clientId: d.clientId, status: d.status, drops: d.drops })),
  };
}

/**
 * Did this client's XRP go INTO the pote through this desk, with
 * no exit of theirs recorded since? Store-only (no chain read: «could not read»
 * must not decide a delete, and `force=1` remains the founder's override).
 * Entries: an E5_PUT_TO_WORK receipt, a put-to-work request 'done'/'signed'
 * (debited, shares to the client), a desk put-to-work 'settled'. Exits: a
 * U4_EXIT / U4_EXIT_XRP receipt of the client. An exit dated after the last
 * entry counts as «out» — a partial exit is the residual this rule accepts,
 * and the 409 names each client so the founder can look.
 */
function clientCapitalInPote(run: DemoRun, clientId: string): boolean {
  const ts = (s?: string): number => (s ? Date.parse(s) : NaN);
  const entryTimes: number[] = [];
  for (const r of run.receipts) if (r.clientId === clientId && r.step === 'E5_PUT_TO_WORK') entryTimes.push(ts(r.at));
  for (const q of requestsOf(run)) if (q.clientId === clientId && q.kind === 'put-to-work' && (q.status === 'done' || q.status === 'signed')) entryTimes.push(ts(q.updatedAt));
  for (const p of deskPaymentsOf(run)) if (p.clientId === clientId && p.kind === 'put-to-work' && p.status === 'settled') entryTimes.push(ts(p.updatedAt));
  if (!entryTimes.length) return false;
  const exitTimes = run.receipts.filter((r) => r.clientId === clientId && (r.step === 'U4_EXIT' || r.step === 'U4_EXIT_XRP')).map((r) => ts(r.at));
  if (!exitTimes.length) return true;
  const lastEntry = Math.max(...entryTimes.filter(Number.isFinite));
  const lastExit = Math.max(...exitTimes.filter(Number.isFinite));
  // Undatable rows fail towards «still in»: a delete is the irreversible side.
  if (!Number.isFinite(lastEntry) || !Number.isFinite(lastExit)) return true;
  return lastExit < lastEntry;
}

/** Another client of the run already holds this XRPL wallet. */
function walletTakenByOther(run: DemoRun, wallet: string, exceptClientId?: string): boolean {
  return run.clients.some((c) => c.id !== exceptClientId && c.xrplAddress === wallet);
}

/**
 * Self-serve rows one owner may open on one run (2.6c). Each row takes a
 * destination tag of the run's range: without a cap one session emptied it (99
 * tags) and nobody else could become a client. `DEMO_EXCHANGE_MAX_CLIENTS_PER_OWNER`.
 */
export function maxClientsPerOwner(): number {
  const n = Number(process.env.DEMO_EXCHANGE_MAX_CLIENTS_PER_OWNER);
  return Number.isInteger(n) && n >= 1 ? n : 5;
}

router.post('/runs/:id/clients', guarded(async (req, res) => {
  if (!demoGate(res)) return;
  const admin = isAdminRequest(res);
  const userId = req.siwe?.userId;
  if (!admin && !userId) return void res.status(401).json({ error: 'missing_bearer_token' });
  const { label, passkeyAccount, xrplAddress } = req.body ?? {};
  if (typeof label !== 'string' || !label.trim()) return void bad(res, 'label is required (a demo client name)');
  if (passkeyAccount !== undefined && passkeyAccount !== '' && !EVM_RE.test(String(passkeyAccount))) return void bad(res, 'passkeyAccount must be a 0x address');
  if (xrplAddress !== undefined && xrplAddress !== '' && !XRPL_RE.test(String(xrplAddress))) return void bad(res, 'xrplAddress must be an r-address');

  // The payout wallet of a self-serve row must be proven to its owner before it
  // is written (read outside the lock: a database call).
  let walletProof: DemoClient['xrplAddressProof'];
  if (xrplAddress) {
    if (admin) {
      walletProof = 'admin';
    } else {
      const proven = await proveXrplWallet(req, String(xrplAddress));
      if (!proven.proof) return void refuseUnprovenWallet(res, proven);
      walletProof = proven.proof;
    }
  }

  await withRunLock(String(req.params.id), async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    if (!admin) {
      const limit = maxClientsPerOwner();
      const owned = run.clients.filter((c) => c.ownerUserId === userId).length;
      if (owned >= limit) {
        return void res.status(409).json({
          error: 'CLIENTS_PER_OWNER_LIMIT',
          detail: `this account already opened ${owned} client account(s) on this exchange (limit ${limit}) — each one takes a deposit tag of the exchange; use one of yours, or ask the exchange`,
          limit,
        });
      }
    }
    // One XRPL wallet, one client of this run: the watcher credits and debits by
    // wallet, and a second row with the same wallet absorbed the other's withdraw
    // debit — the same balance could be paid out twice.
    if (xrplAddress && walletTakenByOther(run, String(xrplAddress))) {
      return void res.status(409).json({ error: 'WALLET_ALREADY_A_CLIENT', detail: 'this XRPL wallet is already the wallet of another client of this exchange' });
    }
    // Una passkey es UNA cuenta POR EXCHANGE — POR DUEÑO. Una dirección de
    // passkey es pública: comparar contra filas de cualquiera dejaba a un
    // atacante «reservar» la passkey de otro y dejarlo fuera
    // (ACCOUNT_ALREADY_A_CLIENT). Solo cuentan las filas del mismo dueño; para
    // el desk (admin), las filas sin dueño.
    //
    // POR EXCHANGE, NO GLOBAL. Antes se miraban TODAS las runs: la passkey
    // que ya era cliente de un exchange no podía pedir acceso a otro. Ser
    // cliente es por exchange — su tag, su KYC-<tag> sobre SU omnibus, su pote —
    // y nada del dinero cruza: el put-to-work deposita desde la PA del omnibus
    // en el pote de ESA run (receiver = la passkey), y la salida redime
    // participaciones de ESE pote con el tag de ESA run (no barre el FXRP suelto).
    if (passkeyAccount) {
      const want = ethers.getAddress(String(passkeyAccount));
      const dup = run.clients.find(
        (c) => c.passkeyAccount && ethers.getAddress(c.passkeyAccount) === want && (admin ? !c.ownerUserId : c.ownerUserId === userId),
      );
      if (dup) {
        return void res.status(409).json({
          error: 'ACCOUNT_ALREADY_A_CLIENT',
          detail: `this Flare account is already client "${dup.label}" (tag ${dup.tag}) of ${run.label}`,
          runId: run.runId,
          clientId: dup.id,
        });
      }
    }
    let tag: number;
    try {
      tag = nextClientTag(run);
    } catch (e) {
      return void res.status(409).json({ error: 'DEMO_RUN_FULL', detail: (e as Error).message });
    }
    const client: DemoClient = {
      id: newId('cl'),
      runId: run.runId,
      label: label.trim().slice(0, 40),
      tag,
      passkeyAccount: passkeyAccount ? ethers.getAddress(String(passkeyAccount)) : undefined,
      xrplAddress: xrplAddress ? String(xrplAddress) : undefined,
      xrplAddressProof: xrplAddress ? walletProof : undefined,
      kyc: 'none',
      xrpOnExchangeDrops: '0',
      createdAt: new Date().toISOString(),
    };
    // Self-serve: the session owns its row. Desk (admin): the row is UNOWNED and
    // its owner is whoever presents this one-time code — handed out of band.
    let claimCode: string | undefined;
    if (admin) {
      claimCode = newClaimCode();
      client.claimCodeHash = hashClaimCode(claimCode);
    } else {
      client.ownerUserId = userId;
      client.ownedSince = client.createdAt;
    }
    run.clients.push(client);
    await saveRun(run);
    // The row was just saved as this session's; if its mark cannot
    // be used right now, `mine` fails closed AND the body says why — otherwise
    // the fresh account rendered as «Open an account» again (then 409).
    const takeover = admin ? { at: null, unusable: null } : await viewerTakeoverVerdict(userId);
    const viewerAt = takeover.unusable ? new Date() : takeover.at;
    res.status(201).json({
      client: publicClient(client, userId, viewerAt),
      run: publicRun(run, userId, viewerAt, admin ? OPERATOR_VIEW : undefined),
      ...(claimCode ? { claimCode } : {}),
      ...(takeover.unusable ? { viewerUnreadable: ownershipUnreadableBody(takeover.unusable) } : {}),
    });
  });
}));

router.patch('/runs/:id/clients/:cid', guarded(async (req, res) => {
  const admin = isAdminRequest(res);
  const userId = req.siwe?.userId;
  if (!admin && !userId) return void res.status(401).json({ error: 'missing_bearer_token' });
  const { label, passkeyAccount, xrplAddress, kyc, autoInvest, claimCode, ownerUserId, issueClaimCode } = req.body ?? {};
  if (!admin && (kyc !== undefined || ownerUserId !== undefined || issueClaimCode !== undefined)) {
    return void res.status(403).json({ error: 'ADMIN_ONLY_FIELD', detail: 'kyc, ownerUserId and issueClaimCode are set by the exchange (a founder session), never self-serve' });
  }
  const wantsWallet = typeof xrplAddress === 'string' && XRPL_RE.test(xrplAddress);
  // Read outside the lock (a database call); applied only if the row accepts a wallet.
  const walletProof: WalletProof | null = wantsWallet && !admin ? await proveXrplWallet(req, xrplAddress) : null;
  const takeover = await sessionTakeoverOr503(res, userId, admin);
  if (!takeover) return;

  await withRunLock(String(req.params.id), async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    const client = run.clients.find((c) => c.id === req.params.cid);
    if (!client) return void res.status(404).json({ error: 'CLIENT_NOT_FOUND', detail: 'no client with this id on this exchange — the row may have been removed, or the link is stale; reload and try again' });

    // WHO may touch this row. Owner = the session that created it or claimed it
    // with the desk's code. An unowned row is claimed only with that code; a
    // legacy row (passkey, no owner, no code) only by a founder.
    let claiming = false;
    if (!admin) {
      if (!client.ownerUserId) {
        if (typeof claimCode !== 'string' || !claimCode.trim()) {
          return void res.status(403).json({
            error: 'CLAIM_CODE_REQUIRED',
            detail: client.claimCodeHash
              ? 'this account was opened by the exchange — enter the claim code the exchange gave you to make it yours'
              : 'this account has no owner and no claim code — ask the exchange to issue you one',
          });
        }
        if (!client.claimCodeHash || !claimCodeMatches(claimCode, client.claimCodeHash)) {
          return void res.status(403).json({ error: 'CLAIM_CODE_INVALID', detail: 'that claim code does not open this account' });
        }
        claiming = true;
      } else if (client.ownerUserId !== userId) {
        return void res.status(403).json({ error: 'NOT_YOUR_CLIENT', detail: 'this exchange account belongs to another user' });
      } else if (ownershipPredatesTakeover(client, takeover.at)) {
        return void res.status(403).json({ error: 'CLIENT_RECLAIM_REQUIRED', detail: RECLAIM_DETAIL });
      }
    }

    if (typeof label === 'string' && label.trim()) client.label = label.trim().slice(0, 40);
    // RECLAMAR sí, RE-APUNTAR jamás: una ficha sin passkey la fija su dueño; una
    // ya reclamada no se re-apunta a otra cuenta ni por error ni por ataque — el
    // put-to-work acuñaría las participaciones a un tercero. (El bloqueo
    // CLIENT_HAS_ACTIVITY de la sobra: quien llega aquí ya es el dueño
    // probado de la fila, o un fundador.)
    if (typeof passkeyAccount === 'string' && EVM_RE.test(passkeyAccount)) {
      const next = ethers.getAddress(passkeyAccount);
      if (client.passkeyAccount && ethers.getAddress(client.passkeyAccount) !== next) {
        return void res.status(409).json({
          error: 'CLIENT_ALREADY_CLAIMED',
          detail: 'this client already has a Flare account on file; re-pointing it would mint their shares to another account',
        });
      }
      client.passkeyAccount = next;
    }
    // The PAYOUT wallet: the autopilot pays withdrawals to exactly this field.
    // Written by a non-admin it must be PROVEN to the session user (login wallet
    // or signed binding) and it is set once — re-pointing is a founder action.
    // A proven wallet is itself payout proof (payoutProof), which is what lets a
    // client who deposited BEFORE registering a wallet withdraw at all.
    if (wantsWallet) {
      if (!admin && client.xrplAddress && client.xrplAddress !== xrplAddress) {
        return void res.status(409).json({
          error: 'CLIENT_WALLET_ALREADY_SET',
          detail: 'this client already has an XRPL payout wallet on file; re-pointing it would send their withdrawals to another account — the exchange does that',
        });
      }
      if (walletTakenByOther(run, xrplAddress, client.id)) {
        return void res.status(409).json({ error: 'WALLET_ALREADY_A_CLIENT', detail: 'this XRPL wallet is already the wallet of another client of this exchange' });
      }
      // The watcher debits an outgoing payment by the wallet it lands on: a
      // re-point while a payout is in flight loses this client's debit (and can
      // charge whoever takes the wallet next). Re-point only when nothing moves.
      if (client.xrplAddress && client.xrplAddress !== xrplAddress) {
        const moving = paymentsInFlight(run, client.id).filter((p) => p.source === 'desk' || p.kind === 'withdraw');
        if (moving.length) {
          return void res.status(409).json({
            error: 'PAYMENT_IN_FLIGHT',
            detail: `this client has an omnibus payment in flight (${moving.map((p) => `${p.source} ${p.kind} ${p.status}`).join('; ')}) — its payout wallet cannot be re-pointed until it settles or is released`,
            inFlight: moving,
          });
        }
      }
      if (admin) {
        client.xrplAddress = xrplAddress;
        client.xrplAddressProof = 'admin';
      } else if (walletProof?.proof) {
        client.xrplAddress = xrplAddress;
        client.xrplAddressProof = walletProof.proof;
      } else if (client.xrplAddress !== xrplAddress) {
        return void refuseUnprovenWallet(res, walletProof ?? { proof: null, unreadable: false });
      }
      // Same address re-sent without proof: nothing changes (never a downgrade).
    }
    if (admin) {
      if (kyc === 'none' || kyc === 'registry' || kyc === 'credential' || kyc === 'both') client.kyc = kyc;
      if (typeof ownerUserId === 'string' && ownerUserId.trim()) {
        client.ownerUserId = ownerUserId.trim();
        client.ownedSince = new Date().toISOString();
        client.claimCodeHash = undefined;
      }
    }
    let issuedCode: string | undefined;
    if (admin && issueClaimCode === true) {
      if (client.ownerUserId) {
        // Only a row whose owner's login was taken over AFTER it became theirs is
        // re-opened: that ownership is not proof of the person any more.
        // — same three causes and honest sentences as the portal; the
        // truncated `(${message.slice(0, 80)})` fragment is gone.
        const ownerVerdict = await viewerTakeoverVerdict(client.ownerUserId);
        if (ownerVerdict.unusable) return void res.status(503).json(ownershipUnreadableBody(ownerVerdict.unusable));
        const ownerTakeoverAt: Date | null = ownerVerdict.at;
        if (!ownershipPredatesTakeover(client, ownerTakeoverAt)) {
          return void res.status(409).json({ error: 'CLIENT_ALREADY_OWNED', detail: 'this client already has an owner; a claim code would open nothing' });
        }
        // The re-opened row must not inherit the MONEY DESTINATIONS of
        // whoever held the login before it was recovered — its payout wallet (and
        // its proof), its Flare account (where shares are minted), the deposit
        // senders the watcher recorded as payout proof, its standing auto-invest.
        // Before, only the owner was cleared: the next withdraw paid the squatter's
        // wallet and the next put-to-work minted to their passkey. A payment still
        // moving pays those destinations: re-open only when nothing moves (pending
        // requests the previous holder queued are refused below, never fulfilled).
        const moving = paymentsInFlight(run, client.id).filter((p) => !(p.source === 'request' && p.status === 'pending'));
        if (moving.length) {
          return void res.status(409).json({
            error: 'PAYMENT_IN_FLIGHT',
            detail: `this account has an omnibus payment in flight (${moving.map((p) => `${p.source} ${p.kind} ${p.status}`).join('; ')}) — it pays the destinations on file, so the account cannot be re-opened until it settles or is released`,
            inFlight: moving,
          });
        }
        const nowIso = new Date().toISOString();
        const senders = run.provenDepositSenders?.[client.id] ?? [];
        let refusedRequests = 0;
        for (const r of requestsOf(run)) {
          if (r.clientId !== client.id || r.status !== 'pending') continue;
          r.status = 'refused';
          r.reason = 'ownership reset for re-claim: queued before the owner login was recovered — ask again from the re-claimed account';
          r.updatedAt = nowIso;
          refusedRequests++;
        }
        run.receipts.push(makeReceipt(run, {
          step: 'NOTE',
          chain: 'none',
          clientId: client.id,
          note: `Ownership reset for re-claim: the owner login was taken over after this account became theirs — a new one-time claim code was issued. Detached the destinations set before it: payout wallet ${client.xrplAddress ?? '—'}, Flare account ${client.passkeyAccount ?? '—'}, ${senders.length} proven deposit sender(s)${client.autoInvest ? ', auto-invest' : ''}; ${refusedRequests} pending request(s) refused. The new holder registers them again.`,
          expect: {
            reclaim: true,
            takeoverAt: ownerTakeoverAt ? ownerTakeoverAt.toISOString() : '',
            detachedXrplAddress: client.xrplAddress ?? '',
            detachedXrplAddressProof: client.xrplAddressProof ?? '',
            detachedPasskeyAccount: client.passkeyAccount ?? '',
            detachedDepositSenders: senders.join(',').slice(0, 200),
            detachedAutoInvest: client.autoInvest === true,
            detachedKyc: client.kyc,
            refusedRequests,
          },
        }));
        client.ownerUserId = undefined;
        client.ownedSince = undefined;
        client.xrplAddress = undefined;
        client.xrplAddressProof = undefined;
        // Cleared, so the claimer can set their own (PATCH refuses re-pointing only an account already on file).
        client.passkeyAccount = undefined;
        client.autoInvest = undefined;
        // KYC was of the detached identities (the registry approves a Flare account, the credential an XRPL one).
        client.kyc = 'none';
        if (run.provenDepositSenders) delete run.provenDepositSenders[client.id];
      }
      issuedCode = newClaimCode();
      client.claimCodeHash = hashClaimCode(issuedCode);
    }
    if (claiming) {
      client.ownerUserId = userId;
      client.ownedSince = new Date().toISOString();
      client.claimCodeHash = undefined;
    }
    if (typeof autoInvest === 'boolean') client.autoInvest = autoInvest;
    await saveRun(run);
    // A claim just made the row the session's: `mine` is computed without the old takeover.
    const viewerAt = claiming ? null : takeover.at;
    res.json({ client: publicClient(client, userId, viewerAt), run: publicRun(run, userId, viewerAt, admin ? OPERATOR_VIEW : undefined), ...(issuedCode ? { claimCode: issuedCode } : {}) });
  });
}));

/**
 * Non-admin mutations of a client row need the session to own it — and to own it
 * since after any takeover of its login (`takeoverAt`). Writes the 403.
 */
function refuseNotOwner(res: Response, client: DemoClient, userId: string | undefined, takeoverAt: Date | null): boolean {
  if (userId && client.ownerUserId === userId) {
    if (!ownershipPredatesTakeover(client, takeoverAt)) return false;
    res.status(403).json({ error: 'CLIENT_RECLAIM_REQUIRED', detail: RECLAIM_DETAIL });
    return true;
  }
  res.status(403).json({
    error: 'NOT_YOUR_CLIENT',
    detail: client.ownerUserId ? 'this exchange account belongs to another user' : 'this exchange account has no owner yet — claim it with the code the exchange gave you',
  });
  return true;
}

/**
 * A client request to the exchange backend: put my XRP to work / pay me out.
 * The autopilot (if this backend holds the omnibus key) fulfils it; otherwise a
 * human does it in the Exchange tab. Idempotent-ish: one pending request of a
 * kind per client at a time. Only the row's owner (or a founder) asks.
 */
/**
 * El KYC del exchange sobre la CASILLA del cliente (una XLS-70 `KYC-<tag>` de la
 * raíz sobre el omnibus), en las puertas de ENTRADA (depósito, poner a trabajar).
 * Ninguna SALIDA pasa por aquí — retirar, redimir y cobrar no lo miran (lo mismo
 * que dice ExchangeKycRegistry: «la salida (redeem) nunca pasa por aquí»), así que
 * una credencial caducada se renueva sin que el dinero quede atrapado. Devuelve
 * true cuando ya ha contestado y quien llama debe parar.
 */
async function refuseWithoutCredential(res: Response, run: DemoRun, client: DemoClient): Promise<boolean> {
  if (!clientCredentialGateEnabled()) return false;
  const verdict = await checkClientCredential(run, client);
  if (!isCredentialRefusal(verdict)) return false;
  // `credential` dice EXACTAMENTE qué hay que emitir: emisor, sujeto y tipo.
  res.status(verdict.status).json({ error: verdict.code, detail: verdict.detail, credential: verdict.spec });
  return true;
}

router.post('/runs/:id/clients/:cid/requests', guarded(async (req, res) => {
  const admin = isAdminRequest(res);
  const userId = req.siwe?.userId;
  const { kind, amountXrp } = req.body ?? {};
  if (kind !== 'put-to-work' && kind !== 'withdraw') return void bad(res, "kind must be 'put-to-work' | 'withdraw'");
  const amt = String(amountXrp ?? '');
  if (!XRP_AMOUNT_RE.test(amt) || Number(amt) <= 0) return void bad(res, 'amountXrp must be a positive XRP amount');
  const drops = xrpToDrops(amt);
  const takeover = await sessionTakeoverOr503(res, userId, admin);
  if (!takeover) return;
  await withRunLock(String(req.params.id), async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    const client = run.clients.find((c) => c.id === req.params.cid);
    if (!client) return void res.status(404).json({ error: 'CLIENT_NOT_FOUND', detail: 'no client with this id on this exchange — the row may have been removed, or the link is stale; reload and try again' });
    if (!admin && refuseNotOwner(res, client, userId, takeover.at)) return;
    // Una toma cerrada no abre ENTRADAS; la SALIDA sigue (la sirve el
    // autopiloto también cerrada, o la mesa). Un interruptor nuestro jamás gatea
    // una retirada.
    if (kind === 'put-to-work' && run.status !== 'open') {
      return void res.status(409).json({ error: 'RUN_CLOSED', detail: 'This exchange desk is closed: no new entries are executed. Your XRP stays at the exchange and can be withdrawn at any time.' });
    }
    // Entrar pide credencial; SALIR no: un `withdraw` jamás pasa por esta puerta.
    if (kind === 'put-to-work' && (await refuseWithoutCredential(res, run, client))) return;
    if (BigInt(drops) > BigInt(client.xrpOnExchangeDrops || '0')) {
      return void res.status(409).json({ error: 'INSUFFICIENT_LEDGER_BALANCE', detail: `The demo ledger holds ${(Number(client.xrpOnExchangeDrops || '0') / 1e6).toFixed(6)} XRP for this client.` });
    }
    if (kind === 'withdraw' && !client.xrplAddress) return void res.status(409).json({ error: 'CLIENT_HAS_NO_XRPL_WALLET', detail: 'Register the client own XRPL wallet first.' });
    // 'submitting' counts as open: a signed payment whose outcome is being read
    // off the ledger must not be joined by a second request of the same kind.
    const already = requestsOf(run).find((r) => r.clientId === client.id && r.kind === kind && (r.status === 'pending' || r.status === 'submitting'));
    if (already) {
      // LA PUERTA DEL DUEÑO, EN LA RUTA QUE USA EL DUEÑO. Una entrada
      // muerta (`NO_CLIENT_ACCOUNT`…) bloqueaba la siguiente con este 409 y no
      // decía que existe `DELETE .../requests/:rid`. Se nombra cuando
      // la que estorba no lleva hash: el DELETE vuelve a comprobar el journal y
      // solo cede si nada se firmó, así que nombrarla no promete nada.
      // — Y EL JOURNAL SE CONSULTA, como ya hace `refuseInFlight` vía
      // `againstFor`: `pending && !txHash` no es prueba de nada (un
      // guardado concurrente devuelve a 'pending' una petición YA firmada), y
      // aquí se nombraba como palanca una puerta que luego contestaba 409. Si el
      // journal no se puede leer no se nombra ninguna: «no pude leer» no promete.
      const door = await requestDoorByJournal(already);
      const releasable = door.releasable;
      return void res.status(409).json({
        error: 'REQUEST_PENDING',
        detail: `There is already a pending request of this kind for this client.${releasable ? ` If it is stuck, take it out of the queue first: DELETE /api/demo-exchange/runs/:id/clients/:cid/requests/${already.id} (it cedes only if nothing was signed for it), then ask again.` : door.journalUnreadable ? ` Whether a payment was already signed for it could not be read just now (${door.journalUnreadable}) — nothing was changed; ask again in a moment.` : ' It carries a signed payment: the ledger decides it.'}`,
        request: already,
        ...(releasable ? { withdrawableRequestIds: [already.id] } : {}),
        ...(door.journalUnreadable ? { retryable: true, journalUnreadable: true } : {}),
      });
    }
    // The mirror is debited only when an outcome is known: what is pending,
    // submitting or handed to Xaman by the desk is RESERVED, or «withdraw X» +
    // «put X to work» with X deposited were both signed.
    const balance = BigInt(client.xrpOnExchangeDrops || '0');
    // `kind` VIAJA, PORQUE LA ENTRADA Y LA SALIDA NO SE RETIENEN IGUAL.
    // Sin él, una put-to-work MUERTA (el autopiloto la deja `pending` a
    // propósito en `NO_CLIENT_ACCOUNT`, `NO_POTE`, `ABOVE_DAILY_CAP`...) reservaba
    // el saldo entero y esta misma puerta contestaba 409 a la RETIRADA de su
    // dueño: su dinero estaba «reservado por pagos en vuelo» sin que se hubiera
    // firmado nada nunca.
    // — y la exención la concede el JOURNAL, no el `status` de la fila:
    // un guardado concurrente del run devuelve a 'pending' una petición cuyo
    // pago ya está firmado y vivo (`againstFor`).
    // y si el journal no se pudo leer, la entrada retiene y se SIGUE —
    // una lectura nuestra fallida no niega una salida que cabe.
    const { against, journalUnreadable } = await journalBackedAgainst(run, client.id, kind);
    const reserved = reservedDrops(run, client.id, undefined, {}, against);
    if (BigInt(drops) + reserved > balance) {
      const available = balance > reserved ? balance - reserved : BigInt(0);
      // ESTE 409 ERA EL ÚNICO QUE UNA PERSONA REAL VEÍA, Y ERA EL ÚNICO
      // SIN PALANCA: ni `inFlight`, ni ids, ni la puerta. `refuseInFlight` la
      // nombraba solo en las rutas de mesa. Misma pieza (`inFlightLever`) aquí.
      const inFlight = paymentsInFlight(run, client.id, {}, undefined, against);
      const lever = inFlightLever(inFlight);
      const unread = journalUnreadableTail(journalUnreadable);
      return void res.status(409).json({
        error: 'INSUFFICIENT_AVAILABLE_BALANCE',
        detail: `The demo ledger holds ${dropsToXrpText(balance)} XRP for this client, but ${dropsToXrpText(reserved)} XRP of it are reserved by payments still in flight — ${dropsToXrpText(available)} XRP are available now.${lever.sentence}${unread.sentence}`,
        balanceDrops: balance.toString(),
        reservedDrops: reserved.toString(),
        availableDrops: available.toString(),
        inFlight,
        ...lever.ids,
        ...unread.fields,
      });
    }
    const now = new Date().toISOString();
    const request = { id: newId('rq'), kind, clientId: client.id, drops, status: 'pending' as const, createdAt: now, updatedAt: now };
    requestsOf(run).push(request);
    // El 201 dice la verdad también en una toma cerrada — el autopiloto
    // la sirve para SALIR (tick), y una entrada cerrada no llega hasta aquí.
    // «the autopilot will fulfil it on its next tick» only if there IS
    // a next tick — `run.autopilot` says the take is meant for the loop, not that
    // the loop is running (start() exits without a seed / the flags).
    const servedBy = run.autopilot && demoExchangeAutopilot.isRunning() ? 'autopilot' : 'desk';
    run.receipts.push(makeReceipt(run, { step: 'NOTE', chain: 'none', clientId: client.id, note: `Client requested ${kind} of ${amt} XRP${servedBy === 'autopilot' ? ' — the autopilot will fulfil it on its next tick' : ' — waiting for the exchange (E5/E8)'}${run.status !== 'open' ? ' (the desk is closed: withdrawals keep being paid)' : ''}.`, expect: { kind, drops } }));
    await saveRun(run);
    res.status(201).json({ request, servedBy, run: publicRun(run, userId, takeover.at, admin ? OPERATOR_VIEW : undefined) });
  });
}));

/**
 * LA PUERTA PARA RETIRAR UNA PETICIÓN QUE NADIE LLEGÓ A FIRMAR.
 *
 * No existía ninguna. Una petición `pending` se quedaba ahí para siempre: el
 * autopiloto la deja pendiente a propósito cuando cree que un tick posterior
 * podría firmarla (`NO_CLIENT_ACCOUNT`, `NO_POTE`, `ABOVE_DAILY_CAP`,
 * `NONCE_SEAT_TAKEN`, `HANDOFF_FAILED`, `SPEND_LEDGER_UNREADABLE`), y hay
 * estados que no se arreglan nunca. Esa petición bloqueaba luego cualquier otra
 * del mismo tipo (409 `REQUEST_PENDING`) y, hasta esta iteración, también la
 * salida de su dueño.
 */
router.delete('/runs/:id/clients/:cid/requests/:rid', guarded(async (req, res) => {
  const admin = isAdminRequest(res);
  const userId = req.siwe?.userId;
  // LA PUERTA DE ADMIN PARA UN ENTRY MALFORMADO. Un entry
  // del journal en 'submitting' SIN hash o sin LastLedgerSequence no se puede
  // seguir en el ledger ni probar muerto (`replayJournal` lo deja `pending` con
  // JOURNAL_ENTRY_MALFORMED; `resolveSubmitting` no toca un 'submitting' sin
  // hash): retenía la salida de su dueño PARA SIEMPRE, y esta puerta contestaba
  // 409 «no hash recorded» al dueño Y al admin — el runbook nombraba una puerta
  // que no existía. El DUEÑO sigue sin poder: no puede saber si el pago salió.
  // Un OPERADOR, que mira el historial del ómnibus por importe y fecha (el
  // runbook), lo cierra con `?closeMalformed=1`: journal → 'expired' con código,
  // asiento soltado si lo hay, petición 'refused' con su motivo, recibo y ops.
  const closeMalformed = admin && (req.query.closeMalformed === '1' || req.query.closeMalformed === 'true');
  const takeover = await sessionTakeoverOr503(res, userId, admin);
  if (!takeover) return;
  await withRunLock(String(req.params.id), async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    const client = run.clients.find((c) => c.id === req.params.cid);
    if (!client) return void res.status(404).json({ error: 'CLIENT_NOT_FOUND', detail: 'no client with this id on this exchange — the row may have been removed, or the link is stale; reload and try again' });
    if (!admin && refuseNotOwner(res, client, userId, takeover.at)) return;
    const request = requestsOf(run).find((r) => r.id === req.params.rid && r.clientId === client.id);
    if (!request) return void res.status(404).json({ error: 'REQUEST_NOT_FOUND', detail: 'no such request for this client — it may already have been served, withdrawn or closed; reload to see its current state' });
    // A 'submitting' with no hash is the run-side shape of the same
    // unfollowable state — the operator's door takes it too; nobody else does.
    const unfollowableSubmitting = request.status === 'submitting' && !request.txHash;
    if (request.status !== 'pending' && !(closeMalformed && unfollowableSubmitting)) {
      return void res.status(409).json({
        error: 'REQUEST_NOT_PENDING',
        detail: `this request is '${request.status}', not 'pending' — only a request with nothing signed can be withdrawn; the ledger decides the rest.`,
        request,
      });
    }
    // Un `pending` con hash no debería existir (la rama `expired` lo limpia al
    // devolverlo a la cola), pero si lo hubiera, hay bytes firmados: no se cede.
    if (request.txHash) {
      return void res.status(409).json({ error: 'PAYMENT_IN_FLIGHT', detail: 'this request carries a signed payment hash — the ledger decides it, it is not withdrawn by hand.', request });
    }
    let entry;
    try {
      entry = await readSubmission(request.id);
    } catch (e) {
      return void res.status(409).json({
        error: 'SUBMISSION_JOURNAL_UNREADABLE',
        retryable: true,
        detail: `whether this request was already signed could not be read (${safeErrorDetail(e).slice(0, 200)}) — nothing was changed; try again. (A withdrawal of this client's money does not depend on this: a pending entry no longer holds it.)`,
      });
    }
    // EL MISMO SUBCONJUNTO QUE EL AUTOPILOTO, NI UNO MÁS ESTRECHO.
    // Esto solo miraba 'submitting', pero `journalPlan` dice que TODO lo que no
    // sea 'expired' significa que la llave ya firmó. Un entry 'settled' —el pago
    // ENTRÓ en el ledger— con la petición clobbeada a 'pending' pasaba por aquí
    // y moría diciendo «nothing was ever signed for it»: nadie debitaba al
    // cliente (`attributeKnownPayouts` solo atribuye por hash de un `withdraw`, y
    // un 0xFE al Core Vault no lleva la wallet de nadie), así que se quedaba con
    // el dinero en el espejo Y en el pote. La misma pieza para las dos puertas.
    const plan = journalPlan(entry);
    // The malformed state, named once: the journal says «signed»
    // (anything but fulfil) and records no hash or no window; or the run says
    // 'submitting' with no hash and the journal has nothing better.
    const entryMalformed = Boolean(entry) && plan !== 'fulfil' && (typeof entry!.txHash !== 'string' || !entry!.txHash || typeof entry!.lastLedgerSequence !== 'number');
    const malformed = entryMalformed || (unfollowableSubmitting && (!entry || plan === 'fulfil'));
    if (closeMalformed && malformed) {
      const closedAt = new Date().toISOString();
      if (entry) {
        // Strict: an operator's close that the journal did not record would come
        // back on the next replay. `writeSubmission` proves the write (read-back).
        try {
          const { writeSubmission } = await import('../services/demoExchange/submissionJournal');
          await writeSubmission({ ...entry, status: 'expired', code: 'CLOSED_BY_OPERATOR_MALFORMED', updatedAt: closedAt });
        } catch (e) {
          return void res.status(503).json({ error: 'SUBMISSION_JOURNAL_NOT_PERSISTED', retryable: true, detail: `the journal entry could not be marked closed (${safeErrorDetail(e).slice(0, 120)}) — nothing was changed; try again` });
        }
      }
      // The omnibus seat of a composed 0xFE, if the entry kept its userOpHash: best-effort, its own window ends it anyway.
      const userOpHash = entry?.userOpHash ?? request.userOpHash;
      if (userOpHash) {
        try {
          const { markHandoffParkedByUserOpHash } = await import('../services/flare/DirectMintHandoffStore');
          await markHandoffParkedByUserOpHash(userOpHash);
        } catch {
          /* the seat TTL still frees it */
        }
      }
      const facts = `journal status '${entry?.status ?? 'none'}', hash '${String(entry?.txHash ?? request.txHash ?? '')}', LastLedgerSequence '${String(entry?.lastLedgerSequence ?? request.lastLedgerSequence ?? '')}'`;
      request.status = 'refused';
      request.reason = `JOURNAL_ENTRY_MALFORMED_CLOSED: closed by an operator — the submission journal said a payment was signed for this request but recorded no hash or no LastLedgerSequence (${facts}), so it could neither be followed on the ledger nor signed again; reconciled by hand against the omnibus history`;
      request.updatedAt = closedAt;
      run.receipts.push(makeReceipt(run, {
        step: 'NOTE',
        chain: 'none',
        clientId: client.id,
        note: `The ${request.kind} request of ${dropsToXrpText(request.drops)} XRP was closed by an operator: its submission journal entry was malformed (${facts}) — it could not be followed on the ledger nor signed again. The operator reconciled it by hand against the omnibus history; nothing was signed by this action, and the XRP it was holding is available again.`,
        expect: { kind: request.kind, drops: request.drops, by: 'desk', code: 'JOURNAL_ENTRY_MALFORMED_CLOSED', journalStatus: entry?.status ?? 'none' },
      }));
      await saveRun(run);
      try {
        const { opsAlert } = await import('../services/OpsAlertService');
        await opsAlert('demo-exchange', 'warn', 'an operator closed a request whose submission journal entry was malformed (no hash / no LastLedgerSequence)', {
          key: `malformed-closed:${request.id}`,
          dedupe: false,
          runbook: 'Cierre manual: el operador declaró que ese pago no está en el historial del ómnibus (o ya lo registró a mano). Si más tarde aparece un pago del ómnibus por ese importe y fecha que nadie explica, es este: regístralo contra el cliente.',
          facts: { run: run.label, runId: run.runId, request: request.id, client: client.id, kind: request.kind, drops: request.drops, journalStatus: entry?.status ?? 'none' },
        });
      } catch {
        /* the receipt and the log below already say it */
      }
      console.error(`[demo-exchange] request ${request.id} (${request.kind} ${request.drops} drops) with a MALFORMED journal entry was closed by an operator`);
      return void res.json({ request, reconciled: 'malformed-closed-by-operator', run: publicRun(run, userId, takeover.at, OPERATOR_VIEW) });
    }
    // `failed` ES UN RESULTADO VALIDADO DISTINTO DE tes: los drops nunca
    // salieron. Se agrupaba con «lo firmado» y remitía a un tick que, con el
    // bucle apagado, no existe. Aquí la puerta del dueño CEDE haciendo la misma
    // reconciliación que haría el tick (journal, asiento, gasto, negativa final
    // con recibo `XRPL_<code>`): la petición sale de la cola y libera lo suyo.
    if (entry && plan === 'finish-failed' && typeof entry.txHash === 'string' && entry.txHash && typeof entry.lastLedgerSequence === 'number') {
      await demoExchangeAutopilot.closeFailedSubmission(run, request, entry);
      await saveRun(run);
      return void res.json({ request, reconciled: 'failed-on-ledger', run: publicRun(run, userId, takeover.at, admin ? OPERATOR_VIEW : undefined) });
    }
    if (entry && plan !== 'fulfil') {
      const signedFact =
        plan === 'finish-settled'
          ? 'entered a validated ledger'
          : plan === 'finish-failed'
            ? `was signed and the ledger refused it (${entry.code ?? 'no code recorded'})`
            : 'was signed and its outcome is not read yet';
      // Un entry malformado (sin hash) reventaba aquí en `.slice` → 500.
      const hash = typeof entry.txHash === 'string' && entry.txHash ? `${entry.txHash.slice(0, 12)}…` : 'no hash recorded';
      // A malformed entry has NO tick that reconciles it — say which
      // door does (the operator's), instead of promising a next tick.
      const tail = entryMalformed
        ? admin
          ? ` This entry is MALFORMED (no hash or no LastLedgerSequence): no tick can follow it. Check the omnibus history by amount and date and, if the payment is not there (or you recorded it by hand), close it with DELETE /api/demo-exchange/runs/:id/clients/:cid/requests/${request.id}?closeMalformed=1.`
          : ' This entry is malformed (no hash or no LastLedgerSequence), so it cannot be followed on the ledger by anyone: the exchange desk checks the omnibus history and closes it — write to the exchange.'
        : ' The autopilot reconciles it on its next tick.';
      return void res.status(409).json({
        error: 'PAYMENT_IN_FLIGHT',
        detail: `the submission journal says a payment for this request ${signedFact} (${hash}, LastLedgerSequence ${entry.lastLedgerSequence ?? 'unknown'}) — the ledger decides it; it is not withdrawn by hand.${tail}`,
        request,
        ...(entryMalformed ? { malformed: true, operatorDoor: `DELETE /api/demo-exchange/runs/:id/clients/:cid/requests/${request.id}?closeMalformed=1` } : {}),
      });
    }
    const now = new Date().toISOString();
    // La mesa TOMA la petición para firmarla ella desde el
    // omnibus con un QR de Xaman. Es la misma cesión de arriba (nada firmado,
    // mismas comprobaciones del journal); lo que cambia es la verdad que queda
    // escrita: no se retiró, se sirve a mano — la reserva la hace a
    // continuación el pago de la mesa (withdraw/prepare o desk-payments).
    const takenByDesk = admin && (req.query.takenByDesk === '1' || req.query.takenByDesk === 'true');
    request.status = 'refused';
    request.reason = takenByDesk
      ? 'TAKEN_BY_THE_DESK: the exchange took it to sign it from its omnibus by QR — nothing had been signed for it'
      : admin && client.ownerUserId !== userId
        ? 'WITHDRAWN_BY_THE_DESK: taken out of the queue by an operator — nothing was ever signed for it'
        : 'WITHDRAWN_BY_THE_CLIENT: taken out of the queue by its owner — nothing was ever signed for it';
    request.updatedAt = now;
    run.receipts.push(makeReceipt(run, {
      step: 'NOTE',
      chain: 'none',
      clientId: client.id,
      note: takenByDesk
        ? `The ${request.kind} request of ${dropsToXrpText(request.drops)} XRP was taken by the exchange desk to be signed from the omnibus by QR. Nothing had been signed for it; the desk payment it becomes reserves the same XRP until the ledger settles it.`
        : `The ${request.kind} request of ${dropsToXrpText(request.drops)} XRP was withdrawn from the queue before anything was signed. No payment existed, so none was undone; the XRP it was holding is available again.`,
      expect: { kind: request.kind, drops: request.drops, by: admin ? 'desk' : 'client', ...(takenByDesk ? { takenByDesk: true } : {}) },
    }));
    await saveRun(run);
    res.json({ request, run: publicRun(run, userId, takeover.at, admin ? OPERATOR_VIEW : undefined) });
  });
}));

/**
 * LA PUERTA DE UNA RESERVA DE MESA DE LA QUE NUNCA SE COMPUSO NADA.
 *
 * `POST /runs/:id/desk-payments` abre una reserva `prepared` de `put-to-work`
 * SIN memo y sin un solo byte firmado: es solo el escritorio diciendo «voy a
 * meter esto a trabajar». Retenía el saldo de su dueño y no salía de ahí nunca —
 * no caduca por ledger (solo un `withdraw` cierra por LastLedgerSequence), y su
 * única puerta era `DELETE /runs/:id/desk-payments/:pid`, que es de admin y
 * contesta 503 mientras el XRPL no se pueda leer. La cárcel de la cola, mudada
 * de sitio por tercera vez.
 */
router.delete('/runs/:id/clients/:cid/desk-payments/:pid', guarded(async (req, res) => {
  const admin = isAdminRequest(res);
  const userId = req.siwe?.userId;
  const takeover = await sessionTakeoverOr503(res, userId, admin);
  if (!takeover) return;
  await withRunLock(String(req.params.id), async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    const client = run.clients.find((c) => c.id === req.params.cid);
    if (!client) return void res.status(404).json({ error: 'CLIENT_NOT_FOUND', detail: 'no client with this id on this exchange — the row may have been removed, or the link is stale; reload and try again' });
    if (!admin && refuseNotOwner(res, client, userId, takeover.at)) return;
    const p = deskPaymentsOf(run).find((d) => d.id === req.params.pid && d.clientId === client.id);
    if (!p) return void res.status(404).json({ error: 'DESK_PAYMENT_NOT_FOUND', detail: 'no such desk reservation for this client — it may already have been settled or released; reload to see its current state' });
    if (p.status === 'released' || p.status === 'settled') {
      return void res.json({ deskPayment: p, run: publicRun(run, userId, takeover.at, admin ? OPERATOR_VIEW : undefined) });
    }
    if (!deskReservationNothingSigned(p)) {
      return void res.status(409).json({
        error: 'DESK_PAYMENT_NOT_RELEASABLE_HERE',
        // Decía «It does not hold your withdrawal», y es falso — una
        // reserva con memo SÍ retiene la salida (inFlight.test lo afirma): ahí
        // puede haber un 0xFE firmado en un teléfono. Lo que se dice ahora es lo
        // que pasa: retiene hasta que pase su ventana, y entonces el propio
        // autopiloto la prueba y la suelta (paso 0).
        // «releases it on its own» is promised only while the loop
        // that does it is RUNNING (it now sweeps manual takes too); with the loop
        // down, what is true is that the desk closes it against the ledger.
        detail: `this reservation is a ${p.kind} in '${p.status}'${p.memoHex ? ' and carries a 0xFE memo' : ''}${p.txHash ? ` and a payment hash (${p.txHash.slice(0, 12)}…)` : ''} — only the desk can close it, and only against the ledger (DELETE /api/demo-exchange/runs/:id/desk-payments/${p.id}). While it is open it does hold that XRP, including against your withdrawal: something of it may be signed, and that is the one thing that stops the same XRP being paid twice.${typeof p.lastLedgerSequence === 'number' ? ` It can land until XRPL ledger ${p.lastLedgerSequence}; once that ledger is past, ${demoExchangeAutopilot.isRunning() ? 'the exchange proves it absent and releases it on its own' : 'the desk proves it absent against the ledger and releases it (the exchange backend loop is not running on this deployment, so it will not happen by itself)'}.` : ''}`,
        sweepRunning: demoExchangeAutopilot.isRunning(),
        deskPayment: p,
      });
    }
    p.status = 'released';
    p.closedBy = `released by ${admin && client.ownerUserId !== userId ? 'the desk' : 'its owner'}; no 0xFE was ever composed for it (no memo, no hash), so there was nothing to undo`;
    p.updatedAt = new Date().toISOString();
    run.receipts.push(makeReceipt(run, {
      step: 'NOTE',
      chain: 'none',
      clientId: client.id,
      note: `The desk reservation of ${dropsToXrpText(p.drops)} XRP was released before any 0xFE was composed for it. No payment existed, so none was undone; the XRP it was holding is available again.`,
      expect: { kind: p.kind, drops: p.drops, by: admin && client.ownerUserId !== userId ? 'desk' : 'client' },
    }));
    await saveRun(run);
    res.json({ deskPayment: p, run: publicRun(run, userId, takeover.at, admin ? OPERATOR_VIEW : undefined) });
  });
}));

/* ── autopilot (the simulated exchange backend) ───────────────────────────── */

router.get('/autopilot', guarded(async (_req, res) => {
  // Si este despliegue guarda una llave de omnibus, y de qué cuenta, es cosa de la mesa.
  if (!isAdminRequest(res)) return void res.status(404).json({ error: 'NOT_FOUND' });
  res.json(await demoExchangeAutopilot.status());
}));

/** A tick on demand — for the demo (no waiting) and for tests. Same discipline as the loop. */
router.post('/autopilot/tick', guarded(async (_req, res) => {
  const cfg = readSignerConfig();
  if (!cfg.enabled) return void res.status(503).json({ error: 'AUTOPILOT_DISABLED', detail: 'DEMO_EXCHANGE_AUTOSIGN_ENABLED is not true' });
  const r = await demoExchangeAutopilot.tick();
  const status = await demoExchangeAutopilot.status();
  // A pass that could not even read its list is not «0 runs, all
  // good» — the tick keeps the process alive (no unhandled rejection) and names
  // the failure, and the route answers 503 so the operator sees it.
  if (r.failed) {
    return void res.status(503).json({ error: 'AUTOPILOT_TICK_FAILED', retryable: true, detail: r.failed, runs: r.runs, actions: r.actions, status });
  }
  res.json({ runs: r.runs, actions: r.actions, status });
}));

/**
 * Unsigned XRPL Payment for the CLIENT's own wallet: XRP → omnibus with their
 * destination tag — exactly what they would do at any exchange. Prepare-only;
 * the client signs it in Xaman. SourceTag stamped (attribution 'user'). Only
 * the row's owner (or a founder) composes it.
 */
router.post('/runs/:id/clients/:cid/deposit-instructions', guarded(async (req, res) => {
  if (!demoGate(res)) return;
  const run = await requireRun(req, res);
  if (!run) return;
  const client = run.clients.find((c) => c.id === req.params.cid);
  if (!client) return void res.status(404).json({ error: 'CLIENT_NOT_FOUND', detail: 'no client with this id on this exchange — the row may have been removed, or the link is stale; reload and try again' });
  if (!isAdminRequest(res)) {
    const takeover = await sessionTakeoverOr503(res, req.siwe?.userId, false);
    if (!takeover) return;
    if (refuseNotOwner(res, client, req.siwe?.userId, takeover.at)) return;
  }
  // Un exchange custodial no admite depósitos de quien no ha pasado su KYC.
  if (await refuseWithoutCredential(res, run, client)) return;
  const amountXrp = String(req.body?.amountXrp ?? '');
  if (!XRP_AMOUNT_RE.test(amountXrp) || Number(amountXrp) <= 0) return void bad(res, 'amountXrp must be a positive XRP amount (≤ 6 decimals)');
  const drops = xrpToDrops(amountXrp);
  const base: Record<string, unknown> = {
    TransactionType: 'Payment',
    Destination: run.omnibusAddress,
    DestinationTag: client.tag,
    Amount: drops,
  };
  if (client.xrplAddress) base.Account = client.xrplAddress;
  const xrplTx = withSourceTag(base, 'user');
  res.json({
    client: { id: client.id, label: client.label, tag: client.tag },
    xrplTx,
    instructions: {
      destination: run.omnibusAddress,
      destinationTag: client.tag,
      amountXrp,
      drops,
    },
    disclosure: {
      disclosedToUser: true,
      astryumSigns: false,
      title: 'Deposit XRP at the exchange',
      lines: [
        `Send ${amountXrp} XRP to ${run.omnibusAddress} with destination tag ${client.tag} — the same thing you do at any exchange.`,
        'You sign it in your own wallet (Xaman). Astryum signs nothing.',
        'The exchange ledger credits it when the payment is validated on the XRP Ledger (the watcher reads the ledger, not this form).',
      ],
    },
  });
}));

/**
 * Ledgers a desk payout stays signable. Past its LastLedgerSequence the payment
 * can never enter a ledger — but its reservation closes only once an exhaustive
 * read of its window proves it absent (deskPaymentProof.proveDeskPayouts).
 */
/**
 * `PUT_TO_WORK_LEDGER_WINDOW` (100) es la ventana que la mesa clavaba HASTA la:
 * se conserva y se re-exporta porque las filas compuestas antes de ese
 * cambio la llevan, y la prueba de liberación las lee. La mesa ya no la fija —
 * la ventana viva es la del constructor (`defaultLastLedgerWindow()`, 90).
 */
export { DESK_PAYOUT_LEDGER_WINDOW, PUT_TO_WORK_LEDGER_WINDOW };

const MEMO_HEX_RE = /^[0-9a-fA-F]{2,512}$/;

/**
 * LA PRUEBA DE QUE NADA ESTÁ FIRMADO, ANTES DE COMPONER NADA.
 *
 * `availableBalance` es pura, así que la exención asimétrica (una ENTRADA
 * pendiente no retiene la SALIDA de su dueño) entra por la puerta como prueba
 * leída del journal durable. Si el journal no se puede leer no se exime a nadie
 * —lo único que compra una reserva es no pagar dos veces.
 */
async function journalBackedAgainst(run: DemoRun, clientId: string, kind: AgainstKind): Promise<{ against: Against; journalUnreadable: string | null }> {
  try {
    return { against: await againstFor(run, clientId, kind), journalUnreadable: null };
  } catch (e) {
    return { against: { kind }, journalUnreadable: safeErrorDetail(e).slice(0, 120) || 'unknown error' };
  }
}

/**
 * Is the owner's DELETE going to CEDE on this request? The same
 * rule `againstFor` applies to build `provenSigned`/`provenUnsigned` (and the
 * DELETE itself, `journalPlan`): only a 'pending' without hash whose journal
 * entry is absent, expired, or a validated failure. Unreadable journal → not
 * named as a door (and said), never «releasable» by guesswork.
 */
async function requestDoorByJournal(request: { id: string; status: string; txHash?: string }): Promise<{ releasable: boolean; journalUnreadable: string | null }> {
  if (request.status !== 'pending' || request.txHash) return { releasable: false, journalUnreadable: null };
  try {
    const plan = journalPlan(await readSubmission(request.id));
    return { releasable: plan === 'fulfil' || plan === 'finish-failed', journalUnreadable: null };
  } catch (e) {
    return { releasable: false, journalUnreadable: safeErrorDetail(e).slice(0, 120) || 'unknown error' };
  }
}

/**
 * The fields a balance 409 carries when the journal could not be read:
 * the refusal is then «it does not fit while every pending entry of yours is
 * counted as reserved», which asking again can change; never «your money is held».
 */
function journalUnreadableTail(journalUnreadable: string | null): { sentence: string; fields: Record<string, unknown> } {
  if (!journalUnreadable) return { sentence: '', fields: {} };
  return {
    sentence: ` (The exchange's record of which pending entries were already signed could not be read just now — ${journalUnreadable} — so every pending entry of this client was counted as reserved. Nothing was changed; asking again once it can be read may fit.)`,
    fields: { retryable: true, journalUnreadable: true },
  };
}

/**
 * /29/31 — LA PALANCA, dicha una vez y usada en TODAS las puertas.
 * Si lo que estorba es una petición que NADIE ha firmado, el 409 sigue siendo
 * correcto (evita pagar dos veces) pero no es un callejón sin salida: se nombra
 * la puerta que existe (el DELETE del dueño, que vuelve a comprobar el journal
 * y solo cede si nada se firmó). Lo mismo para una RESERVA DE MESA sin memo ni
 * hash, que tiene la suya. También la usa `POST .../requests`, la única
 * ruta que una persona real toca, que hasta ahora respondía sin ids ni puerta.
 */
export function inFlightLever(inFlight: InFlight[]): { sentence: string; ids: { withdrawableRequestIds?: string[]; releasableDeskPaymentIds?: string[] } } {
  const releasable = inFlight.filter((p) => p.releasable);
  const first = releasable[0];
  const many = releasable.length > 1;
  const door = first
    ? first.source === 'request'
      ? `DELETE /api/demo-exchange/runs/:id/clients/:cid/requests/${first.id}`
      : `DELETE /api/demo-exchange/runs/:id/clients/:cid/desk-payments/${first.id}`
    : '';
  const sentence = first
    ? ` Nothing of ${many ? 'them' : 'it'} appears signed: ${door} takes ${many ? 'the first' : 'it'} out of the way (it cedes only if nothing was signed for it), and then this composes.`
    : '';
  return {
    sentence,
    ids: {
      ...(releasable.some((p) => p.source === 'request') ? { withdrawableRequestIds: releasable.filter((p) => p.source === 'request').map((p) => p.id) } : {}),
      ...(releasable.some((p) => p.source === 'desk') ? { releasableDeskPaymentIds: releasable.filter((p) => p.source === 'desk').map((p) => p.id) } : {}),
    },
  };
}

function refuseInFlight(res: Response, inFlight: InFlight[], journalUnreadable: string | null = null): void {
  const list = inFlight
    .map((p) => `${p.source === 'desk' ? 'desk' : 'client request'} ${p.kind} of ${dropsToXrpText(p.drops)} XRP (${p.status}${p.txHash ? ` ${p.txHash.slice(0, 10)}…` : ''})`)
    .join('; ');
  const lever = inFlightLever(inFlight);
  const unread = journalUnreadableTail(journalUnreadable);
  res.status(409).json({
    error: 'PAYMENT_IN_FLIGHT',
    detail: `this client already has an omnibus payment in flight — ${list}. Nothing new is composed until the ledger settles or refuses it (scan the omnibus, or wait for the autopilot).${lever.sentence}${unread.sentence}`,
    inFlight,
    ...lever.ids,
    ...unread.fields,
  });
}

/**
 * Unsigned XRPL Payment for the EXCHANGE: omnibus → the client's own wallet
 * (step E8, "withdraw from the exchange"), composed for the founder desk to sign
 * in Xaman. Before composing:
 *  · the omnibus is SCANNED (fresh mirror: a payout that already left is
 *    debited), with the validated ledger read BEFORE the scan;
 *  · 409 PAYMENT_IN_FLIGHT if the client has a request pending/submitting or a
 *    desk payment still open — a desk whose pending signature was lost (the stage
 *    unmounted it, a reload) cannot compose a second payment of the same balance;
 *  · the payout carries LastLedgerSequence and is RECORDED as a desk payment
 *    that reserves its drops (the autopilot and the requests route see it) until
 *    the desk reports its hash and the watcher mirrors it, or the ledger passes
 *    its LastLedgerSequence, or the desk releases it before handing it off.
 */
router.post('/runs/:id/withdraw/prepare', guarded(async (req, res) => {
  if (!demoGate(res)) return;
  const { clientId, amountXrp } = req.body ?? {};
  const amt = String(amountXrp ?? '');
  if (!XRP_AMOUNT_RE.test(amt) || Number(amt) <= 0) return void bad(res, 'amountXrp must be a positive XRP amount');
  const drops = xrpToDrops(amt);
  // Read BEFORE the scan: only a ledger index the scan is known to cover can
  // close a prepared payout by its LastLedgerSequence.
  const validatedLedgerIndex = await currentValidatedLedgerIndex();
  if (!validatedLedgerIndex) {
    return void res.status(503).json({ error: 'LEDGER_UNREADABLE', detail: 'the validated XRP Ledger could not be read — the payout could not carry a LastLedgerSequence; nothing was prepared, try again' });
  }
  await withRunLock(String(req.params.id), async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    const client = run.clients.find((c) => c.id === clientId);
    if (!client) return void res.status(404).json({ error: 'CLIENT_NOT_FOUND', detail: 'no client with this id on this exchange — the row may have been removed, or the link is stale; reload and try again' });
    if (!client.xrplAddress) return void res.status(409).json({ error: 'CLIENT_HAS_NO_XRPL_WALLET', detail: 'Register the client own XRPL wallet first (their r-address).' });
    try {
      await syncOmnibus(run, { maxPages: 2 });
    } catch (e) {
      return void res.status(502).json({ error: 'OMNIBUS_READ_FAILED', detail: `the omnibus could not be scanned (${safeErrorDetail(e).slice(0, 200)}) — without a fresh ledger mirror a payment in flight could be paid twice; nothing was prepared` });
    }
    // A prepared payout past its LLS closes only when an exhaustive read of its
    // window proves it absent (or finds and debits it).
    const proofs = await proveDeskPayouts(run, validatedLedgerIndex);
    const view = { validatedLedgerIndex, payoutsProvenAbsent: proofs.provenAbsent };
    sweepDeskPayments(run, view);
    // `'withdraw'`: esta puerta compone la SALIDA de un cliente, y una
    // entrada que nadie ha firmado no puede ser el motivo de su PAYMENT_IN_FLIGHT.
    // Lo que sí sigue estorbando -y debe- es todo lo que tiene bytes firmados o
    // está en manos de Xaman, mas una retirada pendiente del autopiloto: ahí el
    // 409 es lo único que separa a este cliente de cobrar dos veces.
    const { against, journalUnreadable } = await journalBackedAgainst(run, client.id, 'withdraw');
    const inFlight = paymentsInFlight(run, client.id, view, undefined, against);
    if (inFlight.length) {
      await saveRun(run);
      return void refuseInFlight(res, inFlight, journalUnreadable);
    }
    if (BigInt(drops) > BigInt(client.xrpOnExchangeDrops || '0')) {
      await saveRun(run);
      return void res.status(409).json({
        error: 'INSUFFICIENT_LEDGER_BALANCE',
        detail: `The demo ledger holds ${dropsToXrpText(client.xrpOnExchangeDrops || '0')} XRP for this client.`,
      });
    }
    const lastLedgerSequence = validatedLedgerIndex + DESK_PAYOUT_LEDGER_WINDOW;
    const xrplTx = withSourceTag({
      TransactionType: 'Payment',
      Account: run.omnibusAddress,
      Destination: client.xrplAddress,
      Amount: drops,
      LastLedgerSequence: lastLedgerSequence,
      // The OMNIBUS signs this payout: the simulated exchange's account, operated
      // by us — never the Make Waves project tag (T&C §7).
    }, 'operational');
    const now = new Date().toISOString();
    const deskPayment: DeskPayment = {
      id: newId('dp'),
      kind: 'withdraw',
      clientId: client.id,
      drops,
      status: 'prepared',
      lastLedgerSequence,
      createdAtLedger: validatedLedgerIndex,
      destination: client.xrplAddress,
      createdAt: now,
      updatedAt: now,
    };
    deskPaymentsOf(run).push(deskPayment);
    await saveRun(run);
    res.json({
      xrplTx,
      // The payload's `expire` is the SERVER's number here too, so
      // the desk never mints a window this deployment did not choose. This payment
      // holds no 0xFE seat, but one number for every payload is the whole point.
      payloadExpiryMin: handoffPayloadExpiryMin(),
      client: { id: client.id, label: client.label, tag: client.tag },
      deskPayment,
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        title: 'Pay the client out to their own wallet',
        lines: [
          `The exchange omnibus pays ${amt} XRP to ${client.xrplAddress} — the client's own XRPL wallet.`,
          'This is the exchange\'s normal withdrawal rail (simulated ledger, real payment). The omnibus signs in Xaman; Astryum signs nothing.',
          `Signable until XRPL ledger ${lastLedgerSequence} (a few minutes); after that it can never be applied and must be composed again.`,
        ],
      },
    });
  });
}));

/**
 * E5 by hand, step 1: RESERVE the client's drops. Same PAYMENT_IN_FLIGHT rule as
 * the payout. Step 2 is desk-payments/:pid/prepare-put-to-work: the SERVER
 * composes the 0xFE for this reservation and stores its memo (the desk
 * no longer composes it through the generic institutional prepare, and the memo
 * is never taken from the desk). The reservation closes only when the mint is
 * recorded (put-to-work/record, verified against the ledger) or a release PROVES
 * on the chain that no 0xFE of it left the omnibus (deskPaymentProof). It stamps
 * the validated ledger (lower bound of that proof) — an unreadable ledger
 * reserves nothing (503).
 */
router.post('/runs/:id/desk-payments', guarded(async (req, res) => {
  if (!demoGate(res)) return;
  const { clientId, kind, amountXrp, memoHex, userOpHash } = req.body ?? {};
  if (kind !== 'put-to-work') return void bad(res, "kind must be 'put-to-work' (a desk payout is reserved by /withdraw/prepare, which stamps its LastLedgerSequence)");
  const amt = String(amountXrp ?? '');
  if (!XRP_AMOUNT_RE.test(amt) || Number(amt) <= 0) return void bad(res, 'amountXrp must be a positive XRP amount');
  if ((memoHex !== undefined && memoHex !== '') || (userOpHash !== undefined && userOpHash !== '')) {
    return void bad(res, 'the 0xFE memo is never supplied by the desk: reserve, then POST desk-payments/:pid/prepare-put-to-work composes it server-side and stores it');
  }
  const drops = xrpToDrops(amt);
  const createdAtLedger = await currentValidatedLedgerIndex();
  if (!createdAtLedger) {
    return void res.status(503).json({ error: 'LEDGER_UNREADABLE', detail: 'the validated XRP Ledger could not be read — without its index the reservation could never be proven released; nothing was reserved, try again' });
  }
  await withRunLock(String(req.params.id), async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    const client = run.clients.find((c) => c.id === clientId);
    if (!client) return void res.status(404).json({ error: 'CLIENT_NOT_FOUND', detail: 'no client with this id on this exchange — the row may have been removed, or the link is stale; reload and try again' });
    sweepDeskPayments(run);
    // La mesa tampoco puede meter a trabajar el dinero de un cliente sin KYC.
    if (await refuseWithoutCredential(res, run, client)) return;
    // `'put-to-work'`: esto reserva una ENTRADA, y frente a otra entrada se
    // retiene todo lo de siempre — dos entradas sí se pisarían el saldo.
    // Por eso aquí no hay exención posible y `againstFor` no lee nada.
    const inFlight = paymentsInFlight(run, client.id, {}, undefined, { kind: 'put-to-work' });
    if (inFlight.length) return void refuseInFlight(res, inFlight);
    if (BigInt(drops) > BigInt(client.xrpOnExchangeDrops || '0')) {
      return void res.status(409).json({ error: 'INSUFFICIENT_LEDGER_BALANCE', detail: `The demo ledger holds ${dropsToXrpText(client.xrpOnExchangeDrops || '0')} XRP for this client.` });
    }
    const now = new Date().toISOString();
    const deskPayment: DeskPayment = {
      id: newId('dp'),
      kind: 'put-to-work',
      clientId: client.id,
      drops,
      status: 'prepared',
      createdAtLedger,
      createdAt: now,
      updatedAt: now,
    };
    deskPaymentsOf(run).push(deskPayment);
    await saveRun(run);
    res.status(201).json({ deskPayment, run: publicRun(run, undefined, undefined, OPERATOR_VIEW) });
  });
}));

/**
 * LEGACY: attach the memo of a 0xFE composed OUTSIDE prepare-put-to-work to a
 * put-to-work reservation. The proof matches only by memo, so a memo is accepted
 * only if the hand-off store proves it is this reservation's: built for the
 * omnibus, for exactly these drops, naming this client's Flare account, and no
 * other record of the run claims it. Set once: a different value is a 409.
 */
router.patch('/runs/:id/desk-payments/:pid', guarded(async (req, res) => {
  const { memoHex, userOpHash } = req.body ?? {};
  const memo = memoHex === undefined || memoHex === '' ? undefined : String(memoHex);
  const uoh = userOpHash === undefined || userOpHash === '' ? undefined : String(userOpHash);
  if (!memo) return void bad(res, 'memoHex is required (the proof matches a reservation by its memo)');
  if (!MEMO_HEX_RE.test(memo)) return void bad(res, 'memoHex must be the hex memo of the 0xFE');
  if (uoh && !HEX64.test(uoh)) return void bad(res, 'userOpHash must be a 32-byte hex hash');
  const memoN = memo.replace(/^0x/i, '').toUpperCase();
  const uohN = uoh ? '0x' + uoh.replace(/^0x/i, '').toLowerCase() : undefined;
  let handoff: OmnibusHandoff | null;
  try {
    handoff = await findHandoffByMemo(memoN);
  } catch (e) {
    return void res.status(503).json({ error: 'HANDOFF_STORE_UNREADABLE', detail: `the 0xFE hand-off store could not be read (${safeErrorDetail(e).slice(0, 200)}) — nothing was attached; try again` });
  }
  await withRunLock(String(req.params.id), async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    const p = deskPaymentsOf(run).find((d) => d.id === req.params.pid);
    if (!p) return void res.status(404).json({ error: 'DESK_PAYMENT_NOT_FOUND', detail: 'no such desk reservation for this client — it may already have been settled or released; reload to see its current state' });
    if (p.kind !== 'put-to-work') return void res.status(409).json({ error: 'DESK_PAYMENT_NOT_A_MINT', detail: 'only a put-to-work reservation carries a 0xFE hand-off' });
    if ((p.memoHex && p.memoHex !== memoN) || (uohN && p.userOpHash && p.userOpHash !== uohN)) {
      return void res.status(409).json({ error: 'DESK_PAYMENT_HANDOFF_MISMATCH', detail: `this reservation already carries another hand-off (${p.memoHex ?? p.userOpHash})` });
    }
    const client = run.clients.find((c) => c.id === p.clientId);
    const receiverHex = client?.passkeyAccount ? client.passkeyAccount.replace(/^0x/i, '').toLowerCase() : '';
    const committedUoh = handoff ? handoff.userOpHash.replace(/^0x/i, '').toLowerCase() : '';
    const why = !handoff
      ? 'no 0xFE hand-off on file carries this memo'
      : handoff.xrplAddress !== run.omnibusAddress
        ? 'its hand-off was built for another XRPL account'
        : handoff.grossXrpDrops !== p.drops
          ? `its hand-off moves ${handoff.grossXrpDrops} drops, not ${p.drops}`
          : !receiverHex || !handoff.userOpData.toLowerCase().includes(receiverHex)
            ? "its hand-off does not name this client's Flare account as receiver"
            : uohN && committedUoh !== uohN.slice(2)
              ? 'the userOpHash is not the one its hand-off committed'
              : knownOmnibusFe(run, p.id).memos.has(memoN)
                ? 'this memo already belongs to another record of this run'
                : '';
    if (why) return void res.status(409).json({ error: 'DESK_PAYMENT_HANDOFF_UNVERIFIED', detail: `${why} — nothing was attached` });
    p.memoHex = memoN;
    p.userOpHash = uohN ?? (committedUoh ? '0x' + committedUoh : undefined);
    // THE WINDOW COMES WITH THE MEMO. Attaching a hand-off
    // composed elsewhere stored the memo but not its LastLedgerSequence, and
    // `putToWorkWindow` needs BOTH to answer `wait`: without it the release path
    // read the reservation as «can never land» and freed a 0xFE the row itself
    // declares signable — the twin of the omnibus. The window is the builder's,
    // read off the hand-off row, never re-stamped here; a row composed without
    // one (unreadable ledger, pre) keeps the old TTL rule.
    const handoffLls = handoff?.lastLedgerSequence;
    if (typeof handoffLls === 'number' && Number.isInteger(handoffLls) && handoffLls > 0) p.lastLedgerSequence = handoffLls;
    p.updatedAt = new Date().toISOString();
    await saveRun(run);
    res.json({ deskPayment: p, run: publicRun(run, undefined, undefined, OPERATOR_VIEW) });
  });
}));

/** The put-to-work reservation a server-side 0xFE may be composed for, or the refusal. */
function preparableReservation(run: DemoRun, pid: string): { p: DeskPayment; client: DemoClient } | { status: number; body: Record<string, unknown> } {
  const p = deskPaymentsOf(run).find((d) => d.id === pid);
  if (!p) return { status: 404, body: { error: 'DESK_PAYMENT_NOT_FOUND' } };
  if (p.kind !== 'put-to-work') return { status: 409, body: { error: 'DESK_PAYMENT_NOT_A_MINT', detail: 'only a put-to-work reservation is composed as a 0xFE' } };
  if (p.status !== 'prepared') return { status: 409, body: { error: 'DESK_PAYMENT_NOT_OPEN', detail: `this reservation is ${p.status} — reserve again` } };
  if (p.memoHex || p.txHash) {
    return {
      status: 409,
      body: { error: 'DESK_PAYMENT_ALREADY_PREPARED', detail: `the 0xFE of this reservation was already composed (memo ${String(p.memoHex ?? '').slice(0, 12)}…) — sign that one, or release the reservation and reserve again; a second 0xFE of the same drops is never composed` },
    };
  }
  const client = run.clients.find((c) => c.id === p.clientId);
  if (!client) return { status: 404, body: { error: 'CLIENT_NOT_FOUND' } };
  if (!client.passkeyAccount) return { status: 409, body: { error: 'CLIENT_HAS_NO_FLARE_ACCOUNT', detail: 'the client has no Flare account yet (Face ID) — the shares would have no receiver' } };
  if (!run.poteAddress) return { status: 409, body: { error: 'NO_POTE', detail: 'the pote is not born yet (E2)' } };
  return { p, client };
}

/**
 * Frees the omnibus nonce seat of an UNSIGNED 0xFE hand-off (a signed one is
 * never touched). Best-effort.
 */
async function releaseHandoffSeatQuietly(
  memoHex: string,
  opts?: { neverHandedOut?: boolean },
): Promise<void> {
  try {
    const { releaseQueuedHandoffByMemo } = await import('../services/flare/DirectMintHandoffStore');
    await releaseQueuedHandoffByMemo(memoHex, opts?.neverHandedOut === true ? { neverHandedOut: true } : undefined);
  } catch {
    /* the seat TTL stays the safety net */
  }
}

const FLARE_RPC_DEFAULT = 'https://flare-api.flare.network/ext/C/rpc';

/**
 * E5 by hand, step 2: compose the 0xFE of a put-to-work reservation
 * SERVER-SIDE — the same composer and the same inputs the desk used to send to
 * the institutional /pote-fund-xrp/prepare (buildDirectMintHandoff from the
 * omnibus, [approve(asset → pote), pote.deposit(supplyUBA, receiver = the
 * client's passkey account)], the geofence, the demo cap, the pote's KYC gate and
 * per-account cap) — and store its memo, userOpHash and the LastLedgerSequence it
 * stamps on the Payment ON THE RESERVATION, atomically inside the run lock. The
 * proof then matches only that memo, over a window bounded by that LLS. Unsigned:
 * the omnibus signs in Xaman; Astryum signs nothing. Founder-only.
 */
router.post('/runs/:id/desk-payments/:pid/prepare-put-to-work', guarded(async (req, res) => {
  if (!demoGate(res)) return;
  const geo = jurisdictionService.isDefiExecutionAllowed(typeof req.body?.region === 'string' ? req.body.region : null);
  if (!geo.allowed) return void res.status(451).json({ error: 'GEOFENCE_BLOCKED', detail: geo.reason ?? 'DeFi execution is not available in this jurisdiction.' });
  const pid = String(req.params.pid);
  const snapshot = await requireRun(req, res);
  if (!snapshot) return;
  const pre = preparableReservation(snapshot, pid);
  if ('body' in pre) return void res.status(pre.status).json(pre.body);
  // Antes de componer el 0xFE: la credencial del cliente cuyo capital entra.
  if (await refuseWithoutCredential(res, snapshot, pre.client)) return;
  const drops = pre.p.drops;
  const poteAddress = ethers.getAddress(String(snapshot.poteAddress));
  const receiver = ethers.getAddress(String(pre.client.passkeyAccount));
  const validatedLedgerIndex = await currentValidatedLedgerIndex();
  if (!validatedLedgerIndex) {
    return void res.status(503).json({ error: 'LEDGER_UNREADABLE', detail: 'the validated XRP Ledger could not be read — the 0xFE could not carry a LastLedgerSequence; nothing was composed, try again' });
  }
  // The demo cap on new capital, as the institutional prepare applied it to the omnibus.
  {
    const { dryRunRigActive } = await import('../services/dryRun/DryRunExecutor');
    if (!(await dryRunRigActive())) {
      const { checkDemoCap } = await import('../config/demoCap');
      const capped = await checkDemoCap(Number(drops) / 1e6, snapshot.omnibusAddress);
      if (capped) return void res.status(capped.status).json(capped.body);
    }
  }
  const [{ readDirectMintParams, computeNetMint, buildDirectMintHandoff, mintFeeDisclosure, NonceSeatTakenError }, { readPoteState }, { readDepositHeadroom, checkDepositCap, depositCapRefusal }] = await Promise.all([
    import('../connectors/protocols/flare/FlareDirectMintService'),
    import('../services/flare/AstryumPoteStateService'),
    import('../services/flare/AstryumDepositCapService'),
  ]);
  const provider = flareProvider();
  let state: Awaited<ReturnType<typeof readPoteState>>;
  let params: Awaited<ReturnType<typeof readDirectMintParams>>;
  try {
    [state, params] = await Promise.all([readPoteState({ rpcUrl: process.env.FLARE_RPC_URL || FLARE_RPC_DEFAULT, pote: poteAddress, provider }), readDirectMintParams(provider)]);
  } catch (e) {
    return void res.status(502).json({ error: 'CHAIN_READ_FAILED', detail: `the pote or the direct-minting parameters could not be read (${safeErrorDetail(e).slice(0, 200)}) — nothing was composed` });
  }
  let net: ReturnType<typeof computeNetMint>;
  try {
    net = computeNetMint(BigInt(drops), params, undefined);
  } catch (e) {
    return void res.status(409).json({ error: 'AMOUNT_TOO_SMALL', detail: (e as Error).message.slice(0, 160) });
  }
  // The pote's KYC gate, said BEFORE signing (the deposit would revert after the XRP left).
  try {
    const gateAddr = (await new ethers.Contract(poteAddress, ['function userGate() view returns (address)'], provider).userGate()) as string;
    if (gateAddr && gateAddr !== ethers.ZeroAddress) {
      const approved = await new ethers.Contract(gateAddr, ['function isApproved(address) view returns (bool)'], provider).isApproved(receiver);
      if (!approved) return void res.status(409).json({ error: 'RECEIVER_NOT_APPROVED', detail: "the client's Flare account is not approved at the pote's gate — register it first" });
    }
  } catch {
    /* as in the institutional prepare: an unreadable gate does not block here — the contract decides */
  }
  const cap = checkDepositCap(await readDepositHeadroom(provider, poteAddress, receiver), net.supplyUBA);
  if (cap.ok === false) return void res.status(409).json(depositCapRefusal(cap, state.asset));

  await withRunLock(snapshot.runId, async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    const again = preparableReservation(run, pid);
    if ('body' in again) return void res.status(again.status).json(again.body);
    const { p, client } = again;
    if (ethers.getAddress(String(run.poteAddress)) !== poteAddress || ethers.getAddress(String(client.passkeyAccount)) !== receiver || p.drops !== drops) {
      return void res.status(409).json({ error: 'DESK_PAYMENT_CHANGED', detail: 'the pote, the client account or the reserved drops changed while the chain was read — compose again' });
    }
    // The only approve composed here is the asset's, to the pote itself (#18).
    const erc20 = new ethers.Interface(['function approve(address spender, uint256 amount) returns (bool)']);
    const vault = new ethers.Interface(['function deposit(uint256 assets, address receiver) returns (uint256)']);
    const innerCalls = [
      { to: ethers.getAddress(state.asset.address), calldata: erc20.encodeFunctionData('approve', [poteAddress, net.supplyUBA]), value: '0' },
      { to: poteAddress, calldata: vault.encodeFunctionData('deposit', [net.supplyUBA, receiver]), value: '0' },
    ];
    let handoff: Awaited<ReturnType<typeof buildDirectMintHandoff>>;
    try {
      handoff = await buildDirectMintHandoff(
        provider,
        {
          xrplAddress: run.omnibusAddress,
          grossXrpDrops: BigInt(drops),
          innerCalls,
          action: 'demo-exchange-desk',
          // The BUILDER stamps the LastLedgerSequence and the seat
          // record keeps it, so the seat lives exactly as long as the payment can
          // land — never a seat TTL shorter than the window the desk hands to Xaman
          // (that gap let a twin be composed while the original was still signable).
          lastLedgerWindow: putToWorkLedgerWindow(),
          // The OMNIBUS signs this 0xFE, exactly like its payout (/withdraw/prepare):
          // never the Make Waves project tag, whatever the operational list says (1.5).
          attribution: 'operational',
          // Who prepared it (the seat/supersede rules of the hand-off store); never supersedes.
          preparedByUserId: req.siwe?.userId ?? null,
          // ESTA FILA LA COMPUSO EL SERVIDOR.
          // La mesa compone sin `preparedByProven`, así que su fila quedaba
          // marcada «de quien no prueba» y el autopilot —que SÍ es flujo servidor
          // de una cuenta operativa— la apartaba en silencio, sin 409 y sin
          // aviso. Resultado: dos Payments firmables en el MISMO nonce con el XRP
          // del cliente ya en el Core Vault. `serverComposed` dice lo que esa fila
          // es de verdad —una composición del propio servidor para una cuenta
          // operativa— y esas filas no las desplaza nadie automáticamente: el
          // autopilot espera, como esperaba antes de la.
          serverComposed: true,
        },
        { params },
      );
    } catch (e) {
      if (e instanceof NonceSeatTakenError) {
        // 503 when the seat STATE could not be read (retryable), 409 only for a
        // seat that is genuinely taken — the same split as the other seven doors.
        return void res
          .status(seatRefusalStatus(e))
          .json(nonceSeatBody(e, 'nothing was composed; the reservation stays until you retry or release it'));
      }
      return void res.status(502).json({ error: 'HANDOFF_FAILED', detail: `${(e as Error).message.slice(0, 160)} — nothing was composed` });
    }
    // The LastLedgerSequence is the BUILDER's (it recorded it on the seat): the desk
    // never re-stamps one, or the seat would bound a different payment than Xaman
    // shows. Without it the reservation could never be proven released → 503.
    const lastLedgerSequence = handoff.lastLedgerSequence;
    const xrplPayment = handoff.xrplPayment as Record<string, unknown>;
    if (typeof lastLedgerSequence !== 'number' || xrplPayment.LastLedgerSequence !== lastLedgerSequence) {
      // Rollback BEFORE the payment is put in the response: nobody ever saw it.
      await releaseHandoffSeatQuietly(handoff.memoHex, { neverHandedOut: true });
      return void res.status(503).json({
        error: 'LEDGER_UNREADABLE',
        detail:
          'the validated XRP Ledger could not be read when the 0xFE was composed — it carries no LastLedgerSequence, and without it the reservation could never be proven released; nothing was composed, try again',
      });
    }
    const memoHex = handoff.memoHex.replace(/^0x/i, '').toUpperCase();
    const userOpHash = '0x' + handoff.userOpHash.replace(/^0x/i, '').toLowerCase();
    p.memoHex = memoHex;
    p.userOpHash = userOpHash;
    p.lastLedgerSequence = lastLedgerSequence;
    p.updatedAt = new Date().toISOString();
    try {
      await saveRun(run);
    } catch (e) {
      // Not recorded → never handed out: free the seat the builder took.
      // Rollback BEFORE the payment is put in the response: nobody ever saw it.
      await releaseHandoffSeatQuietly(handoff.memoHex, { neverHandedOut: true });
      throw e;
    }
    const fees = mintFeeDisclosure(net);
    const fxrp = ethers.formatUnits(net.supplyUBA, state.asset.decimals);
    const xrp = dropsToXrpText(drops);
    res.json({
      deskPayment: p,
      run: publicRun(run, undefined, undefined, OPERATOR_VIEW),
      handoff: {
        account: run.omnibusAddress,
        pote: poteAddress,
        receiver,
        // ¿ENTREGA ESTE SERVIDOR la instrucción de
        // este 0xFE? La pantalla de firmas en curso solo puede acusar «entrega
        // parada» cuando el servidor lo dice; sin este campo tenía que adivinar,
        // y un aviso permanente que nadie puede desmentir es ruido. Misma forma
        // y mismo nombre que en `flareDemo` y en las órdenes de consejo.
        // (El payout de la mesa NO lo lleva: es un Payment XRP nativo, que no
        // entrega ningún executor — decirlo allí sería un aviso falso nuevo.)
        serverDelivery: { executorEnabled: process.env.FLARE_EXECUTOR_ENABLED === 'true' },
        // THE PAYLOAD'S WINDOW IS THE SERVER'S NUMBER, ALSO AT THE
        // DESK. The seat's life is measured from `HANDOFF_PAYLOAD_EXPIRY_MIN`
        // (`handoffPayloadExpiryMin()`, which the builder returns here), while the
        // desk minted its Xaman payload with a hand-written `expire: 5`. Lower the
        // server's number and the seat is freed while the payload is STILL
        // signable — the twin this rail exists to prevent. Same field and same
        // name as `flareDemo`'s prepares, so the frontend learns it in one place.
        payloadExpiryMin: handoff.payloadExpiryMin,
        xrplPayment,
        memoHex,
        userOpHash,
        personalAccount: handoff.personalAccount,
        lastLedgerSequence,
        net: { grossXrp: xrp, supplyUBA: net.supplyUBA.toString(), fxrp },
        disclosure: {
          disclosedToUser: true,
          astryumSigns: false,
          title: `Put ${xrp} XRP of ${client.label} to work in ${state.name}`,
          lines: [
            `minting fee ${fees.mintingFeeXrp} XRP + executor fee ${fees.executorFeeXrp} XRP — ≈ ${fxrp} ${state.asset.symbol} enter the pote`,
            `The shares are minted to the client's own Flare account ${receiver}; only its passkey moves them.`,
            'The omnibus signs one XRPL payment to the FAssets Core Vault in Xaman; Astryum signs nothing.',
            `Signable until XRPL ledger ${lastLedgerSequence}; after that it can never be applied and must be composed again.`,
          ],
          facts: { ...fees, poteAt: poteAddress, sharesTo: receiver },
        },
      },
    });
  });
}));

/**
 * Mark an omnibus 0xFE as EXTERNAL: signed outside Astryum, not a client
 * movement. Nothing is debited; it only stops blocking the release of memo-less
 * reservations. Verified on the ledger (a validated tesSUCCESS Payment of the
 * omnibus with an 0xFE memo) and refused when a record of the run already
 * explains it. A reason is required and stays on the receipt book (NOTE).
 */
router.post('/runs/:id/desk-payments/external-0xfe', guarded(async (req, res) => {
  const raw = String(req.body?.txHash ?? '');
  if (!HEX64.test(raw)) return void bad(res, 'txHash must be the 64-hex XRPL hash of the omnibus 0xFE');
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  if (!note) return void bad(res, 'note is required: why this 0xFE is not a client movement (it stays on the receipt book)');
  const hash = raw.replace(/^0x/i, '').toUpperCase();
  const snapshot = await requireRun(req, res);
  if (!snapshot) return;
  let tx: ReportedTx;
  try {
    tx = await readXrplTx(hash);
  } catch (e) {
    return void res.status(503).json({ error: 'EXTERNAL_0XFE_UNVERIFIABLE', detail: `the transaction could not be read (${safeErrorDetail(e).slice(0, 200)}) — nothing was marked; try again` });
  }
  // Who the 0xFE was built FOR — the hand-off store knows a client
  // mint the run's records do not (a legacy 0xFE, another run on this omnibus).
  const feMemo = tx.found ? String(tx.memoHex ?? '').toUpperCase() : '';
  let feHandoff: OmnibusHandoff | null = null;
  if (feMemo.startsWith('FE')) {
    try {
      feHandoff = await findHandoffByMemo(feMemo);
    } catch (e) {
      return void res.status(503).json({ error: 'EXTERNAL_0XFE_UNVERIFIABLE', detail: `the 0xFE hand-off store could not be read (${safeErrorDetail(e).slice(0, 200)}) — nothing was marked; try again` });
    }
  }
  const allRuns = await listRuns();
  await withRunLock(snapshot.runId, async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    const memo = tx.found ? String(tx.memoHex ?? '').toUpperCase() : '';
    const why = !tx.found
      ? 'the ledger does not know this hash'
      : !tx.validated || tx.result !== 'tesSUCCESS'
        ? `it is not a validated tesSUCCESS transaction (${tx.result})`
        : tx.type !== 'Payment' || tx.account !== run.omnibusAddress
          ? 'it is not a Payment sent by the omnibus'
          : !memo.startsWith('FE')
            ? 'it carries no 0xFE memo'
            : '';
    if (why) return void res.status(409).json({ error: 'NOT_AN_OMNIBUS_0XFE', detail: `${why} — nothing was marked` });
    const already = (run.externalFe ?? []).find((x) => x.txHash === hash);
    if (already) return void res.json({ externalFe: already, duplicate: true, run: publicRun(run, undefined, undefined, OPERATOR_VIEW) });
    const known = knownOmnibusFe(run);
    if (known.hashes.has(hash) || known.memos.has(memo)) {
      return void res.status(409).json({ error: 'EXTERNAL_0XFE_IS_ACCOUNTED', detail: 'this 0xFE is already a record of this run (a client movement, a request or a reservation) — it cannot be declared external' });
    }
    const others = allRuns.filter((r) => r.runId !== run.runId);
    const otherRecord = others.find((r) => {
      if (r.omnibusAddress !== run.omnibusAddress) return false;
      const k = knownOmnibusFe(r);
      return k.hashes.has(hash) || (Boolean(memo) && k.memos.has(memo));
    });
    if (otherRecord) {
      return void res.status(409).json({ error: 'EXTERNAL_0XFE_IS_ACCOUNTED', detail: `this 0xFE is a record of run "${otherRecord.label}" on the same omnibus — it cannot be declared external` });
    }
    if (feHandoff && feHandoff.xrplAddress === run.omnibusAddress) {
      const data = feHandoff.userOpData.toLowerCase();
      const named = [run, ...others]
        .flatMap((r) => r.clients.map((c) => ({ r, c })))
        .find(({ c }) => Boolean(c.passkeyAccount) && data.includes(String(c.passkeyAccount).replace(/^0x/i, '').toLowerCase()));
      const exchangeMint = typeof feHandoff.action === 'string' && feHandoff.action.startsWith('demo-exchange');
      if (named || exchangeMint) {
        return void res.status(409).json({
          error: 'EXTERNAL_0XFE_IS_A_CLIENT_MINT',
          detail: named
            ? `its 0xFE hand-off names the Flare account of client "${named.c.label}" (tag ${named.c.tag}) of ${named.r.label} — it is a client movement: record it (put-to-work/record), never mark it external`
            : `its 0xFE hand-off was composed by the exchange (${feHandoff.action}) — it is a client movement: record it (put-to-work/record), never mark it external`,
        });
      }
    }
    const entry: ExternalFe = { txHash: hash, memoHex: memo, ledgerIndex: tx.found ? tx.ledgerIndex : undefined, note: note.slice(0, 500), markedAt: new Date().toISOString() };
    run.externalFe = [...(run.externalFe ?? []), entry];
    run.receipts.push(makeReceipt(run, {
      step: 'NOTE',
      chain: 'none',
      note: `Omnibus 0xFE ${hash} marked EXTERNAL by the exchange — not a client movement, nothing debited: ${entry.note}`,
      expect: { external0xfe: hash, ledgerIndex: entry.ledgerIndex ?? '' },
    }));
    await saveRun(run);
    res.status(201).json({ externalFe: entry, run: publicRun(run, undefined, undefined, OPERATOR_VIEW) });
  });
}));

/** The desk's door validated the payment on the ledger: keep its hash; it settles when the mirror applies it. */
router.post('/runs/:id/desk-payments/:pid/signed', guarded(async (req, res) => {
  const raw = String(req.body?.txHash ?? '');
  if (!HEX64.test(raw)) return void bad(res, 'txHash must be the 64-hex XRPL hash');
  const txHash = raw.replace(/^0x/i, '').toUpperCase();
  await withRunLock(String(req.params.id), async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    const p = deskPaymentsOf(run).find((d) => d.id === req.params.pid);
    if (!p) return void res.status(404).json({ error: 'DESK_PAYMENT_NOT_FOUND', detail: 'no such desk reservation for this client — it may already have been settled or released; reload to see its current state' });
    if (p.txHash && p.txHash !== txHash) {
      return void res.status(409).json({ error: 'DESK_PAYMENT_HASH_MISMATCH', detail: `this desk payment already carries ${p.txHash}` });
    }
    if (p.status !== 'settled') {
      // Even a 'released' entry reserves again: a hash is proof it moved.
      p.txHash = txHash;
      p.status = 'signed';
      p.updatedAt = new Date().toISOString();
      sweepDeskPayments(run);
    }
    await saveRun(run);
    res.json({ deskPayment: p, run: publicRun(run, undefined, undefined, OPERATOR_VIEW) });
  });
}));

/**
 * Release a desk payment that never reached the ledger. A 'signed' one only with
 * ?force=1. And never on the operator's word alone:
 *  · put-to-work (0xFE): released only with the chain proof of
 *    deskPaymentProof.provePutToWorkRelease — found on the ledger → settled +
 *    debited, 409 DESK_PAYMENT_EXECUTED; an unaccounted 0xFE or a signed hand-off
 *    not on the ledger → 409; a server-composed 0xFE whose LastLedgerSequence is
 *    still ahead → 409 WAIT_FOR_LAST_LEDGER; any read failure → 503.
 *  · withdraw: its window [creation ledger, min(validated, LLS)] is read in full;
 *    found → settled + debited, 409 DESK_PAYMENT_EXECUTED; unreadable → 503.
 */
router.delete('/runs/:id/desk-payments/:pid', guarded(async (req, res) => {
  const force = req.query.force === '1' || req.query.force === 'true';
  await withRunLock(String(req.params.id), async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    const p = deskPaymentsOf(run).find((d) => d.id === req.params.pid);
    if (!p) return void res.status(404).json({ error: 'DESK_PAYMENT_NOT_FOUND', detail: 'no such desk reservation for this client — it may already have been settled or released; reload to see its current state' });
    if (p.status !== 'prepared' && p.status !== 'signed') return void res.json({ deskPayment: p, run: publicRun(run, undefined, undefined, OPERATOR_VIEW) });
    if (p.status === 'signed' && !force) {
      return void res.status(409).json({
        error: 'DESK_PAYMENT_SIGNED',
        detail: `this payment was validated on the ledger (${p.txHash}); it settles when the watcher mirrors it — scan the omnibus. Releasing it by force frees drops the ledger mirror has not debited yet.`,
      });
    }
    const nowIso = new Date().toISOString();
    const executed = async (txHash: string, extra: Record<string, unknown>) => {
      await saveRun(run);
      res.status(409).json({
        error: 'DESK_PAYMENT_EXECUTED',
        detail: `this payment is on the ledger (${txHash}): the XRP left the omnibus, so it was settled and the client debited once — it can never be released`,
        txHash,
        ...extra,
        deskPayment: p,
        run: publicRun(run, undefined, undefined, OPERATOR_VIEW),
      });
    };
    if (p.kind === 'put-to-work') {
      const verdict = await provePutToWorkRelease(run, p);
      if (verdict.kind === 'unreadable') {
        return void res.status(503).json({ error: 'DESK_PAYMENT_UNPROVABLE', detail: `${verdict.detail} — without proof that its 0xFE did not and cannot execute, the reservation stays; try again` });
      }
      if (verdict.kind === 'executed') {
        settlePutToWorkByProof(run, p, verdict, nowIso);
        return void (await executed(p.txHash!, { mintExecuted: verdict.mintExecuted }));
      }
      if (verdict.kind === 'unaccounted') {
        return void res.status(409).json({
          error: 'DESK_PAYMENT_UNACCOUNTED_ON_LEDGER',
          detail: `this reservation carries no 0xFE memo, and the omnibus sent 0xFE payment(s) since it that no record accounts for (${verdict.hashes.map((h) => h.slice(0, 12) + '…').join(', ')}) — if one is this client's, record it (put-to-work/record verifies it against the ledger); if it is not a client movement, mark it external (desk-payments/external-0xfe with a reason)`,
          hashes: verdict.hashes,
        });
      }
      if (verdict.kind === 'signed-off-ledger') {
        return void res.status(409).json({ error: 'DESK_PAYMENT_SIGNED_NOT_ON_LEDGER', detail: `${verdict.detail} — the reservation stays until it lands or its hand-off is parked` });
      }
      if (verdict.kind === 'wait') {
        // «it never reached Xaman» is the operator's word; the LLS is the ledger's.
        return void res.status(409).json({
          error: 'WAIT_FOR_LAST_LEDGER',
          detail: `${verdict.detail} — the reservation stays in flight`,
          lastLedgerSequence: verdict.lastLedgerSequence,
          ledgersLeft: verdict.ledgersLeft,
          secondsLeft: verdict.secondsLeft,
        });
      }
      p.closedBy = verdict.proof;
    } else {
      const probe = await probePreparedPayout(run, p);
      if (probe.kind === 'unreadable') {
        return void res.status(503).json({ error: 'DESK_PAYMENT_UNPROVABLE', detail: `${probe.detail} — the reservation stays; try again` });
      }
      if (probe.kind === 'landed') {
        settlePayoutByProof(run, p, probe.tx, nowIso);
        return void (await executed(p.txHash!, {}));
      }
      p.closedBy = `released by the desk; ${probe.rowsRead} omnibus txs of ledgers [${probe.window[0]}, ${probe.window[1]}] read in full, payout absent`;
    }
    p.status = 'released';
    p.updatedAt = nowIso;
    await saveRun(run);
    // A released server-composed 0xFE must not keep the omnibus nonce seat (unsigned
    // only). This dispatch WAS handed to Xaman, so no shortcut here: the store frees
    // the seat only on its own reading of the memo's window (R1 B1).
    if (p.kind === 'put-to-work' && p.memoHex) await releaseHandoffSeatQuietly(p.memoHex);
    res.json({ deskPayment: p, run: publicRun(run, undefined, undefined, OPERATOR_VIEW) });
  });
}));

/* ── receipts ────────────────────────────────────────────────────────────── */

/** `expect` of a posted receipt: a small flat record, or a 400 detail. */
function validateExpect(expect: unknown): { value?: Record<string, string | number | boolean>; error?: string } {
  if (expect === undefined || expect === null) return {};
  if (typeof expect !== 'object' || Array.isArray(expect)) return { error: 'expect must be a flat object' };
  const entries = Object.entries(expect as Record<string, unknown>);
  if (entries.length > MAX_EXPECT_KEYS) return { error: `expect holds at most ${MAX_EXPECT_KEYS} keys` };
  for (const [k, v] of entries) {
    if (k.length > MAX_EXPECT_KEY_CHARS) return { error: `expect keys are at most ${MAX_EXPECT_KEY_CHARS} characters` };
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return { error: 'expect values must be strings, numbers or booleans' };
    if (String(v).length > MAX_EXPECT_VALUE_CHARS) return { error: `expect values are at most ${MAX_EXPECT_VALUE_CHARS} characters` };
  }
  return { value: expect as Record<string, string | number | boolean> };
}

router.post('/runs/:id/receipts', guarded(async (req, res) => {
  const admin = isAdminRequest(res);
  const userId = req.siwe?.userId;
  const { step, chain, txHash, clientId, note, expect } = req.body ?? {};
  if (!STEPS.includes(step)) return void bad(res, `step must be one of ${STEPS.join(', ')}`);
  // Receipts of MONEY MOVEMENTS the ledger mirror depends on are produced by the
  // watcher and the autopilot, never posted here: this route is open, and a
  // forged U1_DEPOSIT once passed as payout proof.
  // U4_EXIT_XRP on 'flare' is the client's OWN Face ID exit batch (ClientApp
  // posts it with the relay's hash); only its XRPL side — the tagged return
  // that credits the balance — is the watcher's.
  const watcherOnly = step === 'U4_EXIT_XRP' ? chain === 'xrpl' : LEDGER_MOVEMENT_STEPS.includes(step);
  if (watcherOnly) {
    return void bad(res, `${step} receipts on the XRPL are written by the omnibus watcher / autopilot from the ledger, not posted`);
  }
  if (chain !== 'xrpl' && chain !== 'flare' && chain !== 'none') return void bad(res, "chain must be 'xrpl' | 'flare' | 'none'");
  if (txHash !== undefined && txHash !== '' && !HEX64.test(String(txHash))) return void bad(res, 'txHash must be a 64-hex hash');
  const checkedExpect = validateExpect(expect);
  if (checkedExpect.error) return void bad(res, checkedExpect.error);
  // A receipt about no client is the exchange's own evidence. Open
  // to any session, one session filled the run's 500-receipt book for everyone.
  if (!admin && (clientId === undefined || clientId === '')) {
    return void res.status(403).json({
      error: 'RECEIPT_CLIENT_REQUIRED',
      detail: "a receipt about no client is the exchange's own evidence — only the exchange posts it; a client posts receipts about their own account (clientId)",
    });
  }
  const takeover = clientId !== undefined && clientId !== '' ? await sessionTakeoverOr503(res, userId, admin) : { at: null };
  if (!takeover) return;
  await withRunLock(String(req.params.id), async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    if (!admin && run.receipts.length >= MAX_RECEIPTS_PER_RUN) {
      return void res.status(409).json({ error: 'RUN_RECEIPTS_FULL', detail: `this run already holds ${MAX_RECEIPTS_PER_RUN} receipts` });
    }
    if (clientId !== undefined && clientId !== '') {
      const client = run.clients.find((c) => c.id === clientId);
      if (!client) return void res.status(404).json({ error: 'CLIENT_NOT_FOUND', detail: 'no client with this id on this exchange — the row may have been removed, or the link is stale; reload and try again' });
      // Evidence ABOUT a client is written by that client or by the exchange.
      if (!admin && refuseNotOwner(res, client, userId, takeover.at)) return;
    }
    const receipt = makeReceipt(run, {
      step,
      chain,
      txHash: txHash ? String(txHash) : undefined,
      clientId: clientId || undefined,
      note: typeof note === 'string' ? note.slice(0, 500) : undefined,
      expect: checkedExpect.value,
    });
    run.receipts.push(receipt);
    await saveRun(run);
    res.status(201).json({ receipt, run: publicRun(run, userId, takeover.at, admin ? OPERATOR_VIEW : undefined) });
  });
}));

/**
 * E5: the exchange put a client's XRP to work — mirror the debit and keep the
 * hash. VERIFIED: the hash must be a validated tesSUCCESS Payment from
 * the omnibus to the FAssets Core Vault for these drops whose 0xFE memo is the
 * reservation's — or, without a reservation memo, the memo of a hand-off built
 * for this omnibus, these drops and this client's Flare account. Otherwise 409
 * RECORD_HASH_MISMATCH and nothing is debited; an unreadable ledger / store → 503.
 */
router.post('/runs/:id/put-to-work/record', guarded(async (req, res) => {
  const { clientId, drops, txHash, note, deskPaymentId } = req.body ?? {};
  if (!/^\d+$/.test(String(drops ?? ''))) return void bad(res, 'drops must be an integer string');
  if (!HEX64.test(String(txHash ?? ''))) return void bad(res, 'txHash must be the XRPL hash of the 0xFE payment');
  const hash = String(txHash).replace(/^0x/i, '').toUpperCase();
  const dropsS = String(drops);
  const snapshot = await requireRun(req, res);
  if (!snapshot) return;
  // The chain and store reads (seconds) happen OUTSIDE the lock; the verdict is taken on a fresh copy inside it.
  let tx: ReportedTx;
  let coreVault: string;
  let handoff: OmnibusHandoff | null = null;
  try {
    [tx, coreVault] = await Promise.all([readXrplTx(hash), readCoreVaultAddress()]);
    if (tx.found && tx.memoHex) handoff = await findHandoffByMemo(tx.memoHex);
  } catch (e) {
    return void res.status(503).json({ error: 'RECORD_UNVERIFIABLE', detail: `the transaction, the Core Vault or the hand-off store could not be read (${safeErrorDetail(e).slice(0, 200)}) — nothing was debited; try again` });
  }
  await withRunLock(snapshot.runId, async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    const client = run.clients.find((c) => c.id === clientId);
    if (!client) return void res.status(404).json({ error: 'CLIENT_NOT_FOUND', detail: 'no client with this id on this exchange — the row may have been removed, or the link is stale; reload and try again' });
    if ((run.appliedTxHashes ?? []).includes(`out:${hash}`)) {
      return void res.status(200).json({ receipt: null, duplicate: true, run: publicRun(run, undefined, undefined, OPERATOR_VIEW) });
    }
    let p: DeskPayment | undefined;
    if (typeof deskPaymentId === 'string' && deskPaymentId) {
      p = deskPaymentsOf(run).find((d) => d.id === deskPaymentId && d.clientId === client.id && d.kind === 'put-to-work');
      if (!p) return void res.status(404).json({ error: 'DESK_PAYMENT_NOT_FOUND', detail: 'no such desk reservation for this client — it may already have been settled or released; reload to see its current state' });
    } else if (tx.found && tx.memoHex) {
      const memo = tx.memoHex;
      p = deskPaymentsOf(run).find((d) => d.clientId === client.id && d.kind === 'put-to-work' && d.status !== 'released' && String(d.memoHex ?? '').toUpperCase() === memo);
    }
    if (p?.txHash && p.txHash !== hash) {
      return void res.status(409).json({ error: 'DESK_PAYMENT_HASH_MISMATCH', detail: `this reservation already carries ${p.txHash}` });
    }
    const verdict = judgePutToWorkRecord({ run, clientId: client.id, drops: dropsS, tx, coreVault, reservation: p, handoff });
    if ('reason' in verdict) {
      if (verdict.retryable) {
        // A node behind the one Xaman used is «not yet», never «not yours».
        return void res.status(503).json({
          error: 'RECORD_NOT_YET_VISIBLE',
          detail: `${hash.slice(0, 12)}…: ${verdict.reason} — it may be a few ledgers behind. Nothing was debited and the reservation is untouched; record it again in a few seconds`,
          reason: verdict.reason,
          retryable: true,
        });
      }
      return void res.status(409).json({ error: 'RECORD_HASH_MISMATCH', detail: `${hash.slice(0, 12)}… is not this client's put-to-work: ${verdict.reason} — nothing was debited`, reason: verdict.reason });
    }
    const fresh = applyMovements(run, [{ kind: 'put-to-work', clientId: client.id, drops: dropsS, txHash: hash }]);
    // The desk's reservation ends here: the debit is applied, by chain facts.
    if (p && p.status !== 'settled') {
      p.txHash = hash;
      if (!p.memoHex) p.memoHex = verdict.memoHex;
      p.status = 'settled';
      p.closedBy = `recorded: ${hash} verified on the ledger (omnibus → Core Vault, memo ${verdict.memoHex.slice(0, 12)}…, ledger ${tx.found ? tx.ledgerIndex ?? '?' : '?'})`;
      p.updatedAt = new Date().toISOString();
    }
    const receipt = makeReceipt(run, {
      step: 'E5_PUT_TO_WORK',
      chain: 'xrpl',
      txHash: hash,
      clientId: client.id,
      note: typeof note === 'string' ? note.slice(0, 500) : undefined,
      expect: { drops: dropsS, receiver: client.passkeyAccount ?? '', pote: run.poteAddress ?? '' },
    });
    if (fresh.length) run.receipts.push(receipt);
    await saveRun(run);
    res.status(fresh.length ? 201 : 200).json({ receipt: fresh.length ? receipt : null, duplicate: fresh.length === 0, run: publicRun(run, undefined, undefined, OPERATOR_VIEW) });
  });
}));

/* ── the omnibus watcher (read-only on the chain) ────────────────────────── */

/**
 * GET /runs/:id/omnibus is PUBLIC, and it used to hold the run lock across the
 * whole chain read (2.6b): an anonymous caller looping on it stalled
 * every writer of the run — the autopilot included. Now:
 *  · the chain (validated ledger, the 2-page scan, the payout-window proofs) is
 *    read OUTSIDE the lock, on a snapshot; inside the lock only the PURE
 *    application of those rows and proofs to a fresh copy, then the save;
 *  · concurrent reads of one run share ONE chain read;
 *  · a non-founder is served the last read while it is younger than
 *    DEMO_EXCHANGE_OMNIBUS_READ_MIN_INTERVAL_MS (default 10 s). A founder always
 *    gets a fresh one.
 */
export function omnibusReadMinIntervalMs(): number {
  const n = Number(process.env.DEMO_EXCHANGE_OMNIBUS_READ_MIN_INTERVAL_MS);
  return Number.isFinite(n) && n >= 0 ? n : 10_000;
}

interface OmnibusRead {
  status: number;
  body: Record<string, unknown>;
}
const omnibusReadCache = new Map<string, { at: number; read: OmnibusRead }>();
const omnibusReadsInFlight = new Map<string, Promise<OmnibusRead | null>>();

/** Test hook — never called by production code. */
export function __resetOmnibusReadsForTests(): void {
  omnibusReadCache.clear();
  omnibusReadsInFlight.clear();
}

async function readOmnibusOnce(runId: string): Promise<OmnibusRead | null> {
  const snapshot = await loadRun(runId);
  if (!snapshot) return null;
  // A prepared desk payout closes by its LastLedgerSequence only against a
  // ledger index read BEFORE the scan (availableBalance.LedgerView).
  const needsLedger = Boolean(snapshot.deskPayments?.some((p) => p.status === 'prepared' && typeof p.lastLedgerSequence === 'number'));
  const validatedLedgerIndex = needsLedger ? (await currentValidatedLedgerIndex()) ?? undefined : undefined;
  let txs: OmnibusTx[];
  try {
    txs = await scanOmnibus(snapshot.omnibusAddress, { maxPages: 2, sinceLedgerIndex: snapshot.sinceLedgerIndex });
  } catch (e) {
    return { status: 502, body: { error: 'OMNIBUS_READ_FAILED', detail: (e as Error).message } };
  }
  // The window proofs read the chain on the snapshot (thrown away afterwards).
  applyOmnibusScan(snapshot, txs);
  const snapshotProofs = await proveDeskPayouts(snapshot, validatedLedgerIndex);
  return withRunLock(runId, async () => {
    const run = await loadRun(runId);
    if (!run) return null;
    const nowIso = new Date().toISOString();
    const sync = applyOmnibusScan(run, txs);
    const proofs = applyPayoutProofs(run, snapshotProofs, nowIso);
    const swept = sweepDeskPayments(run, { validatedLedgerIndex, payoutsProvenAbsent: proofs.provenAbsent }, nowIso);
    if (sync.credited.length || swept || proofs.settled.length) await saveRun(run);
    return {
      status: 200,
      body: {
        omnibus: run.omnibusAddress,
        scannedAt: nowIso,
        txs: sync.txs.slice(0, 100).map((t) => ({ ...t, explorerUrl: explorerUrl('xrpl', t.hash) })),
        credited: sync.credited,
        deskPaymentsSwept: swept,
        deskPaymentsUnprovable: proofs.unreadable,
        ledger: run.clients.map((c) => ({ id: c.id, label: c.label, tag: c.tag, xrpOnExchangeDrops: c.xrpOnExchangeDrops })),
        requests: requestsOf(run),
      },
    };
  });
}

/** One chain read per run at a time: every concurrent caller awaits the same one. */
function sharedOmnibusRead(runId: string): Promise<OmnibusRead | null> {
  const inFlight = omnibusReadsInFlight.get(runId);
  if (inFlight) return inFlight;
  const read = readOmnibusOnce(runId)
    .then((r) => {
      if (r) omnibusReadCache.set(runId, { at: Date.now(), read: r });
      return r;
    })
    .finally(() => {
      omnibusReadsInFlight.delete(runId);
    });
  omnibusReadsInFlight.set(runId, read);
  return read;
}

router.get('/runs/:id/omnibus', guarded(async (req, res) => {
  const runId = String(req.params.id);
  // La conciliación del omnibus es del DUEÑO del exchange (y de la mesa): lleva
  // los ingresos de todos sus clientes. Un miembro no la lee.
  const owner = await requireRunOwner(req, res);
  if (!owner) return;
  // Its `requests` never carry the 0xFE memo of what is in flight for a non-operator (R1 1.2).
  const admin = owner.viewer.admin;
  if (!admin) {
    const cached = omnibusReadCache.get(runId);
    if (cached && Date.now() - cached.at < omnibusReadMinIntervalMs()) {
      return void res.status(cached.read.status).json({ ...publicOmnibusBody(cached.read.body), cached: true, cachedAt: new Date(cached.at).toISOString() });
    }
  }
  const read = await sharedOmnibusRead(runId);
  if (!read) return void res.status(404).json({ error: 'RUN_NOT_FOUND' });
  res.status(read.status).json(admin ? read.body : publicOmnibusBody(read.body));
}));

/* ── verification + proof ────────────────────────────────────────────────── */

/**
 * Public and slow (one chain read per receipt). The verification runs on a
 * SNAPSHOT outside the lock; only its results — checks + verifiedAt, by receipt
 * id — are applied to a fresh copy inside the lock. Saving the snapshot whole
 * erased what the autopilot minted meanwhile.
 */
router.post('/runs/:id/verify', guarded(async (req, res) => {
  const got = await requireRunAccess(req, res);
  if (!got) return;
  const snapshot = got.run;
  const access = got.access;
  // The run it answers with never carries hand-off memos for a non-operator (R1 1.2).
  const view = got.viewer.admin ? OPERATOR_VIEW : undefined;
  const receiptId = typeof req.body?.receiptId === 'string' ? req.body.receiptId : undefined;
  if (access.level === 'member') {
    // Un cliente verifica SUS recibos, uno a uno o todos los suyos — nunca los de otro.
    const own = snapshot.receipts.filter((r) => r.clientId && access.clientIds.has(r.clientId));
    if (receiptId && !own.some((r) => r.id === receiptId)) return void res.status(404).json({ error: 'RECEIPT_NOT_FOUND' });
    for (const r of receiptId ? own.filter((x) => x.id === receiptId) : own) await verifyRun(snapshot, { receiptId: r.id });
  } else {
    await verifyRun(snapshot, { receiptId });
  }
  const results = new Map(
    snapshot.receipts
      .filter((r) => (!receiptId || r.id === receiptId) && r.verifiedAt)
      .filter((r) => access.level !== 'member' || Boolean(r.clientId && access.clientIds.has(r.clientId)))
      .map((r) => [r.id, { checks: r.checks, verifiedAt: r.verifiedAt }] as const),
  );
  await withRunLock(snapshot.runId, async () => {
    const run = await requireRun(req, res);
    if (!run) return;
    for (const r of run.receipts) {
      const v = results.get(r.id);
      if (!v) continue;
      r.checks = v.checks;
      r.verifiedAt = v.verifiedAt;
    }
    await saveRun(run);
    const okCount = run.receipts.filter((r) => r.checks.length && r.checks.every((k) => k.ok)).length;
    const failCount = run.receipts.filter((r) => r.checks.some((k) => k.ok === false)).length;
    if (access.level === 'member') {
      const mine = run.receipts.filter((r) => r.clientId && access.clientIds.has(r.clientId));
      const ok = mine.filter((r) => r.checks.length && r.checks.every((k) => k.ok)).length;
      const failed = mine.filter((r) => r.checks.some((k) => k.ok === false)).length;
      return void res.json({ run: memberView(publicRun(run, got.viewer.userId, undefined, view), access.clientIds), summary: { receipts: mine.length, verified: ok, failed } });
    }
    res.json({ run: publicRun(run, undefined, undefined, view), summary: { receipts: run.receipts.length, verified: okCount, failed: failCount } });
  });
}));

/**
 * PUBLIC read: el KYC de cada casilla del run, leído del ledger (UNA lectura del
 * omnibus sirve para todas, con la caché corta del gate). Cada fila dice qué
 * credencial le corresponde (emisor, sujeto, tipo `KYC-<tag>`), para que la mesa
 * sepa qué emitir. Solo viaja la atestación POSITIVA: una casilla sin credencial
 * es indistinguible de una que no la ha pedido — el ledger lleva el SÍ, nunca el NO.
 */
router.get('/runs/:id/credentials', guarded(async (req, res) => {
  const got = await requireRunAccess(req, res);
  if (!got) return;
  const { run, access } = got;
  // Un cliente ve el KYC de SUS casillas; la mesa y el dueño, el de todas.
  const visible = access.level === 'member' ? run.clients.filter((c) => access.clientIds.has(c.id)) : run.clients;
  const clients = await Promise.all(
    visible.slice(0, 100).map(async (c) => {
      const verdict = await checkClientCredential(run, c);
      const base = { clientId: c.id, tag: c.tag, issuer: verdict.spec.issuer, subject: verdict.spec.subject, credentialType: verdict.spec.credentialType };
      return isCredentialRefusal(verdict)
        ? { ...base, ok: false as const, code: verdict.code, detail: verdict.detail }
        : { ...base, ok: true as const, state: verdict.state, expiresAtISO: verdict.expiresAtISO };
    }),
  );
  res.json({ required: clientCredentialGateEnabled(), clients });
}));

router.get('/runs/:id/chain', guarded(async (req, res) => {
  const got = await requireRunAccess(req, res);
  if (!got) return;
  const { run, access } = got;
  const provider = flareProvider();
  let pote: unknown = null;
  if (run.poteAddress) {
    try {
      const { readPoteState } = await import('../services/flare/AstryumPoteStateService');
      pote = await readPoteState({ rpcUrl: process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc', pote: run.poteAddress, provider });
    } catch (e) {
      pote = { error: (e as Error).message };
    }
  }
  const allFacts = await readClientFacts(run, provider);
  // El pote y el consejo son del exchange; los hechos on-chain de cada casilla, de su cliente.
  const clients = access.level === 'member' ? allFacts.filter((f) => access.clientIds.has(f.clientId)) : allFacts;
  let council: { didAnchored: boolean; dataHex?: string } = { didAnchored: false };
  try {
    const { xrplProvider } = await import('../integrations/providers/chain/XRPLProvider');
    const did = (await xrplProvider.getDidObject(run.councilAddress)) as { dataHex?: string } | null;
    council = { didAnchored: /^[0-9a-fA-F]{64}$/.test(String(did?.dataHex ?? '')), dataHex: did?.dataHex };
  } catch {
    /* unreadable ≠ absent — the UI says "could not read" */
  }
  res.json({ readAt: new Date().toISOString(), pote, clients, council });
}));

/**
 * Which of these XRPL wallets does the SERVER consider proven to the session —
 * the very verdict the client routes apply (`proveXrplWallet`). The client site
 * marks each connected Xaman as usable or «bind it by signature first» instead
 * of letting the person discover a 403. A session is required (401).
 */
router.get('/wallet-proof', guarded(async (req, res) => {
  const viewer = await optionalSessionUserId(req);
  if (!viewer) return void res.status(401).json({ error: 'missing_bearer_token' });
  const addresses = Array.from(new Set(String(req.query.addresses ?? '').split(',').map((s) => s.trim()).filter(Boolean))).slice(0, 20);
  if (addresses.some((a) => !XRPL_RE.test(a))) return void bad(res, 'addresses must be comma-separated XRPL r-addresses');
  const loginWallet = req.siwe?.walletAddress ?? '';
  const wallets: Array<{ address: string; proof: WalletProof['proof']; unreadable: boolean }> = [];
  for (const address of addresses) {
    const p = await proveXrplWallet(req, address);
    wallets.push({ address, proof: p.proof, unreadable: p.unreadable });
  }
  res.json({ sessionWallet: XRPL_RE.test(loginWallet) ? loginWallet : null, wallets });
}));

router.get('/runs/:id/proof.md', guarded(async (req, res) => {
  // El dossier lleva una fila por cliente (etiqueta, tag, cuentas, KYC, saldo): del dueño y de la mesa.
  const owner = await requireRunOwner(req, res);
  if (!owner) return;
  const run = owner.run;
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(renderProofMarkdown(run));
}));

/* ── structures: the captive accounts a tenant gives birth to ─────────────── */

/**
 * EXCHANGE 2.0 — «todo el producto de Astryum, dentro de un exchange».
 *
 * A structure is a CAPTIVE XRPL account (a family/Legacy, a company) governed by
 * a quorum: born in its holder's own wallet, funded by the omnibus, constituted,
 * rehearsed, and closed with asfDisableMaster — after which NO key controls it.
 *
 * Every route here is prepare-only: it composes UNSIGNED txjson and stops. The
 * mutations sit behind `requireAdmin` by the router gate above; the GET asks
 * explicitly, because the router publishes reads and a seat chart with a
 * family's label is not something to publish while the section is covered.
 */

const STRUCTURE_KINDS: StructureKind[] = ['box', 'family', 'enterprise', 'agent'];
const STRUCTURE_GOVERNANCE: StructureGovernance[] = ['sole', 'shared'];
const BIRTH_STEPS: BirthStepId[] = ['fund', 'constitute', 'rehearse', 'designate', 'close-door'];
/** Short by design: a designation is a re-appointment, not a title deed. */
const DESIGNATION_DAYS = 90;
const DESIGNATION_TYPE = process.env.DEMO_EXCHANGE_DESIGNATION_CREDENTIAL_TYPE || 'OMNIBUS';
const MAX_STRUCTURES_PER_RUN = 50;

/** Las direcciones de una declaración cuya existencia en el ledger hay que mirar. */
function addressesOf(body: Record<string, unknown>): string[] {
  const seats = Array.isArray(body.seats) ? body.seats : [];
  return [
    String(body.rootAddress ?? ''),
    ...seats.map((x) => String(((x ?? {}) as Record<string, unknown>).account ?? '')),
  ].filter((a) => XRPL_RE.test(a));
}

/** Live reserve figures. Never invented: without them nothing is planned. */
async function readReserveFigures(address: string): Promise<{ baseXrp: number; incrementXrp: number }> {
  const { xrplProvider } = await import('../integrations/providers/chain/XRPLProvider');
  const snap = await xrplProvider.getSpendableBalance(address);
  const incrementXrp = Number(snap.nextObjectReserveXrp);
  const baseXrp = Number(snap.reserveXrp) - Number(snap.ownerCount) * incrementXrp;
  if (!Number.isFinite(baseXrp) || baseXrp <= 0 || !Number.isFinite(incrementXrp) || incrementXrp <= 0) {
    throw new Error(`reserve figures unusable (base=${baseXrp}, increment=${incrementXrp})`);
  }
  return { baseXrp, incrementXrp };
}

/** Parse + shape-check the declaration. Returns the birth input or a 400 reason. */
function readDeclaration(
  body: Record<string, unknown>,
  run: DemoRun,
  reserve: { baseXrp: number; incrementXrp: number },
  /** Qué direcciones existen ya como cuenta. Ausente = no se pudo leer, jamás «no existe». */
  exists: Record<string, boolean> = {},
): { input: StructureBirthInput; label: string; clientId?: string } | { error: string } {
  const kind = String(body.kind ?? '') as StructureKind;
  if (!STRUCTURE_KINDS.includes(kind)) return { error: `kind must be one of ${STRUCTURE_KINDS.join(', ')}` };
  const governance = String(body.governance ?? '') as StructureGovernance;
  if (!STRUCTURE_GOVERNANCE.includes(governance)) return { error: `governance must be one of ${STRUCTURE_GOVERNANCE.join(', ')}` };
  const rootAddress = String(body.rootAddress ?? '');
  if (!XRPL_RE.test(rootAddress)) return { error: 'rootAddress must be the XRPL r-address of the PERSONAL account that commands this one' };
  const address = String(body.address ?? '');
  if (!XRPL_RE.test(address)) return { error: 'address must be the XRPL r-address of the account being born (created in its holder own wallet)' };
  if (address === run.councilAddress || address === run.omnibusAddress) {
    return { error: 'a commanded account cannot be the tenant own root or omnibus — it is a new account' };
  }
  if (address === rootAddress) {
    return { error: 'the commanded account cannot be the personal account that commands it' };
  }
  const label = String(body.label ?? '').trim().slice(0, 80);
  if (!label) return { error: 'label is required (what the holder calls it — never personal data)' };
  const rawSeats = Array.isArray(body.seats) ? body.seats : [];
  const seats: StructureSeat[] = rawSeats.slice(0, 40).map((s) => {
    const seat = (s ?? {}) as Record<string, unknown>;
    return { account: String(seat.account ?? ''), weight: Number(seat.weight ?? 0), holder: String(seat.holder ?? '') as StructureSeat['holder'] };
  });
  const quorum = Number(body.quorum ?? 0);
  const clientIdRaw = body.clientId === undefined || body.clientId === null ? undefined : String(body.clientId);
  if (clientIdRaw && !run.clients.some((c) => c.id === clientIdRaw)) return { error: `clientId ${clientIdRaw} is not a client of this tenant` };

  return {
    label,
    clientId: clientIdRaw,
    input: {
      kind,
      governance,
      rootAddress,
      funderAddress: run.omnibusAddress,
      structureAddress: address,
      seats,
      quorum,
      reserve,
      designation: body.designation !== false,
      paysThroughCredentialGate: body.paysThroughCredentialGate === true,
      carriesOwnCredentials: body.carriesOwnCredentials === true,
      operatorMayBind: body.operatorMayBind === true,
      rootFunded: exists[rootAddress],
      seatsFunded: exists,
      armAnchorGate: body.armAnchorGate === true,
      receivesThirdPartyReturns: body.receivesThirdPartyReturns !== false,
    },
  };
}

function birthInputOf(run: DemoRun, s: DemoStructure, reserve: { baseXrp: number; incrementXrp: number }): StructureBirthInput {
  return {
    kind: s.kind,
    governance: s.governance,
    rootAddress: s.rootAddress,
    funderAddress: run.omnibusAddress,
    structureAddress: s.address,
    seats: s.seats,
    quorum: s.quorum,
    reserve,
    designation: s.designation,
    paysThroughCredentialGate: s.paysThroughCredentialGate,
    carriesOwnCredentials: s.carriesOwnCredentials,
    // Un asiento de tercero que ya está en el ledger no se vuelve a rehusar al
    // releer: la negativa vive en la DECLARACIÓN, no en la lectura.
    operatorMayBind: true,
    armAnchorGate: false,
    receivesThirdPartyReturns: true,
  };
}

/**
 * Dry plan — writes nothing. Either the ordered ceremony with its sponsorship
 * figure, or the refusals that must be fixed before anyone signs anything.
 */
router.post('/runs/:id/structures/plan', guarded(async (req, res) => {
  const run = await requireRun(req, res);
  if (!run) return;
  let reserve: { baseXrp: number; incrementXrp: number };
  try {
    reserve = await readReserveFigures(run.omnibusAddress);
  } catch (e) {
    return void res.status(503).json({ error: 'LEDGER_UNREADABLE', retryable: true, detail: `the ledger reserve figures could not be read (${safeErrorDetail(e).slice(0, 200)}) — nothing is planned on invented numbers` });
  }
  const draft = (req.body ?? {}) as Record<string, unknown>;
  // Un asiento puede ser solo un par de llaves (no cuesta reserva, pero no se
  // rota ni se acredita) y la personal tiene que EXISTIR para poder emitir. Se
  // lee antes de planificar; lo que no se pueda leer se queda sin afirmar.
  const exists = await readAccountsExist(addressesOf(draft));
  const parsed = readDeclaration(draft, run, reserve, exists);
  if ('error' in parsed) return void bad(res, parsed.error);
  const plan = planStructureBirth(parsed.input);
  res.json({ plan, reserveFigures: reserve });
}));

/** Declare a structure. Refusals are 409 and nothing is written. */
router.post('/runs/:id/structures', guarded(async (req, res) => {
  const snapshot = await requireRun(req, res);
  if (!snapshot) return;
  let reserve: { baseXrp: number; incrementXrp: number };
  try {
    reserve = await readReserveFigures(snapshot.omnibusAddress);
  } catch (e) {
    return void res.status(503).json({ error: 'LEDGER_UNREADABLE', retryable: true, detail: `the ledger reserve figures could not be read (${safeErrorDetail(e).slice(0, 200)}) — nothing was declared` });
  }
  const draft = (req.body ?? {}) as Record<string, unknown>;
  const exists = await readAccountsExist(addressesOf(draft));
  await withRunLock(snapshot.runId, async () => {
    const run = (await loadRun(snapshot.runId))!;
    const parsed = readDeclaration(draft, run, reserve, exists);
    if ('error' in parsed) return void bad(res, parsed.error);
    if (structureByAddress(run, parsed.input.structureAddress)) {
      return void res.status(409).json({ error: 'STRUCTURE_ALREADY_DECLARED', detail: `${parsed.input.structureAddress} is already a structure of this tenant — two rows would fork its book of acts` });
    }
    if (structuresOf(run).length >= MAX_STRUCTURES_PER_RUN) {
      return void res.status(409).json({ error: 'TOO_MANY_STRUCTURES', detail: `this tenant already holds ${MAX_STRUCTURES_PER_RUN} structures` });
    }
    const plan = planStructureBirth(parsed.input);
    if (!plan.ok) {
      return void res.status(409).json({ error: 'STRUCTURE_REFUSED', refusals: plan.refusals, authority: plan.authority });
    }
    const structure: DemoStructure = {
      id: nextStructureId(run),
      runId: run.runId,
      label: parsed.label,
      kind: parsed.input.kind,
      governance: parsed.input.governance,
      rootAddress: parsed.input.rootAddress,
      address: parsed.input.structureAddress,
      seats: parsed.input.seats,
      quorum: parsed.input.quorum,
      designation: parsed.input.designation,
      paysThroughCredentialGate: parsed.input.paysThroughCredentialGate,
      carriesOwnCredentials: parsed.input.carriesOwnCredentials,
      clientId: parsed.clientId,
      fundingXrp: plan.reserve!.fundingXrp,
      steps: [],
      createdAt: new Date().toISOString(),
    };
    structuresOf(run).push(structure);
    run.receipts.push(makeReceipt(run, {
      step: 'NOTE',
      chain: 'none',
      clientId: parsed.clientId,
      note: `Commanded account declared: "${structure.label}" (${structure.kind}, ${structure.governance}) at ${structure.address}, commanded by ${structure.rootAddress} — ${structure.seats.length} seat(s), quorum ${structure.quorum}, sponsorship ${structure.fundingXrp} XRP. Nothing signed yet.`,
      expect: { structureId: structure.id, address: structure.address, kind: structure.kind, governance: structure.governance, root: structure.rootAddress, quorum: structure.quorum, fundingXrp: structure.fundingXrp },
    }));
    await saveRun(run);
    res.status(201).json({ structure, plan });
  });
}));

/**
 * The tenant's structures, with the LEDGER's answer beside the declaration —
 * the registry holds pointers, the ledger holds the truth.
 */
router.get('/runs/:id/structures', guarded(async (req, res) => {
  if (!(await callerIsAdmin(req))) return void res.status(404).json({ error: 'NOT_FOUND' });
  const run = await requireRun(req, res);
  if (!run) return;
  const { xrplProvider } = await import('../integrations/providers/chain/XRPLProvider');
  let reserve: { baseXrp: number; incrementXrp: number } | null = null;
  try {
    reserve = await readReserveFigures(run.omnibusAddress);
  } catch {
    /* the list still renders; the plan column simply says nothing */
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const s of structuresOf(run)) {
    let onLedger: { quorum: number; masterKeyDisabled: boolean; signers: Array<{ account: string; weight: number }> } | null = null;
    let unreadable = false;
    try {
      onLedger = await xrplProvider.getSignerCouncil(s.address);
    } catch {
      unreadable = true;
    }
    const plan = reserve ? planStructureBirth(birthInputOf(run, s, reserve)) : null;
    rows.push({
      structure: s,
      progress: plan ? structureProgress(plan, s) : null,
      ledger: unreadable ? null : { hasSignerList: !!onLedger, quorum: onLedger?.quorum ?? null, masterKeyDisabled: onLedger?.masterKeyDisabled ?? false, signers: onLedger?.signers ?? [] },
      ledgerUnreadable: unreadable,
      // The door verdict is computed from the LEDGER, never from the registry.
      door:
        plan && !unreadable
          ? canCloseStructureDoor({
              authority: plan.authority,
              rehearsalComplete: stepsDone(s).has('rehearse'),
              hasSignerList: !!onLedger,
            })
          : null,
    });
  }
  res.json({ structures: rows, reserveFigures: reserve });
}));

/** Compose the UNSIGNED bytes of one step — refusing when its predecessors are not on the ledger. */
router.post('/runs/:id/structures/:sid/steps/:step/prepare', guarded(async (req, res) => {
  const run = await requireRun(req, res);
  if (!run) return;
  const step = String(req.params.step) as BirthStepId;
  if (!BIRTH_STEPS.includes(step)) return void bad(res, `step must be one of ${BIRTH_STEPS.join(', ')}`);
  const structure = findStructure(run, String(req.params.sid));
  if (!structure) return void res.status(404).json({ error: 'STRUCTURE_NOT_FOUND' });

  let reserve: { baseXrp: number; incrementXrp: number };
  try {
    reserve = await readReserveFigures(run.omnibusAddress);
  } catch (e) {
    return void res.status(503).json({ error: 'LEDGER_UNREADABLE', retryable: true, detail: `the ledger reserve figures could not be read (${safeErrorDetail(e).slice(0, 200)}) — nothing was composed` });
  }
  const plan = planStructureBirth(birthInputOf(run, structure, reserve));
  if (!plan.ok) return void res.status(409).json({ error: 'STRUCTURE_REFUSED', refusals: plan.refusals });

  const block = stepBlockedBy(plan, structure, step);
  if (block.notInPlan || block.alreadyDone || block.missing.length > 0) {
    return void res.status(409).json({
      error: block.alreadyDone ? 'STEP_ALREADY_DONE' : block.notInPlan ? 'STEP_NOT_IN_PLAN' : 'STEP_BLOCKED',
      detail: block.reason,
      missing: block.missing,
    });
  }

  // The door is the one step that cannot be undone: its lock is re-checked
  // against the LEDGER right before the bytes exist, never against the registry.
  if (step === 'close-door') {
    const { xrplProvider: provider } = await import('../integrations/providers/chain/XRPLProvider');
    let council: { quorum: number; masterKeyDisabled: boolean; signers: Array<{ account: string; weight: number }> } | null;
    try {
      council = await provider.getSignerCouncil(structure.address);
    } catch (e) {
      return void res.status(503).json({ error: 'LEDGER_UNREADABLE', retryable: true, detail: `the signer list of ${structure.address} could not be read (${safeErrorDetail(e).slice(0, 200)}) — the door is never composed on an unread ledger` });
    }
    if (council?.masterKeyDisabled) {
      return void res.status(409).json({ error: 'DOOR_ALREADY_CLOSED', detail: 'this account already has its master key disabled — only its quorum acts' });
    }
    const verdict = canCloseStructureDoor({
      // The authority judged is the one ON THE LEDGER, not the declared one.
      authority: assessStructureAuthority(
        (council?.signers ?? []).map((sg) => ({
          account: sg.account,
          weight: sg.weight,
          holder: structure.seats.find((seat) => seat.account === sg.account)?.holder ?? 'member',
        })),
        council?.quorum ?? 0,
      ),
      rehearsalComplete: stepsDone(structure).has('rehearse'),
      hasSignerList: !!council,
    });
    if (!verdict.allowed) return void res.status(409).json({ error: 'DOOR_LOCKED', detail: verdict.reason });
  }

  try {
    const composed = composeStructureStep(step, {
      structure,
      rootAddress: structure.rootAddress,
      omnibusAddress: run.omnibusAddress,
      ownerReserveXrp: reserve.incrementXrp,
      designationType: DESIGNATION_TYPE,
      designationDays: DESIGNATION_DAYS,
    });
    res.json({ step, signer: composed.signer, ...composed.handoff, structureId: structure.id });
  } catch (e) {
    if (e instanceof StructureStepError) return void res.status(409).json({ error: e.code, detail: e.message });
    throw e;
  }
}));

/** Report the hash of a signed step. Believed only after the ledger says so. */
router.post('/runs/:id/structures/:sid/steps/:step/record', guarded(async (req, res) => {
  const snapshot = await requireRun(req, res);
  if (!snapshot) return;
  const step = String(req.params.step) as BirthStepId;
  if (!BIRTH_STEPS.includes(step)) return void bad(res, `step must be one of ${BIRTH_STEPS.join(', ')}`);
  const txHash = String(((req.body ?? {}) as Record<string, unknown>).txHash ?? '').trim();
  if (!HEX64.test(txHash)) return void bad(res, 'txHash must be a 64-character XRPL transaction hash');
  const declared = findStructure(snapshot, String(req.params.sid));
  if (!declared) return void res.status(404).json({ error: 'STRUCTURE_NOT_FOUND' });

  // Read the ledger BEFORE taking the lock: a network read inside the run lock
  // holds every other write of this tenant for as long as rippled takes.
  const verdict = await verifyStructureStep(step, txHash, {
    structure: declared,
    rootAddress: declared.rootAddress,
    omnibusAddress: snapshot.omnibusAddress,
  });
  if (!verdict.ok) {
    const status = verdict.code === 'UNREADABLE' || verdict.code === 'NOT_VALIDATED' ? 503 : 409;
    return void res.status(status).json({ error: verdict.code, retryable: status === 503, detail: verdict.reason, observed: verdict.observed });
  }

  await withRunLock(snapshot.runId, async () => {
    const run = (await loadRun(snapshot.runId))!;
    const structure = findStructure(run, String(req.params.sid));
    if (!structure) return void res.status(404).json({ error: 'STRUCTURE_NOT_FOUND' });
    if (stepsDone(structure).has(step)) {
      return void res.status(409).json({ error: 'STEP_ALREADY_DONE', detail: `step "${step}" is already recorded for this structure` });
    }
    if (structuresOf(run).some((s) => s.steps.some((r) => r.txHash === txHash))) {
      return void res.status(409).json({ error: 'HASH_ALREADY_USED', detail: 'that transaction is already recorded against a step — one act, one hash' });
    }
    structure.steps.push({ step, txHash, ledgerIndex: verdict.ledgerIndex, at: new Date().toISOString(), observed: verdict.observed });
    if (step === 'close-door') structure.doorClosedAt = new Date().toISOString();
    run.receipts.push(
      makeReceipt(run, {
        step: 'NOTE',
        chain: 'xrpl',
        clientId: structure.clientId,
        txHash,
        note:
          step === 'close-door'
            ? `"${structure.label}" closed its door: the master key of ${structure.address} is disabled. From here no key controls that account — only its quorum acts.`
            : `"${structure.label}": ceremony step "${step}" validated on the ledger.`,
        expect: { structureId: structure.id, step, address: structure.address },
      }),
    );
    await saveRun(run);
    res.json({ structure, verdict });
  });
}));

export default router;
