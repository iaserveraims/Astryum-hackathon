import { randomUUID } from 'crypto';
import { prisma } from '../database/prismaClient';
import { controlPlane as defaultControlPlane, ControlPlane } from '../control-plane/ControlPlane';
import type {
  CanonicalActivityEvent,
  ActivityType,
} from '../canonical/types/ActivityEvent';
import type { SourceRecord } from '../canonical/types/Source';

interface FlarescanTx {
  hash?: string;
  blockNumber?: string | number;
  timeStamp?: string | number;
  to?: string;
  from?: string;
  input?: string;
  value?: string;
  contractAddress?: string;
  /** Etherscan/Flarescan txlist result codes: isError='1' or
   *  txreceipt_status='0' means the tx REVERTED (mined, has a receipt, did
   *  nothing). Carried so the timeline never renders a revert as a done action. */
  isError?: string | number;
  txreceipt_status?: string | number;
}

interface FlarescanTokenTx {
  hash?: string;
  blockNumber?: string | number;
  timeStamp?: string | number;
  contractAddress?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  to?: string;
  from?: string;
  value?: string;
}

export interface GetTimelineOptions {
  readonly from?: Date;
  readonly to?: Date;
  readonly types?: ReadonlyArray<ActivityType>;
  readonly limit?: number;
  readonly offset?: number;
  /** When true, force a Flarescan refresh and upsert into cache. Default false (cache-first). */
  readonly forceRefresh?: boolean;
}

/**
 * V1.1 Activity Timeline. Canonical-shaped events for a wallet, sourced from
 * the Flarescan explorer provider with selector-based classification, cached
 * in Prisma `ActivityEvent` for fast subsequent reads.
 *
 * Replaces the Prisma/Use-Your-Spark integration that we deliberately did NOT
 * adopt (no public API). See `docs/PRISMA_INTEGRATION_RESEARCH.md`.
 */
export class ActivityService {
  constructor(private readonly cp: ControlPlane = defaultControlPlane) {}

  async getTimeline(
    wallet: string,
    opts: GetTimelineOptions = {},
  ): Promise<CanonicalActivityEvent[]> {
    if (!wallet) return [];

    if (opts.forceRefresh) {
      await this.refreshFromExplorer(wallet).catch((err) =>
        console.warn(`[activity] refresh failed: ${(err as Error).message}`),
      );
    }

    const cached = await this.readCache(wallet, opts);
    if (cached.length > 0 || !opts.forceRefresh) {
      // If cache empty and we haven't refreshed, refresh once before returning.
      if (cached.length === 0 && !opts.forceRefresh) {
        await this.refreshFromExplorer(wallet).catch((err) =>
          console.warn(`[activity] refresh failed: ${(err as Error).message}`),
        );
        return this.readCache(wallet, opts);
      }
      return cached;
    }
    return cached;
  }

  /**
   * Pulls latest txs and token transfers from Flarescan, classifies into
   * `ActivityType`, and upserts to cache. Idempotent on `(wallet, txHash, logIndex)`.
   */
  async refreshFromExplorer(wallet: string): Promise<number> {
    const traceId = randomUUID();
    const [txs, transfers] = await Promise.allSettled([
      this.cp.call<{ address: string }, FlarescanTx[]>(
        'explorer.getActivity',
        { address: wallet },
        { traceId },
      ),
      this.cp.call<{ address: string }, FlarescanTokenTx[]>(
        'explorer.getTokenTransfers',
        { address: wallet },
        { traceId },
      ),
    ]);

    let written = 0;
    if (txs.status === 'fulfilled') {
      for (const tx of txs.value.data ?? []) {
        const ev = txToCanonical(wallet, tx, txs.value.source);
        if (!ev) continue;
        await this.upsert(ev).then(() => written++).catch(() => undefined);
      }
    }
    if (transfers.status === 'fulfilled') {
      for (const tt of transfers.value.data ?? []) {
        const ev = transferToCanonical(wallet, tt, transfers.value.source);
        if (!ev) continue;
        await this.upsert(ev).then(() => written++).catch(() => undefined);
      }
    }
    return written;
  }

  private async readCache(
    wallet: string,
    opts: GetTimelineOptions,
  ): Promise<CanonicalActivityEvent[]> {
    try {
      const rows = await prisma.activityEvent.findMany({
        where: {
          wallet: wallet.toLowerCase(),
          ...(opts.from || opts.to
            ? {
                timestamp: {
                  ...(opts.from ? { gte: opts.from } : {}),
                  ...(opts.to ? { lte: opts.to } : {}),
                },
              }
            : {}),
          ...(opts.types && opts.types.length > 0
            ? { type: { in: [...opts.types] } }
            : {}),
        },
        orderBy: { timestamp: 'desc' },
        take: opts.limit ?? 100,
        skip: opts.offset ?? 0,
      });
      return rows.map(rowToCanonical);
    } catch (err) {
      console.warn(`[activity] cache read failed: ${(err as Error).message}`);
      return [];
    }
  }

  private async upsert(ev: CanonicalActivityEvent): Promise<void> {
    const logIndex = parseLogIndex(ev.id);
    await prisma.activityEvent.upsert({
      where: {
        wallet_txHash_logIndex: {
          wallet: ev.wallet.toLowerCase(),
          txHash: ev.txHash.toLowerCase(),
          logIndex,
        },
      },
      update: {
        type: ev.type,
        protocol: ev.protocol,
        assetIn: ev.assetIn ? (ev.assetIn as unknown as object) : undefined,
        assetOut: ev.assetOut ? (ev.assetOut as unknown as object) : undefined,
        source: ev.source as unknown as object,
      },
      create: {
        wallet: ev.wallet.toLowerCase(),
        chainId: 14,
        txHash: ev.txHash.toLowerCase(),
        logIndex,
        blockNumber: ev.blockNumber,
        timestamp: new Date(ev.timestamp),
        type: ev.type,
        protocol: ev.protocol,
        assetIn: ev.assetIn ? (ev.assetIn as unknown as object) : undefined,
        assetOut: ev.assetOut ? (ev.assetOut as unknown as object) : undefined,
        source: ev.source as unknown as object,
      },
    });
  }
}

const SELECTOR_TO_TYPE: ReadonlyMap<string, ActivityType> = new Map([
  ['0xa0712d68', 'supply'], // mint(uint256) Compound
  ['0xdb006a75', 'withdraw'], // redeem(uint256)
  ['0x852a12e3', 'withdraw'], // redeemUnderlying(uint256)
  ['0xc5ebeaec', 'borrow'], // borrow(uint256)
  ['0x0e752702', 'repay'], // repayBorrow(uint256)
  ['0xd0e30db0', 'supply'], // deposit() WFLR
  ['0x2e1a7d4d', 'withdraw'], // withdraw(uint256) WFLR
  ['0x6e553f65', 'stake'], // ERC-4626 deposit(uint256,address)
  ['0xba087652', 'unstake'], // ERC-4626 redeem(uint256,address,address)
  ['0x88c6df40', 'claim'], // FTSO claim
  ['0x026e402b', 'other'], // delegate
  ['0xa9059cbb', 'transfer'], // ERC-20 transfer
  ['0x095ea7b3', 'approve'], // ERC-20 approve
  ['0x88316456', 'addLiquidity'], // NFPM mint
  ['0x219f5d17', 'addLiquidity'], // NFPM increaseLiquidity
  ['0xfc6f7865', 'removeLiquidity'], // NFPM collect
  ['0x0c49ccbe', 'removeLiquidity'], // NFPM decreaseLiquidity
  ['0xe8e33700', 'addLiquidity'], // V2 addLiquidity
  ['0xbaa2abde', 'removeLiquidity'], // V2 removeLiquidity
]);

function txToCanonical(
  wallet: string,
  tx: FlarescanTx,
  source: SourceRecord,
): CanonicalActivityEvent | null {
  if (!tx.hash || !tx.timeStamp) return null;
  // Result-code guard (bug family "lectura ciega al código de resultado"): a
  // reverted borrow()/supply() is mined and has a receipt but did NOTHING —
  // Flarescan flags it isError='1' / txreceipt_status='0'. It must not render as
  // a completed action. Sibling rails already guard (ChainExplorerProvider drops
  // isError; XrplActivityService checks tesSUCCESS); the Flarescan rail did not.
  if (String(tx.isError) === '1' || String(tx.txreceipt_status) === '0') return null;
  const input = (tx.input ?? '0x').toLowerCase();
  const sel = input.length >= 10 ? input.slice(0, 10) : '';
  const type: ActivityType = SELECTOR_TO_TYPE.get(sel) ?? 'other';
  const ts = Number(tx.timeStamp);
  return {
    id: `${tx.hash}:0`,
    wallet: wallet.toLowerCase(),
    txHash: tx.hash.toLowerCase(),
    blockNumber: Number(tx.blockNumber ?? 0),
    timestamp: new Date(ts * 1000).toISOString(),
    type,
    source,
  };
}

function transferToCanonical(
  wallet: string,
  tt: FlarescanTokenTx,
  source: SourceRecord,
): CanonicalActivityEvent | null {
  if (!tt.hash || !tt.timeStamp) return null;
  const ts = Number(tt.timeStamp);
  const isOutbound = (tt.from ?? '').toLowerCase() === wallet.toLowerCase();
  return {
    id: `${tt.hash}:erc20:${tt.contractAddress ?? '0x'}`,
    wallet: wallet.toLowerCase(),
    txHash: tt.hash.toLowerCase(),
    blockNumber: Number(tt.blockNumber ?? 0),
    timestamp: new Date(ts * 1000).toISOString(),
    type: 'transfer',
    protocol: undefined,
    assetIn: isOutbound
      ? undefined
      : ({
          asset: {
            symbol: tt.tokenSymbol ?? 'UNKNOWN',
            address: tt.contractAddress ?? '',
            chainId: 14,
            decimals: Number(tt.tokenDecimal ?? 18),
            priceUSD: null,
            source,
          },
          amount: tt.value ?? '0',
          amountUSD: 0,
        } as CanonicalActivityEvent['assetIn']),
    assetOut: isOutbound
      ? ({
          asset: {
            symbol: tt.tokenSymbol ?? 'UNKNOWN',
            address: tt.contractAddress ?? '',
            chainId: 14,
            decimals: Number(tt.tokenDecimal ?? 18),
            priceUSD: null,
            source,
          },
          amount: tt.value ?? '0',
          amountUSD: 0,
        } as CanonicalActivityEvent['assetOut'])
      : undefined,
    source,
  };
}

function rowToCanonical(row: {
  txHash: string;
  blockNumber: number;
  timestamp: Date;
  type: string;
  protocol: string | null;
  assetIn: unknown;
  assetOut: unknown;
  source: unknown;
  wallet: string;
  logIndex: number;
}): CanonicalActivityEvent {
  return {
    id: `${row.txHash}:${row.logIndex}`,
    wallet: row.wallet,
    txHash: row.txHash,
    blockNumber: row.blockNumber,
    timestamp: row.timestamp.toISOString(),
    type: row.type as ActivityType,
    protocol: row.protocol ?? undefined,
    assetIn: row.assetIn as CanonicalActivityEvent['assetIn'] | undefined,
    assetOut: row.assetOut as CanonicalActivityEvent['assetOut'] | undefined,
    source: row.source as SourceRecord,
  };
}

function parseLogIndex(id: string): number {
  const tail = id.split(':').slice(1).join(':');
  if (!tail) return 0;
  const n = Number(tail);
  return Number.isFinite(n) ? n : 0;
}

export const activityService = new ActivityService();
