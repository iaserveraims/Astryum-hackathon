import { BaseProtocolProvider } from './BaseProtocolProvider';
import { FirelightAdapter } from '../../../connectors/protocols/adapters/FirelightAdapter';

/**
 * V1.1 provider for Firelight stXRP liquid staking on Flare.
 * Wraps the V1 `FirelightAdapter`. Inactive until FIRELIGHT_STAKING +
 * FIRELIGHT_STXRP are configured.
 */
export class FirelightProvider extends BaseProtocolProvider {
  constructor(adapter: FirelightAdapter = new FirelightAdapter()) {
    super(adapter, {
      id: 'firelight',
      trustLevel: 'protocol_native',
      priority: 90,
    });
  }
}
