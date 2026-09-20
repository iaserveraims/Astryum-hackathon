/**
 * EL ESPEJO DE CUENTAS — la parte que EJECUTA lo que `plan.ts` decidió.
 *
 *     producción ──(solo lectura)──▶ este proceso (el preview)
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../database/prismaClient';
import {
  inScope,
  mergePreferences,
  mirrorScope,
  mirrorVerdict,
  resolveTarget,
  type MirrorReport,
  type MirrorVerdict,
  type UserIdentity,
} from './plan';

const TAG = '[account-mirror]';

// ── Lo que se lee del origen, columna a columna ─────────────────────────────
// Listas explícitas a propósito: el esquema del preview puede ir por delante
// del de producción, y un `SELECT *` traería columnas que el otro lado no
// tiene (o al revés). Aquí solo viajan las que existen en los dos.

const USER_COLS = [
  'id', 'xrplAddress', 'email', 'username', 'firstName', 'lastName', 'avatar',
  'passwordHash', 'authProvider', 'oauthSub', 'emailVerified', 'preferences',
  'isActive', 'lastLogin', 'createdAt', 'updatedAt', 'kycVerified', 'kycTier',
  'kycLevel', 'kycVerifiedAt', 'kycProvider', 'personaInquiryId',
] as const;
const WALLET_COLS = [
  'id', 'userId', 'walletType', 'address', 'network', 'chainId', 'caip2', 'wcTopic',
  'nickname', 'isConnected', 'permissions', 'lastActivity', 'createdAt', 'updatedAt',
  'ecosystem', 'isPrimary', 'purpose',
] as const;
const BINDING_COLS = [
  'id', 'userId', 'address', 'chainType', 'label', 'mode', 'signatureProof', 'isActive',
  'linkedAt', 'lastSeenAt', 'kycLinked', 'kycLinkedAt',
] as const;
const GOVERNED_COLS = ['id', 'userId', 'ecosystem', 'address', 'label', 'createdAt', 'updatedAt', 'removedAt'] as const;
const PASSKEY_COLS = [
  'id', 'userId', 'credentialId', 'publicKey', 'counter', 'transports', 'deviceLabel',
  'backedUp', 'createdAt', 'lastUsedAt',
] as const;
const STEPUP_COLS = ['id', 'userId', 'enabled', 'grantTtlSeconds', 'matrix', 'createdAt', 'updatedAt'] as const;
const MANAGER_COLS = [
  'id', 'userId', 'displayName', 'bio', 'licenseType', 'kycAt', 'isActive', 'status',
  'applicationNote', 'approvedAt', 'approvedBy', 'isFoundingManager', 'createdAt', 'updatedAt',
] as const;

type Row = Record<string, unknown>;

function q(cols: readonly string[]): string {
  return cols.map((c) => `"${c}"`).join(', ');
}

/** Un Json nullable de Prisma no acepta `null` a secas: hay que decir DbNull. */
function json(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}

/** `text[]` puede llegar como array o como `{a,b}` según el driver. */
function textArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.startsWith('{') && v.endsWith('}')) {
    const inner = v.slice(1, -1);
    return inner ? inner.split(',').map((s) => s.replace(/^"|"$/g, '')) : [];
  }
  return [];
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const date = (v: unknown): Date | null => (v instanceof Date ? v : null);

// ── El origen, en solo lectura ──────────────────────────────────────────────

function withSingleConnection(url: string): string {
  try {
    const u = new URL(url);
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '1');
    return u.toString();
  } catch {
    return url;
  }
}

async function openSource(url: string): Promise<PrismaClient> {
  const source = new PrismaClient({ datasources: { db: { url: withSingleConnection(url) } }, log: ['error'] });
  await source.$connect();
  // ⚠ NUNCA UN `SET` DE SESIÓN CONTRA EL ORIGEN. Aquí hubo un
  // `SET default_transaction_read_only = on` como «segundo cinturón», y, ejecutado a mano contra el Transaction Pooler de Supabase (puerto
  // 6543), envenenó producción: en modo transacción el SET no queda ligado a
  // este cliente, se queda en la conexión de SERVIDOR del pool, y cuando el
  // pooler se la presta al backend de producción sus UPDATE fallan con 25006
  // «cannot execute UPDATE in a read-only transaction». El cinturón de verdad
  // es el ROL de solo lectura (ver .env.example); la garantía de este fichero
  // es que solo emite SELECT — y un SELECT no puede escribir. Nada de estado
  // de sesión a través de un pooler, jamás.
  return source;
}

async function readProdUsers(source: PrismaClient): Promise<Row[]> {
  return source.$queryRawUnsafe<Row[]>(`SELECT ${q(USER_COLS)} FROM "users" ORDER BY "createdAt" ASC`);
}

async function readChildren(source: PrismaClient, table: string, cols: readonly string[], userId: string): Promise<Row[]> {
  return source.$queryRawUnsafe<Row[]>(`SELECT ${q(cols)} FROM "${table}" WHERE "userId" = $1`, userId);
}

// ── Escritura en el destino (este proceso) ──────────────────────────────────

/** Las filas del destino que comparten algún identificador único con la de producción. */
async function localCollisions(prod: UserIdentity): Promise<UserIdentity[]> {
  const or: Prisma.UserWhereInput[] = [{ id: prod.id }];
  if (prod.email) or.push({ email: { equals: prod.email, mode: 'insensitive' } });
  if (prod.oauthSub) or.push({ oauthSub: prod.oauthSub });
  if (prod.xrplAddress) or.push({ xrplAddress: prod.xrplAddress });
  return prisma.user.findMany({ where: { OR: or }, select: { id: true, email: true, oauthSub: true, xrplAddress: true } });
}

/**
 * La fila de `users`, sobre el id adoptado. Los campos de producción mandan;
 * las preferencias se funden (lo que producción no conoce, se queda); los
 * tokens de reseteo son de cada entorno y no viajan.
 */
async function writeUser(u: Row, targetId: string, create: boolean): Promise<void> {
  const local = create ? null : await prisma.user.findUnique({ where: { id: targetId }, select: { preferences: true } });
  const data = {
    xrplAddress: str(u.xrplAddress),
    email: str(u.email),
    username: str(u.username),
    firstName: str(u.firstName),
    lastName: str(u.lastName),
    avatar: str(u.avatar),
    passwordHash: str(u.passwordHash),
    resetToken: null,
    resetTokenExpiresAt: null,
    authProvider: str(u.authProvider) ?? 'email',
    oauthSub: str(u.oauthSub),
    emailVerified: !!u.emailVerified,
    preferences: json(mergePreferences(local?.preferences ?? null, u.preferences)),
    isActive: u.isActive !== false,
    lastLogin: date(u.lastLogin),
    kycVerified: !!u.kycVerified,
    kycTier: str(u.kycTier) ?? 'none',
    kycLevel: str(u.kycLevel),
    kycVerifiedAt: date(u.kycVerifiedAt),
    kycProvider: str(u.kycProvider),
    personaInquiryId: str(u.personaInquiryId),
  };
  if (create) {
    await prisma.user.create({ data: { id: targetId, createdAt: date(u.createdAt) ?? undefined, ...data } });
  } else {
    await prisma.user.update({ where: { id: targetId }, data });
  }
}

/** Crea con el id de producción si está libre; si ya lo usa otra fila, sin id (cuid nuevo). */
async function createWithPreferredId<T>(
  create: (id: string | undefined) => Promise<T>,
  preferredId: string,
): Promise<T> {
  try {
    return await create(preferredId || undefined);
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002' && preferredId) return create(undefined);
    throw e;
  }
}

async function upsertWallet(w: Row, userId: string): Promise<void> {
  const base = {
    walletType: str(w.walletType) ?? 'unknown',
    caip2: str(w.caip2),
    wcTopic: str(w.wcTopic),
    nickname: str(w.nickname),
    isConnected: w.isConnected !== false,
    permissions: (w.permissions ?? {}) as Prisma.InputJsonValue,
    lastActivity: date(w.lastActivity) ?? new Date(),
    ecosystem: str(w.ecosystem) ?? 'evm',
    isPrimary: !!w.isPrimary,
    purpose: str(w.purpose) ?? 'sign',
  };
  const address = str(w.address) ?? '';
  const network = str(w.network) ?? '';
  const chainId = typeof w.chainId === 'number' ? w.chainId : null;
  const existing = await prisma.wallet.findUnique({
    where: { userId_address_network: { userId, address, network } },
    select: { id: true },
  });
  const write = async (cid: number | null) => {
    if (existing) {
      await prisma.wallet.update({ where: { id: existing.id }, data: { ...base, chainId: cid } });
      return;
    }
    await createWithPreferredId(
      (id) => prisma.wallet.create({ data: { ...(id ? { id } : {}), userId, address, network, createdAt: date(w.createdAt) ?? undefined, ...base, chainId: cid } }),
      str(w.id) ?? '',
    );
  };
  try {
    await write(chainId);
  } catch (e) {
    // `chainId` es FK a `chains`: un registro del preview sin esa fila no
    // puede bloquear la wallet entera (mismo trato que flareDemo.ts).
    if (chainId === null) throw e;
    await write(null);
  }
}

async function upsertBinding(b: Row, userId: string): Promise<void> {
  const address = str(b.address) ?? '';
  const chainType = str(b.chainType) ?? 'evm';
  const data = {
    label: str(b.label),
    mode: str(b.mode) ?? 'read',
    signatureProof: str(b.signatureProof) ?? '',
    isActive: b.isActive !== false,
    lastSeenAt: date(b.lastSeenAt),
    kycLinked: !!b.kycLinked,
    kycLinkedAt: date(b.kycLinkedAt),
  };
  const existing = await prisma.walletBinding.findUnique({
    where: { userId_address_chainType: { userId, address, chainType } },
    select: { id: true },
  });
  if (existing) {
    await prisma.walletBinding.update({ where: { id: existing.id }, data });
    return;
  }
  await createWithPreferredId(
    (id) => prisma.walletBinding.create({ data: { ...(id ? { id } : {}), userId, address, chainType, linkedAt: date(b.linkedAt) ?? undefined, ...data } }),
    str(b.id) ?? '',
  );
}

async function upsertGoverned(g: Row, userId: string): Promise<void> {
  const ecosystem = str(g.ecosystem) ?? 'xrpl';
  const address = str(g.address) ?? '';
  const data = { label: str(g.label), removedAt: date(g.removedAt) };
  const existing = await prisma.governedAccount.findUnique({
    where: { userId_ecosystem_address: { userId, ecosystem, address } },
    select: { id: true },
  });
  if (existing) {
    await prisma.governedAccount.update({ where: { id: existing.id }, data });
    return;
  }
  await createWithPreferredId(
    (id) => prisma.governedAccount.create({ data: { ...(id ? { id } : {}), userId, ecosystem, address, createdAt: date(g.createdAt) ?? undefined, ...data } }),
    str(g.id) ?? '',
  );
}

async function upsertPasskey(p: Row, userId: string): Promise<void> {
  const credentialId = str(p.credentialId) ?? '';
  const data = {
    userId,
    publicKey: Buffer.isBuffer(p.publicKey) ? p.publicKey : Buffer.from(p.publicKey as Uint8Array),
    counter: typeof p.counter === 'bigint' ? p.counter : BigInt(String(p.counter ?? 0)),
    transports: textArray(p.transports),
    deviceLabel: str(p.deviceLabel),
    backedUp: !!p.backedUp,
    lastUsedAt: date(p.lastUsedAt),
  };
  await prisma.passkeyCredential.upsert({
    where: { credentialId },
    create: { credentialId, createdAt: date(p.createdAt) ?? undefined, ...data },
    update: data,
  });
}

async function upsertStepUp(s: Row, userId: string): Promise<void> {
  const data = {
    enabled: !!s.enabled,
    grantTtlSeconds: Number(s.grantTtlSeconds ?? 300),
    matrix: (s.matrix ?? {}) as Prisma.InputJsonValue,
  };
  await prisma.stepUpLockConfig.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

async function upsertManagerProfile(m: Row, userId: string): Promise<void> {
  const data = {
    displayName: str(m.displayName) ?? '',
    bio: str(m.bio),
    licenseType: str(m.licenseType) ?? 'individual',
    kycAt: date(m.kycAt),
    isActive: m.isActive !== false,
    status: str(m.status) ?? 'active',
    applicationNote: str(m.applicationNote),
    approvedAt: date(m.approvedAt),
    approvedBy: str(m.approvedBy),
    isFoundingManager: !!m.isFoundingManager,
  };
  await prisma.managerProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

async function pruneChildren(
  userId: string,
  keep: {
    wallets: Array<{ address: string; network: string }>;
    bindings: Array<{ address: string; chainType: string }>;
    governed: Array<{ ecosystem: string; address: string }>;
    passkeys: string[];
  },
): Promise<number> {
  const [wallets, bindings, governed, passkeys] = await Promise.all([
    prisma.wallet.findMany({ where: { userId }, select: { id: true, address: true, network: true } }),
    prisma.walletBinding.findMany({ where: { userId }, select: { id: true, address: true, chainType: true } }),
    prisma.governedAccount.findMany({ where: { userId }, select: { id: true, ecosystem: true, address: true } }),
    prisma.passkeyCredential.findMany({ where: { userId }, select: { id: true, credentialId: true } }),
  ]);
  const w = wallets.filter((r) => !keep.wallets.some((k) => k.address === r.address && k.network === r.network)).map((r) => r.id);
  const b = bindings.filter((r) => !keep.bindings.some((k) => k.address === r.address && k.chainType === r.chainType)).map((r) => r.id);
  const g = governed.filter((r) => !keep.governed.some((k) => k.address === r.address && k.ecosystem === r.ecosystem)).map((r) => r.id);
  const p = passkeys.filter((r) => !keep.passkeys.includes(r.credentialId)).map((r) => r.id);
  const [a, c, d, e] = await Promise.all([
    prisma.wallet.deleteMany({ where: { id: { in: w } } }),
    prisma.walletBinding.deleteMany({ where: { id: { in: b } } }),
    prisma.governedAccount.deleteMany({ where: { id: { in: g } } }),
    prisma.passkeyCredential.deleteMany({ where: { id: { in: p } } }),
  ]);
  return a.count + c.count + d.count + e.count;
}

// ── Una pasada ───────────────────────────────────────────────────────────────

let inFlight: Promise<MirrorReport> | null = null;
let lastReport: MirrorReport | null = null;
let lastError: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export interface RunOptions {
  /** Igualar el preview a producción también borrando las filas hijas que solo existen aquí. Solo a demanda. */
  prune?: boolean;
  env?: NodeJS.ProcessEnv;
}

export async function runAccountMirror(opts: RunOptions = {}): Promise<MirrorReport> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const env = opts.env ?? process.env;
    const verdict = mirrorVerdict(env);
    if (verdict.ok === false) throw new Error(`mirror refused: ${verdict.reason}`);
    const scope = mirrorScope(env);
    const t0 = Date.now();
    const report: MirrorReport = {
      startedAt: new Date(t0).toISOString(),
      finishedAt: '',
      ms: 0,
      scope: scope.kind,
      candidates: 0,
      users: 0,
      adopted: 0,
      wallets: 0,
      bindings: 0,
      governed: 0,
      passkeys: 0,
      stepUp: 0,
      managerProfiles: 0,
      pruned: 0,
      failures: [],
    };
    if (scope.kind === 'nobody') {
      console.warn(`${TAG} nadie en el ámbito: ni ADMIN_EMAILS ni ACCOUNT_MIRROR_EMAILS — no se refleja ninguna cuenta`);
      report.finishedAt = new Date().toISOString();
      report.ms = Date.now() - t0;
      lastReport = report;
      lastError = null;
      return report;
    }

    const source = await openSource(verdict.sourceUrl);
    try {
      const users = (await readProdUsers(source)).filter((u) => inScope(scope, str(u.email)));
      report.candidates = users.length;
      for (const u of users) {
        const identity: UserIdentity = {
          id: str(u.id) ?? '',
          email: str(u.email),
          oauthSub: str(u.oauthSub),
          xrplAddress: str(u.xrplAddress),
        };
        try {
          const target = resolveTarget(identity, await localCollisions(identity));
          const targetId = target.id;
          if (target.kind === 'adopt' && !target.sameId) {
            report.adopted += 1;
            console.log(`${TAG} ${identity.email ?? identity.id}: adoptada la cuenta del preview ${targetId.slice(0, 8)}… (misma persona, otro id) — se conserva lo que tenía`);
          }
          await writeUser(u, targetId, target.kind === 'create');
          report.users += 1;

          const [wallets, bindings, governed, passkeys, stepUp, manager] = await Promise.all([
            readChildren(source, 'wallets', WALLET_COLS, identity.id),
            readChildren(source, 'wallet_bindings', BINDING_COLS, identity.id),
            readChildren(source, 'governed_accounts', GOVERNED_COLS, identity.id),
            readChildren(source, 'passkey_credentials', PASSKEY_COLS, identity.id),
            readChildren(source, 'step_up_lock_configs', STEPUP_COLS, identity.id),
            readChildren(source, 'manager_profiles', MANAGER_COLS, identity.id),
          ]);
          for (const w of wallets) { await upsertWallet(w, targetId); report.wallets += 1; }
          for (const b of bindings) { await upsertBinding(b, targetId); report.bindings += 1; }
          for (const g of governed) { await upsertGoverned(g, targetId); report.governed += 1; }
          for (const p of passkeys) { await upsertPasskey(p, targetId); report.passkeys += 1; }
          for (const s of stepUp) { await upsertStepUp(s, targetId); report.stepUp += 1; }
          for (const m of manager) { await upsertManagerProfile(m, targetId); report.managerProfiles += 1; }

          if (opts.prune) {
            report.pruned += await pruneChildren(targetId, {
              wallets: wallets.map((r) => ({ address: str(r.address) ?? '', network: str(r.network) ?? '' })),
              bindings: bindings.map((r) => ({ address: str(r.address) ?? '', chainType: str(r.chainType) ?? 'evm' })),
              governed: governed.map((r) => ({ ecosystem: str(r.ecosystem) ?? 'xrpl', address: str(r.address) ?? '' })),
              passkeys: passkeys.map((r) => str(r.credentialId) ?? ''),
            });
          }
        } catch (e) {
          const error = (e as Error).message;
          report.failures.push({ email: identity.email, id: identity.id, error });
          console.error(`${TAG} ${identity.email ?? identity.id}: falló — ${error}`);
        }
      }
    } finally {
      await source.$disconnect().catch(() => undefined);
    }
    report.finishedAt = new Date().toISOString();
    report.ms = Date.now() - t0;
    lastReport = report;
    lastError = null;
    console.log(
      `${TAG} pasada: ${report.users}/${report.candidates} cuentas, ${report.wallets} wallets, ${report.governed} gobernadas, ${report.adopted} adoptadas, ${report.pruned} podadas, ${report.failures.length} fallos, ${report.ms} ms`,
    );
    return report;
  })().catch((e) => {
    lastError = (e as Error).message;
    throw e;
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

// ── El reloj ─────────────────────────────────────────────────────────────────

export function accountMirrorStatus(env: NodeJS.ProcessEnv = process.env): {
  verdict: MirrorVerdict;
  scope: ReturnType<typeof mirrorScope>['kind'];
  running: boolean;
  scheduled: boolean;
  lastReport: MirrorReport | null;
  lastError: string | null;
} {
  return {
    verdict: mirrorVerdict(env),
    scope: mirrorScope(env).kind,
    running: inFlight !== null,
    scheduled: timer !== null,
    lastReport,
    lastError,
  };
}

/**
 * Arranca el reloj si el veredicto lo permite. Fail-closed: sin variable, sin
 * reloj; en producción, sin reloj y con una línea en el log que lo dice.
 */
export function startAccountMirror(env: NodeJS.ProcessEnv = process.env): void {
  const verdict = mirrorVerdict(env);
  if (verdict.ok === false) {
    if (verdict.reason !== 'not_configured') console.warn(`${TAG} no arranca: ${verdict.reason}`);
    return;
  }
  const tick = () => {
    void runAccountMirror({ env }).catch((e) => console.error(`${TAG} pasada programada falló: ${(e as Error).message}`));
  };
  // Primera pasada poco después del arranque, para que el preview no espere
  // al reloj; después, cada intervalo. 0 = solo a demanda.
  setTimeout(tick, 20_000).unref?.();
  if (verdict.everyMs > 0) {
    timer = setInterval(tick, verdict.everyMs);
    timer.unref?.();
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  }
  console.log(`${TAG} activo: origen ${new URL(verdict.sourceUrl).hostname}, cada ${verdict.everyMs > 0 ? `${Math.round(verdict.everyMs / 1000)} s` : 'solo a demanda'}, ámbito ${mirrorScope(env).kind}`);
}
