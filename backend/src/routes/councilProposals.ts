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
 * their viability. Proposals stop collecting after 7 days — but the word
 * "expired" is only ever written after the LEDGER confirms the pinned Sequence
 * was never consumed (see G1-guard below).
 */
import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import {
  ceremonySittingIsStale,
  releaseAbandonedCeremonySeat,
  seatReleaseAnswer,
  stampCeremonyPin,
  zeroFeMemoOfTx,
} from '../services/flare/DirectMintHandoffStore';
import {
  decode,
  encodeForSigning,
  deriveAddress,
  verifyKeypairSignature,
  convertHexToString,
} from 'xrpl';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { safeErrorDetail } from '../utils/safeError';
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
/**
 * arriendo-ceremonia (round 5) — THE SHAPE OF A LEDGER HASH, IN ONE PLACE.
 *
 * An XRPL transaction hash is 64 hex characters, always. This router already
 * knew that: `/submitted` tests exactly this before it dares launch the FDC
 * relay. What it did NOT know was that the SAME schema also guards
 * `/:id/positions/anchored`, whose write became IMMUTABLE in round 4 (a second,
 * different hash is now refused with 409 ALREADY_ANCHORED). Before that change
 * a mistyped anchor could be overwritten; after it, `min(8).max(128)` let a
 * truncated paste — or any 8 characters — freeze itself as the acta's on-chain
 * proof FOR EVER, and the surface renders it as if it had always been it.
 * The floor existed in the same file and was not applied to the door that
 * needed it most, so it is one constant now and both halves read it.
 */
const XRPL_TX_HASH_RE = /^[0-9A-Fa-f]{64}$/;
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

/**
 * puertas-y-permiso (round 3) — DOES THIS SESSION BELONG TO *THIS* COUNCIL?
 *
 * The router's only doorman is `requireLegacyAccess`, and with LEGACY_ENABLED
 * that means "any authenticated session" — never "a member of this council".
 * Every write door here used to be covered by something else: the signature
 * and position doors carry a signed blob (the member proves identity with a
 * key), and withdraw asked for the proposer. When round 3 opened withdraw to
 * a non-proposer (`neverAssembled`), the LAST ownership check on that door
 * went with it, and `POST /:id/submitted` never had one at all — so a stranger
 * could file another family's acta as `withdrawn`, or stamp a tx hash on it
 * and launch the relay that spends the executor's FLR.
 *
 * The membership question the router already knows how to ask lives in
 * `POST /:id/positions`: is this address in THIS proposal's signer list
 * (`signerListOf`)? What was missing was the other half — which of those
 * addresses is the caller's. That is the wallet registry: the addresses this
 * user connected. Not a cryptographic proof of ownership (a watch-only row
 * imported by `xrplIdentityWalletImport` carries `ownershipProof: 'none'`), so
 * it never replaces a signed blob where one exists; it is the ownership floor
 * for the two doors that carry no signature.
 *
 * No `network` filter on purpose: an r-address cannot collide with an EVM one,
 * and a filter that misses a legitimately-stored row would lock a real member
 * out of the exit round 3 opened for them.
 */
function memberAddressesOf(p: { signerList: unknown }): string[] {
  return signerListOf(p)
    .map((s) => s?.account)
    .filter((a): a is string => typeof a === 'string' && a.length > 0);
}

/**
 * productizer it. 17 (finding 2.1) — MEMBERSHIP IS A PROOF, NOT A DECLARATION.
 *
 * WHAT FAILED IN SILENCE: this answered off `prisma.wallet`, and a row there is
 * written by `POST /api/wallets/connect` with no signature at all — "this user
 * typed this address". A council's signer addresses are PUBLIC (they are on the
 * ledger, and the inbox prints them), so any authenticated stranger could type
 * one in, become a "member" of that council everywhere this predicate is asked,
 * and publish a proposal on it. That proposal then held the account's only
 * Sequence and `LIVE_PROPOSAL_EXISTS` refused the real family — for SEVEN DAYS,
 * withdrawable only by the stranger who filed it. The round-3 note above called
 * membership-by-proof "a pending FOUNDER decision"; the it.16 review found the
 * seven-day exit it leaves open, so it is taken now.
 *
 * The proof is the one the rest of the repo already uses
 * (`services/identity/provenAddresses`): the session's own login address (SIWE /
 * Xaman SignIn IS a signature) plus every active `WalletBinding` with a
 * `signatureProof`. Comparison is `includesAddress` — EVM case-insensitive,
 * base58 exact.
 *
 * CONSEQUENCE, SAID OUT LOUD: a real councillor whose address is only a
 * `wallet` row now has to prove it once (connect that wallet, or confirm its
 * binding) before these doors open. That is stated in every refusal below. The
 * doors this narrows are governance doors — compose, read, file, register a
 * hash; no EXIT of capital passes through any of them, and the one place where
 * an exit met this predicate (the ceremony lease in `/multisign/prepare`) only
 * decides whether a lease is RECORDED, never whether the exit is composed.
 */
/**
 * it. 21 (finding 2.1): asked through `proveMembership` instead of the deprecated,
 * ambiguous `provenAddressesOf`. For THIS function nothing changes — it is the WRITE
 * floor, `'entry'`, and an unreadable store stays fail-closed (refusing to compose,
 * file or anchor costs nobody a right). What changes is that the ambiguity now has a
 * name, and the READ verdict beside it can answer «I could not look» out loud.
 */
async function ownedSignerAddresses(
  userId: string,
  members: string[],
  sessionWalletAddress: string | null = null,
): Promise<Set<string>> {
  if (members.length === 0) return new Set();
  const { proveMembership } = await import('../services/identity/provenAddresses');
  const verdict = await proveMembership(userId, sessionWalletAddress, members, 'entry');
  return new Set(verdict.owned);
}

/**
 * ⛔ SUPERSEDED as a WRITE floor by `ownedSignerAddresses` (it. 17, finding 2.1) —
 * kept, never deleted: the self-asserted `wallet` table is what let a stranger
 * become a member, so no door that pins a Sequence, files an acta or stamps a hash
 * asks it. It is read again, and ONLY, by the READ floor below (it. 19, finding
 * 2.3) — the difference between the two answers stays in one place.
 */
async function ownedSignerAddressesFromWalletRegistry(userId: string, members: string[]): Promise<Set<string>> {
  if (members.length === 0) return new Set();
  const rows = await prisma.wallet.findMany({
    where: { userId, address: { in: members } },
    select: { address: true },
  });
  return new Set(rows.map((r) => r.address));
}

/**
 * productizer it. 19 (finding 2.3) — THE FLOOR THAT CLOSED AN EXIT ALREADY PROPOSED.
 *
 * WHAT FAILED IN SILENCE: it. 17 made membership a PROOF and applied it to all seven
 * doors of this router, READS included. But `GET /` and `GET /:id` are the ONLY place
 * the bytes a councillor signs ever come from — the pinned txjson and, for the
 * combining browser, the blobs. So a cosignatory who sits on the council's SignerList
 * on the validated ledger but never signed a binding could no longer READ the exit
 * proposal, could not sign it, and the quorum was never reached: the recall stayed in
 * the inbox. That is a registry narrowing an exit, which the doctrine forbids
 * outright — and it is worse than what it. 17 was protecting against, because the
 * stranger it kept out could never move anything either way.
 *
 * THE FLOOR, AND WHERE IT SITS. Reading a proposal is allowed to a session that holds
 * one of its signer addresses — PROVEN (a signed login, a signed binding) or merely
 * REGISTERED (a `wallet` row). Every WRITE keeps the proof: creating a proposal (it
 * pins the account's only Sequence for seven days), anchoring an acta, withdrawing,
 * registering the hash that launches the relay, and taking the ceremony lease. And a
 * signature is never taken on trust anyway — `POST /:id/signatures` verifies the blob
 * against the exact pinned bytes and the exact member key, so a registered address
 * that does not hold the key signs nothing.
 *
 * THE RESIDUAL, SAID OUT LOUD: a `wallet` row is self-asserted, and a council's signer
 * addresses are public, so anyone who types one can READ that council's acta — amounts,
 * destinations, positions and blobs. That is a real leak of an estate's business and it
 * is the price chosen here, deliberately: the alternative is a family that cannot get
 * its capital back out. Nothing about money moves with it (a blob is material destined
 * for the ledger, never a key). If the founder later wants the leak closed, the door is
 * this one function — not the write floor.
 *
 * A registry read that FAILS never removes the proven floor: the proven set survives.
 */
async function ownedSignerAddressesForRead(
  userId: string,
  members: string[],
  sessionWalletAddress: string | null = null,
): Promise<Set<string>> {
  const proven = await ownedSignerAddresses(userId, members, sessionWalletAddress);
  if (members.length === 0) return proven;
  try {
    for (const address of await ownedSignerAddressesFromWalletRegistry(userId, members)) proven.add(address);
  } catch (e) {
    console.warn('[council] wallet registry unreadable for the read floor:', (e as Error)?.message ?? e);
  }
  return proven;
}

/** The READ half of `sessionIsCouncilMember` (it. 19, 2.3): proven OR registered. */
export async function sessionMayReadCouncil(
  userId: string,
  p: { signerList: unknown },
  sessionWalletAddress: string | null = null,
): Promise<boolean> {
  const owned = await ownedSignerAddressesForRead(userId, memberAddressesOf(p), sessionWalletAddress);
  return owned.size > 0;
}

// -- productizer it. 21 (findings 2.1 / 3.7) -- THE READ VERDICT ---------------
//
// TWO THINGS WERE WRONG WITH THE it. 19 READ FLOOR, AND THEY PULL IN OPPOSITE
// DIRECTIONS.
//
// 2.1 - <<NO PUDE LEER>> ANSWERED <<NO ERES>>. `ownedSignerAddresses` is built on
// `provenAddressesOf`, which is ambiguous BY CONSTRUCTION (its own docstring says
// so): an empty list is either "this session proved nothing" or "the store did not
// answer". With the database blinking, `GET /:id` therefore answered 403 "none of
// your addresses is on this list" - a false statement about the user - and those
// bytes are THE ONLY ONES A COSIGNATORY CAN SIGN. A recall then never reaches its
// quorum, and the reason it did not is a failure of ours dressed as a verdict about
// them. The distinction `proveAddress(purpose)` draws for the 0xFE seat is drawn
// here too: a store that could not be read answers 503 RETRYABLE, never 403.
//
// 3.7 - THE INBOX OPENED TO A SELF-DECLARED ADDRESS. `POST /api/wallets/connect`
// writes `prisma.wallet` with NO signature, and a council's signer addresses are
// public on the ledger - so any session that typed one read that family's whole
// acta: title, amounts, destinations, every member's stance and comment, and the
// signed blobs. it. 19 chose that leak deliberately, as the price of not narrowing
// an exit, and wrote "if the founder later wants the leak closed, the door is this
// one function".
//
// THIS IS THAT DOOR, AND IT CLOSES THE LEAK WITHOUT RE-CLOSING THE EXIT. The read
// splits in two, because what a cosignatory NEEDS and what the acta CONTAINS are not
// the same thing:
//   - the SIGNING MATERIAL - the pinned txjson, the signer list, the quorum, the
//     status, the deadline and the collected blobs - is what a member must have to
//     sign and to combine. A registered-only address gets it, exactly as it. 19
//     intended. (Amounts and destinations live in those bytes: they cannot be hidden
//     from someone who is being asked to sign them, and hiding them would be asking
//     for a blind signature.)
//   - the ACTA - the family's own words: the row's TITLE and every member's
//     POSITION (stance + comment) - is deliberation, not signing material. Nobody
//     needs it to reach a quorum, and it is the part a stranger was reading. It
//     needs PROOF.
// The proposer always reads their own row in full.
//
// Net effect on the doctrine: an exit is never narrowed (the bytes still flow to a
// registered cosignatory, and an unreadable store is retryable rather than a denial),
// and a typed r-address stops buying somebody else's deliberation.

export type CouncilReadLevel = 'proven' | 'registered' | 'none' | 'unreadable';

/**
 * The two sets, read ONCE for a whole listing (never once per row), plus whether
 * either read failed. `councilReadLevelFor` turns them into the verdict for ONE row
 * — a session on council A asking for accounts A and B must still be told nothing
 * about B, so the decision stays per row while the reads stay per request.
 */
export interface CouncilReadAccess {
  /** Members of the asked rows this session has PROVEN (signed login / binding). */
  proven: Set<string>;
  /** Members of the asked rows this session merely REGISTERED (`wallet` rows). */
  registered: Set<string>;
  /**
   * @deprecated it. 23 (2.4) — VEREDICTO DE UNIÓN: es true en cuanto CUALQUIER fila
   * del listado pudo decidirse. Se conserva (nunca se borra código construido) para
   * los lectores que solo quieren saber si la petición entera fue a ciegas, pero
   * NINGUNA decisión por fila puede tomarse con él: úsense `proofReadable` y
   * `registryReadable`, que es lo que `councilReadLevelFor` mira ahora.
   */
  readable: boolean;
  /**
   * it. 23 (2.4) — LAS DOS LECTURAS, POR SEPARADO Y SIN UNIÓN.
   *
   * QUÉ FALLABA EN SILENCIO: `readable` era `proven.size > 0 || registered.size > 0 ||
   * (ambas lecturas fueron bien)`. En un listado MIXTO —una fila cuyo asiento está en
   * el registro y otra cuyo asiento solo puede PROBARSE— basta que la primera se
   * decida para que `readable` sea true; la segunda cae entonces en `'none'`, el
   * filtro `mine` la tira y el cliente recibe un 200 sin ella. Ni 503 ni 403: la fila
   * DESAPARECE. Y son los únicos bytes que un cosignatario puede firmar.
   *
   * Con las dos banderas, una fila que no aparece en ningún conjunto se decide por si
   * ALGUNA de las lecturas falló: si falló, «no pude leer» (503/409 honesto); si las
   * dos fueron bien, «no eres» (403). El nivel ya se decidía por fila; ahora la
   * legibilidad también.
   */
  proofReadable: boolean;
  registryReadable: boolean;
  /** Set only when `readable` is false - for the log and the 503 body. */
  failure?: string;
  /**
   * it. 21 (2.1): the answer the identity module itself says is owed when the proof
   * store could not be read and nothing was found (`proveMembership().refusal`) —
   * 503 retryable for a transient read, 409 for a deterministic one, because waiting
   * does not cure those. Sent VERBATIM so the classification lives in one place. It
   * is null when only the wallet REGISTRY failed; `councilReadUnreadableBody` words
   * that half.
   */
  refusal?: { status: number; error: string; detail: string; retryable: boolean } | null;
}

/**
 * One proof read and at most one registry read, whatever the size of the listing.
 * Never throws: the caller always gets a verdict it can answer with.
 */
export async function councilReadAccess(
  userId: string,
  members: string[],
  sessionWalletAddress: string | null = null,
): Promise<CouncilReadAccess> {
  const empty = { proven: new Set<string>(), registered: new Set<string>() };
  if (members.length === 0) return { ...empty, readable: true, proofReadable: true, registryReadable: true };
  // The PROVEN half, asked of the identity module's own verdict (it. 21, 2.1): it is
  // the only thing that can tell «you hold none of these seats» from «I could not
  // ask», and the whole finding is that this route was answering the first sentence
  // for the second one - over the only bytes a cosignatory can sign. `'exit'`,
  // because that is exactly what these bytes are for.
  const { proveMembership } = await import('../services/identity/provenAddresses');
  const verdict = await proveMembership(userId, sessionWalletAddress, members, 'exit');
  const proven = new Set(verdict.owned);
  let registryReadable = true;
  let registered = new Set<string>();
  try {
    registered = await ownedSignerAddressesFromWalletRegistry(userId, members);
  } catch (e) {
    registryReadable = false;
    console.warn('[council] wallet registry unreadable for the read floor:', (e as Error)?.message ?? e);
  }
  // A read that FAILED is only "I do not know" when it found nothing: a proven seat
  // is a yes whatever the other read did (it. 19 - "a registry read that FAILS never
  // removes the proven floor").
  const readable = proven.size > 0 || registered.size > 0 || (verdict.storeReadable && registryReadable);
  // it. 23 (2.4): `failure` y `refusal` viajan siempre que ALGUNA lectura falló, no
  // solo cuando fallaron todas — son lo que una fila indecidible necesita para
  // contestar 503 (o el 409 determinista) aunque otra fila del mismo listado sí se
  // haya podido decidir.
  const anyReadFailed = !verdict.storeReadable || !registryReadable;
  return {
    proven,
    registered,
    readable,
    proofReadable: verdict.storeReadable,
    registryReadable,
    ...(anyReadFailed ? { failure: verdict.failure ?? 'wallet-registry-read-failed' } : {}),
    ...(anyReadFailed ? { refusal: verdict.refusal ?? null } : {}),
  };
}

/**
 * The verdict for ONE row. The proposer always reads their own in full; otherwise a
 * seat on THAT row's signer list decides, proven first. When neither read found
 * anything and one of them failed, the answer is 'unreadable' - never 'none' (2.1).
 */
export function councilReadLevelFor(
  userId: string,
  access: CouncilReadAccess,
  row: { createdByUserId?: string | null; signerList: unknown },
): CouncilReadLevel {
  if (row.createdByUserId != null && row.createdByUserId === userId) return 'proven';
  const members = memberAddressesOf(row);
  if (members.some((m) => access.proven.has(m))) return 'proven';
  if (members.some((m) => access.registered.has(m))) return 'registered';
  // it. 23 (2.4): ESTA FILA no aparece en ningún conjunto. Eso solo significa «no
  // eres» si las DOS lecturas fueron bien. Si alguna falló, lo que hay es «no pude
  // leer» — y da igual que otra fila del mismo listado sí se haya podido decidir:
  // `readable` era una unión y por eso esta fila desaparecía en silencio.
  const bothReadsLanded = access.proofReadable !== false && access.registryReadable !== false;
  return bothReadsLanded ? 'none' : 'unreadable';
}

/** The 503 a read owes when it could not be decided (2.1). Never a 403. */
export function councilReadUnreadableBody(failure?: string): {
  error: 'COUNCIL_READ_UNREADABLE';
  retryable: true;
  detail: string;
} {
  return {
    error: 'COUNCIL_READ_UNREADABLE',
    retryable: true,
    detail:
      'We could not read which addresses you hold, so we will not answer for them either way - and we will not tell ' +
      'you that you are not on this council when the truth is that we could not look. Nothing was written and nothing ' +
      'moved. Try again in a moment; if this is an exit you are trying to sign, it is never refused for a failure of ' +
      `ours.${failure ? ` (${failure})` : ''}`,
  };
}

/**
 * it. 21 (3.7): what a REGISTERED-only session is served. The signing material, in
 * full; the family's deliberation, not at all. `redacted` names what was withheld so
 * a screen can say why instead of showing an empty acta.
 */
export function redactActaForRegistered<T extends Record<string, unknown>>(
  row: T,
): Record<string, unknown> {
  const rest = { ...(row as Record<string, unknown>) };
  delete rest.title;
  delete rest.positions;
  return { ...rest, title: null, positions: [], access: 'registered', redacted: ['title', 'positions'] };
}

/**
 * The sentence every membership refusal in this router ends with: a real member
 * who was never asked for a signature must know what to do, and must not read
 * this as "you are not on this council".
 */
export const PROVE_MEMBERSHIP_HINT =
  'Membership is decided by a PROVEN address: the wallet you signed in with, or one you signed a binding challenge ' +
  'for. An address that was only registered (typed or imported as watch-only) is not a proof — a council\'s signer ' +
  'addresses are public, so anyone could type one in. If you do hold this seat, connect or bind that wallet with a ' +
  'signature and this opens immediately. (Reading a proposal, and signing it, never needs that: any address you hold ' +
  'that sits on the signer list opens the inbox — this floor is only for the doors that WRITE.)';

/**
 * it. 19 (finding 2.3): the sentence a READ refusal ends with. It must not send a
 * councillor off to prove anything — reading is already open to a registered address —
 * so it says what is actually wrong: none of the addresses you hold is on this list.
 */
export const READ_MEMBERSHIP_HINT =
  'The inbox of a council opens to any address you hold that sits on its signer list (connected, imported or proven) ' +
  'and to whoever composed the proposal. If you do hold one of its seats, add that address to your account and this ' +
  'opens — nothing has to be signed to READ a proposal or to sign one.';

/**
 * arriendo-ceremonia (round 5): exported so the SYNCHRONOUS ceremony door
 * (`POST /api/xrpl-defi/multisign/prepare`) can ask the same question with the
 * signer list the coordinator just read off the ledger — see the floor on the
 * lease write there. One predicate, one proof, four doors.
 *
 * `sessionWalletAddress` is the session's login address (`req.siwe.walletAddress`):
 * the login itself was a signature, so it counts as proof. A caller with no request
 * at hand (the MoneyFlow rule engine) omits it and is judged on bindings alone.
 */
export async function sessionIsCouncilMember(
  userId: string,
  p: { signerList: unknown },
  sessionWalletAddress: string | null = null,
): Promise<boolean> {
  const owned = await ownedSignerAddresses(userId, memberAddressesOf(p), sessionWalletAddress);
  return owned.size > 0;
}

/**
 * g1-ceremonia (round 4) — THE BIG PERMISSION HOLE OF THIS ROUTER, AND IT WAS
 * A READ.
 *
 * WHAT FAILED IN SILENCE: every write door grew an ownership floor over rounds
 * 3 and 4, and `GET /` + `GET /:id` were left with `requireLegacyAccess` alone
 * — which with LEGACY_ENABLED means "any authenticated session". They hand back
 * the whole acta of whatever account is asked for: the council's signer list
 * and weights, the pinned txjson (amounts, destinations, memos), every member's
 * formal position and comment, and on `GET /:id` the signed blobs themselves.
 * Nothing errored and nothing was written, which is why it survived four
 * rounds of a double-payment audit: reading another family's estate leaves no
 * trace at all.
 *
 * The floor is the one the write doors already use — the proposer, or a session
 * holding one of THIS proposal's signer addresses in the wallet registry. NOT
 * the governed-account pointer (`GovernedAccount`): that row is self-asserted
 * (`POST /governed-accounts` takes any r-address with no proof), so honouring
 * it would leave the door exactly as open as it is now, with a step in it.
 */
/**
 * SUPERSEDED as the listing's filter by `councilReadLevelFor` (it. 21, 2.1 / 3.7) —
 * kept, never deleted: it is the binary shape of the same question (may this session
 * read this row at all?) and the two read routes' comments still name it. The verdict
 * it could not give is the one it. 21 needed: «proven», «registered» and «I could not
 * read» are three different answers, and collapsing them into a boolean is what made
 * an outage look like «you are not on this council».
 */
function mayReadProposal(
  userId: string,
  owned: Set<string>,
  p: { createdByUserId: string | null; signerList: unknown },
): boolean {
  if (p.createdByUserId !== null && p.createdByUserId === userId) return true;
  return memberAddressesOf(p).some((a) => owned.has(a));
}
void mayReadProposal;

// ─────────────────────────────────────────────────────────────────────────────
// G1-guard — never declare a proposal expired without looking at the ledger.
//
// (Auditoría Silenciosos 2026-08-17, finding G1 · CRITICAL — loses money.)
//
// WHAT FAILED IN SILENCE: `/submitted` is reported ONLY by the broadcasting
// browser. When that report failed (network, tab closed while waiting for
// validation, 403/5xx) the transaction was ALREADY validated on XRPL and the
// row stayed `ready`. Seven days later the lazy-expiry below stamped `expired`
// — BLIND, without a single read — the inbox archived it as "never happened",
// and the family's natural reaction was to compose the payment AGAIN: a new
// Sequence, perfectly valid. THE COUNCIL PAID TWICE.
//
// The ledger settles it for free. A proposal pins ONE Sequence before anybody
// signs, and XRPL consumes a Sequence exactly once — any tx that reaches a
// ledger (tesSUCCESS or tec*) burns it; that IS the ledger's replay
// protection. So one cheap `account_info` read tells three honest apart:
//
//   accountSequence >  pinned  → CONSUMED. The seat was used. That signed tx
//                                can never be re-broadcast (tefPAST_SEQ), so
//                                the duplicate is impossible BY CONSTRUCTION —
//                                but we may not call it expired either: we do
//                                not know whether OUR tx was the one that
//                                consumed it. Say exactly that.
//   accountSequence <= pinned  → UNUSED. The pinned tx never entered a ledger.
//                                Genuinely expired — and only now is the word
//                                true, so only now is it written to the DB.
//   read failed / no pinned    → UNVERIFIED. That is a failure of OURS, not a
//                                state of the world (doctrine: a failed read
//                                is never painted as data). Archive nothing.
//
// Only the middle case is persisted. The other two keep their stored status
// and carry `ledgerCheck` so the surface can tell the truth instead of the
// word "expired". Deliberately NOT a new `status` value: the inbox's status
// union has five members and buckets by equality, so a sixth would make the
// row invisible — trading a lie for a disappearance.
//
// Kept consequence: a past-deadline row that stays `ready` still accepts
// `POST /:id/submitted`, which is the a-posteriori hash registration the inbox
// gained in dbba320. Blind archiving used to slam that recovery door shut.
// ─────────────────────────────────────────────────────────────────────────────

export type LedgerCheck =
  | { state: 'consumed'; deadlinePassed: true; pinnedSequence: number; accountSequence: number; checkedAt: string; detail: string }
  | { state: 'unused'; deadlinePassed: true; pinnedSequence: number; accountSequence: number; checkedAt: string; detail: string }
  | { state: 'unverified'; deadlinePassed: true; pinnedSequence: number | null; reason: string; checkedAt: string; detail: string };

/** A hung XRPL node must never hold the inbox open. */
const SEQ_READ_TIMEOUT_MS = 4_000;
/**
 * One listing can hold several past-deadline rows of the SAME account; without
 * this they would each pay for their own `account_info`. Short on purpose: a
 * stale sequence errs toward "unused" (= the old, wrong verdict), so the
 * window in which it could matter is kept to seconds.
 */
const SEQ_CACHE_MS = 15_000;
/**
 * G1-cadena (round 2, finding 6): the cache is module state with no eviction —
 * one entry per council account, forever, for the life of the process. Small,
 * but unbounded is unbounded. Pruned on every miss and hard-capped.
 */
const SEQ_CACHE_MAX = 256;
/**
 * G1-cadena (round 2, finding 4) — WHAT FAILED IN SILENCE: the cache stored
 * only the RESOLVED sequence, so a FAILURE was never remembered. With XRPL
 * down, every past-deadline row in a listing paid its own 4s timeout: 100 rows
 * ≈ 400s of a hung inbox — the guard that exists to stop a double payment
 * turning into a screen nobody can open. Caching the PROMISE fixes both halves
 * at once: a rejection is remembered for the same short window (negative
 * cache), and concurrent readers of the same account share ONE in-flight read
 * instead of racing to miss.
 */
const seqCache = new Map<string, { at: number; read: Promise<number> }>();

function pruneSeqCache(): void {
  const now = Date.now();
  for (const [k, v] of seqCache) if (now - v.at >= SEQ_CACHE_MS) seqCache.delete(k);
  // Bounded even if every entry is fresh: oldest first (Map keeps insertion order).
  while (seqCache.size >= SEQ_CACHE_MAX) {
    const oldest = seqCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    seqCache.delete(oldest);
  }
}

/** Test-only: the cache is module state and outlives a single request. */
export function __resetSequenceCache(): void {
  seqCache.clear();
}

async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The Sequence the council pinned before anyone signed (coordinator output).
 * it. 19 (2.2): exported — the ceremony door pins an exit to the seat a live row is
 * holding, on purpose, instead of taking whatever `account_info` answers.
 */
export function pinnedSequenceOf(txjson: unknown): number | null {
  const seq = (txjson as { Sequence?: unknown } | null)?.Sequence;
  return typeof seq === 'number' && Number.isInteger(seq) && seq > 0 ? seq : null;
}

function readAccountSequence(account: string): Promise<number> {
  const hit = seqCache.get(account);
  if (hit && Date.now() - hit.at < SEQ_CACHE_MS) return hit.read;
  const read = withTimeout(
    xrplProvider.getAccountSequence(account),
    SEQ_READ_TIMEOUT_MS,
    `account_info ${account}`,
  );
  // A cached rejection is still a rejection: without this handler the negative
  // cache would surface as an unhandled promise rejection the moment nobody
  // awaited that particular entry.
  read.catch(() => undefined);
  pruneSeqCache();
  seqCache.set(account, { at: Date.now(), read });
  return read;
}

/** The three honest verdicts on a past-deadline proposal's pinned seat. */
async function checkPinnedSequence(p: { account: string; txjson: unknown }): Promise<LedgerCheck> {
  const checkedAt = new Date().toISOString();
  const pinnedSequence = pinnedSequenceOf(p.txjson);
  if (pinnedSequence === null) {
    return {
      state: 'unverified',
      deadlinePassed: true,
      pinnedSequence: null,
      reason: 'NO_PINNED_SEQUENCE',
      checkedAt,
      detail:
        'This proposal pins no readable Sequence, so the ledger cannot be asked whether it executed. It is NOT filed as expired — check the account on an explorer before composing another.',
    };
  }
  let accountSequence: number;
  try {
    accountSequence = await readAccountSequence(p.account);
  } catch (e) {
    return {
      state: 'unverified',
      deadlinePassed: true,
      pinnedSequence,
      reason: `LEDGER_READ_FAILED: ${(e as Error).message}`,
      checkedAt,
      detail:
        'XRPL could not be read, so we do not know whether this proposal executed. It is NOT filed as expired — check the account on an explorer before composing another.',
    };
  }
  if (accountSequence > pinnedSequence) {
    return {
      state: 'consumed',
      deadlinePassed: true,
      pinnedSequence,
      accountSequence,
      checkedAt,
      detail:
        `The account already used Sequence ${pinnedSequence} (it is now at ${accountSequence}). The signed transaction can never be broadcast again, so it cannot pay twice — but we could not confirm whether it executed. Check the account on an explorer BEFORE composing another proposal.`,
    };
  }
  return {
    state: 'unused',
    deadlinePassed: true,
    pinnedSequence,
    accountSequence,
    checkedAt,
    detail: `Sequence ${pinnedSequence} is still unused on the ledger, so this proposal never executed. Truly expired.`,
  };
}

/**
 * Lazily expire a live proposal whose deadline passed (no cron needed) — but
 * only after the ledger says the pinned Sequence was never consumed (G1-guard
 * above). Otherwise the row keeps its stored status and carries `ledgerCheck`.
 */
async function withEffectiveStatus<
  T extends { id: string; account: string; status: string; txjson: unknown; expiresAt: Date },
>(p: T): Promise<T & { ledgerCheck?: LedgerCheck }> {
  if (!(LIVE_STATUSES as readonly string[]).includes(p.status)) return p;
  if (p.expiresAt.getTime() >= Date.now()) return p;
  const ledgerCheck = await checkPinnedSequence(p);
  if (ledgerCheck.state === 'unused') {
    await prisma.councilProposal.update({ where: { id: p.id }, data: { status: 'expired' } });
    return { ...p, status: 'expired', ledgerCheck };
  }
  return { ...p, ledgerCheck };
}

/**
 * Open for new work = a live status AND the deadline still ahead. The status
 * alone stopped being enough with G1-guard: the server now refuses to archive
 * a past-deadline proposal it could not disprove on the ledger, so a row can
 * legitimately still read `collecting`/`ready` after its deadline.
 */
function isOpen(p: { status: string; expiresAt: Date }): boolean {
  return (LIVE_STATUSES as readonly string[]).includes(p.status) && p.expiresAt.getTime() >= Date.now();
}

/** A past-deadline proposal the guard REFUSED to archive: its pinned seat is
 *  consumed (it may already have executed) or could not be read. */
function isUnresolvedSeat(c: LedgerCheck | undefined): c is LedgerCheck {
  return !!c && c.state !== 'unused';
}

/**
 * G1-cadena (round 2, finding 2) — THE LAST OPEN DOOR OF THE DOUBLE PAYMENT.
 *
 * WHAT FAILED IN SILENCE: `POST /` only refuses a second proposal while a live
 * one is INSIDE its deadline. Round 1 stopped the server from LYING ("expired")
 * about a seat it had not disproven — but the day after the deadline the
 * compose door swung open anyway, with nobody saying "that one may already have
 * executed". Same seven-day-old payment, same fresh Sequence, same council
 * paying twice; the guard's verdict simply never reached the moment of
 * composing.
 *
 * So: before pinning a NEW Sequence, ask the ledger about the stale ones. Only
 * `unused` (= genuinely never executed, and by now archived as `expired` by the
 * guard itself) clears the way. `consumed` and `unverified` stop the compose
 * and hand back the verdict — the warning arrives BEFORE the money moves, not
 * after. The proposer resolves it in the inbox (register the real hash, or file
 * it acknowledging the check) and composes then.
 *
 * G1-cadena (round 3, finding 1) — EXPORTED because the HTTP door is not the
 * only door. `CouncilProposalService.createCouncilProposalFromRule` composes
 * from a fired MoneyFlow with NO human in front of the screen, and it had none
 * of this: a governed monthly rule would compose over an unresolved seat month
 * after month, unattended. One definition of the guard, used by both doors —
 * a second copy is how the halves drift apart.
 */
export async function findUnresolvedSeat(
  account: string,
): Promise<{
  proposalId: string;
  title: string | null;
  txType: string;
  ledgerCheck: LedgerCheck;
  /** it. 19 (2.2): the Sequence this row pinned — the seat an exit may take on purpose. */
  pinnedSequence: number | null;
  /** it. 19 (2.7): who may read the row's title and verdict — its own signer list. */
  signerList: unknown;
} | null> {
  const stale = await prisma.councilProposal.findMany({
    where: { account, status: { in: [...LIVE_STATUSES] }, expiresAt: { lte: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      account: true,
      title: true,
      txType: true,
      txjson: true,
      status: true,
      expiresAt: true,
      signerList: true,
    },
  });
  // Sequential on purpose: every row here is the SAME account, so the first
  // read warms the cache and the rest are free.
  for (const row of stale) {
    const p = await withEffectiveStatus(row);
    if (isUnresolvedSeat(p.ledgerCheck)) {
      return {
        proposalId: p.id,
        title: p.title,
        txType: p.txType,
        ledgerCheck: p.ledgerCheck,
        pinnedSequence: pinnedSequenceOf(p.txjson),
        signerList: row.signerList,
      };
    }
  }
  return null;
}


/**
 * permisos-y-doble-pago — ONE definition of "this account already has a live
 * payload", for every door that pins a Sequence. The twin of
 * `findUnresolvedSeat`, which covers the PAST-DEADLINE half of the same seat.
 *
 * XRPL pins one Sequence at a time and `prepareCouncilMultisig` fixes whatever
 * `account_info` reports as the account's next unused one — so a second payload
 * composed while a proposal is still collecting takes THE SAME SEAT. Exactly
 * one of the two can ever reach a ledger; the loser becomes a corpse that still
 * LOOKS alive (inside its deadline `withEffectiveStatus` returns early and never
 * asks the ledger), and the family's natural repair for it — withdraw it, then
 * compose again over a fresh Sequence — IS the second payment.
 *
 * `POST /` has refused this from the beginning, and was the only door that did.
 * Exported so the synchronous ceremony (`POST /api/xrpl-defi/multisign/prepare`)
 * asks the SAME question instead of restating it: two copies of "does this
 * council already have a live payload?" is how the halves drift apart.
 */
export async function findLiveProposal(account: string): Promise<{
  id: string;
  title: string | null;
  txType: string;
  /**
   * it. 19 (finding 2.2): the Sequence this proposal is HOLDING. The ceremony door
   * pins an exit to it deliberately instead of taking whatever `account_info`
   * happens to answer — see `prepareCouncilMultisig`.
   */
  pinnedSequence?: number | null;
  /** it. 19 (finding 2.7): this row's own signer list, so its title is served only to it. */
  signerList?: unknown;
} | null> {
  const row = await prisma.councilProposal.findFirst({
    where: { account, status: { in: [...LIVE_STATUSES] }, expiresAt: { gt: new Date() } },
    select: { id: true, title: true, txType: true, txjson: true, signerList: true },
  });
  if (!row) return null;
  const { txjson, ...rest } = row as typeof row & { txjson?: unknown };
  return { ...rest, pinnedSequence: pinnedSequenceOf(txjson) };
}

// ─────────────────────────────────────────────────────────────────────────────
// g1-ceremonia — THE SEAT THE SYNCHRONOUS CEREMONY TAKES, AND THAT NOBODY
// WROTE DOWN.
//
// WHAT FAILED IN SILENCE: `POST /api/xrpl-defi/multisign/prepare` pins a
// Sequence for a council through `prepareCouncilMultisig`, and that function
// touches no database at all — it reads the ledger and returns bytes. The
// ceremony then lives entirely in ONE browser tab: a QR per member, combine
// client-side, broadcast to a public node. Server-side there is nothing to
// find. So both ASYNC compose doors — `POST /` here and
// `CouncilProposalService.createCouncilProposalFromRule` — are blind to a
// ceremony in flight, and the chain is one click long:
//
//   the ceremony pins Sequence N → the QRs stall (a phone is off, Xaman locked
//   the payload) → the family presses the button next to it ("Propose to the
//   council") → `POST /` finds nothing live → it pins Sequence N AGAIN.
//
// That is the SAME chain the live-proposal guard closes, with the tempos
// inverted, and this is the natural order of the two: a family reaches for the
// asynchronous inbox when the sitting fails, not the other way round. Two
// payloads, one seat: the ledger burns N exactly once, so whichever broadcasts
// first wins and the other keeps looking alive — and the family's repair for
// the corpse (withdraw it, compose again over a fresh Sequence) IS the second
// payment.
//
// THE TRACE, AND ABOVE ALL ITS LIFETIME. A trace that outlives what it
// describes wedges the family shut, and this rail has done exactly that before
// (the lazy expiry that archived a seat it had never read). So the lease is
// deliberately short and it has three independent releases (a fourth, DIRECT
// one was added in round 5 — `releaseCeremonySeatFor`, the button the family
// presses; the three below are the ones that need nobody to press anything):
//
//   1. TIME — 30 minutes. The ceremony is one sitting ("if this screen closes,
//      the signatures are lost", CouncilMultisigFlow). Xaman keeps a payload
//      signable for 24 h, but a 24 h lease on a compose door is a wedge, and
//      whatever reached a quorum in the inbox is covered by the proposal
//      guards instead. The row carries `expiresAt`, so an unread lease dies on
//      its own.
//   2. THE LEDGER — a seat the account has already consumed cannot be taken
//      twice: those exact bytes are tefPAST_SEQ for ever. The lease is released
//      the moment `account_info` says so. That is also how the server learns
//      the ceremony BROADCAST without the browser reporting anything.
//   3. RE-PREPARE — a new ceremony on the same council replaces the lease
//      (upsert). This is why the ceremony door never blocks on its OWN lease:
//      the family retries "Sign now" after a stalled QR, and a door that
//      refused that retry would be the dead end this guard exists to avoid.
//
// An UNREADABLE ledger keeps the lease (it does not extend it): the trace is
// something WE wrote minutes ago, not an inference about the world, so holding
// it is not painting an unread state — and it dies at its deadline regardless.
// ─────────────────────────────────────────────────────────────────────────────

/** Reuses the generic `CacheEntry` table (cacheKey/data/tags/expiresAt): a
 *  short-lived, self-expiring lease is exactly its shape, and the council
 *  schema is not ours to widen for a 30-minute row. */
const CEREMONY_SEAT_TAG = 'council-ceremony-seat';
const CEREMONY_SEAT_TTL_MS = 30 * 60 * 1000;

function ceremonySeatKey(account: string): string {
  return CEREMONY_SEAT_TAG + ':' + account;
}

export interface CeremonySeat {
  account: string;
  /** The Sequence the ceremony pinned — the seat itself. */
  pinnedSequence: number;
  txType: string;
  preparedAt: string;
  preparedByUserId: string | null;
  /**
   * it. 34 (E) — WHICH SITTING holds this lease. Generated by the server in the
   * prepare that pinned (`randomUUID`), returned to the browser, and required
   * back on `/multisign/release`: a release naming a sitting that is no longer
   * the lessee is a no-op (`stale-sitting`). Two sittings of the SAME session
   * over the SAME bytes (Escape in `signing` → sign again) used to be told apart
   * by nothing, so the first one's late, keepalive release freed the second's
   * seat. `null` on leases written before this field (they live 30 minutes).
   */
  sittingId: string | null;
  /** What the ledger says about that seat right now. `unused` = still held. */
  ledgerSeat: 'unused' | 'unreadable';
  /** Present when the ledger could not be asked (never presented as a state). */
  readError?: string;
}

/**
 * The ceremony door's write. Best-effort by design: a lease that fails to
 * store leaves the other doors exactly as blind as they were before this guard
 * existed, whereas failing the prepare would stop a legitimate sitting over a
 * cache row. It says so in the log rather than reporting success.
 */
export async function recordCeremonySeat(input: {
  account: string;
  pinnedSequence: number;
  txType: string;
  userId: string | null;
  /** it. 34 (E): the id of the sitting taking the seat — see `CeremonySeat.sittingId`. */
  sittingId: string | null;
}): Promise<boolean> {
  // A lease with no readable Sequence describes no seat: it could never be
  // released by the ledger (release #2) and would only block for 30 minutes on
  // nothing. Refuse to write it — and say so, rather than reporting success.
  if (!Number.isInteger(input.pinnedSequence) || input.pinnedSequence <= 0) {
    console.warn('[council] ceremony seat NOT recorded: no pinned Sequence for', input.account);
    return false;
  }
  const seat: Omit<CeremonySeat, 'ledgerSeat'> = {
    account: input.account,
    pinnedSequence: input.pinnedSequence,
    txType: input.txType,
    preparedAt: new Date().toISOString(),
    preparedByUserId: input.userId,
    sittingId: typeof input.sittingId === 'string' && input.sittingId.length > 0 ? input.sittingId : null,
  };
  const expiresAt = new Date(Date.now() + CEREMONY_SEAT_TTL_MS);
  try {
    await prisma.cacheEntry.upsert({
      where: { cacheKey: ceremonySeatKey(input.account) },
      create: {
        cacheKey: ceremonySeatKey(input.account),
        data: seat as never,
        tags: [CEREMONY_SEAT_TAG],
        expiresAt,
      },
      update: { data: seat as never, tags: [CEREMONY_SEAT_TAG], expiresAt },
    });
    // Release #1, swept rather than trusted: a lease nobody ever reads again
    // would sit in the table for ever. Bounded to this guard's own rows.
    await prisma.cacheEntry.deleteMany({
      where: { tags: { has: CEREMONY_SEAT_TAG }, expiresAt: { lt: new Date() } },
    });
    return true;
  } catch (e) {
    console.warn('[council] ceremony seat NOT recorded:', (e as Error).message);
    return false;
  }
}

/** Returns whether the row is GONE. Callers that only sweep ignore it; the
 *  release door below cannot: reporting "the seat is back" over a delete that
 *  threw is the same unearned success this whole audit is about. */
async function releaseCeremonySeat(account: string): Promise<boolean> {
  try {
    await prisma.cacheEntry.deleteMany({ where: { cacheKey: ceremonySeatKey(account) } });
    return true;
  } catch {
    /* the lease expires on its own — a failed delete never blocks a compose */
    return false;
  }
}

/**
 * arriendo-ceremonia (round 5) — THE DOOR THE LEASE NEVER HAD.
 *
 * WHAT FAILED IN SILENCE: round 4 gave the synchronous ceremony a 30-minute
 * lease on the council's Sequence and gave the family a «Cancel this ceremony»
 * button, and the two were never connected. Cancelling killed the Xaman
 * payloads, cleared the screen and told the council — in its own comment — that
 * "the ceremony gives the seat back". Nothing was given back: no HTTP call was
 * made at all. One click later «Propose to the council» answered 422
 * CEREMONY_IN_FLIGHT with "Finish or abandon that sitting", which is exactly
 * what they had just done, and there was NO WAY to obey it for up to half an
 * hour. The MoneyFlow rule of the same council burned its cooldown against the
 * same refusal.
 *
 * Three releases already existed (deadline, ledger, re-prepare) and all three
 * are indirect. This is the fourth and the only DIRECT one, so it is the only
 * one that can be wrong on purpose: it is held to the ONE person who took the
 * seat. `preparedByUserId` has been written on every lease since round 4 and
 * read by nobody — that is the owner, and it is what makes this door safe to
 * open at all. A stranger releasing another family's lease would hand the
 * async door a Sequence that a live ceremony is still collecting signatures
 * over: the double payment, with our own help.
 *
 * A lease we cannot READ or cannot DELETE is never reported as released
 * (doctrine: "could not read" is not "it is gone") — it dies at its deadline
 * regardless, and the caller says so instead of painting the door open.
 */
export type SeatReleaseOutcome =
  | { released: true; reason: 'released' }
  /** Nothing was holding it (never leased, already expired, unparsable). */
  | { released: false; reason: 'no-seat' }
  /** Someone else's sitting is holding this council's Sequence right now. */
  | { released: false; reason: 'not-the-lessee' }
  /**
   * it. 34 (E) — this session's OWN newer sitting is holding it (or another of
   * its tabs). The release named a sitting that is no longer the lessee: nothing
   * is touched, and it is not a refusal — that sitting simply ended already.
   */
  | { released: false; reason: 'stale-sitting' }
  /** Our own store failed. NOT a verdict about the seat. */
  | { released: false; reason: 'unreadable'; detail: string };

/**
 * it. 34 (E) — THE BUS RACE: A LATE RELEASE UNDER A LIVE SITTING.
 *
 * WHAT FAILED IN SILENCE. Escape in `signing` fires the flow's unmount release
 * fire-and-forget (`keepalive`) and the caller reads ABANDONED as 'review'; the
 * surface offers to sign again; the new sitting's `/multisign/prepare` — same
 * session, same bytes — UPSERTS this lease. If the first release lands AFTER
 * that, the owner check passes (same user), the lease goes, the pin is read as
 * present, `holderEndedCeremony` replaces the clock, and the 0xFE nonce seat is
 * free under a ceremony the family is still signing. Same shape from «Back» in
 * `preparing` + «Sign now» before prepare #1 returns (it. 31 §2's late release).
 *
 * The lease now names its sitting and a release must name the same one.
 * `opts.sittingId`:
 *   · `undefined` — a client from before the id: the rule as it was (deliberate
 *     compatibility; a browser that has not reloaded must keep its door);
 *   · a string — must equal the lease's, else `stale-sitting` and nothing moves;
 *   · `null` — a sitting-aware client whose sitting never received an id (it
 *     closed in `idle` or in `preparing`): it never leased anything, so it can
 *     only reach a lease WITHOUT a sitting (one written before this field).
 * The ownership floor stays first: a stranger is still `not-the-lessee`.
 */
export async function releaseCeremonySeatFor(
  account: string,
  userId: string,
  opts?: { sittingId?: string | null },
): Promise<SeatReleaseOutcome> {
  let row: { data: unknown; expiresAt: Date } | null = null;
  try {
    row = await prisma.cacheEntry.findUnique({
      where: { cacheKey: ceremonySeatKey(account) },
      select: { data: true, expiresAt: true },
    });
  } catch (e) {
    return { released: false, reason: 'unreadable', detail: (e as Error).message };
  }
  if (!row) return { released: false, reason: 'no-seat' };
  if (row.expiresAt.getTime() <= Date.now()) {
    await releaseCeremonySeat(account); // release #1, the same sweep as on read
    return { released: false, reason: 'no-seat' };
  }
  const seat = parseCeremonySeat(row.data);
  if (!seat) {
    // A lease that describes no seat blocks nothing (`findCeremonySeat` drops
    // it on sight); dropping it here too keeps the two halves saying the same.
    await releaseCeremonySeat(account);
    return { released: false, reason: 'no-seat' };
  }
  if (seat.preparedByUserId === null || seat.preparedByUserId !== userId) {
    return { released: false, reason: 'not-the-lessee' };
  }
  if (ceremonySittingIsStale(seat.sittingId, opts?.sittingId)) {
    return { released: false, reason: 'stale-sitting' };
  }
  const gone = await releaseCeremonySeat(account);
  return gone
    ? { released: true, reason: 'released' }
    : { released: false, reason: 'unreadable', detail: 'the lease could not be deleted' };
}

function parseCeremonySeat(data: unknown): Omit<CeremonySeat, 'ledgerSeat'> | null {
  const d = data as Partial<CeremonySeat> | null;
  if (!d || typeof d.account !== 'string') return null;
  if (typeof d.pinnedSequence !== 'number' || !Number.isInteger(d.pinnedSequence)) return null;
  return {
    account: d.account,
    pinnedSequence: d.pinnedSequence,
    txType: typeof d.txType === 'string' ? d.txType : 'Unknown',
    preparedAt: typeof d.preparedAt === 'string' ? d.preparedAt : new Date(0).toISOString(),
    preparedByUserId: typeof d.preparedByUserId === 'string' ? d.preparedByUserId : null,
    sittingId: typeof d.sittingId === 'string' && d.sittingId.length > 0 ? d.sittingId : null,
  };
}

/**
 * Is a synchronous ceremony holding this council's Sequence right now? The
 * twin of `findLiveProposal` (a persisted payload inside its deadline) and of
 * `findUnresolvedSeat` (a persisted payload past it) — one seat, three doors,
 * three ways of being held.
 *
 * Every release listed above is applied HERE, on read: expired lease, consumed
 * seat, unreadable row. Only a lease still inside its 30 minutes AND whose
 * Sequence the ledger has not consumed comes back as held.
 */
export async function findCeremonySeat(account: string): Promise<CeremonySeat | null> {
  let row: { data: unknown; expiresAt: Date } | null = null;
  try {
    row = await prisma.cacheEntry.findUnique({
      where: { cacheKey: ceremonySeatKey(account) },
      select: { data: true, expiresAt: true },
    });
  } catch (e) {
    // The lease store is an ADDITION to the guard: if it cannot be read the
    // compose doors keep the protection they already had, they do not lose it.
    console.warn('[council] ceremony seat NOT read:', (e as Error).message);
    return null;
  }
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await releaseCeremonySeat(account); // release #1
    return null;
  }
  const seat = parseCeremonySeat(row.data);
  if (!seat) {
    await releaseCeremonySeat(account);
    return null;
  }
  try {
    const accountSequence = await readAccountSequence(account);
    if (accountSequence > seat.pinnedSequence) {
      // Release #2 — those bytes are tefPAST_SEQ for ever, so the seat this
      // lease describes can no longer be taken by anybody. Unlike a persisted
      // proposal (whose broadcast is reported by a SEPARATE HTTP call that can
      // fail while the tx validates), the ceremony waits for the ledger's
      // verdict on its own screen before it finishes — so a consumed seat here
      // is a release, not a refusal that nobody would be able to clear.
      await releaseCeremonySeat(account);
      return null;
    }
    return { ...seat, ledgerSeat: 'unused' };
  } catch (e) {
    return { ...seat, ledgerSeat: 'unreadable', readError: (e as Error).message };
  }
}

/** One sentence for one refusal, so both compose doors say the same thing. */
export function ceremonySeatDetail(seat: CeremonySeat): string {
  const head =
    'A signing ceremony for this council (' + seat.txType + ') pinned Sequence ' + seat.pinnedSequence +
    ' at ' + seat.preparedAt + ' and that sitting has not finished. Composing here now pins the SAME Sequence: ' +
    'only one of the two can ever reach the ledger, and the one that loses keeps looking alive — which is how a ' +
    'council pays twice.';
  const tail =
    seat.ledgerSeat === 'unreadable'
      ? ' XRPL could not be read just now, so we cannot tell you whether that sitting already broadcast — that is a failure of ours, not a verdict.'
      : ' The ledger says that Sequence is still unused, so nothing has gone out yet.';
  return head + tail + ' Finish or abandon that sitting — the seat is released as soon as the transaction reaches ' +
    'the ledger, and in any case within 30 minutes of being pinned — then compose.';
}

/**
 * G1-cadena (round 2, finding 3): the refusal used to be the bare code
 * `PROPOSAL_NOT_LIVE`, which the browser printed verbatim — a dead end in front
 * of a member who had just signed on their phone. The ledger verdict already
 * exists at this point; it travels with the refusal, in words.
 */
function notLiveBody(p: { status: string; ledgerCheck?: LedgerCheck }) {
  return {
    error: 'PROPOSAL_NOT_LIVE',
    status: p.status,
    detail: p.ledgerCheck
      ? p.ledgerCheck.detail
      : 'This proposal is no longer collecting signatures (it was emitted, withdrawn or expired).',
    ...(p.ledgerCheck ? { ledgerCheck: p.ledgerCheck } : {}),
  };
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

  // productizer-it3 — WHO MAY PIN THIS COUNCIL'S SEQUENCE.
  //
  // WHAT FAILED IN SILENCE: this door asked nothing about the caller beyond
  // `requireLegacyAccess` (= any authenticated session). A stranger could POST
  // any r-address with a SignerList and persist a proposal on it; from that
  // moment `LIVE_PROPOSAL_EXISTS` refused the REAL council for PROPOSAL_TTL_MS
  // (7 days), renewable by withdraw + recompose — the ceremony-lease DoS
  // (`xrplDefi.ts`, round 5) with a week-long lease instead of 30 minutes.
  //
  // The floor is the same predicate every other write door here asks
  // (`sessionIsCouncilMember`), fed with the signer list read OFF THE LEDGER —
  // never one the caller supplies. It runs BEFORE the seat guards on purpose:
  // their refusals carry another council's proposal id, title and ledger
  // verdict, and a stranger must not read those here any more than on `GET /`.
  //
  // it. 17 (finding 2.1): that residual is CLOSED — membership is now a PROVEN
  // address (see `ownedSignerAddresses`), so a stranger who merely registered a
  // council's public signer address can no longer hold its Sequence for a week.
  let council: Awaited<ReturnType<typeof xrplProvider.getSignerCouncil>>;
  try {
    council = await withTimeout(
      xrplProvider.getSignerCouncil(account),
      SEQ_READ_TIMEOUT_MS,
      `signer list ${account}`,
    );
  } catch (e) {
    return void res.status(502).json({
      error: 'COUNCIL_READ_FAILED',
      detail:
        'XRPL could not be read, so we could not check that you sit on this council. Nothing was composed — try again in a moment. ' +
        `(${(e as Error).message})`,
    });
  }
  if (!council) {
    return void res.status(409).json({ error: 'NOT_A_COUNCIL', detail: new NotACouncilError(account).message });
  }
  if (!(await sessionIsCouncilMember(userId, { signerList: council.signers }, req.siwe?.walletAddress ?? null))) {
    return void res.status(403).json({
      error: 'NOT_A_COUNCIL_MEMBER',
      detail:
        'You do not hold a proven seat on this council, so you cannot propose on its behalf. Only a member of its ' +
        "signer list can compose a proposal — a proposal holds the account's only Sequence for days. " +
        PROVE_MEMBERSHIP_HINT,
    });
  }

  const live = await findLiveProposal(account);
  if (live) {
    return void res.status(409).json({
      error: 'LIVE_PROPOSAL_EXISTS',
      // g1-ceremonia (round 4): this sentence used to end in "emit, withdraw or
      // let it expire first", the same misdirection the ceremony door carried —
      // inside its deadline withdraw reads no ledger and issues no verdict, and
      // "let it expire" is the seven-day wait that then meets the seat guard.
      // The seat is settled in the inbox, on the proposal itself.
      detail:
        'This account already has a proposal collecting signatures, and XRPL pins one Sequence at a time. ' +
        'Settle that one in the proposal inbox first: finish collecting its signatures and broadcast it, or ' +
        'register the transaction hash if it has already gone out — any member can do either.',
      proposalId: live.id,
    });
  }

  // g1-ceremonia: the OTHER tempo of the very same seat. A ceremony pinned
  // this council's Sequence minutes ago and left a lease behind (see above);
  // composing here would pin the same one. 422, not 409, for the reason the
  // next block spells out: `proposeError` collapses every 409 into "let it
  // expire", and a ceremony has nothing the family can let expire.
  const ceremony = await findCeremonySeat(account);
  if (ceremony) {
    return void res.status(422).json({
      error: 'CEREMONY_IN_FLIGHT',
      detail: ceremonySeatDetail(ceremony),
      ceremonySeat: ceremony,
    });
  }

  // G1-cadena (finding 2): the deadline alone must not open this door — see
  // findUnresolvedSeat. NOT a 409: `proposeError` in GovernedMovements collapses
  // EVERY 409 into "already has a live proposal — let it expire", which here is
  // both false and the exact wrong instruction (letting it expire is what pays
  // twice). 422 falls through to `detail`, so the family reads the truth.
  const unresolved = await findUnresolvedSeat(account);
  if (unresolved) {
    return void res.status(422).json({
      error: 'PRIOR_SEAT_UNRESOLVED',
      detail:
        `A previous proposal on this account (${unresolved.title ?? unresolved.txType}) is not settled: ` +
        `${unresolved.ledgerCheck.detail} ` +
        'Composing another one now is exactly how a council pays twice. Open it in the proposal inbox, ' +
        'check the account on an explorer, and either register the transaction hash it produced (any member can) ' +
        'or file it (its proposer) — then compose.',
      proposalId: unresolved.proposalId,
      ledgerCheck: unresolved.ledgerCheck,
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
    // ── it. 29 (§2) — THE SECOND COORDINATOR THAT PINS A SEQUENCE, AND NEVER SAID SO ──
    //
    // WHAT FAILED IN SILENCE. `prepareCouncilMultisig` just fixed this council's
    // `Sequence` on these bytes — the exact fact `/multisign/prepare` records with
    // `stampCeremonyPin` so that `releaseAbandonedCeremonySeat` may free the 0xFE
    // nonce seat early (a pinned Sequence is what makes the twin impossible). This
    // door pinned the same way and recorded nothing, so a proposal that is later
    // WITHDRAWN answered `not-pinned-by-us` at the seat: the async tempo had
    // neither pin nor door, and its exits stayed walled for the row's 24 hours.
    //
    // Same fact, same writer, same best-effort: a store that refuses the mark does
    // not undo a proposal that already exists — it is said in the log, and the
    // store keeps the unwritten pin in memory (it. 29 §3) so the release door can
    // still act on it. Nothing here is read from the request body: the Sequence
    // is the one the coordinator just pinned, the memo is read off those bytes.
    const pinnedSequence = Number((prepared.multisigTx as { Sequence?: unknown }).Sequence);
    const pinnedMemo = zeroFeMemoOfTx(prepared.multisigTx);
    if (pinnedMemo && Number.isInteger(pinnedSequence) && pinnedSequence > 0) {
      // it. 34 (E): the proposal's own id IS its sitting id — the withdraw door
      // hands it back (`withdrawnProposalSeat`), so a proposal withdrawn after a
      // NEWER sitting re-pinned these bytes cannot free that sitting's seat.
      await stampCeremonyPin(pinnedMemo, account, pinnedSequence, { sittingId: proposal.id }).catch((e) => {
        console.warn('[council] proposal pin NOT stamped:', (e as Error)?.message ?? e);
      });
    }
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
  // g1-ceremonia (round 4): see `mayReadProposal`. This listing used to hand
  // the whole acta of any account to any authenticated session.
  const userId = req.siwe?.userId;
  if (!userId) return void res.status(401).json({ error: 'missing_siwe_session' });
  const raw = String(req.query.accounts ?? '');
  const accounts = raw
    .split(',')
    .map((a) => a.trim())
    .filter((a) => XRPL_ADDRESS_RE.test(a));
  if (accounts.length === 0) {
    return void res.status(400).json({ error: 'MISSING_ACCOUNTS', detail: 'accounts=rA,rB (XRPL r… addresses)' });
  }
  const onlyLive = req.query.status === 'live';
  /**
   * it. 25 (2) — LA LECTURA DEL LISTADO, DENTRO DE SU GUARDA.
   *
   * `GET /:id` ya envolvía la suya en it. 23; ESTA no. Con la base de datos
   * parpadeando, `asyncHandler` mandaba el rechazo al middleware global y la bandeja
   * entera del consejo contestaba un 500 crudo — sin `retryable`, sin frase, y del
   * mismo color que «no tienes nada». Un 503 reintentable es la verdad: no pudimos
   * leer, no se escribió nada, y una salida jamás se cierra por una avería nuestra.
   */
  const readRows = () =>
    prisma.councilProposal.findMany({
      where: {
        account: { in: accounts },
        ...(onlyLive ? { status: { in: [...LIVE_STATUSES] } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { signatures: signatureSummary, positions: { select: { memberAccount: true, stance: true, comment: true } } },
    });
  let rows: Awaited<ReturnType<typeof readRows>>;
  try {
    rows = await readRows();
  } catch (e) {
    return void res.status(503).json({
      error: 'PROPOSALS_READ_UNREADABLE',
      retryable: true,
      detail:
        'We could not read this council’s proposal inbox just now, so we will not tell you it is empty either — that ' +
        'would be a statement we cannot make, and an empty inbox is exactly what a family reads as «nothing needs ' +
        'me». Nothing was written and nothing moved. Try again in a moment; a signature ceremony is never closed by ' +
        `a failure of ours. (${safeErrorDetail(e)})`,
    });
  }
  // g1-ceremonia (round 4): filter BEFORE the ledger reads — a stranger's
  // query must not spend `account_info` calls on another family's rows either.
  // ONE registry read for the whole listing (`ownedSignerAddresses`), never one
  // per proposal.
  // it. 19 (finding 2.3): the READ floor — proven OR registered. These bytes are the
  // only ones a cosignatory can sign, so a registry must never be what keeps a
  // council from reaching its quorum on an exit.
  // it. 21 (2.1 / 3.7): the same floor, asked for a VERDICT — proven, registered,
  // neither, or «I could not read» — so an outage answers 503 retryable instead of
  // the false 403 «none of your addresses is on this list», and a registered-only
  // session gets the signing material without the family's deliberation.
  const members = [...new Set(rows.flatMap((row) => memberAddressesOf(row)))];
  const access = await councilReadAccess(userId, members, req.siwe?.walletAddress ?? null);
  const levelOf = new Map(rows.map((row) => [row.id, councilReadLevelFor(userId, access, row)] as const));
  const mine = rows.filter((row) => {
    const level = levelOf.get(row.id);
    return level === 'proven' || level === 'registered';
  });
  /**
   * it. 23 (2.4) — LA FILA QUE NO SE PUDO DECIDIR NO SE TIRA.
   *
   * Antes: si TODAS eran indecidibles, 503; si alguna se decidía, el filtro `mine` se
   * quedaba con ella y las indecidibles desaparecían del 200 sin una palabra. En un
   * listado mixto eso es silencio donde debía haber error — sobre los únicos bytes que
   * un cosignatario puede firmar.
   *
   * Ahora: si NADA es mío y hay alguna indecidible, la respuesta entera es el 503 (o el
   * 409 determinista que el módulo de identidad dice que se debe), nunca el 403 «no
   * eres» — que sería una afirmación falsa sobre la persona. Y si hay filas mías, van
   * en `proposals` y las indecidibles viajan nombradas en `unreadable`, con su código
   * y su frase, para que la pantalla diga «estas N no las pude leer, vuelve a
   * intentarlo» en vez de no enseñarlas.
   */
  const unreadableRows = rows.filter((row) => levelOf.get(row.id) === 'unreadable');
  const owedForUnreadable = (): { status: number; body: Record<string, unknown> } => {
    const owed = access.refusal;
    return { status: owed?.status ?? 503, body: (owed ?? councilReadUnreadableBody(access.failure)) as Record<string, unknown> };
  };
  // Rows exist for the asked accounts and NONE of them is this session's: say
  // so. An empty `proposals` array would read as "this council has no
  // proposals", which is a different sentence and a false one.
  if (rows.length > 0 && mine.length === 0) {
    if (unreadableRows.length > 0) {
      const owed = owedForUnreadable();
      return void res.status(owed.status).json(owed.body);
    }
    return void res.status(403).json({
      error: 'NOT_A_COUNCIL_MEMBER',
      detail:
        'These proposals belong to a council none of your addresses sits on. The inbox of a council is readable by ' +
        'its signer list and by whoever composed each proposal. ' + READ_MEMBERSHIP_HINT,
    });
  }
  // G1-cadena (finding 4): this loop used to be SEQUENTIAL — every row awaited
  // the previous one's ledger read, so a slow node multiplied its timeout by the
  // number of rows. Concurrent + the promise cache: rows of the same account
  // share one in-flight read, and distinct accounts no longer queue behind
  // each other. Worst case is now one timeout, not one per row.
  /**
   * it. 25 (2) — UNA FILA MALA NO TUMBA EL LISTADO ENTERO, Y LA ESCRITURA VIVE
   * DENTRO DE LA GUARDA.
   *
   * QUÉ FALLABA EN SILENCIO: `withEffectiveStatus` no es una lectura — archiva la
   * fila (`prisma.councilProposal.update`) cuando el ledger confirma que su asiento
   * nunca se gastó, y antes de eso PREGUNTA al ledger. Las dos cosas fallan solas: un
   * nodo XRPL caído, un `txjson` corrupto de UNA fila, un timeout. Estaba dentro de
   * un `Promise.all` sin guarda, así que ese único fallo salía por el middleware
   * global como un 500 crudo y se llevaba por delante TODAS las demás propuestas del
   * consejo — incluidas las de una salida que estaba recogiendo firmas.
   *
   * Ahora cada fila responde por sí misma: la que se pudo poner al día se sirve, y la
   * que no viaja nombrada en `unreadable` con su código y su reintento. «No pude
   * leer» sobre una fila no es un veredicto sobre las otras.
   */
  const settled = await Promise.all(
    mine.map(async (row) => {
      try {
        return { ok: true as const, row: await withEffectiveStatus(row) };
      } catch (e) {
        return { ok: false as const, row, failure: safeErrorDetail(e) };
      }
    }),
  );
  const checked = settled.flatMap((s) => (s.ok ? [s.row] : []));
  const statusUnreadable = settled.flatMap((s) => (s.ok ? [] : [{ row: s.row, failure: s.failure }]));
  // G1-guard: past the deadline the row may keep a live status (consumed or
  // unverified seat), so `status=live` filters on the DEADLINE too — same
  // outcome as before, without needing the DB to have been lied to.
  const open = onlyLive ? checked.filter((p) => isOpen(p)) : checked;
  // it. 21 (3.7): a REGISTERED-only session reads the signing material of every row
  // it can act on, and the deliberation of none it did not write itself.
  const proposals = open.map((row) =>
    levelOf.get(row.id) === 'registered' ? redactActaForRegistered(row as unknown as Record<string, unknown>) : row,
  );
  // it. 23 (2.4): las indecidibles, nombradas. `error`/`retryable`/`detail` son el
  // MISMO cuerpo que llevaría la respuesta entera si no hubiese nada legible, así que
  // la pantalla usa un solo lector para los dos sitios. Ni un título ni una posición:
  // de una fila que no pudimos decidir no se sirve deliberación ninguna.
  const unreadableEntries: Array<Record<string, unknown>> = [
    ...unreadableRows.map((row) => ({ id: row.id, account: row.account, ...owedForUnreadable().body })),
    // it. 25 (2): la fila que SÍ es mía y cuyo estado no se pudo poner al día. Mismo
    // canal, mismo contrato — un solo lector en la pantalla para los dos motivos.
    ...statusUnreadable.map(({ row, failure }) => ({
      id: row.id,
      account: row.account,
      error: 'PROPOSAL_STATUS_UNREADABLE',
      retryable: true,
      detail:
        'We could not bring this proposal up to date just now — the ledger check that decides whether its pinned ' +
        'Sequence is still unused did not answer — so we are not showing it rather than showing it with a state we ' +
        'did not verify. Nothing was written and nothing moved. Open it on its own, or try again in a moment; if ' +
        `these are the bytes of an exit, it is never refused for a failure of ours. (${failure})`,
    })),
  ];
  const unreadable = unreadableEntries.length > 0 ? unreadableEntries : null;
  return void res.json({ proposals, ...(unreadable ? { unreadable } : {}) });
}));

// GET /:id — full detail, blobs included (the combining browser needs them).
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  // g1-ceremonia (round 4): the widest read of the router — it carries the
  // members' signed blobs, which is the material a browser combines and
  // broadcasts. Same floor as the write doors (see `mayReadProposal`).
  const userId = req.siwe?.userId;
  if (!userId) return void res.status(401).json({ error: 'missing_siwe_session' });
  /**
   * it. 23 (2.5) — UNA LECTURA QUE FALLA NO ES UN 500, Y DESDE LUEGO NO ES UN 404.
   *
   * QUÉ FALLABA EN SILENCIO: esta ruta —la más ancha del router, la que lleva los
   * blobs que un navegador combina y difunde— leía la fila sin guarda. Con la base de
   * datos parpadeando, `asyncHandler` mandaba el rechazo al middleware global y el
   * cosignatario recibía un 500 crudo, sin `retryable`, sin frase y sin distinguirlo
   * de «esta propuesta no existe». Un 503 reintentable es la verdad: no pudimos leer,
   * no se escribió nada, y una salida jamás se cierra por una avería nuestra.
   */
  let row: Awaited<ReturnType<typeof prisma.councilProposal.findUnique>>;
  try {
    row = await prisma.councilProposal.findUnique({
      where: { id: req.params.id },
      include: { signatures: { orderBy: { signedAt: 'asc' } }, positions: true },
    });
  } catch (e) {
    return void res.status(503).json({
      error: 'PROPOSAL_READ_UNREADABLE',
      retryable: true,
      detail:
        'We could not read this proposal just now, so we will not tell you it is missing either — that would be a ' +
        'statement we cannot make. Nothing was written and nothing moved. Try again in a moment; if these are the ' +
        'bytes of an exit you are gathering signatures for, it is never refused for a failure of ours. ' +
        `(${safeErrorDetail(e)})`,
    });
  }
  if (!row) return void res.status(404).json({ error: 'NOT_FOUND' });
  // it. 19 (finding 2.3): the widest READ of the router is also the one a
  // cosignatory needs before they can sign anything — the blobs to combine live
  // here. Proven OR registered; every WRITE keeps the proof, and the signature door
  // verifies the blob cryptographically anyway.
  //
  // it. 21 (2.1): a store we could not read answers 503 RETRYABLE. The old 403 said
  // «none of your addresses is on this list» — a statement about the user that was
  // false, over the only bytes a cosignatory can sign. A quorum on a recall was
  // therefore unreachable because of an outage of ours, which is a registry closing
  // an exit by another name.
  //
  // it. 21 (3.7): and a REGISTERED-only session reads the SIGNING MATERIAL, not the
  // family's deliberation — see `councilReadAccess` above for why the line is drawn
  // exactly there.
  const access =
    row.createdByUserId !== null && row.createdByUserId === userId
      ? ({
          proven: new Set<string>(),
          registered: new Set<string>(),
          readable: true,
          // it. 23 (2.4): el proponente lee la suya entera sin consultar nada, así que
          // las dos lecturas «fueron bien» por vacuidad — nunca 'unreadable'.
          proofReadable: true,
          registryReadable: true,
        } as CouncilReadAccess)
      : await councilReadAccess(userId, memberAddressesOf(row), req.siwe?.walletAddress ?? null);
  const level = councilReadLevelFor(userId, access, row);
  if (level === 'unreadable') {
    const owed = access.refusal;
    return void res
      .status(owed?.status ?? 503)
      .json(owed ?? councilReadUnreadableBody(access.failure));
  }
  if (level === 'none') {
    return void res.status(403).json({
      error: 'NOT_A_COUNCIL_MEMBER',
      detail:
        'This proposal belongs to a council none of your addresses sits on. Only its signer list, and whoever ' +
        'composed it, can read its signatures. ' + READ_MEMBERSHIP_HINT,
    });
  }
  /**
   * it. 25 (2) — LA GUARDA ENVOLVÍA SOLO LA LECTURA, Y ESTO NO ES UNA LECTURA.
   *
   * it. 23 puso el `try` alrededor del `findUnique` y dejó FUERA la única llamada de
   * esta ruta que ESCRIBE: `withEffectiveStatus` archiva la fila cuando el ledger
   * confirma que su asiento nunca se gastó, y para saberlo interroga al ledger. Con
   * el nodo XRPL caído —o con un `txjson` que no parsea— el 503 honesto de arriba se
   * saltaba y salía el 500 crudo que it. 23 dijo haber cerrado, sobre los bytes más
   * anchos del router: los blobs que un navegador combina y difunde.
   */
  try {
    const proposal = await withEffectiveStatus(row);
    return void res.json({
      proposal:
        level === 'registered' ? redactActaForRegistered(proposal as unknown as Record<string, unknown>) : proposal,
    });
  } catch (e) {
    return void res.status(503).json({
      error: 'PROPOSAL_STATUS_UNREADABLE',
      retryable: true,
      detail:
        'We read this proposal, but we could not bring its state up to date: the ledger check that decides whether ' +
        'its pinned Sequence is still unused did not answer. We will not hand you a state we did not verify — a ' +
        'proposal shown as live when its seat may already be spent is how a council pays twice. Nothing was written ' +
        `and nothing moved. Try again in a moment. (${safeErrorDetail(e)})`,
    });
  }
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
  // G1-guard: the deadline closes the proposal even when the server could not
  // archive it (a consumed or unverified seat keeps its stored status). The
  // ledger verdict travels with the refusal so the caller is not left guessing.
  if (!isOpen(p)) {
    return void res.status(409).json(notLiveBody(p));
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

/**
 * The fingerprint of an acta's SET of positions — ONE definition: composed by
 * `/positions/anchor/prepare` into the anchor memo and checked against the
 * ledger by `/positions/anchored`. Two copies would be how the halves drift.
 */
function actaBatchHash(positions: Array<{ contentHash: string }>): string {
  return sha256Hex(
    positions
      .map((x) => x.contentHash)
      .sort()
      .join('\n'),
  );
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
  // G1-guard: same deadline gate as the signature route (see there).
  if (!isOpen(p)) {
    return void res.status(409).json(notLiveBody(p));
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
  // g1-ceremonia (round 4) — THE ORDER MATTERS ON THIS DOOR. The flow is
  // prepare → the emitter signs and BROADCASTS it on XRPL → `/positions/
  // anchored`. Only that last call carried an ownership check, so the verdict
  // arrived AFTER a transaction had already been spent on the ledger: the
  // stranger paid the drop and the fee, got 403, and `positionsAnchor` stayed
  // null — so the button offered itself again. A loop of anchors paid for and
  // never recorded. Same floor as `/positions/anchored`, one step earlier.
  const userId = req.siwe?.userId;
  if (!userId) return void res.status(401).json({ error: 'missing_siwe_session' });
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
  if (p.createdByUserId !== userId && !(await sessionIsCouncilMember(userId, p, req.siwe?.walletAddress ?? null))) {
    return void res.status(403).json({
      error: 'NOT_A_COUNCIL_MEMBER',
      detail:
        'This proposal belongs to a council you are not a proven member of. Only its members can anchor its acta — ' +
        'and the anchor costs a transaction on the ledger, so you are told before you sign it, not after. ' +
        PROVE_MEMBERSHIP_HINT,
    });
  }
  if (p.positions.length === 0) {
    return void res.status(409).json({ error: 'NO_POSITIONS_TO_ANCHOR' });
  }
  if (p.positionsAnchor) {
    return void res.status(409).json({ error: 'ALREADY_ANCHORED', txHash: p.positionsAnchor });
  }
  const batchHash = actaBatchHash(p.positions);
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
  // permisos-y-doble-pago: this door read NO session at all — the exact hole
  // `/submitted` had before round 3, on a door that writes a txHash (the acta's
  // on-chain proof) onto ANY row in the table. Same floor, same helper, same
  // error code as `/submitted` and `/withdraw`: the proposer, or a member of
  // THIS council's signer list. The anchor is emitted from a member's own
  // wallet (FormalPositions signs it with the connected Xaman address), so the
  // registry answer for a real anchorer is a row that already exists.
  const userId = req.siwe?.userId;
  if (!userId) return void res.status(401).json({ error: 'missing_siwe_session' });
  const parsed = submittedSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  const row = await prisma.councilProposal.findUnique({
    where: { id: req.params.id },
    include: { positions: { select: { contentHash: true } } },
  });
  if (!row) return void res.status(404).json({ error: 'NOT_FOUND' });
  if (row.createdByUserId !== userId && !(await sessionIsCouncilMember(userId, row, req.siwe?.walletAddress ?? null))) {
    return void res.status(403).json({
      error: 'NOT_A_COUNCIL_MEMBER',
      detail:
        'This proposal belongs to a council you are not a proven member of. Only its members can record the ledger ' +
        'hash of its acta anchor. ' + PROVE_MEMBERSHIP_HINT,
    });
  }
  // g1-ceremonia (round 4) — THE TWO HALVES DISAGREED. `prepare` refuses to
  // compose a second anchor for a proposal that has one (409 ALREADY_ANCHORED),
  // while this door OVERWROTE the stored hash without a word: the acta's
  // on-chain proof — the thing the whole batch anchor exists to produce — could
  // be repointed at another transaction, and FormalPositions would render the
  // new one as if it had always been it. `prepare` is the correct half: the
  // acta is immutable once fixed (same doctrine as POSITION_ALREADY_SET). The
  // one write that stays allowed is the IDENTICAL hash, because that is the
  // browser reporting the same anchor twice, not a second anchor.
  if (row.positionsAnchor && row.positionsAnchor !== parsed.data.txHash) {
    return void res.status(409).json({
      error: 'ALREADY_ANCHORED',
      txHash: row.positionsAnchor,
      detail:
        'The acta of this proposal is already anchored on the ledger, and that record is not replaced: it is the ' +
        'public timestamp of what the council decided. If the anchor you signed is a different transaction, the ' +
        'existing one still stands.',
    });
  }
  if (row.positionsAnchor === parsed.data.txHash) {
    // Idempotent re-report: nothing to write, and NOT an error to the browser
    // that is simply telling us again.
    return void res.json({ ok: true, proposal: row });
  }
  // productizer-it3 — READ THE ANCHOR, NEVER TRUST IT.
  //
  // WHAT FAILED IN SILENCE: this door recorded ANY 64-hex string as the acta's
  // on-chain proof without asking the ledger, and round 4 made that record
  // IMMUTABLE (ALREADY_ANCHORED). A mistyped hash, a tec-failed anchor, or a
  // member's unrelated Payment froze itself as "anchored on-chain" for ever,
  // with an explorer link that proves nothing about this acta.
  //
  // So the hash has to prove what it claims, exactly as `/submitted` does: a
  // VALIDATED tesSUCCESS Payment to THIS council account whose memo is exactly
  // the fingerprint `prepare` composes for the positions on file now. The
  // emitter `Account` is not checked: `prepare` takes it from the caller and
  // persists nothing, so there is no pinned value to compare — the memo (the
  // hash of signed contents that name this proposal) is what binds the anchor.
  const positions = row.positions ?? [];
  if (positions.length === 0) {
    return void res.status(409).json({ error: 'NO_POSITIONS_TO_ANCHOR' });
  }
  const expectedMemo = `${ACTA_MEMO_PREFIX}${actaBatchHash(positions)}`;
  const onLedger = await readReportedCouncilTx(parsed.data.txHash);
  if (!onLedger.ok || onLedger.result !== 'tesSUCCESS') {
    return void res.status(409).json({
      error: 'ANCHOR_NOT_ON_LEDGER',
      ...(onLedger.result ? { transactionResult: onLedger.result } : {}),
      detail: !onLedger.ok
        ? onLedger.detail
        : onLedger.result === null
          ? 'The ledger returned this transaction without a result code, so we cannot tell whether it applied. Nothing is recorded — check it on an explorer and report it again.'
          : `That anchor reached the ledger but FAILED with ${onLedger.result}: nothing was anchored (only its fee was spent). ` +
            'The acta is still unanchored — prepare the anchor again and sign it anew.',
    });
  }
  if (
    onLedger.transactionType !== 'Payment' ||
    onLedger.destination !== row.account ||
    !onLedger.memoTexts.includes(expectedMemo)
  ) {
    return void res.status(409).json({
      error: 'ANCHOR_MISMATCH',
      detail:
        `That transaction is on the ledger, but it is not the anchor of THIS acta: the anchor is a Payment to ${row.account} ` +
        'whose memo carries the fingerprint of the positions on file. If a position was filed after the anchor was ' +
        'prepared, that anchor no longer covers the whole set — prepare it again. Nothing is recorded.',
    });
  }
  const proposal = await prisma.councilProposal.update({
    where: { id: row.id },
    data: { positionsAnchor: parsed.data.txHash },
  });
  return void res.json({ ok: true, proposal });
}));

// POST /:id/submitted — the broadcasting browser reports the ledger hash.
// arriendo-ceremonia (round 5): the floor is the SHAPE of an XRPL hash, not a
// length range — see XRPL_TX_HASH_RE above for why the anchored door made that
// difference permanent. The refusal says what a hash looks like, because this
// is the a-posteriori recovery door: somebody is copying it from an explorer.
const submittedSchema = z.object({
  txHash: z
    .string()
    .trim()
    .regex(XRPL_TX_HASH_RE, 'not an XRPL transaction hash (64 hexadecimal characters)'),
});

/**
 * What the ledger says about a reported council hash. The report becomes the
 * row's ledger truth and launches the executor-paid relay, and council
 * membership still rests on wallet rows (productizer cycle, iteration 2: a
 * watch-only row of a member's public address passes it). So the report itself
 * has to prove what it claims: a VALIDATED transaction of this council account.
 */
// One shape, not a discriminated union: this backend compiles without
// strictNullChecks, where `if (!x.ok)` does not narrow a union on `ok`.
interface ReportedCouncilTx {
  /** The ledger has it AND validated it. Says nothing about whether it APPLIED — see `result`. */
  ok: boolean;
  account: string;
  sequence: number | null;
  /**
   * productizer-it3: `meta.TransactionResult`. A validated `tec*` is the trap —
   * it reached a ledger, burnt its Sequence and its fee, and moved NOTHING.
   * `null` when the node answered without a result.
   */
  result: string | null;
  transactionType: string;
  destination: string;
  /**
   * productizer-it6: the Payment amount — a drops string or an IOU/MPT object.
   * `null` when the tx carries none. api_version 2 renames a Payment's `Amount`
   * to `DeliverMax` in `tx_json`, so both spellings are read.
   */
  amount: unknown;
  /** Every MemoData decoded as UTF-8 (non-hex entries dropped). */
  memoTexts: string[];
  /** productizer-it6: every MemoData as the raw hex, upper-cased, in ledger order. */
  memoData: string[];
  detail: string;
}

/** Raw MemoData hex of a txjson's Memos, upper-cased, in order (non-strings dropped). */
function memoDataOf(tx: Record<string, unknown>): string[] {
  const memos = Array.isArray(tx.Memos) ? (tx.Memos as Array<{ Memo?: { MemoData?: unknown } }>) : [];
  return memos
    .map((m) => m?.Memo?.MemoData)
    .filter((d): d is string => typeof d === 'string')
    .map((d) => d.toUpperCase());
}

async function readReportedCouncilTx(hash: string): Promise<ReportedCouncilTx> {
  try {
    const { xrplJsonRpc } = await import('../services/flare/DirectMintExecutorService');
    const r = (await xrplJsonRpc('tx', { transaction: hash, binary: false })) as Record<string, unknown>;
    // api_version 1 returns the tx fields flat; 2 nests them in tx_json. `meta`
    // sits beside them in both.
    const tx = (r.tx_json ?? r) as Record<string, unknown>;
    const account = String(tx.Account ?? '');
    const sequence = typeof tx.Sequence === 'number' ? tx.Sequence : null;
    const meta = r.meta as { TransactionResult?: unknown } | null | undefined;
    const result = meta && typeof meta === 'object' && typeof meta.TransactionResult === 'string' ? meta.TransactionResult : null;
    const memoData = memoDataOf(tx);
    const memoTexts = memoData
      .filter((d) => d.length % 2 === 0 && /^[0-9A-F]*$/.test(d))
      .map((d) => Buffer.from(d, 'hex').toString('utf8'));
    const shape = {
      account,
      sequence,
      result,
      transactionType: String(tx.TransactionType ?? ''),
      destination: String(tx.Destination ?? ''),
      amount: tx.Amount ?? tx.DeliverMax ?? null,
      memoTexts,
      memoData,
    };
    if (r.validated !== true) {
      return { ok: false, ...shape, detail: 'The ledger has this transaction but has not validated it yet — report it again in a few seconds.' };
    }
    return { ok: true, ...shape, detail: '' };
  } catch {
    return {
      ok: false,
      account: '',
      sequence: null,
      result: null,
      transactionType: '',
      destination: '',
      amount: null,
      memoTexts: [],
      memoData: [],
      detail: 'This hash is not a validated transaction on the XRP Ledger (not found, or no node answered). Check it on an explorer and report it again.',
    };
  }
}

/**
 * productizer-it6 — canonical form of a decimal amount string, so "10.50",
 * "10.5" and "1.05e1" (the codec may normalise an IOU value) compare equal.
 * `null` when unparseable.
 */
function canonicalDecimal(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const m = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(v).trim());
  if (!m || (!m[2] && !m[3])) return null;
  const frac = m[3] ?? '';
  let digits = `${m[2] ?? ''}${frac}`.replace(/^0+/, '');
  let exp = Number(m[4] ?? 0) - frac.length;
  if (!digits) return '0';
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    exp += 1;
  }
  return `${m[1] === '-' ? '-' : ''}${digits}e${exp}`;
}

/** Drops string vs drops string, or IOU/MPT object vs object (value compared canonically). */
function amountsMatch(stored: unknown, onLedger: unknown): boolean {
  const absent = (a: unknown) => a === undefined || a === null;
  if (absent(stored) || absent(onLedger)) return absent(stored) && absent(onLedger);
  if (typeof stored === 'string' || typeof onLedger === 'string') {
    if (typeof stored !== 'string' || typeof onLedger !== 'string') return false;
    return /^\d+$/.test(stored) && /^\d+$/.test(onLedger) && BigInt(stored) === BigInt(onLedger);
  }
  if (typeof stored !== 'object' || typeof onLedger !== 'object') return false;
  const s = stored as Record<string, unknown>;
  const l = onLedger as Record<string, unknown>;
  for (const k of new Set([...Object.keys(s), ...Object.keys(l)])) {
    if (k === 'value') {
      const a = canonicalDecimal(s.value);
      if (a === null || a !== canonicalDecimal(l.value)) return false;
      continue;
    }
    const a = s[k];
    const b = l[k];
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    // Non-ISO currency codes (40 hex) and MPT issuance ids are hex: the codec
    // upper-cases them. A 3-character ISO code stays case-sensitive.
    const hex = (k === 'currency' && a.length === 40) || k === 'mpt_issuance_id';
    if (hex ? a.toUpperCase() !== b.toUpperCase() : a !== b) return false;
  }
  return true;
}

function describeAmount(a: unknown): string {
  if (a === undefined || a === null) return 'none';
  if (typeof a === 'string') return `${a} drops`;
  try {
    return JSON.stringify(a);
  } catch {
    return 'unreadable';
  }
}

/** Does the stored txjson carry anything beyond its type that singles its transaction out? */
function hasIdentityBeyondType(stored: Record<string, unknown>): boolean {
  const dest = stored.Destination;
  return (
    (typeof dest === 'string' && dest.length > 0) ||
    (stored.Amount ?? stored.DeliverMax ?? null) !== null ||
    memoDataOf(stored).length > 0
  );
}

/**
 * productizer-it6 — is the reported ledger tx THIS proposal's transaction?
 * The members signed exact bytes, so the real emission carries exactly the
 * stored TransactionType, Destination, Amount and memos. Returns a readable
 * reason for the first difference, or null when it is the same transaction.
 */
function proposalIdentityMismatch(stored: Record<string, unknown>, onLedger: ReportedCouncilTx): string | null {
  const type = typeof stored.TransactionType === 'string' ? stored.TransactionType : '';
  if (!type || onLedger.transactionType !== type) {
    return `it is a ${onLedger.transactionType || 'transaction of unknown type'}, and this proposal is a ${type || 'transaction of unknown type'}`;
  }
  const dest = typeof stored.Destination === 'string' ? stored.Destination : '';
  if (onLedger.destination !== dest) {
    return dest
      ? `it goes to ${onLedger.destination || 'no destination'}, and this proposal goes to ${dest}`
      : `it names destination ${onLedger.destination}, and this proposal names none`;
  }
  const storedAmount = stored.Amount ?? stored.DeliverMax ?? null;
  if (!amountsMatch(storedAmount, onLedger.amount)) {
    return `its amount (${describeAmount(onLedger.amount)}) is not this proposal's (${describeAmount(storedAmount)})`;
  }
  const memos = memoDataOf(stored);
  if (memos.length !== onLedger.memoData.length || memos.some((d, i) => d !== onLedger.memoData[i])) {
    return 'its memos are not the ones this proposal carries';
  }
  return null;
}

router.post('/:id/submitted', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.siwe?.userId;
  if (!userId) return void res.status(401).json({ error: 'missing_siwe_session' });
  const parsed = submittedSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  const row = await prisma.councilProposal.findUnique({ where: { id: req.params.id } });
  if (!row) return void res.status(404).json({ error: 'NOT_FOUND' });
  // puertas-y-permiso (round 3): this door was open to any authenticated
  // session BEFORE round 3 too, and it writes more than a word — the reported
  // hash becomes the row's ledger truth AND launches the FDC relay below,
  // which spends the executor's FLR. The doctrine is already written in the
  // withdraw refusal ("register its hash instead: any member can do that"), so
  // hold it to exactly that: a member of this council, or the proposer.
  if (row.createdByUserId !== userId && !(await sessionIsCouncilMember(userId, row, req.siwe?.walletAddress ?? null))) {
    return void res.status(403).json({
      error: 'NOT_A_COUNCIL_MEMBER',
      detail:
        'This proposal belongs to a council you are not a proven member of. Only its members can register the ' +
        'transaction hash it produced. ' + PROVE_MEMBERSHIP_HINT,
    });
  }
  // NO deadline check here, and no lazy expiry either — ON PURPOSE (G1-guard).
  // This is the a-posteriori registration door: a proposal that WAS broadcast
  // but whose report failed can be reported days later, and blocking it on the
  // deadline would bury the very transaction we are trying to account for.
  if (row.status !== 'ready') {
    return void res.status(409).json({ error: 'QUORUM_NOT_MET', status: row.status });
  }
  // Read, never trust: the hash must be a validated tx of THIS council account,
  // with the Sequence this proposal pinned (when it pinned one).
  const onLedger = await readReportedCouncilTx(parsed.data.txHash);
  if (!onLedger.ok) {
    return void res.status(409).json({ error: 'TX_NOT_VALIDATED', detail: onLedger.detail });
  }
  const storedTx = (row.txjson && typeof row.txjson === 'object' ? row.txjson : {}) as unknown as Record<string, unknown>;
  const pinnedSequence = storedTx.Sequence;
  if (onLedger.account !== row.account || (typeof pinnedSequence === 'number' && onLedger.sequence !== pinnedSequence)) {
    return void res.status(409).json({
      error: 'TX_NOT_THIS_PROPOSAL',
      detail: `That transaction was sent by ${onLedger.account || 'another account'}${onLedger.sequence !== null ? ` with Sequence ${onLedger.sequence}` : ''} — this proposal belongs to ${row.account}${typeof pinnedSequence === 'number' ? ` at Sequence ${pinnedSequence}` : ''}.`,
    });
  }
  // productizer-it6 — THE SEAT IS NOT THE TRANSACTION.
  //
  // WHAT FAILED IN SILENCE: account + pinned Sequence + tesSUCCESS proves that
  // SOMETHING of this council used the seat, not that it was THIS proposal. A
  // different tx that consumed the Sequence (an AccountSet, a payment composed
  // elsewhere) was recorded as the proposal's emission, the inbox said
  // "emitted", and a council order launched the executor-paid FDC relay with
  // the row's txjson — for bytes that never went out. And a row with no
  // numeric Sequence accepted ANY tesSUCCESS tx of the account.
  //
  // The members signed exact bytes, so the ledger copy of the real emission
  // carries exactly the stored TransactionType, Destination, Amount and memos.
  if (typeof pinnedSequence !== 'number' && !hasIdentityBeyondType(storedTx)) {
    return void res.status(409).json({
      error: 'TX_NOT_THIS_PROPOSAL',
      detail:
        'This proposal pinned no Sequence and its transaction carries nothing else that tells it apart (no destination, ' +
        'amount or memo), so no reported hash can be matched to it. Nothing is recorded and no relay is launched.',
    });
  }
  const identityMismatch = proposalIdentityMismatch(storedTx, onLedger);
  if (identityMismatch) {
    return void res.status(409).json({
      error: 'TX_NOT_THIS_PROPOSAL',
      detail:
        `That transaction was sent by ${row.account}${onLedger.sequence !== null ? ` with Sequence ${onLedger.sequence}` : ''}, ` +
        `but it is not this proposal: ${identityMismatch}. Nothing is recorded and no relay is launched. If a different ` +
        'transaction used this proposal\'s seat, these signatures can never be broadcast — withdraw it and compose it again.',
    });
  }
  // productizer-it3 — VALIDATED IS NOT PAID.
  //
  // WHAT FAILED IN SILENCE: the read above asked only `validated`. A validated
  // `tec*` (unfunded, no trust line, destination requires a tag…) matches the
  // account AND the pinned Sequence — XRPL consumes the Sequence either way —
  // so the row became `submitted`, the inbox said "emitted" and a council order
  // launched the FDC relay: the family was told it paid, and nothing moved.
  // Nothing is recorded; the refusal says what did happen and what to do.
  if (onLedger.result !== 'tesSUCCESS') {
    if (onLedger.result === null) {
      return void res.status(409).json({
        error: 'TX_NOT_VALIDATED',
        detail:
          'The ledger returned this transaction without a result code, so we cannot tell whether it applied. Nothing is recorded — check it on an explorer and report it again.',
      });
    }
    const seat = typeof pinnedSequence === 'number' ? `Sequence ${pinnedSequence}` : 'its Sequence';
    return void res.status(409).json({
      error: 'TX_FAILED_ON_LEDGER',
      transactionResult: onLedger.result,
      detail:
        `That transaction reached the ledger but FAILED with ${onLedger.result}: nothing moved. The fee was charged and ` +
        `${seat} was spent, so these signatures can never be broadcast again. Nothing is recorded as emitted — ` +
        'this proposal must be prepared again: withdraw it, fix the cause, compose it anew and collect fresh signatures.',
    });
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
      } else if (!XRPL_TX_HASH_RE.test(parsed.data.txHash)) {
        // Belt AND braces: `submittedSchema` now enforces the same shape, so a
        // body that reaches here already passed it. Kept — this branch is what
        // stops the executor's FLR being spent on a hash the ledger cannot have
        // (2026-07-18 fee burn), and it must not depend on a schema staying put.
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

// POST /:id/withdraw — the proposer's app-account, only while live (with one
// exception past the deadline, see finding 3 below).
//
// G1-cadena (round 2, finding 5) — WHAT FAILED IN SILENCE: this route read
// `row.status` RAW. It never called `withEffectiveStatus`, never used `isOpen`,
// never looked at the ledger. So the one archiving verb the family drives by
// hand walked straight around the whole guard: a proposal whose pinned seat the
// ledger says was ALREADY USED could be filed as `withdrawn` — a word that
// means "this never happened" — with no reading, no verdict and no warning.
// The row then stopped blocking `POST /`, and the next compose was the second
// payment. Round 1 shut the front door and left this one open.
//
// Now: the guard runs. Inside the deadline nothing changes. Past it, an
// unresolved seat (consumed / unreadable) refuses to be filed silently and
// hands back the verdict; the proposer files it only by acknowledging the
// check — after looking at the explorer. That acknowledgement is a HUMAN
// statement, never an inference of ours.
const withdrawSchema = z.object({ acknowledgeLedgerCheck: z.boolean().optional() });

router.post('/:id/withdraw', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.siwe?.userId;
  if (!userId) return void res.status(401).json({ error: 'missing_siwe_session' });
  const parsed = withdrawSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  const row = await prisma.councilProposal.findUnique({ where: { id: req.params.id } });
  if (!row) return void res.status(404).json({ error: 'NOT_FOUND' });
  // The guard runs BEFORE the proposer check now (G1-cadena round 3): whether
  // somebody other than the proposer may file this row depends on the deadline
  // and on the ledger verdict, so the verdict has to exist first. Inside the
  // deadline this still costs no read at all — withEffectiveStatus returns
  // early — so the ordinary withdraw is unchanged, ledger reads included.
  const p = await withEffectiveStatus(row);
  if (!(LIVE_STATUSES as readonly string[]).includes(p.status)) {
    return void res.status(409).json(notLiveBody(p));
  }
  // ── G1-cadena (round 3, finding 3) — THE EXIT THAT DOES NOT NEED THE PROPOSER.
  //
  // WHAT FAILED IN SILENCE: `consumed` is true after ANY later transaction of
  // the account (a synchronous ceremony, a payment made straight from Xaman, a
  // rule). So a `collecting` proposal that never gathered its quorum — one that
  // was never assembled into a complete transaction here at all — came back
  // `consumed`, and from that moment `POST /` answered 422 for ever. Both exits
  // were shut for anyone but one person: registering a hash needs `ready`, and
  // filing needed the proposer. A council whose proposer has moved on, or
  // simply is not around, could never compose anything again.
  //
  // The way out is information the server ALREADY holds: status flips to
  // `ready` the instant the collected weight reaches the quorum, and signatures
  // are only ever added — so a past-deadline row still reading `collecting` is
  // a proposal whose quorum was never met. Nothing complete was ever assembled
  // from it here, so filing it claims far less than it does on a `ready` row,
  // and ANY member of this surface may do it. Note what does NOT change: the
  // acknowledgement is still required (the seat was used by something, and a
  // human says they looked), and a `ready` row — which may really have been
  // broadcast — still belongs to its proposer, with the hash door open to
  // everyone else.
  const neverAssembled = !isOpen(p) && p.status === 'collecting';
  const isProposer = row.createdByUserId === userId;
  if (!isProposer && !neverAssembled) {
    return void res.status(403).json({
      error: 'NOT_THE_PROPOSER',
      detail: isOpen(p)
        ? 'This proposal is still collecting signatures, and only the member who composed it can withdraw it. Ask them, or let it reach its deadline.'
        : 'This proposal reached its quorum, so it may actually have been broadcast — only the member who composed it can file it as never-happened. If you found the transaction in the explorer, register its hash instead: any member can do that, and it unblocks the account just the same.',
    });
  }
  // puertas-y-permiso (round 3) — OUR OWN REGRESSION. `neverAssembled` says
  // "ANY MEMBER may file this row", and the sentence above it says the same
  // ("any member can do that"). What the code checked was neither: dropping
  // the proposer check left `requireLegacyAccess` alone on the door, i.e. any
  // authenticated session, i.e. a stranger writing `withdrawn` — the word that
  // means "this never happened" — on another family's acta. The exit round 3
  // opened stays open; it just opens for the council it belongs to.
  if (!isProposer && !(await sessionIsCouncilMember(userId, row, req.siwe?.walletAddress ?? null))) {
    return void res.status(403).json({
      error: 'NOT_A_COUNCIL_MEMBER',
      detail:
        'This proposal belongs to a council you are not a proven member of. Only the member who composed it, or a ' +
        'member of its signer list, can file it. ' + PROVE_MEMBERSHIP_HINT,
    });
  }
  if (!isOpen(p) && isUnresolvedSeat(p.ledgerCheck) && parsed.data.acknowledgeLedgerCheck !== true) {
    return void res.status(409).json({
      error: 'LEDGER_CHECK_UNACKNOWLEDGED',
      detail: neverAssembled
        ? `${p.ledgerCheck.detail} This proposal never reached its quorum here, so no complete transaction was ever assembled from it — but the seat is not settled either. Check the account on an explorer, then file it stating that you did.`
        : `${p.ledgerCheck.detail} Filing it as withdrawn would record that it never happened. ` +
          'Check the account on an explorer first: if it executed, register its transaction hash instead.',
      status: p.status,
      ledgerCheck: p.ledgerCheck,
    });
  }
  const proposal = await prisma.councilProposal.update({
    where: { id: row.id },
    data: { status: 'withdrawn' },
  });
  // ── it. 29 (§2) — WITHDRAWING A PROPOSAL IS ENDING ITS CEREMONY ──────────────
  //
  // WHAT FAILED IN SILENCE. This wrote `status: 'withdrawn'` and stopped. The
  // proposal's txjson is a 0xFE whose nonce seat was measured with the ceremony's
  // 24-hour window (it. 25 §2.1), and nothing here ever gave that seat back — so
  // the council that filed a proposal as never-happened still could not compose
  // its next exit for a day. The sync tempo got its door in it. 25/27; this is
  // the async one, with the SAME rule underneath (`releaseAbandonedCeremonySeat`:
  // a ceremony row, this account, a window read in full and empty, and the
  // coordinator's pin — stamped above, at creation) and the SAME words
  // (`seatReleaseAnswer`). Who may: exactly who may withdraw — the checks above
  // already ran, and they are stricter than the ceremony door's.
  //
  // Reported in its own field, never a verdict on the withdraw: the proposal IS
  // withdrawn whatever the seat says, and «could not read» is said as such.
  return void res.json({ ok: true, proposal, ...(await withdrawnProposalSeat(row.account, row.txjson, row.id)) });
}));

/**
 * it. 29 (§2) — the seat half of a withdraw. Never throws, never changes the
 * withdraw's own answer: it reports what happened to the 0xFE nonce seat of the
 * proposal's bytes, in the field the sync door already uses (`seat`).
 *
 * it. 34 (E): `sittingId` is the proposal's id — the one its creation stamped on
 * the pin. A proposal whose bytes were pinned again by a newer sitting (another
 * proposal, a live ceremony) is withdrawn all the same, but its seat answer is
 * `stale-sitting` and the row is not touched. Omitting it (an older caller)
 * keeps the rule as it was.
 */
export async function withdrawnProposalSeat(
  account: string,
  txjson: unknown,
  sittingId?: string,
): Promise<{ seat?: Record<string, unknown> }> {
  const memo = zeroFeMemoOfTx(txjson);
  if (!memo) return {}; // not a 0xFE: no nonce seat to hand back
  try {
    const outcome = await releaseAbandonedCeremonySeat(memo, account, sittingId ? { sittingId } : undefined);
    return { seat: seatReleaseAnswer(outcome) };
  } catch (e) {
    // «No pude leer» no es «lo solté» ni «no había nada»: se dice, y ya.
    console.error('[council] withdrawn proposal seat NOT released:', (e as Error)?.message ?? e);
    return { seat: { released: false, code: 'SEAT_STATE_UNREADABLE', retryable: true } };
  }
}

export default router;
