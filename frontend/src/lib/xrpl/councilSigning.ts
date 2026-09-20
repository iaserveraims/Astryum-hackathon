'use client';

/**
 * The council signing engine — the pieces CouncilMultisigFlow (same-sitting
 * ceremony) and ProposalInbox (async, days-long collection) share. One source:
 * a Xaman multisign payload per member, the status poll, and the browser
 * broadcast to public XRPL nodes. Astryum never signs, never combines on a
 * server, never broadcasts server-side (ADR-008 guardrail #3).
 */

import { ceremonyPayloadExpiryMin } from '../wallet/handoffRelease';

export const XRPSCAN_TX = 'https://xrpscan.com/tx/';
/** The explorer's ACCOUNT view — where a person checks whether a submission they
 *  could not confirm ever landed (B2). Same host as `XRPSCAN_TX`. */
export const XRPSCAN_ACCOUNT = 'https://xrpscan.com/account/';
// Public nodes tried in order (the balancer occasionally serves a sick node).
// Browser-reachable nodes need CORS: xrplcluster.com and xrpl.link send
// Access-Control-Allow-Origin; s1.ripple.com does NOT (kept last — it only
// helps outside a browser context).
const SUBMIT_NODES = ['https://xrplcluster.com', 'https://xrpl.link', 'https://s1.ripple.com:51234'];

export function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 7)}…${a.slice(-5)}` : a;
}

/** sha256 hex via Web Crypto — the position content is hashed VERBATIM (the
 *  backend hashes the same string; no canonicalisation dance). */
export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The memo prefix a signed position proof commits to (backend twin). */
export const POSITION_MEMO_PREFIX = 'astryum-council-position:';

/* ── THE REDACTION, READ ───────────────────────────── */

/**
 * WHAT WAS WITHHELD FROM THIS READER, AND WHY.
 *
 * A cosignatory whose address is only REGISTERED (typed in, imported watch-only)
 * is served the signing material in full and the family's deliberation not at
 * all: `title: null`, `positions: []`, plus `access: 'registered'` and
 * `redacted: ['title','positions']` (backend `redactActaForRegistered`). The
 * screens read none of that, so an empty acta was painted as «nobody has fixed a
 * position» and «Fix my position» was offered over a door the server refuses —
 * the redaction presented as a fact, and a signature asked for in vain.
 *
 * Pure and primitive-only: the sentence is tested without a browser.
 */
export interface CouncilRedaction {
  /** Is anything being withheld from this reader? */
  redacted: boolean;
  /** Is the deliberative record (positions) among what was withheld? */
  positionsHidden: boolean;
  /** Is the decision's own title among what was withheld? */
  titleHidden: boolean;
}

export function readCouncilRedaction(
  row: { access?: string | null; redacted?: unknown } | null | undefined,
): CouncilRedaction {
  const fields = Array.isArray(row?.redacted)
    ? (row.redacted as unknown[]).filter((f): f is string => typeof f === 'string')
    : [];
  // `access` alone is enough: a 'registered' read is a redacted read even on a
  // deploy whose `redacted` list has not caught up. Silence is not «full».
  const registered = row?.access === 'registered';
  const positionsHidden = fields.includes('positions') || registered;
  const titleHidden = fields.includes('title') || registered;
  return { redacted: fields.length > 0 || registered, positionsHidden, titleHidden };
}

/**
 * The one sentence for it. Never «you are not a member» (they are — they hold a
 * seat on the signer list, which is why they got the bytes), and never a promise
 * that binding a wallet changes what they may SIGN: it changes what they may
 * READ. The signing material is untouched, and that is said out loud so nobody
 * reads this as a gate on the exit.
 */
export function councilRedactionSentence(
  r: CouncilRedaction,
  t: (s: string) => string,
): string | null {
  if (!r.redacted) return null;
  const what = r.positionsHidden
    ? r.titleHidden
      ? t('The family’s deliberation on this proposal — its title and the positions each member fixed — is not being shown to you.')
      : t('The positions each member fixed on this proposal are not being shown to you.')
    : t('Part of this proposal is not being shown to you.');
  return `${what} ${t('That is a privacy floor, not a verdict about you: the server recognises this address as one of the signers, but only as a REGISTERED address (typed in or imported watch-only), and a council’s signer addresses are public, so anyone could type one in. Everything you need in order to sign is here and unchanged. Sign in with that wallet, or bind it with a signature, and the record opens.')}`;
}

/**
 * EL MEMO DEL 0xFE QUE LLEVA ESTE Payment, LEÍDO TAL CUAL.
 *
 * `councilOrderMemoOf` (lib/xrpl/singleSignVerdict) exige EXACTAMENTE 64 hex
 * porque una ORDEN de consejo es un keccak de 32 bytes. El memo de un 0xFE no
 * tiene esa forma: es la instrucción entera del Smart Account (prefijo, walletId,
 * comisión del executor y los 32 bytes del userOpHash), y es más larga. Usar
 * aquella lectura para nombrar el asiento de nonce de un 0xFE daría `null`
 * SIEMPRE — la misma clase de fallo que este ciclo persigue: una puerta que no
 * puede llamarse. El rango es el que acepta `/xrpl-defi/multisign/release`.
 *
 * Pura: nombra el asiento, no decide nada sobre él.
 */
export function paymentMemoHex(tx: unknown): string | null {
  let obj: unknown = tx;
  if (typeof tx === 'string') {
    try {
      obj = JSON.parse(tx);
    } catch {
      return null;
    }
  }
  const t = obj as { TransactionType?: unknown; Memos?: unknown } | null;
  if (!t || typeof t !== 'object' || t.TransactionType !== 'Payment') return null;
  if (!Array.isArray(t.Memos) || t.Memos.length !== 1) return null;
  const data = (t.Memos[0] as { Memo?: { MemoData?: unknown } } | null)?.Memo?.MemoData;
  if (typeof data !== 'string') return null;
  const hex = data.trim().replace(/^0x/i, '').toUpperCase();
  return /^[0-9A-F]{8,2048}$/.test(hex) ? hex : null;
}

/** One Xaman sign request for a council member (multisign — a Signer, not a full
 *  tx; never submitted by Xaman). Retries without `signers` where unsupported. */
export async function createMemberPayload(
  txjson: Record<string, unknown>,
  signer: string,
): Promise<{ uuid: string; qrPng?: string; deeplink?: string; pushed?: boolean }> {
  /**
   * UNA SOLA LECTURA DECIDE LA VENTANA, Y VIAJA HASTA AQUÍ.
   *
   * Esto era `expire: 1440` escrito a mano, y era el SEGUNDO número para un
   * mismo hecho. El servidor ya decide cuánto vive este payload (lee el
   * SignerList de la cuenta y compone el 0xFE con esa ventana, que va DENTRO de
   * los bytes firmados como `LastLedgerSequence`), y su respuesta trae
   * `payloadExpiryMin` junto al memo. Si los dos números discrepan, el que manda
   * tiene que ser el del servidor: es el único que la `LastLedgerSequence` ya
   * respeta, y un `expire` más largo que esa ventana produce justo el fallo que
   * este ciclo persigue — un quórum firmando bytes que el ledger ya no admite.
   */
  const expire = ceremonyPayloadExpiryMin(paymentMemoHex(txjson));
  const body = (withSigners: boolean) => ({
    txjson,
    options: { submit: false, multisign: true, expire, ...(withSigners ? { signers: [signer] } : {}) },
    // Xaman caps custom_meta.identifier (~45 chars → 413). Keep it short.
    custom_meta: { identifier: `ms-${signer.slice(-6)}-${Date.now().toString(36)}`, blob: { purpose: 'LEGACY_COUNCIL_SIGNATURE', signer } },
    // Ours, stripped by the route: WHO this request is for, so it can look up
    // that member's push token and send the request to their phone.
    pushPayloadFor: signer,
  });
  // The session token travels so the route can reach the backend's token store
  // server-side. The token itself never comes back to this browser.
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const jwt = window.localStorage.getItem('auth_token');
    if (jwt) headers.Authorization = `Bearer ${jwt}`;
  }
  let res = await fetch('/api/xaman/create-payload', {
    method: 'POST',
    headers,
    body: JSON.stringify(body(true)),
  });
  if (!res.ok) {
    res = await fetch('/api/xaman/create-payload', {
      method: 'POST',
      headers,
      body: JSON.stringify(body(false)),
    });
  }
  if (!res.ok) {
    // The route names the cause (rejected credentials, upstream refusal…);
    // carry it to the member's pill instead of a bare status code.
    const info = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(info?.error ? info.error : `Xaman payload failed (${res.status})`);
  }
  const data = await res.json();
  // `pushed` is Xaman's own answer: true = it rang their phone, false = the QR
  // is the only way in. Surfaced so the UI can say which, instead of leaving a
  // member waiting for a notification that was never sent.
  return { uuid: data.uuid, qrPng: data.refs?.qr_png, deeplink: data.next?.always, pushed: data.pushed === true };
}

export async function pollStatus(
  uuid: string,
): Promise<{ signed?: boolean; cancelled?: boolean; expired?: boolean; hex?: string }> {
  try {
    // Same session header as the create call: signing is when Xaman issues the
    // push token, and the route stores it (server-side) for the next request.
    const headers: Record<string, string> = {};
    if (typeof window !== 'undefined') {
      const jwt = window.localStorage.getItem('auth_token');
      if (jwt) headers.Authorization = `Bearer ${jwt}`;
    }
    const res = await fetch(`/api/xaman/status/${uuid}`, { headers });
    if (!res.ok) return {};
    const data = await res.json();
    return { signed: data?.meta?.signed, cancelled: data?.meta?.cancelled, expired: data?.meta?.expired, hex: data?.response?.hex };
  } catch {
    return {};
  }
}

/**
 * Wait until the ledger VALIDATES a submitted tx and report its final result.
 *
 * The submit's engine_result is PRELIMINARY: a preliminary tesSUCCESS can
 * still land as tec* in the validated ledger — the proven family case is 6
 * validated-but-failed council txns (tecINSUFFICIENT_RESERVE among them).
 * Painting green off the preliminary code is the "unearned success" disease;
 * this is the cure at the source. Ledgers close every 3-5 s, so a validated
 * verdict normally arrives within one or two polls.
 */
export async function awaitValidation(
  hash: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<{ validated: boolean; finalResult?: string; timedOut?: boolean }> {
  const timeoutMs = opts?.timeoutMs ?? 20_000;
  const intervalMs = opts?.intervalMs ?? 2_500;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const node of SUBMIT_NODES) {
      try {
        const res = await fetch(node, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'tx', params: [{ transaction: hash }] }),
        });
        if (!res.ok) continue;
        const json = await res.json();
        const r = json?.result;
        if (r?.validated === true) {
          return { validated: true, finalResult: r?.meta?.TransactionResult as string | undefined };
        }
        // txnNotFound while the tx is in flight is normal — keep waiting.
      } catch {
        /* next node */
      }
    }
    if (Date.now() >= deadline) return { validated: false, timedOut: true };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * WHAT A SITTING REPORTS ABOUT THE BYTES, AS IT HAPPENS.
 *
 * `CouncilMultisigFlow` emits these through its `onDispatch` prop; the quorum
 * ceremony bus (the one host whose caller waits on a promise) turns them into
 * what a CLOSE means — release the seat, hand back the hash, or refuse to say
 * anything happened. Defined here, in the engine both share, so neither the
 * flow nor the bus has to import the other. A report, never a decision.
 */
export type CeremonyDispatchEvent =
  /** `/multisign/prepare` is being asked: the coordinator pins this account's seat. */
  | { stage: 'started' }
  /** The sitting was cancelled from inside: its seat handed back, nothing of it left. */
  | { stage: 'abandoned' }
  /** Combining and broadcasting: from here the bytes may reach a node. */
  | { stage: 'submitting' }
  /** The node answered the submit — a PRELIMINARY engine result, and the hash when it gave one. */
  | { stage: 'broadcast'; hash?: string; engine: string; message?: string }
  /**
   * NO node confirmed taking the bytes (`broadcast()` threw). Not a
   * refusal: the first node may have applied them and lost its answer, so the
   * sitting stays COMMITTED and a close from here on is a close over a Payment
   * that may be on the ledger — never «nothing left».
   */
  | { stage: 'broadcast-failed'; message?: string }
  /** The validated ledger's verdict, or a wait that gave up (`timedOut`). */
  | { stage: 'validation'; hash: string; validated: boolean; finalResult?: string; timedOut?: boolean };

/**
 * CAN A SUBMIT WITH THIS PRELIMINARY RESULT STILL REACH A LEDGER?
 * `tes` was accepted, `tec` is applied with the fee claimed, `ter` is retried by
 * the node; `tef` and `tem` were refused locally and never enter. Pure: decides
 * whether the hash is worth telling the seat's register about.
 *
 * Moved here from `CouncilMultisigFlow` (re-exported there) because
 * the async coordinator (`ProposalInbox`) now asks the same question — one rule
 * for the two surfaces that broadcast a council's bytes.
 */
export function broadcastMayLand(engine: string | undefined): boolean {
  return typeof engine === 'string' && /^(tes|tec|ter)/.test(engine);
}

export interface ConfirmedSubmit {
  /** Preliminary engine_result from the submit (kept for diagnostics). */
  engine: string;
  hash?: string;
  message?: string;
  /** True once the tx was seen in a VALIDATED ledger. */
  validated: boolean;
  /** meta.TransactionResult from the validated ledger — the only real verdict. */
  finalResult?: string;
  /** Gave up waiting: the tx may still validate — check the explorer. */
  timedOut?: boolean;
}

/**
 * Submit and only report success the way the ledger does: validated.
 *
 * NO production caller any more — kept inert, not deleted. Both
 * surfaces that broadcast a council's bytes (`CouncilMultisigFlow.submit`,
 * `ProposalInbox.emit`) now call `broadcast()` and `awaitValidation()` apart,
 * because the hash has to reach the seat's register (`/handoff/signed`) IN
 * BETWEEN — the moment the node hands it back, before the validation wait. A
 * helper that hides that gap is how the async coordinator emitted a 0xFE for up
 * to 20 s with the server still counting its row as an unsigned draft.
 */
export async function submitAndConfirm(txBlob: string): Promise<ConfirmedSubmit> {
  const sub = await broadcast(txBlob);
  if (sub.engine !== 'tesSUCCESS' || !sub.hash) return { ...sub, validated: false };
  const v = await awaitValidation(sub.hash);
  return { ...sub, ...v };
}

/**
 * What `broadcast()` throws when NO node confirmed the bytes.
 *
 * Every node's failure travels, in the order they were tried, and the message
 * names them all. It used to keep only the LAST one — and the last node in the
 * list (`s1.ripple.com`) fails on CORS from every browser, so the sentence on
 * screen was always «s1.ripple.com: Failed to fetch» whatever the first node had
 * done with the blob. `mayHaveEntered` is the half that decides the copy: an
 * RPC-level refusal (`invalidTransaction`, `noCurrent`…) is a node that READ the
 * bytes and did not apply them; anything else — a connection that dropped, an
 * HTTP error from a gateway — is a node that may have applied them and lost its
 * answer. When even one node is in the second group, the submission may be on
 * the ledger, and the caller must not say otherwise.
 */
export interface BroadcastFailure {
  node: string;
  reason: string;
  /** 'refused' = the node answered at RPC level, nothing applied; 'unanswered' = unknown. */
  kind: 'refused' | 'unanswered';
}

export class BroadcastUnconfirmedError extends Error {
  readonly failures: readonly BroadcastFailure[];
  readonly mayHaveEntered: boolean;
  constructor(failures: BroadcastFailure[]) {
    const mayHaveEntered = failures.length === 0 || failures.some((f) => f.kind === 'unanswered');
    const named = failures.map((f) => `${f.node.replace(/^https?:\/\//, '')}: ${f.reason}`).join('; ');
    super(
      mayHaveEntered
        ? `No XRPL node confirmed taking the submission${named ? ` (${named})` : ''}. It may still have entered through a node whose answer was lost — check the account on an explorer before doing anything else.`
        : `Every XRPL node refused the submission${named ? ` (${named})` : ''}.`,
    );
    this.name = 'BroadcastUnconfirmedError';
    this.failures = failures;
    this.mayHaveEntered = mayHaveEntered;
  }
}

export async function broadcast(txBlob: string): Promise<{ engine: string; hash?: string; message?: string }> {
  // A node can fail three ways: unreachable (CORS/network), HTTP error, or an
  // RPC-level rejection (e.g. invalidTransaction) that carries no engine_result.
  // Every concrete reason is kept so the thrown error says WHY, node by node.
  const failures: BroadcastFailure[] = [];
  for (const node of SUBMIT_NODES) {
    try {
      const res = await fetch(node, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'submit', params: [{ tx_blob: txBlob }] }),
      });
      if (!res.ok) {
        failures.push({ node, reason: `HTTP ${res.status}`, kind: 'unanswered' });
        continue;
      }
      const json = await res.json();
      const engine = json?.result?.engine_result;
      if (engine) return { engine, hash: json?.result?.tx_json?.hash, message: json?.result?.engine_result_message };
      const rpcError = json?.result?.error;
      if (rpcError) {
        const detail = json?.result?.error_exception ?? json?.result?.error_message ?? '';
        failures.push({ node, reason: `${rpcError}${detail ? ` — ${detail}` : ''}`, kind: 'refused' });
      } else {
        failures.push({ node, reason: 'no engine result in the answer', kind: 'unanswered' });
      }
    } catch (e) {
      failures.push({ node, reason: (e as Error).message || 'unreachable', kind: 'unanswered' });
    }
  }
  throw new BroadcastUnconfirmedError(failures);
}
