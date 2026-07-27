/**
 * XrplActivityService — the XRPL rail of the Activity timeline.
 *
 * The EVM rail (ActivityService) reads Flarescan and caches in the DB; XRPL
 * needs neither: one `account_tx` call returns the classified history straight
 * from the ledger, so this service reads live over HTTPS JSON-RPC (same
 * endpoint fallbacks as XRPLProvider) with a short in-process cache.
 *
 * Read-only by construction — it only ever issues `account_tx`.
 */
import { randomUUID } from 'crypto';
import type { ActivityType, CanonicalActivityEvent } from '../canonical/types/ActivityEvent';

function httpsify(url: string): string {
  return url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

const XRPL_HTTP_URLS: string[] = [
  ...(process.env.XRPL_RPC_URL ? [httpsify(process.env.XRPL_RPC_URL)] : []),
  ...(process.env.XRPL_WS_URL ? [httpsify(process.env.XRPL_WS_URL)] : []),
  'https://xrplcluster.com',
  'https://s1.ripple.com:51234',
].filter((v, i, a) => /^https?:\/\//.test(v) && a.indexOf(v) === i);

// XRPL `date` fields count seconds since the Ripple epoch (2000-01-01T00:00Z).
const RIPPLE_EPOCH_UNIX = 946_684_800;

/** TransactionType → canonical ActivityType. Everything unknown lands in 'other'. */
const TX_TYPE_MAP: Record<string, { type: ActivityType; protocol?: string }> = {
  Payment: { type: 'transfer' },
  OfferCreate: { type: 'swap', protocol: 'XRPL DEX' },
  OfferCancel: { type: 'other', protocol: 'XRPL DEX' },
  AMMDeposit: { type: 'addLiquidity', protocol: 'XRPL AMM' },
  AMMWithdraw: { type: 'removeLiquidity', protocol: 'XRPL AMM' },
  AMMCreate: { type: 'addLiquidity', protocol: 'XRPL AMM' },
  EscrowCreate: { type: 'supply', protocol: 'XRPL Escrow' },
  EscrowFinish: { type: 'withdraw', protocol: 'XRPL Escrow' },
  EscrowCancel: { type: 'withdraw', protocol: 'XRPL Escrow' },
  CheckCreate: { type: 'transfer', protocol: 'XRPL Check' },
  CheckCash: { type: 'transfer', protocol: 'XRPL Check' },
  TrustSet: { type: 'approve' },
};

/** One entry of the account_tx response. rippled api_version 1 nests the
 *  transaction under `tx`; api_version 2 uses `tx_json` with `hash` at the
 *  item level. Both are handled. */
export interface AccountTxItem {
  tx?: Record<string, unknown>;
  tx_json?: Record<string, unknown>;
  hash?: string;
  meta?: { TransactionResult?: string } | string;
  validated?: boolean;
  close_time_iso?: string;
}

export function xrplTxToCanonical(wallet: string, item: AccountTxItem): CanonicalActivityEvent | null {
  const tx = item.tx ?? item.tx_json;
  if (!tx) return null;
  // Only validated, successful transactions — the timeline is history, not intent.
  if (item.validated === false) return null;
  const result = typeof item.meta === 'object' ? item.meta?.TransactionResult : undefined;
  if (result && result !== 'tesSUCCESS') return null;

  const hash = (item.hash ?? tx.hash) as string | undefined;
  if (!hash) return null;

  const ledgerIndex = Number(tx.ledger_index ?? 0) || 0;
  const rippleDate = typeof tx.date === 'number' ? tx.date : null;
  const timestamp = item.close_time_iso
    ? new Date(item.close_time_iso).toISOString()
    : rippleDate != null
      ? new Date((rippleDate + RIPPLE_EPOCH_UNIX) * 1000).toISOString()
      : new Date(0).toISOString();

  const mapped = TX_TYPE_MAP[String(tx.TransactionType)] ?? { type: 'other' as ActivityType };

  return {
    id: hash,
    wallet,
    txHash: hash,
    blockNumber: ledgerIndex,
    timestamp,
    type: mapped.type,
    protocol: mapped.protocol,
    source: {
      providerId: 'xrpl-jsonrpc',
      providerType: 'chain',
      trustLevel: 'onchain_verified',
      fetchedAt: new Date().toISOString(),
      traceId: randomUUID(),
    },
  };
}

interface TimelineOptions {
  types?: ActivityType[];
  limit?: number;
  offset?: number;
}

const CACHE_TTL_MS = 45_000;

export class XrplActivityService {
  private cache = new Map<string, { at: number; events: CanonicalActivityEvent[] }>();

  async getTimeline(wallet: string, opts: TimelineOptions = {}): Promise<CanonicalActivityEvent[]> {
    const events = await this.fetchAll(wallet);
    const typed = opts.types?.length ? events.filter((e) => opts.types!.includes(e.type)) : events;
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 200;
    return typed.slice(offset, offset + limit);
  }

  private async fetchAll(wallet: string): Promise<CanonicalActivityEvent[]> {
    const hit = this.cache.get(wallet);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.events;

    const result = await this.accountTx(wallet);
    const items = Array.isArray(result?.transactions) ? result.transactions : [];
    const events = items
      .map((item) => xrplTxToCanonical(wallet, item))
      .filter((e): e is CanonicalActivityEvent => e !== null)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    this.cache.set(wallet, { at: Date.now(), events });
    return events;
  }

  private async accountTx(wallet: string): Promise<{ transactions?: AccountTxItem[] } | null> {
    let lastErr: unknown = new Error('xrpl_activity_unreachable');
    for (const url of XRPL_HTTP_URLS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'account_tx',
            params: [
              {
                account: wallet,
                ledger_index_min: -1,
                ledger_index_max: -1,
                limit: 200,
                forward: false,
              },
            ],
          }),
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) {
          lastErr = new Error(`xrpl_http_${res.status}`);
          continue;
        }
        const body = (await res.json()) as {
          result?: { status?: string; error?: string; transactions?: AccountTxItem[] };
        };
        const result = body.result;
        if (!result) {
          lastErr = new Error('xrpl_http_empty_result');
          continue;
        }
        if (result.status === 'error') {
          // A ledger error (actNotFound…) is a real answer: empty history.
          if (result.error === 'actNotFound') return { transactions: [] };
          lastErr = new Error(result.error ?? 'xrpl_rpc_error');
          continue;
        }
        return result;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }
}

export const xrplActivityService = new XrplActivityService();
