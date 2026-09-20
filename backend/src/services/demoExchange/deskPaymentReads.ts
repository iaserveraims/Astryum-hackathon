/**
 * deskPaymentReads — the non-account_tx reads the desk-payment proof and the
 * put-to-work record need, apart so tests can replace them. Read-only. Every one
 * THROWS on a transport / database failure: the caller turns «could not read»
 * into «do not release / do not record», never into «absent».
 */

import { ethers } from 'ethers';
import { flareProvider } from './DemoRunVerifier';

const MAC_ABI = ['function isTransactionIdUsed(bytes32) view returns (bool)'];
const HANDOFF_JOB_TYPE = '0xfe-handoff';

/** MasterAccountController.isTransactionIdUsed(xrplHash): the 0xFE executed on Flare. Throws when unreadable. */
export async function mintExecutedOnFlare(xrplHash: string): Promise<boolean> {
  const provider = flareProvider();
  const { resolveMasterAccountController } = await import('../../connectors/protocols/flare/FlareSmartAccountService');
  const mac = new ethers.Contract(await resolveMasterAccountController(provider), MAC_ABI, provider);
  return Boolean(await mac.isTransactionIdUsed('0x' + xrplHash.replace(/^0x/i, '').toLowerCase()));
}

export interface OmnibusHandoff {
  memoHex: string;
  userOpHash: string;
  grossXrpDrops: string;
  userOpData: string;
  /** The XRPL account the 0xFE was built for (its signer pin). */
  xrplAddress: string;
  personalAccount?: string;
  action?: string | null;
  signedAt?: string | null;
  signedTxHash?: string | null;
  /**
   * The XRPL ledger after which this 0xFE Payment can never enter a ledger (the
   * builder stamps it, it. 15 §K1). It is the PHYSICS of the reservation: while
   * it is ahead, the payment is still signable and nothing may be released
   * (`putToWorkWindow` → `wait`). null = the row was composed without one (an
   * unreadable ledger, or a row older than it. 15) — then the old TTL rule
   * governs and the window falls back to its search bound.
   */
  lastLedgerSequence?: number | null;
  status: string;
  createdAt: string;
}

/**
 * The hand-off that committed THIS memo (the server-side copy every
 * `buildDirectMintHandoff` persists). Read by memo — never a time-window list
 * capped at N rows, which read a busy omnibus as «no hand-off» (it. 10). STRICT:
 * a database error throws. Without DATABASE_URL there is no store: null.
 */
export async function findHandoffByMemo(memoHex: string): Promise<OmnibusHandoff | null> {
  const memo = String(memoHex ?? '').replace(/^0x/i, '');
  if (!process.env.DATABASE_URL || !memo) return null;
  const { prisma } = await import('../../database/prismaClient');
  // build0xFEMemo emits uppercase hex; a row written by an older builder may not.
  const rows = await prisma.backgroundJob.findMany({
    where: {
      jobType: HANDOFF_JOB_TYPE,
      OR: [{ payload: { path: ['memoHex'], equals: memo.toUpperCase() } }, { payload: { path: ['memoHex'], equals: memo.toLowerCase() } }],
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });
  const r = rows[0];
  if (!r) return null;
  const p = (r.payload ?? {}) as Record<string, unknown>;
  return {
    memoHex: String(p.memoHex ?? '').toUpperCase(),
    userOpHash: String(p.userOpHash ?? '').toLowerCase(),
    grossXrpDrops: String(p.grossXrpDrops ?? ''),
    userOpData: String(p.userOpData ?? ''),
    xrplAddress: String(p.xrplAddress ?? ''),
    personalAccount: typeof p.personalAccount === 'string' ? p.personalAccount : undefined,
    action: (p.action as string | null | undefined) ?? null,
    signedAt: typeof p.signedAt === 'string' ? p.signedAt : null,
    signedTxHash: typeof p.signedTxHash === 'string' ? p.signedTxHash : null,
    lastLedgerSequence: Number.isInteger(p.lastLedgerSequence) && Number(p.lastLedgerSequence) > 0 ? Number(p.lastLedgerSequence) : null,
    status: String(r.status ?? ''),
    createdAt: r.createdAt.toISOString(),
  };
}

/** The facts of one XRPL transaction, as the ledger states them. */
export type ReportedTx =
  | { found: false }
  | {
      found: true;
      hash: string;
      validated: boolean;
      result: string;
      type: string;
      account: string;
      destination?: string;
      /** Delivered XRP in drops (undefined for an issued-currency amount). */
      drops?: string;
      /** First memo, hex upper. */
      memoHex?: string;
      ledgerIndex?: number;
    };

/** One transaction by hash. `txnNotFound` → {found:false}; any other failure THROWS. */
export async function readXrplTx(hash: string): Promise<ReportedTx> {
  const { xrplJsonRpc } = await import('../flare/DirectMintExecutorService');
  let r: Record<string, unknown>;
  try {
    r = (await xrplJsonRpc('tx', { transaction: hash, binary: false })) as Record<string, unknown>;
  } catch (e) {
    if (/txnNotFound/i.test((e as Error).message)) return { found: false };
    throw e;
  }
  const tx = (r.tx_json ?? r) as Record<string, unknown>;
  const meta = r.meta as { TransactionResult?: string; delivered_amount?: unknown } | undefined;
  const memos = (tx.Memos as Array<{ Memo?: { MemoData?: string } }>) ?? [];
  const amount = (meta?.delivered_amount ?? tx.DeliverMax ?? tx.Amount) as unknown;
  const li = Number(r.ledger_index ?? tx.ledger_index ?? NaN);
  return {
    found: true,
    hash: String(r.hash ?? tx.hash ?? hash).toUpperCase(),
    validated: r.validated === true,
    result: meta?.TransactionResult ?? 'unknown',
    type: String(tx.TransactionType ?? ''),
    account: String(tx.Account ?? ''),
    destination: tx.Destination ? String(tx.Destination) : undefined,
    drops: typeof amount === 'string' ? amount : undefined,
    memoHex: memos[0]?.Memo?.MemoData ? String(memos[0].Memo.MemoData).toUpperCase() : undefined,
    ledgerIndex: Number.isFinite(li) && li > 0 ? li : undefined,
  };
}

/** The FAssets Core Vault XRPL address (direct-minting payment address), read live. Throws when unreadable. */
export async function readCoreVaultAddress(): Promise<string> {
  const { readDirectMintParams } = await import('../../connectors/protocols/flare/FlareDirectMintService');
  return (await readDirectMintParams(flareProvider())).paymentAddress;
}
