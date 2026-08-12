import type {
  RawPosition,
  NormalizedPosition,
} from '../../types/domain/Position';
import { getProtocolAddresses } from '../../config/protocolAddresses';
import { canonicalizeSymbol } from '../../utils/canonicalizeSymbol';

const WFLR_ADDRESS = '0x1d80c49bbbcd1c0911346656b529df9e5c2f783d';
// Standard convention for native chain token (ETH/FLR/etc.) used by Zerion, Alchemy, etc.
const NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

function fxrpAddress(): string | undefined {
  return getProtocolAddresses().fxrp.token?.toLowerCase();
}

export interface PriceProvider {
  getPriceUSD(symbol: string): Promise<number>;
  /**
   * Optional batch resolution — one round-trip for many symbols (FTSO
   * getFeedsById). Symbols missing from the returned map fall back to
   * getPriceUSD one by one.
   */
  getPricesUSD?(symbols: string[]): Promise<Map<string, number>>;
}

/**
 * Optional block an adapter can place in `raw.raw.underlying` when the
 * protocol itself converts shares → underlying (invariant #9: protocol data,
 * never computed by us). `amount` is a base-units bigint string.
 */
export interface UnderlyingValuation {
  symbol: string;
  amount: string;
  decimals: number;
}

function parseUnderlying(v: unknown): UnderlyingValuation | null {
  if (!v || typeof v !== 'object') return null;
  const { symbol, amount, decimals } = v as Record<string, unknown>;
  if (typeof symbol !== 'string' || symbol.length === 0) return null;
  if (typeof amount !== 'string' || !/^\d+$/.test(amount) || amount === '0') return null;
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0) return null;
  return { symbol, amount, decimals };
}

export interface NormaliseOptions {
  priceProvider?: PriceProvider;
}

/**
 * Pure cross-adapter normalisation. Coalesces WFLR↔FLR, resolves a
 * canonical symbol from each RawPosition, and computes USD value from
 * the injected PriceProvider. If no provider, priceUSD defaults to 0
 * and amountUSD = 0 (engine remains deterministic and testable).
 */
export class NormalisationEngine {
  static resolveSymbol(raw: RawPosition): string | null {
    const meta = raw.raw ?? {};
    const metaSymbol =
      typeof meta.symbol === 'string'
        ? (meta.symbol as string)
        : typeof meta.token === 'string'
          ? (meta.token as string)
          : null;
    if (metaSymbol) {
      // "USD₮0" (₮ U+20AE) — sin canonicalizar, el mapeo de abajo jamás casaba
      // → precio 0 → la deuda valía $0 en todos los paneles (incidente
      // 2026-07-25). La canonicalización vive en UN sitio: utils/canonicalizeSymbol.
      const upper = canonicalizeSymbol(metaSymbol);
      if (upper === 'WFLR') return 'FLR';
      if (upper === 'STXRP') return 'XRP';
      if (upper === 'FXRP') return 'XRP';
      // USDT0 is bridged USDT (1:1 redenomination) — FTSO only lists USDT.
      if (upper === 'USDT0') return 'USDT';
      return upper;
    }
    const addr = raw.asset?.toLowerCase();
    if (addr === WFLR_ADDRESS || addr === NATIVE_TOKEN_ADDRESS) return 'FLR';
    const fxrp = fxrpAddress();
    if (fxrp && addr === fxrp) return 'XRP';
    return null;
  }

  static canonicaliseAsset(raw: RawPosition): string {
    const addr = raw.asset?.toLowerCase();
    if (addr === WFLR_ADDRESS || addr === NATIVE_TOKEN_ADDRESS) return 'FLR';
    // Adapter-declared FXRP — the balance adapter resolves the token live, so
    // the env-config address match below cannot be the only door.
    const meta = raw.raw ?? {};
    const metaSymbol =
      typeof meta.symbol === 'string' ? meta.symbol : typeof meta.token === 'string' ? meta.token : null;
    if (metaSymbol?.toUpperCase() === 'FXRP') return 'FXRP';
    const fxrp = fxrpAddress();
    if (fxrp && raw.asset?.toLowerCase() === fxrp) return 'FXRP';
    // Receipt/share tokens (stXRP, sFLR, earnXRP…): the adapter's declared
    // symbol IS the display name — falling through to the raw contract
    // address rendered rows as "0x4C18…" in every surface.
    if (metaSymbol) return metaSymbol;
    return raw.asset;
  }

  static async unify(
    raws: RawPosition[],
    opts: NormaliseOptions = {}
  ): Promise<NormalizedPosition[]> {
    const provider = opts.priceProvider;
    const symbolCache = new Map<string, number>();

    // Pre-resolve every needed symbol in ONE batch call when the provider
    // supports it — pricing used to be one sequential eth_call per symbol per
    // wallet, which alone added seconds to a cold portfolio scan.
    if (provider?.getPricesUSD) {
      const needed = new Set<string>();
      for (const raw of raws) {
        const s = this.resolveSymbol(raw);
        if (s) needed.add(s);
        const u = parseUnderlying(raw.raw?.underlying);
        if (u) needed.add(u.symbol);
      }
      if (needed.size > 0) {
        try {
          const priced = await provider.getPricesUSD([...needed]);
          for (const [sym, price] of priced) symbolCache.set(sym, price);
        } catch {
          // fall back to per-symbol pricing below
        }
      }
    }

    const priceFor = async (symbol: string): Promise<number> => {
      if (!provider) return 0;
      if (symbolCache.has(symbol)) return symbolCache.get(symbol)!;
      let price = 0;
      try {
        price = await provider.getPriceUSD(symbol);
      } catch {
        price = 0;
      }
      symbolCache.set(symbol, price);
      return price;
    };

    const out: NormalizedPosition[] = [];
    for (const raw of raws) {
      const symbol = this.resolveSymbol(raw);
      let priceUSD = symbol ? await priceFor(symbol) : 0;

      // amount is bigint in token base units; assume 18 decimals when
      // adapter did not specify. Adapters carrying non-18 decimals can
      // place `decimals` in raw.raw to override.
      const decimals =
        typeof raw.raw?.decimals === 'number'
          ? (raw.raw.decimals as number)
          : 18;
      const human = Number(raw.amount) / 10 ** decimals;
      let amountUSD = priceUSD * human;

      // Receipt/share tokens: when the adapter supplies the protocol's own
      // live conversion (ERC-4626 convertToAssets, getPooledFlrByShares,
      // getSharePrice…) value the position from the UNDERLYING amount —
      // share×spot both misprices appreciating shares and breaks entirely
      // for symbols FTSO doesn't list (sFLR, earnXRP). priceUSD becomes the
      // effective per-share price so qty (USD/price) stays the share count.
      const u = parseUnderlying(raw.raw?.underlying);
      if (u) {
        const uPrice = await priceFor(u.symbol);
        if (uPrice > 0) {
          amountUSD = uPrice * (Number(u.amount) / 10 ** u.decimals);
          priceUSD = human > 0 ? amountUSD / human : uPrice;
        }
      }

      out.push({
        protocolId: raw.protocolId,
        chainId: raw.chainId,
        wallet: raw.wallet,
        kind: raw.kind,
        asset: this.canonicaliseAsset(raw),
        amount: raw.amount,
        amountUSD,
        priceUSD,
        metadata: { ...raw.raw, symbol: symbol ?? raw.raw?.symbol ?? null },
        takenAt: raw.discoveredAt,
      });
    }
    return out;
  }
}

/**
 * Default FTSO-backed PriceProvider. Lazily imports FTSOClient to keep
 * NormalisationEngine itself a pure module (no side effects on import).
 */
export async function createFTSOPriceProvider(): Promise<PriceProvider> {
  const { FTSOClient } = await import('../../flare/ftso/FTSOClient');
  const { isValidFTSOSymbol } = await import('../../flare/ftso/constants');
  const rpcUrl =
    process.env.FLARE_RPC_URL ||
    'https://flare-api.flare.network/ext/C/rpc';
  const client = new FTSOClient({
    network: 'flare',
    rpcUrl,
  });

  // Short process-level memo (aligned with FTSO cadence, generous for a
  // read-only dashboard): consecutive wallets in the same fan-out no longer
  // re-pay the same XRP/FLR/USDT feeds. Failures are NOT memoised.
  const PRICE_MEMO_TTL_MS = 60_000;
  const memo = new Map<string, { price: number; at: number }>();
  const freshPrice = (symbol: string): number | null => {
    const hit = memo.get(symbol);
    return hit && Date.now() - hit.at < PRICE_MEMO_TTL_MS ? hit.price : null;
  };

  return {
    async getPriceUSD(symbol: string): Promise<number> {
      const hit = freshPrice(symbol);
      if (hit !== null) return hit;
      try {
        const p = await client.getCurrentPrice(symbol);
        const price = Number(p.price) / 10 ** p.decimals;
        memo.set(symbol, { price, at: Date.now() });
        return price;
      } catch {
        return 0;
      }
    },

    async getPricesUSD(symbols: string[]): Promise<Map<string, number>> {
      const out = new Map<string, number>();
      const toFetch: string[] = [];
      for (const s of symbols) {
        const hit = freshPrice(s);
        if (hit !== null) {
          out.set(s, hit);
        } else if (isValidFTSOSymbol(s)) {
          toFetch.push(s);
        } else {
          // FTSO doesn't list it (sFLR, earnXRP…) — same 0 the per-symbol
          // path returns, without paying a doomed eth_call each.
          out.set(s, 0);
        }
      }
      if (toFetch.length > 0) {
        try {
          const prices = await client.getCurrentPrices(toFetch);
          for (const p of prices) {
            const price = Number(p.price) / 10 ** p.decimals;
            memo.set(p.symbol, { price, at: Date.now() });
            out.set(p.symbol, price);
          }
        } catch {
          // leave unfetched symbols out — unify falls back to getPriceUSD
        }
      }
      return out;
    },
  };
}
