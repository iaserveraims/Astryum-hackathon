import { ProtocolRegistry } from '../../connectors/protocols/ProtocolRegistry';
import { createScanLimiter } from './scanLimiter';
import { registerFlareAdapters } from '../../connectors/protocols/adapters';
import {
  NormalisationEngine,
  createFTSOPriceProvider,
  type PriceProvider,
} from '../normalisation/NormalisationEngine';
import {
  SnapshotBuilder,
  type PortfolioSnapshot,
  type PortfolioUnreadableProtocol,
} from './SnapshotBuilder';
import { getRedis } from '../../database/redisClient';
import { prisma } from '../../database/prismaClient';
import { discoverWithUnreadable, describeUnreadable, type IProtocolAdapter } from '../../connectors/protocols/IProtocolAdapter';
import type {
  RawPosition,
  NormalizedPosition,
  PositionMetrics,
  PositionKind,
} from '../../types/domain/Position';
import type { CanonicalPosition } from '../../canonical/types/Position';
// Zerion DISCONNECTED from production (D2 — CoinStats replaces it).
// Import isolated (not deleted); re-add to re-enable.
// import { zerionPortfolioProvider } from '../../integrations/providers/portfolio/ZerionPortfolioProvider';
import { coinStatsProvider } from '../../integrations/providers/portfolio/CoinStatsProvider';
import { deBankPortfolioProvider } from '../../integrations/providers/portfolio/DeBankPortfolioProvider';
import { onChainBalanceProvider, readManagedPotePositions } from '../../integrations/providers/portfolio/OnChainBalanceProvider';
import { solanaBalanceProvider, SOLANA_PSEUDO_CHAIN_ID } from '../../integrations/providers/portfolio/SolanaBalanceProvider';
import { xrplBalanceProvider } from '../../integrations/providers/portfolio/XrplBalanceProvider';
import { aptosBalanceProvider, APTOS_PSEUDO_CHAIN_ID } from '../../integrations/providers/portfolio/AptosBalanceProvider';
import { stellarBalanceProvider, STELLAR_PSEUDO_CHAIN_ID } from '../../integrations/providers/portfolio/StellarBalanceProvider';
import { algorandBalanceProvider, ALGORAND_PSEUDO_CHAIN_ID } from '../../integrations/providers/portfolio/AlgorandBalanceProvider';
import { bitcoinBalanceProvider, BITCOIN_PSEUDO_CHAIN_ID } from '../../integrations/providers/portfolio/BitcoinBalanceProvider';
import { XRPL_CHAIN_ID } from '../../integrations/providers/chain/XRPLProvider';
import type { IProvider } from '../../integrations/interfaces/IProvider';
import { randomUUID } from 'crypto';

/**
 * Address-shape ecosystem detection so a single portfolio call can serve every
 * linked wallet's chain. Order matters — the most specific shapes are tested
 * first so e.g. an Aptos 0x… (≠40 hex) is not mistaken for EVM.
 */
export type WalletEcosystem =
  | 'evm' | 'solana' | 'xrpl' | 'aptos' | 'stellar' | 'algorand' | 'bitcoin';
export function detectEcosystem(address: string): WalletEcosystem {
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return 'evm';
  if (/^0x[a-fA-F0-9]{1,64}$/.test(address)) return 'aptos'; // 0x + non-40 hex (32-byte Move addr)
  if (/^(bc1[a-z0-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/.test(address)) return 'bitcoin';
  if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address)) return 'xrpl';
  if (/^G[A-Z2-7]{55}$/.test(address)) return 'stellar';
  if (/^[A-Z2-7]{58}$/.test(address)) return 'algorand';
  return 'solana'; // base58 fallback (32–44 chars)
}

const NON_EVM_ROUTES: Record<
  Exclude<WalletEcosystem, 'evm'>,
  { chainId: number; provider: IProvider }
> = {
  solana:   { chainId: SOLANA_PSEUDO_CHAIN_ID,   provider: solanaBalanceProvider },
  xrpl:     { chainId: XRPL_CHAIN_ID,            provider: xrplBalanceProvider },
  aptos:    { chainId: APTOS_PSEUDO_CHAIN_ID,    provider: aptosBalanceProvider },
  stellar:  { chainId: STELLAR_PSEUDO_CHAIN_ID,  provider: stellarBalanceProvider },
  algorand: { chainId: ALGORAND_PSEUDO_CHAIN_ID, provider: algorandBalanceProvider },
  bitcoin:  { chainId: BITCOIN_PSEUDO_CHAIN_ID,  provider: bitcoinBalanceProvider },
};

const CANONICAL_KIND_MAP: Record<string, PositionKind> = {
  free:       'FREE',
  collateral: 'SUPPLY',
  debt:       'BORROW',
  lp:         'LP',
  staking:    'STAKE',
  reward:     'REWARD',
  locked:     'LOCKED',
};

/**
 * Converts a CanonicalPosition (from external providers like Zerion/DeBank)
 * into a NormalizedPosition so it flows through SnapshotBuilder and LST dedup.
 */
function canonicalToNormalized(pos: CanonicalPosition): NormalizedPosition | null {
  const primary = pos.assets[0];
  if (!primary) return null;
  const totalUSD = pos.assets.reduce((s, a) => s + (a.amountUSD ?? 0), 0);
  const kind = CANONICAL_KIND_MAP[pos.kind] ?? 'FREE';
  return {
    protocolId: pos.protocol === 'wallet' ? `wallet-${pos.chainId}` : pos.protocol,
    chainId: pos.chainId,
    wallet: pos.wallet,
    kind,
    asset: primary.asset.symbol,
    // Los proveedores externos reportan cantidades HUMANAS (XRP, no drops), no
    // unidades base: no hay entero de ledger que poner aquí y nada aguas abajo
    // lo pide. La cantidad real viaja en `qty` — dejarla caer era lo que hacía
    // que cada fila de XRP y de pote se enseñara con un 0 al lado de su valor.
    amount: 0n,
    qty: primary.amount,
    amountUSD: totalUSD,
    priceUSD: primary.asset.priceUSD ?? 0,
    metadata: {
      source: pos.source.providerId,
      external: true,
      chainId: pos.chainId,
      decimals: primary.asset.decimals,
      assets: pos.assets.map((a) => ({
        symbol: a.asset.symbol,
        amountUSD: a.amountUSD,
      })),
    },
    takenAt: new Date(),
  };
}

const FLARE_CHAIN_ID = 14;
// 5 min: the dashboard is a read-only monitor — paying a full multichain scan
// more often than this only buys "Loading…" screens. Actions that change
// positions go through POST /snapshot (forceRefresh) and bypass the cache.
const CACHE_TTL_SECONDS = 300;
/** TTL de un snapshot al que le falta algún adapter (RPC caído, deadline):
 *  breve, para reintentar pronto sin martillear el nodo mientras falla. */
const DEGRADED_CACHE_TTL_SECONDS = Number(process.env.PORTFOLIO_DEGRADED_CACHE_TTL_S ?? 30);
/**
 * STALE-WHILE-REVALIDATE. Un snapshot cuya caché fresca ha
 * expirado NO obliga a esperar el barrido completo (hasta 15 s por el
 * deadline de un adapter lento): se sirve al instante la ÚLTIMA versión
 * conocida —guardada aparte con esta vida larga— y el recálculo corre por
 * detrás, coalescido, refrescando la caché para la siguiente lectura. El
 * usuario paga el barrido una sola vez por wallet; después, nunca espera.
 * POST /snapshot (forceRefresh) sigue saltándose todo: tras firmar, dato
 * fresco de verdad.
 */
const STALE_TTL_SECONDS = Number(process.env.PORTFOLIO_STALE_TTL_S ?? 1800);
/** Un adapter que tarda más que esto se anota: son los que deciden la espera. */
const SLOW_ADAPTER_MS = 3000;
/**
 * Cuántos barridos de wallet corren A LA VEZ contra el RPC de Flare:
 * una cuenta con trece wallets EVM recomputándose de golpe cada cinco minutos
 * saturaba el nodo público y BlazeSwap cruzaba su deadline. Ver scanLimiter.
 */
const MAX_CONCURRENT_SCANS = Number(process.env.PORTFOLIO_MAX_CONCURRENT_SCANS ?? 3) || 3;
const scanLimiter = createScanLimiter(MAX_CONCURRENT_SCANS);
// A read (GET) persists at most one snapshot per wallet per hour — every page
// load was inserting a full-positions row, growing portfolio_snapshots (and
// the /history payload) linearly with visits. Explicit POST /snapshot bypasses.
const PERSIST_MIN_INTERVAL_MS = 60 * 60 * 1000;

let bootstrapped = false;
function ensureAdapters(): void {
  if (bootstrapped) return;
  registerFlareAdapters(ProtocolRegistry.getInstance());
  bootstrapped = true;
}

export interface GetPortfolioOptions {
  forceRefresh?: boolean;
  persist?: boolean;
  /**
   * Include external multichain positions. OnChainBalanceProvider (key-less
   * public-RPC reads) always runs; CoinStats/DeBank additionally run when
   * their API keys are set. Default: true.
   */
  includeExternal?: boolean;
}

/**
 * PORTFOLIO_EXTERNAL_SCAN=off disables the external multichain sweep
 * server-side (8 public-RPC chains + CoinStats/DeBank, up to 12s of cold-path
 * latency per wallet) while the demo UI only renders Flare/XRPL anyway.
 * Default stays on — the flag is an ops lever, not a behaviour change.
 */
function wantExternalScan(opts: GetPortfolioOptions): boolean {
  return opts.includeExternal !== false && process.env.PORTFOLIO_EXTERNAL_SCAN !== 'off';
}

// Hard per-adapter deadline (same rationale as OnChainBalanceProvider's
// per-chain deadline): a cold LP factory sweep against the public Flare RPC can
// hang for minutes (ethers v6 retries 429s, default request timeout 300s) and
// the allSettled below waits for the SLOWEST adapter. A late adapter yields no
// positions for this snapshot; its work keeps running underneath and warms the
// pair caches, so the next scan (cache TTL 5 min) picks it up fast.
const ADAPTER_TIMEOUT_MS = Number(process.env.PORTFOLIO_ADAPTER_TIMEOUT_MS ?? 15_000);
function withAdapterDeadline<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      const t = setTimeout(
        () => reject(new Error(`adapter ${label} timed out after ${ADAPTER_TIMEOUT_MS}ms`)),
        ADAPTER_TIMEOUT_MS,
      );
      t.unref?.();
    }),
  ]);
}

export class PortfolioEngine {
  private static instance: PortfolioEngine | null = null;
  private priceProvider: PriceProvider | null = null;
  // Fallback cache for deployments without REDIS_URL (e.g. Railway today):
  // without it every dashboard load re-scans every chain from scratch.
  private memoryCache = new Map<string, { expires: number; snap: PortfolioSnapshot }>();
  // In-flight coalescing: the risk engine calls getPortfolio concurrently with
  // the portfolio route for the same wallet; without this both pay a full scan.
  private inflight = new Map<string, Promise<PortfolioSnapshot>>();
  /** La última versión conocida por wallet (vida larga) — ver STALE_TTL_SECONDS. */
  private staleCache = new Map<string, { expires: number; snap: PortfolioSnapshot }>();

  static getInstance(): PortfolioEngine {
    if (!this.instance) this.instance = new PortfolioEngine();
    return this.instance;
  }

  private async cacheGet(key: string): Promise<PortfolioSnapshot | null> {
    const redis = getRedis();
    if (redis) {
      try {
        const cached = await redis.get(key);
        if (cached) return reviveSnapshot(JSON.parse(cached));
      } catch (err) {
        console.warn('[portfolio] redis get failed:', (err as Error).message);
      }
      return null;
    }
    const hit = this.memoryCache.get(key);
    if (hit && hit.expires > Date.now()) return hit.snap;
    if (hit) this.memoryCache.delete(key);
    return null;
  }

  private async staleGet(key: string): Promise<PortfolioSnapshot | null> {
    const redis = getRedis();
    if (redis) {
      try {
        const cached = await redis.get(`${key}:stale`);
        if (cached) return reviveSnapshot(JSON.parse(cached));
      } catch (err) {
        console.warn('[portfolio] redis stale get failed:', (err as Error).message);
      }
      return null;
    }
    const hit = this.staleCache.get(key);
    if (hit && hit.expires > Date.now()) return hit.snap;
    if (hit) this.staleCache.delete(key);
    return null;
  }

  private async staleSet(key: string, snap: PortfolioSnapshot): Promise<void> {
    const redis = getRedis();
    if (redis) {
      try {
        await redis.setex(`${key}:stale`, STALE_TTL_SECONDS, JSON.stringify(serialiseSnapshot(snap)));
      } catch (err) {
        console.warn('[portfolio] redis stale setex failed:', (err as Error).message);
      }
      return;
    }
    this.staleCache.set(key, { expires: Date.now() + STALE_TTL_SECONDS * 1000, snap });
    if (this.staleCache.size > 500) {
      const oldest = this.staleCache.keys().next().value;
      if (oldest !== undefined) this.staleCache.delete(oldest);
    }
  }

  private async cacheSet(key: string, snap: PortfolioSnapshot, ttlSeconds: number = CACHE_TTL_SECONDS): Promise<void> {
    // Toda escritura fresca COMPLETA renueva también la copia de vida larga.
    //
    // Un snapshot DEGRADADO no la pisa. `staleSet` corría
    // siempre: tras una retirada, `afterSettled` fuerza un snapshot de todas
    // las wallets a la vez (el burst más propenso al 429), el barrido salía
    // sin Kinetic, y esa copia sin el carry SUSTITUÍA a la última versión
    // conocida durante media hora: el SWR servía «no tienes nada» como si
    // fuera la memoria larga. La copia larga guarda la última lectura
    // COMPLETA; la degradada vive solo en la caché corta, con su `unreadable`.
    if (!isDegraded(snap)) await this.staleSet(key, snap);
    const redis = getRedis();
    if (redis) {
      try {
        await redis.setex(key, ttlSeconds, JSON.stringify(serialiseSnapshot(snap)));
      } catch (err) {
        console.warn('[portfolio] redis setex failed:', (err as Error).message);
      }
      return;
    }
    this.memoryCache.set(key, { expires: Date.now() + ttlSeconds * 1000, snap });
    // Bound the fallback cache so a long-lived process can't grow unbounded.
    if (this.memoryCache.size > 500) {
      const oldest = this.memoryCache.keys().next().value;
      if (oldest !== undefined) this.memoryCache.delete(oldest);
    }
  }

  /** Coalesce concurrent identical computations onto one promise. */
  private coalesce(
    key: string,
    compute: () => Promise<PortfolioSnapshot>,
  ): Promise<PortfolioSnapshot> {
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = compute().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async getPortfolio(
    wallet: string,
    chainId: number = FLARE_CHAIN_ID,
    opts: GetPortfolioOptions = {}
  ): Promise<PortfolioSnapshot> {
    // Non-EVM wallets (Solana, XRPL, Aptos, Stellar, Algorand, Bitcoin) are read
    // through their own balance providers; they don't use Flare adapters or the
    // EVM Zerion/DeBank path.
    const eco = detectEcosystem(wallet);
    if (eco !== 'evm') {
      const route = NON_EVM_ROUTES[eco];
      return this.getNonEvmPortfolio(wallet, route.chainId, route.provider, opts);
    }

    ensureAdapters();
    // External (non-Flare) positions come from OnChainBalanceProvider (public
    // RPC, NO API key needed) + CoinStats (broad, D2) + DeBank. Zerion is
    // disconnected from production. The key-less on-chain provider must NOT be
    // gated behind CoinStats/DeBank keys — key-gating happens per-provider
    // inside getExternalPositions().
    const wantExternal = wantExternalScan(opts);

    const cacheKey = `portfolio:${wantExternal ? 'ext' : 'flare'}:${chainId}:${wallet.toLowerCase()}`;

    if (!opts.forceRefresh) {
      const cached = await this.cacheGet(cacheKey);
      if (cached) return cached;
      // SWR: caché fresca expirada pero hay una última versión conocida —
      // se sirve YA y el recálculo corre por detrás (coalescido: una sola
      // computación aunque lleguen diez lecturas mientras dura).
      const stale = await this.staleGet(cacheKey);
      if (stale) {
        void this.coalesce(cacheKey, () => this.computeEvmPortfolio(wallet, chainId, cacheKey, opts)).catch((err) => {
          console.warn('[portfolio] background refresh failed:', (err as Error).message);
        });
        return stale;
      }
    }

    return this.coalesce(cacheKey, () => this.computeEvmPortfolio(wallet, chainId, cacheKey, opts));
  }

  private async computeEvmPortfolio(
    wallet: string,
    chainId: number,
    cacheKey: string,
    opts: GetPortfolioOptions,
  ): Promise<PortfolioSnapshot> {
    const wantExternal = wantExternalScan(opts);
    const registry = ProtocolRegistry.getInstance();
    const adapters = registry.getActiveAdapters(chainId);

    // External positions only need the wallet address — fetch them in parallel
    // with the Flare adapter sweep instead of after it (they used to add their
    // full latency on top of the adapters').
    const externalPromise: Promise<CanonicalPosition[]> = wantExternal
      ? this.getExternalPositions(wallet).catch((err) => {
          console.warn('[portfolio] external positions fetch failed:', (err as Error).message);
          return [];
        })
      : Promise.resolve([]);

    // Tras una firma (forceRefresh) los adapters olvidan lo memorizado de esta
    // wallet: la posición recién abierta se busca con un barrido entero.
    if (opts.forceRefresh) for (const a of adapters) a.invalidateWallet?.(wallet);
    // Un hueco del limitador para TODO el barrido de esta wallet: el deadline
    // de cada adapter empieza cuando el barrido empieza de verdad, no en la cola.
    const settled = await scanLimiter.run(() =>
      Promise.allSettled(
        adapters.map(async (a) => {
          const t0 = Date.now();
          // Lectura PARCIAL cuando el adapter sabe nombrar lo
          // que no contestó: las filas leídas entran; lo ilegible va nombrado.
          const discovery = await withAdapterDeadline(discoverWithUnreadable(a, wallet), a.protocolId);
          const ms = Date.now() - t0;
          // Quién decide la espera: el barrido tarda lo que su adapter más lento.
          if (ms > SLOW_ADAPTER_MS) console.warn(`[portfolio] slow adapter ${a.protocolId}: ${ms}ms for ${wallet}`);
          return { adapter: a, positions: discovery.positions, unreadable: discovery.unreadable };
        }),
      ),
    );

    const allRaw: { adapter: IProtocolAdapter; raws: RawPosition[] }[] = [];
    // Los adapters que NO contestaron en este barrido. Un snapshot al que le
    // falta un protocolo no es «el usuario no tiene nada ahí»: es «no pudimos
    // mirar». Se recuerda para no fosilizarlo en caché (ver cacheSet abajo).
    const dropped: string[] = [];
    const unreadable: PortfolioUnreadableProtocol[] = [];
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i];
      if (r.status === 'fulfilled') {
        allRaw.push({ adapter: r.value.adapter, raws: r.value.positions });
        if (r.value.unreadable.length > 0) {
          unreadable.push({
            protocolId: adapters[i].protocolId,
            reason: describeUnreadable(r.value.unreadable).slice(0, 300),
            partial: true,
            reads: r.value.unreadable,
          });
          console.warn(
            `[portfolio] adapter ${adapters[i].protocolId} read partially for ${wallet}:`,
            describeUnreadable(r.value.unreadable),
          );
        }
      } else {
        const reason = String((r.reason as Error)?.message ?? r.reason ?? 'no answer').slice(0, 300);
        dropped.push(adapters[i].protocolId);
        unreadable.push({ protocolId: adapters[i].protocolId, reason });
        console.warn(
          `[portfolio] adapter ${adapters[i].protocolId} dropped from snapshot:`,
          reason,
        );
      }
    }

    const flatRaw = allRaw.flatMap((x) => x.raws);
    if (!this.priceProvider) {
      try {
        this.priceProvider = await createFTSOPriceProvider();
      } catch (err) {
        console.warn(
          '[portfolio] FTSO price provider unavailable, USD = 0:',
          (err as Error).message
        );
        this.priceProvider = null;
      }
    }

    const onChainNormalized = await NormalisationEngine.unify(flatRaw, {
      priceProvider: this.priceProvider ?? undefined,
    });

    // External multi-chain positions (kicked off above, in parallel with the
    // adapter sweep; failures already degraded to [] in the catch).
    const externals = await externalPromise;
    let externalNormalized: NormalizedPosition[] = externals
      .map(canonicalToNormalized)
      .filter((n): n is NormalizedPosition => n !== null);

    // The Flare adapters are the VERIFIED source. External providers (multichain
    // on-chain reader / CoinStats / DeBank) re-report the same wallet balance
    // under protocol 'wallet' → renamed 'wallet-14', which double-counted native
    // FLR (one position per source, both real-looking). Drop any external row
    // whose (chain, wallet-bucket, kind, asset) the on-chain read already covers.
    const walletBucket = (p: string) => (/^wallet(-\d+)?$/i.test(p) ? 'wallet' : p);
    const coveredOnChain = new Set(
      onChainNormalized.map(
        (n) => `${n.chainId}:${walletBucket(n.protocolId)}:${n.kind}:${n.asset.toUpperCase()}`,
      ),
    );
    externalNormalized = externalNormalized.filter(
      (n) => !coveredOnChain.has(`${n.chainId}:${walletBucket(n.protocolId)}:${n.kind}:${n.asset.toUpperCase()}`),
    );

    // Managed vault shares (potes) — SIEMPRE en Flare, al margen del barrido
    // externo (que la demo apaga con PORTFOLIO_EXTERNAL_SCAN=off). Se valoran
    // por su FXRP subyacente y cuentan en el patrimonio como cualquier holding.
    // La Personal Account está registrada como watch wallet, así que sus shares
    // entran en Home y en la wallet.
    if (chainId === FLARE_CHAIN_ID) {
      try {
        const poteNormalized = (await readManagedPotePositions(wallet))
          .map(canonicalToNormalized)
          .filter((n): n is NormalizedPosition => n !== null);
        externalNormalized = [...externalNormalized, ...poteNormalized];
      } catch (err) {
        console.warn('[portfolio] managed pote positions failed:', (err as Error).message);
      }
    }

    const allNormalized = [...onChainNormalized, ...externalNormalized];

    const adapterByProto = new Map<string, IProtocolAdapter>();
    for (const a of adapters) adapterByProto.set(a.protocolId, a);

    const metrics: PositionMetrics[] = await Promise.all([
      ...onChainNormalized.map(async (n) => {
        const a = adapterByProto.get(n.protocolId);
        if (!a) return {};
        try {
          return await a.getMetrics(n);
        } catch {
          return {};
        }
      }),
      ...externalNormalized.map(() => Promise.resolve<PositionMetrics>({})),
    ]);

    const snapshot: PortfolioSnapshot = {
      ...SnapshotBuilder.build({
        wallet,
        chainId,
        normalized: allNormalized,
        metrics,
      }),
      ...(unreadable.length > 0 ? { unreadable } : {}),
    };

    if (opts.persist !== false) {
      await this.persistSnapshot(snapshot, opts.persist === true).catch((err) => {
        console.warn(
          '[portfolio] persist snapshot failed (continuing):',
          err.message
        );
      });
    }

    // UN SNAPSHOT INCOMPLETO NO SE CACHEA CINCO MINUTOS. Con un
    // adapter caído —un 429 del RPC, un deadline— el snapshot salía sin ese
    // protocolo y se guardaba el TTL entero: la posición recién depositada
    // «no existía» durante cinco minutos, y con 429s seguidos, otros cinco.
    // Degradado se cachea breve, lo justo para no martillear el RPC mientras
    // dura el fallo; el siguiente barrido vuelve a intentarlo.
    // Degradado es TAMBIÉN el parcial (un mercado sin leer): misma
    // vida corta, y ninguno de los dos renueva la copia larga (cacheSet).
    const degraded = unreadable.length > 0;
    await this.cacheSet(cacheKey, snapshot, degraded ? DEGRADED_CACHE_TTL_SECONDS : undefined);
    if (degraded) {
      console.warn(`[portfolio] degraded snapshot for ${wallet} (missing: ${dropped.join(', ') || '—'}; partial: ${unreadable.filter((u) => u.partial).map((u) => u.protocolId).join(', ') || '—'}) — cached ${DEGRADED_CACHE_TTL_SECONDS}s only`);
    }

    return snapshot;
  }

  async getBreakdown(wallet: string, chainId: number = FLARE_CHAIN_ID) {
    const s = await this.getPortfolio(wallet, chainId);
    return {
      wallet: s.wallet,
      chainId: s.chainId,
      totalUSD: s.totalUSD,
      breakdown: s.breakdown,
      takenAt: s.takenAt,
    };
  }

  async getLatestSnapshot(
    wallet: string,
    chainId: number = FLARE_CHAIN_ID
  ): Promise<PortfolioSnapshot> {
    // Non-EVM snapshots persist under their ecosystem's pseudo chain-id
    // (XRPL 1440002…). Callers pass chainId=14 for every wallet, so route by
    // address shape — otherwise the lookup can never match.
    const eco = detectEcosystem(wallet);
    if (eco !== 'evm') chainId = NON_EVM_ROUTES[eco].chainId;
    {
      const walletRow = await prisma.wallet
        .findFirst({
          // Non-EVM wallet rows carry chainId NULL — accept both shapes.
          where: { address: wallet, OR: [{ chainId }, { chainId: null }] },
          orderBy: { lastActivity: 'desc' },
        })
        .catch(() => null);
      if (walletRow) {
        const row = await prisma.portfolioSnapshot
          .findFirst({
            where: { walletId: walletRow.id, chainId },
            orderBy: { takenAt: 'desc' },
          })
          .catch(() => null);
        if (row) return rowToSnapshot(row, wallet, chainId);
      }
    }
    return this.getPortfolio(wallet, chainId);
  }

  async getHistory(
    wallet: string,
    chainId: number = FLARE_CHAIN_ID,
    from?: Date,
    to?: Date
  ): Promise<{ takenAt: Date; totalUSD: number }[]> {
    // Same pseudo chain-id routing as getLatestSnapshot: an XRPL wallet's
    // snapshots live under 1440002, but the frontend always asks with 14.
    const eco = detectEcosystem(wallet);
    if (eco !== 'evm') chainId = NON_EVM_ROUTES[eco].chainId;
    const walletRow = await prisma.wallet
      .findFirst({
        // Non-EVM wallet rows carry chainId NULL — accept both shapes.
        where: { address: wallet, OR: [{ chainId }, { chainId: null }] },
      })
      .catch(() => null);
    if (!walletRow) return [];
    // Default window: trailing year. Without it this returned EVERY snapshot
    // ever taken — and reads used to insert one per page load, so the payload
    // (and the dashboard) got slower with each visit.
    const effectiveFrom = from ?? new Date(Date.now() - 365 * 86_400_000);
    const rows = await prisma.portfolioSnapshot.findMany({
      where: {
        walletId: walletRow.id,
        chainId,
        takenAt: {
          gte: effectiveFrom,
          lte: to,
        },
      },
      orderBy: { takenAt: 'asc' },
      select: { takenAt: true, totalValue: true },
    });
    const points = rows.map((r) => ({ takenAt: r.takenAt, totalUSD: r.totalValue }));
    return downsampleHistory(points);
  }

  /**
   * Reads a non-EVM wallet (Solana, XRPL) via its dedicated balance provider and
   * builds the same PortfolioSnapshot shape the EVM path returns, so the frontend
   * can aggregate every linked wallet regardless of chain.
   */
  private async getNonEvmPortfolio(
    wallet: string,
    chainId: number,
    provider: IProvider,
    opts: GetPortfolioOptions,
  ): Promise<PortfolioSnapshot> {
    const cacheKey = `portfolio:noevm:${chainId}:${wallet}`;
    if (!opts.forceRefresh) {
      const cached = await this.cacheGet(cacheKey);
      if (cached) return cached;
      // SWR: caché fresca expirada pero hay una última versión conocida —
      // se sirve YA y el recálculo corre por detrás (coalescido: una sola
      // computación aunque lleguen diez lecturas mientras dura).
      const stale = await this.staleGet(cacheKey);
      if (stale) {
        void this.coalesce(cacheKey, () => this.computeNonEvmPortfolio(wallet, chainId, provider, cacheKey, opts)).catch((err) => {
          console.warn('[portfolio] background refresh failed:', (err as Error).message);
        });
        return stale;
      }
    }

    return this.coalesce(cacheKey, () => this.computeNonEvmPortfolio(wallet, chainId, provider, cacheKey, opts));
  }

  private async computeNonEvmPortfolio(
    wallet: string,
    chainId: number,
    provider: IProvider,
    cacheKey: string,
    opts: GetPortfolioOptions,
  ): Promise<PortfolioSnapshot> {
    const traceId = randomUUID();
    let canonical: CanonicalPosition[] = [];
    // La misma familia de fallo que el camino EVM: la lectura
    // del ledger no contesta → `canonical = []` → un snapshot a CERO que se
    // persistía (caída falsa en el patrimonio), pisaba la copia larga y se
    // cacheaba cinco minutos como hecho. `afterSettled` fuerza también la
    // XRPL tras cada asiento. Ahora se nombra, y sigue el mismo carril
    // degradado: caché corta, copia larga intacta, sin fila en el histórico.
    const unreadable: PortfolioUnreadableProtocol[] = [];
    try {
      const result = await provider.call<{ walletAddress: string }, CanonicalPosition[]>(
        'portfolio.getPositions',
        { walletAddress: wallet },
        { traceId, wallet },
      );
      canonical = result.data;
    } catch (err) {
      const reason = String((err as Error)?.message ?? err ?? 'no answer').slice(0, 300);
      unreadable.push({ protocolId: provider.id, reason });
      console.warn(`[portfolio] non-EVM (${chainId}) fetch failed:`, reason);
    }

    const normalized = canonical
      .map(canonicalToNormalized)
      .filter((n): n is NormalizedPosition => n !== null);
    const metrics: PositionMetrics[] = normalized.map(() => ({}));

    const snapshot: PortfolioSnapshot = {
      ...SnapshotBuilder.build({ wallet, chainId, normalized, metrics }),
      ...(unreadable.length > 0 ? { unreadable } : {}),
    };

    if (opts.persist !== false) {
      await this.persistSnapshot(snapshot, opts.persist === true).catch((err) => {
        console.warn('[portfolio] persist non-EVM snapshot failed (continuing):', err.message);
      });
    }
    await this.cacheSet(cacheKey, snapshot, unreadable.length > 0 ? DEGRADED_CACHE_TTL_SECONDS : undefined);
    return snapshot;
  }

  /**
   * Fetches external (non-Flare) positions from Zerion + DeBank.
   * On-chain Flare positions always win when the same position is detected
   * in both on-chain and external sources (deduplication by symbol+protocol+chain).
   *
   * Zerion: trustLevel='indexer_verified', intended confidence='probable'
   * DeBank: trustLevel='indexer_verified', intended confidence='detected'
   */
  async getExternalPositions(wallet: string): Promise<CanonicalPosition[]> {
    const traceId = randomUUID();
    const ctx = { traceId, wallet };

    // D2: CoinStats is the broad multichain source (replaces disconnected Zerion);
    // DeBank stays as a complement; on-chain (Flare) is the verified source.
    // CoinStats/DeBank are each gated by their own API key; OnChainBalanceProvider
    // needs NO key (public RPC + DeFiLlama prices) and ALWAYS runs.
    const skipped = (): Promise<{ data: CanonicalPosition[] }> =>
      Promise.resolve({ data: [] });

    const [coinStatsResult, debankResult, onChainResult] = await Promise.allSettled([
      process.env.COINSTATS_API_KEY
        ? coinStatsProvider.call<{ walletAddress: string }, CanonicalPosition[]>(
            'portfolio.getPositions',
            { walletAddress: wallet },
            ctx,
          )
        : skipped(),
      process.env.DEBANK_API_KEY
        ? deBankPortfolioProvider.call<{ walletAddress: string }, CanonicalPosition[]>(
            'portfolio.getPositions',
            { walletAddress: wallet },
            ctx,
          )
        : skipped(),
      onChainBalanceProvider.call<{ walletAddress: string }, CanonicalPosition[]>(
        'portfolio.getPositions',
        { walletAddress: wallet },
        ctx,
      ),
    ]);

    const coinStatsPositions = coinStatsResult.status === 'fulfilled' ? coinStatsResult.value.data : [];
    const debankPositions = debankResult.status === 'fulfilled' ? debankResult.value.data : [];
    const onChainPositions = onChainResult.status === 'fulfilled' ? onChainResult.value.data : [];

    if (coinStatsResult.status === 'rejected') {
      console.warn('[portfolio] CoinStats fetch failed:', (coinStatsResult.reason as Error).message);
    }
    if (debankResult.status === 'rejected') {
      console.warn('[portfolio] DeBank fetch failed:', (debankResult.reason as Error).message);
    }
    if (onChainResult.status === 'rejected') {
      console.warn('[portfolio] OnChainBalance fetch failed:', (onChainResult.reason as Error).message);
    }

    // Priority order: OnChain (verified) > CoinStats > DeBank
    // Key: chainId:symbol — on-chain data wins for the same asset
    const seen = new Set<string>();
    const merged: CanonicalPosition[] = [];

    for (const pos of [...onChainPositions, ...coinStatsPositions, ...debankPositions]) {
      const key = `${pos.chainId}:${pos.protocol}:${pos.kind}:${pos.assets.map((a) => a.asset.symbol).join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(pos);
    }

    return merged;
  }

  private async persistSnapshot(s: PortfolioSnapshot, force = false): Promise<void> {
    // UN SNAPSHOT DEGRADADO NO ES UN HECHO Y NO SE PERSISTE,
    // ni con `force` (POST /snapshot tras cada asiento). Se persistía sin
    // mirar `unreadable`: el histórico registraba una caída falsa del
    // patrimonio y `getLatestSnapshot` devolvía la copia sin el carry. La
    // última fila de la BD es la última lectura COMPLETA; la degradada viaja
    // en la respuesta (con su `unreadable`) y muere en la caché corta.
    if (isDegraded(s)) {
      console.warn(
        `[portfolio] degraded snapshot for ${s.wallet} NOT persisted (unreadable: ${s.unreadable!.map((u) => u.protocolId).join(', ')})`,
      );
      return;
    }
    // Non-EVM wallets register with chainId NULL (the registry has no EVM
    // chain for them) while their snapshots carry the pseudo chain-id — accept
    // both so XRPL/Solana history actually persists.
    const walletRow = await prisma.wallet.findFirst({
      where: { address: s.wallet, OR: [{ chainId: s.chainId }, { chainId: null }] },
    });
    if (!walletRow) return; // no-op if wallet not registered

    if (!force) {
      const latest = await prisma.portfolioSnapshot.findFirst({
        where: { walletId: walletRow.id, chainId: s.chainId },
        orderBy: { takenAt: 'desc' },
        select: { takenAt: true },
      });
      if (latest && Date.now() - latest.takenAt.getTime() < PERSIST_MIN_INTERVAL_MS) return;
    }

    await prisma.portfolioSnapshot.create({
      data: {
        userId: walletRow.userId,
        walletId: walletRow.id,
        chainId: s.chainId,
        totalValue: s.totalUSD,
        totalUSD: s.totalUSD.toString(),
        positions: s.positions as unknown as object,
        allocation: s.breakdown as unknown as object,
        performance: {
          netWorthUSD: s.netWorthUSD,
          collateralUSD: s.collateralUSD,
          debtUSD: s.debtUSD,
        },
        riskMetrics: {},
        benchmarkDate: s.takenAt,
        takenAt: s.takenAt,
      },
    });
  }
}

/**
 * Reduce history to the LAST real snapshot per bucket (hour when the span is
 * under 48h so young accounts still draw a curve, calendar day otherwise).
 * Mirrors the frontend's mergeHistories bucketing; no point is interpolated.
 */
function downsampleHistory(
  points: { takenAt: Date; totalUSD: number }[],
): { takenAt: Date; totalUSD: number }[] {
  if (points.length < 3) return points;
  const spanMs =
    points[points.length - 1].takenAt.getTime() - points[0].takenAt.getTime();
  const hourly = spanMs < 48 * 3_600_000;
  const buckets = new Map<string, { takenAt: Date; totalUSD: number }>();
  for (const p of points) {
    const key = p.takenAt.toISOString().slice(0, hourly ? 13 : 10);
    buckets.set(key, p); // rows are asc — last write per bucket wins
  }
  return [...buckets.values()];
}

function serialiseSnapshot(s: PortfolioSnapshot): unknown {
  return { ...s, takenAt: s.takenAt.toISOString() };
}
function reviveSnapshot(s: any): PortfolioSnapshot {
  return { ...s, takenAt: new Date(s.takenAt) };
}
/** Degradado = le falta algo que no se pudo leer (adapter caído o lectura parcial). */
function isDegraded(s: PortfolioSnapshot): boolean {
  return Array.isArray(s.unreadable) && s.unreadable.length > 0;
}

function rowToSnapshot(row: any, wallet: string, chainId: number): PortfolioSnapshot {
  // A row's `unreadable` (kept under `performance`, the JSON column
  // that already carries the snapshot's side facts) is never dropped on the
  // way out. No degraded snapshot is persisted today (persistSnapshot), so a
  // row carrying it is an older one — and it still says what it could not see.
  const unreadable = Array.isArray(row.performance?.unreadable) ? (row.performance.unreadable as PortfolioUnreadableProtocol[]) : [];
  return {
    wallet,
    chainId,
    totalUSD: row.totalValue ?? 0,
    collateralUSD: row.performance?.collateralUSD ?? 0,
    debtUSD: row.performance?.debtUSD ?? 0,
    netWorthUSD: row.performance?.netWorthUSD ?? 0,
    positions: row.positions ?? [],
    breakdown: row.allocation ?? { byProtocol: {}, byAsset: {}, byKind: {} },
    takenAt: row.takenAt,
    ...(unreadable.length > 0 ? { unreadable } : {}),
  };
}
