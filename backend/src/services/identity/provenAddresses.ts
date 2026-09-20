/**
 * provenAddresses — the addresses a session has PROVEN it controls.
 *
 * Two sources, and only two:
 *   1. the session's own wallet address — the login itself was a signature
 *      (SIWE / Xaman SignIn), so `req.siwe.walletAddress` is proof;
 *   2. active `WalletBinding` rows with a non-empty `signatureProof` — the user
 *      signed a binding challenge for that address.
 *
 * What is deliberately NOT here: the plain `wallet` table. `POST
 * /api/wallets/connect` writes any address without a signature, so a row there
 * says "this user typed this address", never "this user controls it". A
 * permission that only a key-holder should get must not be granted off it.
 *
 * Comparison: EVM addresses are case-insensitive (checksum casing is cosmetic);
 * XRPL classic addresses (and every other base58 form) are compared exactly —
 * their case IS the address.
 *
 * «NO PUDE LEER» IS NEITHER PERMISSION NOR PUNISHMENT (productizer it. 18, 3.1).
 * A transient read failure used to come out of here as a plain empty list, which
 * downstream reads as «this session proved nothing» — and that closed EXITS: the
 * user could not free or displace THEIR OWN 0xFE seat, nor sign `pote-exit` /
 * `pa-unmint`. The list now travels with a verdict about the store itself
 * (`provenAddressesDetailed`), and `proveAddress` turns that verdict into the
 * answer each kind of route must give: an ENTRY stays fail-closed, an EXIT is
 * answered 503 «try again» — never a silent no.
 */

import { readTakeoverFloorStrict } from './credentialsEpoch';

/**
 * The synthetic user `requireSiweAuth` invents under `ALLOW_NO_AUTH=1`.
 *
 * Deliberately duplicated from `liveSession.isDevBypassUserId` (which is the
 * canonical one, and a test holds the two in step): this module is imported by
 * pure, database-less unit suites and must keep its ONLY runtime dependency the
 * dynamic `import('../../database/prismaClient')` inside the try block.
 *
 * Hard-gated on `NODE_ENV !== 'production'` AND the bypass flag, exactly like
 * the middleware: in production this is always false, whatever the id says.
 */
function isDevBypassSession(userId: string): boolean {
  return process.env.ALLOW_NO_AUTH === '1' && process.env.NODE_ENV !== 'production' && userId === 'dev-user';
}

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isEvmAddress(a: string): boolean {
  return EVM_ADDRESS_RE.test(a);
}

/**
 * Casing an address may be STORED with when it is put in a session claim.
 *
 * EVM addresses are lowercased (checksum casing is cosmetic and lowercase is how
 * the rest of the schema stores them). EVERY OTHER FORM IS LEFT ALONE: an XRPL
 * classic address is base58 and its case IS the address, so lowercasing it does
 * not normalise it — it destroys it, and the destroyed string can never match a
 * real r-address again (productizer it. 18, 3.1: `issueSessionForUser` did this,
 * which is why «the wallet you signed in with always survives» was false for
 * every session it minted).
 */
export function sessionAddressClaim(address: string | null | undefined): string {
  const raw = typeof address === 'string' ? address.trim() : '';
  return isEvmAddress(raw) ? raw.toLowerCase() : raw;
}

/** Same address? EVM lowercase compare, everything else exact. */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (isEvmAddress(a) && isEvmAddress(b)) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/** Is `address` in `list`, under the same comparison rules? */
export function includesAddress(list: readonly string[], address: string | null | undefined): boolean {
  if (!address) return false;
  return list.some((entry) => sameAddress(entry, address));
}

/**
 * The session address plus every active, signature-backed binding of `userId`.
 * Without a database only the session address is known. A failed read is NOT
 * widened into anything: it degrades to the session address alone.
 *
 * @deprecated ⚠ AMBIGUOUS BY CONSTRUCTION, AND DEPRECATED (productizer it. 20,
 * 2.1/2.2). An empty (or short) list here cannot be told apart from «I could not
 * read the store», and a caller that treats the two the same closes an exit on a
 * transient failure (it. 18, 3.1). Ask the VERDICT instead:
 *   · one address  → `proveAddress(userId, sessionAddr, address, purpose)`
 *   · a membership → `proveMembership(userId, sessionAddr, members, purpose)`
 * Kept EXPORTED AND INERT (invariant: nothing built is deleted) for the callers
 * that still read it, all of which only ever WIDEN on proof and fail closed:
 *   · `routes/councilProposals.ts` → `ownedSignerAddresses` — THE ONE THAT MUST
 *     MIGRATE (it. 20, 2.1: with the database down it answers 403 «none of your
 *     addresses is in this list», which is a lie, over the only bytes a
 *     cosignatory can sign). Agent C's contract is `proveMembership` below;
 *   · `routes/xamanPushTokens.ts` → `mayPushTo` (deciding whether to PUSH a
 *     payload: refusing costs nobody a right, so fail-closed is the whole answer);
 *   · `services/flare/ComposedCouncilOrderStore.ts` → the SignerList fallback,
 *     which already throws its own read failure out to a `fallback(...)` verdict.
 * No new caller. A route that takes a right away must ask something that can say
 * «I could not read» out loud.
 *
 * THE TAKEOVER FLOOR IS READ STRICTLY (productizer it. 16, 4.3). This list
 * decides who displaces a 0xFE seat and who controls a council, so a `security`
 * block we cannot parse must never come out as «there was no takeover» — that is
 * «could not read» granting permission, exactly what the cage acknowledgement
 * and the legal click-wrap already refuse (readTakeoverAtStrict).
 *
 * What we do when the mark is unreadable (or the user row is missing): drop
 * EVERY binding and return the session address alone. Two reasons for not
 * refusing the caller outright:
 *   · the session address is not dated by the takeover — it is the signature of
 *     THIS login, and a takeover kills every earlier session, so whoever holds a
 *     live session signed for that address after the handover;
 *   · an exit is never gated (invariant: «la salida jamás se gatea»). A corrupt
 *     preferences blob must cost the user their extra bindings, never their own
 *     way out with the wallet they are signed in with.
 *
 * THAT SECOND REASON IS ONLY TRUE IF THE CLAIM SURVIVED THE MINTING (it. 18).
 * A Xaman login writes `addr: xrplAddress` untouched (SiweAuth `signInWithXaman`)
 * and does survive; `issueSessionForUser` used to lowercase every address, so an
 * r-address minted through it could never match one again. That is fixed at the
 * source (`sessionAddressClaim`) — the mitigation above only holds because of it,
 * and it must not be un-fixed.
 *
 * A caller that needs more than "could not read = no bindings" must use
 * `provenAddressesDetailed` (which says whether the store was readable, and why
 * not) or `proveAddress` (which turns that into the answer a route owes).
 */
export async function provenAddressesOf(
  userId: string | null | undefined,
  sessionWalletAddress: string | null | undefined,
): Promise<string[]> {
  return (await provenAddressesDetailed(userId, sessionWalletAddress)).addresses;
}

/** Why the proof store could not be read. `null` when it was read fine. */
export type ProofStoreFailure =
  /** No `User` row for this id — we cannot date the bindings, so none count. */
  | 'no-user-row'
  /** `preferences.security` did not parse: the takeover floor is unknown. */
  | 'unreadable-floor'
  /**
   * The mark PARSED and sits ahead of this server's clock (productizer it. 29,
   * 1.1). Named apart from `unreadable-floor` because it is not the same fact
   * and does not get the same answer: the row is legible, and the wall clock
   * passing the mark makes it usable again with nothing written — so this one
   * is the only unusable floor that a retry can honestly clear.
   *
   * WHY IT IS NOT JUST `unreadable-floor`. Before it. 29 a future mark was not
   * a failure at all: `readTakeoverAtStrict` said «readable», `floorReadable`
   * was set to true — a FALSE statement, the floor was read and is unusable —
   * and the `linked < takeoverAt` filter below then dropped every binding,
   * always. The exit of an email/Google user (whose only proof IS a binding)
   * came out as 403 `ADDRESS_NOT_PROVEN` with two remedies that cannot work:
   * signing in with a wallet they do not have, and re-linking, which stamps
   * `linkedAt = now` — still below the mark. A closed exit and an infinite loop.
   */
  | 'floor-ahead-of-clock'
  /** The query itself threw (database down, pool exhausted, timeout). */
  | 'read-failed';

/** What the takeover floor said while the list was being built. */
export interface ProvenAddressesResult {
  addresses: string[];
  /**
   * false when the takeover mark, the user row or the bindings query could not
   * be read, so every binding was dropped and only the session address survives.
   * A caller that wants to refuse instead of degrade has the flag to do it with.
   *
   * NOTE the asymmetry: `true` with an empty list is a real «this session proved
   * nothing»; `false` is «I do not know», and the two must never be answered the
   * same way on a path that takes a right away.
   */
  floorReadable: boolean;
  /** Set exactly when `floorReadable` is false — for logs and for the 503 body. */
  failure: ProofStoreFailure | null;
}

export async function provenAddressesDetailed(
  userId: string | null | undefined,
  sessionWalletAddress: string | null | undefined,
): Promise<ProvenAddressesResult> {
  const out: string[] = [];
  const push = (address: string | null | undefined) => {
    const trimmed = typeof address === 'string' ? address.trim() : '';
    if (trimmed && !includesAddress(out, trimmed)) out.push(trimmed);
  };
  push(sessionWalletAddress);

  // No user / no database is not a failed read: there is nothing to read. The
  // session address is all there ever was, and saying so is the truth.
  //
  // THE DEV BYPASS BELONGS IN THAT SAME SENTENCE (productizer it. 23, 2.5).
  // `requireSiweAuth` under ALLOW_NO_AUTH=1 invents the user `dev-user`, for
  // which no `User` row exists or ever will. Read literally that is «no user
  // row» → the NON-RETRYABLE 409 `ACCOUNT_RECORD_MISSING`, sitting on top of
  // every exit in local development and in every test that flips the flag. It is
  // not a failed read and it is not a missing record: it is an account with no
  // bindings, by construction. `floorReadable: true` says exactly that, and it
  // widens nothing — the session address is still the only thing in the list.
  if (!userId || !process.env.DATABASE_URL || isDevBypassSession(userId)) {
    return { addresses: out, floorReadable: true, failure: null };
  }
  let floorReadable = false;
  try {
    const { prisma } = await import('../../database/prismaClient');
    const [firstRead, bindings] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } }),
      prisma.walletBinding.findMany({
        where: { userId, isActive: true },
        select: { address: true, signatureProof: true, linkedAt: true },
      }),
    ]);
    // Account taken over from an unverified password holder: what was bound
    // before the handover was signed by THEM. A fresh re-bind re-dates linkedAt.
    // STRICT (it. 16, 4.3): no user row, or a `security` block that does not
    // parse, is «I could not read the floor» — never «there is no floor».
    //
    // AND «ABSENT» IS CONFIRMED BEFORE IT IS BELIEVED (it. 23, 2.5). Since it. 21
    // this answer is a 409 with `retryable: false`, so a FALSE absence is worse
    // than the 503 it replaced: it tells a person with a live session that their
    // account is gone and that waiting will not help. A single `findUnique` can
    // come back empty for reasons that are not «deleted» — a lagging read
    // replica, a row created inside a transaction that has not committed yet.
    // So we ask a SECOND time, in its own statement (READ COMMITTED takes a fresh
    // snapshot per statement, and a replica gets another chance to catch up). If
    // the row is there the second time, we use it and nothing is refused; if that
    // second read THROWS, it falls into the catch below and comes out as
    // 'read-failed' — the retryable 503 — because an absence we could not confirm
    // is weather, not a fact.
    let user = firstRead;
    if (!user) {
      user = await prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } });
      if (user) {
        console.warn(
          `[proven-addresses] user row for ${userId} was invisible on the first read and present on the second ` +
            '(replica lag or an uncommitted transaction): NOT refused',
        );
      }
    }
    if (!user) {
      console.error(
        `[proven-addresses] no user row for ${userId} on two independent reads: bindings dropped, session ` +
          'address only',
      );
      return { addresses: out, floorReadable: false, failure: 'no-user-row' };
    }
    // STRICT ON BOTH HALVES OF THE QUESTION (it. 29, 1.1). Legibility was never
    // the whole of it: what happens below is `linkedAt >= takeoverAt`, and a
    // mark in the FUTURE loses that comparison for every binding that can ever
    // be written. `readTakeoverFloorStrict` asks both questions at once and is
    // shared with the legal gate and the cage acknowledgement, so the rule
    // cannot drift per reader again.
    const takeover = readTakeoverFloorStrict(user.preferences);
    if (!takeover.readable) {
      const why = takeover.why === 'ahead-of-clock' ? 'takeover mark ahead of our clock' : 'unreadable takeover mark';
      console.error(`[proven-addresses] ${why} for ${userId}: bindings dropped, session address only`);
      return {
        addresses: out,
        floorReadable: false,
        failure: takeover.why === 'ahead-of-clock' ? 'floor-ahead-of-clock' : 'unreadable-floor',
      };
    }
    floorReadable = true;
    const takeoverAt = takeover.at;
    for (const b of bindings) {
      if (!(typeof b.signatureProof === 'string' && b.signatureProof.trim().length > 0)) continue;
      if (takeoverAt) {
        const linked = b.linkedAt ? new Date(b.linkedAt as unknown as string | Date).getTime() : NaN;
        if (!Number.isFinite(linked) || linked < takeoverAt.getTime()) continue;
      }
      push(b.address);
    }
  } catch (e) {
    console.error(`[proven-addresses] binding read failed for ${userId}: ${(e as Error).message}`);
    return { addresses: out, floorReadable: false, failure: 'read-failed' };
  }
  return { addresses: out, floorReadable, failure: null };
}

// ── proveAddress — the verdict a ROUTE owes, not just the list ───────────────
//
// productizer it. 18, 3.1. Two kinds of route ask «did this session prove this
// address?», and they must answer an unreadable store differently:
//
//   ENTRY / authority — composing a new 0xFE, taking a seat, writing a binding,
//     acting on a council. Refusing costs the user nothing they already had, so
//     «I could not read» stays FAIL-CLOSED: no, and it stays no.
//
//   EXIT — freeing or displacing THEIR OWN seat, `pote-exit`, `pa-unmint`, any
//     path whose whole purpose is getting capital back out. Refusing here TAKES
//     A RIGHT AWAY, and a transient database failure must never be the thing
//     that takes it. So the answer is never a silent no: either the session's
//     own login address already proves it (that claim needs no store at all),
//     or the route answers 503 «try again» and the user keeps the right.
//
// The invariant in one line: «no pude leer» jamás es permiso NI castigo sobre
// una salida.

export type ProofPurpose = 'entry' | 'exit';

/**
 * The refusal envelope a route sends verbatim. `status` is already chosen.
 *
 * WHICH ANSWER GOES WITH WHICH CAUSE (productizer it. 20, 2.4). «No pude leer»
 * is not ONE thing, and only one of its causes heals by waiting:
 *   · 403 `ADDRESS_NOT_PROVEN` — the store was read and does not hold that
 *     address (or an ENTRY asked while the query was failing: fail-closed).
 *   · 503 `PROOF_STORE_UNREADABLE` — the QUERY itself failed (database down,
 *     pool exhausted, timeout). Transient: `retryable` is true and the sentence
 *     may honestly say «try again in a moment».
 *   · 503 `PROOF_FLOOR_AHEAD_OF_CLOCK` — the takeover mark PARSED and is dated
 *     ahead of this server's clock, so it cannot be used as a floor (it. 29).
 *     Retryable, because the clock moves and nothing has to be written for it to
 *     become usable — but it never offers re-linking, which for this row is the
 *     one remedy that provably cannot work.
 *   · 409 `ACCOUNT_RECORD_MISSING` / `PROOF_FLOOR_UNREADABLE` — DETERMINISTIC:
 *     the user row is gone, or its `security` block does not parse. Retrying
 *     changes nothing, so the 503 that used to come out of here was a promise we
 *     could not keep — a permanent «try again in a moment» sitting on top of an
 *     email/Google user's exit, whose only proof is a binding. These say what the
 *     state IS and what can be done about it by the person (sign in with that
 *     wallet — a signed-in wallet proves itself and needs no stored record) or by
 *     an admin (restore the user row / repair `preferences.security`). 409, not
 *     403: the request is fine, the stored account record conflicts with it.
 *
 * `retryable` is the field a caller should branch on, NOT `status`: it is true
 * for exactly one code and it is what tells a screen whether to offer a retry.
 */
export interface ProofRefusal {
  status: 403 | 409 | 503;
  error:
    | 'ADDRESS_NOT_PROVEN'
    | 'PROOF_STORE_UNREADABLE'
    | 'ACCOUNT_RECORD_MISSING'
    | 'PROOF_FLOOR_UNREADABLE'
    | 'PROOF_FLOOR_AHEAD_OF_CLOCK';
  detail: string;
  /**
   * true for the two refusals a retry can honestly clear: `PROOF_STORE_UNREADABLE`
   * (the query failed) and `PROOF_FLOOR_AHEAD_OF_CLOCK` (the mark is dated ahead
   * of our clock, and the clock moves). Never true on a verdict.
   */
  retryable: boolean;
  /**
   * A SHORT line a card or banner can use as its heading — never the code
   * (productizer it. 22, 2.5 / 3.7: a screen that has no reader for a code falls
   * back to «The server refused this operation», and one that improvises prints
   * the raw code at the user).
   *
   * OPTIONAL IN THE TYPE, ALWAYS SET IN PRACTICE: every refusal this module
   * builds carries it (there is a test for that). It is optional only so the
   * hand-written doubles in other suites keep compiling.
   */
  headline?: string;
  /**
   * The REAL ways forward, one sentence each, in the order to offer them. Never
   * a promise: a non-retryable refusal never lists «wait and try again» here.
   * A reader may render them as bullets or buttons; the prose in `detail` says
   * the same thing in one paragraph for a surface that only has room for one.
   */
  ways?: string[];
  /** Set only on the retryable 503, so a reader need not parse `Retry-After`. */
  retryAfterSeconds?: number;
}

/**
 * Is this failure one that WAITING cannot fix? `no-user-row` and
 * `unreadable-floor` are properties of the stored row, not of the moment; only a
 * failed query (`read-failed`) is weather.
 */
export function isDeterministicProofFailure(failure: ProofStoreFailure | null): boolean {
  return failure === 'no-user-row' || failure === 'unreadable-floor';
}

/**
 * `'floor-ahead-of-clock'` is deliberately NOT in the list above (it. 29). It is
 * a property of the stored row, like the other two — but unlike them it stops
 * being true on its own, at a known instant: when the wall clock passes the
 * mark. Saying «try again» about it is therefore not a promise we cannot keep,
 * and saying «this will not fix itself by waiting» would be the false half of
 * `PROOF_FLOOR_UNREADABLE`'s sentence. What it borrows from that sentence is the
 * true half, the one that matters to the person who meets it: RE-LINKING THE
 * WALLET WILL NOT HELP — a fresh binding is stamped `linkedAt = now`, which is
 * still below the mark.
 */

export interface AddressProofVerdict {
  /** The only field a caller needs to let the action through. */
  proven: boolean;
  /** false when the proof store could not be read (see `failure`). */
  storeReadable: boolean;
  failure: ProofStoreFailure | null;
  /** The list that was consulted, for callers that need to log or widen. */
  addresses: string[];
  /** null exactly when `proven` is true; otherwise the answer to send. */
  refusal: ProofRefusal | null;
}

const NOT_PROVEN_DETAIL =
  'This session has not proven control of that address. Sign in with that wallet, or link it by signing the ' +
  'binding challenge, and try again.';

const STORE_UNREADABLE_DETAIL =
  'We could not read your wallet proofs just now, so we will not answer for them either way — and we will not ' +
  'take this away from you because of it. Nothing was composed and nothing moved. Try again in a moment; if it ' +
  'keeps failing, sign in again with the wallet that controls this account.';

const ACCOUNT_RECORD_MISSING_DETAIL =
  'We could not find the account record behind this session, so the wallets linked to it cannot be dated or ' +
  'trusted, and we will not guess. This will not fix itself by waiting. Nothing was composed and nothing moved. ' +
  'Sign in with the wallet that controls this address — a signed-in wallet proves itself and needs no stored ' +
  'record — or write to us: an administrator can see whether this account record was removed and restore it.';

const PROOF_FLOOR_UNREADABLE_DETAIL =
  "This account's security record cannot be read, so we cannot tell which of your linked wallets were added " +
  'before the account last changed hands. We will not guess: guessing could hand the account back to a previous ' +
  'holder. Linked wallets stay out until it is repaired, and re-linking one will not help either. This will not ' +
  'fix itself by waiting, and nothing was composed and nothing moved. Sign in with the wallet that controls this ' +
  'address — a signed-in wallet proves itself and needs no stored record — or write to us: an administrator can ' +
  'repair the security record.';

/**
 * THE MARK IS LEGIBLE, DATED IN THE FUTURE, AND THEREFORE NOT A FLOOR (it. 29).
 *
 * Every true thing this person can act on, and nothing else. It does NOT say
 * «this cannot be read» (it was read), it does NOT say «waiting will not help»
 * (waiting is exactly what makes it usable again, at a known instant), and above
 * all it does NOT offer the re-link, which is the remedy `ADDRESS_NOT_PROVEN`
 * was offering over this very row while the exit stayed shut.
 */
const FLOOR_AHEAD_OF_CLOCK_DETAIL =
  "This account's security record is dated later than our own clock, so we cannot yet tell which of your linked " +
  'wallets were added before the account last changed hands. We will not guess: guessing could hand the account ' +
  'back to a previous holder. Linked wallets stay out until our clock passes that date, and re-linking one will ' +
  'not help — a fresh link is dated now, which is still earlier. Nothing was composed and nothing moved. Try ' +
  'again later; sign in with the wallet that controls this address, which proves itself and needs no stored ' +
  'record; or write to us, and an administrator can check that date.';

/**
 * THE FIVE REFUSALS, BUILT IN ONE PLACE (productizer it. 22, 2.5; it. 29).
 *
 * The 409s reached screens that had no reader for them and degraded to «The
 * server refused this operation», throwing away the only prose that named a way
 * forward. So each refusal now carries, besides the code and the paragraph:
 *   · `headline` — the short line a card or banner puts at the top;
 *   · `ways` — the real ways forward, one sentence each, in order. A
 *     non-retryable refusal NEVER lists waiting among them;
 *   · `retryAfterSeconds` — only on the one refusal that heals by waiting.
 *
 * The English is the contract: agents D and F render these verbatim.
 */
const SIGN_IN_WITH_THAT_WALLET_WAY =
  'Sign in with the wallet that controls this address — a signed-in wallet proves itself and needs no stored record.';

export const PROOF_REFUSALS: Record<ProofRefusal['error'], ProofRefusal> = {
  ADDRESS_NOT_PROVEN: {
    status: 403,
    error: 'ADDRESS_NOT_PROVEN',
    detail: NOT_PROVEN_DETAIL,
    retryable: false,
    headline: 'This session has not proven that wallet',
    ways: [
      'Sign in with that wallet — the login itself is the signature.',
      'Or link it to this account by signing the binding challenge, then repeat this action.',
    ],
  },
  PROOF_STORE_UNREADABLE: {
    status: 503,
    error: 'PROOF_STORE_UNREADABLE',
    detail: STORE_UNREADABLE_DETAIL,
    retryable: true,
    retryAfterSeconds: 3,
    headline: 'We could not read your wallet proofs just now',
    ways: [
      'Try again in a moment — this one really does clear on its own.',
      'If it keeps failing, sign in again with the wallet that controls this account.',
    ],
  },
  ACCOUNT_RECORD_MISSING: {
    status: 409,
    error: 'ACCOUNT_RECORD_MISSING',
    detail: ACCOUNT_RECORD_MISSING_DETAIL,
    retryable: false,
    headline: 'The account record behind this session is missing',
    ways: [
      SIGN_IN_WITH_THAT_WALLET_WAY,
      'Or write to us: an administrator can see whether this account record was removed and restore it.',
    ],
  },
  PROOF_FLOOR_AHEAD_OF_CLOCK: {
    status: 503,
    error: 'PROOF_FLOOR_AHEAD_OF_CLOCK',
    detail: FLOOR_AHEAD_OF_CLOCK_DETAIL,
    retryable: true,
    // No `retryAfterSeconds`: we know the instant the mark becomes usable, but
    // not whether it is three seconds of clock skew or a corrupt date in 2099,
    // and a countdown to the wrong one of those is the promise this module
    // exists not to make. «Try again» without a number is the honest offer.
    headline: "This account's security record is dated in the future",
    ways: [
      'Try again later — this one clears on its own once our clock passes that date.',
      SIGN_IN_WITH_THAT_WALLET_WAY,
      'Or write to us: an administrator can check that date. Re-linking the wallet will not help — a fresh link is dated now, which is still earlier.',
    ],
  },
  PROOF_FLOOR_UNREADABLE: {
    status: 409,
    error: 'PROOF_FLOOR_UNREADABLE',
    detail: PROOF_FLOOR_UNREADABLE_DETAIL,
    retryable: false,
    headline: "This account's security record cannot be read",
    ways: [
      SIGN_IN_WITH_THAT_WALLET_WAY,
      'Or write to us: an administrator can repair the security record. Re-linking the wallet will not help.',
    ],
  },
};

/** A fresh copy, so a caller that adds a field cannot mutate the shared one. */
export function proofRefusal(error: ProofRefusal['error']): ProofRefusal {
  const base = PROOF_REFUSALS[error];
  return { ...base, ways: [...(base.ways ?? [])] };
}

/**
 * The answer a route owes when the proof store could not be read, by CAUSE and
 * by purpose. Total and pure, so a caller cannot forget a case.
 *
 * WHY THE DETERMINISTIC CAUSES ANSWER THE SAME ON BOTH PATHS: 409 with
 * `retryable: false` grants nothing (an ENTRY stays exactly as fail-closed as it
 * was) and takes nothing away that the truthful 403 would not have taken — it
 * only stops the sentence from promising a retry that can never work, and names
 * the one door still open to the person (sign in with that wallet) and the one an
 * admin can open (restore the row / repair the block).
 *
 * WHAT WE DELIBERATELY DO NOT DO: repair, or ignore, an unparseable `security`
 * block. Both would RESURRECT A PRE-TAKEOVER BINDING — «ignore it» reads the
 * floor as «there was no takeover» and lets every binding through, and «repair
 * it» has to invent a `takeoverAt`, which in practice means writing none at all:
 * the same resurrection with a commit behind it. So the bindings are dropped and
 * NOTHING IS WRITTEN (`provenAddressesDetailed` only reads). The session's own
 * login address still survives, because a takeover kills every earlier session:
 * whoever holds a live session signed for that address after the handover. The
 * corrupt row stays corrupt, and loudly logged, until an admin repairs it.
 */
export function refusalForUnreadableStore(failure: ProofStoreFailure | null, purpose: ProofPurpose): ProofRefusal {
  if (failure === 'no-user-row') return proofRefusal('ACCOUNT_RECORD_MISSING');
  if (failure === 'unreadable-floor') return proofRefusal('PROOF_FLOOR_UNREADABLE');
  // A MARK DATED AHEAD OF OUR CLOCK ANSWERS THE SAME ON BOTH PATHS (it. 29), and
  // for the same reason the deterministic causes do: it is a refusal either way,
  // so an ENTRY stays exactly as fail-closed as it was, and the only thing that
  // changes is that the sentence stops being false. What it must never be is the
  // 403 this case used to reach — «you have not proven that wallet», under two
  // remedies that provably cannot work for this row, over an EXIT.
  if (failure === 'floor-ahead-of-clock') return proofRefusal('PROOF_FLOOR_AHEAD_OF_CLOCK');
  // 'read-failed' (or an unnamed failure): weather. On an EXIT the right is kept
  // and the retry is real; on an ENTRY it stays fail-closed and promises nothing.
  if (purpose === 'exit') return proofRefusal('PROOF_STORE_UNREADABLE');
  return proofRefusal('ADDRESS_NOT_PROVEN');
}

/**
 * Did this session prove control of `address`, and what does the route owe if
 * not? `purpose` decides only ONE thing: what an unreadable store means.
 *
 * Contract for callers (see `services/flare/handoffAuthority`):
 *   · `proven: true`  → act. The address is the session's own login address or a
 *     signature-backed binding that post-dates the takeover floor.
 *   · `proven: false` with `refusal.status === 403` → a real no. The store was
 *     read and this session does not hold that address.
 *   · `proven: false` with `refusal.status === 503` → «I could not read».
 *     ONLY produced for `purpose: 'exit'`. Send it; do not fall through to a
 *     403, and do not treat it as «not proven» anywhere it removes a right.
 * Never throws: a caller may rely on getting a verdict.
 */
export async function proveAddress(
  userId: string | null | undefined,
  sessionWalletAddress: string | null | undefined,
  address: string | null | undefined,
  purpose: ProofPurpose,
): Promise<AddressProofVerdict> {
  const wanted = typeof address === 'string' ? address.trim() : '';
  let detailed: ProvenAddressesResult;
  try {
    detailed = await provenAddressesDetailed(userId, sessionWalletAddress);
  } catch (e) {
    // provenAddressesDetailed already swallows its own read errors; this is the
    // belt for anything above it (a failed dynamic import, say).
    console.error(`[prove-address] proof lookup threw for ${userId ?? '(anon)'}: ${(e as Error).message}`);
    detailed = { addresses: [], floorReadable: false, failure: 'read-failed' };
  }

  // No address was named: the store is irrelevant to the answer, so it never
  // produces a «could not read» either (handoffAuthority guards this too).
  if (!wanted) {
    return {
      proven: false,
      storeReadable: detailed.floorReadable,
      failure: detailed.failure,
      addresses: detailed.addresses,
      refusal: proofRefusal('ADDRESS_NOT_PROVEN'),
    };
  }

  if (includesAddress(detailed.addresses, wanted)) {
    return {
      proven: true,
      storeReadable: detailed.floorReadable,
      failure: detailed.failure,
      addresses: detailed.addresses,
      refusal: null,
    };
  }

  // The store could not be read. WHICH failure decides the sentence (it. 20, 2.4):
  // weather on an exit is a real 503 «try again»; a user row that is gone, or a
  // `security` block that does not parse, is a deterministic 409 that says so
  // instead of promising a retry that will never work.
  if (!detailed.floorReadable) {
    return {
      proven: false,
      storeReadable: false,
      failure: detailed.failure,
      addresses: detailed.addresses,
      refusal: refusalForUnreadableStore(detailed.failure, purpose),
    };
  }

  // The store WAS read and does not hold the address: a plain no.
  return {
    proven: false,
    storeReadable: detailed.floorReadable,
    failure: detailed.failure,
    addresses: detailed.addresses,
    refusal: proofRefusal('ADDRESS_NOT_PROVEN'),
  };
}


// ── The two shapes the other modules of this iteration ask for ───────────────
//
// productizer it. 20, 2.2 — MAKE THE AMBIGUOUS QUESTION UNASKABLE BY ACCIDENT.
// Both of these are built on `proveAddress`/`provenAddressesDetailed`, so the
// takeover floor, the «only signatures count» rule and the 403/409/503
// classification are read in ONE place and cannot drift per caller.

/** The three answers there actually are. `not-proven` is a fact; `could-not-read` is not. */
export type ProofOutcome = 'proven' | 'not-proven' | 'could-not-read';

/**
 * Pure: turn any verdict of this module into the three-way word. A caller that
 * branches on a boolean has already lost the third case — and the third case is
 * the one that seizes seats and closes exits.
 */
export function proofOutcome(v: { proven: boolean; storeReadable: boolean }): ProofOutcome {
  if (v.proven) return 'proven';
  return v.storeReadable ? 'not-proven' : 'could-not-read';
}

/** What a membership question gets back. See `proveMembership`. */
export interface MembershipProofVerdict {
  /**
   * The members of `members` this session PROVED. With `storeReadable: true`, an
   * empty array is a real «you hold none of these seats». With `false` it is
   * «I could not ask» — and then `refusal` is non-null.
   */
  owned: string[];
  storeReadable: boolean;
  failure: ProofStoreFailure | null;
  /**
   * NON-NULL EXACTLY WHEN `owned` IS EMPTY AND THE STORE COULD NOT BE READ.
   * Send it verbatim (`res.status(refusal.status).json(refusal)`) INSTEAD of the
   * route's own «none of your addresses is in this list»: that sentence is only
   * true when `storeReadable` is true. Null otherwise — including when `owned`
   * is empty and the store WAS read, where the route's own copy is the truth.
   */
  refusal: ProofRefusal | null;
}

/**
 * CONTRACT FOR THE COUNCIL READ (agent C, finding 2.1) — which of `members` does
 * this session hold, and what is owed if we could not find out?
 *
 * `ownedSignerAddresses(userId, members, sessionWalletAddress)` becomes:
 *
 *     const v = await proveMembership(userId, sessionWalletAddress, members, 'exit');
 *     if (v.refusal) return res.status(v.refusal.status).json(v.refusal);
 *     const owned = new Set(v.owned);
 *
 * `purpose` decides only what an unreadable store means, exactly as in
 * `proveAddress`: `'exit'` for anything that serves the bytes a cosignatory signs
 * or that lets capital out (a failed read there must never read as «you are not a
 * member»); `'entry'` for composing, filing, anchoring — refusing those costs
 * nobody a right. A deterministic failure answers 409 on both, because retrying
 * it is not a plan. Never throws.
 *
 * Note the ONE asymmetry, and it is deliberate: the session's own login address
 * proves itself without reading anything, so a cosignatory signed in WITH a
 * council key still gets their bytes while the database is down.
 */
export async function proveMembership(
  userId: string | null | undefined,
  sessionWalletAddress: string | null | undefined,
  members: readonly string[],
  purpose: ProofPurpose,
): Promise<MembershipProofVerdict> {
  const wanted = (members ?? []).filter((m) => typeof m === 'string' && m.trim().length > 0);
  if (wanted.length === 0) {
    // Nothing was asked about, so nothing could be unknown about it.
    return { owned: [], storeReadable: true, failure: null, refusal: null };
  }
  let detailed: ProvenAddressesResult;
  try {
    detailed = await provenAddressesDetailed(userId, sessionWalletAddress);
  } catch (e) {
    console.error(`[prove-membership] proof lookup threw for ${userId ?? '(anon)'}: ${(e as Error).message}`);
    detailed = { addresses: [], floorReadable: false, failure: 'read-failed' };
  }
  const owned = wanted.filter((m) => includesAddress(detailed.addresses, m));
  const refusal =
    owned.length === 0 && !detailed.floorReadable ? refusalForUnreadableStore(detailed.failure, purpose) : null;
  return { owned, storeReadable: detailed.floorReadable, failure: detailed.failure, refusal };
}

/** What a 0xFE seat path records and answers. See `seatProofFromVerdict`. */
export interface SeatProofClaim {
  /** TRUE ONLY WHEN PROVEN. Never true on a read we could not make. */
  preparedByProven: boolean;
  /**
   * TRUE WHEN WE NEVER GOT AN ANSWER. A row carrying this was NOT judged «not
   * proven» — we failed to ask. Nothing may be displaced, superseded or freed on
   * the strength of `preparedByProven === false` while this is true: that is
   * exactly how a database blink turned into somebody else's seat (it. 20, 1.4).
   */
  preparedByProofUnreadable: boolean;
  /** A supersede is authority over someone else's live draft: proof or nothing. */
  supersedeAuthorized: boolean;
  /** null when proven; otherwise the answer owed if the route refuses. */
  refusal: ProofRefusal | null;
}

/**
 * CONTRACT FOR THE SEAT PATHS (agent A, findings 1.1 / 2.2) — pure, so it can be
 * unit-tested without a request.
 *
 *     const verdict = await proveAddress(userId, sessionAddr, xrplAddress, purpose);
 *     const claim = seatProofFromVerdict(verdict, { supersede: wantsSupersede(req) });
 *     if (claim.refusal && claim.refusal.retryable) return res.status(503).json(claim.refusal);
 *
 * THE POINT: `preparedByProven: false` used to carry two different states — «this
 * session does not hold that account» and «we could not read whether it does» —
 * and the second one marks the row as displaceable by any request wearing an exit
 * label. They are two fields here, and the seat rules must read
 * `preparedByProofUnreadable` before they touch anyone's live draft.
 *
 * `supersede` is never granted on an unread store: displacing a stranger's
 * signable payload is authority, and «no pude leer» is not authority (it is not
 * punishment either — which is why the refusal still carries a real 503 on an
 * exit rather than a silent no).
 */
export function seatProofFromVerdict(
  verdict: { proven: boolean; storeReadable: boolean; refusal: ProofRefusal | null },
  opts: { supersede: boolean },
): SeatProofClaim {
  const outcome = proofOutcome(verdict);
  return {
    preparedByProven: outcome === 'proven',
    preparedByProofUnreadable: outcome === 'could-not-read',
    supersedeAuthorized: opts.supersede === true && outcome === 'proven',
    refusal: outcome === 'proven' ? null : verdict.refusal,
  };
}
