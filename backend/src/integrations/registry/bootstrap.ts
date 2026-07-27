import { registry, IntegrationRegistry } from './IntegrationRegistry';
import { PROVIDERS_CONFIG } from './providers.config';
import { StubProvider } from './StubProvider';
import { FlareRpcProvider } from '../providers/chain/FlareRpcProvider';
import { FtsoProvider } from '../providers/oracle/FtsoProvider';
import { FlarescanProvider } from '../providers/explorer/FlarescanProvider';
import { EvmExplorerProvider } from '../providers/explorer/EvmExplorerProvider';
import { DefiLlamaProvider } from '../providers/data/DefiLlamaProvider';
import { PortfolioAggregationProvider } from '../providers/engine/PortfolioAggregationProvider';
import { RiskNormalizationProvider } from '../providers/engine/RiskNormalizationProvider';
import { FxrpMonitorProvider } from '../providers/fasset/FxrpMonitorProvider';
import { defiLlamaProvider } from '../providers/data/DefiLlamaProvider';
// V2 S3: Multichain read-only RPC providers
import { alchemyRpcProvider } from '../providers/chain/AlchemyRpcProvider';
import { heliusRpcProvider } from '../providers/chain/HeliusRpcProvider';
import { quickNodeRpcProvider } from '../providers/chain/QuickNodeRpcProvider';
// V2 S2: Turnkey user-controlled signing metadata provider
import { turnkeyWalletProvider } from '../providers/wallet/TurnkeyWalletProvider';
// V2 S8: Multichain portfolio intelligence
// D2: CoinStats is the single broad portfolio source (replaces disconnected Zerion).
import { coinStatsProvider } from '../providers/portfolio/CoinStatsProvider';
import { zerionPortfolioProvider } from '../providers/portfolio/ZerionPortfolioProvider';
import { deBankPortfolioProvider } from '../providers/portfolio/DeBankPortfolioProvider';
// P13: Enso Finance — atomic DeFi bundles
import { ensoProvider } from '../providers/defi/EnsoProvider';
// P14: Jupiter (Solana swaps) + Li.Fi (cross-chain EVM)
import { jupiterSwapProvider } from '../providers/swap/JupiterSwapProvider';
import { soroswapProvider } from '../providers/swap/SoroswapProvider';
import { liFiProvider } from '../providers/swap/LiFiProvider';
// P15: Hedera + XDC public RPC providers (no API key)
import { hederaRpcProvider } from '../providers/chain/HederaRpcProvider';
import { xdcRpcProvider } from '../providers/chain/XdcRpcProvider';
// P16: XRPL — xrpl.js read-only provider (balance, trust lines, AMM LP, Soil vaults)
import { xrplProvider } from '../providers/chain/XRPLProvider';
// FASE 5: Market data enrichment
import { dexScreenerProvider } from '../providers/data/DexScreenerProvider';
import { geckoTerminalProvider } from '../providers/data/GeckoTerminalProvider';
// FASE 5: On-ramp partners
import { transakProvider } from '../providers/onramp/TransakProvider';
import { meldProvider } from '../providers/onramp/MeldProvider';
// FASE 5: Enterprise portfolio aggregator
import { kryptosConnectProvider } from '../providers/portfolio/KryptosConnectProvider';
// FASE 6: Security Partners
import { hypernativeProvider } from '../providers/security/HypernativeProvider';
import { tenderlyProvider } from '../providers/security/TenderlyProvider';
import { goPlusProvider } from '../providers/security/GoPlusProvider';
// FASE 8: Advanced execution partners
import { squidRouterProvider } from '../providers/swap/SquidRouterProvider';
import { cowSwapProvider } from '../providers/swap/CoWSwapProvider';
import { moonPayTradeProvider } from '../providers/defi/MoonPayTradeProvider';
import { yellowStateChannelProvider } from '../providers/intent/YellowStateChannelProvider';

let bootstrapped = false;

/**
 * Real provider instances replace the stub for the same id.
 * V2 S3 adds Alchemy, Helius, QuickNode (all read-only, BROADCAST_FORBIDDEN).
 */
function buildRealProviders(): Array<{ id: string }> {
  return [
    new FlareRpcProvider(),
    new FtsoProvider(),
    new FlarescanProvider(),
    new EvmExplorerProvider(),
    new DefiLlamaProvider(),
    new PortfolioAggregationProvider(),
    new RiskNormalizationProvider(),
    new FxrpMonitorProvider(),
    defiLlamaProvider,
    alchemyRpcProvider,
    heliusRpcProvider,
    quickNodeRpcProvider,
    turnkeyWalletProvider,
    coinStatsProvider,
    zerionPortfolioProvider,
    deBankPortfolioProvider,
    ensoProvider,
    jupiterSwapProvider,
    soroswapProvider,
    liFiProvider,
    hederaRpcProvider,
    xdcRpcProvider,
    xrplProvider,
    dexScreenerProvider,
    geckoTerminalProvider,
    transakProvider,
    meldProvider,
    kryptosConnectProvider,
    hypernativeProvider,
    tenderlyProvider,
    goPlusProvider,
    squidRouterProvider,
    cowSwapProvider,
    moonPayTradeProvider,
    yellowStateChannelProvider,
  ];
}

/**
 * Idempotently registers each entry in PROVIDERS_CONFIG. Real providers replace
 * stubs for ids that have a concrete implementation; everything else stays as stub.
 */
export function bootstrapRegistry(target: IntegrationRegistry = registry): void {
  if (bootstrapped && target === registry) return;
  const realById = new Map(buildRealProviders().map((p) => [p.id, p]));
  for (const cfg of PROVIDERS_CONFIG) {
    if (target.get(cfg.id)) continue;
    const real = realById.get(cfg.id);
    if (real && cfg.enabled) {
      target.register(real as Parameters<IntegrationRegistry['register']>[0]);
    } else {
      target.register(new StubProvider(cfg));
    }
  }
  if (target === registry) bootstrapped = true;
}

export function replaceProvider(target: IntegrationRegistry, provider: { id: string }): void {
  if (target.get(provider.id)) target.unregister(provider.id);
  target.register(provider as Parameters<IntegrationRegistry['register']>[0]);
}
