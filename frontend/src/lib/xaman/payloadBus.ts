"use client";

/**
 * payloadBus — tiny module-level event bus that carries the Xaman signing
 * payload (QR image + deeplink + what is being signed) from XamanWalletService
 * to the UI.
 *
 * WHY: XamanWalletService creates the payload and then blocks on
 * waitForPayloadCompletion() for up to 5 minutes. The QR/deeplink live inside
 * that payload but were never surfaced, so the user had nothing to scan and the
 * connection always timed out. The bus lets a globally-mounted modal render the
 * QR the instant the payload exists, without forcing the service singleton (and
 * its XRPL WebSocket) to be constructed at app load.
 *
 * The prompt carries CONTEXT, not just a QR: what the user is about to sign
 * (purpose + a human summary derived from the real txjson) and when the payload
 * expires. A signing surface that shows only a bare QR asks the user to approve
 * something they cannot see — the modal renders these fields so the review
 * happens on-screen, next to the code they are about to scan.
 *
 * REGULATORY BOUNDARY (CLAUDE.md §0): this only DISPLAYS the unsigned payload.
 * The user signs in the Xaman mobile app. Astryum never holds keys nor signs.
 */

/** What the user is being asked to approve — drives the modal's copy. */
export type XamanPayloadPurpose = 'signin' | 'transaction' | 'message';

/** Live state of the payload while the user is in Xaman. 'rejected' (the user
 *  said no — a choice, not an error) and 'expired' (the 5-minute window closed)
 *  are terminal states the modal shows calmly instead of vanishing. */
export type XamanPayloadStatus = 'pending' | 'opened' | 'signed' | 'rejected' | 'expired';

export interface XamanPayloadPrompt {
  /** Xaman payload UUID — used to dedupe / debug. */
  uuid: string;
  /** Official Xaman QR image URL (or data URL) from payload.refs.qr_png. */
  qrPng: string;
  /** Universal/deeplink URL from payload.next.always (opens the Xaman app). */
  deeplink: string;
  /** Why Xaman is being opened. Defaults to 'signin' when omitted. */
  purpose?: XamanPayloadPurpose;
  /**
   * One-line human summary of the operation, derived from the REAL unsigned
   * payload (e.g. "Payment · 5 XRP"). Never a placeholder: omitted when the
   * shape is unknown, so the modal can stay silent rather than invent one.
   */
  summary?: string;
  /** Epoch ms at which the Xaman payload expires (drives the countdown). */
  expiresAt?: number;
  /**
   * Xaman's own answer to "did this request reach the user's phone as a push
   * notification?" (payload create response, `pushed`). true → tell the user to
   * check their phone; false → the QR is the only way in this time. Omitted when
   * unknown (e.g. mock payloads).
   */
  pushed?: boolean;
}

type PromptListener = (prompt: XamanPayloadPrompt | null) => void;
type StatusListener = (status: XamanPayloadStatus) => void;

const promptListeners = new Set<PromptListener>();
const statusListeners = new Set<StatusListener>();

/** Subscribe to payload prompts. Returns an unsubscribe function. */
export function onXamanPayload(cb: PromptListener): () => void {
  promptListeners.add(cb);
  return () => {
    promptListeners.delete(cb);
  };
}

/** Emit a payload prompt (or null to clear/close the UI). */
export function emitXamanPayload(prompt: XamanPayloadPrompt | null): void {
  promptListeners.forEach((cb) => {
    try {
      cb(prompt);
    } catch (err) {
      console.error('xaman payloadBus listener error:', err);
    }
  });
}

/** Subscribe to live status updates for the open payload. */
export function onXamanStatus(cb: StatusListener): () => void {
  statusListeners.add(cb);
  return () => {
    statusListeners.delete(cb);
  };
}

/**
 * Emit a live status update ('opened' when the user has the request on screen
 * in Xaman, 'signed' once approved). Purely informational — the signing flow
 * itself is driven by the service's own WS/poll loop.
 */
export function emitXamanStatus(status: XamanPayloadStatus): void {
  statusListeners.forEach((cb) => {
    try {
      cb(status);
    } catch (err) {
      console.error('xaman payloadBus status listener error:', err);
    }
  });
}

/**
 * Cancel a live payload so "Cancelar" truly cancels: the QR dies in Xaman
 * (nothing left to sign on the phone two minutes later) and the service's wait
 * loop resolves right away via its cancelled resolution instead of hanging the
 * origin screen for the remaining minutes of the 5-minute window.
 */
export async function cancelXamanPayload(uuid: string): Promise<void> {
  try {
    await fetch(`/api/xaman/status/${uuid}`, { method: 'DELETE' });
  } catch {
    /* best-effort — an unreachable proxy still leaves the payload to its own expiry */
  }
}
