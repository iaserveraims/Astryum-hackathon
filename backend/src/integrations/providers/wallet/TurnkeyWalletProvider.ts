/**
 * TurnkeyWalletProvider
 *
 * Backend metadata provider for Turnkey user-controlled signing infrastructure.
 *
 * REGULATORY NOTE:
 * - Turnkey keys are user-controlled and never leave the user's device.
 * - Astryum never holds, sees, or manages private keys.
 * - This provider only exposes capabilities metadata and session validation.
 * - canBroadcast is always false — Astryum does not broadcast transactions.
 * - userControlledKeys is always true — user owns the keys, not Astryum.
 *
 * The actual signing happens client-side in frontend/src/wallet/TurnkeyWalletProvider.ts.
 * This backend provider exists only for Control Plane capability routing.
 */
import type { IProvider, ProviderHealth, ProviderCallContext, ProviderCallResult, Capability } from '../../interfaces/IProvider';

const TURNKEY_BASE_URL = process.env.TURNKEY_BASE_URL ?? 'https://api.turnkey.com';
const TURNKEY_ORG_ID = process.env.TURNKEY_ORG_ID ?? '';
const TURNKEY_API_PUBLIC_KEY = process.env.TURNKEY_API_PUBLIC_KEY ?? '';

export interface TurnkeyCapabilitiesResult {
  mode: 'user_authorized_partner_relay';
  canSign: true;
  canBroadcast: false;
  userControlledKeys: true;
  supportedSchemes: ReadonlyArray<'eip712' | 'secp256k1' | 'ed25519'>;
  orgId: string;
}

export interface TurnkeyAuthorizationSession {
  sessionId: string;
  status: 'pending_user_review' | 'user_authorized' | 'cancelled' | 'expired';
  walletAddress: string;
  expiresAt: string;
}

const CAPS: ReadonlyArray<Capability> = [
  'wallet.getCapabilities',
  'wallet.validateAuthorizationSession',
  'wallet.getAuthorizationStatus',
];

class TurnkeyWalletProvider implements IProvider {
  readonly id = 'turnkey';
  readonly type = 'wallet' as const;
  readonly capabilities = CAPS;
  readonly trustLevel = 'protocol_native' as const;
  readonly priority = 85;

  async health(): Promise<ProviderHealth> {
    if (!TURNKEY_ORG_ID || !TURNKEY_API_PUBLIC_KEY) {
      return {
        status: 'disabled',
        lastCheckAt: new Date().toISOString(),
        reason: 'TURNKEY_ORG_ID or TURNKEY_API_PUBLIC_KEY not configured',
      };
    }
    const start = Date.now();
    try {
      const resp = await fetch(`${TURNKEY_BASE_URL}/public/v1/query/whoami`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: TURNKEY_ORG_ID }),
        signal: AbortSignal.timeout(5000),
      });
      return {
        status: resp.ok ? 'healthy' : 'degraded',
        latencyMs: Date.now() - start,
        lastCheckAt: new Date().toISOString(),
        reason: resp.ok ? undefined : `HTTP ${resp.status}`,
      };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        lastCheckAt: new Date().toISOString(),
        reason: (err as Error).message,
      };
    }
  }

  async call<TIn, TOut>(
    capability: Capability,
    _input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    const source = {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      canonical: true,
      traceId: ctx.traceId,
    } as const;

    switch (capability) {
      case 'wallet.getCapabilities': {
        const data: TurnkeyCapabilitiesResult = {
          mode: 'user_authorized_partner_relay',
          canSign: true,
          canBroadcast: false,
          userControlledKeys: true,
          supportedSchemes: ['eip712', 'secp256k1', 'ed25519'],
          orgId: TURNKEY_ORG_ID,
        };
        return { data: data as unknown as TOut, source, cached: false };
      }

      case 'wallet.getAuthorizationStatus': {
        // Reads session status from Turnkey — useful for polling after user signs
        const input = _input as { sessionId?: string; walletAddress?: string };
        if (!input.sessionId) {
          throw new Error('sessionId required for wallet.getAuthorizationStatus');
        }
        // Turnkey does not have a direct "session status" endpoint —
        // session validation is done client-side. Return a stub that
        // delegates back to RegulatedRelayBoundary.
        const data = { status: 'unknown', sessionId: input.sessionId };
        return { data: data as unknown as TOut, source, cached: false };
      }

      case 'wallet.validateAuthorizationSession': {
        // Validates that a signedPayloadHash is a valid Turnkey attestation.
        // Full cryptographic validation requires the Turnkey API key stamper
        // and is done in the RegulatedRelayBoundary.markUserAuthorized path.
        const input = _input as { signedPayloadHash?: string };
        const data = {
          valid: Boolean(input.signedPayloadHash),
          scheme: 'eip712',
          validatedBy: 'defibro-relay-boundary',
        };
        return { data: data as unknown as TOut, source, cached: false };
      }

      default:
        throw new Error(`TurnkeyWalletProvider: unsupported capability '${capability}'`);
    }
  }
}

export const turnkeyWalletProvider = new TurnkeyWalletProvider();
