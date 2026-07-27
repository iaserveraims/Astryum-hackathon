import { BaseProtocolProvider } from './BaseProtocolProvider';
import { KineticAdapter } from '../../../connectors/protocols/adapters/KineticAdapter';

/**
 * V1.1 provider for Kinetic Market lending (Compound V2 fork on Flare).
 * Wraps the V1 `KineticAdapter`. Health is `disabled` until KINETIC_COMPTROLLER
 * is configured; switches to `healthy` once the adapter reports `isActive`.
 */
export class KineticProvider extends BaseProtocolProvider {
  constructor(adapter: KineticAdapter = new KineticAdapter()) {
    super(adapter, {
      id: 'kinetic',
      trustLevel: 'protocol_native',
      priority: 100,
    });
  }
}
