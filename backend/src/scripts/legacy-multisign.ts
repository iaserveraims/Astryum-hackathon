#!/usr/bin/env ts-node
/**
 * legacy-multisign — collect a council's quorum signatures for ANY XRPL txjson
 * and combine them, without depending on the Xaman Multisign xApp.
 *
 * Why this exists: the Multisign xApp only builds transactions from its own
 * forms (AccountSet, Payment, SetRegularKey, SignerList, Ticket*, TrustSet). It
 * cannot sign an EscrowCreate — the Legacy rehearsal tx — and a form-built tx
 * would drop our SourceTag anyway. It also needs Tickets (0.2 XRP of reserve
 * each) purely to coordinate its own flow. None of that is required by XRPL:
 * multisig is just N independent signatures over the SAME bytes, combined.
 *
 * What it does:
 *   1. READS  — the account's Sequence, the network base fee, and the SignerList
 *               (members + quorum) from the validated ledger.
 *   2. FIXES  — Sequence + Fee (base x (1 + signers)) + SigningPubKey:'' onto the
 *               txjson. Every signer must sign IDENTICAL bytes, so this happens
 *               ONCE, here, before any signature is requested.
 *   3. ASKS   — one Xaman payload per council member (options.multisign) → one QR
 *               each. Each member signs on THEIR OWN device (that is the point of
 *               the rehearsal: the ledger records who really signed).
 *   4. COMBINES — xrpl.multisign() over the collected blobs → the final signed tx.
 *
 * What it NEVER does: hold a key, sign, or broadcast. It prints the signed blob
 * and the exact command for YOU to submit (prepare-only frontier — the product
 * stops at hand-off; see MICA_BOUNDARIES.md).
 *
 * Usage:
 *   # 1. Paste the "Copy unsigned transaction" JSON from the Legacy panel into a file
 *   npx ts-node src/scripts/legacy-multisign.ts --file ./rehearsal.json
 *
 *   # or inline
 *   npx ts-node src/scripts/legacy-multisign.ts --tx '{"TransactionType":"EscrowCreate",...}'
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import fs from 'fs';
import { multisign } from 'xrpl';
import { verifySignerBlob, BlobVerificationError } from '../connectors/protocols/xrpl/XrplBlobVerifier';

const XRPL_RPC = process.env.XRPL_RPC_URL || 'https://xrplcluster.com';
const XAMAN_API = 'https://xumm.app/api/v1/platform/payload';

// ── XRPL JSON-RPC over HTTPS (no websocket: same reason XRPLProvider falls back) ──
async function rpc<T = any>(method: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(XRPL_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
  });
  const json: any = await res.json();
  if (json?.result?.error) {
    throw new Error(`${method}: ${json.result.error} — ${json.result.error_message ?? ''}`);
  }
  return json.result as T;
}

interface XamanPayload {
  uuid: string;
  next: { always: string };
  refs: { qr_png: string };
  pushed: boolean;
}

function xamanHeaders(): Record<string, string> {
  const key = process.env.XAMAN_API_KEY;
  const secret = process.env.XAMAN_API_SECRET;
  if (!key || !secret) {
    throw new Error('XAMAN_API_KEY / XAMAN_API_SECRET missing from backend/.env');
  }
  return { 'Content-Type': 'application/json', 'X-API-Key': key, 'X-API-Secret': secret };
}

/**
 * --proxy <base-url> routes payload create/status through the app's own
 * /api/xaman/* handlers, which hold the Xaman secret server-side and pass the
 * body through verbatim. Use it when the local XAMAN_* credentials are stale:
 * no secret ever has to sit on this machine.
 */
let PROXY: string | undefined;

function createUrl(): string {
  return PROXY ? `${PROXY}/api/xaman/create-payload` : XAMAN_API;
}
function statusUrl(uuid: string): string {
  return PROXY ? `${PROXY}/api/xaman/status/${uuid}` : `${XAMAN_API}/${uuid}`;
}
function headers(): Record<string, string> {
  return PROXY ? { 'Content-Type': 'application/json' } : xamanHeaders();
}

/**
 * One sign request per council member. `multisign: true` tells Xaman to produce a
 * SIGNATURE FOR ANOTHER ACCOUNT (a Signers entry), not a single-sig tx — and never
 * to submit it. `signers` binds the QR to one member: nobody else's key can answer
 * it. Some Xaman deployments reject the `signers` option; we retry without it and
 * verify the signer identity in `verifySignerBlob` when the blob comes back (below,
 * before it is combined), so the check never depends on the option being honoured.
 */
async function createSignRequest(txjson: Record<string, unknown>, signer: string): Promise<XamanPayload> {
  const body = (withSigners: boolean) => ({
    txjson,
    options: {
      submit: false,
      multisign: true,
      expire: 1440, // 24h — a council signs at human speed, not in 5 minutes
      ...(withSigners ? { signers: [signer] } : {}),
    },
    custom_meta: {
      // Xaman caps custom_meta.identifier (a 45-char one is rejected with 413;
      // this stays ~26). Keep it short or the payload never gets created.
      identifier: `astryum-ms-${signer.slice(-6)}-${Date.now().toString(36)}`,
      blob: { purpose: 'LEGACY_COUNCIL_SIGNATURE', signer },
      instruction: `Council signature for ${txjson.Account} — sign with ${signer}`,
    },
  });

  let res = await fetch(createUrl(), { method: 'POST', headers: headers(), body: JSON.stringify(body(true)) });
  if (!res.ok) {
    res = await fetch(createUrl(), { method: 'POST', headers: headers(), body: JSON.stringify(body(false)) });
  }
  if (!res.ok) {
    throw new Error(`Xaman payload failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as XamanPayload;
}

/** Poll one payload until it is signed, rejected, or expires. Returns the signed blob. */
async function awaitSignature(uuid: string, signer: string): Promise<string> {
  for (;;) {
    const res = await fetch(statusUrl(uuid), { headers: headers() });
    const data: any = await res.json();
    const meta = data?.meta ?? {};
    if (meta.signed === true) {
      const hex = data?.response?.hex;
      if (!hex) throw new Error(`${signer}: signed but Xaman returned no tx blob`);
      return hex as string;
    }
    if (meta.cancelled === true) throw new Error(`${signer}: sign request REJECTED in Xaman`);
    if (meta.expired === true) throw new Error(`${signer}: sign request EXPIRED`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  PROXY = arg('proxy')?.replace(/\/$/, '');

  const raw = arg('file') ? fs.readFileSync(arg('file')!, 'utf8') : arg('tx');
  if (!raw) {
    console.error('Usage: npx ts-node src/scripts/legacy-multisign.ts --file ./rehearsal.json');
    process.exit(1);
  }
  const input = JSON.parse(raw) as Record<string, unknown>;
  // The Legacy panel copies { xrplTx, disclosure } for some flows and the bare
  // txjson for others — accept either shape rather than making the user dig.
  const tx = ((input.xrplTx ?? input.txjson ?? input) as Record<string, unknown>);
  const account = tx.Account as string;
  if (!account) throw new Error('The txjson has no Account field');

  console.log('─'.repeat(72));
  console.log('LEGACY MULTISIGN — the council signs, Astryum only composes');
  console.log('─'.repeat(72));
  console.log(`Transaction : ${tx.TransactionType}`);
  console.log(`Account     : ${account}`);
  console.log(`SourceTag   : ${tx.SourceTag ?? '⚠ NONE — this tx will NOT count for Make Waves'}`);

  // ── 1. READ the ledger: council, sequence, fee ──
  const [info, objects, server] = await Promise.all([
    rpc('account_info', { account, ledger_index: 'validated' }),
    rpc('account_objects', { account, type: 'signer_list', ledger_index: 'validated' }),
    rpc('server_info', {}),
  ]);

  const signerList = (objects.account_objects ?? [])[0];
  if (!signerList) throw new Error(`${account} has no SignerList — it is not a council account`);
  const members: string[] = signerList.SignerEntries.map((e: any) => e.SignerEntry.Account);
  const quorum: number = signerList.SignerQuorum;

  const baseFeeXrp: number = server.info.validated_ledger.base_fee_xrp;
  const baseFeeDrops = Math.max(10, Math.round(baseFeeXrp * 1_000_000));
  const feeDrops = baseFeeDrops * (1 + members.length);

  console.log(`Council     : ${members.length} members, quorum ${quorum}`);
  console.log(`Sequence    : ${info.account_data.Sequence}`);
  console.log(`Fee         : ${feeDrops} drops (base ${baseFeeDrops} x (1 + ${members.length} signers))`);
  console.log('');

  // ── 2. FIX the bytes. Every signer signs THIS, byte for byte. ──
  const finalTx = {
    ...tx,
    Account: account,
    Sequence: info.account_data.Sequence as number,
    Fee: String(feeDrops),
    SigningPubKey: '', // the multisig marker: no single signer owns this tx
  };

  if (argv.includes('--dry-run')) {
    console.log('DRY RUN — the exact bytes every member would sign:\n');
    console.log(JSON.stringify(finalTx, null, 2));
    console.log('\nNo sign request was sent. Drop --dry-run to ask the council.');
    return;
  }

  // ── 3. ASK each member (one QR each) ──
  console.log('Opening one sign request per council member.');
  console.log('Each member scans THEIR OWN QR, on THEIR OWN device — that is the rehearsal.\n');

  const requests = await Promise.all(
    members.map(async (m) => ({ signer: m, payload: await createSignRequest(finalTx, m) })),
  );
  for (const { signer, payload } of requests) {
    console.log(`  ${signer}`);
    console.log(`    sign : ${payload.next.always}`);
    console.log(`    qr   : ${payload.refs.qr_png}`);
  }
  console.log('\nWaiting for signatures… (Ctrl-C aborts; nothing is on-chain yet)\n');

  const blobs: string[] = [];
  for (const { signer, payload } of requests) {
    const hex = await awaitSignature(payload.uuid, signer);
    // Verify BEFORE combining: the blob must be FROM this member and OVER the exact
    // bytes we asked. This is what stops one member from answering every QR — the
    // silent failure that would let a false rehearsal pass with real capital inside.
    try {
      verifySignerBlob(hex, signer, finalTx);
    } catch (err) {
      if (err instanceof BlobVerificationError) {
        console.error(`\n✗ REJECTED signature for ${signer}: ${err.message}`);
        if (err.detail) console.error(`  ${JSON.stringify(err.detail)}`);
        console.error('  Nothing combined, nothing submitted — this blob is NOT trustworthy.');
        process.exit(1);
      }
      throw err;
    }
    blobs.push(hex);
    console.log(`  ✓ signed & verified — ${signer}   (${blobs.length}/${members.length})`);
  }

  // ── 4. COMBINE. This is arithmetic on signatures, not signing. ──
  const signedTx = multisign(blobs);

  console.log('\n' + '─'.repeat(72));
  console.log('SIGNED TRANSACTION (the council\'s quorum, combined)');
  console.log('─'.repeat(72));
  console.log(signedTx);
  console.log('\nAstryum does not broadcast. Submit it yourself:\n');
  if (process.platform === 'win32') {
    // `curl` on Windows is an alias for Invoke-WebRequest, which does not speak
    // curl's flags — print what the user's shell can actually run.
    console.log(`$blob = '${signedTx}'`);
    console.log(`$body = @{ method = 'submit'; params = @(@{ tx_blob = $blob }) } | ConvertTo-Json -Depth 5`);
    console.log(
      `Invoke-RestMethod -Uri ${XRPL_RPC} -Method Post -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 6\n`,
    );
  } else {
    console.log(
      `curl -s ${XRPL_RPC} -H 'Content-Type: application/json' \\\n` +
        `  -d '{"method":"submit","params":[{"tx_blob":"${signedTx}"}]}'\n`,
    );
  }
  console.log('Look for engine_result: tesSUCCESS.');
  console.log('Then refresh the Legacy panel: the rehearsal verdict reads the validated ledger.');
}

main().catch((err) => {
  console.error('\nlegacy-multisign failed:', err.message ?? err);
  process.exit(1);
});
