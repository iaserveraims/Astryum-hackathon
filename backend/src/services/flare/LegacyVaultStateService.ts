/**
 * LegacyVaultStateService — the cage, read out loud.
 *
 * The council order rail could always COMPOSE an order (XrplCouncilOrderService)
 * but nothing could ever ANSWER the questions a human asks before signing one:
 * which venues exist, what is venue #1, how much principal is idle, what token
 * is this and with how many decimals. So the UI asked the family to type a venue
 * NUMBER and an amount in BASE UNITS, blind — and an order aimed at a venue that
 * does not exist still costs the whole ceremony (quorum signatures + the FDC
 * round + its ~20 FLR) before reverting with VenueUnknown() on the far side.
 *
 * This module is the missing read. It is READ-ONLY by construction: it never
 * writes, never signs, and does not touch the cage's rules — those live in
 * LegacyVault.sol and stay exactly where they are (invariant: the cage is not
 * moved, softened, or bypassed). Everything here is a `view` call.
 *
 * `checkDirectTo` mirrors, in pure TypeScript, the SIX ways LegacyVault._allocate
 * reverts. It is a courtesy pre-flight, not an authority: the contract remains
 * the only thing that decides. Saying "this order would revert, and why" before
 * the quorum signs is the honest counterpart to invariant #11 (simulate before
 * signature) — and it closes one more instance of the unearned-success family:
 * a ceremony that LOOKS successful right up to the moment it silently was not.
 */

import { ethers } from 'ethers';
import {
  LEGACY_NETWORKS,
  legacyStackConfig,
  type LegacyNetwork,
  type LegacyStackConfig,
} from '../../connectors/protocols/xrpl/XrplCouncilOrderService';

/** The venue kinds LegacyVault.VenueKind can hold (enum order is the contract's). */
export type LegacyVenueKind = 'erc4626' | 'compoundv2';

const VENUE_KINDS: LegacyVenueKind[] = ['erc4626', 'compoundv2'];

export interface LegacyVenueRow {
  id: number;
  /** The protocol contract the principal is deposited into. */
  target: string;
  /** Its ERC-20 symbol (e.g. `isoFXRP`) — so a person reads "Kinetic isoFXRP"
   *  instead of "venue #0" and can check the address themselves. */
  targetSymbol: string | null;
  /**
   * Shares the vault actually holds in that protocol, read from the PROTOCOL,
   * not from the vault's own bookkeeping. `basis`/`value` are what the vault
   * says; this is what the venue says. When capital really moved, this stops
   * being zero — which is the honest proof that a `directTo` landed.
   */
  shares: string | null;
  kind: LegacyVenueKind;
  /** D1a timelock: entry is allowed only from this unix second. */
  readyAt: number;
  /** Closed to NEW entries; exits always work (never blocks recall/evacuate). */
  retired: boolean;
  /** Principal allocated here, base units. */
  basis: string;
  /** What the venue is worth to the vault right now, base units. */
  value: string;
}

/**
 * The PROTOCOL a venue works in ("Kinetic", "Firelight"), resolved from its
 * target contract against the configured addresses — or null when we cannot
 * name it. This is the abstraction the family reads: never a receipt-token
 * symbol like `isoFXRP`, never a bare index.
 *
 * Returns null instead of guessing so each caller picks its own honest
 * fallback (the portfolio uses the token symbol, an order summary says
 * "venue #N"). Lives here because a venue row is this module's shape, and both
 * the portfolio reader and the council-order summary need the same answer.
 */
export function venueProtocolName(v: Pick<LegacyVenueRow, 'target'>): string | null {
  const t = v.target.toLowerCase();
  const KNOWN: Array<[string | undefined, string]> = [
    [process.env.KINETIC_KFXRP_ISO, 'Kinetic'],
    [process.env.KINETIC_KUSDT0_ISO, 'Kinetic'],
    [process.env.KINETIC_KUSDCE, 'Kinetic'],
    [process.env.KINETIC_KSFLR, 'Kinetic'],
    [process.env.KINETIC_KWETH, 'Kinetic'],
    [process.env.KINETIC_KFLRETH, 'Kinetic'],
    [process.env.FIRELIGHT_STXRP, 'Firelight'],
    [process.env.FIRELIGHT_STAKING, 'Firelight'],
  ];
  for (const [addr, name] of KNOWN) if (addr && addr.toLowerCase() === t) return name;
  return null;
}

export interface LegacyVaultState {
  vault: string;
  chain: string;
  /** Who the vault OBEYS. On this deployment it is the XrplCouncilBridge — the
   *  quorum reaches the vault through it, never directly. Callers compare this
   *  to the configured bridge (assertCouncilBinding) before composing an order. */
  council: string;
  asset: { address: string; symbol: string; decimals: number };
  /** All base units, as decimal strings (never JS numbers — these overflow). */
  totalPrincipal: string;
  allocatedPrincipal: string;
  idlePrincipal: string;
  totalValue: string;
  /** D2 entry cap, in basis points of totalValue, per venue. */
  maxVenueBps: number;
  migrated: boolean;
  venues: LegacyVenueRow[];
  /** Yield already credited to payees and awaiting claim(). */
  totalClaimable: string;
  /**
   * Asset sitting in the vault contract that is NEITHER principal NOR owed
   * yield — i.e. tokens transferred straight to the address instead of through
   * `deposit()`. See `computeStrayAssets`: this is money that does nothing.
   */
  strayAssets: string;
}

/**
 * Tokens the vault holds that are not principal and not owed yield.
 *
 * A plain ERC-20 transfer to the vault address is NOT a deposit: `deposit()` is
 * what increments `totalPrincipal`, and `idlePrincipal()` is
 * `totalPrincipal - allocatedPrincipal`. So tokens sent directly leave idle at
 * zero — every `directTo` still reverts InsufficientIdlePrincipal — while the
 * balance quietly inflates `totalValue()`, which is the denominator of the D2
 * entry cap. Nobody can claim them and no council order can reach them.
 *
 * This is a live foot-gun: the mint rail can send FXRP to an arbitrary EVM
 * address, and the vault's address is the intuitive-looking wrong answer.
 * Surfacing the number is the only way anyone finds out.
 */
export function computeStrayAssets(
  assetBalance: bigint,
  idlePrincipal: bigint,
  totalClaimable: bigint,
): bigint {
  const stray = assetBalance - idlePrincipal - totalClaimable;
  return stray > 0n ? stray : 0n;
}

/** The contract's `view` surface — reads only, no state-changing selector here. */
export const VAULT_STATE_ABI = [
  'function asset() view returns (address)',
  'function council() view returns (address)',
  'function venueCount() view returns (uint256)',
  'function venues(uint256) view returns (address target, uint8 kind, uint64 readyAt, bool retired)',
  'function venueBasis(uint256) view returns (uint256)',
  'function venueValue(uint256) view returns (uint256)',
  'function totalPrincipal() view returns (uint256)',
  'function allocatedPrincipal() view returns (uint256)',
  'function idlePrincipal() view returns (uint256)',
  'function totalValue() view returns (uint256)',
  'function maxVenueBps() view returns (uint16)',
  'function migrated() view returns (bool)',
  'function totalClaimable() view returns (uint256)',
];

const ERC20_META_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
];

/** The contract enum → our label. An unknown ordinal is a contract we do not
 *  understand; say so loudly rather than guessing a kind and mis-describing
 *  where the family's principal is about to go. */
export function decodeVenueKind(ordinal: number | bigint): LegacyVenueKind {
  const n = Number(ordinal);
  const kind = VENUE_KINDS[n];
  if (!kind) throw new Error(`unknown VenueKind ordinal ${n} — this vault is newer than this client`);
  return kind;
}

/**
 * Base units → a human decimal string, EXACT (no float anywhere: 18-decimal
 * values do not survive Number). Trailing zeros are trimmed, so 1.500000 reads
 * as "1.5" and a whole amount as "1".
 */
export function formatBaseUnits(raw: bigint | string, decimals: number): string {
  const v = typeof raw === 'bigint' ? raw : BigInt(raw);
  if (decimals === 0) return v.toString();
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/**
 * A human decimal string → base units, EXACT. Rejects anything that is not a
 * plain positive decimal, and refuses to silently round away precision the
 * token cannot carry — a truncated amount is a different order than the one the
 * person typed, and they are about to sign it.
 */
export function parseBaseUnits(human: string, decimals: number): bigint {
  const s = String(human).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`"${human}" is not a positive decimal amount`);
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) {
    throw new Error(`this token holds ${decimals} decimals — "${human}" would lose precision`);
  }
  const scaled = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac || '0').padEnd(decimals, '0') || '0');
  if (scaled <= 0n) throw new Error('amount must be greater than zero');
  return scaled;
}

export interface DirectToVerdict {
  ok: boolean;
  /** Machine-readable cause, mirroring the contract's revert names. */
  code?:
    | 'VENUE_UNKNOWN'
    | 'VENUE_RETIRED'
    | 'VENUE_NOT_READY'
    | 'ZERO_AMOUNT'
    | 'INSUFFICIENT_IDLE_PRINCIPAL'
    | 'ENTRY_CAP_EXCEEDED'
    | 'VAULT_MIGRATED'
    | 'INSUFFICIENT_VENUE_BASIS'
    | 'PAYEE_INVALID'
    | 'PAYEE_ZERO_ADDRESS'
    | 'PAYEE_ZERO_BPS'
    | 'PAYEE_BPS_SUM_INVALID'
    | 'PAYEE_TRAPS_FUNDS';
  /** One honest sentence for the person about to sign. */
  reason?: string;
}

/**
 * Would `recall(venueId, amount)` land? The exit side of the same courtesy.
 *
 * Exits are deliberately unconstrained in the cage — never delayed, never
 * capped, and allowed out of a RETIRED venue (that is the point of retiring
 * one). So recall only refuses on a zero amount or on more than the venue holds
 * as principal for the vault. An unknown venue has a zero basis, so the
 * contract would also stop it there; we name it precisely instead, because
 * "venue #9 does not exist" is actionable and "insufficient basis" is not.
 */
export function checkRecall(
  state: LegacyVaultState,
  venueId: number,
  amount: bigint,
): DirectToVerdict {
  const venue = state.venues.find((v) => v.id === venueId);
  if (!venue) {
    return {
      ok: false,
      code: 'VENUE_UNKNOWN',
      reason: `Venue #${venueId} does not exist in this vault (it holds ${state.venues.length}).`,
    };
  }
  if (amount <= 0n) return { ok: false, code: 'ZERO_AMOUNT', reason: 'The amount must be greater than zero.' };
  const basis = BigInt(venue.basis);
  if (amount > basis) {
    return {
      ok: false,
      code: 'INSUFFICIENT_VENUE_BASIS',
      reason: `Venue #${venueId} holds ${formatBaseUnits(basis, state.asset.decimals)} ${state.asset.symbol} of principal for this vault; this order recalls more than that.`,
    };
  }
  return { ok: true };
}

/**
 * WHICH DOOR is asking to put capital into a venue. The CONDITION that refuses
 * is identical (LegacyVault checks the same three things whatever the caller);
 * the SENTENCE is not, and flattening it would be the wrong kind of reuse:
 * a `move` is a rescue out of a venue that is going wrong, so its refusal has
 * to say that a rescue is still an entry — otherwise the council reads
 * «closed to new entries», thinks «this is not new, it is a rescue», and
 * composes the order anyway.
 */
export type VenueEntryDoor =
  /** `directTo` — fresh principal from the vault's idle balance. */
  | 'direct'
  /** `moveToVenue`'s destination half — principal recalled out of another venue. */
  | 'rescue';

/** {@link DirectToVerdict} pinned to its refusal arm, so a caller can narrow on
 *  `ok` and reach the venue on the pass arm. */
export type VerdictRefusal = DirectToVerdict & { ok: false };

/** The gate's answer: the venue itself when entry is open (so the caller goes
 *  straight to the size checks without a second lookup), the refusal otherwise. */
export type VenueEntryGate = { ok: true; venue: LegacyVenueRow } | VerdictRefusal;

/**
 * The refusals EVERY entry into a venue shares — unknown venue, retired venue,
 * venue still inside its D1a waiting window.
 *
 * REUSE (auditoría 2026-08-18): `checkMoveDestination` was born in
 * CouncilProposalService.ts carrying a LITERAL second copy of the VENUE_RETIRED
 * and VENUE_NOT_READY branches below — same codes, same conditions
 * (`venue.retired`, `nowSec < venue.readyAt`), only the prose differed. Its own
 * comment said it lived there because that round did not own this file. Two
 * copies of «can capital enter this venue?» is how the two doors drift apart:
 * the day LegacyVault adds a fourth entry guard, one door learns it and the
 * other keeps composing orders that revert after the quorum has signed and the
 * FDC round is paid for. One condition, two voices.
 *
 * Mirrors LegacyVault: `venueId >= venues.length` → VenueUnknown, the `retired`
 * flag → VenueRetired, `block.timestamp < readyAt` → VenueNotReady. Pure (no
 * RPC): a pass is «nothing known blocks it», never a guarantee — the contract
 * decides.
 */
export function checkVenueAcceptsEntry(
  state: LegacyVaultState,
  venueId: number,
  nowSec: number,
  door: VenueEntryDoor,
): VenueEntryGate {
  const venue = state.venues.find((v) => v.id === venueId);
  if (!venue) {
    return {
      ok: false,
      code: 'VENUE_UNKNOWN',
      reason: `Venue #${venueId} does not exist in this vault (it holds ${state.venues.length}). The order would revert after the whole ceremony.`,
    };
  }
  if (venue.retired) {
    return {
      ok: false,
      code: 'VENUE_RETIRED',
      reason:
        door === 'rescue'
          ? `Venue #${venueId} is retired — closed to new entries, and a rescue is still an entry. Move the principal to a live venue, or recall it into the vault.`
          : `Venue #${venueId} is retired — closed to new entries. Exits from it still work.`,
    };
  }
  if (nowSec < venue.readyAt) {
    const opensAt = new Date(venue.readyAt * 1000).toISOString();
    return {
      ok: false,
      code: 'VENUE_NOT_READY',
      reason:
        door === 'rescue'
          ? `Venue #${venueId} opens at ${opensAt} (the vault's 30-day waiting period). Capital cannot enter before then — not even a rescue.`
          : `Venue #${venueId} opens at ${opensAt} (the vault's waiting period). Capital cannot enter before then.`,
    };
  }
  return { ok: true, venue };
}

/**
 * Would `directTo(venueId, amount)` land? Mirrors LegacyVault._allocate's six
 * reverts (plus notMigrated) against freshly-read state.
 *
 * The entry cap is checked the way the contract does it — POST-move, on real
 * values — which we can only PROJECT here: the principal moves from the vault's
 * idle balance into the venue, so totalValue is unchanged and venueValue grows
 * by `amount`. Prices can move between this read and the settlement, so treat a
 * pass as "nothing known blocks it", never as a guarantee. The contract decides.
 */
export function checkDirectTo(
  state: LegacyVaultState,
  venueId: number,
  amount: bigint,
  nowSec: number = Math.floor(Date.now() / 1000),
): DirectToVerdict {
  if (state.migrated) {
    return { ok: false, code: 'VAULT_MIGRATED', reason: 'This vault has been migrated to a successor — it accepts no new direction.' };
  }
  // The three refusals every entry shares now come from ONE place (see
  // checkVenueAcceptsEntry above); what stays here is what only a `directTo`
  // can hit: the amount, the idle principal and the D2 cap.
  const gate = checkVenueAcceptsEntry(state, venueId, nowSec, 'direct');
  if (!gate.ok) return gate;
  const { venue } = gate;
  if (amount <= 0n) return { ok: false, code: 'ZERO_AMOUNT', reason: 'The amount must be greater than zero.' };
  const idle = BigInt(state.idlePrincipal);
  if (amount > idle) {
    return {
      ok: false,
      code: 'INSUFFICIENT_IDLE_PRINCIPAL',
      reason: `The vault holds ${formatBaseUnits(idle, state.asset.decimals)} ${state.asset.symbol} idle; this order directs more than that. Capital already working in a venue must be recalled first.`,
    };
  }
  // D2 entry cap — the contract's exact comparison, on projected post-move values.
  const projectedVenue = BigInt(venue.value) + amount;
  const total = BigInt(state.totalValue);
  if (total > 0n && projectedVenue * 10_000n > total * BigInt(state.maxVenueBps)) {
    return {
      ok: false,
      code: 'ENTRY_CAP_EXCEEDED',
      reason: `The vault caps any single venue at ${(state.maxVenueBps / 100).toFixed(2)}% of its value. This order would put venue #${venueId} over that line.`,
    };
  }
  return { ok: true };
}

/**
 * The DESTINATION half of `moveToVenue` — i.e. `_allocate(toId, received,
 * false)` (LegacyVault L330, L583-587).
 *
 * Deliberately NOT `checkDirectTo`, and the two differences are the whole
 * point:
 *  - the D2 entry cap is NOT enforced on a rescue (`enforceCap = false`), so
 *    refusing a move over the cap would block a legitimate emergency;
 *  - `InsufficientIdlePrincipal` cannot fire either: the origin's principal is
 *    withdrawn and `allocatedPrincipal` decremented in the SAME call, so
 *    `received <= idlePrincipal()` holds by construction.
 * `notMigrated` is absent from `moveToVenue` too — and a migrated vault has had
 * every venue evacuated (L500-506 zeroes each basis), so the origin check the
 * caller runs first (checkRecall) already reports the revert the contract would
 * actually raise.
 *
 * REUSE (auditoría 2026-08-18): this function used to live in
 * CouncilProposalService.ts with its own literal copy of the retired /
 * not-ready branches, under a comment saying it only lived there because that
 * round did not own this file. It now sits beside checkDirectTo/checkRecall,
 * where it belongs, and the CONDITION comes from the one gate both doors share
 * — while the rescue prose, which is the sentence the council needs, is kept
 * intact by the `'rescue'` door.
 */
export function checkMoveDestination(
  state: LegacyVaultState,
  toId: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): DirectToVerdict {
  const gate = checkVenueAcceptsEntry(state, toId, nowSec, 'rescue');
  return gate.ok ? { ok: true } : gate;
}

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Would `setPayees(accounts, bps, ref)` land — and land SAFELY? (E6, 2026-08-15)
 *
 * Two kinds of refusal live here, and they are named apart on purpose:
 *
 *  - CONTRACT MIRRORS — the order would REVERT after the quorum has signed and
 *    the FDC round has been paid for: Σbps ≠ 10000 on a non-empty list
 *    (PayeeBpsSumInvalid), the zero address (ZeroAddress), a zero share
 *    (BpsOutOfBounds).
 *  - TRAP PREVENTION — the order would LAND and strand the money: the bridge
 *    or the vault itself as a payee. `_splitYield` transfers the asset to that
 *    address and neither contract can ever move tokens out (revision 1-ago §5
 *    danger #1: "jamás el bridge como payee"). This is the ONE place this
 *    pre-flight is deliberately stricter than the contract, because the
 *    failure is permanent — not a wasted ceremony, a buried inheritance.
 *
 * An EMPTY list is legal and composes: that is the endowment decision —
 * everything keeps capitalizing into the principal. Duplicated addresses are
 * NOT refused here (the contract accepts them and simply splits twice); the
 * form warns about them client-side, where intent can still be corrected.
 */
export function checkSetPayees(
  stack: { vault: string; bridge: string },
  payeesRaw: unknown,
): DirectToVerdict {
  if (!Array.isArray(payeesRaw)) {
    return { ok: false, code: 'PAYEE_INVALID', reason: 'payees must be an array of { account, bps }.' };
  }
  if (payeesRaw.length === 0) return { ok: true }; // endowment: everything capitalizes
  const vault = stack.vault.toLowerCase();
  const bridge = stack.bridge.toLowerCase();
  let sum = 0;
  for (const [i, raw] of payeesRaw.entries()) {
    const row = raw as { account?: unknown; bps?: unknown };
    const account = String(row.account ?? '');
    const bps = Number(row.bps);
    if (!EVM_ADDRESS_RE.test(account)) {
      return {
        ok: false,
        code: 'PAYEE_INVALID',
        reason: `Payee #${i + 1} is not a Flare address (0x…40 hex) — a malformed address never reaches the vault.`,
      };
    }
    if (account.toLowerCase() === ZERO_ADDRESS) {
      return { ok: false, code: 'PAYEE_ZERO_ADDRESS', reason: `Payee #${i + 1} is the zero address — the vault refuses it.` };
    }
    if (!Number.isInteger(bps) || bps <= 0 || bps > 10_000) {
      return {
        ok: false,
        code: 'PAYEE_ZERO_BPS',
        reason: `Payee #${i + 1} has a share of ${String(row.bps)} bps — each share must be a whole number between 1 and 10000.`,
      };
    }
    if (account.toLowerCase() === bridge) {
      return {
        ok: false,
        code: 'PAYEE_TRAPS_FUNDS',
        reason: `Payee #${i + 1} is this Legacy's own bridge. The bridge cannot move tokens: every share sent there would be trapped for ever. Name a person's wallet instead.`,
      };
    }
    if (account.toLowerCase() === vault) {
      return {
        ok: false,
        code: 'PAYEE_TRAPS_FUNDS',
        reason: `Payee #${i + 1} is the vault itself. Yield paid to the vault's own address becomes stray assets nobody can claim. Name a person's wallet instead.`,
      };
    }
    sum += bps;
  }
  if (sum !== 10_000) {
    return {
      ok: false,
      code: 'PAYEE_BPS_SUM_INVALID',
      reason: `The shares add up to ${(sum / 100).toFixed(2)}% and the vault only accepts exactly 100.00% — the order would revert after the whole ceremony.`,
    };
  }
  return { ok: true };
}

/** One unsigned EVM call. Astryum composes; the funder's wallet signs (#1). */
export interface UnsignedEvmCall {
  to: string;
  data: string;
  value: string;
  /** What this call does, in one sentence, for the review screen (#6). */
  summary: string;
}

export interface VaultDepositPlan {
  chain: string;
  vault: string;
  asset: { address: string; symbol: string; decimals: number };
  amount: string;
  amountHuman: string;
  calls: UnsignedEvmCall[];
  disclosure: {
    disclosedToUser: true;
    astryumSigns: false;
    note: string;
    facts: Record<string, string | number | boolean>;
  };
}

const ERC20_APPROVE_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];
const VAULT_DEPOSIT_ABI = ['function deposit(uint256 amount)'];

/**
 * Compose the UNSIGNED calls that fund the cage: approve, then deposit.
 *
 * `deposit()` is permissionless — any holder of the asset may add principal —
 * so this needs no council order and no quorum. What it DOES need is for the
 * funder to understand what they are doing, because it is close to
 * irreversible by design: deposited capital becomes PRINCIPAL, and the vault
 * has no function that returns principal to an address. It can only move
 * between whitelisted venues, or — after a 30-day delay and a doubly-verified
 * continuity check — to a successor vault. That is the cage working as
 * intended, and it is exactly the kind of fact that must be loud BEFORE a
 * signature, not discovered afterwards (#6).
 *
 * Pure: no RPC. Takes the state the caller already read.
 */
export function buildVaultDepositCalls(
  state: LegacyVaultState,
  amount: bigint,
): VaultDepositPlan {
  if (state.migrated) throw new Error('this vault has migrated to a successor — it accepts no new principal');
  if (amount <= 0n) throw new Error('amount must be greater than zero');

  const erc20 = new ethers.Interface(ERC20_APPROVE_ABI);
  const vault = new ethers.Interface(VAULT_DEPOSIT_ABI);
  const human = formatBaseUnits(amount, state.asset.decimals);

  return {
    chain: state.chain,
    vault: state.vault,
    asset: state.asset,
    amount: amount.toString(),
    amountHuman: human,
    calls: [
      {
        to: state.asset.address,
        data: erc20.encodeFunctionData('approve', [state.vault, amount]),
        value: '0',
        summary: `Allow the vault to take ${human} ${state.asset.symbol} from your wallet`,
      },
      {
        to: state.vault,
        data: vault.encodeFunctionData('deposit', [amount]),
        value: '0',
        summary: `Deposit ${human} ${state.asset.symbol} into the vault as principal`,
      },
    ],
    disclosure: {
      disclosedToUser: true,
      astryumSigns: false,
      note:
        `This adds ${human} ${state.asset.symbol} to the vault as PRINCIPAL. Principal cannot be withdrawn to any address — ` +
        'the vault has no such function. It can only be put to work in the council\'s whitelisted venues and recalled back ' +
        'into the vault, or migrated to a successor vault after a 30-day delay and a verified continuity check. ' +
        'Anyone may add principal; nobody can take it out. Do not fund this with capital you may need back.',
      facts: {
        amount: human,
        asset: state.asset.symbol,
        vault: state.vault,
        network: state.chain,
        principalIsWithdrawable: false,
        needsCouncilQuorum: false,
        astryumSigns: false,
      },
    },
  };
}

/** The network alone — no deployed stack, no order anchor: a read needs neither. */
function readNetworkConfig(): LegacyNetwork {
  const chain = (process.env.LEGACY_CHAIN || 'flare') as 'coston2' | 'flare';
  const net = LEGACY_NETWORKS[chain];
  if (!net) throw new Error(`LEGACY_CHAIN must be coston2|flare, got "${chain}"`);
  return net;
}

/**
 * Read the whole cage in one shot. Venue rows are read in parallel; a venue
 * whose `venueValue()` reverts (a protocol that broke underneath us) reports
 * its value as its basis rather than taking the whole page down — the council
 * still needs to see the venue exists in order to evacuate it.
 */
export async function readVaultState(overrideVault?: string): Promise<LegacyVaultState> {
  // Reading a cage needs TWO things: which network, and which address. It used
  // to demand the whole configured stack even when handed the vault — so a
  // missing LEGACY_VAULT_ADDRESS made a factory-born cage (whose address the
  // resolver had just proven) unreadable, and the portfolio scan swallowed that
  // as "this Legacy has no cage" (2026-08-22). Without an override the env
  // stack is still the only place the address can come from, so it is still
  // required there — and its error message is still the readable one.
  let cfg: LegacyNetwork;
  let vaultAddress: string;
  if (overrideVault) {
    cfg = readNetworkConfig();
    vaultAddress = overrideVault;
  } else {
    const stack: LegacyStackConfig = legacyStackConfig();
    cfg = stack;
    vaultAddress = stack.vault;
  }
  if (!ethers.isAddress(vaultAddress)) throw new Error('vault address is not a valid EVM address');

  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const vault = new ethers.Contract(vaultAddress, VAULT_STATE_ABI, provider);

  const [assetAddress, council, venueCountRaw, totalPrincipal, allocatedPrincipal, idlePrincipal, totalValue, maxVenueBps, migrated, totalClaimable] =
    await Promise.all([
      vault.asset() as Promise<string>,
      vault.council() as Promise<string>,
      vault.venueCount() as Promise<bigint>,
      vault.totalPrincipal() as Promise<bigint>,
      vault.allocatedPrincipal() as Promise<bigint>,
      vault.idlePrincipal() as Promise<bigint>,
      vault.totalValue() as Promise<bigint>,
      vault.maxVenueBps() as Promise<bigint>,
      vault.migrated() as Promise<boolean>,
      (vault.totalClaimable() as Promise<bigint>).catch(() => 0n),
    ]);

  const erc20 = new ethers.Contract(assetAddress, ERC20_META_ABI, provider);
  const [symbol, decimals, assetBalance] = await Promise.all([
    (erc20.symbol() as Promise<string>).catch(() => '???'),
    (erc20.decimals() as Promise<bigint>).then((d) => Number(d)).catch(() => 18),
    (erc20.balanceOf(vaultAddress) as Promise<bigint>).catch(() => 0n),
  ]);

  const count = Number(venueCountRaw);
  const venues: LegacyVenueRow[] = await Promise.all(
    Array.from({ length: count }, async (_, id): Promise<LegacyVenueRow> => {
      const [row, basis] = await Promise.all([
        vault.venues(id) as Promise<[string, bigint, bigint, boolean]>,
        vault.venueBasis(id) as Promise<bigint>,
      ]);
      const value = await (vault.venueValue(id) as Promise<bigint>).catch(() => basis);
      // Ask the PROTOCOL what it holds for us, rather than trusting the vault's
      // own ledger. Both numbers agreeing is the check that matters.
      const venueC = new ethers.Contract(
        row[0],
        ['function symbol() view returns (string)', 'function balanceOf(address) view returns (uint256)'],
        provider,
      );
      const [targetSymbol, shares] = await Promise.all([
        (venueC.symbol() as Promise<string>).catch(() => null),
        (venueC.balanceOf(vaultAddress) as Promise<bigint>).then((s) => s.toString()).catch(() => null),
      ]);
      return {
        id,
        target: row[0],
        targetSymbol,
        shares,
        kind: decodeVenueKind(row[1]),
        readyAt: Number(row[2]),
        retired: row[3],
        basis: basis.toString(),
        value: value.toString(),
      };
    }),
  );

  return {
    vault: vaultAddress,
    chain: cfg.chain,
    council,
    asset: { address: assetAddress, symbol, decimals },
    totalPrincipal: totalPrincipal.toString(),
    allocatedPrincipal: allocatedPrincipal.toString(),
    idlePrincipal: idlePrincipal.toString(),
    totalValue: totalValue.toString(),
    maxVenueBps: Number(maxVenueBps),
    migrated,
    venues,
    totalClaimable: totalClaimable.toString(),
    strayAssets: computeStrayAssets(assetBalance, idlePrincipal, totalClaimable).toString(),
  };
}
