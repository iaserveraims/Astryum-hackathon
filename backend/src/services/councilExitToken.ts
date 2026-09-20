/**
 * councilExitToken — the exit classification that TRAVELS with a council tx.
 *
 * `POST /api/xrpl-defi/council-order/prepare` knows what it composed: a `recall`
 * or an `evacuate` only brings capital back into the vault's buffer, so it is
 * flag-only («LA SALIDA JAMÁS SE GATEA»). But a Legacy council never signs from
 * there — it signs through `POST /multisign/prepare`, which pins ANY `xrplTx`
 * from the body and cannot tell a recall from an entry. So it stayed geofenced,
 * and a Legacy recall/evacuate was still impossible from a blocked region (or
 * under an allowlist, since the client sends no region).
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto';

/** Lazy: the exit predicates below are imported statically by both routers; the MAC secret only when a token is minted or checked. */
function resolveJwtSecret(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (require('./SiweAuth') as typeof import('./SiweAuth')).resolveJwtSecret();
}

export const COUNCIL_EXIT_TOKEN_TTL_MS = 15 * 60_000;

/**
 * THE ONE EXIT CLASSIFICATION of council ORDERS. `recall`
 * brings capital out of a venue back into the buffer; `evacuate` brings everything
 * recoverable out of a venue. Both only REDUCE exposure. Shared by every door that
 * decides a gate by action: `/pote-council-order`, `/cage-order` (institutional.ts)
 * and `/council-order` + `/multisign/prepare` (xrplDefi.ts) — one set, no copies
 * that drift.
 */
export const COUNCIL_ORDER_EXIT_ACTIONS: ReadonlySet<string> = new Set(['recall', 'evacuate']);

/** Back-compat name: the council-order exits the token was first minted for. */
export const COUNCIL_EXIT_TOKEN_ACTIONS: ReadonlySet<string> = COUNCIL_ORDER_EXIT_ACTIONS;

export function isCouncilOrderExitAction(action: unknown): boolean {
  return typeof action === 'string' && COUNCIL_ORDER_EXIT_ACTIONS.has(action);
}

/**
 * The 0xFE handoff labels (`buildDirectMintHandoff({ action })`) that are EXITS:
 * the batch only takes capital OUT of a pote / vault / Personal Account back to its
 * holder. Anything else — every entry (`pa-fxrp-entry:*`, `astryum-pote-create`,
 * `legacy-vault-fund`, `astryum-cage-create`…), a repay, a rotation, an unknown or
 * missing label — is NOT an exit and keeps the full gate.
 */
const HANDOFF_EXIT_ACTIONS: ReadonlySet<string> = new Set([
  'astryum-pote-exit',
  'astryum-pote-exit-fxrp',
  'astryum-pote-request-exit',
  'astryum-pote-claim-exit',
  'astryum-pote-claim-exit-fxrp',
  'astryum-creator-exit',
  'pa-unmint',
  'vault-withdraw',
  'vault-claim',
  'legacy-yield-claim',
]);
const HANDOFF_EXIT_PREFIXES: readonly string[] = ['pa-withdraw-transfer:', 'pa-withdraw-keep:', 'vault-withdraw:'];

export function isHandoffExitAction(action: unknown): boolean {
  if (typeof action !== 'string' || !action) return false;
  return HANDOFF_EXIT_ACTIONS.has(action) || HANDOFF_EXIT_PREFIXES.some((p) => action.startsWith(p));
}

/** An exit of either kind — the only actions an exit token can carry. */
export function isExitAction(action: unknown): boolean {
  return isCouncilOrderExitAction(action) || isHandoffExitAction(action);
}

/**
 * Fields `prepareCouncilMultisig` OVERWRITES when it pins the tx. They cannot
 * change what the council signs (the coordinator replaces them), so they are
 * left out of the hash — everything else must be byte-for-byte the composed tx.
 */
const PINNED_BY_COORDINATOR: ReadonlySet<string> = new Set(['Sequence', 'Fee', 'SigningPubKey']);

const DOMAIN = 'astryum:council-exit-token:v1';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** sha256 (hex) of the canonical JSON of the tx, minus the coordinator-pinned fields. */
export function councilTxHash(xrplTx: Record<string, unknown>): string {
  const unpinned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(xrplTx)) {
    if (!PINNED_BY_COORDINATOR.has(k)) unpinned[k] = v;
  }
  return createHash('sha256').update(canonicalJson(unpinned)).digest('hex');
}

function macKey(): Buffer {
  return createHmac('sha256', resolveJwtSecret()).update(DOMAIN).digest();
}

function mac(payloadB64: string): Buffer {
  return createHmac('sha256', macKey()).update(payloadB64).digest();
}

interface ExitTokenPayload {
  v: 1;
  account: string;
  txHash: string;
  action: string;
  exp: number;
}

export function issueCouncilExitToken(input: {
  account: string;
  xrplTx: Record<string, unknown>;
  action: string;
  nowMs?: number;
}): { exitToken: string; exitTokenExpiresAt: string } {
  if (!isExitAction(input.action)) {
    throw new Error(`council exit token: ${input.action} is not an exit action`);
  }
  const exp = (input.nowMs ?? Date.now()) + COUNCIL_EXIT_TOKEN_TTL_MS;
  const payload: ExitTokenPayload = {
    v: 1,
    account: input.account,
    txHash: councilTxHash(input.xrplTx),
    action: input.action,
    exp,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return {
    exitToken: `${payloadB64}.${mac(payloadB64).toString('base64url')}`,
    exitTokenExpiresAt: new Date(exp).toISOString(),
  };
}

export type ExitTokenVerdict =
  | { ok: true; action: string }
  | { ok: false; reason: 'absent' | 'malformed' | 'bad-signature' | 'expired' | 'other-account' | 'other-tx' | 'not-an-exit' };

/** Does `token` open the exit gate for THIS account and THESE bytes, now? Never throws. */
export function verifyCouncilExitToken(
  token: unknown,
  target: { account: unknown; xrplTx: unknown },
  nowMs: number = Date.now(),
): ExitTokenVerdict {
  if (token === undefined || token === null || token === '') return { ok: false, reason: 'absent' };
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  let presented: Buffer;
  let expected: Buffer;
  try {
    presented = Buffer.from(parts[1], 'base64url');
    expected = mac(parts[0]);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return { ok: false, reason: 'bad-signature' };
  }
  let payload: ExitTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as ExitTokenPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (payload?.v !== 1 || typeof payload.exp !== 'number') return { ok: false, reason: 'malformed' };
  if (!isExitAction(payload.action)) return { ok: false, reason: 'not-an-exit' };
  if (payload.exp <= nowMs) return { ok: false, reason: 'expired' };
  if (typeof target.account !== 'string' || payload.account !== target.account.trim()) {
    return { ok: false, reason: 'other-account' };
  }
  if (!target.xrplTx || typeof target.xrplTx !== 'object' || Array.isArray(target.xrplTx)) {
    return { ok: false, reason: 'other-tx' };
  }
  if (payload.txHash !== councilTxHash(target.xrplTx as Record<string, unknown>)) {
    return { ok: false, reason: 'other-tx' };
  }
  return { ok: true, action: payload.action };
}

/* ── The server-side classification (finding 4.1) ─────── */

/**
 * The token travels only when the compose door and the ceremony share a browser
 * session and the 15 minutes have not passed. An institutional council's recall
 * (ExchangeDesk, OperatorConsole) or a creator exit reached `/multisign/prepare`
 * WITHOUT one — and, under an allowlist with no region, got 451 everywhere.
 */
export type ServerExitVerdict =
  | { ok: true; source: 'composed-order' | 'handoff'; action: string }
  | {
      ok: false;
      reason:
        | 'not-a-payment'
        | 'no-single-memo'
        | 'unknown-memo'
        | 'other-account'
        | 'not-an-exit'
        | 'bytes-mismatch'
        | 'destination-mismatch'
        | 'amount-mismatch'
        /**
         * The memo names an EXIT of this account whose 0xFE is
         * no longer waiting for a signature (superseded, already executed, parked).
         * This is not a region and not an unknown memo: the exit is real, THIS
         * payment is stale, and the answer must say so (409) instead of 451.
         */
        | 'handoff-not-signable'
        | 'unreadable';
      /** A readable line for the person: what happened and what to do. */
      detail?: string;
      handoffStatus?: string;
    };

export interface ServerExitDeps {
  readComposedOrder?: (memoHex: string) => Promise<{
    council: string;
    orderData: string;
    action: string;
    destination?: string;
    amount?: string;
  } | null>;
  readHandoff?: (memoHex: string) => Promise<{
    xrplAddress: string;
    action?: string | null;
    grossXrpDrops: string;
  } | null>;
  /**
   * The same handoff in ANY state (queued, superseded, completed, parked).
   * STRICT — a database failure THROWS, so «could not read» is never «unknown memo».
   */
  readHandoffAnyState?: (memoHex: string) => Promise<{
    xrplAddress: string;
    action?: string | null;
    grossXrpDrops: string;
    status: string;
  } | null>;
  /** The XRPL Destination every 0xFE mint pays (the Core Vault). */
  readMintDestination?: () => Promise<string | null>;
}

/**
 * THE SHAPE OF A MEMO THIS CLASSIFIER CAN LOOK UP. Same range as `zeroFeMemoOf`
 * (routes/xrplDefi.ts) and as the `/multisign/release` schema, on purpose: three
 * readings of the SAME memo that disagree is how this bug happened.
 */
const LOOKUPABLE_MEMO_HEX = /^[0-9A-F]{8,2048}$/;

/**
 * THE ONE MEMO of a tx, normalised to uppercase hex — WHATEVER SHAPE IT HAS.
 *
 * ── THIS READER DEMANDED 64 HEX, SO THE EXIT
 *    CLASSIFICATION NEVER RAN IN PRODUCTION ─────────────────────────────────
 */
export function singleMemoHex(tx: unknown): string | null {
  const memos = (tx as { Memos?: unknown } | null)?.Memos;
  if (!Array.isArray(memos) || memos.length !== 1) return null;
  const data = (memos[0] as { Memo?: { MemoData?: unknown } } | null)?.Memo?.MemoData;
  if (typeof data !== 'string') return null;
  const hex = data.trim().replace(/^0x/i, '').toUpperCase();
  return LOOKUPABLE_MEMO_HEX.test(hex) ? hex : null;
}

/** An XRPL Amount as a comparable string: drops verbatim, an IOU object canonically. */
export function canonicalXrplAmount(amount: unknown): string | null {
  if (typeof amount === 'string') return amount;
  if (amount && typeof amount === 'object' && !Array.isArray(amount)) return canonicalJson(amount);
  return null;
}

const MINT_DESTINATION_READ_TIMEOUT_MS = 10_000;

const defaultServerExitDeps: Required<ServerExitDeps> = {
  readComposedOrder: async (memoHex) => {
    const { getComposedCouncilOrderStrict } = await import('./flare/ComposedCouncilOrderStore');
    return getComposedCouncilOrderStrict(memoHex);
  },
  readHandoff: async (memoHex) => {
    const { findQueuedHandoffByMemo } = await import('./flare/DirectMintHandoffStore');
    return findQueuedHandoffByMemo(memoHex);
  },
  /**
   * The handoff row whatever its state, read STRICTLY off `background_jobs` (the
   * store's own reads are queued-only and swallow database errors — which is how a
   * superseded exit became «unknown memo» and then a 451 about the user's REGION).
   * Newest row wins; a 'queued' one is preferred, so a race with the queued read
   * never downgrades a signable exit.
   */
  readHandoffAnyState: async (memoHex) => {
    const memo = typeof memoHex === 'string' ? memoHex.trim().replace(/^0x/i, '') : '';
    if (!memo || !process.env.DATABASE_URL) return null;
    const { prisma } = await import('../database/prismaClient');
    const rows = await prisma.backgroundJob.findMany({
      where: {
        jobType: '0xfe-handoff',
        OR: [
          { payload: { path: ['memoHex'], equals: memo.toUpperCase() } },
          { payload: { path: ['memoHex'], equals: memo.toLowerCase() } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { payload: true, status: true },
    });
    const shaped = rows
      .map((row) => {
        const p = (row.payload ?? {}) as { xrplAddress?: unknown; action?: unknown; grossXrpDrops?: unknown };
        if (typeof p.xrplAddress !== 'string') return null;
        return {
          xrplAddress: p.xrplAddress,
          action: typeof p.action === 'string' ? p.action : null,
          grossXrpDrops: String(p.grossXrpDrops ?? ''),
          status: String(row.status ?? ''),
        };
      })
      .filter((r): r is { xrplAddress: string; action: string | null; grossXrpDrops: string; status: string } => r !== null);
    return shaped.find((r) => r.status === 'queued') ?? shaped[0] ?? null;
  },
  readMintDestination: async () => {
    const { readDirectMintParams } = await import('../connectors/protocols/flare/FlareDirectMintService');
    const { flareReadProvider } = await import('./flare/flareProvider');
    const rpc = process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc';
    const read = readDirectMintParams(flareReadProvider(rpc)).then((p) => p.paymentAddress);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), MINT_DESTINATION_READ_TIMEOUT_MS).unref?.());
    return (await Promise.race([read, timeout])) ?? null;
  },
};

/**
 * THE CLASSIFIER IS AN ORACLE OVER OTHER
 * PEOPLE'S MEMOS, AND IT WAS ANSWERING EVERYONE.
 */
export const GENERIC_PREPARE_REFUSAL = {
  error: 'CANNOT_PREPARE_HERE',
  detail:
    'This transaction cannot be prepared here. If it is yours, open it from the screen that composed it — signed in ' +
    'with the wallet that holds this account, or with one of its council seats — and the reason will be shown there.',
} as const;

export async function classifyCouncilExitByMemo(
  target: { account: unknown; xrplTx: unknown },
  deps: ServerExitDeps = {},
): Promise<ServerExitVerdict> {
  const d = { ...defaultServerExitDeps, ...deps };
  const account = typeof target.account === 'string' ? target.account.trim() : '';
  const tx = target.xrplTx as Record<string, unknown> | null;
  if (!account || !tx || typeof tx !== 'object' || Array.isArray(tx) || tx.TransactionType !== 'Payment') {
    return { ok: false, reason: 'not-a-payment' };
  }
  if (tx.Account !== undefined && tx.Account !== account) return { ok: false, reason: 'other-account' };
  const memoHex = singleMemoHex(tx);
  if (!memoHex) return { ok: false, reason: 'no-single-memo' };

  let unreadable = false;

  let order: Awaited<ReturnType<Required<ServerExitDeps>['readComposedOrder']>> = null;
  try {
    order = await d.readComposedOrder(memoHex);
  } catch {
    unreadable = true;
  }
  if (order) {
    if (order.council !== account) return { ok: false, reason: 'other-account' };
    const { ethers } = await import('ethers');
    let hashed = '';
    try {
      hashed = ethers.keccak256(order.orderData).slice(2).toUpperCase();
    } catch {
      /* not hex: cannot be the committed bytes */
    }
    if (hashed !== memoHex) return { ok: false, reason: 'bytes-mismatch' };
    if (!isCouncilOrderExitAction(order.action)) return { ok: false, reason: 'not-an-exit' };
    if (!order.destination || order.destination !== tx.Destination) return { ok: false, reason: 'destination-mismatch' };
    if (!order.amount || order.amount !== canonicalXrplAmount(tx.Amount)) return { ok: false, reason: 'amount-mismatch' };
    return { ok: true, source: 'composed-order', action: order.action };
  }

  let handoff: Awaited<ReturnType<Required<ServerExitDeps>['readHandoff']>> = null;
  try {
    handoff = await d.readHandoff(memoHex);
  } catch {
    unreadable = true;
  }
  // No queued row is not «no handoff». The same memo may name
  // one that was superseded, already executed or parked — a REAL exit of this
  // account whose payment is simply stale. Read STRICTLY (a database failure throws)
  // so the answer is «I could not read», never «I do not know this memo».
  let staleHandoff: Awaited<ReturnType<Required<ServerExitDeps>['readHandoffAnyState']>> = null;
  if (!handoff) {
    try {
      staleHandoff = await d.readHandoffAnyState(memoHex);
    } catch {
      unreadable = true;
    }
    if (staleHandoff && staleHandoff.status === 'queued') {
      handoff = { xrplAddress: staleHandoff.xrplAddress, action: staleHandoff.action, grossXrpDrops: staleHandoff.grossXrpDrops };
      staleHandoff = null;
    }
  }
  if (handoff) {
    if (handoff.xrplAddress !== account) return { ok: false, reason: 'other-account' };
    if (!isHandoffExitAction(handoff.action)) return { ok: false, reason: 'not-an-exit' };
    if (canonicalXrplAmount(tx.Amount) !== String(handoff.grossXrpDrops)) return { ok: false, reason: 'amount-mismatch' };
    let destination: string | null = null;
    try {
      destination = await d.readMintDestination();
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
    if (!destination) return { ok: false, reason: 'unreadable' };
    if (destination !== tx.Destination) return { ok: false, reason: 'destination-mismatch' };
    return { ok: true, source: 'handoff', action: String(handoff.action) };
  }

  if (staleHandoff) {
    if (staleHandoff.xrplAddress !== account) return { ok: false, reason: 'other-account' };
    if (!isHandoffExitAction(staleHandoff.action)) return { ok: false, reason: 'not-an-exit' };
    const what =
      staleHandoff.status === 'superseded'
        ? 'was superseded by a newer preparation of the same exit'
        : staleHandoff.status === 'completed'
          ? 'already went through (it has been executed)'
          : `is no longer waiting for a signature (state: ${staleHandoff.status || 'unknown'})`;
    return {
      ok: false,
      reason: 'handoff-not-signable',
      handoffStatus: staleHandoff.status,
      detail:
        `This exit's 0xFE ${what}, so this payment can no longer be signed — signing it now would spend the carrier ` +
        'without moving anything. Prepare the exit again from the same screen; nothing has been lost. This has nothing ' +
        'to do with your region: an exit is never refused for where you are.',
    };
  }

  return { ok: false, reason: unreadable ? 'unreadable' : 'unknown-memo' };
}
