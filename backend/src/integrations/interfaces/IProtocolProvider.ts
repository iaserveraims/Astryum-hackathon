import type { IProvider, ProviderCallContext, ProviderCallResult } from './IProvider';
import type { CanonicalPosition } from '../../canonical/types/Position';
import type { CanonicalAction } from '../../canonical/types/Action';
import type { CanonicalIntent, SimulationResult } from '../../canonical/types/Intent';

export interface IProtocolProvider extends IProvider {
  readonly type: 'protocol';
  discoverPositions(
    wallet: string,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<CanonicalPosition[]>>;
  simulateAction(
    action: CanonicalAction,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<SimulationResult>>;
  prepareIntent(
    action: CanonicalAction,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<CanonicalIntent>>;
}
