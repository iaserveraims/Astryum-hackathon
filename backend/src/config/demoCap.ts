/**
 * Demo transaction cap — the "radius limiter" for the open MVP (judge / public phase).
 *
 * It is NOT a safety guard against stranding (that is pre-sign simulation, invariant
 * #12 — see R8 in the productizer plan). It BOUNDS the blast radius: with a 1-XRP cap,
 * the worst case of a batch that reverts is a judge losing ~1 XRP, not 100.
 *
 * Three layers, all FAIL-CLOSED (missing/malformed config ⇒ protection ON, never off):
 *   1. Per-transaction cap        — DEMO_MAX_XRP_PER_TX (default 1).
 *   2. Per-address daily volume   — DEMO_MAX_XRP_PER_ADDRESS_PER_DAY (calibrated below):
 *      protects the executor budget from one address draining it. PERSISTED (survives a
 *      redeploy / covers multi-instance — see below).
 *   3. Global fee-budget pre-check — lives in the route middleware (flareDemo.ts) via
 *      ExecutorFuelService: refuse before signing if the executor can't attest one more
 *      mint. This layer, not the cap, is what stops the executor running dry.
 *
 * Exemption is by an EXPLICIT list, NEVER the execution allowlist: opening the app
 * relaxes/retires that allowlist for the judge path, which would silently exempt
 * everyone entering — a permissions-layer version of the "unearned success" bug family
 * (a change in one dimension erasing a guarantee in another). Two explicit lists:
 *   · DEMO_CAP_EXEMPT_EMAILS (2026-07-25, preferred) — ACCOUNT-based: the authenticated
 *     user's email (from the session JWT, unforgeable client-side) exempts every wallet
 *     the account pays from. Deliberately its OWN list, NOT ADMIN_EMAILS: the panel
 *     allowlist serves a different power, and adding someone there must not silently
 *     grant cap exemption (the same cross-purpose-list disease as above).
 *   · DEMO_CAP_EXEMPT_ADDRESSES — address-based fallback. Weaker: the address in the
 *     prepare body is CLAIMED by the client (any caller can type a founder's public r…),
 *     though a claimed-but-not-owned address yields a payload the caller cannot sign and
 *     an on-chain sender check the executor enforces. Kept for wallets without accounts.
 *
 * IDENTITY (§5). Both the exemption and the daily counter key on the PAYER the user
 * controls: the XRPL classic address (r…) for the 0xFE mint rail — that address signs
 * the Payment in Xaman and is the only budget-relevant rail (it spends the executor's
 * FLR). The EVM-direct rail (evmAddress) settles with the user's own signature and
 * spends NO executor budget, so it keys separately with no evasion of the budget: there
 * is nothing to evade. The per-tx cap is per-request (no accumulation) so keying can't
 * be gamed there either.
 */

import { kvGet, kvUpsert } from '../services/persistence/backgroundJobKv';

const DEFAULT_MAX_XRP_PER_TX = 1;

/**
 * §2 — calibrated against the executor's REAL fee budget, not a round number.
 * The 0xFE rail's effective FDC-fee budget is FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR (120)
 * minus LEGACY_DAILY_FEE_RESERVE_FLR (40) = 80 FLR/day (ExecutorFuelService), and each
 * mint costs ~20 FLR of attestation → ~4 mints/day TOTAL for everyone. Since the per-tx
 * cap is ~1 XRP = 1 mint, per-address daily XRP ≈ per-address mints. Default 2 XRP/addr
 * = 2 mints = ~40 FLR → two such addresses fit the 80 FLR window. A single address at
 * the old default of 5 = 5 mints = ~100 FLR would exceed the WHOLE effective budget
 * (125%) and starve every other judge. Raising this without raising the executor budget
 * starves later judges; the §3 global pre-check is the hard backstop either way.
 */
const DEFAULT_MAX_XRP_PER_ADDRESS_PER_DAY = 2;

/**
 * Below this, the fixed direct-mint fees (0.1 minting + 0.2 executor = 0.3 XRP) leave
 * nothing to mint and `computeNetMint` throws DIRECT_MINT_INSUFFICIENT. A per-tx cap at
 * or below this floor would make EVERY mint fail — an app that silently rejects all.
 */
export const DIRECT_MINT_VIABLE_FLOOR_XRP = 0.3;

const DAILY_JOB_TYPE = 'demo-cap-daily';

/** Fail-closed parse: missing / empty / malformed / non-positive ⇒ fallback (protection ON). */
function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getDemoMaxXrpPerTx(): number {
  return parsePositiveNumber(process.env.DEMO_MAX_XRP_PER_TX, DEFAULT_MAX_XRP_PER_TX);
}

export function getDemoMaxXrpPerAddressPerDay(): number {
  return parsePositiveNumber(
    process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY,
    DEFAULT_MAX_XRP_PER_ADDRESS_PER_DAY,
  );
}

let cachedExempt: { raw: string; set: Set<string> } | null = null;
export function getDemoCapExemptAddresses(): Set<string> {
  const raw = process.env.DEMO_CAP_EXEMPT_ADDRESSES ?? '';
  if (!cachedExempt || cachedExempt.raw !== raw) {
    cachedExempt = {
      raw,
      set: new Set(raw.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean)),
    };
  }
  return cachedExempt.set;
}

export function isDemoCapExempt(address: string | null | undefined): boolean {
  if (!address) return false;
  return getDemoCapExemptAddresses().has(address.trim().toLowerCase());
}

let cachedExemptEmails: { raw: string; set: Set<string> } | null = null;
export function getDemoCapExemptEmails(): Set<string> {
  const raw = process.env.DEMO_CAP_EXEMPT_EMAILS ?? '';
  if (!cachedExemptEmails || cachedExemptEmails.raw !== raw) {
    cachedExemptEmails = {
      raw,
      set: new Set(raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
    };
  }
  return cachedExemptEmails.set;
}

/**
 * Account-based exemption: the AUTHENTICATED user (session JWT → userId → email)
 * is on DEMO_CAP_EXEMPT_EMAILS, so every wallet the account pays from is exempt —
 * no address enumeration, nothing client-claimable. FAIL-CLOSED at every step:
 * no userId / empty list / no DB / lookup error ⇒ NOT exempt, the cap stays on.
 * The email set is checked before touching the DB so the common case (no list
 * configured) costs nothing.
 */
export async function isDemoCapExemptUser(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const emails = getDemoCapExemptEmails();
  if (emails.size === 0) return false;
  if (!process.env.DATABASE_URL) return false;
  try {
    const { prisma } = await import('../database/prismaClient');
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const email = user?.email?.trim().toLowerCase();
    return !!email && emails.has(email);
  } catch (e) {
    console.error(`[demoCap] exempt-account lookup failed: ${(e as Error).message}`);
    return false;
  }
}

// ── Per-address daily volume — RESERVA → CONFIRMACIÓN, persistida (§1, v2) ──
//
// v1 contaba el gasto EN EL PREPARE y jamás lo soltaba: un intent preparado y
// cancelado seguía consumiendo el cupo del día (incidente fundador 2026-07-25 —
// el gauge "XRP fuel" contaba humo). v2 separa las dos verdades:
//
//   · El prepare RESERVA (sigue siendo el único punto de control antes de la
//     firma — sin reserva, un burst de prepares rebasaría el cupo).
//   · Una reserva sin confirmar EXPIRA sola (DEMO_CAP_RESERVATION_TTL_MIN,
//     default 30): el prepare cancelado deja de contar al rato.
//   · La EJECUCIÓN del mint (el executor, cuando el Payment firmado corre en
//     Flare) CONFIRMA la reserva — eso ya no expira jamás: es gasto real.
//   · RE-ASERCIÓN: un Payment firmado tarde que ejecuta SIN reserva viva se
//     suma como confirmado igual — el acaparador que deja expirar sus reservas
//     y firma en ráfaga se reencuentra con su cupo al ejecutar. El techo duro
//     global sigue siendo el presupuesto FDC (assertDailyFeeBudget).
//
// Persistencia: mismo patrón probado (background_jobs, jobType propio), fila
// por `${address}:${dayUTC}` con la LISTA de entradas. Filas legacy ({xrp: n})
// migran en lectura como gasto confirmado. Sin DB ⇒ espejo en memoria.
interface DailySpendEntry {
  xrp: number;
  /** unix ms de la reserva/confirmación. */
  at: number;
  confirmed: boolean;
}

const dailySpendMem = new Map<string, DailySpendEntry[]>();

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // app runtime — Date is available
}

function reservationTtlMs(): number {
  const n = Number(process.env.DEMO_CAP_RESERVATION_TTL_MIN || 30);
  return (Number.isFinite(n) && n > 0 ? n : 30) * 60_000;
}

/** Gasto VIVO: confirmado + reservas aún frescas. Las expiradas no cuentan. */
function liveSpendXrp(entries: DailySpendEntry[], now: number): number {
  const ttl = reservationTtlMs();
  let sum = 0;
  for (const e of entries) {
    if (e.confirmed || now - e.at < ttl) sum += e.xrp;
  }
  return sum;
}

async function readDailyEntries(capKey: string): Promise<DailySpendEntry[]> {
  const p = await kvGet(DAILY_JOB_TYPE, 'capKey', capKey);
  if (Array.isArray(p?.entries)) return p.entries as DailySpendEntry[];
  // Fila legacy (v1: un acumulado) — se migra como gasto confirmado del día.
  if (typeof p?.xrp === 'number' && p.xrp > 0) return [{ xrp: p.xrp, at: 0, confirmed: true }];
  return dailySpendMem.get(capKey) ?? []; // no DB / no fila ⇒ espejo en memoria
}

async function writeDailyEntries(
  capKey: string,
  address: string,
  day: string,
  entries: DailySpendEntry[],
): Promise<void> {
  dailySpendMem.set(capKey, entries); // espejo siempre (fallback sin DB)
  await kvUpsert(DAILY_JOB_TYPE, 'capKey', capKey, { capKey, address, day, entries });
}

/**
 * Confirmación desde el EXECUTOR: el mint de `address` por `xrp` XRP se ejecutó
 * en Flare. Marca la reserva más antigua sin confirmar del MISMO importe; si no
 * hay (expiró, o el Payment se firmó sin pasar por un prepare vivo), la
 * re-aserción añade el gasto como confirmado. Best-effort: jamás lanza — un
 * fallo aquí no puede tocar la ejecución que lo llama.
 */
export async function confirmDailySpendXrp(
  address: string,
  xrp: number,
  now: number = Date.now(),
): Promise<void> {
  try {
    if (!(xrp > 0) || !address) return;
    if (isDemoCapExempt(address)) return; // los exentos nunca se contabilizan
    const addr = address.trim().toLowerCase();
    const day = todayUTC();
    const capKey = `${addr}:${day}`;
    const entries = await readDailyEntries(capKey);
    const match = entries
      .filter((e) => !e.confirmed && Math.abs(e.xrp - xrp) < 1e-9)
      .sort((a, b) => a.at - b.at)[0];
    if (match) {
      match.confirmed = true;
      match.at = now;
    } else {
      entries.push({ xrp, at: now, confirmed: true }); // re-aserción
    }
    await writeDailyEntries(capKey, addr, day, entries);
  } catch (e) {
    console.error(`[demoCap] confirmDailySpendXrp failed (non-fatal): ${(e as Error).message}`);
  }
}

export interface DemoCapError {
  status: number;
  body: { error: string; detail: string };
}

/**
 * Enforce the cap for one prepare. Returns a DemoCapError to hand to the client, or null
 * when allowed. Exempt addresses bypass both layers. The per-tx cap is enforced
 * synchronously first (never depends on the DB). The daily layer is persisted (§1).
 * `amountXrpEquiv` is the XRP that reaches the Core Vault (FXRP tracks XRP 1:1).
 */
export async function checkDemoCap(
  amountXrpEquiv: number,
  address: string | null | undefined,
  now: number = Date.now(),
): Promise<DemoCapError | null> {
  if (isDemoCapExempt(address)) return null;
  if (!(amountXrpEquiv > 0)) return null; // amount validity is the caller's job

  const maxTx = getDemoMaxXrpPerTx();
  if (amountXrpEquiv > maxTx) {
    return {
      status: 400,
      body: {
        error: 'DEMO_TX_CAP_EXCEEDED',
        detail:
          `Máximo ${maxTx} XRP por transacción durante la fase abierta — protección mientras ` +
          `el contrato no está auditado. Las comisiones de red son fijas (~0,3 XRP), no porcentuales.`,
      },
    };
  }

  const addr = (address ?? 'anonymous').trim().toLowerCase();
  const day = todayUTC();
  const capKey = `${addr}:${day}`;
  const maxDay = getDemoMaxXrpPerAddressPerDay();
  const entries = await readDailyEntries(capKey);
  const spent = liveSpendXrp(entries, now);
  if (spent + amountXrpEquiv > maxDay) {
    return {
      status: 429,
      body: {
        error: 'DEMO_DAILY_CAP_EXCEEDED',
        detail:
          `Límite diario de ${maxDay} XRP por dirección durante la fase abierta ` +
          `(protección del presupuesto). Un prepare sin firmar libera su cupo a los ` +
          `${Math.round(reservationTtlMs() / 60_000)} min; si firmaste, cuenta al ejecutarse. Inténtalo luego.`,
      },
    };
  }
  entries.push({ xrp: amountXrpEquiv, at: now, confirmed: false }); // RESERVA
  await writeDailyEntries(capKey, addr, day, entries);
  return null;
}

/**
 * Extract the mint XRP amount + signer from a prepare body and apply the cap. Reads the
 * mint-amount fields (amountXrpForMint | amountXrp | amountFxrp — FXRP tracks XRP 1:1) and
 * the address (xrplAddress | evmAddress). Returns null for bodies with NO mint amount
 * (E2's amountFlr, or withdraw/claim routes) — those are not the open-mint rail, so the
 * middleware lets them through untouched. `userId` is the AUTHENTICATED caller (the
 * flare-demo router mounts behind requireSiweAuth): an account on
 * DEMO_CAP_EXEMPT_EMAILS bypasses both cap layers whichever wallet it pays from.
 */
export async function demoCapFromBody(
  body: unknown,
  userId?: string | null,
): Promise<DemoCapError | null> {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = b.amountXrpForMint ?? b.amountXrp ?? b.amountFxrp;
  if (raw == null) return null;
  const amt = Number(raw);
  if (!Number.isFinite(amt) || amt <= 0) return null; // the route validates amount shape
  if (await isDemoCapExemptUser(userId)) return null;
  const addr =
    (typeof b.xrplAddress === 'string' && b.xrplAddress) ||
    (typeof b.evmAddress === 'string' && b.evmAddress) ||
    null;
  return checkDemoCap(amt, addr as string | null);
}

/** True when the body is an XRPL-mint (0xFE executor rail) — the only budget-relevant rail. */
export function isXrplMintBody(body: unknown): boolean {
  const b = (body ?? {}) as Record<string, unknown>;
  const hasMint = b.amountXrpForMint != null || b.amountXrp != null;
  return hasMint && typeof b.xrplAddress === 'string' && b.xrplAddress.trim().length > 0;
}

/**
 * Read-only snapshot for the Summary's usage bar (founder 2026-07-25): the caps
 * in force, what `address` has spent today (the SAME counter the daily layer
 * enforces — prepare-level accounting), and whether the caller is exempt (by
 * account or by address). NEVER records anything: reading the gauge twice must
 * not move it.
 */
export interface DemoCapStatus {
  maxXrpPerTx: number;
  maxXrpPerDay: number;
  spentTodayXrp: number;
  remainingTodayXrp: number;
  /** Split honesto del gauge: gasto EJECUTADO vs reservas frescas de prepares. */
  confirmedTodayXrp: number;
  reservedTodayXrp: number;
  exempt: boolean;
  day: string; // UTC — the window the counter resets on
}

export async function getDemoCapStatus(
  address: string | null | undefined,
  userId?: string | null,
  now: number = Date.now(),
): Promise<DemoCapStatus> {
  const maxXrpPerTx = getDemoMaxXrpPerTx();
  const maxXrpPerDay = getDemoMaxXrpPerAddressPerDay();
  const day = todayUTC();
  const exempt = isDemoCapExempt(address) || (await isDemoCapExemptUser(userId));
  // Exempt spends are never recorded, so the counter is only meaningful for
  // capped callers with an address.
  let confirmedTodayXrp = 0;
  let reservedTodayXrp = 0;
  if (address && !exempt) {
    const entries = await readDailyEntries(`${address.trim().toLowerCase()}:${day}`);
    const ttl = reservationTtlMs();
    for (const e of entries) {
      if (e.confirmed) confirmedTodayXrp += e.xrp;
      else if (now - e.at < ttl) reservedTodayXrp += e.xrp;
    }
  }
  const spentTodayXrp = confirmedTodayXrp + reservedTodayXrp;
  return {
    maxXrpPerTx,
    maxXrpPerDay,
    spentTodayXrp,
    remainingTodayXrp: Math.max(0, maxXrpPerDay - spentTodayXrp),
    confirmedTodayXrp,
    reservedTodayXrp,
    exempt,
    day,
  };
}

/** Test hook: reset in-memory daily counters + exempt caches. */
export function _resetDemoCapState(): void {
  dailySpendMem.clear();
  cachedExempt = null;
  cachedExemptEmails = null;
}

/**
 * Startup sanity + visibility (§2 + §5). Warns if the per-tx cap is at/below the
 * direct-mint viable floor (every mint would fail computeNetMint — the app would
 * silently reject all). Also LOGS the effective caps and how many exempt addresses /
 * accounts were parsed, so a typo in DEMO_CAP_EXEMPT_ADDRESSES or DEMO_CAP_EXEMPT_EMAILS
 * is caught at boot, not mid-demo on the 5th/14th when a team member gets capped.
 * Returns the warning string (or null).
 */
export function assertDemoCapSane(logger?: { warn: (m: string) => void; log?: (m: string) => void }): string | null {
  const maxTx = getDemoMaxXrpPerTx();
  const maxDay = getDemoMaxXrpPerAddressPerDay();
  const exemptCount = getDemoCapExemptAddresses().size;
  const exemptAccounts = getDemoCapExemptEmails().size;
  const info = `[demoCap] caps: ${maxTx} XRP/tx, ${maxDay} XRP/address/day; ${exemptCount} exempt address(es) parsed, ${exemptAccounts} exempt account(s).`;
  (logger?.log ?? ((m: string) => console.log(m)))(info);

  if (maxTx <= DIRECT_MINT_VIABLE_FLOOR_XRP) {
    const msg =
      `[demoCap] DEMO_MAX_XRP_PER_TX=${maxTx} ≤ ${DIRECT_MINT_VIABLE_FLOOR_XRP} XRP (direct-mint fee ` +
      `floor): every mint would fail computeNetMint (nothing left after the fixed 0.3 XRP fees). ` +
      `Raise DEMO_MAX_XRP_PER_TX or the demo rejects all transactions.`;
    (logger?.warn ?? ((m: string) => console.warn(m)))(msg);
    return msg;
  }
  return null;
}
