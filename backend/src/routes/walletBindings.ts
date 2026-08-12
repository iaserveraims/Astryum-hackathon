import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import {
  decode,
  encodeForSigning,
  deriveAddress,
  verifyKeypairSignature,
  convertHexToString,
  isValidClassicAddress,
} from 'xrpl';
import { z } from 'zod';
import { requireSiweAuth } from '../middleware/requireSiweAuth';
import { asyncHandler } from '../middleware/asyncHandler';
import { prisma } from '../database/prismaClient';
import { personaKYCProvider } from '../services/PersonaKYCProvider';

/**
 * XRPL addresses are case-sensitive base58 — never lowercase them. EVM addresses
 * are case-insensitive and stored lowercased. Normalise per chain so the pending
 * nonce, the binding row and the `wallets` table all key on the same string.
 */
function normalizeAddress(address: string, chainType: string): string {
  return chainType === 'evm' ? address.toLowerCase() : address;
}

/**
 * Verify an XRPL ownership proof produced by Xaman.
 *
 * The user signs (submit:false) an AccountSet pseudo-transaction whose Memo
 * carries our binding message (which embeds the single-use nonce). We:
 *   1. decode the signed blob,
 *   2. re-derive the signing data and verify the signature is valid,
 *   3. confirm the signer (deriveAddress(SigningPubKey)) IS the claimed account,
 *   4. confirm the Memo commits to our nonce (replay protection).
 *
 * This is fully self-contained — no Xaman secret, no network call. Astryum never
 * signs: the user signed in their own Xaman app; we only verify the proof.
 *
 * NOTE: master-key signing only. An account that delegated signing to a XRPL
 * RegularKey would derive a different address and is intentionally rejected.
 */
function verifyXrplOwnershipProof(
  signedTxHex: string,
  expectedAddress: string,
  expectedNonce: string,
): { ok: boolean; reason?: string } {
  let tx: any;
  try {
    tx = decode(signedTxHex);
  } catch {
    return { ok: false, reason: 'DECODE_FAILED' };
  }

  const pubKey = tx?.SigningPubKey;
  const txnSignature = tx?.TxnSignature;
  if (typeof pubKey !== 'string' || !pubKey || typeof txnSignature !== 'string' || !txnSignature) {
    return { ok: false, reason: 'NOT_SINGLE_SIG' };
  }

  // Re-create the exact bytes the wallet signed (everything except TxnSignature).
  const { TxnSignature, ...unsigned } = tx;
  let signingData: string;
  try {
    signingData = encodeForSigning(unsigned as any);
  } catch {
    return { ok: false, reason: 'ENCODE_FAILED' };
  }

  let valid = false;
  try {
    valid = verifyKeypairSignature(signingData, txnSignature, pubKey);
  } catch {
    return { ok: false, reason: 'VERIFY_THREW' };
  }
  if (!valid) return { ok: false, reason: 'SIGNATURE_INVALID' };

  // The signer must be the very account we are binding.
  let signer: string;
  try {
    signer = deriveAddress(pubKey);
  } catch {
    return { ok: false, reason: 'DERIVE_FAILED' };
  }
  if (signer !== expectedAddress) return { ok: false, reason: 'SIGNER_MISMATCH' };
  if (tx.Account && tx.Account !== expectedAddress) return { ok: false, reason: 'ACCOUNT_MISMATCH' };

  // The signed Memo must commit to our nonce → the proof can't be replayed.
  const memos: any[] = Array.isArray(tx.Memos) ? tx.Memos : [];
  const memoCommitsToNonce = memos.some((m) => {
    const data = m?.Memo?.MemoData;
    if (typeof data !== 'string') return false;
    try {
      return convertHexToString(data).includes(expectedNonce);
    } catch {
      return false;
    }
  });
  if (!memoCommitsToNonce) return { ok: false, reason: 'NONCE_NOT_IN_MEMO' };

  return { ok: true };
}

const router = Router();
router.use(requireSiweAuth);

// In-memory nonce store: nonce → { address, chainType, expiresAt }
// Cleared on confirmation or expiry.
interface PendingNonce {
  address: string;
  chainType: string;
  expiresAt: number;
}
const pendingNonces = new Map<string, PendingNonce>();
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function purgePendingNonces(): void {
  const now = Date.now();
  for (const [n, e] of pendingNonces) {
    if (e.expiresAt < now) pendingNonces.delete(n);
  }
}

function buildBindingMessage(address: string, nonce: string, timestamp: string): string {
  return [
    'Astryum Wallet Binding',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${timestamp}`,
    'By signing you prove ownership of this wallet. No funds are moved.',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wallets/bindings
// List all active bindings for the authenticated user.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.siwe!.userId;
  const bindings = await prisma.walletBinding.findMany({
    where: { userId, isActive: true },
    orderBy: { linkedAt: 'desc' },
    select: {
      id: true,
      address: true,
      chainType: true,
      label: true,
      mode: true,
      linkedAt: true,
      lastSeenAt: true,
    },
  });
  return res.json({ bindings });
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/wallets/bindings/initiate
// Generate a nonce + message for the wallet to sign. EVM only for now.
// Body: { address: string, chainType: 'evm' | 'solana' | 'xrpl' }
// ─────────────────────────────────────────────────────────────────────────────
const initiateSchema = z.object({
  address: z.string().min(1),
  chainType: z.enum(['evm', 'solana', 'xrpl', 'bitcoin']),
});

router.post('/initiate', async (req: Request, res: Response) => {
  const parsed = initiateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.issues });
  }

  const { address, chainType } = parsed.data;

  // EVM (personal_sign) and XRPL (Xaman ownership proof) are supported. Other
  // chains still need a verifier before they can be bound.
  if (chainType !== 'evm' && chainType !== 'xrpl') {
    return res.status(422).json({
      error: 'CHAIN_TYPE_NOT_SUPPORTED',
      detail: `Binding via ${chainType} is not yet supported. EVM and XRPL only.`,
    });
  }

  if (chainType === 'evm' && !/^0x[a-fA-F0-9]{40}$/i.test(address)) {
    return res.status(400).json({ error: 'INVALID_EVM_ADDRESS' });
  }
  if (chainType === 'xrpl' && !isValidClassicAddress(address)) {
    return res.status(400).json({ error: 'INVALID_XRPL_ADDRESS' });
  }

  purgePendingNonces();

  const normAddress = normalizeAddress(address, chainType);
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = new Date().toISOString();
  const expiresAt = Date.now() + NONCE_TTL_MS;

  pendingNonces.set(nonce, { address: normAddress, chainType, expiresAt });

  const message = buildBindingMessage(normAddress, nonce, timestamp);

  return res.json({
    nonce,
    message,
    expiresAt: new Date(expiresAt).toISOString(),
    instruction:
      chainType === 'evm'
        ? 'Sign this message with personal_sign (eth_sign) in your wallet.'
        : 'Sign the ownership-proof transaction in Xaman. No funds are moved.',
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/wallets/bindings/confirm
// Verify signature, create/update the binding.
// Body: { nonce, message, signature, address, chainType, label?, mode? }
// ─────────────────────────────────────────────────────────────────────────────
const confirmSchema = z.object({
  nonce: z.string().min(1),
  message: z.string().min(1),
  // EVM proof: a 0x personal_sign signature over `message`.
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/, 'signature must be 0x-hex').optional(),
  // XRPL proof: the hex of a Xaman-signed (submit:false) tx whose Memo commits to the nonce.
  signedTxHex: z.string().regex(/^[a-fA-F0-9]+$/, 'signedTxHex must be hex').optional(),
  address: z.string().min(1),
  chainType: z.enum(['evm', 'solana', 'xrpl', 'bitcoin']),
  label: z.string().max(64).optional(),
  mode: z.enum(['read', 'read_and_receive']).default('read'),
});

router.post('/confirm', async (req: Request, res: Response) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.issues });
  }

  const { nonce, message, signature, signedTxHex, address, chainType, label, mode } = parsed.data;

  if (chainType !== 'evm' && chainType !== 'xrpl') {
    return res.status(422).json({
      error: 'CHAIN_TYPE_NOT_SUPPORTED',
      detail: `Binding via ${chainType} is not yet supported. EVM and XRPL only.`,
    });
  }

  const normAddress = normalizeAddress(address, chainType);

  // 1. Validate nonce
  purgePendingNonces();
  const pending = pendingNonces.get(nonce);
  if (!pending) {
    return res.status(422).json({
      error: 'NONCE_EXPIRED_OR_UNKNOWN',
      detail: 'Call /initiate first. Nonce expires after 5 minutes.',
    });
  }
  if (pending.address !== normAddress || pending.chainType !== chainType) {
    return res.status(422).json({ error: 'NONCE_ADDRESS_MISMATCH' });
  }

  // 2. Verify ownership proof (per chain)
  if (chainType === 'evm') {
    if (!signature) {
      return res.status(400).json({ error: 'SIGNATURE_REQUIRED', detail: 'EVM binding needs a signature.' });
    }
    let recovered: string;
    try {
      recovered = ethers.verifyMessage(message, signature);
    } catch {
      return res.status(422).json({ error: 'SIGNATURE_VERIFICATION_FAILED' });
    }
    if (recovered.toLowerCase() !== normAddress) {
      return res.status(422).json({
        error: 'SIGNATURE_ADDRESS_MISMATCH',
        detail: 'The signature was not produced by the stated address.',
      });
    }
  } else {
    // XRPL — verify the Xaman-signed ownership proof.
    if (!signedTxHex) {
      return res.status(400).json({ error: 'SIGNED_TX_REQUIRED', detail: 'XRPL binding needs signedTxHex.' });
    }
    const verdict = verifyXrplOwnershipProof(signedTxHex, normAddress, nonce);
    if (!verdict.ok) {
      return res.status(422).json({ error: 'XRPL_PROOF_INVALID', detail: verdict.reason });
    }
  }

  // 3. Consume nonce — single-use
  pendingNonces.delete(nonce);

  // 4. Upsert binding
  const userId = req.siwe!.userId;
  try {
    // Check if user is KYC verified — if so, mark this binding as kycLinked immediately
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { kycVerified: true, personaInquiryId: true },
    });
    const isKycVerified = user?.kycVerified ?? false;
    const personaInquiryId = user?.personaInquiryId ?? null;

    // The proof we persist depends on the chain: EVM signature, or the XRPL
    // Xaman-signed blob.
    const proof = chainType === 'evm' ? signature : signedTxHex;

    const binding = await prisma.walletBinding.upsert({
      where: { userId_address_chainType: { userId, address: normAddress, chainType } },
      create: {
        userId,
        address: normAddress,
        chainType,
        label,
        mode,
        signatureProof: proof,
        isActive: true,
        kycLinked: isKycVerified,
        kycLinkedAt: isKycVerified ? new Date() : null,
      },
      update: {
        label,
        mode,
        signatureProof: proof,
        isActive: true,
        linkedAt: new Date(),
        // Only update kycLinked if newly becoming linked
        ...(isKycVerified ? { kycLinked: true, kycLinkedAt: new Date() } : {}),
      },
      select: {
        id: true,
        address: true,
        chainType: true,
        label: true,
        mode: true,
        linkedAt: true,
        kycLinked: true,
      },
    });

    // Keep the unified `wallets` table in sync: a read_and_receive binding is the
    // signature-proof that upgrades a read-only wallet to tx-capable. The bundle
    // router reads Wallet.purpose, so promote watch/destination_only → both.
    if (mode === 'read_and_receive') {
      await prisma.wallet.updateMany({
        where: { userId, address: normAddress, purpose: { in: ['watch', 'destination_only'] } },
        data: { purpose: 'both' },
      });
    }

    // Async: notify Persona so the audit trail in their dashboard shows all linked wallets.
    // Non-blocking — local DB binding is already saved. Persona tag is supplemental.
    if (isKycVerified && personaInquiryId) {
      personaKYCProvider
        .tagWalletLinked(personaInquiryId, normAddress, chainType)
        .catch(err =>
          console.warn('[walletBindings] Persona tag (non-fatal):', err?.message),
        );
    }

    return res.status(201).json({ binding });
  } catch (err: any) {
    return res.status(500).json({ error: 'BINDING_CREATE_FAILED', detail: err?.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/wallets/bindings/:id/mode
// Switch between 'read' and 'read_and_receive'.
// Body: { mode: 'read' | 'read_and_receive' }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/mode', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.siwe!.userId;
  const modeVal = req.body?.mode;

  if (modeVal !== 'read' && modeVal !== 'read_and_receive') {
    return res.status(400).json({
      error: 'INVALID_MODE',
      detail: "mode must be 'read' or 'read_and_receive'",
    });
  }

  const existing = await prisma.walletBinding.findFirst({
    where: { id: req.params.id, userId, isActive: true },
  });
  if (!existing) return res.status(404).json({ error: 'BINDING_NOT_FOUND' });

  const updated = await prisma.walletBinding.update({
    where: { id: req.params.id },
    data: { mode: modeVal },
    select: { id: true, address: true, chainType: true, mode: true },
  });

  // Mirror the capability change onto the unified `wallets` table.
  if (modeVal === 'read') {
    await prisma.wallet.updateMany({
      where: { userId, address: existing.address.toLowerCase(), purpose: 'both' },
      data: { purpose: 'watch' },
    });
  } else {
    await prisma.wallet.updateMany({
      where: { userId, address: existing.address.toLowerCase(), purpose: { in: ['watch', 'destination_only'] } },
      data: { purpose: 'both' },
    });
  }

  return res.json({ binding: updated });
}));

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/wallets/bindings/:id
// Soft-delete (deactivate) a binding.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.siwe!.userId;

  const existing = await prisma.walletBinding.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true, address: true, chainType: true, kycLinked: true },
  });
  if (!existing) return res.status(404).json({ error: 'BINDING_NOT_FOUND' });

  await prisma.walletBinding.update({
    where: { id: req.params.id },
    data: { isActive: false, kycLinked: false },
  });

  // Revoking the tx-binding demotes the wallet back to read-only in the list.
  await prisma.wallet.updateMany({
    where: { userId, address: existing.address.toLowerCase(), purpose: 'both' },
    data: { purpose: 'watch' },
  });

  // Async: remove Persona tag if the wallet was KYC-linked
  if (existing.kycLinked) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { personaInquiryId: true },
    });
    if (user?.personaInquiryId) {
      personaKYCProvider
        .untagWalletLinked(user.personaInquiryId, existing.address, existing.chainType)
        .catch(err =>
          console.warn('[walletBindings] Persona untag (non-fatal):', err?.message),
        );
    }
  }

  return res.status(204).send();
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/wallets/bindings/request-auth
// Check if wallet has a read_and_receive binding before sensitive actions.
// Body: { address: string, chainType: string }
// Returns: { authorized: bool, bindingId?, mode? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/request-auth', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.siwe!.userId;
  const { address, chainType } = req.body as { address?: string; chainType?: string };

  if (!address || !chainType) {
    return res.status(400).json({ error: 'address and chainType required' });
  }

  const binding = await prisma.walletBinding.findFirst({
    where: {
      userId,
      address: address.toLowerCase(),
      chainType,
      isActive: true,
    },
    select: { id: true, mode: true, lastSeenAt: true },
  });

  if (!binding) {
    return res.json({
      authorized: false,
      reason: 'NO_BINDING',
      detail: 'This wallet has not been linked. Call /initiate → /confirm first.',
    });
  }

  if (binding.mode !== 'read_and_receive') {
    return res.json({
      authorized: false,
      reason: 'MODE_READ_ONLY',
      detail: "Binding is in 'read' mode. Switch to 'read_and_receive' to authorize actions.",
      bindingId: binding.id,
    });
  }

  // Touch lastSeenAt
  await prisma.walletBinding.update({
    where: { id: binding.id },
    data: { lastSeenAt: new Date() },
  });

  return res.json({ authorized: true, bindingId: binding.id, mode: binding.mode });
}));

export default router;
