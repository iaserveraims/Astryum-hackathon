/**
 * Council proposals — the persisted inbox of governed-mode work (ADR-009).
 *
 * Quorum governance is ASYNC (compose → propose → collect signatures →
 * combine → broadcast; hours or days), so collection state must outlive a
 * browser tab. This route persists:
 *   - the PINNED unsigned tx (from XrplMultisigCoordinator — Sequence, Fee,
 *     SigningPubKey fixed, so every member signs identical bytes),
 *   - each member's signed blob, ONLY after XrplBlobVerifier passes
 *     (identity + fidelity + signature — a wrong-signer or drifted blob never
 *     lands in the inbox),
 *   - the reported tx hash after the BROWSER broadcasts.
 *
 * Prepare-only invariant intact: the server never signs, never combines,
 * never broadcasts. Blobs are public transaction material destined for the
 * ledger — never keys.
 *
 * ONE live proposal per account: the pinned Sequence goes stale the moment any
 * other tx from the account validates, so parallel proposals would lie about
 * their viability. Proposals always expire (7 days).
 */
import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import {
  decode,
  encodeForSigning,
  deriveAddress,
  verifyKeypairSignature,
  convertHexToString,
} from 'xrpl';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { prisma } from '../database/prismaClient';
import { withSourceTag } from '../config/xrplSourceTag';
import { xrplProvider } from '../integrations/providers/chain/XRPLProvider';
import {
  prepareCouncilMultisig,
  NotACouncilError,
} from '../connectors/protocols/xrpl/XrplMultisigCoordinator';
import {
  verifySignerBlob,
  BlobVerificationError,
} from '../connectors/protocols/xrpl/XrplBlobVerifier';
import { jurisdictionService } from '../services/JurisdictionService';
import { requireLegacyAccess } from '../middleware/requireLegacyAccess';

const router = Router();
// §1.3 (2026-08-02): the WHOLE proposal inbox is a council-only surface — the
// same fail-closed predicate the Legacy toggle uses, now enforced server-side.
// (Mounted after requireSiweAuth; family members are on LEGACY_ACCESS_EMAILS.)
router.use(requireLegacyAccess);

const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const xrplAddress = z.string().regex(XRPL_ADDRESS_RE, 'not an XRPL account (r…)');
const PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LIVE_STATUSES = ['collecting', 'ready'] as const;

/** Flag (#10) + geofence (#5) — same gate as the xrpl-defi prepare surface. */
function gateCouncil(region: string | null): { status: number; error: string } | null {
  if (process.env.XRPL_DEFI_ENABLED !== 'true') {
    return { status: 503, error: 'XRPL_DEFI_DISABLED' };
  }
  const geo = jurisdictionService.isDefiExecutionAllowed(region);
  if (!geo.allowed) {
    return { status: 451, error: `GEOFENCE_BLOCKED: ${geo.reason ?? 'region not allowed'}` };
  }
  return null;
}

function regionOf(req: Request): string | null {
  const r = (req.body?.region ?? req.query?.region) as unknown;
  return typeof r === 'string' && r.trim() ? r.trim() : null;
}

type SignerEntry = { account: string; weight: number };

function signerListOf(p: { signerList: unknown }): SignerEntry[] {
  return Array.isArray(p.signerList) ? (p.signerList as SignerEntry[]) : [];
}

/** Lazily expire a live proposal whose deadline passed (no cron needed). */
async function withEffectiveStatus<T extends { id: string; status: string; expiresAt: Date }>(
  p: T,
): Promise<T> {
  if ((LIVE_STATUSES as readonly string[]).includes(p.status) && p.expiresAt.getTime() < Date.now()) {
    await prisma.councilProposal.update({ where: { id: p.id }, data: { status: 'expired' } });
    return { ...p, status: 'expired' };
  }
  return p;
}

const signatureSummary = {
  select: { signerAccount: true, weight: true, signedAt: true },
  orderBy: { signedAt: 'asc' as const },
};

// ─────────────────────────────────────────────────────────────────────────────
// POST / — create a proposal: pin the tx for the council (coordinator) and
// persist it. Returns the proposal plus the simulate preflight so the proposer
// sees the ledger's dry-run before fanning out.
// ─────────────────────────────────────────────────────────────────────────────
const createSchema = z.object({
  account: xrplAddress,
  xrplTx: z.record(z.unknown()),
  title: z.string().trim().max(120).optional(),
  region: z.string().optional(),
});

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const gate = gateCouncil(regionOf(req));
  if (gate) return void res.status(gate.status).json({ error: gate.error });
  const userId = req.siwe?.userId;
  if (!userId) return void res.status(401).json({ error: 'missing_siwe_session' });
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  const { account, xrplTx, title } = parsed.data;

  const live = await prisma.councilProposal.findFirst({
    where: { account, status: { in: [...LIVE_STATUSES] }, expiresAt: { gt: new Date() } },
    select: { id: true, title: true, txType: true },
  });
  if (live) {
    return void res.status(409).json({
      error: 'LIVE_PROPOSAL_EXISTS',
      detail:
        'This account already has a proposal collecting signatures. XRPL pins one Sequence at a time — emit, withdraw or let it expire first.',
      proposalId: live.id,
    });
  }

  try {
    const prepared = await prepareCouncilMultisig(xrplProvider, {
      account,
      xrplTx: xrplTx as Record<string, unknown>,
    });
    const proposal = await prisma.councilProposal.create({
      data: {
        account,
        createdByUserId: userId,
        title: title ?? null,
        txType: String((xrplTx as { TransactionType?: unknown }).TransactionType ?? 'Unknown'),
        txjson: prepared.multisigTx as never,
        quorum: prepared.council.quorum,
        signerList: prepared.council.signers as never,
        expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
      },
      include: { signatures: signatureSummary },
    });
    return void res.status(201).json({ proposal, preflight: prepared.preflight, fee: prepared.fee });
  } catch (e) {
    if (e instanceof NotACouncilError) {
      return void res.status(409).json({ error: 'NOT_A_COUNCIL', detail: e.message });
    }
    return void res.status(400).json({ error: 'PREPARE_FAILED', detail: (e as Error).message });
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /?accounts=rA,rB[&status=live] — the inbox read. Blobs are omitted here
// (GET /:id carries them for the combining browser).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const raw = String(req.query.accounts ?? '');
  const accounts = raw
    .split(',')
    .map((a) => a.trim())
    .filter((a) => XRPL_ADDRESS_RE.test(a));
  if (accounts.length === 0) {
    return void res.status(400).json({ error: 'MISSING_ACCOUNTS', detail: 'accounts=rA,rB (XRPL r… addresses)' });
  }
  const onlyLive = req.query.status === 'live';
  const rows = await prisma.councilProposal.findMany({
    where: {
      account: { in: accounts },
      ...(onlyLive ? { status: { in: [...LIVE_STATUSES] } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { signatures: signatureSummary, positions: { select: { memberAccount: true, stance: true, comment: true } } },
  });
  const proposals = [];
  for (const row of rows) {
    const p = await withEffectiveStatus(row);
    if (onlyLive && !(LIVE_STATUSES as readonly string[]).includes(p.status)) continue;
    proposals.push(p);
  }
  return void res.json({ proposals });
}));

// GET /:id — full detail, blobs included (the combining browser needs them).
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const row = await prisma.councilProposal.findUnique({
    where: { id: req.params.id },
    include: { signatures: { orderBy: { signedAt: 'asc' } }, positions: true },
  });
  if (!row) return void res.status(404).json({ error: 'NOT_FOUND' });
  return void res.json({ proposal: await withEffectiveStatus(row) });
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/signatures — a member submits their signed blob. Verified against
// the EXACT pinned tx and the EXACT member before it is stored (identity +
// fidelity + signature). Reaching the quorum weight flips status → ready.
// ─────────────────────────────────────────────────────────────────────────────
const signatureSchema = z.object({ signerAccount: xrplAddress, blobHex: z.string().min(32) });

router.post('/:id/signatures', asyncHandler(async (req: Request, res: Response) => {
  const parsed = signatureSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  const row = await prisma.councilProposal.findUnique({ where: { id: req.params.id } });
  if (!row) return void res.status(404).json({ error: 'NOT_FOUND' });
  const p = await withEffectiveStatus(row);
  if (!(LIVE_STATUSES as readonly string[]).includes(p.status)) {
    return void res.status(409).json({ error: 'PROPOSAL_NOT_LIVE', status: p.status });
  }
  const { signerAccount, blobHex } = parsed.data;
  const member = signerListOf(p).find((s) => s.account === signerAccount);
  if (!member) {
    return void res.status(403).json({ error: 'NOT_A_COUNCIL_MEMBER', detail: signerAccount });
  }
  try {
    verifySignerBlob(blobHex, signerAccount, p.txjson as Record<string, unknown>);
  } catch (e) {
    if (e instanceof BlobVerificationError) {
      return void res.status(422).json({ error: 'BLOB_REJECTED', detail: e.message });
    }
    throw e;
  }
  await prisma.councilProposalSignature.upsert({
    where: { proposalId_signerAccount: { proposalId: p.id, signerAccount } },
    create: { proposalId: p.id, signerAccount, weight: member.weight, blobHex },
    update: { blobHex, signedAt: new Date() },
  });
  const signatures = await prisma.councilProposalSignature.findMany({ where: { proposalId: p.id } });
  const collectedWeight = signatures.reduce((s, x) => s + x.weight, 0);
  const status = collectedWeight >= p.quorum ? 'ready' : 'collecting';
  if (status !== p.status) {
    await prisma.councilProposal.update({ where: { id: p.id }, data: { status } });
  }
  return void res.json({
    ok: true,
    status,
    collectedWeight,
    quorum: p.quorum,
    signedBy: signatures.map((s) => s.signerAccount),
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// FORMAL POSITIONS — the deliberative record (the acta, NOT a chat).
//
// Each councillor may fix ONE position per proposal: stance + optional brief
// comment, signed with their own wallet (an AccountSet proof, submit:false,
// whose Memo commits to sha256(contentJson) — same pattern as wallet binding).
// IMMUTABLE once set: who thought what, when. Deliberation itself is ephemeral
// and never touches the ledger; positions are what IS eternal.
//
// Anchoring is BATCHED (founder decision 2026-07-18): each position's own
// signature makes forgery impossible the moment it is filed; the SET is
// anchored on-chain in one 1-drop Payment at emission (or on a terminal
// state), so the public timestamp is deferred — never the integrity.
// ─────────────────────────────────────────────────────────────────────────────
const POSITION_KIND = 'astryum-council-position/v1';
const POSITION_MEMO_PREFIX = 'astryum-council-position:';
const ACTA_MEMO_PREFIX = 'astryum-council-acta/v1:';

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Verify the member's signed AccountSet proof commits to THIS content hash.
 *  Same guard chain as the wallet-binding proof: decode → re-encode → verify
 *  signature → derive signer → memo commitment. */
function verifyPositionProof(
  signedTxHex: string,
  expectedSigner: string,
  contentHash: string,
): { ok: true; signingPubKey: string } | { ok: false; reason: string } {
  let tx: Record<string, unknown>;
  try {
    tx = decode(signedTxHex) as unknown as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'DECODE_FAILED' };
  }
  const pubKey = tx.SigningPubKey;
  const txnSignature = tx.TxnSignature;
  if (typeof pubKey !== 'string' || !pubKey || typeof txnSignature !== 'string' || !txnSignature) {
    return { ok: false, reason: 'NOT_SINGLE_SIG' };
  }
  const { TxnSignature: _sig, ...unsigned } = tx;
  let signingData: string;
  try {
    signingData = encodeForSigning(unsigned as never);
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
  let signer: string;
  try {
    signer = deriveAddress(pubKey);
  } catch {
    return { ok: false, reason: 'DERIVE_FAILED' };
  }
  if (signer !== expectedSigner) return { ok: false, reason: 'SIGNER_MISMATCH' };
  if (tx.Account && tx.Account !== expectedSigner) return { ok: false, reason: 'ACCOUNT_MISMATCH' };
  const memos = Array.isArray(tx.Memos) ? (tx.Memos as Array<{ Memo?: { MemoData?: string } }>) : [];
  const commits = memos.some((m) => {
    const data = m?.Memo?.MemoData;
    if (typeof data !== 'string') return false;
    try {
      return convertHexToString(data).includes(`${POSITION_MEMO_PREFIX}${contentHash}`);
    } catch {
      return false;
    }
  });
  if (!commits) return { ok: false, reason: 'HASH_NOT_IN_MEMO' };
  return { ok: true, signingPubKey: pubKey };
}

const positionSchema = z.object({
  memberAccount: xrplAddress,
  stance: z.enum(['for', 'against', 'abstain', 'request-changes']),
  comment: z.string().trim().max(500).optional(),
  /** The EXACT JSON string the member signed over (hashed verbatim). */
  contentJson: z.string().min(2).max(4000),
  blobHex: z.string().min(32),
});

router.post('/:id/positions', asyncHandler(async (req: Request, res: Response) => {
  const parsed = positionSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  const row = await prisma.councilProposal.findUnique({ where: { id: req.params.id } });
  if (!row) return void res.status(404).json({ error: 'NOT_FOUND' });
  const p = await withEffectiveStatus(row);
  if (!(LIVE_STATUSES as readonly string[]).includes(p.status)) {
    return void res.status(409).json({ error: 'PROPOSAL_NOT_LIVE', status: p.status });
  }
  const { memberAccount, stance, comment, contentJson, blobHex } = parsed.data;
  if (!signerListOf(p).some((s) => s.account === memberAccount)) {
    return void res.status(403).json({ error: 'NOT_A_COUNCIL_MEMBER', detail: memberAccount });
  }

  // The signed content must SAY what the row will say — no divergence between
  // what the wallet signed and what the acta stores.
  let content: Record<string, unknown>;
  try {
    content = JSON.parse(contentJson) as Record<string, unknown>;
  } catch {
    return void res.status(400).json({ error: 'CONTENT_NOT_JSON' });
  }
  const mismatch =
    content.kind !== POSITION_KIND ||
    content.proposalId !== p.id ||
    content.account !== p.account ||
    content.member !== memberAccount ||
    content.stance !== stance ||
    (content.comment ?? '') !== (comment ?? '');
  if (mismatch) {
    return void res.status(400).json({ error: 'CONTENT_MISMATCH', detail: 'signed content disagrees with the submitted fields' });
  }

  const contentHash = sha256Hex(contentJson);
  const verdict = verifyPositionProof(blobHex, memberAccount, contentHash);
  if (verdict.ok !== true) {
    return void res.status(422).json({ error: 'POSITION_PROOF_REJECTED', detail: verdict.reason });
  }

  const existing = await prisma.councilFormalPosition.findUnique({
    where: { proposalId_memberAccount: { proposalId: p.id, memberAccount } },
  });
  if (existing) {
    // The acta is immutable: a fixed position is never edited or replaced.
    return void res.status(409).json({ error: 'POSITION_ALREADY_SET' });
  }
  const position = await prisma.councilFormalPosition.create({
    data: {
      proposalId: p.id,
      memberAccount,
      stance,
      comment: comment ?? null,
      contentHash,
      signature: blobHex,
      signingPubKey: verdict.signingPubKey,
    },
  });
  return void res.status(201).json({ position });
}));

// POST /:id/positions/anchor/prepare — compose the UNSIGNED 1-drop batch
// anchor: sha256 of the sorted position hashes, in the memo of a personal
// Payment from the emitter to the council account. Signed and submitted by the
// emitter's own wallet (a normal personal tx — no council Sequence touched).
const anchorPrepareSchema = z.object({ emitterAccount: xrplAddress, region: z.string().optional() });

router.post('/:id/positions/anchor/prepare', asyncHandler(async (req: Request, res: Response) => {
  const gate = gateCouncil(regionOf(req));
  if (gate) return void res.status(gate.status).json({ error: gate.error });
  const parsed = anchorPrepareSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  const p = await prisma.councilProposal.findUnique({
    where: { id: req.params.id },
    include: { positions: { select: { contentHash: true } } },
  });
  if (!p) return void res.status(404).json({ error: 'NOT_FOUND' });
  if (p.positions.length === 0) {
    return void res.status(409).json({ error: 'NO_POSITIONS_TO_ANCHOR' });
  }
  if (p.positionsAnchor) {
    return void res.status(409).json({ error: 'ALREADY_ANCHORED', txHash: p.positionsAnchor });
  }
  const batchHash = sha256Hex(
    p.positions
      .map((x) => x.contentHash)
      .sort()
      .join('\n'),
  );
  const memo = `${ACTA_MEMO_PREFIX}${batchHash}`;
  const xrplTx = withSourceTag({
    TransactionType: 'Payment',
    Account: parsed.data.emitterAccount,
    Destination: p.account,
    Amount: '1',
    Memos: [{ Memo: { MemoData: Buffer.from(memo, 'utf8').toString('hex').toUpperCase() } }],
  });
  return void res.json({ xrplTx, batchHash, positionsCount: p.positions.length });
}));

// POST /:id/positions/anchored — record the anchor's ledger hash.
router.post('/:id/positions/anchored', asyncHandler(async (req: Request, res: Response) => {
  const parsed = submittedSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  const row = await prisma.councilProposal.findUnique({ where: { id: req.params.id } });
  if (!row) return void res.status(404).json({ error: 'NOT_FOUND' });
  const proposal = await prisma.councilProposal.update({
    where: { id: row.id },
    data: { positionsAnchor: parsed.data.txHash },
  });
  return void res.json({ ok: true, proposal });
}));

// POST /:id/submitted — the broadcasting browser reports the ledger hash.
const submittedSchema = z.object({ txHash: z.string().trim().min(8).max(128) });

router.post('/:id/submitted', asyncHandler(async (req: Request, res: Response) => {
  const parsed = submittedSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  const row = await prisma.councilProposal.findUnique({ where: { id: req.params.id } });
  if (!row) return void res.status(404).json({ error: 'NOT_FOUND' });
  if (row.status !== 'ready') {
    return void res.status(409).json({ error: 'QUORUM_NOT_MET', status: row.status });
  }
  const proposal = await prisma.councilProposal.update({
    where: { id: row.id },
    data: { status: 'submitted', txHash: parsed.data.txHash },
  });

  // A council order emitted from the inbox must reach Flare WITHOUT depending
  // on the reporting browser: start the courtesy relay server-side, here. This
  // closes the 2026-07-29 hole (order validated on XRPL, never executed on
  // Flare) for the async path. Best-effort: the emit report never fails on it.
  let councilOrder:
    | { isOrder: true; relay: 'started' | 'already-relaying' | 'relayer-disabled' | 'not-launched' }
    | undefined;
  try {
    const { isCouncilOrderPayment, launchCouncilOrderRelay } = await import(
      '../services/flare/CouncilOrderRelayLauncher'
    );
    if (isCouncilOrderPayment(row.txjson)) {
      if (process.env.FLARE_EXECUTOR_ENABLED !== 'true') {
        councilOrder = { isOrder: true, relay: 'relayer-disabled' };
      } else if (!/^[0-9A-Fa-f]{64}$/.test(parsed.data.txHash)) {
        councilOrder = { isOrder: true, relay: 'not-launched' };
      } else {
        const r = launchCouncilOrderRelay(parsed.data.txHash);
        councilOrder = { isOrder: true, relay: r.started ? 'started' : 'already-relaying' };
      }
    }
  } catch {
    /* detection is best-effort — the relay stays permissionless and retryable */
  }
  return void res.json({ ok: true, proposal, ...(councilOrder ? { councilOrder } : {}) });
}));

// POST /:id/withdraw — only the proposer's app-account, only while live.
router.post('/:id/withdraw', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.siwe?.userId;
  if (!userId) return void res.status(401).json({ error: 'missing_siwe_session' });
  const row = await prisma.councilProposal.findUnique({ where: { id: req.params.id } });
  if (!row) return void res.status(404).json({ error: 'NOT_FOUND' });
  if (row.createdByUserId !== userId) {
    return void res.status(403).json({ error: 'NOT_THE_PROPOSER' });
  }
  if (!(LIVE_STATUSES as readonly string[]).includes(row.status)) {
    return void res.status(409).json({ error: 'PROPOSAL_NOT_LIVE', status: row.status });
  }
  const proposal = await prisma.councilProposal.update({
    where: { id: row.id },
    data: { status: 'withdrawn' },
  });
  return void res.json({ ok: true, proposal });
}));

export default router;
