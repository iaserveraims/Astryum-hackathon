/**
 * proofMarkdown — renders the verified receipt book of a demo run as the
 * `proof-run-<date>.md` document (BuildSpec Demo Exchange v2 §3). Pure: the
 * verifier fills the checks, this only writes them down — every line points at
 * a hash and says what was READ from the chain, never what the backend believed.
 */

import type { DemoRun, Receipt } from './DemoExchangeStore';

const STEP_TITLE: Record<Receipt['step'], string> = {
  E1_ANCHOR: 'E1 · The council anchors its constitution (XRPL DIDSet)',
  E2_POTE: 'E2 · The pote is born by one council signature (0xFE)',
  E3_KYC: 'E3 · The exchange registers the client on-chain (KYC + tag)',
  E3_CREDENTIAL: 'E3 · Credential ceremony (XLS-70)',
  U1_DEPOSIT: 'U1 · The client deposits XRP at the exchange (omnibus + tag)',
  E5_PUT_TO_WORK: 'E5 · The exchange puts the client capital to work (mint + deposit, shares to the client)',
  E6_ORDER: 'E6 · Council order: capital directed to a venue (XRPL → FDC → bridge)',
  E7_DENIED: 'E7 · The cage says no (DENIED)',
  U4_EXIT: 'U4 · The client exits with one signature (Face ID)',
  U4_EXIT_XRP: 'U4 · The client exits to XRP (redeem + unmint, to the tag / own wallet)',
  E8_WITHDRAW: 'E8 · The exchange pays the client out to their own wallet',
  NOTE: 'Note',
};

function fmtDate(iso: string): string {
  return iso.replace('T', ' ').slice(0, 19) + ' UTC';
}

export function renderProofMarkdown(run: DemoRun, opts?: { generatedAt?: string }): string {
  const generatedAt = opts?.generatedAt ?? new Date().toISOString();
  const lines: string[] = [];
  lines.push(`# Demo Exchange — proof of run ${run.label || run.runId}`);
  lines.push('');
  lines.push(`Generated ${fmtDate(generatedAt)} · run \`${run.runId}\` · seq ${run.seq} · policy ${run.policy}`);
  lines.push('');
  lines.push('> Demo Exchange is a SIMULATED exchange system (client accounts, tags, internal ledger) on top of REAL');
  lines.push('> Flare/XRPL mainnet contracts. Astryum plays the operator; no exchange uses this yet. Every line below');
  lines.push('> names a transaction hash and what was read from the chain to check it. Nothing here is audited.');
  lines.push('');
  lines.push('## Actors');
  lines.push('');
  lines.push(`- Council (XRPL): \`${run.councilAddress}\``);
  lines.push(`- Omnibus (XRPL): \`${run.omnibusAddress}\``);
  if (run.poteAddress) lines.push(`- Pote (Flare): \`${run.poteAddress}\``);
  if (run.bridgeAddress) lines.push(`- Bridge (Flare): \`${run.bridgeAddress}\``);
  if (run.registryAddress) lines.push(`- KYC registry (Flare): \`${run.registryAddress}\``);
  lines.push('');
  if (run.clients.length) {
    lines.push('## Clients (demo ledger)');
    lines.push('');
    lines.push('| Client | Tag | Flare account (shares live here) | XRPL wallet | KYC | XRP at the exchange |');
    lines.push('|---|---|---|---|---|---|');
    for (const c of run.clients) {
      const xrp = (Number(c.xrpOnExchangeDrops || '0') / 1e6).toFixed(6);
      lines.push(`| ${c.label} | ${c.tag} | \`${c.passkeyAccount ?? '—'}\` | \`${c.xrplAddress ?? '—'}\` | ${c.kyc} | ${xrp} |`);
    }
    lines.push('');
  }
  lines.push('## Receipts');
  lines.push('');
  const total = run.receipts.length;
  const verified = run.receipts.filter((r) => r.checks.length > 0 && r.checks.every((k) => k.ok === true)).length;
  const failed = run.receipts.filter((r) => r.checks.some((k) => k.ok === false)).length;
  lines.push(`${total} receipts · ${verified} fully verified on-chain · ${failed} with a failed check`);
  lines.push('');
  const ordered = [...run.receipts].sort((a, b) => a.at.localeCompare(b.at));
  for (const r of ordered) {
    const client = r.clientId ? run.clients.find((c) => c.id === r.clientId) : undefined;
    lines.push(`### ${STEP_TITLE[r.step] ?? r.step}`);
    lines.push('');
    lines.push(`- When: ${fmtDate(r.at)}${client ? ` · client: ${client.label} (tag ${client.tag})` : ''}`);
    if (r.txHash) {
      lines.push(`- Tx (${r.chain}): \`${r.txHash}\`${r.explorerUrl ? ` — ${r.explorerUrl}` : ''}`);
    } else {
      lines.push(`- Tx: none (${r.chain === 'none' ? 'no transaction — the refusal happened before signing' : 'not recorded'})`);
    }
    if (r.note) lines.push(`- Note: ${r.note}`);
    if (r.expect && Object.keys(r.expect).length) {
      lines.push(`- Expected: ${Object.entries(r.expect).map(([k, v]) => `${k}=${String(v)}`).join(' · ')}`);
    }
    if (r.checks.length) {
      lines.push(`- Checks${r.verifiedAt ? ` (verified ${fmtDate(r.verifiedAt)})` : ''}:`);
      for (const k of r.checks) {
        const mark = k.ok === true ? '✅' : k.ok === false ? '❌' : '⬜';
        lines.push(`  - ${mark} ${k.label}${k.observed ? ` — observed: ${k.observed}` : ''}${k.reason ? ` — ${k.reason}` : ''}`);
      }
    } else {
      lines.push('- Checks: not run yet');
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('What can be claimed: the authority rail and the cage executed on mainnet; nobody can extract the principal;');
  lines.push('the client exits with their sole signature. What cannot: audited · safe · any % · an exchange using this ·');
  lines.push('"no custody" · "legal compliant".');
  return lines.join('\n');
}
