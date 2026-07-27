'use client';

/**
 * The council signing engine — the pieces CouncilMultisigFlow (same-sitting
 * ceremony) and ProposalInbox (async, days-long collection) share. One source:
 * a Xaman multisign payload per member, the status poll, and the browser
 * broadcast to public XRPL nodes. Astryum never signs, never combines on a
 * server, never broadcasts server-side (ADR-008 guardrail #3).
 */

export const XRPSCAN_TX = 'https://xrpscan.com/tx/';
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

/** One Xaman sign request for a council member (multisign — a Signer, not a full
 *  tx; never submitted by Xaman). Retries without `signers` where unsupported. */
export async function createMemberPayload(
  txjson: Record<string, unknown>,
  signer: string,
): Promise<{ uuid: string; qrPng?: string; deeplink?: string }> {
  const body = (withSigners: boolean) => ({
    txjson,
    options: { submit: false, multisign: true, expire: 1440, ...(withSigners ? { signers: [signer] } : {}) },
    // Xaman caps custom_meta.identifier (~45 chars → 413). Keep it short.
    custom_meta: { identifier: `ms-${signer.slice(-6)}-${Date.now().toString(36)}`, blob: { purpose: 'LEGACY_COUNCIL_SIGNATURE', signer } },
  });
  let res = await fetch('/api/xaman/create-payload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body(true)),
  });
  if (!res.ok) {
    res = await fetch('/api/xaman/create-payload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body(false)),
    });
  }
  if (!res.ok) throw new Error(`Xaman payload failed (${res.status})`);
  const data = await res.json();
  return { uuid: data.uuid, qrPng: data.refs?.qr_png, deeplink: data.next?.always };
}

export async function pollStatus(
  uuid: string,
): Promise<{ signed?: boolean; cancelled?: boolean; expired?: boolean; hex?: string }> {
  try {
    const res = await fetch(`/api/xaman/status/${uuid}`);
    if (!res.ok) return {};
    const data = await res.json();
    return { signed: data?.meta?.signed, cancelled: data?.meta?.cancelled, expired: data?.meta?.expired, hex: data?.response?.hex };
  } catch {
    return {};
  }
}

export async function broadcast(txBlob: string): Promise<{ engine: string; hash?: string; message?: string }> {
  // A node can fail three ways: unreachable (CORS/network), HTTP error, or an
  // RPC-level rejection (e.g. invalidTransaction) that carries no engine_result.
  // Keep the last concrete reason so the thrown error says WHY, not just "no".
  let lastFailure = '';
  for (const node of SUBMIT_NODES) {
    try {
      const res = await fetch(node, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'submit', params: [{ tx_blob: txBlob }] }),
      });
      if (!res.ok) {
        lastFailure = `${node}: HTTP ${res.status}`;
        continue;
      }
      const json = await res.json();
      const engine = json?.result?.engine_result;
      if (engine) return { engine, hash: json?.result?.tx_json?.hash, message: json?.result?.engine_result_message };
      const rpcError = json?.result?.error;
      if (rpcError) {
        const detail = json?.result?.error_exception ?? json?.result?.error_message ?? '';
        lastFailure = `${node}: ${rpcError}${detail ? ` — ${detail}` : ''}`;
      }
    } catch (e) {
      lastFailure = `${node}: ${(e as Error).message || 'unreachable'}`;
    }
  }
  throw new Error(`No XRPL node accepted the submission${lastFailure ? ` (${lastFailure})` : ''}`);
}
