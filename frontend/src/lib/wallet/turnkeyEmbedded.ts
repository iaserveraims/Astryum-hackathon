/**
 * turnkeyEmbedded — D1 "create" gate client.
 *
 * Creates a user-controlled embedded wallet:
 *   1. registerPasskey()        → WebAuthn passkey via Turnkey (key never leaves device)
 *   2. POST /wallets/embedded/create with the PUBLIC attestation → backend creates a
 *      Turnkey sub-org whose root authenticator is THIS passkey (exclusive user control)
 *   3. exportEmbeddedKey()      → client-side export (sovereignty test)
 *
 * The private key is generated in Turnkey's TEE and is NEVER seen by Astryum
 * (backend or client). We only move the public passkey attestation around.
 *
 * The passkey + export steps require `@turnkey/sdk-browser` + NEXT_PUBLIC_TURNKEY_ORG_ID.
 * Until those are present these throw a typed error and the UI keeps the gate disabled
 * — we never fabricate an embedded wallet.
 */

import { getApiBase } from '../env';

const API_BASE = getApiBase();
const TURNKEY_ORG_ID = process.env.NEXT_PUBLIC_TURNKEY_ORG_ID ?? '';
const TURNKEY_BASE_URL = process.env.NEXT_PUBLIC_TURNKEY_BASE_URL ?? 'https://api.turnkey.com';

function authHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface EmbeddedStatus {
  available: boolean;
  provider: string;
  custodyModel: string;
  exportable: boolean;
  reason?: string;
}

export interface PasskeyAttestation {
  challenge: string;
  attestation: {
    credentialId: string;
    clientDataJson: string;
    attestationObject: string;
    transports?: string[];
  };
  authenticatorName?: string;
}

export interface CreatedEmbeddedWallet {
  address: string;
  subOrgId: string;
}

export class TurnkeySdkMissingError extends Error {
  constructor() {
    super('TURNKEY_SDK_NOT_INSTALLED');
    this.name = 'TurnkeySdkMissingError';
  }
}

/** Backend-side availability (env keys present). Public — works pre-login. */
export async function getEmbeddedStatus(): Promise<EmbeddedStatus> {
  const res = await fetch(`${API_BASE}/wallets/embedded/status`);
  if (!res.ok) {
    return { available: false, provider: 'turnkey', custodyModel: 'user_controlled', exportable: true, reason: `HTTP ${res.status}` };
  }
  return res.json();
}

/** Whether the browser side can run (SDK org id configured). */
export function clientSideConfigured(): boolean {
  return Boolean(TURNKEY_ORG_ID);
}

/**
 * Register a passkey (WebAuthn) via Turnkey and return its PUBLIC attestation.
 * Guarded behind the optional SDK — verify the exact API against the installed
 * @turnkey/sdk-browser version before enabling in production.
 */
async function registerPasskey(): Promise<PasskeyAttestation> {
  if (!TURNKEY_ORG_ID) throw new TurnkeySdkMissingError();

  const { Turnkey } = await import('@turnkey/sdk-browser');
  const passkeyClient = new Turnkey({
    apiBaseUrl: TURNKEY_BASE_URL,
    defaultOrganizationId: TURNKEY_ORG_ID,
    rpId: window.location.hostname,
  }).passkeyClient();

  // Returns a Turnkey `Passkey` { encodedChallenge, attestation { ... } } — the
  // PUBLIC credential. The private key is created server-side inside Turnkey's TEE.
  const cred = await passkeyClient.createUserPasskey({
    publicKey: { user: { name: 'Astryum wallet', displayName: 'Astryum wallet' } },
  });

  return {
    challenge: cred.encodedChallenge,
    attestation: {
      credentialId: cred.attestation.credentialId,
      clientDataJson: cred.attestation.clientDataJson,
      attestationObject: cred.attestation.attestationObject,
      transports: cred.attestation.transports,
    },
    authenticatorName: 'Astryum passkey',
  };
}

/** Full create flow: register passkey → backend creates the user-controlled sub-org. */
export async function createEmbeddedWallet(): Promise<CreatedEmbeddedWallet> {
  const passkey = await registerPasskey();

  const res = await fetch(`${API_BASE}/wallets/embedded/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    credentials: 'include',
    body: JSON.stringify({ passkey }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.detail ?? body?.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json();
  const wallet = data?.data?.wallet;
  return { address: wallet?.address, subOrgId: data?.data?.subOrgId };
}

/**
 * Export the embedded wallet's private key/seed to the USER, client-side.
 * Sovereignty test: if Turnkey disappears, the user still recovers with this.
 * The exported material is decrypted only in the user's browser — never sent to
 * Astryum. Guarded behind the optional SDK.
 */
export async function exportEmbeddedKey(_subOrgId: string): Promise<{ note: string }> {
  if (!TURNKEY_ORG_ID) throw new TurnkeySdkMissingError();
  // Export uses the user's passkey to authorize an EXPORT_WALLET activity bound to
  // an ephemeral key generated in-browser (via @turnkey/iframe-stamper); the bundle
  // is decrypted ONLY in the user's browser — never sent to Astryum. The sovereignty
  // guarantee holds regardless: the user is root of the sub-org and can always export
  // (in-app or via Turnkey directly). Full in-app iframe export is a follow-up.
  throw new Error('EXPORT_IN_APP_PENDING');
}
