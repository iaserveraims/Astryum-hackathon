import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import { prisma } from '../database/prismaClient';
import { assertSignupAllowed } from '../config/betaGate';

const NONCE_TTL_MS = 5 * 60 * 1000;     // 5 min to use a nonce
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h session
const JWT_TTL = '24h';

// JWT_SECRET fail-loud in production (Sprint S1.3). In dev we allow a default
// so the test suite + local dev keep working without touching .env.
export function resolveJwtSecret(): string {
  const explicit = process.env.JWT_SECRET;
  if (explicit && explicit.length >= 32) return explicit;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET is missing or too short (>= 32 chars required) in production. ' +
        'Generate with: openssl rand -base64 64'
    );
  }
  // dev fallback only
  return explicit || 'dev-secret-change-me-32-chars-min-fallback';
}
const JWT_SECRET = resolveJwtSecret();

const APP_DOMAIN = process.env.APP_DOMAIN || 'localhost:3000';
const SIWE_URI = process.env.SIWE_URI || 'http://localhost:3000';
const CHAIN_ID = 14;

interface NonceEntry {
  address: string;
  chainId: number;
  expiresAt: number;
}
const nonces = new Map<string, NonceEntry>();

function purgeExpiredNonces(): void {
  const now = Date.now();
  for (const [n, e] of nonces) if (e.expiresAt < now) nonces.delete(n);
}

export interface SiweMessageInput {
  address: string;       // 0x-prefixed
  domain?: string;
  uri?: string;
  chainId?: number;
}

export interface SiweVerifyInput {
  address: string;
  message: string;       // the full SIWE-style message the user signed
  signature: string;     // 0x... 65-byte
  nonce: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface LinkedWallet {
  id: string;
  address: string;
  chainType: string;
  label: string | null;
  mode: string;
  linkedAt: Date;
}

export interface SiweVerifyResult {
  token: string;
  sessionId: string;
  walletAddress: string;
  chainId: number;
  expiresAt: Date;
  linkedWallets: LinkedWallet[];
}

/**
 * Issue a one-time nonce bound to an address. Lasts NONCE_TTL_MS.
 * chainId is the chain the wallet is currently on — stored so buildSiweMessage
 * can reflect it accurately. Authentication works on any EVM chain.
 */
export function issueNonce(
  address: string,
  chainId?: number
): { nonce: string; expiresAt: number; chainId: number } {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw Object.assign(new Error('invalid_address'), { code: 'invalid_address' });
  }
  purgeExpiredNonces();
  const resolvedChainId = chainId ?? 1; // default Ethereum mainnet — any EVM chain is valid for identity
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + NONCE_TTL_MS;
  nonces.set(nonce, { address: address.toLowerCase(), chainId: resolvedChainId, expiresAt });
  return { nonce, expiresAt, chainId: resolvedChainId };
}

/**
 * Build the canonical SIWE-style message the client must sign.
 * EIP-4361 minimal subset (no resources, no notBefore).
 */
export function buildSiweMessage(input: SiweMessageInput, nonce: string, issuedAt: Date): string {
  const domain = input.domain || APP_DOMAIN;
  const uri = input.uri || SIWE_URI;
  const chainId = input.chainId ?? CHAIN_ID;
  const addr = ethers.getAddress(input.address); // checksum
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    addr,
    '',
    'Sign in to Defibro.',
    '',
    `URI: ${uri}`,
    'Version: 1',
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
  ].join('\n');
}

/**
 * Verify a signed SIWE message and create/refresh a Session + JWT.
 * Throws Error with code: invalid_address | nonce_unknown | nonce_expired |
 *   nonce_address_mismatch | signature_invalid | persistence_failed
 */
export async function verifySiweAndIssueToken(
  input: SiweVerifyInput
): Promise<SiweVerifyResult> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.address)) {
    throw Object.assign(new Error('invalid_address'), { code: 'invalid_address' });
  }

  purgeExpiredNonces();
  const entry = nonces.get(input.nonce);
  if (!entry) {
    throw Object.assign(new Error('nonce_unknown'), { code: 'nonce_unknown' });
  }
  if (entry.expiresAt < Date.now()) {
    nonces.delete(input.nonce);
    throw Object.assign(new Error('nonce_expired'), { code: 'nonce_expired' });
  }
  if (entry.address !== input.address.toLowerCase()) {
    throw Object.assign(new Error('nonce_address_mismatch'), { code: 'nonce_address_mismatch' });
  }

  // ethers v6: verifyMessage returns the recovered checksummed address
  let recovered: string;
  try {
    recovered = ethers.verifyMessage(input.message, input.signature);
  } catch {
    throw Object.assign(new Error('signature_invalid'), { code: 'signature_invalid' });
  }
  if (recovered.toLowerCase() !== input.address.toLowerCase()) {
    throw Object.assign(new Error('signature_invalid'), { code: 'signature_invalid' });
  }

  // Sanity: the nonce inside the message must match the one we hold
  if (!input.message.includes(`Nonce: ${input.nonce}`)) {
    throw Object.assign(new Error('signature_invalid'), { code: 'signature_invalid' });
  }

  // Burn the nonce (one-shot) and capture the chainId it was issued with
  const signingChainId = entry.chainId;
  nonces.delete(input.nonce);

  // Resolve User by EVM address (creates one with xrplAddress placeholder if missing)
  const userId = await getOrCreateUserByEvmAddress(input.address.toLowerCase());

  // The SIWE signature proves ownership of this wallet, so record a
  // read_and_receive binding: the login wallet is immediately usable for read
  // AND write. The per-transaction confirmation in the user's own wallet remains
  // the execution gate (Astryum never signs/broadcasts). Non-fatal on failure —
  // login still succeeds and the wallet can be enabled manually.
  try {
    await prisma.walletBinding.upsert({
      where: {
        userId_address_chainType: {
          userId,
          address: input.address.toLowerCase(),
          chainType: 'evm',
        },
      },
      create: {
        userId,
        address: input.address.toLowerCase(),
        chainType: 'evm',
        mode: 'read_and_receive',
        signatureProof: input.signature,
        isActive: true,
      },
      update: { mode: 'read_and_receive', isActive: true },
      select: { id: true },
    });
  } catch {
    /* non-fatal */
  }

  const session = await issueSessionForUser(userId, input.address.toLowerCase(), {
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return { ...session, chainId: signingChainId };
}

export interface IssuedSession {
  token: string;
  sessionId: string;
  walletAddress: string;
  expiresAt: Date;
  linkedWallets: LinkedWallet[];
}

/**
 * Create a Session row + signed JWT for an already-resolved user. Shared by SIWE,
 * passkey, and email/password logins so the session shape never drifts.
 * `walletAddress` is empty for wallet-less accounts (email / passkey only) — the
 * JWT still carries an `addr` claim (empty string) so middleware stays uniform.
 */
export async function issueSessionForUser(
  userId: string,
  walletAddress: string | null | undefined,
  opts: { ipAddress?: string; userAgent?: string } = {}
): Promise<IssuedSession> {
  const addr = (walletAddress ?? '').toLowerCase();
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await prisma.session.create({
    data: {
      userId,
      token: sessionToken,
      ipAddress: opts.ipAddress ?? 'unknown',
      userAgent: opts.userAgent,
      isActive: true,
      lastActivity: new Date(),
      expiresAt,
    },
    // select only id to avoid P2022 if refreshToken column isn't yet in the DB
    select: { id: true },
  });

  // JWT carries sessionId so revocation works (token alone doesn't validate)
  const token = jwt.sign(
    { sub: userId, sid: session.id, addr },
    JWT_SECRET,
    { expiresIn: JWT_TTL }
  );

  const linkedWallets = await getLinkedWallets(userId);

  return { token, sessionId: session.id, walletAddress: addr, expiresAt, linkedWallets };
}

export interface VerifiedToken {
  userId: string;
  sessionId: string;
  walletAddress: string;
}

/**
 * Verify a JWT issued by us, AND check the underlying Session is still active.
 * Throws Error with code: token_invalid | token_expired | session_not_found |
 *   session_revoked | session_expired
 */
export async function verifyToken(jwtToken: string): Promise<VerifiedToken> {
  let payload: any;
  try {
    payload = jwt.verify(jwtToken, JWT_SECRET);
  } catch (err: any) {
    if (err?.name === 'TokenExpiredError') {
      throw Object.assign(new Error('token_expired'), { code: 'token_expired' });
    }
    throw Object.assign(new Error('token_invalid'), { code: 'token_invalid' });
  }
  const sid = payload?.sid;
  const sub = payload?.sub;
  // addr is empty for wallet-less accounts (email / passkey logins) — allowed.
  const addr = payload?.addr ?? '';
  if (!sid || !sub || addr === undefined || addr === null) {
    throw Object.assign(new Error('token_invalid'), { code: 'token_invalid' });
  }
  const session = await prisma.session.findUnique({ where: { id: sid } });
  if (!session) {
    throw Object.assign(new Error('session_not_found'), { code: 'session_not_found' });
  }
  if (!session.isActive) {
    throw Object.assign(new Error('session_revoked'), { code: 'session_revoked' });
  }
  if (session.expiresAt < new Date()) {
    throw Object.assign(new Error('session_expired'), { code: 'session_expired' });
  }
  // touch lastActivity (best-effort)
  prisma.session
    .update({ where: { id: sid }, data: { lastActivity: new Date() } })
    .catch(() => undefined);

  return { userId: sub, sessionId: sid, walletAddress: addr };
}

/**
 * Revoke a session (logout).
 */
export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { isActive: false },
  });
}

/**
 * Return all active WalletBindings for a user — used to surface linked wallets
 * on login and /me without re-querying everywhere.
 */
export async function getLinkedWallets(userId: string): Promise<LinkedWallet[]> {
  return prisma.walletBinding.findMany({
    where: { userId, isActive: true },
    orderBy: { linkedAt: 'asc' },
    select: { id: true, address: true, chainType: true, label: true, mode: true, linkedAt: true },
  });
}

/**
 * Lookup or create a User keyed by EVM address.
 *
 * xrplAddress is now nullable (multichain schema). EVM-only users get a
 * "siwe:0x..." synthetic xrplAddress so the unique constraint still works
 * as a stable identity key. Real wallet addresses live in wallets/wallet_bindings.
 */
async function getOrCreateUserByEvmAddress(evmAddress: string): Promise<string> {
  const placeholder = `siwe:${evmAddress.toLowerCase()}`;
  const existing = await prisma.user.findUnique({
    where: { xrplAddress: placeholder },
    select: { id: true },
  });
  if (existing) return existing.id;
  // Closed beta: wallet-first signup has no email to approve, so while the
  // gate is closed a NEW wallet cannot mint an account — existing wallet
  // users keep logging in, approved users bind wallets inside the app.
  await assertSignupAllowed(null);
  const created = await prisma.user.create({
    data: {
      xrplAddress: placeholder,
      authProvider: 'wallet',
      isActive: true,
      lastLogin: new Date(),
    },
    select: { id: true },
  });
  return created.id;
}

// ─── Xaman (XUMM) login ──────────────────────────────────────────────────────

export interface XamanVerifyResult {
  token: string;
  sessionId: string;
  xrplAddress: string;
  expiresAt: Date;
}

/**
 * Verify a signed Xaman payload and exchange it for a Astryum JWT.
 *
 * Flow:
 *   1. Call Xaman API to check payload status
 *   2. Confirm meta.signed === true
 *   3. Extract the signer's XRPL address (response.account)
 *   4. Find or create User by xrplAddress
 *   5. Upsert Wallet record for the XRPL address
 *   6. Create Session + issue JWT
 */
export async function verifyXamanPayload(
  uuid: string,
  opts: { ipAddress?: string; userAgent?: string } = {}
): Promise<XamanVerifyResult> {
  const apiKey    = process.env.XAMAN_API_KEY    ?? process.env.NEXT_PUBLIC_XAMAN_API_KEY;
  const apiSecret = process.env.XAMAN_API_SECRET ?? process.env.NEXT_PUBLIC_XAMAN_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw Object.assign(new Error('xaman_not_configured'), { code: 'xaman_not_configured' });
  }

  const res = await fetch(`https://xumm.app/api/v1/platform/payload/${uuid}`, {
    headers: { 'X-API-Key': apiKey, 'X-API-Secret': apiSecret },
  });
  if (!res.ok) {
    throw Object.assign(new Error('xaman_api_error'), { code: 'xaman_api_error', status: res.status });
  }

  const payload = await res.json() as {
    meta: { signed: boolean; cancelled: boolean; expired: boolean };
    response: { account: string };
  };

  if (payload.meta.cancelled) throw Object.assign(new Error('payload_cancelled'), { code: 'payload_cancelled' });
  if (payload.meta.expired)   throw Object.assign(new Error('payload_expired'),   { code: 'payload_expired' });
  if (!payload.meta.signed)   throw Object.assign(new Error('payload_unsigned'),  { code: 'payload_unsigned' });

  const xrplAddress = payload.response.account; // e.g. "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"
  if (!xrplAddress) throw Object.assign(new Error('no_account'), { code: 'no_account' });

  // Find or create User keyed by XRPL address
  let user = await prisma.user.findUnique({ where: { xrplAddress }, select: { id: true } });
  if (!user) {
    // Closed beta: same rule as the SIWE create above — no email, no seat.
    await assertSignupAllowed(null);
    user = await prisma.user.create({
      data: { xrplAddress, authProvider: 'wallet', isActive: true, lastLogin: new Date() },
      select: { id: true },
    });
  } else {
    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
  }

  // Register wallet if not already present
  await prisma.wallet.upsert({
    where:  { userId_address_network: { userId: user.id, address: xrplAddress, network: 'xrpl' } },
    update: { isConnected: true, lastActivity: new Date(), caip2: 'xrpl:0' },
    create: {
      userId:      user.id,
      walletType:  'xaman',
      address:     xrplAddress,
      network:     'xrpl',
      caip2:       'xrpl:0',
      chainId:     -1,
      isConnected: true,
      permissions: { canSign: true, canReceive: true },
    },
  });

  // Session + JWT (same pattern as SIWE)
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const expiresAt    = new Date(Date.now() + SESSION_TTL_MS);
  const session      = await prisma.session.create({
    data: {
      userId:    user.id,
      token:     sessionToken,
      ipAddress: opts.ipAddress ?? 'unknown',
      userAgent: opts.userAgent,
      isActive:  true,
      lastActivity: new Date(),
      expiresAt,
    },
    select: { id: true },
  });

  const JWT_SECRET = resolveJwtSecret();
  const token = jwt.sign(
    { sub: user.id, sid: session.id, addr: xrplAddress },
    JWT_SECRET,
    { expiresIn: JWT_TTL }
  );

  return { token, sessionId: session.id, xrplAddress, expiresAt };
}
