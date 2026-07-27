import { BaseProtocolProvider } from './BaseProtocolProvider';
import { SceptreAdapter } from '../../../connectors/protocols/adapters/SceptreAdapter';

/**
 * V1.1 provider for Sceptre sFLR liquid staking. Wraps the V1 `SceptreAdapter`.
 * Tier `experimental` until golden path produces a confirmed mainnet tx.
 */
export class SceptreProvider extends BaseProtocolProvider {
  constructor(adapter: SceptreAdapter = new SceptreAdapter()) {
    super(adapter, {
      id: 'sceptre',
      trustLevel: 'protocol_native',
      priority: 70,
      extraCapabilities: ['protocol.liquid_stake_flr'],
    });
  }
}
