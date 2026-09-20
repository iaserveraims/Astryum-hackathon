/**
 * CouncilProposalService — the engine-side path into the council inbox.
 *
 * Governed MoneyFlows are sign-at-trigger with N signers (decisión fundador
 * 2026-07-18): when a council rule fires, the trigger COMPOSES a proposal into
 * the existing inbox (councilProposals) and the QUORUM signs it there. The rule
 * itself holds ZERO authority — nothing moves without the quorum's signatures,
 * so pausing/creating rules never bypasses governance.
 *
 * The HTTP route (routes/councilProposals.ts) requires a SIWE browser session;
 * the AutomationEngine tick is a server process, so proposal creation from a
 * trigger goes through THIS service instead — same pinning (coordinator), same
 * persistence shape, same one-live-proposal-per-account constraint (XRPL pins
 * one Sequence at a time; two triggers firing serialize via cooldown+retry).
 *
 * Prepare-only intact (invariants #1/#8): this composes UNSIGNED txjson and
 * rows. It never signs, combines or broadcasts — members do, in their wallets.
 */

import { isValidClassicAddress, validate } from 'xrpl';
import { prisma } from '../database/prismaClient';
import { withSourceTag } from '../config/xrplSourceTag';
import { xrplProvider } from '../integrations/providers/chain/XRPLProvider';
import {
  prepareCouncilMultisig,
  NotACouncilError,
} from '../connectors/protocols/xrpl/XrplMultisigCoordinator';
// Type-only: erased at compile time, so this file still loads with no Flare
// stack configured (the heavy modules stay behind the dynamic imports below).
import type { OrderSummaryContext } from '../connectors/protocols/xrpl/XrplCouncilOrderService';
import type { DirectToVerdict, LegacyVaultState } from './flare/LegacyVaultStateService';

const PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // mirror of routes/councilProposals.ts
// g1-ceremonia (round 4): INERT since the live-proposal predicate here became
// the imported `findLiveProposal`. Kept, not deleted — it is the mirror of the
// route's own constant and documents what this service considers alive.
const LIVE_STATUSES = ['collecting', 'ready'] as const;

export interface ComposedCouncilTx {
  council: string;
  xrplTx: Record<string, unknown>;
  summary: string;
}

/**
 * G9 (auditoría 17-ago) — the RULE path had none of the honesty the HTTP path
 * has, and it failed SILENTLY in two directions at once.
 *
 * `POST /council-order/prepare` (routes/xrplDefi.ts) reads the cage before
 * composing and uses that ONE read twice: for the courtesy pre-flight (#11 —
 * refuse an order the vault already tells us would revert) and for the UNITS the
 * summary speaks in. `composeCouncilRuleTx` called `buildCouncilOrderHandoff`
 * with neither. Nothing errored, which is exactly why it survived:
 *
 *  1. The summary fell back to `humanAmount(raw, undefined)` → "Put 100000 base
 *     units of principal to work in venue #0". That string becomes the proposal
 *     TITLE in the council inbox and the body of the push. The quorum was being
 *     asked to sign a sentence written in the contract's integers.
 *  2. An order the cage would refuse (unknown/retired/not-yet-open venue, more
 *     than the idle principal, over the D2 entry cap, a recall bigger than the
 *     venue's basis, payees that do not add to 100.00% or that would strand the
 *     yield in the bridge) went into the inbox anyway. It then occupies the ONE
 *     live proposal slot the account has, the quorum gathers and signs, the FDC
 *     round is paid for (~20 FLR) — and the vault reverts on the far side. The
 *     unearned-success shape: everything looks right until the last inch.
 *
 * This helper is the route's block, lifted verbatim in behaviour so BOTH doors
 * share one definition of "would this land?". It is exported so the route can
 * adopt it and delete its copy (that edit belongs to routes/xrplDefi.ts, not to
 * this file). It returns a verdict instead of throwing, because the route
 * answers 400 + code while the rule path throws into the run log.
 *
 * Best-effort BY DESIGN, exactly like the route: an unreadable vault composes
 * anyway with the base-units summary and lets the contract decide. This guard
 * saves a wasted ceremony; it never becomes a second authority over the cage.
 *
 * G12-move (round 2) closed the gap this comment used to describe as "parity,
 * not oversight": `move`, `evacuate`, `retire-venue`, `propose-venue` and the
 * two bps setters ALL have a projectable revert, and none of them was judged.
 * See the checks below.
 */

// ── G12-move — the orders the pre-flight refused to judge ───────────────────
//
// What failed in silence: `POST /council-order/prepare` and the rule path both
// pre-flighted `direct-to`, `recall` and `set-payees` and NOTHING else. So a
// `move` into a venue that does not exist, is retired, or is still inside its
// 30-day D1a window — or out of an origin with no basis — composed, took the
// account's one live proposal slot, collected the quorum's signatures, PAID
// the FDC round (~20 FLR) and only then reverted inside `_allocate` /
// `InsufficientVenueBasis`. Same for a `retire-venue`/`evacuate` on an unknown
// id, a duplicate or zero-address `propose-venue`, and a bps setter outside the
// vault's own bounds. The unearned-success family the founder closed in
// August, alive again on the venue doors.
//
// Every check below is a MIRROR of a line in LegacyVault.sol, cited by name.
// They are pure (no RPC) and they refuse only what the contract itself refuses:
// a pass is "nothing known blocks it", never a guarantee — the contract decides.

/** Extra revert names these checks mirror, on top of {@link DirectToVerdict}'s
 *  (whose home, with checkDirectTo/checkRecall/checkMoveDestination, is
 *  services/flare/LegacyVaultStateService.ts). */
export type CouncilOrderRevertCode =
  | DirectToVerdict['code']
  | 'BPS_OUT_OF_BOUNDS'
  | 'DUPLICATE_VENUE'
  | 'VENUE_TARGET_INVALID'
  | 'VENUE_KIND_UNKNOWN'
  // LegacyVault.ZeroAddress() reached through `_addVenue`, not through a payee —
  // DirectToVerdict only names the payee flavour (PAYEE_ZERO_ADDRESS).
  | 'ZERO_ADDRESS';

export interface CouncilOrderVerdict {
  ok: boolean;
  code?: CouncilOrderRevertCode;
  reason?: string;
}

/** LegacyVault.MIN_VENUE_CAP_BPS / BPS (L95, L98) — the entry cap can never be
 *  set so low that it bricks entry entirely, nor above 100%. */
const MIN_VENUE_CAP_BPS = 1000;
const MAX_BPS = 10_000;
/** LegacyVault.LINAJE_FLOOR_BPS / LINAJE_CEIL_BPS (L92-93) — D5: the linaje
 *  always eats (floor) and the fruit is protected (ceiling). */
const LINAJE_FLOOR_BPS = 1000;
const LINAJE_CEIL_BPS = 4000;
/** LegacyVault.VenueKind — ERC4626 = 0, CompoundV2 = 1. An ordinal outside the
 *  enum is a valid uint8 on the wire and a Solidity panic on decode. */
const VENUE_KIND_ORDINALS = [0, 1];
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Does venue #id exist at all?
 *
 * `retireVenue` (LegacyVault L388) and `_evacuate` (L633) both open with
 * `if (venueId >= venues.length) revert VenueUnknown();` and nothing else they
 * do is projectable from a read — retiring is a flag flip and evacuating
 * redeems whatever the venue happens to hold. One guard, two doors.
 */
export function checkVenueExists(state: LegacyVaultState, venueId: number): CouncilOrderVerdict {
  if (!Number.isInteger(venueId) || venueId < 0 || !state.venues.some((v) => v.id === venueId)) {
    return {
      ok: false,
      code: 'VENUE_UNKNOWN',
      reason: `Venue #${venueId} does not exist in this vault (it holds ${state.venues.length}). The order would revert after the whole ceremony.`,
    };
  }
  return { ok: true };
}

/*
 * `checkMoveDestination` — the DESTINATION half of `moveToVenue` — used to live
 * HERE, carrying its own literal copy of checkDirectTo's VENUE_RETIRED and
 * VENUE_NOT_READY branches, under a comment admitting it only sat here because
 * that round did not own LegacyVaultStateService. REUSE (auditoría 2026-08-18):
 * it now lives beside checkDirectTo/checkRecall in
 * services/flare/LegacyVaultStateService.ts and shares their condition through
 * `checkVenueAcceptsEntry`, keeping its own rescue prose. This file reaches it
 * through the SAME dynamic import as the rest of the cage checks (below), so
 * CouncilProposalService still loads with no Flare stack configured.
 */

/**
 * `proposeVenue` (LegacyVault L376-383 → `_addVenue` L572-579).
 *
 * Reverts we can prove from a read: `notMigrated` (AlreadyMigrated), a zero /
 * malformed target (ZeroAddress — ethers refuses a non-address before that,
 * which is the same wasted ceremony one layer up), the same target already
 * whitelisted and not retired (DuplicateVenue), and an enum ordinal the vault
 * does not know (a valid uint8 on the wire, a Solidity panic on decode).
 */
export function checkProposeVenue(
  state: LegacyVaultState,
  target: unknown,
  kind: unknown,
): CouncilOrderVerdict {
  if (state.migrated) {
    return {
      ok: false,
      code: 'VAULT_MIGRATED',
      reason: 'This vault has been migrated to a successor — it accepts no new venue. Propose it on the successor vault instead.',
    };
  }
  const addr = String(target ?? '');
  if (!EVM_ADDRESS_RE.test(addr)) {
    return {
      ok: false,
      code: 'VENUE_TARGET_INVALID',
      reason: `"${addr}" is not a Flare contract address (0x + 40 hex) — the order cannot even be encoded, let alone land.`,
    };
  }
  if (addr.toLowerCase() === ZERO_ADDRESS) {
    return { ok: false, code: 'ZERO_ADDRESS', reason: 'The venue address is the zero address — the vault refuses it.' };
  }
  const kindNum = Number(kind);
  if (!VENUE_KIND_ORDINALS.includes(kindNum)) {
    return {
      ok: false,
      code: 'VENUE_KIND_UNKNOWN',
      reason: `The vault only knows two venue kinds: 0 (ERC-4626 vault) and 1 (Compound V2 market). "${String(kind)}" encodes as a valid uint8 and panics on the vault after the round is paid for.`,
    };
  }
  const clash = state.venues.find((v) => v.target.toLowerCase() === addr.toLowerCase() && !v.retired);
  if (clash) {
    return {
      ok: false,
      code: 'DUPLICATE_VENUE',
      reason: `${addr} is already venue #${clash.id} in this vault and is not retired — the vault refuses a duplicate.`,
    };
  }
  return { ok: true };
}

/**
 * `setMaxVenueBps` (L393-397) and `setLinajeFeeBps` (L399-403) — both revert
 * `BpsOutOfBounds()` outside their own bounds, and neither needs a vault read.
 * Bounds are the contract's constants, quoted above.
 */
export function checkBpsSetter(action: 'set-max-venue-bps' | 'set-linaje-fee-bps', bps: unknown): CouncilOrderVerdict {
  const [lo, hi, what] =
    action === 'set-max-venue-bps'
      ? [MIN_VENUE_CAP_BPS, MAX_BPS, 'The per-venue entry cap']
      : [LINAJE_FLOOR_BPS, LINAJE_CEIL_BPS, 'The linaje cut'];
  const n = Number(bps);
  if (!Number.isInteger(n) || n < lo || n > hi) {
    return {
      ok: false,
      code: 'BPS_OUT_OF_BOUNDS',
      reason: `${what} must be a whole number of basis points between ${lo} and ${hi}; this order carries "${String(bps)}". The vault refuses anything outside those bounds.`,
    };
  }
  return { ok: true };
}

export interface CouncilOrderPreflight {
  /** Units + venue names for the human summary; absent when the vault is unreadable. */
  summaryCtx?: OrderSummaryContext;
  /** Set when the cage already tells us this order cannot land. */
  blocked?: { code: CouncilOrderRevertCode; reason: string };
}

/** Thrown by the rule path when {@link councilOrderPreflight} blocks the order:
 *  no proposal is created, and the run log carries the vault's own reason. */
export class CouncilOrderWouldRevertError extends Error {
  readonly name = 'CouncilOrderWouldRevertError';
  constructor(readonly code: CouncilOrderRevertCode, reason: string) {
    super(`ORDER_WOULD_REVERT (${code}): ${reason}`);
  }
}

export async function councilOrderPreflight(
  cage: { vault: string; bridge: string },
  action: string,
  params: Record<string, unknown>,
): Promise<CouncilOrderPreflight> {
  const {
    readVaultState,
    checkDirectTo,
    checkMoveDestination,
    checkRecall,
    checkSetPayees,
    venueProtocolName,
  } = await import('./flare/LegacyVaultStateService');

  let summaryCtx: OrderSummaryContext | undefined;
  try {
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
    // One verdict per order, all against the SAME read.
    let verdict: CouncilOrderVerdict | null = null;
    if (action === 'direct-to' || action === 'recall') {
      const check = action === 'direct-to' ? checkDirectTo : checkRecall;
      verdict = check(state, Number(params.venueId), BigInt(String(params.amount)));
    } else if (action === 'move') {
      // G12-move: `moveToVenue` is recall-then-allocate in ONE call, so its
      // pre-flight is exactly that composition — the EXIT half is byte-for-byte
      // `recall`'s (LegacyVault L317-318 vs L292-293, same two guards in the
      // same order), and the ENTRY half is `_allocate` WITHOUT the cap and
      // without the idle check. Reusing checkRecall rather than restating it is
      // deliberate: two copies of "does this venue hold this much basis" is how
      // the halves drift apart.
      const amount = BigInt(String(params.amount));
      verdict = checkRecall(state, Number(params.fromId), amount);
      if (!verdict.ok) {
        verdict = {
          ...verdict,
          reason: `A move first recalls the principal out of the origin venue, and that half cannot land: ${verdict.reason ?? ''}`,
        };
      } else {
        verdict = checkMoveDestination(state, Number(params.toId));
      }
    } else if (action === 'evacuate' || action === 'retire-venue') {
      verdict = checkVenueExists(state, Number(params.venueId));
    } else if (action === 'propose-venue') {
      verdict = checkProposeVenue(state, params.target, params.kind);
    }
    if (verdict && !verdict.ok) return { summaryCtx, blocked: { code: verdict.code, reason: verdict.reason ?? '' } };
  } catch {
    /* unreadable vault or malformed params — fall through; the encoder and the
       contract both still have their say, and the summary falls back to base
       units rather than blocking a legitimate order over wording. A read that
       FAILED is "we could not check it", never "it would revert" — so nothing
       below this line may refuse an order on the strength of a missing read. */
  }

  // set-payees lives OUTSIDE the best-effort block on purpose (same as the
  // route): it needs no vault read, and its trap guard — the bridge or the vault
  // as payee = yield stranded for ever — must hold even when Flare is
  // unreadable. That failure is permanent, not a wasted ceremony.
  if (action === 'set-payees') {
    const verdict = checkSetPayees(
      { vault: cage.vault, bridge: cage.bridge },
      (params as { payees?: unknown }).payees,
    );
    if (!verdict.ok) return { summaryCtx, blocked: { code: verdict.code, reason: verdict.reason ?? '' } };
  }
  // Same reasoning for the two bps setters (G12-move): their bounds are
  // CONSTANTS of the contract, so the verdict is just as true with Flare down.
  if (action === 'set-max-venue-bps' || action === 'set-linaje-fee-bps') {
    const verdict = checkBpsSetter(action, (params as { bps?: unknown }).bps);
    if (!verdict.ok) return { summaryCtx, blocked: { code: verdict.code, reason: verdict.reason ?? '' } };
  }
  return { summaryCtx };
}

/**
 * Compose the UNSIGNED council tx a fired rule proposes. Two kinds:
 *  - 'councilPayment': a plain XRPL Payment from the council account — works on
 *    mainnet today (params: { council?, destination, amountDrops, memo? }).
 *  - 'councilOrder': a LegacyVault order Payment whose memo commits
 *    keccak256(orderData) — needs the deployed Legacy stack; the committed
 *    bytes are persisted for the relayer exactly like the HTTP prepare route
 *    (params: { council?, orderAction, orderParams }).
 * `fallbackCouncil` = the rule's wallet address, used when params carry no
 * explicit council (vault-scoped rules watch an EVM address and must name it).
 */
export async function composeCouncilRuleTx(
  kind: 'councilPayment' | 'councilOrder',
  params: Record<string, unknown>,
  fallbackCouncil: string,
): Promise<ComposedCouncilTx> {
  const council = String(params.council ?? fallbackCouncil);
  if (!isValidClassicAddress(council)) {
    throw new Error(
      `council rule needs an XRPL council account: params.council is missing and the rule's wallet (${fallbackCouncil}) is not an r-address`,
    );
  }

  if (kind === 'councilPayment') {
    const destination = String(params.destination ?? '');
    if (!isValidClassicAddress(destination)) throw new Error('councilPayment needs params.destination (an XRPL r-address)');
    if (destination === council) throw new Error('councilPayment destination must differ from the council account');
    const drops = BigInt(String(params.amountDrops ?? '0'));
    if (drops <= 0n) throw new Error('councilPayment needs params.amountDrops > 0 (XRP drops, integer)');
    const memo = typeof params.memo === 'string' && params.memo.trim() ? params.memo.trim().slice(0, 200) : null;
    const tx = withSourceTag({
      TransactionType: 'Payment' as const,
      Account: council,
      Destination: destination,
      Amount: drops.toString(),
      ...(memo
        ? { Memos: [{ Memo: { MemoData: Buffer.from(memo, 'utf8').toString('hex').toUpperCase() } }] }
        : {}),
    });
    validate(tx as never);
    return {
      council,
      xrplTx: tx,
      summary: `Payment of ${Number(drops) / 1_000_000} XRP from the council to ${destination}`,
    };
  }

  // councilOrder — the FDC-enforced vault rail (throws a readable error when
  // this Legacy has no cage; the tick surfaces it honestly). The cage is
  // resolved from the COUNCIL the rule belongs to, never from env — a rule of
  // a second Legacy must order against its own vault (2026-08-05).
  const orderAction = String(params.orderAction ?? '');
  const orderParams = (params.orderParams ?? {}) as Record<string, unknown>;
  const { buildCouncilOrderHandoff } = await import('../connectors/protocols/xrpl/XrplCouncilOrderService');
  const { requireCageForCouncil } = await import('./flare/LegacyCageResolver');
  const { saveCouncilOrderRecord } = await import('./flare/LegacyOrderStore');
  const cage = await requireCageForCouncil(council);
  // G9 — the same read the HTTP door does: it both BLOCKS an order the cage
  // would refuse (before the quorum signs and before the FDC round is paid for)
  // and gives the summary its decimals and venue names, so the title in the
  // inbox says "0.1 FXRP … Kinetic (venue #0)" instead of "100000 base units …
  // venue #0". A quorum cannot review what it cannot read.
  const preflight = await councilOrderPreflight(cage, orderAction, orderParams);
  if (preflight.blocked) {
    // Thrown, not swallowed: the tick turns this into runStatus='error' with the
    // vault's own reason in the run notes. No proposal is created, so the
    // account's single live slot stays free for an order that CAN land.
    throw new CouncilOrderWouldRevertError(preflight.blocked.code, preflight.blocked.reason);
  }
  const handoff = await buildCouncilOrderHandoff({
    council,
    action: orderAction as never,
    params: orderParams,
    cage,
    ...(preflight.summaryCtx ? { summaryCtx: preflight.summaryCtx } : {}),
  });
  await saveCouncilOrderRecord({
    orderHash: handoff.order.orderHash,
    orderData: handoff.order.orderData,
    action: handoff.order.action,
    summary: handoff.order.summary,
    nonce: handoff.order.nonce,
    chain: handoff.order.chain,
    bridge: handoff.order.bridge,
    vault: handoff.order.vault,
    council,
  });
  return { council, xrplTx: handoff.xrplTx, summary: handoff.order.summary };
}

// The `?: undefined` counter-fields keep property access typeable without
// narrowing — this repo compiles with strict off, where boolean-discriminant
// narrowing is unavailable (same trick as CanonicalEvmTranslator.TranslateResult).
export type CouncilProposalOutcome =
  | { ok: true; proposalId: string; reason?: undefined; detail?: undefined }
  | {
      ok: false;
      reason:
        | 'LIVE_PROPOSAL_EXISTS'
        | 'PRIOR_SEAT_UNRESOLVED'
        | 'NOT_A_COUNCIL'
        | 'NOT_A_COUNCIL_MEMBER'
        | 'COUNCIL_READ_FAILED'
        | 'PREPARE_FAILED';
      detail: string;
      proposalId?: undefined;
    };

/** How long the trigger-time signer-list read may take before the tick moves on. */
const RULE_COUNCIL_READ_TIMEOUT_MS = 8_000;

async function readSignerCouncilWithTimeout(account: string): Promise<Awaited<ReturnType<typeof xrplProvider.getSignerCouncil>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      xrplProvider.getSignerCouncil(account),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`signer list ${account} timed out after ${RULE_COUNCIL_READ_TIMEOUT_MS}ms`)),
          RULE_COUNCIL_READ_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Create a proposal in the council inbox from a fired rule. Mirrors the HTTP
 * route's flow: live-proposal check → UNRESOLVED-SEAT check (G1-cadena round 3
 * — the same `findUnresolvedSeat` the HTTP door uses) → coordinator pin
 * (Sequence/Fee/SigningPubKey identical for every member) → persist.
 * `createdByUserId` is the rule owner's app user (the proposer of record).
 */
export async function createCouncilProposalFromRule(input: {
  account: string;
  xrplTx: Record<string, unknown>;
  title: string;
  createdByUserId: string;
}): Promise<CouncilProposalOutcome> {
  // g1-ceremonia (round 4): the HTTP door and the ceremony both ask
  // `findLiveProposal`; this was a THIRD, literal copy of the same predicate,
  // in the file that already imports from that module a dozen lines below. Two
  // definitions of "live" are exactly the drift the guard's own docblock says
  // it exists to avoid — and this copy is the one nobody is watching, because
  // it runs on a tick with no human in front of the screen.
  const { findLiveProposal, findCeremonySeat, ceremonySeatDetail, findUnresolvedSeat, sessionIsCouncilMember, PROVE_MEMBERSHIP_HINT } =
    await import('../routes/councilProposals');
  // ── productizer-it6 — THE RULE PROPOSES ONLY WHILE ITS OWNER SITS ON THE COUNCIL
  //
  // `POST /api/rules` now refuses a council rule whose owner holds no seat; this
  // is the defence in depth for the rules that already exist, for a member
  // removed from the SignerList after creating one, and for any other writer of
  // rule rows. Same predicate as every proposal door (`sessionIsCouncilMember`),
  // fed with the signer list read OFF THE LEDGER at trigger time.
  //
  // it. 17 (finding 2.1b): that predicate now reads PROVEN addresses only — a
  // signature-backed `WalletBinding`, or the address of the session asking.
  // There is no session here (a rule fires on a tick, with nobody in front of
  // the screen), so the floor is the binding alone. An owner whose seat was
  // only ever a self-declared `wallet` row stops proposing through a rule until
  // they bind that address with a signature: the rule speaks for a council, and
  // an unproven claim is not a seat.
  //
  // It runs FIRST on purpose: the seat guards below answer with another
  // council's proposal id, title and ledger verdict, and those land in the run
  // notes and the Alert the rule's owner reads — a non-member must not read
  // them here any more than on `GET /api/council/proposals`. A refusal is an
  // ordinary failure outcome: the engine records it on the rule's run and Alert
  // and composes nothing.
  let signerCouncil: Awaited<ReturnType<typeof xrplProvider.getSignerCouncil>>;
  try {
    signerCouncil = await readSignerCouncilWithTimeout(input.account);
  } catch (e) {
    return {
      ok: false,
      reason: 'COUNCIL_READ_FAILED',
      detail:
        `XRPL could not be read to confirm that this rule's owner still sits on council ${input.account}, so nothing was ` +
        `composed — the rule tries again on its next tick. (${(e as Error).message})`,
    };
  }
  if (!signerCouncil) {
    return { ok: false, reason: 'NOT_A_COUNCIL', detail: new NotACouncilError(input.account).message };
  }
  if (!(await sessionIsCouncilMember(input.createdByUserId, { signerList: signerCouncil.signers }))) {
    return {
      ok: false,
      reason: 'NOT_A_COUNCIL_MEMBER',
      detail:
        `this rule's owner does not hold a PROVEN seat on council ${input.account} (none of its signer addresses is ` +
        "among the owner's proven addresses), so nothing was composed. A rule proposes on a council's behalf only " +
        'while its owner sits on it. ' +
        // it. 19 (2.3b): the remedy has to travel with the refusal. This lands in the
        // rule's run notes and in the Alert its owner reads — and a rule that fires on
        // a tick has NO session, so the only proof it can ever see is a signed
        // binding. Without this sentence the owner reads «you are not on this council»
        // about a council they do sit on, and the fix (bind that address with a
        // signature) is nowhere on the screen.
        PROVE_MEMBERSHIP_HINT,
    };
  }
  const live = await findLiveProposal(input.account);
  if (live) {
    return {
      ok: false,
      reason: 'LIVE_PROPOSAL_EXISTS',
      detail: `council ${input.account} already has proposal ${live.id} collecting signatures — XRPL pins one Sequence at a time`,
    };
  }
  // ── G1-cadena (round 3, finding 1) — THE DOUBLE PAYMENT'S WORST PATH ───────
  //
  // WHAT FAILED IN SILENCE: the check above only refuses while a proposal is
  // INSIDE its deadline. Round 2 taught `POST /` to ask the ledger about the
  // stale seats before pinning a new Sequence — and this door, the one a fired
  // MoneyFlow walks through, was left exactly as it was. It is the worse of the
  // two: a governed monthly rule composes over and over with NOBODY in front of
  // a screen, and since the guard stopped archiving unresolved rows they now
  // stay `ready`/`collecting` for ever, so the stale seat never goes away by
  // itself. Month after month, a fresh valid Sequence over a payment that may
  // already have gone out.
  //
  // Same guard as the HTTP door, imported rather than restated — two copies of
  // "is the previous seat settled?" is how the halves drift apart. Dynamic so
  // this service still loads (and its unit tests still run) without pulling the
  // express router in, exactly like the Flare imports above. (Destructured
  // from the SAME dynamic import as the live-proposal guard at the top of this
  // function — one module, one import.)
  // ── g1-ceremonia (round 4) — THE THIRD WAY THE SEAT IS HELD ───────────────
  //
  // A synchronous ceremony pins the council's Sequence and, until this round,
  // left no server-side trace of it; the rule path was as blind to it as the
  // HTTP one. It reports as LIVE_PROPOSAL_EXISTS on purpose, and the reason is
  // the CONSUMER: AutomationEngine treats that reason as "council busy — retry
  // after cooldown, and do not count this tick as fired", and treats every
  // other reason as an error with an Alert. A ceremony in flight is precisely
  // a busy council: transient, nobody's fault, gone within 30 minutes. A new
  // reason code would have landed in the error branch and told the family that
  // their monthly rule had broken. The `detail` says what it really is.
  const ceremony = await findCeremonySeat(input.account);
  if (ceremony) {
    return {
      ok: false,
      reason: 'LIVE_PROPOSAL_EXISTS',
      detail: `council ${input.account} is mid-ceremony: ${ceremonySeatDetail(ceremony)}`,
    };
  }
  const unresolved = await findUnresolvedSeat(input.account);
  if (unresolved) {
    // The tick turns this into runStatus='error' with these notes in the run
    // log AND in an Alert, so the family finds out that the rule did NOT
    // compose and why. No proposal is created: nothing to sign, nothing to
    // broadcast, no second payment. The rule composes again on its next tick,
    // once a human has settled the row in the inbox (register the hash it
    // produced, or file it).
    return {
      ok: false,
      reason: 'PRIOR_SEAT_UNRESOLVED',
      detail:
        `a previous proposal on ${input.account} (${unresolved.title ?? unresolved.txType}) is not settled: ` +
        `${unresolved.ledgerCheck.detail} No new proposal was composed — composing over an unresolved seat is how a council pays twice. ` +
        'Settle it in the proposal inbox (register the transaction hash it produced, or file it) and this rule composes on its next tick.',
    };
  }
  try {
    const prepared = await prepareCouncilMultisig(xrplProvider, {
      account: input.account,
      xrplTx: input.xrplTx,
    });
    const proposal = await prisma.councilProposal.create({
      data: {
        account: input.account,
        createdByUserId: input.createdByUserId,
        title: input.title,
        txType: String((input.xrplTx as { TransactionType?: unknown }).TransactionType ?? 'Unknown'),
        txjson: prepared.multisigTx as never,
        quorum: prepared.council.quorum,
        signerList: prepared.council.signers as never,
        expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
      },
      select: { id: true },
    });
    return { ok: true, proposalId: proposal.id };
  } catch (e) {
    if (e instanceof NotACouncilError) {
      return { ok: false, reason: 'NOT_A_COUNCIL', detail: (e as Error).message };
    }
    return { ok: false, reason: 'PREPARE_FAILED', detail: (e as Error).message };
  }
}
