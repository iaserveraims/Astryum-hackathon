import { IntegrationRegistry, registry as defaultRegistry } from '../../registry/IntegrationRegistry';
import { replaceProvider } from '../../registry/bootstrap';
import { WflrProvider } from './WflrProvider';
import { FtsoProtocolProvider } from './FtsoProtocolProvider';
import { SceptreProvider } from './SceptreProvider';
import { KineticProvider } from './KineticProvider';
import { SparkdexProvider } from './SparkdexProvider';
import { FirelightProvider } from './FirelightProvider';
import { EnosysProvider } from './EnosysProvider';

export { BaseProtocolProvider } from './BaseProtocolProvider';
export { WflrProvider } from './WflrProvider';
export { FtsoProtocolProvider } from './FtsoProtocolProvider';
export { SceptreProvider } from './SceptreProvider';
export { KineticProvider } from './KineticProvider';
export { SparkdexProvider } from './SparkdexProvider';
export { FirelightProvider } from './FirelightProvider';
export { EnosysProvider } from './EnosysProvider';

/**
 * Replaces V1.1 stubs with concrete providers that wrap the V1 adapters.
 * Idempotent — call after `bootstrapRegistry()`.
 *
 * Includes the Flare-native S1.5 set (wflr / ftso / sceptre) and the S3
 * protocol set (kinetic / sparkdex / firelight / enosys). The S3 providers
 * register regardless of config `enabled` so `health()` reflects adapter
 * state — `disabled` while env vars are missing, `healthy` once activated.
 */
export function bootstrapV11ProtocolProviders(
  target: IntegrationRegistry = defaultRegistry,
): void {
  replaceProvider(target, new WflrProvider());
  replaceProvider(target, new FtsoProtocolProvider());
  replaceProvider(target, new SceptreProvider());
  replaceProvider(target, new KineticProvider());
  replaceProvider(target, new SparkdexProvider());
  replaceProvider(target, new FirelightProvider());
  replaceProvider(target, new EnosysProvider());
}
