/**
 * ceremonyReserve — the whole-ceremony XRPL reserve preflight.
 *
 * WHY THIS EXISTS (product finding inside a bug finding, 2026-07-22): on the
 * test council rsmv…KDmrf, SIX ceremony transactions failed with
 * `tecINSUFFICIENT_RESERVE` (a SignerListSet + tickets) — the account ran short
 * on reserve mid-ceremony, each failed signature still burning its fee. XRPL's
 * per-tx `simulate` only checks the NEXT single tx at the current ledger state;
 * it cannot see that the full constitution ceremony (signer list + rehearsal
 * escrow + constitution DID) will immobilise more reserve than the account holds.
 *
 * This computes that cost ONCE, before the user starts, from the reserve figures
 * the panel already reads (getSpendableBalance → escrows endpoint). It is Astryum's
 * own thesis applied to Astryum: say "fund the account with X XRP first" BEFORE,
 * not discovered at the third failed signature.
 *
 * Astryum's ceremony adds exactly THREE owner objects — SignerList (the council),
 * the rehearsal Escrow, the constitution DID. Astryum composes NO Tickets (the
 * multisig coordinator is ticketless by design).
 *
 * BUT the projection must NOT be optimistic — an under-stating preflight is this
 * exact bug family in positive form (a figure that looks right and comes up
 * short). The ceremony the test council actually ran DID create reserve-consuming
 * Tickets, from the Xaman Multisign xApp fallback that the panel links out to
 * when a signer can't multisign in-app. So the figure carries MARGIN for that
 * fallback (CEREMONY_MARGIN_OBJECTS) even though this app never composes a Ticket.
 * We do not model the xApp; we leave headroom so the observed path can't overrun.
 */

/** The reserve snapshot the panel already holds (XRPLProvider.getSpendableBalance). */
export interface ReserveSnapshot {
  balanceXrp: number;
  ownerCount: number;
  /** base + ownerCount * increment (the reserve currently locked). */
  reserveXrp: number;
  /** one owner-reserve increment (server_info reserve_inc_xrp). */
  nextObjectReserveXrp: number;
}

export interface CeremonyReservePlan {
  incrementXrp: number;
  /** owner objects the full ceremony immobilises: SignerList + Escrow + DID. */
  objectsAdded: number;
  /** added reserve = objectsAdded × increment. */
  addedReserveXrp: number;
  /** the rehearsal escrow amount, locked (returned on finish). */
  rehearsalLockXrp: number;
  /** extra owner objects budgeted for the Xaman xApp fallback (tickets). */
  marginObjects: number;
  /** headroom for the ceremony's transaction fees (multisig fees scale with signers). */
  feeHeadroomXrp: number;
  /** minimum balance the account must hold before the ceremony starts. */
  requiredBalanceXrp: number;
  /** max(0, required − balance). 0 ⇒ funded. */
  shortfallXrp: number;
  funded: boolean;
}

/** Owner objects Astryum's ceremony adds: SignerList + rehearsal Escrow + DID. */
export const CEREMONY_OBJECTS_ADDED = 3;
/**
 * Margin objects for the Xaman Multisign xApp fallback: it creates
 * reserve-consuming Tickets to coordinate its own flow (the test council saw 4
 * failed TicketCreates from exactly this path). Astryum never composes a Ticket,
 * but a user who signs via the xApp will — so the "fund X" figure covers it. This
 * is the anti-optimism guard: the projection over-states rather than under-states.
 */
export const CEREMONY_MARGIN_OBJECTS = 4;
/** The rehearsal self-escrow amount (XRP), locked while it exists. */
export const REHEARSAL_LOCK_XRP = 1;
/** Fee headroom for the ceremony's ~handful of (multisig) transactions. */
export const CEREMONY_FEE_HEADROOM_XRP = 0.5;

/** Round up to a friendly 0.1-XRP figure so the "fund X" ask never under-states. */
function ceil1(n: number): number {
  return Math.ceil(n * 10) / 10;
}

/**
 * Project the reserve the full constitution ceremony needs and compare it to the
 * account balance. Pure; the caller passes a snapshot only when it has one.
 */
export function computeCeremonyReserve(
  snap: ReserveSnapshot,
  opts?: { objectsAdded?: number; marginObjects?: number; rehearsalLockXrp?: number },
): CeremonyReservePlan {
  const incrementXrp = snap.nextObjectReserveXrp;
  const baseReserveXrp = Math.max(0, snap.reserveXrp - snap.ownerCount * incrementXrp);
  const objectsAdded = opts?.objectsAdded ?? CEREMONY_OBJECTS_ADDED;
  const marginObjects = opts?.marginObjects ?? CEREMONY_MARGIN_OBJECTS;
  const rehearsalLockXrp = opts?.rehearsalLockXrp ?? REHEARSAL_LOCK_XRP;

  const addedReserveXrp = objectsAdded * incrementXrp;
  // Reserve locked AFTER the ceremony completes: base + every object it will own +
  // margin for the xApp fallback's tickets. Over-states on purpose (anti-optimism).
  const reserveAfterXrp = baseReserveXrp + (snap.ownerCount + objectsAdded + marginObjects) * incrementXrp;
  const requiredBalanceXrp = ceil1(reserveAfterXrp + rehearsalLockXrp + CEREMONY_FEE_HEADROOM_XRP);
  const shortfallXrp = ceil1(Math.max(0, requiredBalanceXrp - snap.balanceXrp));

  return {
    incrementXrp,
    objectsAdded,
    addedReserveXrp,
    rehearsalLockXrp,
    marginObjects,
    feeHeadroomXrp: CEREMONY_FEE_HEADROOM_XRP,
    requiredBalanceXrp,
    shortfallXrp,
    funded: shortfallXrp <= 0,
  };
}
