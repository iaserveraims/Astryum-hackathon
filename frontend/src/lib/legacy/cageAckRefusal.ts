/**
 * cageAckRefusal — what a screen does with a 409 `CAGE_ACK_REQUIRED`.
 *
 * productizer it. 31 (agente D, 4.3). The server has said WHY the
 * acknowledgement is missing since it. 27 (`cause`, machine-readable, so «a
 * client never has to parse prose»), and neither of the two screens that meet
 * this gate ever read it: CageBirthCard and CouncilVaultEntry opened the
 * disclosure modal on the code alone and retried the prepare on confirm. For
 * three of the four causes confirming cannot clear the gate — the account's
 * security record does not parse (`unreadable_mark`), is dated ahead of the
 * server's clock (`ahead_of_clock`), or the database did not answer
 * (`read_failed`) — so the person confirmed, got the same 409, and the modal
 * opened again: the loop, with the server's honest sentence written for it and
 * never shown.
 *
 * ONE rule, pure so it can be tested: the modal opens only for the cause that
 * reading and confirming actually fixes (`no_record`) — and for a server old
 * enough to send no `cause` at all, which is the same thing. Every other cause
 * is shown as the sentence the server wrote for it.
 */

export type CageAckCause = 'no_record' | 'unreadable_mark' | 'ahead_of_clock' | 'read_failed';

export interface CageAckRefusal {
  /** true only when opening the disclosure and confirming can clear the gate. */
  confirmHelps: boolean;
  cause: CageAckCause | null;
  /** The server's sentence for this cause (shown when confirming does not help). */
  detail: string | null;
}

/** null when `err` is not a `CAGE_ACK_REQUIRED` refusal. */
export function cageAckRefusalOf(err: unknown): CageAckRefusal | null {
  const body = (err as { body?: { error?: unknown; cause?: unknown; detail?: unknown } } | null)?.body;
  if (!body || body.error !== 'CAGE_ACK_REQUIRED') return null;
  const cause = isCause(body.cause) ? body.cause : null;
  const detail = typeof body.detail === 'string' && body.detail.trim() ? body.detail : null;
  return { confirmHelps: cause === null || cause === 'no_record', cause, detail };
}

function isCause(v: unknown): v is CageAckCause {
  return v === 'no_record' || v === 'unreadable_mark' || v === 'ahead_of_clock' || v === 'read_failed';
}

/** The fallback sentence when a cause that confirming cannot clear arrives without a `detail`. */
export const CAGE_ACK_CANNOT_CONFIRM_FALLBACK =
  'We could not check your reading of “How a cage works” because of a record on our side, not anything you did. ' +
  'Confirming again will not clear this. Nothing has been composed and no capital has moved.';
