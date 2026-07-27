import type { ProtocolRegistry } from '../ProtocolRegistry';
import { KineticAdapter } from './KineticAdapter';
import { SparkDEXAdapter } from './SparkDEXAdapter';
import { FirelightAdapter } from './FirelightAdapter';
import { EnosysAdapter } from './EnosysAdapter';
import { WFLRAdapter } from './WFLRAdapter';
import { FTSOAdapter } from './FTSOAdapter';
import { SceptreAdapter } from './SceptreAdapter';
import { NativeBalanceAdapter } from './NativeBalanceAdapter';
import { FxrpBalanceAdapter } from './FxrpBalanceAdapter';
import { UpshiftVaultAdapter } from './UpshiftVaultAdapter';
import { FlareLpV3Adapter } from './FlareLpV3Adapter';
import { FlareLpV2Adapter } from './FlareLpV2Adapter';
import { FLARE_LP_V3_VENUES, FLARE_LP_V2_VENUES } from '../../../config/flareLpVenues';

export { KineticAdapter, SparkDEXAdapter, FirelightAdapter, EnosysAdapter, WFLRAdapter, FTSOAdapter, SceptreAdapter, NativeBalanceAdapter, FxrpBalanceAdapter, UpshiftVaultAdapter, FlareLpV3Adapter, FlareLpV2Adapter };
export { BaseAdapter } from './BaseAdapter';

/**
 * Bootstraps all Flare-mainnet adapters into the registry.
 * Adapters whose env addresses are missing register as `isActive=false`
 * and return `[]` from discoverPositions until env vars arrive.
 * NativeBalanceAdapter is always active — reads raw FLR via eth_getBalance.
 */
export function registerFlareAdapters(registry: ProtocolRegistry): void {
  registry.registerAdapter(new NativeBalanceAdapter()); // always first — raw FLR
  registry.registerAdapter(new FxrpBalanceAdapter()); // free FXRP in the wallet
  registry.registerAdapter(new KineticAdapter());
  registry.registerAdapter(new SparkDEXAdapter());
  registry.registerAdapter(new FirelightAdapter());
  registry.registerAdapter(new EnosysAdapter());
  registry.registerAdapter(new WFLRAdapter());
  registry.registerAdapter(new FTSOAdapter());
  registry.registerAdapter(new SceptreAdapter());
  registry.registerAdapter(new UpshiftVaultAdapter());
  // LP tracking across the whole Flare DEX ecosystem (DeFiLlama review
  // 2026-07-11): one instance per venue — V3-style NFTs (SparkDEX V4,
  // Enosys V3) + V2-style pair sweeps (BlazeSwap, SparkDEX V2, Enosys V2,
  // Pangolin). SparkDEX V3.1 stays on the existing SparkDEXAdapter.
  for (const venue of FLARE_LP_V3_VENUES) registry.registerAdapter(new FlareLpV3Adapter(venue));
  for (const venue of FLARE_LP_V2_VENUES) registry.registerAdapter(new FlareLpV2Adapter(venue));
}
