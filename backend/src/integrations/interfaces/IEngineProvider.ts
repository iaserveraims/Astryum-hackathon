import type { IProvider } from './IProvider';
import type { EngineProviderManifest } from '../providers/engine/EngineProviderManifest';

/**
 * Extension point for plugging deterministic engines (PortfolioEngine,
 * RiskEngine, StrategyEngine, SimulationEngine, IntentEngine,
 * ExecutionEngine, AutomationEngine) and the AI Copilot as Control Plane
 * providers.
 *
 * In V1.1 S0 only the contract is defined. No EngineProviderAdapter for the
 * existing V1 engines is implemented yet.
 *
 * The PolicyGuard (S4) will treat providers based on `manifest.deterministic`:
 *  - deterministic === true  → may satisfy hard policy checks (P9–P14)
 *  - deterministic === false → may only contribute proposals/explanations,
 *    NEVER as the source of truth for hard safety policies.
 */
export interface IEngineProvider extends IProvider {
  readonly type: 'engine';
  readonly manifest: EngineProviderManifest;
}
