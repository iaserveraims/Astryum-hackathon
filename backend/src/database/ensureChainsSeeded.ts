/**
 * ensureChainsSeeded — keeps the `chains` table in sync with CHAIN_REGISTRY.
 *
 * Several tables (wallets, positions, protocols, transaction_intents,
 * portfolio_snapshots) carry a FK to chains.chainId. A chain that exists in
 * CHAIN_REGISTRY but has no row in `chains` makes every write for that chain
 * fail with a foreign-key violation — which is exactly how non-EVM portfolio
 * history was silently lost (the DB had XRPL as -1, the code writes 1440002).
 *
 * The registry is the source of truth for which chains exist; this reconciles
 * the DB to it at boot so adding a chain to the registry is enough.
 *
 * Idempotent, and deliberately create-only: existing rows are never updated, so
 * an operator's curated rpc/explorer/blockTime values are never clobbered.
 */
import { prisma } from './prismaClient';
import { CHAIN_REGISTRY, type ChainMeta } from '../integrations/registry/ChainRegistry';

/** chains.chainType, derived from the CAIP-2 namespace ('bip122' → bitcoin). */
function chainTypeOf(meta: ChainMeta): string {
  const namespace = meta.caip2.split(':')[0];
  if (namespace === 'eip155') return 'evm';
  if (namespace === 'bip122') return 'bitcoin';
  return namespace;
}

/**
 * chains.rpcHttp / chains.rpcWs are NOT NULL / nullable respectively, while the
 * registry keeps a single rpcUrl that may be null (chain reads its endpoint from
 * an env var instead, e.g. Solana → HELIUS_API_KEY). Split it by scheme.
 */
function rpcOf(meta: ChainMeta): { rpcHttp: string; rpcWs: string | null } {
  const url = meta.rpcUrl;
  if (!url) return { rpcHttp: '', rpcWs: null }; // endpoint comes from env at call time
  return url.startsWith('ws') ? { rpcHttp: '', rpcWs: url } : { rpcHttp: url, rpcWs: null };
}

export interface EnsureChainsResult {
  created: number[];
  existing: number;
}

export async function ensureChainsSeeded(): Promise<EnsureChainsResult> {
  const metas = Object.values(CHAIN_REGISTRY);

  const present = await prisma.chain.findMany({
    where: { chainId: { in: metas.map((m) => m.chainId) } },
    select: { chainId: true },
  });
  const known = new Set(present.map((c) => c.chainId));
  const missing = metas.filter((m) => !known.has(m.chainId));

  const created: number[] = [];
  for (const meta of missing) {
    const { rpcHttp, rpcWs } = rpcOf(meta);
    try {
      await prisma.chain.create({
        data: {
          chainId: meta.chainId,
          name: meta.name,
          chainType: chainTypeOf(meta),
          isEvm: meta.isEvm,
          caip2: meta.caip2,
          rpcHttp,
          rpcWs,
          explorer: meta.explorerUrl,
          // blockTime is display metadata only; the registry does not track it.
          // 0 = unknown — a curated value can be set in the DB and will survive.
          blockTime: 0,
          nativeSymbol: meta.nativeCurrency.symbol,
          isActive: meta.enabled,
        },
      });
      created.push(meta.chainId);
    } catch (err) {
      // A concurrent boot (Railway rolling deploy runs old + new for a moment)
      // can win the race on the unique chainId/caip2 — that is the desired end
      // state, so treat it as success rather than failing the whole reconcile.
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[chains] could not seed chainId ${meta.chainId}: ${message}`);
    }
  }

  return { created, existing: known.size };
}
