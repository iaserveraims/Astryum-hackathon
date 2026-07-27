import type { EngineProviderManifest } from './EngineProviderManifest';
import { isDeterministicEngineKind } from './engineCapabilities';

export class EngineManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineManifestError';
  }
}

/**
 * Extension point for plugging future deterministic engine providers.
 *
 * In V1.1 (S0) this factory ONLY validates manifests. No EngineProviderAdapter
 * for the existing V1 engines (Portfolio, Risk, Strategy, Simulation, Intent,
 * Execution, Automation, AICopilot) is created here.
 *
 * Any future adapter MUST go through validateManifest before being registered
 * in the IntegrationRegistry, so the Control Plane can rely on:
 *  - manifest validity
 *  - deterministic flag enforcement (AI cannot satisfy hard policy checks)
 *  - audit-required = true
 */
export interface EngineAdapterFactory {
  validateManifest(m: EngineProviderManifest): void;
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

class DefaultEngineAdapterFactory implements EngineAdapterFactory {
  validateManifest(m: EngineProviderManifest): void {
    if (!m) throw new EngineManifestError('manifest is required');
    if (!m.engineKind) throw new EngineManifestError('engineKind is required');
    if (!m.engineVersion || !SEMVER_RE.test(m.engineVersion)) {
      throw new EngineManifestError(`engineVersion must be semver, got "${m.engineVersion}"`);
    }
    if (typeof m.deterministic !== 'boolean') {
      throw new EngineManifestError('deterministic flag must be boolean');
    }
    if (m.engineKind !== 'ai-copilot' && !m.deterministic) {
      throw new EngineManifestError(
        `engineKind "${m.engineKind}" must be deterministic; only ai-copilot may be non-deterministic`,
      );
    }
    if (m.engineKind === 'ai-copilot' && m.deterministic) {
      throw new EngineManifestError('ai-copilot engines cannot claim deterministic=true');
    }
    if (m.deterministic && !isDeterministicEngineKind(m.engineKind)) {
      throw new EngineManifestError(
        `engineKind "${m.engineKind}" is not in DETERMINISTIC_ENGINE_KINDS`,
      );
    }
    if (!Array.isArray(m.supportedCapabilities) || m.supportedCapabilities.length === 0) {
      throw new EngineManifestError('supportedCapabilities must be a non-empty array');
    }
    if (!m.inputSchemaVersion) throw new EngineManifestError('inputSchemaVersion is required');
    if (!m.outputSchemaVersion) throw new EngineManifestError('outputSchemaVersion is required');
    if (m.auditRequired !== true) {
      throw new EngineManifestError('auditRequired must be literally true');
    }
  }
}

export const engineAdapterFactory: EngineAdapterFactory = new DefaultEngineAdapterFactory();
