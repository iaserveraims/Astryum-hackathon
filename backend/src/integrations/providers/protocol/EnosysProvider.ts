import { BaseProtocolProvider } from './BaseProtocolProvider';
import { EnosysAdapter } from '../../../connectors/protocols/adapters/EnosysAdapter';

/**
 * V1.1 provider for Ēnosys (DEX V2 + Farms + optional lending) on Flare.
 * Wraps the V1 `EnosysAdapter`. Inactive until ENOSYS_ROUTER + ENOSYS_FACTORY
 * (and optional ENOSYS_MASTERCHEF / ENOSYS_LENDING_POOL) are configured.
 */
export class EnosysProvider extends BaseProtocolProvider {
  constructor(adapter: EnosysAdapter = new EnosysAdapter()) {
    super(adapter, {
      id: 'enosys',
      trustLevel: 'protocol_native',
      priority: 85,
    });
  }
}
