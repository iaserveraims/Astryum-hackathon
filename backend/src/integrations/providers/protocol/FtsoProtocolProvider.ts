import { BaseProtocolProvider } from './BaseProtocolProvider';
import { FTSOAdapter } from '../../../connectors/protocols/adapters/FTSOAdapter';

/**
 * V1.1 provider for FTSO delegation + reward claiming. Wraps the V1 `FTSOAdapter`.
 * Distinct from the `flare-ftso` *oracle* stub (which serves price reads); this
 * one is a `protocol`-type provider exposing user-signed actions.
 */
export class FtsoProtocolProvider extends BaseProtocolProvider {
  constructor(adapter: FTSOAdapter = new FTSOAdapter()) {
    super(adapter, {
      id: 'ftso',
      trustLevel: 'protocol_native',
      priority: 90,
      extraCapabilities: ['protocol.ftso_delegate', 'protocol.ftso_claim_rewards'],
    });
  }
}
