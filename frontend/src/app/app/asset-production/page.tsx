'use client';

// EARN surface (Flare mainnet demo).
//
// Per docs/context/Defibro_Demos_Mainnet_Flare_Plan_2026-06-22.md, Earn shows ONLY
// the two live entradas we run on mainnet (E1 FXRP→Kinetic ISO, E2 FLR→FTSO). The
// DefiLlama-sourced curated catalogue is NOT deleted — it is HIDDEN here and stays
// fully available via SafeMarketsPage at /safe-markets. Flip back to the catalogue
// by rendering <SafeMarketsPage curatedOnly /> again.
import FlareDemoEarn from '../../../components/earn/FlareDemoEarn';
// Preserved (not deleted): the curated DefiLlama view used before the demo.
// import SafeMarketsPage from '../safe-markets/page';

export default function AssetProductionPage() {
  return <FlareDemoEarn />;
}
