import { BaseProtocolProvider } from './BaseProtocolProvider';
import { WFLRAdapter } from '../../../connectors/protocols/adapters/WFLRAdapter';

/**
 * V1.1 provider for WFLR wrap/unwrap. Wraps the V1 `WFLRAdapter`.
 * Capability map (registry): `wrap_native` aliases the canonical `protocol.prepareIntent`
 * with `action.type ∈ {wrap, unwrap}`.
 */
export class WflrProvider extends BaseProtocolProvider {
  constructor(adapter: WFLRAdapter = new WFLRAdapter()) {
    super(adapter, {
      id: 'wflr',
      trustLevel: 'protocol_native',
      priority: 95,
      extraCapabilities: ['protocol.wrap_native'],
    });
  }
}
