export type EngineKind =
  | 'portfolio'
  | 'risk'
  | 'strategy'
  | 'simulation'
  | 'intent'
  | 'execution'
  | 'automation'
  | 'ai-copilot';

export type EngineCapability = string;

/**
 * Engine kinds that are deterministic by contract. AI-copilot is intentionally
 * excluded: AI providers may propose, explain and prepare, but cannot act as
 * the deterministic source of truth for hard PolicyGuard checks.
 */
export const DETERMINISTIC_ENGINE_KINDS: ReadonlyArray<EngineKind> = Object.freeze([
  'portfolio',
  'risk',
  'strategy',
  'simulation',
  'intent',
  'execution',
  'automation',
]);

export function isDeterministicEngineKind(kind: EngineKind): boolean {
  return DETERMINISTIC_ENGINE_KINDS.includes(kind);
}
