/**
 * TurnkeyEmbeddedService — D1 "create" gate (embedded wallet).
 *
 * Creates a user-controlled embedded wallet via a Turnkey SUB-ORGANIZATION whose
 * ROOT authenticator is the USER'S OWN passkey (registered client-side via WebAuthn).
 *
 * REGULATORY INVARIANTS (CLAUDE.md §1, §12):
 *  - The private key is generated inside Turnkey's TEE and is NEVER seen by the
 *    Astryum backend or client. We only pass the user's passkey ATTESTATION
 *    (a public credential) to create the sub-org.
 *  - The user is the sole root user of the sub-org → exclusive control.
 *  - Keys are EXPORTABLE by the user (sovereignty test: if Turnkey disappears,
 *    the user recovers alone). The export flow runs client-side; the backend
 *    never receives the exported material.
 *
 * The parent-org API key (TURNKEY_API_PRIVATE_KEY) is a SERVER secret used only to
 * create the sub-org. It does NOT grant Astryum signing power over the user's wallet
 * (the user's passkey is the root authenticator).
 *
 * ACTIVATION: requires `@turnkey/sdk-server` installed + TURNKEY_ORG_ID /
 * TURNKEY_API_PUBLIC_KEY / TURNKEY_API_PRIVATE_KEY set. Until then the service is
 * "not configured" and the create gate is cleanly DISABLED — we never surface a
 * fake/placeholder embedded wallet as if it were real.
 */

/** WebAuthn passkey attestation, produced client-side and forwarded verbatim. */
export interface PasskeyAttestation {
  /** Turnkey challenge the credential was created against. */
  challenge: string;
  attestation: {
    credentialId: string;
    clientDataJson: string;
    attestationObject: string;
    transports?: string[];
  };
  /** Optional human label / contact — never used as an authenticator. */
  authenticatorName?: string;
  email?: string;
}

export interface EmbeddedWalletResult {
  subOrgId: string;
  address: string;
}

/** Minimal seam over the Turnkey server SDK so the service is unit-testable. */
export interface TurnkeySubOrgClient {
  createSubOrgWithWallet(input: {
    userId: string;
    passkey: PasskeyAttestation;
  }): Promise<EmbeddedWalletResult>;
}

export class TurnkeyNotConfiguredError extends Error {
  readonly code = 'TURNKEY_NOT_CONFIGURED';
  constructor(reason: string) {
    super(`Turnkey embedded wallet not configured: ${reason}`);
    this.name = 'TurnkeyNotConfiguredError';
  }
}

export class TurnkeyEmbeddedService {
  constructor(private readonly clientFactory?: () => Promise<TurnkeySubOrgClient>) {}

  /** True only when the server has everything needed to create a real sub-org. */
  isConfigured(): boolean {
    return Boolean(
      process.env.TURNKEY_ORG_ID &&
        process.env.TURNKEY_API_PUBLIC_KEY &&
        process.env.TURNKEY_API_PRIVATE_KEY,
    );
  }

  /** Why the gate is unavailable (for the status endpoint). */
  unavailableReason(): string | null {
    if (process.env.TURNKEY_ORG_ID && process.env.TURNKEY_API_PUBLIC_KEY && process.env.TURNKEY_API_PRIVATE_KEY) {
      return null;
    }
    return 'TURNKEY_ORG_ID / TURNKEY_API_PUBLIC_KEY / TURNKEY_API_PRIVATE_KEY not set';
  }

  /**
   * Create the user's embedded wallet. The user's passkey is the root
   * authenticator — Astryum never holds the key. Throws TurnkeyNotConfiguredError
   * when Turnkey isn't wired (caller maps that to a clean 503, NOT a fake wallet).
   */
  async createWallet(userId: string, passkey: PasskeyAttestation): Promise<EmbeddedWalletResult> {
    const reason = this.unavailableReason();
    if (reason) throw new TurnkeyNotConfiguredError(reason);
    if (!passkey?.attestation?.credentialId || !passkey?.challenge) {
      throw new Error('PASSKEY_ATTESTATION_REQUIRED');
    }

    const factory = this.clientFactory ?? defaultClientFactory;
    const client = await factory();
    return client.createSubOrgWithWallet({ userId, passkey });
  }
}

/**
 * Lazily builds the real Turnkey-backed client (typed against @turnkey/sdk-server).
 * The import is lazy so the SDK only loads when a wallet is actually created.
 *
 * NOTE: the createSubOrganization BODY is large + version-specific, so the apiClient
 * call is cast to `any`; the import + constructor are fully typed/verified. Re-check
 * the body against the @turnkey/sdk-server version on upgrades.
 */
async function defaultClientFactory(): Promise<TurnkeySubOrgClient> {
  const { Turnkey, DEFAULT_ETHEREUM_ACCOUNTS } = await import('@turnkey/sdk-server');

  const turnkey = new Turnkey({
    apiBaseUrl: process.env.TURNKEY_BASE_URL ?? 'https://api.turnkey.com',
    apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
    apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.TURNKEY_ORG_ID!,
  });

  return {
    async createSubOrgWithWallet({ userId, passkey }) {
      const apiClient = turnkey.apiClient() as any;
      const res = await apiClient.createSubOrganization({
        subOrganizationName: `defibro-user-${userId}`,
        rootUsers: [
          {
            userName: passkey.authenticatorName ?? `defibro-${userId}`,
            userEmail: passkey.email,
            apiKeys: [],
            oauthProviders: [],
            authenticators: [
              {
                authenticatorName: passkey.authenticatorName ?? 'passkey',
                challenge: passkey.challenge,
                attestation: {
                  credentialId: passkey.attestation.credentialId,
                  clientDataJson: passkey.attestation.clientDataJson,
                  attestationObject: passkey.attestation.attestationObject,
                  transports: passkey.attestation.transports ?? ['AUTHENTICATOR_TRANSPORT_HYBRID'],
                },
              },
            ],
          },
        ],
        rootQuorumThreshold: 1,
        // One EVM account; the private key is generated + held in Turnkey's TEE.
        wallet: {
          walletName: `defibro-embedded-${userId}`,
          accounts: DEFAULT_ETHEREUM_ACCOUNTS,
        },
      });

      const subOrgId: string =
        res?.subOrganizationId ?? res?.activity?.result?.createSubOrganizationResultV7?.subOrganizationId;
      const address: string =
        res?.wallet?.addresses?.[0] ??
        res?.activity?.result?.createSubOrganizationResultV7?.wallet?.addresses?.[0];

      if (!subOrgId || !address) {
        throw new Error('Turnkey createSubOrganization returned no subOrgId/address');
      }
      return { subOrgId, address };
    },
  };
}

export const turnkeyEmbeddedService = new TurnkeyEmbeddedService();
