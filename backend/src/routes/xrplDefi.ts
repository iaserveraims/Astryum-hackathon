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
import { safeErrorDetail } from '../utils/safeError';
import { jurisdictionService } from '../services/JurisdictionService';
import { requireLegacyAccess } from '../middleware/requireLegacyAccess';
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

/**
 * §3 — global fee-budget pre-check for the routes that MINT.
 *
 * A mint has two legs: the user signs an XRPL Payment, and the executor pays a
 * ~20 FLR FDC attestation to make leg 2 happen on Flare. If the budget is
 * exhausted, the XRP leaves and PARKS with no reclaim — the "unearned success"
 * shape at its most expensive. flareDemo has guarded this since 2026-07-25;
 * these three (vault-fund, vault-yield/claim, bridge/xrpl-to-flare) never did.
 *
 * Refuse BEFORE the signature, and say the money has not moved.
 */
function fuelGate(): { status: number; body: { error: string; detail: string } } | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { hasFeeBudgetForOneMint } = require('../services/flare/ExecutorFuelService');
  if (hasFeeBudgetForOneMint()) return null;
  return {
    status: 429,
    body: {
      error: 'EXECUTOR_FUEL_EXHAUSTED',
      detail:
        'El executor no tiene presupuesto para atestiguar otra operación en Flare hoy. Tu XRP NO se ha ' +
        'movido y no quedará aparcado: se ha parado antes de pedirte la firma. Vuelve a intentarlo cuando ' +
        'se reponga el presupuesto diario.',
    },
  };
}

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
      return void res.status(400).json({ error: 'BUILD_FAILED', detail: safeErrorDetail(e) });
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
    return void res.status(400).json({ error: 'BUILD_FAILED', detail: safeErrorDetail(e) });
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
      return void res.status(400).json({ error: 'BUILD_FAILED', detail: safeErrorDetail(e) });
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
  requireLegacyAccess,
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
  requireLegacyAccess,
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
  requireLegacyAccess,
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
router.post('/multisign/prepare', requireLegacyAccess, async (req: Request, res: Response) => {
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
    return void res.status(400).json({ error: 'PREPARE_FAILED', detail: safeErrorDetail(e) });
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
    return void res.status(500).json({ error: 'SIMULATE_FAILED', detail: safeErrorDetail(e) });
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
router.post('/council-order/prepare', requireLegacyAccess, async (req: Request, res: Response) => {
  const gate = gateXrplDefi(regionOf(req));
  if (gate) return void res.status(gate.status).json({ error: gate.error });
  const parsed = councilOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  try {
    // WHOSE cage is this order for? The stack used to come from env, so a
    // second council composed orders against the first council's vault: the
    // quorum gathered, signed on mainnet, and only the relayer's WrongCouncil
    // check (added against griefing) stopped it — after the ceremony. Refuse
    // at compose time, with the reason said out loud.
    const { requireCageForCouncil, noCageResponse } = await import('../services/flare/LegacyCageResolver');
    let cage;
    try {
      cage = await requireCageForCouncil(parsed.data.account);
    } catch (e) {
      const noCage = noCageResponse(e);
      if (noCage) return void res.status(noCage.status).json(noCage.body);
      throw e;
    }
    // Courtesy pre-flight (#11 — simulate before signature). A `direct-to`
    // aimed at a venue that does not exist, or over what actually sits idle —
    // or a `recall` of more than a venue holds — reverts on Flare AFTER the
    // quorum has signed and the FDC round has been paid for (~20 FLR). Read the
    // cage first and refuse to compose an order we already know cannot land.
    // Best-effort by design: if the vault cannot be read we compose anyway and
    // let the contract decide — this guard exists to save a wasted ceremony,
    // never to become a second authority over the cage.
    // The SAME read serves two purposes: the pre-flight above and the units the
    // summary speaks in. A quorum was being asked to sign "Direct 100000 base
    // units of principal into venue #0" — the contract's integers, in the one
    // line a person actually reads (2026-08-03).
    let summaryCtx: import('../connectors/protocols/xrpl/XrplCouncilOrderService').OrderSummaryContext | undefined;
    try {
      const { readVaultState, checkDirectTo, checkRecall, venueProtocolName } = await import(
        '../services/flare/LegacyVaultStateService'
      );
      const state = await readVaultState(cage.vault);
      summaryCtx = {
        decimals: state.asset.decimals,
        symbol: state.asset.symbol,
        venueLabels: Object.fromEntries(
          state.venues
            .map((v) => [v.id, venueProtocolName(v) ?? v.targetSymbol ?? ''] as const)
            .filter(([, label]) => label !== ''),
        ),
      };
      if (parsed.data.action === 'direct-to' || parsed.data.action === 'recall') {
        const check = parsed.data.action === 'direct-to' ? checkDirectTo : checkRecall;
        const verdict = check(
          state,
          Number(parsed.data.params.venueId),
          BigInt(String(parsed.data.params.amount)),
        );
        if (!verdict.ok) {
          return void res
            .status(400)
            .json({ error: 'ORDER_WOULD_REVERT', code: verdict.code, detail: verdict.reason });
        }
      }
    } catch {
      /* unreadable vault or malformed params — fall through; the encoder and
         the contract both still have their say, and the summary falls back to
         base units rather than blocking a legitimate order over wording. */
    }
    const { buildCouncilOrderHandoff } = await import('../connectors/protocols/xrpl/XrplCouncilOrderService');
    const { saveCouncilOrderRecord } = await import('../services/flare/LegacyOrderStore');
    const handoff = await buildCouncilOrderHandoff({
      council: parsed.data.account,
      action: parsed.data.action,
      params: parsed.data.params,
      cage,
      ...(summaryCtx ? { summaryCtx } : {}),
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

const relaySchema = z.object({
  xrplTxHash: z.string().regex(/^[0-9A-Fa-f]{64}$/),
  orderData: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
});
router.post('/council-order/relay', requireLegacyAccess, async (req: Request, res: Response) => {
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
  // Fire-and-forget via the shared launcher (also used by the proposal inbox's
  // /submitted report): the FDC round takes 2-5 min; the UI polls /status.
  const { launchCouncilOrderRelay } = await import('../services/flare/CouncilOrderRelayLauncher');
  const out = launchCouncilOrderRelay(parsed.data.xrplTxHash, parsed.data.orderData);
  return void res.status(202).json(out);
});

router.get('/council-order/status', async (req: Request, res: Response) => {
  const txHash = String(req.query.txId ?? '');
  // `account` = the Legacy whose bridge holds the settlement truth. Optional
  // for back-compat: without it the read falls back to the env stack, which is
  // only correct for the founding council (per-Legacy cages, 2026-08-05).
  const account = String(req.query.account ?? '').trim();
  if (!/^[0-9A-Fa-f]{64}$/.test(txHash)) {
    return void res.status(400).json({ error: 'INVALID_TXID' });
  }
  if (account && !/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account)) {
    return void res.status(400).json({ error: 'INVALID_ACCOUNT' });
  }
  try {
    const { councilOrderStatus } = await import('../services/flare/LegacyOrderRelayService');
    const { getCouncilOrderRelayState } = await import('../services/flare/CouncilOrderRelayLauncher');
    const onchain = await councilOrderStatus(txHash, account || undefined);
    return void res.json({
      executed: onchain.executed,
      nextNonce: onchain.nextNonce,
      relay: getCouncilOrderRelayState(txHash),
    });
  } catch (e) {
    return void res.status(500).json({ error: 'STATUS_FAILED', detail: safeErrorDetail(e) });
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
    return void res.status(500).json({ error: 'AMM_INFO_FAILED', detail: safeErrorDetail(e) });
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
    return void res.status(500).json({ error: 'ESCROWS_READ_FAILED', detail: safeErrorDetail(e) });
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
    return void res.status(500).json({ error: 'CONSTITUTION_READ_FAILED', detail: safeErrorDetail(e) });
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
    return void res.status(500).json({ error: 'COUNCIL_READ_FAILED', detail: safeErrorDetail(e) });
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
    return void res.status(500).json({ error: 'REHEARSAL_READ_FAILED', detail: safeErrorDetail(e) });
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
    return void res.status(500).json({ error: 'VAULT_COUNCIL_READ_FAILED', detail: safeErrorDetail(e) });
  }
});

/**
 * GET /api/xrpl-defi/vault-state?account=r…   (or ?address=0x… to inspect one)
 *
 * The cage, read out loud: its asset (with decimals), how much principal is
 * idle vs working, and the REGISTERED venues with their basis and live value.
 *
 * Without this, composing a council order meant typing a venue NUMBER and an
 * amount in BASE UNITS blind — and an order aimed at a venue that does not
 * exist still costs the quorum's signatures and the FDC round before reverting
 * on the far side. Read-only and always available (#5: monitoring never sits
 * behind the execution gate); it changes nothing about how the cage decides.
 *
 * `account` is the LEGACY this is being read FOR: the cage is resolved from it,
 * so a Legacy without one gets an honest 409 instead of another council's
 * balance shown as its own (2026-08-05). `address` still reads any vault
 * directly — everything here is public on-chain state, and the /proof surface
 * and the deploy checklist both inspect a vault by address on purpose.
 */
router.get('/vault-state', async (req: Request, res: Response) => {
  const address = String(req.query.address ?? '').trim();
  const account = String(req.query.account ?? '').trim();
  if (address && !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return void res.status(400).json({ error: 'INVALID_ADDRESS' });
  }
  if (!address && !account) {
    return void res.status(400).json({
      error: 'INVALID_BODY',
      detail: 'account (the Legacy whose cage this is) or address (a vault to inspect) is required',
    });
  }
  try {
    const { readVaultState } = await import('../services/flare/LegacyVaultStateService');
    if (address) return void res.json(await readVaultState(address));
    const { requireCageForCouncil, noCageResponse } = await import('../services/flare/LegacyCageResolver');
    try {
      const cage = await requireCageForCouncil(account);
      return void res.json(await readVaultState(cage.vault));
    } catch (e) {
      const noCage = noCageResponse(e);
      if (noCage) return void res.status(noCage.status).json(noCage.body);
      throw e;
    }
  } catch (e) {
    const msg = (e as Error).message;
    const status = /LEGACY_.*missing|deploy the stack/i.test(msg) ? 503 : 500;
    return void res.status(status).json({ error: 'VAULT_STATE_READ_FAILED', detail: msg });
  }
});

/**
 * POST /api/xrpl-defi/vault-deposit/prepare  { amount: "25.5" }
 *
 * The missing leg: capital had no way IN. `directTo` can only direct principal
 * that is already inside the vault, and nothing in the product ever called
 * `deposit()` — so a freshly deployed cage stayed at zero and every entry order
 * failed on InsufficientIdlePrincipal.
 *
 * `deposit()` is permissionless (no council modifier), so this composes plain
 * UNSIGNED EVM calls — approve, then deposit — for whoever holds the asset to
 * sign in their own wallet. Astryum signs nothing (#1).
 *
 * `amount` is HUMAN units; the asset's real decimals are read on-chain. This is
 * deliberate: FXRP on Flare has SIX decimals, and hand-written base units are
 * exactly how someone over-funds by a factor of a trillion.
 */
/**
 * GET /api/xrpl-defi/vault-yield?account=r…
 *
 * Who is owed what, and what is ripe to realize. Read-only, always available.
 * The cage pays out YIELD only — this is the surface for it. With no payee
 * configured, every harvest capitalizes back into principal, and the response
 * says so rather than showing an empty table that reads like a bug.
 *
 * `account` is the Legacy: yield owed inside one council's cage is not another
 * council's to look at, let alone to act on.
 */
router.get('/vault-yield', async (req: Request, res: Response) => {
  const account = String(req.query.account ?? '').trim();
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account)) {
    return void res.status(400).json({ error: 'INVALID_ACCOUNT' });
  }
  try {
    const { ethers } = await import('ethers');
    const { readVaultState } = await import('../services/flare/LegacyVaultStateService');
    const { readYieldState } = await import('../services/flare/LegacyVaultYieldService');
    const { requireCageForCouncil, noCageResponse } = await import('../services/flare/LegacyCageResolver');
    let cfg;
    try {
      cfg = await requireCageForCouncil(account);
    } catch (e) {
      const noCage = noCageResponse(e);
      if (noCage) return void res.status(noCage.status).json(noCage.body);
      throw e;
    }
    const state = await readVaultState(cfg.vault);
    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    return void res.json(await readYieldState(provider, state.vault, state.asset, state.venues));
  } catch (e) {
    const msg = (e as Error).message;
    const status = /LEGACY_.*missing|deploy the stack/i.test(msg) ? 503 : 500;
    return void res.status(status).json({ error: 'VAULT_YIELD_READ_FAILED', detail: msg });
  }
});

/**
 * POST /api/xrpl-defi/vault-yield/harvest/prepare  { account: "r…", venueId: 0 }
 *
 * `harvest` is permissionless and pays its caller NOTHING — it only converts
 * "the venue is worth more than we put in" into "the payees are owed". So this
 * returns a bare unsigned call any wallet (an heir, a keeper) can send.
 *
 * Permissionless on-chain does not mean cage-agnostic here: `account` says
 * WHICH cage is being harvested, so the call composed is never another
 * Legacy's (and a venue id means nothing without knowing whose venues).
 */
router.post('/vault-yield/harvest/prepare', requireLegacyAccess, async (req: Request, res: Response) => {
  // #5 (inventario de firmas): this was the ONE prepare without the flag +
  // geofence gate — it answered 200 with the module off. Same frontier as
  // every other prepare now; the on-chain call stays permissionless.
  const gate = gateXrplDefi(regionOf(req));
  if (gate) return void res.status(gate.status).json({ error: gate.error });
  const account = String((req.body ?? {}).account ?? '').trim();
  const venueId = Number((req.body ?? {}).venueId);
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account)) {
    return void res.status(400).json({ error: 'INVALID_ACCOUNT' });
  }
  if (!Number.isInteger(venueId) || venueId < 0) {
    return void res.status(400).json({ error: 'INVALID_BODY', detail: 'venueId must be a non-negative integer' });
  }
  try {
    const { readVaultState, formatBaseUnits } = await import('../services/flare/LegacyVaultStateService');
    const { buildHarvestCall, computeHarvestable } = await import('../services/flare/LegacyVaultYieldService');
    const { requireCageForCouncil, noCageResponse } = await import('../services/flare/LegacyCageResolver');
    let cage;
    try {
      cage = await requireCageForCouncil(account);
    } catch (e) {
      const noCage = noCageResponse(e);
      if (noCage) return void res.status(noCage.status).json(noCage.body);
      throw e;
    }
    const state = await readVaultState(cage.vault);
    const venue = state.venues.find((v) => v.id === venueId);
    if (!venue) {
      return void res.status(400).json({ error: 'VENUE_UNKNOWN', detail: `Venue #${venueId} does not exist in this vault.` });
    }
    const amount = computeHarvestable(BigInt(venue.value), BigInt(venue.basis));
    return void res.json({
      venueId,
      harvestable: amount.toString(),
      harvestableHuman: formatBaseUnits(amount, state.asset.decimals),
      asset: state.asset,
      call: buildHarvestCall(state.vault, venueId),
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        note:
          amount > 0n
            ? `This realizes ${formatBaseUnits(amount, state.asset.decimals)} ${state.asset.symbol} that venue #${venueId} has earned ABOVE what was put in, and credits it to the payees. The principal is not touched. Anyone may send this — it pays you nothing.`
            : `Venue #${venueId} is not above its basis right now, so there is nothing to realize. Sending this costs gas and changes nothing.`,
        facts: { venueId, realizes: formatBaseUnits(amount, state.asset.decimals), touchesPrincipal: false, permissionless: true },
      },
    });
  } catch (e) {
    const msg = (e as Error).message;
    const status = /LEGACY_.*missing|deploy the stack/i.test(msg) ? 503 : 500;
    return void res.status(status).json({ error: 'VAULT_HARVEST_PREPARE_FAILED', detail: msg });
  }
});

/**
 * POST /api/xrpl-defi/vault-yield/claim/prepare
 *   { council: "r…", xrplAddress: "r…", amountXrpForMint: "1", xrplDest?: "r…" }
 *
 * The heir's one signature: claim the yield owed to their Personal Account and
 * send it home as native XRP, through the redeem rail that already exists.
 *
 * Two different accounts, and they are not interchangeable: `council` is the
 * LEGACY (whose cage owes), `xrplAddress` is the HEIR who signs. The heir is
 * not the council — that is the whole point of a payee — so the cage is
 * resolved from `council` and the heir's right to anything is what
 * `claimable(pa)` says, exactly as before.
 *
 * Only yield moves. `claim()` pays `claimable[msg.sender]`, which only a
 * harvest ever credits and only from realized gain — the principal is not
 * reachable from here, and no call in this batch could reach it.
 */
router.post('/vault-yield/claim/prepare', requireLegacyAccess, async (req: Request, res: Response) => {
  const gate = gateXrplDefi(regionOf(req));
  if (gate) return void res.status(gate.status).json({ error: gate.error });
  const fuel = fuelGate();
  if (fuel) return void res.status(fuel.status).json(fuel.body);
  const body = (req.body ?? {}) as {
    council?: string;
    xrplAddress?: string;
    amountXrpForMint?: string | number;
    xrplDest?: string;
  };
  const councilAddr = String(body.council ?? '').trim();
  const xrplAddr = String(body.xrplAddress ?? '').trim();
  const dest = String(body.xrplDest ?? '').trim() || xrplAddr;
  const mintXrp = String(body.amountXrpForMint ?? '').trim();
  const RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
  if (!RE.test(councilAddr)) return void res.status(400).json({ error: 'INVALID_BODY', detail: 'council (the Legacy whose cage owes the yield) is required' });
  if (!RE.test(xrplAddr)) return void res.status(400).json({ error: 'INVALID_XRPL_ADDRESS' });
  if (!RE.test(dest)) return void res.status(400).json({ error: 'INVALID_XRPL_DESTINATION' });
  if (!mintXrp) return void res.status(400).json({ error: 'INVALID_BODY', detail: 'amountXrpForMint is required — the 0xFE rail rides an XRPL payment' });

  try {
    const { ethers } = await import('ethers');
    const { readVaultState, parseBaseUnits, formatBaseUnits } = await import('../services/flare/LegacyVaultStateService');
    const { buildYieldClaimBatch } = await import('../services/flare/LegacyVaultYieldService');
    const { requireCageForCouncil, noCageResponse } = await import('../services/flare/LegacyCageResolver');
    const {
      buildDirectMintHandoff,
      readDirectMintParams,
      computeNetMint,
      mintFeeDisclosure,
      buildRedeemToXrplCall,
      readMinimumRedeemAmountUBA,
    } = await import('../connectors/protocols/flare/FlareDirectMintService');
    const { resolvePersonalAccount } = await import('../connectors/protocols/flare/FlareSmartAccountService');

    let cfg;
    try {
      cfg = await requireCageForCouncil(councilAddr);
    } catch (e) {
      const noCage = noCageResponse(e);
      if (noCage) return void res.status(noCage.status).json(noCage.body);
      throw e;
    }
    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    const state = await readVaultState(cfg.vault);

    // What this heir is actually owed — read live, never assumed.
    const vaultC = new ethers.Contract(state.vault, ['function claimable(address) view returns (uint256)'], provider);
    const pa = await resolvePersonalAccount(provider, xrplAddr);
    const owed = (await vaultC.claimable(pa)) as bigint;
    if (owed <= 0n) {
      return void res.status(400).json({
        error: 'NOTHING_TO_CLAIM',
        detail:
          `This Legacy owes ${state.asset.symbol} to nobody at ${pa} right now. Yield has to be realized first — ` +
          'harvest a venue that is above its basis, and only if this account is a payee.',
        personalAccount: pa,
      });
    }

    const params = await readDirectMintParams(provider);
    const gross = parseBaseUnits(mintXrp, 6);
    const net = computeNetMint(gross, params);
    // The redeem covers the claimed yield PLUS what this dispatch mints.
    const redeemUBA = owed + net.netToPersonalAccountUBA;
    const minRedeem = await readMinimumRedeemAmountUBA(provider).catch(() => null);
    if (minRedeem && redeemUBA < (minRedeem as bigint)) {
      return void res.status(400).json({
        error: 'BELOW_REDEEM_MINIMUM',
        detail:
          `FAssets will not redeem less than ${formatBaseUnits(minRedeem as bigint, 6)} XRP, and this would redeem ` +
          `${formatBaseUnits(redeemUBA, 6)}. The yield stays owed in the vault until there is enough — nothing is lost.`,
        owed: owed.toString(),
        minimum: (minRedeem as bigint).toString(),
      });
    }

    const redeemCall = await buildRedeemToXrplCall(provider, { amountUBA: redeemUBA, xrplDestination: dest });
    const innerCalls = buildYieldClaimBatch({ vault: state.vault, redeemCall });

    const handoff = await buildDirectMintHandoff(
      provider,
      { xrplAddress: xrplAddr, grossXrpDrops: gross, innerCalls, action: 'legacy-yield-claim' },
      { params },
    );

    return void res.json({
      personalAccount: pa,
      claimable: owed.toString(),
      claimableHuman: formatBaseUnits(owed, state.asset.decimals),
      redeemUBA: redeemUBA.toString(),
      destination: dest,
      xrplPayment: handoff.xrplPayment,
      memoHex: handoff.memoHex,
      userOpData: handoff.userOpData,
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        note:
          `Claims the ${formatBaseUnits(owed, state.asset.decimals)} ${state.asset.symbol} of yield this Legacy owes you and ` +
          `redeems it to native XRP at ${dest}. This is YIELD only — the principal stays in the vault, where no function ` +
          'can send it to an address. Astryum never signs; you sign this payment yourself.',
        facts: {
          yieldClaimed: formatBaseUnits(owed, state.asset.decimals),
          arrivesAs: 'native XRP',
          destination: dest,
          // Invariant #6: the fees are part of what the heir is signing — this
          // was the ONE mint-carrying disclosure that omitted them (the funding
          // route has shown them since day one).
          ...mintFeeDisclosure(net),
          touchesPrincipal: false,
          astryumSigns: false,
        },
      },
    });
  } catch (e) {
    const msg = (e as Error).message;
    const status = /LEGACY_.*missing|deploy the stack/i.test(msg) ? 503 : 400;
    return void res.status(status).json({ error: 'VAULT_YIELD_CLAIM_PREPARE_FAILED', detail: msg });
  }
});

/**
 * GET /api/xrpl-defi/vault-fund/quote?account=r…[&amountXrp=5]
 *
 * Lo que el formulario de fondeo necesita saber ANTES de que nadie escriba una
 * cifra: cuánto XRP tiene realmente el consejo, cuánto puede gastar, el mínimo
 * por debajo del cual no entra nada, y —si ya hay importe— cuánto principal
 * acaba dentro de verdad.
 *
 * Sin esto la caja de importe estaba a ciegas: ni saldo, ni MAX, ni aviso de
 * que por debajo de ~0,3 XRP las comisiones se lo comen entero. Solo lecturas.
 */
router.get('/vault-fund/quote', async (req: Request, res: Response) => {
  const account = String(req.query.account ?? '').trim();
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account)) {
    return void res.status(400).json({ error: 'INVALID_ACCOUNT' });
  }
  const amountXrp = String(req.query.amountXrp ?? '').trim();
  try {
    const { ethers } = await import('ethers');
    const { requireCageForCouncil, noCageResponse } = await import('../services/flare/LegacyCageResolver');
    const { readDirectMintParams, computeNetMint } = await import(
      '../connectors/protocols/flare/FlareDirectMintService'
    );
    const { minimumViableGrossUBA } = await import('../services/flare/LegacyVaultFundingService');
    const { readVaultState, formatBaseUnits, parseBaseUnits } = await import(
      '../services/flare/LegacyVaultStateService'
    );

    // No cage, no quote: the form this feeds ends in a mint that deposits into
    // a vault with no way out, so it must never be primed with another
    // Legacy's numbers.
    let cfg;
    try {
      cfg = await requireCageForCouncil(account);
    } catch (e) {
      const noCage = noCageResponse(e);
      if (noCage) return void res.status(noCage.status).json(noCage.body);
      throw e;
    }
    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    const [balance, params, state] = await Promise.all([
      xrplProvider.getSpendableBalance(account),
      readDirectMintParams(provider),
      readVaultState(cfg.vault),
    ]);

    // A multisig pays base fee x (1 + signers). Read the council to size it
    // instead of guessing, then keep it back from MAX so the tx can be paid.
    const council = await xrplProvider.getSignerCouncil(account).catch(() => null);
    const signerCount = council?.signers.length ?? 0;
    const baseFeeDrops = await xrplProvider.getBaseFeeDrops().catch(() => 10);
    const txFeeXrp = (baseFeeDrops * (1 + signerCount)) / 1_000_000;

    const minGrossUBA = minimumViableGrossUBA(params);
    const maxGrossXrp = Math.max(0, balance.spendableXrp - txFeeXrp);

    let quote: Record<string, string> | null = null;
    if (amountXrp) {
      try {
        const net = computeNetMint(parseBaseUnits(amountXrp, 6), params);
        quote = {
          grossXrp: amountXrp,
          mintingFeeXrp: formatBaseUnits(net.mintingFeeUBA, 6),
          executorFeeXrp: formatBaseUnits(net.executorFeeUBA, 6),
          principalAdded: formatBaseUnits(net.supplyUBA, state.asset.decimals),
        };
      } catch {
        quote = null; // below the floor — minGrossXrp already says so
      }
    }

    // Beta cap, spoken BEFORE anyone types an amount (informational here; the
    // prepare enforces it with the exemption lists).
    const { cageCapXrp } = await import('../services/flare/LegacyCageCreationService');
    const capXrp = cageCapXrp();
    const currentXrp = Number(state.totalValue) / 1e6;
    return void res.json({
      account,
      asset: state.asset,
      balanceXrp: String(balance.balanceXrp),
      reserveXrp: String(balance.reserveXrp),
      spendableXrp: String(balance.spendableXrp),
      txFeeXrp: String(txFeeXrp),
      signerCount,
      maxGrossXrp: String(maxGrossXrp),
      minGrossXrp: formatBaseUnits(minGrossUBA, 6),
      cage: {
        capXrp,
        currentPrincipalXrp: currentXrp,
        remainingXrp: capXrp === null ? null : Math.max(0, capXrp - currentXrp),
      },
      quote,
    });
  } catch (e) {
    const msg = (e as Error).message;
    const status = /LEGACY_.*missing|deploy the stack/i.test(msg) ? 503 : 500;
    return void res.status(status).json({ error: 'VAULT_FUND_QUOTE_FAILED', detail: msg });
  }
});

/**
 * POST /api/xrpl-defi/vault-fund/prepare  { account: "r…", amountXrp: "10" }
 *
 * FUNDING THE CAGE, GOVERNED — the leg that did not exist.
 *
 * `/vault-deposit/prepare` composes bare EVM calls, which a council can never
 * sign: a multisig XRPL account has no EVM key. This routes the same intent
 * through the rail a council DOES control — the 0xFE direct mint. One XRPL
 * Payment, signed once by the quorum, carries a memo committing a userOp; the
 * executor mints FXRP into the council's own Personal Account and then runs the
 * committed batch: approve + LegacyVault.deposit(uint256).
 *
 * The XRP never touches Astryum and the FXRP never touches the executor — the
 * mint delivers to the council's PA, and the batch moves it on in the same
 * operation. Astryum composes; the quorum signs; the executor relays bytes it
 * cannot alter (#1/#8).
 *
 * Deliberately does NOT also direct the capital into a venue. Funding and
 * directing are two separate quorum decisions, and collapsing them would let
 * one signature both move family capital into a one-way cage AND choose where
 * it works. The UI says so plainly.
 */
router.post('/vault-fund/prepare', requireLegacyAccess, async (req: Request, res: Response) => {
  const gate = gateXrplDefi(regionOf(req));
  if (gate) return void res.status(gate.status).json({ error: gate.error });
  // The council funding a cage is a mint: refuse before the QUORUM signs, not
  // after three people have gathered and the XRP has parked (§3).
  const fuel = fuelGate();
  if (fuel) return void res.status(fuel.status).json(fuel.body);
  // Same disclosure gate as the birth: funding an existing cage adds principal
  // that is just as one-way as the first. The ack is per user and per version,
  // so a council that already read it is never asked twice.
  {
    const { cageAckGate } = await import('../services/flare/LegacyCageAckService');
    const ack = await cageAckGate((req as Request & { siwe?: { userId?: string } }).siwe?.userId);
    if (ack) return void res.status(ack.status).json(ack.body);
  }
  const body = (req.body ?? {}) as { account?: string; amountXrp?: string | number };
  const account = String(body.account ?? '').trim();
  const amountXrp = String(body.amountXrp ?? '').trim();
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account)) {
    return void res.status(400).json({ error: 'INVALID_BODY', detail: 'account must be the council XRPL address' });
  }
  if (!amountXrp) {
    return void res.status(400).json({ error: 'INVALID_BODY', detail: 'amountXrp is required (human XRP)' });
  }

  try {
    const { ethers } = await import('ethers');
    const { readVaultState, parseBaseUnits, formatBaseUnits } = await import(
      '../services/flare/LegacyVaultStateService'
    );
    const { assertCouncilBinding } = await import('../connectors/protocols/xrpl/XrplCouncilOrderService');
    const { requireCageForCouncil, noCageResponse } = await import('../services/flare/LegacyCageResolver');
    const { buildVaultFundingBatch, assertFundingAssetMatches } = await import(
      '../services/flare/LegacyVaultFundingService'
    );
    const { buildDirectMintHandoff, readDirectMintParams, computeNetMint, mintFeeDisclosure } =
      await import('../connectors/protocols/flare/FlareDirectMintService');

    // THE check this route existed without (founder, 2026-08-05). The cage came
    // from env, so this composed a mint that deposits a second council's XRP
    // into the FIRST council's vault — and the vault has no function that pays
    // principal to an address. The quorum would have signed away its capital
    // for good, with the UI reporting success. A cage belongs to exactly one
    // council (COUNCIL_ADDRESS_HASH is immutable in the bridge); prove the
    // pairing before anyone is asked to sign.
    let cfg;
    try {
      cfg = await requireCageForCouncil(account);
    } catch (e) {
      const noCage = noCageResponse(e);
      if (noCage) return void res.status(noCage.status).json(noCage.body);
      throw e;
    }
    const state = await readVaultState(cfg.vault);
    // The vault must obey the bridge the quorum reaches it through, or the
    // whole ceremony burns before NotCouncil(). Checked here too because this
    // route composes a mint, not a council order — it never passes through
    // buildCouncilOrderHandoff where the other check lives.
    assertCouncilBinding(state.council, cfg.bridge);
    if (state.migrated) {
      return void res
        .status(400)
        .json({ error: 'VAULT_MIGRATED', detail: 'This vault has migrated to a successor — it accepts no new principal.' });
    }

    // XRP drops == FXRP UBA for FAssets, but the vault's own decimals decide
    // how the amount is READ. They agree today (both 6); assert rather than assume.
    const grossXrpDrops = parseBaseUnits(amountXrp, 6);

    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    const params = await readDirectMintParams(provider);
    const net = computeNetMint(grossXrpDrops, params, undefined);

    // Beta cap (founder 2026-08-06): the cap covers the cage's TOTAL, so a
    // second funding cannot sneak past what the first one respected. Same
    // exemption lists as every demo cap.
    {
      const { checkCageCap } = await import('../services/flare/LegacyCageCreationService');
      const { isDemoCapExempt, isDemoCapExemptUser } = await import('../config/demoCap');
      const userId = (req as Request & { siwe?: { userId?: string } }).siwe?.userId;
      const exempt = isDemoCapExempt(account) || (await isDemoCapExemptUser(userId));
      if (!exempt) {
        const cap = checkCageCap({ currentUBA: BigInt(state.totalValue), addUBA: net.supplyUBA });
        if (!cap.ok) {
          return void res.status(400).json({ error: 'CAGE_CAP_EXCEEDED', capXrp: cap.capXrp, detail: cap.detail });
        }
      }
    }

    // The vault pulls its OWN asset; the mint delivers whatever AssetManagerFXRP
    // says is FXRP. If those ever diverge the deposit reverts with the XRP
    // already spent and the FXRP stranded in the PA.
    assertFundingAssetMatches(state.asset.address, params.fxrpToken);

    const innerCalls = buildVaultFundingBatch({
      fxrpToken: state.asset.address,
      vault: state.vault,
      supplyUBA: net.supplyUBA,
    });

    const handoff = await buildDirectMintHandoff(
      provider,
      { xrplAddress: account, grossXrpDrops, innerCalls, action: 'legacy-vault-fund' },
      { params }, // same params → the net inside the handoff matches the batch
    );

    return void res.json({
      account,
      vault: state.vault,
      personalAccount: handoff.personalAccount,
      xrplPayment: handoff.xrplPayment,
      memoHex: handoff.memoHex,
      userOpData: handoff.userOpData,
      net: {
        grossXrp: amountXrp,
        supplyUBA: net.supplyUBA.toString(),
        principalAddedXrp: formatBaseUnits(net.supplyUBA, state.asset.decimals),
      },
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        note:
          `The quorum signs ONE payment of ${amountXrp} XRP. It is minted into FXRP, delivered to this Legacy's own ` +
          `account on Flare, and deposited into the vault as PRINCIPAL (about ` +
          `${formatBaseUnits(net.supplyUBA, state.asset.decimals)} ${state.asset.symbol} after protocol fees). ` +
          'Principal cannot be withdrawn to any address — the vault has no such function. It can work in the ' +
          "council's whitelisted venues and be recalled back into the vault, or migrate to a successor after a " +
          '30-day verified continuity check. Only the yield it earns can ever be paid out. ' +
          'Putting this capital to work is a SECOND, separate order of the quorum.',
        facts: {
          ...mintFeeDisclosure(net),
          principalAdded: formatBaseUnits(net.supplyUBA, state.asset.decimals),
          asset: state.asset.symbol,
          vault: state.vault,
          network: state.chain,
          principalIsWithdrawable: false,
          signedBy: 'the council quorum',
          astryumSigns: false,
          separateOrderNeededToDirect: true,
        },
      },
    });
  } catch (e) {
    const msg = (e as Error).message;
    const status = /LEGACY_.*missing|deploy the stack/i.test(msg) ? 503 : 400;
    return void res.status(status).json({ error: 'VAULT_FUND_PREPARE_FAILED', detail: msg });
  }
});

/**
 * POST /api/xrpl-defi/cage-create/prepare  { account: "r…", amountXrp: "5", linajeFeeBps?: 3000 }
 *
 * A Legacy's cage is BORN from one quorum signature — the leg that made
 * per-Legacy cages self-service instead of a founder ritual (2026-08-05).
 *
 * ONE XRPL Payment carries it all: the memo commits [factory.create → approve →
 * deposit]; the executor pays the FDC attestation; the council's own Personal
 * Account runs the batch. The factory refuses any caller that is not that PA,
 * so nobody can squat or parameterize another Legacy's cage — and the vault's
 * address is known BEFORE it exists (CREATE2), which is what lets the same
 * signature deposit into it.
 *
 * What this deliberately does NOT do: direct the capital into a venue. That is
 * a second, separate order of the quorum — one signature must not both lock
 * family capital away and decide where it works.
 */
/**
 * The cage disclosure — the text, and whether THIS user has accepted it.
 *
 * Read-only, so it stays outside requireLegacyAccess (invariant #5: reads are
 * never gated). It is also the surface the "How a cage works" link opens, which
 * must keep working for someone who already accepted — the disclosure cannot be
 * a text you only ever get to see once.
 */
router.get('/cage-disclosure', async (req: Request, res: Response) => {
  const { cageDisclosureDocument } = await import('../config/cageDisclosure');
  const { readCageAck } = await import('../services/flare/LegacyCageAckService');
  const { cageCapXrp } = await import('../services/flare/LegacyCageCreationService');
  const userId = (req as Request & { siwe?: { userId?: string } }).siwe?.userId;
  const ack = await readCageAck(userId);
  return void res.json({
    document: cageDisclosureDocument(),
    acceptedAt: ack.acceptedAt,
    // Rendered BESIDE the document, never inside it: the cap is env-tunable and
    // a hashed text must not carry a number that can change under it.
    betaCapXrp: cageCapXrp(),
  });
});

/** Accept it. The version and hash stored are the SERVER's, not the client's. */
router.post('/cage-disclosure/ack', requireLegacyAccess, async (req: Request, res: Response) => {
  const { CAGE_ACK_IDS, CAGE_DISCLOSURE_VERSION } = await import('../config/cageDisclosure');
  const { acknowledgementsComplete, recordCageAck } = await import(
    '../services/flare/LegacyCageAckService'
  );
  const userId = (req as Request & { siwe?: { userId?: string } }).siwe?.userId;
  if (!userId) {
    return void res.status(401).json({ error: 'missing_siwe_session' });
  }
  const body = (req.body ?? {}) as { account?: string; version?: number; acknowledgements?: unknown };
  // A stale tab must not be able to accept last week's wording.
  if (Number(body.version) !== CAGE_DISCLOSURE_VERSION) {
    return void res.status(409).json({
      error: 'CAGE_DISCLOSURE_STALE',
      detail: 'The disclosure changed since this page loaded. Reload and read the current text.',
      version: CAGE_DISCLOSURE_VERSION,
    });
  }
  // Every box, individually — a single blanket "I have read it" is the pattern
  // nobody believes, which is why the document ships four specific statements.
  if (!acknowledgementsComplete(body.acknowledgements)) {
    return void res.status(400).json({
      error: 'CAGE_ACK_INCOMPLETE',
      detail: `All acknowledgements are required: ${CAGE_ACK_IDS.join(', ')}.`,
    });
  }
  const account = String(body.account ?? '').trim();
  try {
    const status = await recordCageAck({
      userId,
      account: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account) ? account : null,
      acknowledgements: body.acknowledgements as string[],
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    return void res.json(status);
  } catch (e) {
    // The ack is the evidence; if it cannot be written, it did not happen.
    return void res
      .status(500)
      .json({ error: 'CAGE_ACK_NOT_RECORDED', detail: safeErrorDetail(e) });
  }
});

router.post('/cage-create/prepare', requireLegacyAccess, async (req: Request, res: Response) => {
  // Refusals are COUNTED (in-memory, /app/admin → Jaulas): each one is a user
  // who tried to create a cage and could not, and the code says why. Lazy and
  // fire-and-forget — metering must never break the refusal itself.
  const meter = (code: string) => {
    void import('../services/flare/LegacyCageFleetService')
      .then((m) => m.recordCageCreateRefusal(code))
      .catch(() => {});
  };
  const gate = gateXrplDefi(regionOf(req));
  if (gate) {
    meter('REGION_GATED');
    return void res.status(gate.status).json({ error: gate.error });
  }
  // A cage birth IS a mint: refuse before the quorum gathers, not after (§3).
  const fuel = fuelGate();
  if (fuel) {
    meter('EXECUTOR_FUEL_EXHAUSTED');
    return void res.status(fuel.status).json(fuel.body);
  }
  // The disclosure gate (founder 2026-08-06). Birth is the moment capital first
  // becomes irreversible, so it is the moment the acknowledgement has to exist —
  // enforced here and not only in the modal, or it would be a UI gate.
  {
    const { cageAckGate } = await import('../services/flare/LegacyCageAckService');
    const ack = await cageAckGate((req as Request & { siwe?: { userId?: string } }).siwe?.userId);
    if (ack) {
      meter('CAGE_ACK_REQUIRED');
      return void res.status(ack.status).json(ack.body);
    }
  }
  const body = (req.body ?? {}) as { account?: string; amountXrp?: string | number; linajeFeeBps?: number };
  const account = String(body.account ?? '').trim();
  const amountXrp = String(body.amountXrp ?? '').trim();
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account)) {
    return void res.status(400).json({ error: 'INVALID_BODY', detail: 'account must be the council XRPL address' });
  }
  if (!amountXrp) {
    return void res.status(400).json({ error: 'INVALID_BODY', detail: 'amountXrp is required (the first principal — human XRP)' });
  }

  try {
    const { ethers } = await import('ethers');
    const { legacyNetworkConfig } = await import('../connectors/protocols/xrpl/XrplCouncilOrderService');
    const { cageForCouncil } = await import('../services/flare/LegacyCageResolver');
    const {
      buildCageCreationBatch,
      configuredBirthVenues,
      normalizeLinajeFeeBps,
      predictCageAddresses,
      requiredProtocolTreasury,
    } = await import('../services/flare/LegacyCageCreationService');
    const { buildDirectMintHandoff, readDirectMintParams, computeNetMint, mintFeeDisclosure } =
      await import('../connectors/protocols/flare/FlareDirectMintService');
    const { formatBaseUnits, parseBaseUnits } = await import('../services/flare/LegacyVaultStateService');

    // ── Preconditions, each with the reason said out loud. ───────────────────
    const factoryAddress = process.env.LEGACY_FACTORY_ADDRESS;
    if (!factoryAddress || !ethers.isAddress(factoryAddress)) {
      meter('CAGE_FACTORY_NOT_DEPLOYED');
      return void res.status(503).json({
        error: 'CAGE_FACTORY_NOT_DEPLOYED',
        detail:
          'The cage factory is not configured on this install (LEGACY_FACTORY_ADDRESS). ' +
          'Until it is, cages can only be deployed by the founder ritual.',
      });
    }
    // One council, one cage — the factory enforces it on-chain; refusing here
    // saves the quorum a ceremony that would revert with CageAlreadyExists.
    const existing = await cageForCouncil(account);
    if (existing) {
      meter('CAGE_ALREADY_EXISTS');
      return void res.status(409).json({
        error: 'CAGE_ALREADY_EXISTS',
        detail: `This Legacy already has its cage at ${existing.vault}. A council gets one; succession is what migrate is for.`,
        vault: existing.vault,
      });
    }
    // The text precedes the code: the constitution must already be anchored on
    // XRPL — its SHA-256 is an ETERNAL constructor param of the vault.
    const anchor = await xrplProvider.getDidObject(account).catch(() => null);
    const refHex = String(anchor?.dataHex ?? '');
    if (!/^[0-9a-fA-F]{64}$/.test(refHex)) {
      meter('CONSTITUTION_NOT_ANCHORED');
      return void res.status(409).json({
        error: 'CONSTITUTION_NOT_ANCHORED',
        detail:
          'This council has not anchored its constitution on XRPL yet (DIDSet). The cage is born pointing at ' +
          'that text — anchor it first from the Legacy page, then create the cage.',
      });
    }
    const venues = configuredBirthVenues();
    if (venues.length === 0) {
      meter('NO_BIRTH_VENUES_CONFIGURED');
      return void res.status(503).json({
        error: 'NO_BIRTH_VENUES_CONFIGURED',
        detail: 'No whitelisted venues are configured (KINETIC_KFXRP_ISO / FIRELIGHT_STXRP) — a cage born without venues could never work its capital.',
      });
    }

    const net_ = legacyNetworkConfig();
    const provider = new ethers.JsonRpcProvider(net_.rpcUrl);
    const params = await readDirectMintParams(provider);
    const grossXrpDrops = parseBaseUnits(amountXrp, 6);
    const net = computeNetMint(grossXrpDrops, params, undefined);

    // Beta cap (founder 2026-08-06): caged principal never comes back out to an
    // address, so nobody cages more than the cap through our rails. Exemptions
    // reuse the demo-cap lists (account first, address as fallback).
    const { checkCageCap } = await import('../services/flare/LegacyCageCreationService');
    const { isDemoCapExempt, isDemoCapExemptUser } = await import('../config/demoCap');
    const userId = (req as Request & { siwe?: { userId?: string } }).siwe?.userId;
    const exempt = isDemoCapExempt(account) || (await isDemoCapExemptUser(userId));
    if (!exempt) {
      const cap = checkCageCap({ currentUBA: BigInt(0), addUBA: net.supplyUBA });
      if (!cap.ok) {
        meter('CAGE_CAP_EXCEEDED');
        return void res.status(400).json({ error: 'CAGE_CAP_EXCEEDED', capXrp: cap.capXrp, detail: cap.detail });
      }
    }

    const cageParams = {
      asset: params.fxrpToken, // the SAME token the mint delivers — matched by construction
      constitutionRef: ('0x' + refHex).toLowerCase(),
      protocolTreasury: requiredProtocolTreasury(),
      linajeFeeBps: normalizeLinajeFeeBps(body.linajeFeeBps),
      initialVenues: venues,
    };

    // Where the cage WILL live — asked of the factory itself (CREATE2).
    const predicted = await predictCageAddresses(provider, factoryAddress, account, cageParams);

    const innerCalls = buildCageCreationBatch({
      factoryAddress,
      councilR: account,
      params: cageParams,
      predictedVault: predicted.vault,
      supplyUBA: net.supplyUBA,
    });

    const handoff = await buildDirectMintHandoff(
      provider,
      { xrplAddress: account, grossXrpDrops, innerCalls, action: 'legacy-cage-create' },
      { params },
    );

    return void res.json({
      account,
      predicted,
      factory: factoryAddress,
      personalAccount: handoff.personalAccount,
      xrplPayment: handoff.xrplPayment,
      memoHex: handoff.memoHex,
      userOpData: handoff.userOpData,
      net: {
        grossXrp: amountXrp,
        supplyUBA: net.supplyUBA.toString(),
        firstPrincipalXrp: formatBaseUnits(net.supplyUBA, 6),
      },
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        note:
          `The quorum signs ONE payment of ${amountXrp} XRP, and this Legacy's own cage is born on Flare: a vault at ` +
          `${predicted.vault} that obeys ONLY this council (its XRPL address is written into the bridge at birth and can ` +
          `never change), holding about ${formatBaseUnits(net.supplyUBA, 6)} FXRP as its first principal. ` +
          'Principal cannot be withdrawn to any address — the vault has no such function. Only the yield it earns can ' +
          'ever be paid out. The creation runs from this council’s own account on Flare; Astryum signs nothing and ' +
          'the relayer that carries the proof has zero authority. Putting this capital to work in a venue is a SECOND, ' +
          'separate order of the quorum.',
        facts: {
          ...mintFeeDisclosure(net),
          cageWillLiveAt: predicted.vault,
          bridgeWillLiveAt: predicted.bridge,
          obeysOnly: account,
          constitutionRef: cageParams.constitutionRef,
          linajeFee: `${cageParams.linajeFeeBps / 100}% (adjustable by quorum order between 10% and 40%)`,
          protocolTreasury: cageParams.protocolTreasury,
          birthVenues: venues.map((v) => v.label).join(', '),
          firstPrincipal: `${formatBaseUnits(net.supplyUBA, 6)} FXRP`,
          principalIsWithdrawable: false,
          signedBy: 'the council quorum',
          astryumSigns: false,
          separateOrderNeededToDirect: true,
        },
      },
    });
  } catch (e) {
    const msg = (e as Error).message;
    meter('CAGE_CREATE_PREPARE_FAILED');
    const status = /LEGACY_.*missing|LEGACY_PROTOCOL_TREASURY|deploy the stack/i.test(msg) ? 503 : 400;
    return void res.status(status).json({ error: 'CAGE_CREATE_PREPARE_FAILED', detail: msg });
  }
});

router.post('/vault-deposit/prepare', requireLegacyAccess, async (req: Request, res: Response) => {
  const gate = gateXrplDefi(regionOf(req));
  if (gate) return void res.status(gate.status).json({ error: gate.error });
  // The third door principal can enter through — gated like the other two.
  {
    const { cageAckGate } = await import('../services/flare/LegacyCageAckService');
    const ack = await cageAckGate((req as Request & { siwe?: { userId?: string } }).siwe?.userId);
    if (ack) return void res.status(ack.status).json(ack.body);
  }
  const account = String((req.body ?? {}).account ?? '').trim();
  const amount = String((req.body ?? {}).amount ?? '').trim();
  // Same one-way street as the governed funding route: a deposit into the wrong
  // cage is capital handed to another council for good.
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account)) {
    return void res.status(400).json({ error: 'INVALID_BODY', detail: 'account (the Legacy being funded) is required' });
  }
  if (!amount) return void res.status(400).json({ error: 'INVALID_BODY', detail: 'amount is required (human units)' });
  try {
    const { readVaultState, buildVaultDepositCalls, parseBaseUnits } = await import(
      '../services/flare/LegacyVaultStateService'
    );
    const { requireCageForCouncil, noCageResponse } = await import('../services/flare/LegacyCageResolver');
    let cage;
    try {
      cage = await requireCageForCouncil(account);
    } catch (e) {
      const noCage = noCageResponse(e);
      if (noCage) return void res.status(noCage.status).json(noCage.body);
      throw e;
    }
    const state = await readVaultState(cage.vault);
    const addUBA = parseBaseUnits(amount, state.asset.decimals);
    // Same beta cap as the governed funding — a bare EVM deposit is still our
    // rail composing capital into a one-way vessel.
    {
      const { checkCageCap } = await import('../services/flare/LegacyCageCreationService');
      const { isDemoCapExempt, isDemoCapExemptUser } = await import('../config/demoCap');
      const userId = (req as Request & { siwe?: { userId?: string } }).siwe?.userId;
      const exempt = isDemoCapExempt(account) || (await isDemoCapExemptUser(userId));
      if (!exempt) {
        const cap = checkCageCap({ currentUBA: BigInt(state.totalValue), addUBA });
        if (!cap.ok) {
          return void res.status(400).json({ error: 'CAGE_CAP_EXCEEDED', capXrp: cap.capXrp, detail: cap.detail });
        }
      }
    }
    const plan = buildVaultDepositCalls(state, addUBA);
    return void res.json(plan);
  } catch (e) {
    const msg = (e as Error).message;
    const status = /LEGACY_.*missing|deploy the stack/i.test(msg) ? 503 : 400;
    return void res.status(status).json({ error: 'VAULT_DEPOSIT_PREPARE_FAILED', detail: msg });
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
    return void res.status(500).json({ error: 'WATCH_FAILED', detail: safeErrorDetail(e) });
  }
});

export default router;
