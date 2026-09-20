/**
 * XRPL native DeFi — prepare-only endpoints (Fase 2 builders).
 *
 * Every POST returns an UNSIGNED txjson (SourceTag stamped) + a full
 * disclosure (#6); the frontend hands the txjson to Xaman and the USER signs
 * (submit:false rail). Astryum signs nothing, submits nothing (#1).
 */

import { handoffPayloadExpiryMin, forwardedProofRefusalBody, forwardedProofRefusalStatus } from '../services/flare/handoffAuthority';
import { zeroFeMemoOfTx } from '../services/flare/DirectMintHandoffStore';
import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
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
import { COUNCIL_ORDER_EXIT_ACTIONS as SHARED_COUNCIL_ORDER_EXIT_ACTIONS } from '../services/councilExitToken';

/**
 * THE SIGNING WINDOW TRAVELS WITH THE 0xFE.
 *
 * The seat's life is measured from the Xaman payload's expiry, and the client
 * used to invent that number (a hardcoded 5). One deployment changing the
 * server's value would then either free a seat while its payload was still
 * signable — the twin — or hold it long after. Same field and same shape as
 * `flareDemo`'s `zeroFeSigningWindow`, so every 0xFE answers alike.
 */
function zeroFeSigningWindow(h: {
  payloadExpiryMin?: number | null;
  payloadExpiresAt?: string | null;
  signerListRead?: string | null;
}): { payloadExpiryMin: number; payloadExpiresAt?: string; signerListRead?: 'single' | 'quorum' | 'unknown' } {
  const min = typeof h?.payloadExpiryMin === 'number' && h.payloadExpiryMin > 0 ? h.payloadExpiryMin : handoffPayloadExpiryMin();
  // Whether that window is a READ or a default travels beside it.
  // The browser only skips its own SignerList read on `'single'` — a window
  // alone never says why it is short.
  const read = h?.signerListRead;
  return {
    payloadExpiryMin: min,
    ...(typeof h?.payloadExpiresAt === 'string' && h.payloadExpiresAt ? { payloadExpiresAt: h.payloadExpiresAt } : {}),
    ...(read === 'single' || read === 'quorum' || read === 'unknown' ? { signerListRead: read } : {}),
  };
}

/**
 * ¿LA FIRMA ESTE 0xFE UN QUÓRUM? Un Legacy es una cuenta XRPL con
 * SignerList: sus herederos SON el quórum, y sus payloads de Xaman se crean con
 * `expire: 1440` (`lib/xrpl/councilSigning.ts`). Componer ese 0xFE con la ventana
 * de una firma simple dejaba su `LastLedgerSequence` atrás a los seis minutos, así
 * que el consejo firmaba bytes que ya no pueden entrar. Pero la MISMA ruta la usa
 * una cuenta de firma simple, así que no se adivina: se lee el SignerList
 * (`signingCeremonyFor`, con sus dos reglas — «no pude leer» no estira nada, y una
 * cuenta operativa tampoco). Gemelo del helper de `routes/institutional.ts`.
 */
async function ceremonyWindowFor(
  account: string,
): Promise<{ signingCeremony?: true; signerListRead?: 'single' | 'quorum' | 'unknown' }> {
  try {
    const { signingCeremonyFor } = await import('../connectors/protocols/flare/FlareDirectMintService');
    // `signerListRead` rides along — the builder stamps it on the
    // handoff and `zeroFeSigningWindow` answers it, so the browser can tell a
    // window that was READ from one that is merely the default.
    return await signingCeremonyFor(account);
  } catch {
    return {}; // una ventana que no se pudo decidir es la de siempre, nunca una más larga
  }
}

const router = Router();

/**
 * §3 — global fee-budget pre-check for the routes that MINT.
 *
 * A mint has two legs: the user signs an XRPL Payment, and the executor pays a
 * ~20 FLR FDC attestation to make leg 2 happen on Flare. If the budget is
 * exhausted, the XRP leaves and PARKS with no reclaim — the "unearned success"
 * shape at its most expensive. flareDemo has guarded this;
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
      // User-facing strings are English — this one reached the
      // screen in Spanish through every reader that prints `detail`. Same truth,
      // no promise: the daily budget refills, and nothing here says when.
      detail:
        'The executor has no budget left to attest another operation on Flare today. Your XRP has NOT ' +
        'moved and will not be parked: this stopped before asking for your signature. Try again once ' +
        'the daily budget has been refilled.',
    },
  };
}

/**
 * THE 0xFE SEAT REFUSALS, SAID AS THEMSELVES.
 *
 * `buildDirectMintHandoff` refuses in two ways that are NOT a bad request: the nonce
 * seat of that Personal Account is taken (a draft that may still land, 409, with its
 * own code and whether retrying can help), and the XRPL account is one Astryum
 * operates, which only takes its own dispatches (403). This router mapped both to a
 * flat 400/503 «prepare failed», so a screen could not tell «wait / retry» from
 * «broken». Same mapping the institutional router already applies.
 */
function handoffErrorResponse(e: unknown): { status: number; body: Record<string, unknown> } | null {
  const name = (e as { name?: string })?.name;
  if (name === 'OperationalAccountHandoffError') {
    return { status: 403, body: { error: 'OPERATIONAL_ACCOUNT_HANDOFF_REFUSED', detail: safeErrorDetail(e) } };
  }
  if (name === 'NonceSeatTakenError') {
    // La puerta del asiento reenvía el refusal de la tienda de
    // pruebas ENTERO (código, headline, ways, retryAfterSeconds, detail, y su
    // status) — jamás un `PROOF_STORE_UNREADABLE` reconstruido del mensaje.
    const forwarded = forwardedProofRefusalBody(e);
    if (forwarded) return { status: forwardedProofRefusalStatus(e) ?? 503, body: forwarded };
    // THE WHOLE BODY, not a bare code. The builder also says
    // WHEN the seat frees itself (`secondsLeft`, the blocking row's
    // `lastLedgerSequence`), any warning it attached, and — only for a session that
    // may touch that row (it prepared it, or it proves the account) — the `memoHex`
    // with which a screen can offer «free that seat». Dropping those left the user
    // staring at `NONCE_SEAT_TAKEN` with no way out. Same contract as `nonceSeatBody`
    // in flareDemo.ts; a stranger is never told that memo exists.
    const err = e as {
      code?: string;
      retryable?: boolean;
      lastLedgerSequence?: number;
      secondsLeft?: number;
      memoHex?: string;
      seatWarning?: string;
    };
    return {
      /**
       * 503 cuando NO PUDIMOS LEER el estado del asiento
       * (`SeatStateUnreadableError` conserva el `name` del padre a propósito, así que
       * el nombre no basta para distinguirlos: la clase trae su propia marca). El 409
       * queda para el asiento que de verdad está ocupado — sobre una salida, «no pude
       * leer» jamás es un conflicto definitivo.
       */
      status: (e as { unreadableSeatState?: boolean })?.unreadableSeatState === true ? 503 : 409,
      body: {
        error: err.code ?? 'NONCE_SEAT_TAKEN',
        ...(typeof err.retryable === 'boolean' ? { retryable: err.retryable } : {}),
        ...(err.lastLedgerSequence !== undefined ? { lastLedgerSequence: err.lastLedgerSequence } : {}),
        ...(err.secondsLeft !== undefined ? { secondsLeft: err.secondsLeft } : {}),
        ...(err.memoHex ? { memoHex: err.memoHex } : {}),
        ...(err.seatWarning ? { seatWarning: err.seatWarning } : {}),
        detail: safeErrorDetail(e),
      },
    };
  }
  return null;
}

/**
 * LAS DOS MITADES DEL ASIENTO,
 * POR UNA SOLA PUERTA. Gemelo exacto de `seatProofFieldsFor` en `institutional.ts` y
 * de `seatClaimOf` en `flareDemo.ts`; la pieza compartida es `seatProofFromVerdict`,
 * así que las tres no pueden separarse.
 */
interface SeatProofFields {
  preparedByProven: boolean;
  preparedByProofUnreadable: boolean;
  supersedeAuthorized: boolean;
}
async function seatProofFieldsFor(
  req: Request,
  account: string,
  opts: { purpose: 'entry' | 'exit'; supersede?: boolean },
): Promise<SeatProofFields> {
  const addr = typeof account === 'string' ? account.trim() : '';
  const { sessionAuthorityOnXrplAccount } = await import('../services/flare/handoffAuthority');
  const authority = await sessionAuthorityOnXrplAccount(req, addr, opts.purpose);
  const { seatProofFromVerdict } = await import('../services/identity/provenAddresses');
  const claim = seatProofFromVerdict(
    {
      // La puerta del fundador vive DENTRO de `sessionAuthorityOnXrplAccount` y
      // cuenta como prueba: por eso el veredicto es el suyo.
      proven: authority.mayAct,
      storeReadable: authority.outcome !== 'could-not-read',
      refusal: authority.refusal,
    },
    { supersede: opts.supersede === true },
  );
  // EL REFUSAL VIAJA ENTERO. Esta rama
  // reescribía cualquier refusal reintentable como un `PROOF_STORE_UNREADABLE`
  // de frase fija («could not read … try again in a moment»).
  // también entra por aquí `PROOF_FLOOR_AHEAD_OF_CLOCK` (la marca de toma de
  // posesión adelantada a nuestro reloj), para el que esa frase es falsa por
  // las dos mitades: la fila SE LEYÓ y el instante puede ser 2099. Se perdían el
  // código, `headline` y `ways` («re-linking will not help», «an administrator
  // can check that date»), y el heredero veía «try again in a moment» en bucle
  // sobre el cobro de su propio rendimiento. `fromProofRefusal` guarda el
  // refusal en el error y `handoffErrorResponse` lo reenvía tal cual. Gemelo de
  // `seatClaimOf` (flareDemo) y de `seatProofFieldsFor` (institutional).
  if (claim.refusal?.retryable === true) {
    const { SeatStateUnreadableError } = await import('../connectors/protocols/flare/FlareDirectMintService');
    throw SeatStateUnreadableError.fromProofRefusal(claim.refusal);
  }
  return {
    preparedByProven: claim.preparedByProven,
    preparedByProofUnreadable: claim.preparedByProofUnreadable,
    supersedeAuthorized: claim.supersedeAuthorized,
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

/**
 * THE EXIT IS NEVER GATED (doctrine «LA SALIDA JAMÁS SE GATEA»).
 *
 * The gate for EXITS: flag-only (#10), NO geofence. The geofence (#5) exists to
 * stop OPENING DeFi exposure from a blocked region; it must never hold capital the
 * holder already has on the ledger. Releasing an escrow (finish), recovering it
 * after CancelAfter (cancel — the promise the EscrowCreate disclosure makes),
 * cancelling one's own resting order, and withdrawing one's own AMM liquidity all
 * bring the holder's capital back — a 451 there turns a jurisdiction switch into a
 * lock on their money.
 */
function gateXrplDefiExit(): { status: number; error: string } | null {
  if (process.env.XRPL_DEFI_ENABLED !== 'true') {
    return { status: 503, error: 'XRPL_DEFI_DISABLED' };
  }
  return null;
}

function regionOf(req: Request): string | null {
  const r = (req.body?.region ?? req.query?.region) as unknown;
  return typeof r === 'string' && r.trim() ? r.trim() : null;
}

/** Uniform prepare-endpoint wrapper for ENTRIES: flag + geofence → zod → builder → handoff | readable error. */
function prepare<S extends z.ZodTypeAny>(
  schema: S,
  build: (input: z.infer<S>) => unknown,
): (req: Request, res: Response) => void {
  return prepareBehind((req) => gateXrplDefi(regionOf(req)), schema, build);
}

/**
 * The same wrapper for EXITS: flag-only, never the geofence (see gateXrplDefiExit).
 * A route that brings the holder's capital back uses THIS, never `prepare`.
 */
function prepareExit<S extends z.ZodTypeAny>(
  schema: S,
  build: (input: z.infer<S>) => unknown,
): (req: Request, res: Response) => void {
  return prepareBehind(() => gateXrplDefiExit(), schema, build);
}

function prepareBehind<S extends z.ZodTypeAny>(
  gateOf: (req: Request) => { status: number; error: string } | null,
  schema: S,
  build: (input: z.infer<S>) => unknown,
): (req: Request, res: Response) => void {
  return (req, res) => {
    const gate = gateOf(req);
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
// Both are EXITS (the escrowed XRP is released, or returns to its creator), so
// this handler is flag-only — THE EXIT IS NEVER GATED (see gateXrplDefiExit).
function escrowReleaseHandler(
  build: typeof buildEscrowFinish | typeof buildEscrowCancel,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    const gate = gateXrplDefiExit();
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
// Cancelling one's OWN resting order releases what it had on offer: an exit.
router.post(
  '/offer-cancel/prepare',
  prepareExit(offerCancelSchema, (i) => buildOfferCancel(i as Parameters<typeof buildOfferCancel>[0])),
);
router.post(
  '/amm-deposit/prepare',
  prepare(ammDepositSchema, (i) => buildAmmDeposit(i as Parameters<typeof buildAmmDeposit>[0])),
);
// Withdrawing one's OWN AMM liquidity (burning LP tokens for the pool assets): an exit.
router.post(
  '/amm-withdraw/prepare',
  prepareExit(ammWithdrawSchema, (i) => buildAmmWithdraw(i as Parameters<typeof buildAmmWithdraw>[0])),
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

/**
 * WHAT ACTUALLY HAPPENS TO BOTH TRANSACTIONS.
 *
 * Pure, and deliberately unpromising. Told a family «the exit takes the seat»;
 * XRPL does not work that way — the account has ONE Sequence seat, it is burnt
 * exactly once, and the winner is whoever REACHES THE LEDGER first. All a prepare
 * can do is pin this payload to the same number on purpose, and say so.
 */
/**
 * THE SCREEN STOPPED INVENTING A RIVAL.
 *
 * WHAT FAILED IN SILENCE: `/multisign/prepare` pushed THREE different sentences into
 * one `seatContestWarning` string — «I could not confirm this is an exit», «I could
 * not read the inbox», and the real contest with another payload — and the only
 * reader on any screen (`seatContestNotice`) painted all three as «another payload of
 * this account is holding the same Sequence», with a body telling the family to go
 * settle a proposal that, in two of the three cases, DOES NOT EXIST. The one sentence
 * that mattered («we could not confirm this is an exit — check your inbox») had no
 * reader at all: it was swallowed by a headline about a rival.
 */
/**
 * `rival-seat` WAS BEING SAID ABOUT A SEAT THIS
 * PAYLOAD NEVER TOOK.
 */
export type SeatNoticeKind =
  | 'rival-seat'
  | 'seat-already-spent'
  | 'seat-not-pinned'
  | 'unclassified-exit'
  | 'inbox-unreadable';

export interface SeatNotice {
  kind: SeatNoticeKind;
  /** The row in the inbox, when one exists (`rival-seat`, `seat-already-spent`, `seat-not-pinned`). */
  proposalId?: string;
  /** That row's TRANSACTION TYPE — never its title. */
  txType?: string;
  /**
   * `rival-seat` ONLY: the Sequence BOTH payloads now hold. It is a fact about THESE
   * bytes, so it is never populated for a seat this payload did not take (2.1).
   */
  pinnedSequence?: number;
  /** `seat-already-spent` / `seat-not-pinned`: the Sequence the OTHER row holds, when known. */
  theirSequence?: number;
  /** `seat-already-spent` / `seat-not-pinned`: the Sequence THESE bytes carry, when known. */
  ourSequence?: number;
  /**
   * WHICH SENTENCE IS THE HEADLINE. Several situations can be true at
   * once (an unreadable inbox AND an unclassified payload, say), and the screen was
   * painting them side by side with no order. Lower = closer to the real state of the
   * seat; the list arrives SORTED by it, so `seatNotices[0]` is the one to show first
   * and the rest are the detail underneath.
   */
  priority: number;
  /** Server prose, safe to print verbatim. */
  detail: string;
}

/**
 * The order the screen must read them in. A real contest outranks
 * everything (it is the only one that asks the family to do something); then what
 * happened to the seat; then our own failed reads, which say nothing about anybody.
 */
export const SEAT_NOTICE_PRIORITY: Record<SeatNoticeKind, number> = {
  'rival-seat': 1,
  'seat-already-spent': 2,
  'seat-not-pinned': 3,
  'inbox-unreadable': 4,
  'unclassified-exit': 5,
};

/** Pure: the notices in the order a screen should render them. Stable within a priority. */
export function sortSeatNotices(notices: readonly SeatNotice[]): SeatNotice[] {
  return notices
    .map((n, i) => ({ n, i }))
    .sort((a, b) => a.n.priority - b.n.priority || a.i - b.i)
    .map(({ n }) => n);
}

export function seatContestPhysics(
  pin: { pinned: number; source: 'ledger' | 'contested-seat'; requestedSeatConsumed?: boolean } | null,
  contestedSequence: number | null,
): string {
  if (pin && pin.source === 'contested-seat') {
    return (
      `This exit is pinned to that very Sequence (${pin.pinned}) on purpose, so both payloads now hold the same seat. ` +
      'XRPL burns a Sequence exactly once: only ONE of the two can ever apply — whichever reaches the ledger first — ' +
      'and the other fails with tefPAST_SEQ, costs nothing but its fee, and has to be composed again from scratch ' +
      '(its signatures simply stop being usable). Pinning the same number is ALL the ledger allows: it does not make ' +
      'this exit win the race, and we will not tell you it does. ' +
      /**
       * «LIQUIDA ESA FILA» SIN MIRAR EL EXPLORADOR PRIMERO.
       *
       * Esta frase decía «Settle the other payload in the inbox» a secas. El asiento
       * en disputa puede venir de una fila VENCIDA cuyo ledgerCheck es `unverified`
       * —es decir, no pudimos comprobar si ya se ejecutó—, así que mandar a
       * re-difundirla o a archivarla es exactamente la instrucción que paga dos
       * veces. Primero el explorador; después, y solo después, la bandeja.
       */
      'Look the account up on an explorer BEFORE you touch the other payload: if it already went out, ' +
      're-broadcasting it or filing it as withdrawn is the double payment itself. Once the explorer says it did ' +
      'not, settle it in the proposal inbox.'
    );
  }
  if (pin && pin.requestedSeatConsumed === true) {
    return (
      `That seat has already been spent on the ledger, so there is nothing left to contest: this exit carries the next ` +
      `free Sequence (${pin.pinned}) and applies on its own. DO NOT assume the other payment failed — something ` +
      'consumed that Sequence, and it may well have been that very payload landing. Look the account up on an ' +
      'explorer and see what went through BEFORE you settle that row or compose anything else.'
    );
  }
  const mine = pin ? ` (this one carries Sequence ${pin.pinned}` : ' (this one carries a freshly read Sequence';
  const theirs = contestedSequence !== null ? `, that one holds ${contestedSequence})` : ', that one we could not read)';
  return (
    `We could not pin this exit to that payload's seat${mine}${theirs}. XRPL burns a Sequence exactly once, so if the ` +
    'two do carry the same number only one of them can apply — whichever reaches the ledger first — and the other ' +
    'fails with tefPAST_SEQ and costs only its fee. Check the account on an explorer before you gather the quorum.'
  );
}
router.post('/multisign/prepare', requireLegacyAccess, async (req: Request, res: Response) => {
  // GEOFENCED BY DEFAULT, deliberately (reviewed against «LA SALIDA JAMÁS
  // SE GATEA»). This door is content-agnostic: it pins ANY `xrplTx` from the body —
  // a cage birth, a vault fund, a direct-to order as much as a recall — and nothing
  // in the bytes can tell which (a council order's memo is only a hash). Making it
  // flag-only would ungate every multisig ENTRY.
  const { verifyCouncilExitToken, classifyCouncilExitByMemo, GENERIC_PREPARE_REFUSAL } =
    await import('../services/councilExitToken');
  const body = (req.body ?? {}) as { exitToken?: unknown; account?: unknown; xrplTx?: unknown };
  const exitVerdict = verifyCouncilExitToken(body.exitToken, { account: body.account, xrplTx: body.xrplTx });
  // The FLAG closes the module for everything, exit included,
  // and it is decided before any lookup: with the module off nothing is composed, so
  // there is nothing to classify and no read worth spending.
  const flagGate = gateXrplDefiExit();
  if (flagGate) {
    return void res.status(flagGate.status).json({
      error: flagGate.error,
      ...('reason' in exitVerdict && exitVerdict.reason !== 'absent' ? { exitTokenRejected: exitVerdict.reason } : {}),
    });
  }
  const serverExit = await classifyCouncilExitByMemo({ account: body.account, xrplTx: body.xrplTx });
  /** Did the SERVER classify these exact bytes as an exit — by its token or by its memo? */
  const isExit = exitVerdict.ok === true || serverExit.ok === true;
  /**
   * We could not READ what this is. Not a verdict about the
   * transaction and never a permission: it decides only that the SEAT guards below
   * treat it as an exit (compose + warning) instead of as an entry (422). The region
   * gate is deliberately NOT relaxed by it — a failed read of ours must not become a
   * way to ungate every entry from a blocked region.
   */
  const unclassified = serverExit.ok === false && serverExit.reason === 'unreadable';
  const gate = isExit ? null : gateXrplDefi(regionOf(req));
  /**
   * May this caller be TOLD WHY? Asked lazily and ONLY to word a
   * refusal — never to decide whether something is composed, and never on the way to
   * a 200. Memoised per request; a session with nothing proven and nothing registered
   * answers false with no ledger read at all, so a prober cannot amplify reads.
   */
  let knowsCouncil: Promise<boolean> | null = null;
  const callerKnowsCouncil = (): Promise<boolean> => {
    if (!knowsCouncil) {
      knowsCouncil = (async () => {
        const account = typeof body.account === 'string' ? body.account.trim() : '';
        if (!account) return false;
        const { sessionMayReadCouncilAccount } = await import('../services/flare/ComposedCouncilOrderStore');
        return sessionMayReadCouncilAccount(req, account);
      })();
    }
    return knowsCouncil;
  };
  // Said in EVERY region: this payment can no longer reach the ledger as an
  // exit, so signing it spends the carrier for nothing. Not a refusal of the exit —
  // the exit is composed again, from the same screen, in one click.
  if (serverExit.ok === false && serverExit.reason === 'handoff-not-signable') {
    if (!(await callerKnowsCouncil())) {
      return void res.status(409).json({ ...GENERIC_PREPARE_REFUSAL });
    }
    return void res.status(409).json({
      error: 'EXIT_HANDOFF_NOT_SIGNABLE',
      exitClassification: serverExit.reason,
      handoffStatus: serverExit.handoffStatus,
      detail: serverExit.detail,
    });
  }
  if (gate) {
    // THE REFUSAL HAS TO BE TRUE. The other answer
    // the classification gives is not about the region either, and dressing it as
    // GEOFENCE_BLOCKED told the council «your country» when the truth was «I could
    // not read». (Outside the gate an unreadable classification refuses NOTHING: it
    // is our failure, and a prepare composes unsigned bytes.)
    if (unclassified) {
      // A caller who does not prove the account learns nothing about
      // what the server did or did not compose — same sentence, same status, for
      // every reason (`GENERIC_PREPARE_REFUSAL`).
      if (!(await callerKnowsCouncil())) {
        return void res.status(409).json({ ...GENERIC_PREPARE_REFUSAL });
      }
      return void res.status(503).json({
        error: 'EXIT_CLASSIFICATION_UNREADABLE',
        exitClassification: 'unreadable',
        retryable: true,
        detail:
          'The server could not read what it composed for this transaction, so it cannot tell whether it is an exit ' +
          '— and it will not guess. Nothing was prepared and nothing moved: try again in a moment. If this is an exit, ' +
          'it is never refused for your region.',
      });
    }
    const knows = await callerKnowsCouncil();
    if (!knows && serverExit.ok === false) {
      // The 451 is about the REGION, which is true for this caller; what it must not
      // carry is the classifier's reason about somebody else's memo.
      return void res.status(gate.status).json({
        error: gate.error,
        ...('reason' in exitVerdict && exitVerdict.reason !== 'absent' ? { exitTokenRejected: exitVerdict.reason } : {}),
      });
    }
    return void res.status(gate.status).json({
      error: gate.error,
      // Said out loud when a token came and did not open the exit: the council
      // otherwise sees a bare 451 over what it composed as a recall.
      ...('reason' in exitVerdict && exitVerdict.reason !== 'absent' ? { exitTokenRejected: exitVerdict.reason } : {}),
      ...(serverExit.ok === false ? { exitClassification: serverExit.reason } : {}),
    });
  }
  const parsed = multisignPrepareSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  try {
    // ── puertas-y-permiso — THE THIRD COMPOSE DOOR ─────────────────
    //
    // WHAT FAILED IN SILENCE: two doors pin a new Sequence for a council and
    // BOTH ask the ledger about the stale ones first — `POST /api/council/
    // proposals` (422 PRIOR_SEAT_UNRESOLVED) and
    // `CouncilProposalService.createCouncilProposalFromRule`. This is the
    // third, and it had none of it. It is the SYNCHRONOUS ceremony — mounted
    // in LegacyPanel, CouncilOrderCard, CouncilVaultEntry and CageBirthCard —
    // so with an unresolved row sitting in the inbox the family could compose
    // the same payment here, gather the quorum in ONE sitting and broadcast:
    // the council pays twice, on the surface the money enters the cage by.
    const { findLiveProposal, findUnresolvedSeat, recordCeremonySeat, sessionIsCouncilMember } =
      await import('./councilProposals');

    // ── permisos-y-doble-pago — THE OTHER HALF OF THE VERY SAME SEAT ─────────
    //
    // The guard below covers proposals PAST their deadline. A proposal INSIDE
    // its deadline was left untouched, and it is the closer danger: this route
    // pins whatever `account_info` calls the next unused Sequence, which is the
    // SAME Sequence that live proposal already pinned. Two signature
    // collections, one seat — the ledger burns it exactly once, so whichever
    // broadcasts first wins and the other becomes a corpse the inbox still
    // paints as alive (inside the deadline `withEffectiveStatus` returns early
    // and never asks the ledger). Then the proposer files that corpse — inside
    // the deadline withdrawing costs no read and raises no verdict — `POST /`
    // finds nothing stale, and the council composes the same payment over a
    // fresh Sequence. IT PAYS TWICE.
    const exitForSeat = isExit || unclassified;
    /**
     * ── COMPOSING IS NOT THE SAME AS TAKING THE
     *    SEAT ──────────────────────────────────────────────────────────────────
     */
    const mayPinContestedSeat = isExit;
    /**
     * The title and the ledger verdict of a row belong to ITS council.
     * Decided on the row's OWN stored signer list — no extra ledger read — with the
     * same floor the inbox READS use (proven or registered: `sessionMayReadCouncil`).
     * A caller outside it still gets the refusal and the proposal id; what it does not
     * get is another family's free text.
     */
    const mayReadRow = async (row: { signerList?: unknown } | null): Promise<boolean> => {
      const sessionUserId = req.siwe?.userId ?? null;
      if (!sessionUserId || !row) return false;
      try {
        const { sessionMayReadCouncil } = await import('./councilProposals');
        return await sessionMayReadCouncil(sessionUserId, { signerList: row.signerList }, req.siwe?.walletAddress ?? null);
      } catch {
        return false;
      }
    };
    let live: Awaited<ReturnType<typeof findLiveProposal>> = null;
    let unresolved: Awaited<ReturnType<typeof findUnresolvedSeat>> = null;
    let seatGuardUnreadable: string | null = null;
    try {
      live = await findLiveProposal(parsed.data.account);
      unresolved = live ? null : await findUnresolvedSeat(parsed.data.account);
    } catch (e) {
      seatGuardUnreadable = safeErrorDetail(e);
    }
    const seatNotices: SeatNotice[] = [];
    if (unclassified) {
      seatNotices.push({
        kind: 'unclassified-exit',
        priority: SEAT_NOTICE_PRIORITY['unclassified-exit'],
        detail:
          'We could not read what this transaction was composed from, so we could NOT confirm it is an exit. We are ' +
          'treating it as one — a failed read of ours must never hold capital in — but nothing here verified it: ' +
          'open this account’s proposal inbox and check what is collecting signatures before you gather the quorum. ' +
          'Because we could not confirm it, this payload was NOT pinned to anybody else’s seat: it carries the next ' +
          'free Sequence.',
      });
    }
    if (seatGuardUnreadable !== null) {
      if (!exitForSeat) {
        return void res.status(503).json({
          error: 'SEAT_GUARD_UNREADABLE',
          retryable: true,
          detail:
            'We could not read this account’s proposal inbox, so we cannot tell you whether another payload already ' +
            'holds its Sequence — and composing a second one blindly is how a council pays twice. That is a failure ' +
            'of ours, not a verdict about you: nothing was prepared and nothing moved. Try again in a moment. ' +
            `(${seatGuardUnreadable})`,
        });
      }
      seatNotices.push({
        kind: 'inbox-unreadable',
        priority: SEAT_NOTICE_PRIORITY['inbox-unreadable'],
        detail:
          'We could not read this account’s proposal inbox, so we cannot tell you whether another payload is holding ' +
          'its Sequence. An exit is never held back for a failure of ours — but if a signature ceremony is open ' +
          'elsewhere on this account, only one of the two can reach the ledger. Nothing here says that one exists: ' +
          'check the account on an explorer, and check the inbox again in a moment.',
      });
    }
    if (live && !exitForSeat) {
      // The row's title is free text from an inbox. Served only to a
      // caller who sits on THAT council; everybody else reads the same refusal with
      // the transaction type instead of the name the family gave it.
      const named = (await mayReadRow(live)) ? (live.title ?? live.txType) : live.txType;
      return void res.status(422).json({
        error: 'LIVE_PROPOSAL_EXISTS',
        // g1-ceremonia — WHERE THIS SENTENCE SENT PEOPLE. It said
        // "withdraw it or let it expire", and both are the wrong door. Inside
        // its deadline `POST /:id/withdraw` reads no ledger and issues no
        // verdict (`withEffectiveStatus` returns early), so filing it there
        // writes "this never happened" over a payload that may be minutes away
        // from being broadcast — and "let it expire" is the seven-day wait that
        // then lands on the unresolved-seat guard below. This refusal was
        // making the least-checked exit the busiest one. The place where the
        // seat is actually settled is the proposal itself, in the inbox.
        detail:
          `A proposal on this account (${named}) is already collecting signatures in the inbox, ` +
          "and it holds the account's only Sequence. Signing another one here takes the same seat: only one of the two " +
          'can ever reach the ledger, and the one that loses keeps looking alive until its deadline — which is how a ' +
          'council ends up paying twice. Settle THAT proposal in the inbox: finish collecting its signatures and ' +
          'broadcast it (the ones already collected still count), or register the transaction hash if it has already ' +
          'gone out — any member can. Filing it as withdrawn only records that it never happened, and inside its ' +
          'deadline nothing checks the ledger for you, so do that only after looking the account up on an explorer.',
        proposalId: live.id,
      });
    }
    if (unresolved && !exitForSeat) {
      // 422, and the SAME body the other compose door hands back: one refusal
      // shape for one refusal. 409 is already taken on this route by
      // NOT_A_COUNCIL, and it is what `proposeError` collapses into "let it
      // expire" — which here is the exact instruction that pays twice.
      const namedPrior = (await mayReadRow(unresolved)) ? (unresolved.title ?? unresolved.txType) : unresolved.txType;
      return void res.status(422).json({
        error: 'PRIOR_SEAT_UNRESOLVED',
        detail:
          `A previous proposal on this account (${namedPrior}) is not settled: ` +
          `${unresolved.ledgerCheck.detail} ` +
          'Composing another one now is exactly how a council pays twice. Open it in the proposal inbox, ' +
          'check the account on an explorer, and either register the transaction hash it produced (any member can) ' +
          'or file it — then compose.',
        proposalId: unresolved.proposalId,
        ledgerCheck: unresolved.ledgerCheck,
      });
    }
    // ── THE EXIT TAKES THE SEAT, ON PURPOSE ──
    //
    // WHAT PROMISED AND DID NOT DO: the warning said «the exit takes the seat
    // and the entry is the one that dies» while the coordinator pinned whatever
    // `account_info` answered. That is the rival's number only by luck of timing, and
    // XRPL decides the race by WHOEVER BROADCASTS FIRST — nothing in a prepare can
    // make an exit win it. So two things change, and neither of them is a promise:
    //   · the exit is pinned to the contested Sequence DELIBERATELY (`pinSequence`),
    //     so the two payloads are the same seat by construction instead of by luck —
    //     and never to a seat the ledger has already moved past, which would compose
    //     an exit that is tefPAST_SEQ from birth;
    //   · the warning says what happens to BOTH transactions, and says out loud that
    //     pinning the same number is all XRPL allows.
    const contestedSeat =
      live !== null
        ? { proposalId: live.id, txType: live.txType, pinnedSequence: live.pinnedSequence ?? null }
        : unresolved !== null
          ? { proposalId: unresolved.proposalId, txType: unresolved.txType, pinnedSequence: unresolved.pinnedSequence }
          : null;
    const result = await prepareCouncilMultisig(xrplProvider, {
      account: parsed.data.account,
      xrplTx: parsed.data.xrplTx as Record<string, unknown>,
      // Only an exit ever asks for a seat somebody else is holding; an entry that
      // reaches this line has no rival (the guards above refused it).
      // ONLY a classified exit may ask for a seat somebody else is
      // holding. An entry that reaches this line has no rival (the guards above
      // refused it); a payload we could not CLASSIFY reaches it too, and it takes
      // the next free Sequence instead of arranging the collision itself.
      ...(mayPinContestedSeat && contestedSeat?.pinnedSequence ? { pinSequence: contestedSeat.pinnedSequence } : {}),
    });
    const pin = result.sequence ?? null;
    /**
     * The sentence for a REAL rival. When the payload was not
     * allowed to pin (an unclassified one), `seatContestPhysics` would otherwise open
     * with «we could not pin this exit to that payload's seat», which reads as a
     * failure of ours — it was a decision. Said as the decision it is.
     */
    /**
     * ── LA FÍSICA SE IMPRIMÍA CONTRA SÍ MISMA ───────────
     *
     * QUÉ SE VEÍA. Esta frase leía el asiento del rival del `contestedSeat` de fuera
     * y, sobre todo, imprimía LOS DOS NÚMEROS sin mirarlos: como las dos mitades
     * salen del MISMO `account_info`, lo normal es que el asiento libre que el
     * ledger acaba de darnos SEA el número que esa fila retiene. El resultado era
     * «This payload was NOT pinned to that seat (it carries Sequence 11, that one
     * holds 11)»: la afirmación y su negación en la misma línea, al lado de un QR.
     */
    const contestPhysics = (theirs: number | null): string => {
      if (mayPinContestedSeat) return seatContestPhysics(pin, theirs);
      const ours = pin?.pinned ?? null;
      const mine = ours !== null ? `Sequence ${ours}` : 'a freshly read Sequence';
      const decision =
        'we could not confirm it is an exit, and we do not take somebody else’s seat on a read we could not make. ';
      if (ours !== null && theirs !== null && ours === theirs) {
        return (
          `This payload was NOT pinned to that seat: ${decision}It made no difference — the next free Sequence the ` +
          `ledger just gave us IS the number that row is holding (${ours}), so the two carry the same seat anyway. ` +
          'XRPL burns a Sequence exactly once, so only ONE of them can ever apply — whichever reaches the ledger ' +
          'first — and the other fails with tefPAST_SEQ and costs only its fee. Look the account up on an explorer ' +
          'BEFORE you gather the quorum, and do not settle that row on the strength of this notice.'
        );
      }
      if (ours !== null && theirs !== null) {
        return (
          `This payload was NOT pinned to that seat: it carries ${mine} and that row holds ${theirs}, so these are two ` +
          `different seats and this one applies on its own. ${decision}What happens to that row is not decided here: a ` +
          'Sequence the ledger has already moved past can no longer apply, and nothing here checked whether it has. ' +
          'Look the account up on an explorer before you gather the quorum.'
        );
      }
      return (
        `This payload was NOT pinned to that seat (it carries ${mine}, and that row’s own Sequence we could not ` +
        `read): ${decision}XRPL burns a Sequence exactly once, so if the two do end up carrying the same number only ` +
        'one of them can apply — whichever reaches the ledger first — and the other fails with tefPAST_SEQ and costs ' +
        'only its fee. Check the account on an explorer before you gather the quorum.'
      );
    };
    /**
     * WAS THIS TRANSACTION ACTUALLY PINNED TO THE CONTESTED SEAT?
     *
     * The coordinator answers it and only it: `source === 'contested-seat'` is set
     * exactly when the requested Sequence WAS the ledger's next unused one, i.e. when
     * these bytes now hold the same seat as that row. Everything else — a payload we
     * were not allowed to pin, a requested seat the ledger has already moved past, a
     * seat ahead of the ledger — is NOT a contest, and must not be announced as one.
     */
    const pinnedToContestedSeat = pin !== null && pin.source === 'contested-seat';
    const seatAlreadySpent = pin !== null && pin.requestedSeatConsumed === true;
    /**
     * One notice per rival ROW, and its KIND says what happened to the
     * seat — never a headline that sends a family to settle a payment that may
     * already have landed.
     */
    /**
     * EL AVISO SE CONTRADECÍA A SÍ MISMO EN SU PRIMERA FRASE.
     *
     * QUÉ SE VEÍA EN PANTALLA: el titular del cliente decía «That Sequence has
     * already been used» y el cuerpo —la prosa del servidor, que es la que se pinta—
     * empezaba con «…is collecting signatures in the inbox and is holding the
     * account’s only Sequence». Las dos cosas no pueden ser verdad: si el asiento ya
     * se gastó, esa fila NO lo retiene. La familia leía un aviso que se desmiente en
     * dos renglones, al lado de un QR.
     */
    /**
     * Y LA SOLO ARREGLÓ UNA DE LAS DOS RAMAS.
     *
     * El `lead` se partió en `{ holdsSeat, neutral }` y el neutro se usó SOLO en
     * `seat-already-spent`. `seat-not-pinned` siguió cogiendo `holdsSeat` — «…is
     * collecting signatures in the inbox and is holding the account’s only
     * Sequence» — y detrás le pegaba una física que dice lo contrario o que admite
     * que no pudo mirarlo: o bien «this payload was NOT pinned to that seat… we
     * could not confirm it is an exit», o bien «…that one we could not read».
     */
    const pushSeatNotice = (
      row: { proposalId: string; txType: string; theirSequence: number | null },
      leads: { holdsSeat: string; neutral: string; neutralUnconfirmed: string },
    ): void => {
      const theirs = row.theirSequence ?? null;
      const ours = pin?.pinned ?? null;
      const lead = leads.holdsSeat;
      if (pinnedToContestedSeat) {
        seatNotices.push({
          kind: 'rival-seat',
          priority: SEAT_NOTICE_PRIORITY['rival-seat'],
          proposalId: row.proposalId,
          txType: row.txType,
          ...(pin ? { pinnedSequence: pin.pinned } : {}),
          detail: `${lead} ${seatContestPhysics(pin, theirs)}`,
        });
        return;
      }
      if (seatAlreadySpent) {
        seatNotices.push({
          kind: 'seat-already-spent',
          priority: SEAT_NOTICE_PRIORITY['seat-already-spent'],
          proposalId: row.proposalId,
          txType: row.txType,
          ...(theirs !== null ? { theirSequence: theirs } : {}),
          ...(ours !== null ? { ourSequence: ours } : {}),
          detail:
            // La frase NEUTRA — nunca la que dice que esa fila «retiene la
            // única Sequence», porque el titular de este mismo aviso dice lo contrario.
            `${leads.neutral} That seat has already been spent on the ledger, so there is nothing left to contest: this one ` +
            `carries the next free Sequence${ours !== null ? ` (${ours})` : ''} and applies on its own. DO NOT ` +
            'assume the other payment failed — something consumed that Sequence, and it may well have been that very ' +
            'payload landing. Look the account up on an explorer and see what went through BEFORE you settle that ' +
            'row or compose anything else: settling a payment that already landed is how a council pays twice.',
        });
        return;
      }
      seatNotices.push({
        kind: 'seat-not-pinned',
        priority: SEAT_NOTICE_PRIORITY['seat-not-pinned'],
        proposalId: row.proposalId,
        txType: row.txType,
        ...(theirs !== null ? { theirSequence: theirs } : {}),
        ...(ours !== null ? { ourSequence: ours } : {}),
        // JAMÁS `leads.holdsSeat` aquí — lo contrario de lo que dice la
        // física de debajo. Y si no pudimos clasificar el payload, tampoco «the exit».
        detail: `${mayPinContestedSeat ? leads.neutral : leads.neutralUnconfirmed} ${contestPhysics(theirs)}`,
      });
    };
    if (live !== null && exitForSeat) {
      pushSeatNotice(
        { proposalId: live.id, txType: live.txType, theirSequence: live.pinnedSequence ?? null },
        {
          holdsSeat:
            `A proposal on this account (${live.txType}, id ${live.id}) is collecting signatures in the inbox and is ` +
            'holding the account’s only Sequence. We are composing the exit anyway — capital coming back out is never ' +
            'held behind somebody else’s payload.',
          neutral:
            `A proposal on this account (${live.txType}, id ${live.id}) is collecting signatures in the inbox. We are ` +
            'composing the exit anyway — capital coming back out is never held behind somebody else’s payload.',
          // Sin clasificar, esto no puede llamarse «the exit» — la física
          // que va justo detrás dice que no conseguimos confirmarlo.
          neutralUnconfirmed:
            `A proposal on this account (${live.txType}, id ${live.id}) is collecting signatures in the inbox. We are ` +
            'composing this transaction anyway: we could not confirm whether it takes capital OUT, and a failed read ' +
            'of ours must never hold capital in.',
        },
      );
    }
    if (unresolved !== null && exitForSeat) {
      // Esta fila NUNCA afirma retener el asiento: es su propio `ledgerCheck`
      // —«consumed» o «unverified»— el que dice qué pasó con él, y eso no se
      // contradice con «ese asiento ya se gastó». Las dos entradas son, a propósito,
      // la MISMA frase: no hay nada que quitarle.
      const priorLead =
        `A previous proposal on this account (${unresolved.txType}, id ${unresolved.proposalId}) is not settled: ` +
        `${unresolved.ledgerCheck.detail} We are composing this exit anyway — a seat nobody has settled must not ` +
        'trap capital.';
      pushSeatNotice(
        { proposalId: unresolved.proposalId, txType: unresolved.txType, theirSequence: unresolved.pinnedSequence ?? null },
        {
          holdsSeat: priorLead,
          neutral: priorLead,
          // Igual que arriba — lo único que cambia es que aquí tampoco
          // podemos llamarlo «this exit».
          neutralUnconfirmed:
            `A previous proposal on this account (${unresolved.txType}, id ${unresolved.proposalId}) is not settled: ` +
            `${unresolved.ledgerCheck.detail} We are composing this transaction anyway: we could not confirm whether ` +
            'it takes capital OUT, and a seat nobody has settled must not trap capital.',
        },
      );
    }
    // SORTED before anything reads them, so the screen never has to
    // choose between two sentences that contradict each other — the first one is the
    // real state of the seat and the rest are the detail beneath it. Ordered by the
    // exported pure helper, so a test and the route cannot disagree about the order.
    seatNotices.splice(0, seatNotices.length, ...sortSeatNotices(seatNotices));
    /**
     * Kept, and kept POPULATED, for the clients that only know this
     * field — never deleted. It is the same prose, joined; every new screen reads
     * `seatNotices` instead, where a warning that has no rival can no longer be
     * painted as one.
     */
    const seatContestWarning = seatNotices.length > 0 ? seatNotices.map((n) => n.detail).join(' ') : null;
    // ── g1-ceremonia — THE TRACE THIS DOOR NEVER LEFT ───────────────────────
    //
    // `prepareCouncilMultisig` reads the ledger and returns bytes; it writes
    // nothing, by design. From here the whole ceremony lives in one browser
    // tab, so the two ASYNC compose doors (`POST /api/council/proposals` and
    // `createCouncilProposalFromRule`) had no way to know this council's
    // Sequence was already spoken for — and the family's own repair for a
    // stalled QR is to press the button next to it. Same chain as the
    // live-proposal guard above, tempos inverted.
    const userId = req.siwe?.userId ?? null;
    const pinnedSequence = Number((result.multisigTx as { Sequence?: unknown }).Sequence);
    // ── Y LA MARCA SOBRE LOS BYTES, NO SOLO SOBRE LA CUENTA ─────
    //
    // El arriendo de abajo dice «este consejo está reunido»; esto dice «ESTOS
    // bytes los piné yo». Son cosas distintas y la puerta de liberación necesita
    // la segunda: `releaseAbandonedCeremonySeat` suelta el asiento de nonce de un
    // 0xFE antes de que caduque su payload, y eso solo es seguro sobre bytes con
    // la `Sequence` fijada (dos Payments con el mismo número no pueden entrar los
    // dos). Un 0xFE de ceremonia firmado por el camino normal de Xaman —Sequence
    // autorrellenada— no tiene esa protección, así que sin esta marca no se
    // suelta: su asiento se libera solo, por su ventana.
    const pinnedMemo = zeroFeMemoOf(parsed.data.xrplTx);
    // ── EL NOMBRE DEL SITTING, GENERADO AQUÍ Y SOLO AQUÍ ────────
    //
    // WHAT FAILED IN SILENCE. Dos sittings de la MISMA sesión sobre los MISMOS
    // bytes eran, para el servidor, el mismo sitting: el arriendo se upsertaba
    // por cuenta y el pin se re-estampaba con la misma Sequence, así que la
    // liberación TARDÍA del primero (Escape en `signing` → limpieza de desmontaje
    // con `keepalive`; o el prepare #1 aterrizando en un sitting muerto tras
    // «Back» + «Sign now») aterrizaba después del segundo prepare, encontraba
    // «su» arriendo y «su» pin, y soltaba el asiento de nonce bajo la ceremonia
    // viva. La familia seguía firmando sobre un nonce que el servidor daba por
    // libre.
    const sittingId = randomUUID();
    if (pinnedMemo && Number.isInteger(pinnedSequence) && pinnedSequence > 0) {
      // El `catch` es la mitad que hace best-effort a esto de verdad: sin él, un
      // store caído salía por el `catch` de abajo como `PREPARE_FAILED` y tiraba
      // una ceremonia legítima por una fila de registro.
      await import('../services/flare/DirectMintHandoffStore')
        .then(({ stampCeremonyPin }) => stampCeremonyPin(pinnedMemo, parsed.data.account, pinnedSequence, { sittingId }))
        .catch((e) => {
          console.warn('[council] ceremony pin NOT stamped:', (e as Error)?.message ?? e);
        });
    }
    const holdsASeat =
      userId !== null &&
      (await sessionIsCouncilMember(userId, { signerList: result.council.signers }, req.siwe?.walletAddress ?? null));
    if (holdsASeat) {
      await recordCeremonySeat({
        account: parsed.data.account,
        pinnedSequence,
        txType: String((parsed.data.xrplTx as { TransactionType?: unknown }).TransactionType ?? 'Unknown'),
        userId,
        sittingId,
      });
    } else {
      // Said out loud rather than skipped quietly: the other compose doors stay
      // as blind to this sitting as they were before the lease existed.
      console.warn(
        '[council] ceremony seat NOT recorded: session holds no registered seat in',
        parsed.data.account,
      );
    }
    return void res.json({
      ...result,
      // The name of THIS sitting. The browser sends it back with every
      // release of this sitting (unmount cleanup, «Cancel», the late prepare);
      // a release naming another sitting is a no-op server-side.
      sittingId,
      ...(seatContestWarning ? { seatContestWarning } : {}),
      /**
       * THE FIELD THE SCREEN READS. A typed list the UI can tell
       * apart: `rival-seat` (a real row is holding the Sequence — settle it),
       * `unclassified-exit` (we could not confirm this is an exit, and it was NOT
       * pinned to anybody's seat) and `inbox-unreadable` (we could not look). No
       * kind but `rival-seat` may be rendered as a contest, because for the other
       * two there is no rival to settle.
       */
      ...(seatNotices.length > 0 ? { seatNotices } : {}),
      // The structured half the screen renders next to the
      // sentence: the id to settle, WHAT kind of transaction is holding the seat and
      // the Sequence this payload was pinned to. Never the other row's title, never
      // any free text of its inbox.
      // emitted only when a REAL rival row exists AND this payload was
      // allowed to take its seat — an unclassified payload no longer reports a seat
      // it deliberately did not take.
      // and only when the coordinator ACTUALLY pinned these bytes to it.
      // «Allowed to ask» is not «got it»: with the seat already spent, or the request
      // refused, this object was still describing a shared Sequence the server had
      // just declined to take. The typed notice carries the other cases.
      ...(contestedSeat && exitForSeat && pinnedToContestedSeat
        ? {
            seatContest: {
              proposalId: contestedSeat.proposalId,
              txType: contestedSeat.txType,
              pinnedSequence: pin?.pinned ?? contestedSeat.pinnedSequence,
            },
          }
        : {}),
      ...(unclassified ? { exitClassification: 'unreadable' } : {}),
    });
  } catch (e) {
    if (e instanceof NotACouncilError) {
      return void res.status(409).json({ error: 'NOT_A_COUNCIL', detail: e.message });
    }
    return void res.status(400).json({ error: 'PREPARE_FAILED', detail: safeErrorDetail(e) });
  }
});

/**
 * EL MEMO DEL 0xFE QUE LLEVA UN Payment, LEÍDO TAL CUAL.
 *
 * `singleMemoHex` (councilExitToken) exige EXACTAMENTE 64 hex porque una ORDEN de
 * consejo es un keccak de 32 bytes. El memo de un 0xFE no tiene esa forma: es la
 * instrucción del Smart Account entera (`UserOpCustomInstruction.encode()` —
 * prefijo, walletId, comisión del executor y los 32 bytes del userOpHash), así
 * que es más larga. Usar aquella lectura para nombrar un asiento de nonce daría
 * `null` SIEMPRE, que es la misma clase de fallo que este ciclo persigue: una
 * puerta que no puede llamarse.
 *
 * Pura y sin red: nombra el asiento, no decide nada sobre él. El rango es el
 * mismo que acepta el esquema de `/multisign/release`.
 */
export function zeroFeMemoOf(tx: unknown): string | null {
  // The reader lives with the seat now (`zeroFeMemoOfTx`,
  // DirectMintHandoffStore) because the async coordinator — `POST
  // /council-proposals` — needs the same one and a router must not import a
  // router. Kept here by name: this is where the house has looked it up.
  return zeroFeMemoOfTx(tx);
}

/**
 * SOLTAR EL ASIENTO DE NONCE DE UNA CEREMONIA QUE SE TERMINA.
 *
 * QUÉ ABRE ESTO. Desde la §2.1 el 0xFE de una cuenta que firma por quórum se
 * compone con la vida REAL de sus payloads (24 h), porque la `LastLedgerSequence`
 * va dentro de los bytes firmados y no hay forma de alargarla después. El precio
 * honesto es que su asiento de nonce queda ocupado mientras esos bytes puedan
 * entrar. Sin una puerta, la segunda salida del mismo consejo chocaría con un 409
 * durante un día — y eso es tapiar una salida con código nuestro.
 */
async function endedCeremonySeat(
  req: Request,
  account: string,
  memoHex: string | undefined,
  opts: {
    heldTheLease: boolean;
    /**
     * El id del sitting que pide, tal cual llegó en el cuerpo
     * (`undefined` = cliente anterior; `null` = sitting sin id). El pin lleva el
     * suyo y la puerta compara: otro id, no-op. Se pasa TAMBIÉN cuando
     * `heldTheLease` es true — el arriendo prueba «soy el último de la sesión»,
     * pero el pin puede ser de una PROPUESTA posterior (el tempo asíncrono no
     * arrienda), y ese asiento no es de esta ceremonia.
     */
    sittingId?: string | null;
  },
): Promise<{ seat?: Record<string, unknown> }> {
  const memo = (memoHex ?? '').trim();
  if (!memo) return {}; // nadie pidió soltar ningún asiento
  try {
    let mayEnd = opts.heldTheLease === true;
    if (!mayEnd) {
      const { sessionAuthorityOnXrplAccount } = await import('../services/flare/handoffAuthority');
      // `'exit'`: terminar una ceremonia propia no es abrir exposición, y una
      // tienda de pruebas caída no puede convertirse en un «no» definitivo.
      mayEnd = (await sessionAuthorityOnXrplAccount(req, account, 'exit')).mayAct === true;
    }
    if (!mayEnd) {
      return {
        seat: {
          released: false,
          code: 'NOT_THE_CEREMONY_HOLDER',
          detail:
            'Only the session that opened that sitting — or one that proves this account — can hand its 0xFE nonce ' +
            'seat back. Nothing changed: that dispatch is still signable, and its seat frees itself when it stops being.',
        },
      };
    }
    const { releaseAbandonedCeremonySeat, seatReleaseAnswer } = await import('../services/flare/DirectMintHandoffStore');
    // The third argument only when the client named a sitting (or
    // said it has none) — an older client's call is exactly the call it was.
    const outcome =
      opts.sittingId === undefined
        ? await releaseAbandonedCeremonySeat(memo, account)
        : await releaseAbandonedCeremonySeat(memo, account, { sittingId: opts.sittingId });
    // ONE GRAMMAR FOR THE SEAT, shared with the async door
    // (`POST /council-proposals/:id/withdraw`). The sentence for
    // `not-pinned-by-us` asserted, in the indicative, a fact this route never
    // checked («was not pinned by this app's coordinator») — a failed write of
    // the mark reads the same from the row. The shaper says only what is known,
    // tells `pin-unwritten` apart, and carries the ordinary rule's real
    // countdown instead of a bare wall.
    return { seat: seatReleaseAnswer(outcome) };
  } catch (e) {
    // «No pude leer» no es «lo solté» ni «no había nada»: se dice, y ya.
    console.error('[xrpl-defi] ceremony seat NOT released:', (e as Error)?.message ?? e);
    return { seat: { released: false, code: 'SEAT_STATE_UNREADABLE', retryable: true } };
  }
}

// ── arriendo-ceremonia — PUTTING THE SEAT DOWN ────────────────────
//
// The other half of `/multisign/prepare`, and the half round 4 shipped without.
// «Cancel this ceremony» killed the Xaman payloads and told the family the seat
// was handed back; server-side nothing happened, so the async door beside it
// answered 422 CEREMONY_IN_FLIGHT — "Finish or abandon that sitting" — to a
// family that had just abandoned it, with no way to obey for up to 30 minutes.
/**
 * …Y EL ASIENTO DE NONCE DEL 0xFE QUE ESA CEREMONIA IBA A FIRMAR.
 *
 * `memoHex` es OPCIONAL y es el memo del 0xFE que el consejo estaba a punto de
 * firmar. Desde la §2.1 ese dispatch se compone con la vida real de sus payloads
 * (24 h), así que sin esta mitad la SEGUNDA salida del mismo consejo chocaría con
 * un 409 durante un día entero — tapiar una salida con código nuestro. Aquí solo
 * llega el nombre del asiento: quién puede soltarlo y cuándo lo decide el
 * servidor (`releaseAbandonedCeremonySeat`, que exige que la fila sea de una
 * ceremonia, de ESTA misma cuenta, y que la ventana del memo se lea entera y diga
 * que aquel Payment nunca entró). Un memo ajeno no abre el asiento de nadie.
 */
/**
 * …Y EL NOMBRE DEL SITTING QUE PIDE. `sittingId` es el que devolvió
 * `/multisign/prepare` a ESTE sitting. Tres formas, tres significados:
 *   · ausente — un cliente anterior a este campo: la regla de siempre (no se rompe
 *     la compatibilidad de golpe; un navegador sin recargar conserva su puerta);
 *   · una cadena — tiene que ser la del arriendo y la del pin vigentes; otra es
 *     un no-op (`stale-sitting`, `seat.released:false`, la fila no se toca);
 *   · `null` — un cliente que conoce el campo pero cuyo sitting no recibió id
 *     (cerró en `idle`, o en `preparing` antes de que volviera el prepare): no
 *     pinó ni arrendó nada, así que solo alcanza filas y arriendos SIN nombre.
 * El id no prueba nada por sí solo: la propiedad del arriendo y la prueba de la
 * cuenta siguen delante, como antes. Solo AFINA dentro de lo propio.
 */
const multisignReleaseSchema = z.object({
  account: xrplAddress,
  memoHex: z.string().regex(/^[0-9A-Fa-f]{8,2048}$/).optional(),
  sittingId: z.string().min(1).max(128).nullable().optional(),
});
router.post('/multisign/release', requireLegacyAccess, async (req: Request, res: Response) => {
  const userId = req.siwe?.userId;
  if (!userId) return void res.status(401).json({ error: 'missing_siwe_session' });
  const parsed = multisignReleaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  const { releaseCeremonySeatFor } = await import('./councilProposals');
  const sittingId = parsed.data.sittingId;
  const outcome = await releaseCeremonySeatFor(parsed.data.account, userId, { sittingId });
  switch (outcome.reason) {
    case 'released':
      return void res.json({
        released: true,
        ...(await endedCeremonySeat(req, parsed.data.account, parsed.data.memoHex, { heldTheLease: true, sittingId })),
      });
    case 'stale-sitting': {
      // The lease belongs to a NEWER sitting of this same session.
      // Nothing is touched — not the lease, not the pin, not the row: the pin is
      // not even asked, because this sitting has ended and the seat is that
      // other sitting's story now. An answer, not a refusal (200).
      const { seatReleaseAnswer } = await import('../services/flare/DirectMintHandoffStore');
      const memo = (parsed.data.memoHex ?? '').trim();
      return void res.json({
        released: false,
        reason: 'stale-sitting',
        ...(memo ? { seat: seatReleaseAnswer({ released: false, reason: 'stale-sitting' }) } : {}),
      });
    }
    case 'no-seat':
      // Nothing was holding it. The compose doors are clear either way, so this
      // is an answer, not a refusal — a ceremony that ends without ever having
      // leased (a seat this session does not hold in the registry, a lease that
      // already expired) is ordinary, and the family must not be alarmed by it.
      // la sesión no tenía (o ya perdió) el arriendo de la Sequence,
      // pero su 0xFE puede seguir ocupando el asiento de nonce. Se intenta igual:
      // la puerta de abajo NO se fía de este camino — pide que la sesión PRUEBE la
      // cuenta antes de soltar nada. Terminar una ceremonia no es una salida que
      // se gatee: es devolver algo propio.
      return void res.json({
        released: false,
        reason: 'no-seat',
        ...(await endedCeremonySeat(req, parsed.data.account, parsed.data.memoHex, { heldTheLease: false, sittingId })),
      });
    case 'not-the-lessee':
      return void res.status(403).json({
        error: 'NOT_THE_LESSEE',
        detail:
          'The sitting holding this account’s Sequence was opened by someone else, so ending yours does not end ' +
          'theirs: their council members may still have signable requests on their phones over those exact bytes. ' +
          'That seat is released when their transaction reaches the ledger, or within 30 minutes of being pinned.',
      });
    default:
      return void res.status(503).json({
        error: 'SEAT_NOT_RELEASED',
        detail:
          'We could not reach the record of this sitting, so we cannot tell you the seat was handed back — that is ' +
          'a failure of ours, not a verdict. It is released as soon as the transaction reaches the ledger, and in ' +
          'any case within 30 minutes of being pinned.',
        reason: outcome.detail,
      });
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
/**
 * THE EXIT IS NEVER GATED (doctrine «LA SALIDA JAMÁS SE GATEA») — per ACTION on
 * the council-order door.
 */
const COUNCIL_ORDER_EXIT_ACTIONS: ReadonlySet<string> = SHARED_COUNCIL_ORDER_EXIT_ACTIONS; // one set: services/councilExitToken.ts

// NOTE on Sequence: this door composes WITHOUT pinning a Sequence on purpose. A
// Legacy council order is ALWAYS signed through `CouncilSigningDoors` →
// `/multisign/prepare`, whose coordinator pins the Sequence itself (and whose
// ceremony lease / one-live-proposal rule guard the seat). Stamping a short
// LastLedgerSequence here would kill a multi-day async ceremony.
router.post('/council-order/prepare', requireLegacyAccess, async (req: Request, res: Response) => {
  const requestedAction = String((req.body as { action?: unknown } | undefined)?.action ?? '').trim();
  const gate = COUNCIL_ORDER_EXIT_ACTIONS.has(requestedAction) ? gateXrplDefiExit() : gateXrplDefi(regionOf(req));
  if (gate) return void res.status(gate.status).json({ error: gate.error });
  const parsed = councilOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  // THE SAME ORDER, AGAIN, WITHIN 30 MINUTES.
  // By CONTENT (this council, this action, these params), in any relay state: a
  // non-exit is refused 409 unless the caller confirms it wants a second one; an
  // exit always goes out, with a warning. Unreadable store → no verdict, never a
  // refusal by itself.
  const isExitOrderAction = COUNCIL_ORDER_EXIT_ACTIONS.has(parsed.data.action);
  const { councilOrderContentKey, sessionProvesCouncil } = await import('../services/flare/ComposedCouncilOrderStore');
  const { councilDuplicateOrderVerdict, recentSameCouncilOrder } = await import('../services/flare/CouncilOrderRelayLauncher');
  const contentKey = councilOrderContentKey({
    council: parsed.data.account,
    action: parsed.data.action,
    params: parsed.data.params,
  });
  // WHICH QUEUE this composition counts against (finding 2.1): a session that holds
  // a seat in this council's SignerList (or proved the account) has the council's
  // own queue; anyone else has their own small one and blocks nobody.
  const preparedByProven = await sessionProvesCouncil(req, parsed.data.account);
  // THE CAP BEFORE THE READS. The authoritative 429 is raised
  // at record time, after the cage resolution, the pre-flight and the Sequence pin
  // have all been spent; a caller whose queue is already full could therefore drive
  // those reads without ever taking a place. This is the same count with one
  // database read and no ledger read (a lower bound — it never refuses a
  // composition the real cap would allow), and an exit is never asked.
  //
  // It runs BEFORE the duplicate guard now, in all three doors.
  // The duplicate guard spends LEDGER reads (`ledgerDuplicateCheck`, up to three
  // memos), so asking it first let a caller whose queue is already full pull chain
  // reads on every attempt — the very amplification the pre-check exists to stop.
  {
    const { councilQueuePrecheck, TooManyPendingOrdersError } = await import('../services/flare/ComposedCouncilOrderStore');
    const pre = await councilQueuePrecheck({
      council: parsed.data.account,
      proven: preparedByProven,
      preparedByUserId: req.siwe?.userId ?? null,
      exit: isExitOrderAction,
    });
    if (pre?.full) {
      const e = new TooManyPendingOrdersError(parsed.data.account, pre.live, { bucket: pre.bucket, limit: pre.limit });
      return void res.status(429).json({ error: e.code, detail: e.message });
    }
  }
  const duplicate = await councilDuplicateOrderVerdict({
    council: parsed.data.account,
    contentKey,
    isExit: isExitOrderAction,
    action: parsed.data.action,
    confirmAnotherOrder: (req.body as { confirmAnotherOrder?: unknown } | undefined)?.confirmAnotherOrder === true,
    find: recentSameCouncilOrder,
    // The sweep runs every 5 min, so before concluding «no duplicate»
    // the ledger is asked about what it has not marked — on the fate read's own
    // cache and per-session budget.
    sessionKey: req.siwe?.userId ?? req.ip ?? 'anonymous',
  });
  if (duplicate.proceed === false) return void res.status(duplicate.status).json(duplicate.body);
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
    // Courtesy pre-flight (#11 — simulate before signature). An order the cage
    // already refuses — a venue that does not exist, more than what sits idle,
    // more than a venue holds, a rescue into a retired or still-maturing venue,
    // a bps outside the vault's own bounds — reverts on Flare AFTER the quorum
    // has signed and the FDC round has been paid for (~20 FLR). Read the cage
    // first and refuse to compose an order we already know cannot land.
    // Best-effort by design: if the vault cannot be read we compose anyway and
    // let the contract decide — "we could not check it" is not "it would
    // revert", and this guard must never become a second authority over the
    // cage nor block a legitimate order over a dead RPC.
    // The SAME read serves two purposes: the pre-flight and the units the
    // summary speaks in. A quorum was being asked to sign "Direct 100000 base
    // units of principal into venue #0" — the contract's integers, in the one
    // line a person actually reads.
    const { councilOrderPreflight } = await import('../services/CouncilProposalService');
    const preflight = await councilOrderPreflight(cage, parsed.data.action, parsed.data.params);
    if (preflight.blocked) {
      return void res
        .status(400)
        .json({ error: 'ORDER_WOULD_REVERT', code: preflight.blocked.code, detail: preflight.blocked.reason });
    }
    const summaryCtx = preflight.summaryCtx;
    const { buildCouncilOrderHandoff } = await import('../connectors/protocols/xrpl/XrplCouncilOrderService');
    const { saveCouncilOrderRecord } = await import('../services/flare/LegacyOrderStore');
    const handoff = await buildCouncilOrderHandoff({
      council: parsed.data.account,
      action: parsed.data.action,
      params: parsed.data.params,
      cage,
      ...(summaryCtx ? { summaryCtx } : {}),
    });
    // THE LEGACY ORDER IS REMEMBERED TOO. This door did
    // not record what it composed, so a reload between broadcast and `onSettled`
    // left a quorum-signed order with no relay. Same rule as the institutional
    // doors (ComposedCouncilOrderStore.recordComposedOrderForDelivery): an exit
    // proceeds with `recoveryWarning` when it cannot be remembered; anything else
    // is refused (503, or 429 when the council's queue is full). The scan starts at
    // the validated ledger read now; no Sequence/window is stamped here (the
    // multisig coordinator pins its own), so the record carries no window.
    const isExitOrder = isExitOrderAction;
    const { recordComposedOrderForDelivery, recordComposedCouncilOrder } = await import('../services/flare/ComposedCouncilOrderStore');
    let delivery: Awaited<ReturnType<typeof recordComposedOrderForDelivery>>;
    let legacyPin: { sequence: number; lastLedgerSequence: null; validatedLedgerIndex: number } | null = null;
    let pinError: string | null = null;
    if (process.env.DATABASE_URL) {
      try {
        const { readOrderSequencePin } = await import('../connectors/protocols/xrpl/XrplOrderSequencePin');
        const p = await readOrderSequencePin(parsed.data.account);
        legacyPin = { sequence: p.sequence, lastLedgerSequence: null, validatedLedgerIndex: p.validatedLedgerIndex };
      } catch (e) {
        pinError = safeErrorDetail(e);
      }
    }
    if (pinError !== null) {
      const executorEnabled = process.env.FLARE_EXECUTOR_ENABLED === 'true';
      delivery = isExitOrder
        ? {
            proceed: true,
            warning:
              'ORDER_RECOVERY_UNRECORDED: the server could not remember this order, so it cannot deliver it on its own — keep this screen open until the order reaches Flare, or relay it by hash if it closes',
            serverDelivery: { recorded: false, executorEnabled },
          }
        : {
            proceed: false,
            status: 503,
            body: {
              error: 'ORDER_RECOVERY_UNRECORDED',
              detail: `The ledger could not be read to remember this order for automatic delivery (${pinError}). Nothing was prepared; try again.`,
            },
          };
    } else {
      delivery = await recordComposedOrderForDelivery(
        {
          route: 'legacy-council-order',
          action: parsed.data.action,
          council: parsed.data.account,
          pinnedTx: handoff.xrplTx as Record<string, unknown>,
          order: handoff.order,
          // Without a database the store answers 'no-database' before reading the pin.
          pin: legacyPin ?? { sequence: 1, lastLedgerSequence: null, validatedLedgerIndex: 1 },
          preparedByUserId: req.siwe?.userId ?? null,
          preparedByProven,
          contentKey,
        },
        { exit: isExitOrder, record: recordComposedCouncilOrder },
      );
    }
    if ('status' in delivery) return void res.status(delivery.status).json(delivery.body);
    const deliveryFields = {
      serverDelivery: delivery.serverDelivery,
      ...(delivery.warning ? { recoveryWarning: delivery.warning } : {}),
      ...(duplicate.duplicateWarning ? { duplicateWarning: duplicate.duplicateWarning } : {}),
    };
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
    // THE EXIT CLASSIFICATION TRAVELS WITH THE TX. The council
    // signs this through `/multisign/prepare`, which cannot tell a recall from an
    // entry by the bytes; the token (a server MAC over this account + this exact
    // tx + the action, 15 min) lets it take the flag-only gate for THIS tx only.
    // A token that cannot be issued (e.g. no JWT secret) is not a failed compose:
    // the order still goes out, and the ceremony keeps the full gate.
    if (COUNCIL_ORDER_EXIT_ACTIONS.has(parsed.data.action)) {
      try {
        const { issueCouncilExitToken } = await import('../services/councilExitToken');
        return void res.json({
          ...handoff,
          ...deliveryFields,
          ...issueCouncilExitToken({
            account: parsed.data.account,
            xrplTx: handoff.xrplTx as Record<string, unknown>,
            action: parsed.data.action,
          }),
        });
      } catch (e) {
        console.error('[council-order] exit token NOT issued:', (e as Error).message);
      }
    }
    return void res.json({ ...handoff, ...deliveryFields });
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
// THE EXIT IS NEVER GATED (doctrine «LA SALIDA JAMÁS SE GATEA»).
//
// The relay composes nothing and decides nothing: it carries an order the council
// ALREADY signed and the XRPL ALREADY validated across the FDC to the bridge, which
// executes only the committed bytes. The decision was taken — and gated — at
// compose time. A 451 here did not stop exposure from opening; it left a SIGNED
// order undelivered, silently: the relay was never registered as pending, so the
// watcher never recovered it. When that order is a recall or an evacuation, that is
// capital held in a venue against its own council's signature. So: flag-only
// (XRPL_DEFI_ENABLED → 503 stays, the module kill-switch), never the geofence.
router.post('/council-order/relay', requireLegacyAccess, async (req: Request, res: Response) => {
  const gate = gateXrplDefiExit();
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
  // only correct for the founding council (per-Legacy cages).
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
// GET /credentials?account=r… — las credenciales XLS-70 que sostiene una
// cuenta, con su estado leído del ledger (I2). Read-only puro: Astryum jamás
// emite ni acepta credenciales — el sujeto firma su CredentialAccept en Xaman.
// Sin allowlist de emisores configurada se listan igual, pero nada desbloquea.
router.get('/credentials', async (req: Request, res: Response) => {
  const account = String(req.query.account ?? '').trim();
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account)) {
    return void res.status(400).json({ error: 'INVALID_ACCOUNT' });
  }
  try {
    const { readAccountCredentials } = await import('../services/XrplCredentialVerifier');
    return void res.json(await readAccountCredentials(account));
  } catch (e) {
    return void res.status(500).json({ error: 'CREDENTIALS_READ_FAILED', detail: safeErrorDetail(e) });
  }
});

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
 */
router.post('/vault-yield/claim/prepare', requireLegacyAccess, async (req: Request, res: Response) => {
  // THE EXIT IS NEVER GATED: a payee claiming yield already owed to them is an exit,
  // so this route is flag-only (#10) — NO geofence. The geofence (#5) exists to stop
  // OPENING DeFi exposure, never to hold capital that is already owed.
  // `requireLegacyAccess` (above) is an ACCESS gate on the Legacy surface, not an exit
  // policy; whether it should stand in front of a payee's claim is PENDING A FOUNDER
  // DECISION and is deliberately left as is. The fuel gate stays: without the executor
  // there is no transport, and its refusal says the XRP has not moved.
  if (process.env.XRPL_DEFI_ENABLED !== 'true') {
    return void res.status(503).json({ error: 'XRPL_DEFI_DISABLED' });
  }
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
      readRedemptionFeeBips,
      estimateRedemptionFee,
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

    // Whether this session CONTROLS the XRPL account is read
    // server-side, once, and travels with the handoff — it is what lets an
    // operational account's own exit through the 0xFE guard (and what authorizes a
    // supersede on the doors that offer one; this one does not).
    // y se pregunta con `'exit'` — `legacy-yield-claim` ES una salida
    // (`HANDOFF_EXIT_ACTIONS`). Una tienda de pruebas caída sale ahora como 503
    // REINTENTABLE (`handoffErrorResponse`) en vez de componer una fila desplazable.
    const seatProof = await seatProofFieldsFor(req, xrplAddr, { purpose: 'exit' });
    const handoff = await buildDirectMintHandoff(
      provider,
      {
        xrplAddress: xrplAddr,
        grossXrpDrops: gross,
        innerCalls,
        action: 'legacy-yield-claim',
        preparedByUserId: req.siwe?.userId ?? null,
        ...seatProof,
        // Y si esa cuenta firma por QUÓRUM (SignerList: un Legacy lo
        // es), este 0xFE se compone con la ventana de su ceremonia — la que cubre el
        // payload de 24 h que van a firmar sus miembros; si no, con la de siempre.
        ...(await ceremonyWindowFor(xrplAddr)),
        supersedeAuthorized: false,
      },
      { params },
    );

    // The FAssets redemption fee on what is ACTUALLY
    // redeemed (redeemUBA), as a live protocol figure. Unreadable → null plus a line
    // that says so: never a 0 (invariants #6/#9).
    const redemptionFee = estimateRedemptionFee(redeemUBA, await readRedemptionFeeBips(provider).catch(() => null));
    const netUBA =
      redemptionFee.redemptionFeeBips != null
        ? redeemUBA - (redeemUBA * BigInt(redemptionFee.redemptionFeeBips)) / 10_000n
        : null;
    const redemptionFeeLine =
      redemptionFee.redemptionFeeBips != null
        ? `FAssets redemption fee (current protocol setting on AssetManagerFXRP): ${redemptionFee.redemptionFeeBips / 100}% of what is redeemed — about ${redemptionFee.redemptionFeeFxrp} FXRP, deducted by the protocol from the XRP the agent pays (an estimate: a partially fulfilled request is charged on what it actually redeems).`
        : 'FAssets redemption fee: the current figure could not be read from AssetManagerFXRP right now. It is NOT zero — the protocol deducts it from the XRP the agent pays.';
    const arrival =
      netUBA != null
        ? `When the FAssets agent pays the redemption, about ${formatBaseUnits(netUBA, 6)} XRP net of that fee arrive at ${dest} (${formatBaseUnits(redeemUBA, 6)} FXRP redeemed).`
        : `When the FAssets agent pays the redemption, ${formatBaseUnits(redeemUBA, 6)} FXRP redeemed arrive at ${dest} as XRP, minus the redemption fee.`;

    // EVERY exit prepare hands back its exit token. A payee's
    // claim signed by a council quorum reaches `/multisign/prepare`, which cannot
    // tell an exit from an entry by the bytes; without the token it depended on the
    // memo classification alone. An issuance failure never breaks the claim.
    let exitTokenFields: { exitToken?: string; exitTokenExpiresAt?: string } = {};
    try {
      const { issueCouncilExitToken } = await import('../services/councilExitToken');
      exitTokenFields = issueCouncilExitToken({
        account: xrplAddr,
        xrplTx: handoff.xrplPayment as Record<string, unknown>,
        action: 'legacy-yield-claim',
      });
    } catch (e) {
      console.error('[vault-yield-claim] exit token NOT issued:', (e as Error)?.message ?? e);
    }
    return void res.json({
      personalAccount: pa,
      claimable: owed.toString(),
      claimableHuman: formatBaseUnits(owed, state.asset.decimals),
      redeemUBA: redeemUBA.toString(),
      destination: dest,
      xrplPayment: handoff.xrplPayment,
      memoHex: handoff.memoHex,
      ...zeroFeSigningWindow(handoff),
      userOpData: handoff.userOpData,
      // ¿está encendido el vigía que entrega este 0xFE? El
      // banner del frontend se quedaba en su frase prudente sobre TODA salida
      // legítima porque ninguna ruta 0xFE lo decía — y el servidor sí lo sabe.
      serverDelivery: { executorEnabled: process.env.FLARE_EXECUTOR_ENABLED === 'true' },
      ...exitTokenFields,
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        redemptionFeeBips: redemptionFee.redemptionFeeBips,
        redemptionFeeFxrp: redemptionFee.redemptionFeeFxrp,
        redemptionFeeLine,
        note:
          `Claims the ${formatBaseUnits(owed, state.asset.decimals)} ${state.asset.symbol} of yield this Legacy owes you and ` +
          `redeems it to native XRP at ${dest}. ${arrival} ${redemptionFeeLine} This is YIELD only — the principal stays in the vault, where no function ` +
          'can send it to an address. Astryum never signs; you sign this payment yourself.',
        facts: {
          yieldClaimed: formatBaseUnits(owed, state.asset.decimals),
          arrivesAs: 'native XRP',
          destination: dest,
          redeemedFxrp: formatBaseUnits(redeemUBA, 6),
          estXrpOutNet: netUBA != null ? formatBaseUnits(netUBA, 6) : null,
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
    const handoffRefusal = handoffErrorResponse(e);
    if (handoffRefusal) return void res.status(handoffRefusal.status).json(handoffRefusal.body);
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
    let signerCount: number | null;
    try {
      const council = await xrplProvider.getSignerCouncil(account);
      signerCount = council?.signers.length ?? 0;
    } catch {
      signerCount = null;
    }
    const baseFeeDrops = await xrplProvider.getBaseFeeDrops().catch(() => 10);
    const txFeeXrp = signerCount === null ? null : (baseFeeDrops * (1 + signerCount)) / 1_000_000;

    const minGrossUBA = minimumViableGrossUBA(params);
    const maxGrossXrp = txFeeXrp === null ? null : Math.max(0, balance.spendableXrp - txFeeXrp);

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
      // G13: null on all three = "the council could not be read", never a
      // ceiling or a fee we invented. The surface must say so instead of
      // printing a figure, and must not offer a MAX built on it.
      txFeeXrp: txFeeXrp === null ? null : String(txFeeXrp),
      signerCount,
      maxGrossXrp: maxGrossXrp === null ? null : String(maxGrossXrp),
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

    // THE check this route existed without. The cage came
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

    // Beta cap: the cap covers the cage's TOTAL, so a
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
      {
        xrplAddress: account,
        grossXrpDrops,
        innerCalls,
        action: 'legacy-vault-fund',
        preparedByUserId: req.siwe?.userId ?? null,
        // Una ENTRADA sigue fallando cerrada si no se puede leer la
        // prueba, pero la fila se marca `preparedByProofUnreadable` igual — así
        // ninguna regla de asiento la aparta por un `false` que era «no pude leer».
        ...(await seatProofFieldsFor(req, account, { purpose: 'entry' })),
        // Y si esa cuenta firma por QUÓRUM (SignerList: un Legacy lo
        // es), este 0xFE se compone con la ventana de su ceremonia — la que cubre el
        // payload de 24 h que van a firmar sus miembros; si no, con la de siempre.
        ...(await ceremonyWindowFor(account)),
        supersedeAuthorized: false,
      },
      { params }, // same params → the net inside the handoff matches the batch
    );

    return void res.json({
      account,
      vault: state.vault,
      personalAccount: handoff.personalAccount,
      xrplPayment: handoff.xrplPayment,
      memoHex: handoff.memoHex,
      ...zeroFeSigningWindow(handoff),
      userOpData: handoff.userOpData,
      // ¿está encendido el vigía que entrega este 0xFE? El
      // banner del frontend se quedaba en su frase prudente sobre TODA salida
      // legítima porque ninguna ruta 0xFE lo decía — y el servidor sí lo sabe.
      serverDelivery: { executorEnabled: process.env.FLARE_EXECUTOR_ENABLED === 'true' },
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
    const handoffRefusal = handoffErrorResponse(e);
    if (handoffRefusal) return void res.status(handoffRefusal.status).json(handoffRefusal.body);
    const msg = (e as Error).message;
    const status = /LEGACY_.*missing|deploy the stack/i.test(msg) ? 503 : 400;
    return void res.status(status).json({ error: 'VAULT_FUND_PREPARE_FAILED', detail: msg });
  }
});

/**
 * POST /api/xrpl-defi/cage-create/prepare  { account: "r…", amountXrp: "5", linajeFeeBps?: 3000 }
 *
 * A Legacy's cage is BORN from one quorum signature — the leg that made
 * per-Legacy cages self-service instead of a founder ritual.
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
  // The acknowledgement is written under the live-session check, so a
  // request already in flight when an account is taken over cannot leave the new
  // owner holding a disclosure THEY never read (LegacyCageAckService).
  const sessionId = (req as Request & { siwe?: { sessionId?: string } }).siwe?.sessionId;
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
      session: sessionId ? { userId, sessionId } : null,
    });
    return void res.json(status);
  } catch (e) {
    // A REVOKED SESSION IS NOT A SERVER FAILURE.
    // The live-session check (K3) throws when the session is no longer the
    // account's, and this catch dressed it as 500 CAGE_ACK_NOT_RECORDED with the raw
    // chain in the modal: the user read «something broke» when the truth is «sign in
    // again». 401 with the code the rest of the surface already knows.
    const { isSessionRevoked, respondSessionRevoked } = await import('../services/identity/liveSession');
    if (isSessionRevoked(e)) return void respondSessionRevoked(res);
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
  // The disclosure gate. Birth is the moment capital first
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

    // Beta cap: caged principal never comes back out to an
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
      {
        xrplAddress: account,
        grossXrpDrops,
        innerCalls,
        action: 'legacy-cage-create',
        preparedByUserId: req.siwe?.userId ?? null,
        // ENTRADA — mismo par de campos, mismo sitio único.
        ...(await seatProofFieldsFor(req, account, { purpose: 'entry' })),
        // Y si esa cuenta firma por QUÓRUM (SignerList: un Legacy lo
        // es), este 0xFE se compone con la ventana de su ceremonia — la que cubre el
        // payload de 24 h que van a firmar sus miembros; si no, con la de siempre.
        ...(await ceremonyWindowFor(account)),
        supersedeAuthorized: false,
      },
      { params },
    );

    return void res.json({
      account,
      predicted,
      factory: factoryAddress,
      personalAccount: handoff.personalAccount,
      xrplPayment: handoff.xrplPayment,
      memoHex: handoff.memoHex,
      ...zeroFeSigningWindow(handoff),
      userOpData: handoff.userOpData,
      // ¿está encendido el vigía que entrega este 0xFE? El
      // banner del frontend se quedaba en su frase prudente sobre TODA salida
      // legítima porque ninguna ruta 0xFE lo decía — y el servidor sí lo sabe.
      serverDelivery: { executorEnabled: process.env.FLARE_EXECUTOR_ENABLED === 'true' },
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
    const handoffRefusal = handoffErrorResponse(e);
    if (handoffRefusal) {
      meter('CAGE_CREATE_PREPARE_FAILED');
      return void res.status(handoffRefusal.status).json(handoffRefusal.body);
    }
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
