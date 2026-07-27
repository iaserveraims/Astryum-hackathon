/**
 * XRPL native DeFi — prepare-only endpoints (Fase 2 builders).
 *
 * Every POST returns an UNSIGNED txjson (SourceTag stamped) + a full
 * disclosure (#6); the frontend hands the txjson to Xaman and the USER signs
 * (submit:false rail). Astryum signs nothing, submits nothing (#1).
 *
 * Invariant frontier (same shape as flareDemo):
 *   - XRPL_DEFI_ENABLED flag (#10 — nothing plugs in without its flag) and
 *   - jurisdiction geofence (#5 — execution module is region-gateable)
 *   gate every PREPARE endpoint. Read-only endpoints (ecosystem watch,
 *   amm-info) stay open: monitoring is always available (#5).
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { rippleTimeToISOTime } from 'xrpl';
import { jurisdictionService } from '../services/JurisdictionService';
import { xrplProvider } from '../integrations/providers/chain/XRPLProvider';
import {
  buildEscrowCancel,
  buildEscrowCreate,
  buildEscrowFinish,
} from '../connectors/protocols/xrpl/XrplEscrowService';
import { buildOfferCreate, buildOfferCancel } from '../connectors/protocols/xrpl/XrplDexService';
import { buildAmmDeposit, buildAmmWithdraw } from '../connectors/protocols/xrpl/XrplAmmService';
import {
  runXrplEcosystemWatch,
  formatWatchReport,
} from '../connectors/protocols/xrpl/XrplEcosystemWatch';
import {
  buildConstitutionAnchor,
  decodeUriHex,
} from '../connectors/protocols/xrpl/XrplDidService';
import { assessRehearsal, assessLegacyHealth } from '../connectors/protocols/xrpl/XrplLegacyRehearsal';
import { buildSignerListSet, buildDisableMaster } from '../connectors/protocols/xrpl/XrplCouncilService';
import {
  prepareCouncilMultisig,
  NotACouncilError,
} from '../connectors/protocols/xrpl/XrplMultisigCoordinator';

const router = Router();

/** Flag (#10) + geofence (#5). Error envelope to send, or null when allowed. */
function gateXrplDefi(region: string | null): { status: number; error: string } | null {
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

/** Uniform prepare-endpoint wrapper: gate → zod → builder → handoff | readable error. */
function prepare<S extends z.ZodTypeAny>(
  schema: S,
  build: (input: z.infer<S>) => unknown,
): (req: Request, res: Response) => void {
  return (req, res) => {
    const gate = gateXrplDefi(regionOf(req));
    if (gate) return void res.status(gate.status).json({ error: gate.error });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return void res
        .status(400)
        .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
    }
    try {
      return void res.json(build(parsed.data));
    } catch (e) {
      return void res.status(400).json({ error: 'BUILD_FAILED', detail: (e as Error).message });
    }
  };
}

// ── Schemas (mirror the builder input contracts) ─────────────────────────────

const xrplAddress = z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/, 'invalid XRPL address');
const dropsString = z.string().regex(/^[0-9]+$/, 'drops must be an integer string');
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid ISO-8601 date');

const iouAmount = z.object({
  currency: z.string().min(3),
  issuer: xrplAddress,
  value: z.string(),
});
const amount = z.union([dropsString, iouAmount]);
const poolAsset = z.object({ currency: z.string().min(3), issuer: xrplAddress.optional() });

const escrowCreateSchema = z.object({
  account: xrplAddress,
  amountDrops: dropsString,
  finishAfterISO: isoDate,
  cancelAfterISO: isoDate.optional(),
  destination: xrplAddress.optional(),
  region: z.string().optional(),
});

const escrowFinishSchema = z
  .object({
    account: xrplAddress,
    owner: xrplAddress,
    // Either the EscrowCreate Sequence directly, or the escrow object's
    // PreviousTxnID (from GET /escrows) — the route resolves the sequence
    // with a read-only tx lookup.
    offerSequence: z.number().int().nonnegative().optional(),
    previousTxnID: z.string().regex(/^[0-9A-Fa-f]{64}$/).optional(),
    region: z.string().optional(),
  })
  .refine((v) => v.offerSequence !== undefined || v.previousTxnID !== undefined, {
    message: 'offerSequence or previousTxnID required',
  });

const offerCreateSchema = z.object({
  account: xrplAddress,
  takerGets: amount,
  takerPays: amount,
  flags: z
    .object({
      immediateOrCancel: z.boolean().optional(),
      fillOrKill: z.boolean().optional(),
      passive: z.boolean().optional(),
      sell: z.boolean().optional(),
    })
    .optional(),
  expirationISO: isoDate.optional(),
  region: z.string().optional(),
});

const offerCancelSchema = z.object({
  account: xrplAddress,
  offerSequence: z.number().int().positive(),
  region: z.string().optional(),
});

const ammDepositSchema = z.object({
  account: xrplAddress,
  asset: poolAsset,
  asset2: poolAsset,
  deposit: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('two-asset'), amount, amount2: amount }),
    z.object({ mode: z.literal('single-asset'), amount }),
    z.object({ mode: z.literal('lp-token-out'), lpTokenOut: iouAmount }),
  ]),
  poolTradingFee: z.number().int().nonnegative().optional(),
  region: z.string().optional(),
});

const didSetSchema = z.object({
  account: xrplAddress,
  documentSha256Hex: z.string().regex(/^[0-9A-Fa-f]{64}$/, 'documentSha256Hex must be 64 hex chars'),
  documentUri: z.string().min(1).max(256).optional(),
  region: z.string().optional(),
});

const ammWithdrawSchema = z.object({
  account: xrplAddress,
  asset: poolAsset,
  asset2: poolAsset,
  withdraw: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('all') }),
    z.object({ mode: z.literal('lp-token-in'), lpTokenIn: iouAmount }),
    z.object({ mode: z.literal('single-asset'), amount }),
  ]),
  region: z.string().optional(),
});

// ── Prepare endpoints (gated) ────────────────────────────────────────────────

// The `as` casts bridge zod's inference under this tsconfig (non-strict mode
// widens inferred fields to optional); the schemas above enforce the same
// required shape at runtime before the cast is reached.
// escrow-create reads the live owner reserve (server_info) so the disclosure
// states the escrow's REAL extra cost (#6) → not wrapped in the sync prepare()
// helper. If the read fails the handoff still discloses the reserve, just
// without the figure — preparing never blocks on a metrics read.
router.post('/escrow-create/prepare', async (req: Request, res: Response) => {
  const gate = gateXrplDefi(regionOf(req));
  if (gate) return void res.status(gate.status).json({ error: gate.error });
  const parsed = escrowCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  const ownerReserveXrp = await xrplProvider.getOwnerReserveXrp().catch(() => undefined);
  try {
    return void res.json(
      buildEscrowCreate({
        ...(parsed.data as Parameters<typeof buildEscrowCreate>[0]),
        ...(ownerReserveXrp !== undefined ? { ownerReserveXrp } : {}),
      }),
    );
  } catch (e) {
    return void res.status(400).json({ error: 'BUILD_FAILED', detail: (e as Error).message });
  }
});
// escrow-finish and escrow-cancel share one shape (both permissionless, both
// identify the escrow by Owner + OfferSequence) and resolve the OfferSequence
// asynchronously (tx lookup) → not wrapped in the sync prepare() helper.
function escrowReleaseHandler(
  build: typeof buildEscrowFinish | typeof buildEscrowCancel,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    const gate = gateXrplDefi(regionOf(req));
    if (gate) return void res.status(gate.status).json({ error: gate.error });
    const parsed = escrowFinishSchema.safeParse(req.body);
    if (!parsed.success) {
      return void res
        .status(400)
        .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
    }
    try {
      let offerSequence = parsed.data.offerSequence;
      if (offerSequence === undefined) {
        const seq = await xrplProvider.getEscrowCreateSequence(parsed.data.previousTxnID!);
        if (seq === null) {
          return void res.status(404).json({
            error: 'ESCROW_SEQUENCE_NOT_FOUND',
            detail: 'PreviousTxnID does not resolve to an EscrowCreate — pass offerSequence explicitly.',
          });
        }
        offerSequence = seq;
      }
      return void res.json(
        build({
          account: parsed.data.account as string,
          owner: parsed.data.owner as string,
          offerSequence,
        }),
      );
    } catch (e) {
      return void res.status(400).json({ error: 'BUILD_FAILED', detail: (e as Error).message });
    }
  };
}
router.post('/escrow-finish/prepare', escrowReleaseHandler(buildEscrowFinish));
// The recovery half of the EscrowCreate disclosure's promise ("after CancelAfter
// you can cancel and recover") — the XRP always returns to the escrow's creator.
router.post('/escrow-cancel/prepare', escrowReleaseHandler(buildEscrowCancel));
router.post(
  '/offer-create/prepare',
  prepare(offerCreateSchema, (i) => buildOfferCreate(i as Parameters<typeof buildOfferCreate>[0])),
);
router.post(
  '/offer-cancel/prepare',
  prepare(offerCancelSchema, (i) => buildOfferCancel(i as Parameters<typeof buildOfferCancel>[0])),
);
router.post(
  '/amm-deposit/prepare',
  prepare(ammDepositSchema, (i) => buildAmmDeposit(i as Parameters<typeof buildAmmDeposit>[0])),
);
router.post(
  '/amm-withdraw/prepare',
  prepare(ammWithdrawSchema, (i) => buildAmmWithdraw(i as Parameters<typeof buildAmmWithdraw>[0])),
);
// Vía (b) — anchor (or amend) the Legacy constitution. For a council account
// the returned txjson still needs the QUORUM's signatures, gathered via the
// multisig coordinator below (ADR-008).
router.post(
  '/did-set/prepare',
  prepare(didSetSchema, (i) => buildConstitutionAnchor(i as Parameters<typeof buildConstitutionAnchor>[0])),
);

// Vía (a) — constitute (or amend) the council: compose the UNSIGNED SignerListSet
// (ADR-008/009 "create from zero"). Signed by the account's master key when there
// is no council yet (single-sig, DIRECT path), or by the current quorum to amend.
const signerListSetSchema = z.object({
  account: xrplAddress,
  quorum: z.number().int().positive(),
  signers: z
    .array(z.object({ account: xrplAddress, weight: z.number().int().min(1).max(65535) }))
    .min(1)
    .max(32),
  region: z.string().optional(),
});
router.post(
  '/signer-list-set/prepare',
  prepare(signerListSetSchema, (i) => buildSignerListSet(i as Parameters<typeof buildSignerListSet>[0])),
);

// Vía (a) — "close the door": compose the UNSIGNED AccountSet(asfDisableMaster).
// XRPL requires the MASTER KEY itself to sign this — a multisig / regular key is
// rejected with tecNEED_MASTER_KEY — so the panel signs it DIRECTLY (single-sig
// by the account owner), NOT via the coordinator. The panel gates OFFERING this
// on the on-chain rehearsal (health.canCloseDoor): disabling the master key
// before the quorum has proven it can sign would brick the account forever.
const disableMasterSchema = z.object({
  account: xrplAddress,
  region: z.string().optional(),
});
router.post(
  '/disable-master/prepare',
  prepare(disableMasterSchema, (i) => buildDisableMaster(i as Parameters<typeof buildDisableMaster>[0])),
);

// ── Multisig coordinator (ADR-008) — the keystone ────────────────────────────
// Fix ANY unsigned txjson (already SourceTag-stamped by a builder above) for a
// council account: pin Sequence + Fee + SigningPubKey so every member signs
// identical bytes, and run the simulate preflight (#11). Prepare-only: the
// frontend fans this out to the council, combines client-side, and the browser
// broadcasts. Astryum reads the ledger and fixes bytes — it never signs.
const multisignPrepareSchema = z.object({
  account: xrplAddress,
  xrplTx: z.record(z.unknown()),
  region: z.string().optional(),
});
router.post('/multisign/prepare', async (req: Request, res: Response) => {
  const gate = gateXrplDefi(regionOf(req));
  if (gate) return void res.status(gate.status).json({ error: gate.error });
  const parsed = multisignPrepareSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  try {
    const result = await prepareCouncilMultisig(xrplProvider, {
      account: parsed.data.account,
      xrplTx: parsed.data.xrplTx as Record<string, unknown>,
    });
    return void res.json(result);
  } catch (e) {
    if (e instanceof NotACouncilError) {
      return void res.status(409).json({ error: 'NOT_A_COUNCIL', detail: e.message });
    }
    return void res.status(400).json({ error: 'PREPARE_FAILED', detail: (e as Error).message });
  }
});

// Dry-run ANY txjson via `simulate` (read-only, invariant #11's XRPL half): the
// exact engine result + balance deltas BEFORE signing. Not gated — it composes
// nothing and moves nothing; it is the honest preview the direct-sign path shows.
const simulateSchema = z.object({ txjson: z.record(z.unknown()) });
router.post('/simulate', async (req: Request, res: Response) => {
  const parsed = simulateSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  try {
    const result = await xrplProvider.simulateTransaction(parsed.data.txjson as Record<string, unknown>);
    return void res.json(result);
  } catch (e) {
    return void res.status(500).json({ error: 'SIMULATE_FAILED', detail: (e as Error).message });
  }
});

// ── Council orders — the FDC enforcement rail (roadmap Pieza 1) ─────────────
// prepare: compose the UNSIGNED 1-drop Payment whose memo commits the order
// (quorum signs via the coordinator above). relay: carry the validated tx
// across the FDC to the bridge (executor-gated; zero discretion — the bridge
// only accepts the committed bytes). status: on-chain settlement truth.
const councilOrderSchema = z.object({
  account: xrplAddress, // the council account (the order's XRPL sender)
  action: z.enum([
    'direct-to',
    'recall',
    'move',
    'evacuate',
    'propose-venue',
    'retire-venue',
    'set-max-venue-bps',
    'set-linaje-fee-bps',
    'set-payees',
    'cede',
    'end-cession',
    'set-constitution-ref',
  ]),
  params: z.record(z.unknown()).default({}),
  region: z.string().optional(),
});
router.post('/council-order/prepare', async (req: Request, res: Response) => {
  const gate = gateXrplDefi(regionOf(req));
  if (gate) return void res.status(gate.status).json({ error: gate.error });
  const parsed = councilOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  try {
    const { buildCouncilOrderHandoff } = await import('../connectors/protocols/xrpl/XrplCouncilOrderService');
    const { saveCouncilOrderRecord } = await import('../services/flare/LegacyOrderStore');
    const handoff = await buildCouncilOrderHandoff({
      council: parsed.data.account,
      action: parsed.data.action,
      params: parsed.data.params,
    });
    // Persist the committed bytes so the relayer can match the memo later
    // (best-effort; the response carries orderData so the client can re-supply).
    await saveCouncilOrderRecord({
      orderHash: handoff.order.orderHash,
      orderData: handoff.order.orderData,
      action: handoff.order.action,
      summary: handoff.order.summary,
      nonce: handoff.order.nonce,
      chain: handoff.order.chain,
      bridge: handoff.order.bridge,
      vault: handoff.order.vault,
      council: parsed.data.account,
    });
    return void res.json(handoff);
  } catch (e) {
    const msg = (e as Error).message;
    const status = /LEGACY_.*missing|deploy the stack/i.test(msg) ? 503 : 400;
    return void res.status(status).json({ error: 'ORDER_PREPARE_FAILED', detail: msg });
  }
});

// In-memory relay state per XRPL tx — UI enrichment only; the on-chain
// consumedTxId read below is the settlement truth.
const relayState = new Map<string, { state: 'relaying' | 'executed' | 'error'; detail?: string; flareTxHash?: string }>();

const relaySchema = z.object({
  xrplTxHash: z.string().regex(/^[0-9A-Fa-f]{64}$/),
  orderData: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
});
router.post('/council-order/relay', async (req: Request, res: Response) => {
  const gate = gateXrplDefi(regionOf(req));
  if (gate) return void res.status(gate.status).json({ error: gate.error });
  const parsed = relaySchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  if (process.env.FLARE_EXECUTOR_ENABLED !== 'true') {
    return void res.status(503).json({
      error: 'RELAYER_DISABLED',
      detail: 'The courtesy relayer is off. The proof can be delivered by anyone (permissionless) — see the survival folder.',
    });
  }
  const key = parsed.data.xrplTxHash.toUpperCase();
  const current = relayState.get(key);
  if (current?.state === 'relaying') return void res.status(202).json({ started: false, state: 'relaying' });
  relayState.set(key, { state: 'relaying' });
  // Fire-and-forget: the FDC round takes 2-5 min; the UI polls /status.
  void (async () => {
    try {
      const { relayCouncilOrder } = await import('../services/flare/LegacyOrderRelayService');
      const out = await relayCouncilOrder({
        xrplTxHash: parsed.data.xrplTxHash,
        ...(parsed.data.orderData ? { orderDataOverride: parsed.data.orderData } : {}),
      });
      relayState.set(key, { state: 'executed', ...(out.flareTxHash ? { flareTxHash: out.flareTxHash } : {}) });
    } catch (e) {
      relayState.set(key, { state: 'error', detail: (e as Error).message });
    }
  })();
  return void res.status(202).json({ started: true, state: 'relaying' });
});

router.get('/council-order/status', async (req: Request, res: Response) => {
  const txHash = String(req.query.txId ?? '');
  if (!/^[0-9A-Fa-f]{64}$/.test(txHash)) {
    return void res.status(400).json({ error: 'INVALID_TXID' });
  }
  try {
    const { councilOrderStatus } = await import('../services/flare/LegacyOrderRelayService');
    const onchain = await councilOrderStatus(txHash);
    const local = relayState.get(txHash.toUpperCase());
    return void res.json({
      executed: onchain.executed,
      nextNonce: onchain.nextNonce,
      relay: local ?? null,
    });
  } catch (e) {
    return void res.status(500).json({ error: 'STATUS_FAILED', detail: (e as Error).message });
  }
});

// ── Read-only endpoints (monitoring — always available, #5) ─────────────────

/**
 * GET /api/xrpl-defi/amm-info?currency=XRP&currency2=RLUSD&issuer2=r...
 * Pool snapshot (reserves, LP token, trading fee) — protocol data with source.
 */
router.get('/amm-info', async (req: Request, res: Response) => {
  try {
    const currency = String(req.query.currency ?? '').trim();
    const currency2 = String(req.query.currency2 ?? '').trim();
    if (!currency || !currency2) {
      return void res.status(400).json({ error: 'MISSING_CURRENCY' });
    }
    const issuer = typeof req.query.issuer === 'string' ? req.query.issuer : undefined;
    const issuer2 = typeof req.query.issuer2 === 'string' ? req.query.issuer2 : undefined;
    const pool = await xrplProvider.getAmmInfo(
      { currency, ...(issuer ? { issuer } : {}) },
      { currency: currency2, ...(issuer2 ? { issuer: issuer2 } : {}) },
    );
    if (!pool) return void res.status(404).json({ error: 'POOL_NOT_FOUND' });
    return void res.json({ pool, source: 'amm_info (XRPL ledger, validated)' });
  } catch (e) {
    return void res.status(500).json({ error: 'AMM_INFO_FAILED', detail: (e as Error).message });
  }
});

/**
 * GET /api/xrpl-defi/escrows?account=r…
 * The Savings surface's read: every escrow visible on the account (validated
 * ledger), with the fields the release action needs (owner + previousTxnID).
 */
router.get('/escrows', async (req: Request, res: Response) => {
  const account = String(req.query.account ?? '').trim();
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account)) {
    return void res.status(400).json({ error: 'INVALID_ACCOUNT' });
  }
  try {
    const [positions, spendable] = await Promise.all([
      xrplProvider.getDeFiPositions(account),
      // Best-effort: the list must still answer if the balance read fails.
      xrplProvider.getSpendableBalance(account).catch(() => null),
    ]);
    const escrows = positions
      .filter((p) => p.type === 'escrow')
      .map((p) => {
        const d = p.details as { finishAfter?: number; cancelAfter?: number };
        return {
          currency: p.currency,
          amount: p.balance,
          ...(p.details as Record<string, unknown>),
          finishAfterISO: d.finishAfter !== undefined ? rippleTimeToISOTime(d.finishAfter) : undefined,
          cancelAfterISO: d.cancelAfter !== undefined ? rippleTimeToISOTime(d.cancelAfter) : undefined,
          releasableNow:
            d.finishAfter !== undefined && Date.parse(rippleTimeToISOTime(d.finishAfter)) <= Date.now(),
        };
      });
    return void res.json({ count: escrows.length, escrows, account: spendable });
  } catch (e) {
    return void res.status(500).json({ error: 'ESCROWS_READ_FAILED', detail: (e as Error).message });
  }
});

/**
 * GET /api/xrpl-defi/constitution?account=r…
 * The Constitution page's read: the current DID anchor + the DIDSet amendment
 * history (every entry a quorum-signed version). Verification happens client-
 * side: the page hashes the document and compares against `anchor.dataHex`.
 */
router.get('/constitution', async (req: Request, res: Response) => {
  const account = String(req.query.account ?? '').trim();
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account)) {
    return void res.status(400).json({ error: 'INVALID_ACCOUNT' });
  }
  try {
    const [anchor, history] = await Promise.all([
      xrplProvider.getDidObject(account),
      xrplProvider.getDidSetHistory(account).catch(() => []),
    ]);
    return void res.json({
      account,
      anchor: anchor
        ? { dataHex: anchor.dataHex, uri: decodeUriHex(anchor.uriHex), uriHex: anchor.uriHex }
        : null,
      history: history.map((h) => ({ ...h, uri: decodeUriHex(h.uriHex) })),
    });
  } catch (e) {
    return void res.status(500).json({ error: 'CONSTITUTION_READ_FAILED', detail: (e as Error).message });
  }
});

/**
 * GET /api/xrpl-defi/council?account=r…
 * The council read: signer list (members + weights), quorum, and whether the
 * master key is disabled (quorum-only governance). Null = no signer list.
 */
router.get('/council', async (req: Request, res: Response) => {
  const account = String(req.query.account ?? '').trim();
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account)) {
    return void res.status(400).json({ error: 'INVALID_ACCOUNT' });
  }
  try {
    const council = await xrplProvider.getSignerCouncil(account);
    return void res.json({ account, council });
  } catch (e) {
    return void res.status(500).json({ error: 'COUNCIL_READ_FAILED', detail: (e as Error).message });
  }
});

/**
 * GET /api/xrpl-defi/rehearsal-status?account=r…
 * The signing-rehearsal verdict (GUIA_LEGACY paso 3): per-member on-chain
 * signature evidence + the gate that unlocks the master-key door. Read-only;
 * what it cannot know (whether each member signed PERSONALLY) the UI says.
 */
router.get('/rehearsal-status', async (req: Request, res: Response) => {
  const account = String(req.query.account ?? '').trim();
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account)) {
    return void res.status(400).json({ error: 'INVALID_ACCOUNT' });
  }
  try {
    const [council, activity] = await Promise.all([
      xrplProvider.getSignerCouncil(account),
      xrplProvider.getMultisigSignerActivity(account),
    ]);
    const status = assessRehearsal(council, activity);
    // The health verdict governs which actions the panel offers (ADR-008 §2).
    return void res.json({ account, status, health: assessLegacyHealth(status) });
  } catch (e) {
    return void res.status(500).json({ error: 'REHEARSAL_READ_FAILED', detail: (e as Error).message });
  }
});

/**
 * GET /api/xrpl-defi/vault-council?address=0x…
 * The EVM side of the mirror (auditoría P1): the LegacyVault's council() and,
 * when the council is a Safe-like contract, its owners/threshold. XRPL and
 * EVM addresses are NOT comparable — only counts and thresholds are, and the
 * UI says exactly that. Read-only, always available (#5).
 */
router.get('/vault-council', async (req: Request, res: Response) => {
  const address = String(req.query.address ?? '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return void res.status(400).json({ error: 'INVALID_ADDRESS' });
  }
  try {
    const { ethers } = await import('ethers');
    const provider = new ethers.JsonRpcProvider(
      process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc',
    );
    const vault = new ethers.Contract(
      address,
      ['function council() view returns (address)', 'function constitutionRef() view returns (bytes32)'],
      provider,
    );
    const [council, constitutionRef] = await Promise.all([
      vault.council() as Promise<string>,
      vault.constitutionRef().catch(() => null) as Promise<string | null>,
    ]);
    const code = await provider.getCode(council);
    let kind: 'eoa' | 'contract' | 'safe' = code === '0x' ? 'eoa' : 'contract';
    let owners: string[] | undefined;
    let threshold: number | undefined;
    if (kind === 'contract') {
      try {
        const safe = new ethers.Contract(
          council,
          ['function getOwners() view returns (address[])', 'function getThreshold() view returns (uint256)'],
          provider,
        );
        owners = (await safe.getOwners()) as string[];
        threshold = Number(await safe.getThreshold());
        kind = 'safe';
      } catch {
        /* not Safe-shaped — report as plain contract */
      }
    }
    return void res.json({
      vault: address,
      council,
      constitutionRef,
      kind,
      ...(owners ? { ownerCount: owners.length, threshold } : {}),
    });
  } catch (e) {
    return void res.status(500).json({ error: 'VAULT_COUNCIL_READ_FAILED', detail: (e as Error).message });
  }
});

/**
 * GET /api/xrpl-defi/ecosystem-watch
 * The vigía: amendments + RLUSD escrow flag + sidechain venue (public reads).
 */
router.get('/ecosystem-watch', async (_req: Request, res: Response) => {
  try {
    const result = await runXrplEcosystemWatch();
    return void res.json({ result, report: formatWatchReport(result) });
  } catch (e) {
    return void res.status(500).json({ error: 'WATCH_FAILED', detail: (e as Error).message });
  }
});

export default router;
