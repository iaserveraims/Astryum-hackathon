/**
 * XrplBalanceProvider
 *
 * Reads native XRP + issued-currency (trust line) balances for an XRPL account
 * and returns them as CanonicalPosition[] so they flow through the same
 * SnapshotBuilder pipeline as EVM/Solana balances.
 *
 * Pricing: XRP via DeFiLlama (coingecko:ripple). Issued stablecoins (RLUSD and
 * USD-pegged) are valued ~$1; other issued currencies are left unpriced (they
 * fall below the $1 dust threshold and are omitted) until a reliable XRPL price
 * feed is wired.
 *
 * Read-only. Astryum never signs or broadcasts (CLAUDE.md §0).
 */

import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
} from '../../interfaces/IProvider';
import type { CanonicalPosition } from '../../../canonical/types/Position';
import { xrplProvider, XRPL_CHAIN_ID } from '../chain/XRPLProvider';

/** USD-pegged issued currencies we can value at ~$1 without an external feed. */
const STABLE_CURRENCIES = new Set(['RLUSD', 'USD', 'USDC', 'USDT']);

async function fetchXrpPrice(): Promise<number> {
  try {
    const res = await fetch('https://coins.llama.fi/prices/current/coingecko:ripple', {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as { coins?: Record<string, { price?: number }> };
    return data.coins?.['coingecko:ripple']?.price ?? 0;
  } catch {
    return 0;
  }
}

/** Decode an XRPL currency code: 3-char ISO is literal; 40-char hex is ASCII. */
function decodeCurrency(code: string): string {
  if (code.length === 3) return code;
  if (/^[0-9A-Fa-f]{40}$/.test(code)) {
    const hex = code.replace(/00+$/, '');
    let out = '';
    for (let i = 0; i < hex.length; i += 2) {
      const c = parseInt(hex.slice(i, i + 2), 16);
      if (c) out += String.fromCharCode(c);
    }
    return out || code;
  }
  return code;
}

const CAPS: ReadonlyArray<Capability> = ['portfolio.getPositions', 'portfolio.getTokenBalances'];

class XrplBalanceProvider implements IProvider {
  readonly id = 'xrpl-balance';
  readonly type = 'data' as const;
  readonly capabilities = CAPS;
  readonly trustLevel = 'onchain_verified' as const;
  readonly priority = 88;

  async health(): Promise<ProviderHealth> {
    return { status: 'healthy', lastCheckAt: new Date().toISOString() };
  }

  async call<TIn, TOut>(
    _capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    const wallet = (input as Record<string, unknown>).walletAddress as string;
    if (!wallet) throw new Error('walletAddress required');
    const positions = await this._fetch(wallet, ctx.traceId);
    const source = {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId: ctx.traceId,
    } as const;
    return { data: positions as unknown as TOut, source, cached: false };
  }

  private async _fetch(wallet: string, traceId: string): Promise<CanonicalPosition[]> {
    // Spendable XRP only: the ledger reserve (base + per-object) is LOCKED by
    // the protocol to keep the account alive — counting it as capital inflates
    // every total (the Wallets card already excludes it; the portfolio must
    // agree with it).
    // The cage read (LegacyVault, ~10 RPC calls behind a 60s cache) runs IN
    // PARALLEL with the account's own reads — it needs no price; the positions
    // are built afterwards. Serialising it made the council's Summary crawl.
    const { cageStateFor, buildCagePositions } = await import(
      '../../../services/flare/LegacyCagePositionsService'
    );
    const [balance, lines, defi, xrpPrice, cageState] = await Promise.all([
      xrplProvider.getSpendableBalance(wallet).catch(() => null),
      xrplProvider.getTokenBalances(wallet).catch(() => []),
      xrplProvider.getDeFiPositions(wallet).catch(() => []),
      fetchXrpPrice(),
      cageStateFor(wallet).catch(() => null),
    ]);

    const assetSource = {
      providerId: this.id,
      providerType: 'data' as const,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId,
    };

    const positions: CanonicalPosition[] = [];

    // Native XRP — spendable (reserve excluded)
    const xrpAmount = balance ? balance.spendableXrp : 0;
    const xrpUSD = xrpAmount * xrpPrice;
    if (xrpUSD >= 1) {
      positions.push({
        id: `xrpl:native:${wallet}`,
        wallet,
        chainId: XRPL_CHAIN_ID,
        protocol: 'wallet',
        kind: 'free',
        assets: [{
          asset: { symbol: 'XRP', address: 'native', chainId: XRPL_CHAIN_ID, decimals: 6, priceUSD: xrpPrice, source: assetSource },
          amount: xrpAmount.toString(),
          amountUSD: xrpUSD,
        }],
        source: assetSource,
      });
    }

    // Issued-currency trust lines
    for (const line of lines) {
      const amount = Number(line.balance);
      if (!isFinite(amount) || amount <= 0) continue;
      const symbol = decodeCurrency(line.currency);
      const priceUSD = STABLE_CURRENCIES.has(symbol.toUpperCase()) ? 1 : 0;
      const amountUSD = amount * priceUSD;
      if (amountUSD < 1) continue; // dust / unpriced
      positions.push({
        id: `xrpl:${line.issuer}:${line.currency}:${wallet}`,
        wallet,
        chainId: XRPL_CHAIN_ID,
        protocol: 'wallet',
        kind: 'free',
        assets: [{
          asset: { symbol, address: line.issuer, chainId: XRPL_CHAIN_ID, decimals: 6, priceUSD, source: assetSource },
          amount: amount.toString(),
          amountUSD,
        }],
        source: assetSource,
      });
    }

    // Escrows claimable by this wallet (savings-escrow B.1): value that is
    // LOCKED, not idle — kind 'locked' keeps it out of IDLE_BALANCE and out of
    // the "earning" donut (an escrow yields nothing; saying otherwise would
    // lie). Escrows where this wallet is only the source (destination is
    // someone else) are committed funds, not this wallet's value — excluded.
    for (const pos of defi) {
      if (pos.type !== 'escrow') continue;
      const details = pos.details as {
        destination?: string;
        finishAfter?: number;
        cancelAfter?: number;
        owner?: string;
        previousTxnID?: string;
      };
      if (details.destination !== wallet) continue;
      if (pos.currency !== 'XRP') continue; // IOU escrows unpriced for now
      const amount = Number(pos.balance);
      const amountUSD = amount * xrpPrice;
      if (!isFinite(amountUSD) || amountUSD < 1) continue;
      positions.push({
        id: `xrpl:escrow:${details.previousTxnID ?? `${wallet}:${details.finishAfter ?? 0}`}`,
        wallet,
        chainId: XRPL_CHAIN_ID,
        protocol: 'xrpl-escrow',
        kind: 'locked',
        assets: [{
          asset: { symbol: 'XRP', address: 'native', chainId: XRPL_CHAIN_ID, decimals: 6, priceUSD: xrpPrice, source: assetSource },
          amount: amount.toString(),
          amountUSD,
        }],
        source: assetSource,
      });
    }

    // The cage (LegacyVault on Flare): principal held by the council's
    // CONTRACT, attributed ONLY to the account the bridge's immutable council
    // hash names — everyone else got null above. This is what puts the cage in
    // net worth / the earning ring / strategies like any personal position.
    if (cageState && xrpPrice > 0) {
      positions.push(...buildCagePositions(cageState, wallet, xrpPrice, traceId));
    }

    return positions;
  }
}

export const xrplBalanceProvider = new XrplBalanceProvider();
