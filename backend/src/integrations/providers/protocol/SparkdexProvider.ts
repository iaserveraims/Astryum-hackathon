import { BaseProtocolProvider } from './BaseProtocolProvider';
import { SparkDEXAdapter } from '../../../connectors/protocols/adapters/SparkDEXAdapter';

/**
 * V1.1 provider for SparkDEX V3 concentrated-liquidity LPs on Flare.
 * Wraps the V1 `SparkDEXAdapter`. Inactive until SPARKDEX_NFPM is configured.
 */
export class SparkdexProvider extends BaseProtocolProvider {
  constructor(adapter: SparkDEXAdapter = new SparkDEXAdapter()) {
    super(adapter, {
      id: 'sparkdex',
      trustLevel: 'protocol_native',
      priority: 95,
    });
  }
}
