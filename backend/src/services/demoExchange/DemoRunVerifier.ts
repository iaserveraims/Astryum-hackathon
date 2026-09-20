/**
 * DemoRunVerifier — turns every receipt of a demo run into checks READ FROM THE
 * CHAIN (BuildSpec Demo Exchange v2 §3). The backend never marks anything as
 * "done" by itself: a receipt is a hash plus a promise, and this is where the
 * promise is measured against XRPL and Flare.
 *
 * Read-only by construction: `eth_call` / receipts on Flare, `tx` and
 * `account_objects` on XRPL. No key, no signature, no writes.
 */

import { ethers } from 'ethers';
import { xrplJsonRpc } from '../flare/DirectMintExecutorService';
import { resolveMasterAccountController } from '../../connectors/protocols/flare/FlareSmartAccountService';
import { xrplProvider } from '../../integrations/providers/chain/XRPLProvider';
import type { Check, DemoClient, DemoRun, Receipt } from './DemoExchangeStore';

const POTE_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function constitutionRef() view returns (bytes32)',
  'function userGate() view returns (address)',
  'function council() view returns (address)',
  'function totalAssets() view returns (uint256)',
  // readClientFacts lo llama para leer el FXRP libre del cliente; sin él, ethers
  // lanza `pote.asset is not a function` SÍNCRONO (el .catch no lo ve) y cada
  // cliente volvía con error — el panel anti-susto nunca aparecía (bug).
  'function asset() view returns (address)',
];
const REGISTRY_ABI = [
  'function approved(address) view returns (bool)',
  'function tagOf(address) view returns (uint256)',
];
const MAC_ABI = ['function isTransactionIdUsed(bytes32) view returns (bool)'];
const BRIDGE_ABI = ['function consumedTxId(bytes32) view returns (bool)', 'function nextNonce() view returns (uint64)'];

export function flareRpcUrl(): string {
  return process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc';
}

export function flareProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(flareRpcUrl(), { name: 'flare', chainId: 14 }, { staticNetwork: true });
}

export function explorerUrl(chain: 'xrpl' | 'flare' | 'none', txHash?: string): string | undefined {
  if (!txHash) return undefined;
  if (chain === 'xrpl') return `https://livenet.xrpl.org/transactions/${txHash.toUpperCase()}`;
  if (chain === 'flare') return `https://flarescan.com/tx/${txHash}`;
  return undefined;
}

interface XrplTxFacts {
  validated: boolean;
  result: string;
  type: string;
  account: string;
  destination?: string;
  destinationTag?: number;
  drops?: string;
  memoHex?: string;
}

async function readXrplTx(hash: string): Promise<XrplTxFacts> {
  const r = await xrplJsonRpc('tx', { transaction: hash, binary: false });
  const tx = (r.tx_json ?? r) as Record<string, unknown>;
  const meta = r.meta as { TransactionResult?: string; delivered_amount?: unknown } | undefined;
  const memos = (tx.Memos as Array<{ Memo?: { MemoData?: string } }>) ?? [];
  const amount = (meta?.delivered_amount ?? tx.DeliverMax ?? tx.Amount) as unknown;
  return {
    validated: r.validated === true,
    result: meta?.TransactionResult ?? 'unknown',
    type: String(tx.TransactionType ?? ''),
    account: String(tx.Account ?? ''),
    destination: tx.Destination ? String(tx.Destination) : undefined,
    destinationTag: typeof tx.DestinationTag === 'number' ? tx.DestinationTag : undefined,
    drops: typeof amount === 'string' ? amount : undefined,
    memoHex: memos[0]?.Memo?.MemoData ? String(memos[0].Memo.MemoData).toUpperCase() : undefined,
  };
}

function ok(label: string, observed: string): Check {
  return { label, observed, ok: true };
}
function bad(label: string, observed: string, reason: string): Check {
  return { label, observed, ok: false, reason };
}

/** Pure: which client a receipt refers to (or undefined). */
export function clientOf(run: DemoRun, receipt: Receipt): DemoClient | undefined {
  return receipt.clientId ? run.clients.find((c) => c.id === receipt.clientId) : undefined;
}

async function xrplValidatedChecks(hash: string, expectType?: string): Promise<{ facts: XrplTxFacts | null; checks: Check[] }> {
  try {
    const facts = await readXrplTx(hash);
    const checks: Check[] = [];
    checks.push(
      facts.validated && facts.result === 'tesSUCCESS'
        ? ok('XRPL transaction validated with tesSUCCESS', `${facts.type} · ${facts.result}`)
        : bad('XRPL transaction validated with tesSUCCESS', `${facts.type} · ${facts.result} · validated=${facts.validated}`, 'not validated or not tesSUCCESS'),
    );
    if (expectType) {
      checks.push(
        facts.type === expectType
          ? ok(`Transaction type is ${expectType}`, facts.type)
          : bad(`Transaction type is ${expectType}`, facts.type, 'unexpected transaction type'),
      );
    }
    return { facts, checks };
  } catch (e) {
    return { facts: null, checks: [bad('XRPL transaction readable', 'n/a', (e as Error).message)] };
  }
}

async function flareReceiptChecks(provider: ethers.Provider, hash: string): Promise<Check[]> {
  try {
    const rcpt = await provider.getTransactionReceipt(hash);
    if (!rcpt) return [bad('Flare transaction mined', 'no receipt yet', 'receipt not found (pending or wrong hash)')];
    return [
      rcpt.status === 1
        ? ok('Flare transaction mined and succeeded', `block ${rcpt.blockNumber} · status 1`)
        : bad('Flare transaction mined and succeeded', `block ${rcpt.blockNumber} · status ${rcpt.status}`, 'the transaction reverted'),
    ];
  } catch (e) {
    return [bad('Flare transaction readable', 'n/a', (e as Error).message)];
  }
}

async function macUsedCheck(provider: ethers.Provider, xrplHash: string): Promise<Check> {
  try {
    const mac = new ethers.Contract(await resolveMasterAccountController(provider), MAC_ABI, provider);
    const used: boolean = await mac.isTransactionIdUsed('0x' + xrplHash.toLowerCase());
    return used
      ? ok('MasterAccountController consumed this XRPL payment (the 0xFE user operation executed on Flare)', 'isTransactionIdUsed = true')
      : bad('MasterAccountController consumed this XRPL payment (the 0xFE user operation executed on Flare)', 'isTransactionIdUsed = false', 'the executor has not delivered it yet (or it failed)');
  } catch (e) {
    return bad('MasterAccountController readable', 'n/a', (e as Error).message);
  }
}

/** Verify ONE receipt against the chain. Never throws — a failure is a ❌ check. */
export async function verifyReceipt(run: DemoRun, receipt: Receipt, provider: ethers.Provider): Promise<Check[]> {
  const client = clientOf(run, receipt);
  const checks: Check[] = [];
  const pote = run.poteAddress ? new ethers.Contract(run.poteAddress, POTE_ABI, provider) : null;

  switch (receipt.step) {
    case 'E1_ANCHOR': {
      if (!receipt.txHash) return [bad('DIDSet transaction recorded', 'no hash', 'no transaction hash on the receipt')];
      const { checks: c } = await xrplValidatedChecks(receipt.txHash, 'DIDSet');
      checks.push(...c);
      try {
        const did = await xrplProvider.getDidObject(run.councilAddress);
        const dataHex = String((did as { dataHex?: string } | null)?.dataHex ?? '');
        const expected = String(receipt.expect?.constitutionSha256 ?? '');
        if (expected) {
          checks.push(
            dataHex.toLowerCase() === expected.toLowerCase()
              ? ok('The council DID carries the constitution hash', dataHex.slice(0, 18) + '…')
              : bad('The council DID carries the constitution hash', dataHex || 'no DID', 'DID data differs from the recorded constitution hash'),
          );
        } else {
          checks.push(/^[0-9a-fA-F]{64}$/.test(dataHex) ? ok('The council DID carries a 32-byte anchor', dataHex.slice(0, 18) + '…') : bad('The council DID carries a 32-byte anchor', dataHex || 'no DID', 'no 64-hex anchor on the DID'));
        }
      } catch (e) {
        checks.push(bad('Council DID readable', 'n/a', (e as Error).message));
      }
      return checks;
    }
    case 'E2_POTE': {
      if (!receipt.txHash) return [bad('0xFE payment recorded', 'no hash', 'no transaction hash on the receipt')];
      const { checks: c } = await xrplValidatedChecks(receipt.txHash, 'Payment');
      checks.push(...c);
      checks.push(await macUsedCheck(provider, receipt.txHash));
      if (process.env.ASTRYUM_CAGE_FACTORY_ADDRESS || process.env.ASTRYUM_FACTORY_ADDRESS) {
        try {
          // Generation-first (v2 cage, then v1): before this, a v2 council read
          // the v1 factory, got "vaultOf(council) is empty", and every E2 check
          // failed in cascade for the wrong reason.
          const { resolveRunPote } = await import('./resolveRunPote');
          const resolved = await resolveRunPote(provider, run.councilAddress);
          if (resolved?.pote) {
            const matches = !run.poteAddress || resolved.pote.toLowerCase() === run.poteAddress.toLowerCase();
            checks.push(
              matches
                ? ok(`The ${resolved.generation} factory registers a pote for this council`, resolved.pote)
                : bad(`The ${resolved.generation} factory registers a pote for this council`, resolved.pote, `run expects ${run.poteAddress}`),
            );
          } else if (resolved?.cage) {
            checks.push(ok('The cage factory registers a cage for this council (pote pending its council order)', resolved.cage));
          } else {
            checks.push(bad('A factory registers this council', 'none', 'neither the cage factory nor the pote factory knows it'));
          }
        } catch (e) {
          checks.push(bad('Factory readable', 'n/a', (e as Error).message));
        }
      }
      if (pote) {
        try {
          const ref: string = await pote.constitutionRef();
          checks.push(/^0x[0-9a-fA-F]{64}$/.test(ref) && !/^0x0+$/.test(ref) ? ok('The pote was born with a constitution reference', ref.slice(0, 18) + '…') : bad('The pote was born with a constitution reference', ref, 'empty constitutionRef'));
        } catch (e) {
          checks.push(bad('Pote readable', 'n/a', (e as Error).message));
        }
      }
      return checks;
    }
    case 'E3_KYC': {
      if (receipt.txHash) checks.push(...(await flareReceiptChecks(provider, receipt.txHash)));
      const registryAddr = run.registryAddress ?? (pote ? await pote.userGate().catch(() => '') : '');
      if (!registryAddr || registryAddr === ethers.ZeroAddress) {
        checks.push(bad('KYC registry known', 'none', 'the run has no registry address and the pote has no userGate'));
        return checks;
      }
      if (!client?.passkeyAccount) {
        checks.push(bad('Client Flare account known', 'none', 'the client has no passkey account on the ledger'));
        return checks;
      }
      try {
        const reg = new ethers.Contract(registryAddr, REGISTRY_ABI, provider);
        const [approved, tag] = await Promise.all([reg.approved(client.passkeyAccount), reg.tagOf(client.passkeyAccount)]);
        checks.push(approved ? ok('The client is approved in the exchange registry (on-chain)', `approved(${client.passkeyAccount.slice(0, 8)}…) = true`) : bad('The client is approved in the exchange registry (on-chain)', 'approved = false', 'setApprovedWithTag has not landed for this account'));
        checks.push(Number(tag) === client.tag ? ok('The registry binds the client account to their exchange tag', `tagOf = ${Number(tag)}`) : bad('The registry binds the client account to their exchange tag', `tagOf = ${Number(tag)}`, `ledger tag is ${client.tag}`));
      } catch (e) {
        checks.push(bad('Registry readable', 'n/a', (e as Error).message));
      }
      return checks;
    }
    case 'E3_CREDENTIAL': {
      if (!receipt.txHash) return [bad('Credential transaction recorded', 'no hash', 'no transaction hash on the receipt')];
      const { checks: c } = await xrplValidatedChecks(receipt.txHash);
      checks.push(...c);
      const subject = client?.xrplAddress ?? String(receipt.expect?.subject ?? '');
      if (subject) {
        try {
          const objs = await xrplProvider.getCredentialObjects(subject);
          checks.push(objs.length > 0 ? ok('The client XRPL account holds a credential object', `${objs.length} credential(s)`) : bad('The client XRPL account holds a credential object', '0', 'no credential objects on the subject account'));
        } catch (e) {
          checks.push(bad('Credential objects readable', 'n/a', (e as Error).message));
        }
      }
      return checks;
    }
    case 'U1_DEPOSIT': {
      if (!receipt.txHash) return [bad('Deposit payment recorded', 'no hash', 'no transaction hash on the receipt')];
      const { facts, checks: c } = await xrplValidatedChecks(receipt.txHash, 'Payment');
      checks.push(...c);
      if (facts) {
        checks.push(facts.destination === run.omnibusAddress ? ok('Paid to the exchange omnibus', facts.destination) : bad('Paid to the exchange omnibus', facts.destination ?? '—', `expected ${run.omnibusAddress}`));
        if (client) {
          checks.push(facts.destinationTag === client.tag ? ok('Carries the client destination tag', String(facts.destinationTag)) : bad('Carries the client destination tag', String(facts.destinationTag), `expected tag ${client.tag}`));
        }
        const expDrops = receipt.expect?.drops ? String(receipt.expect.drops) : undefined;
        if (expDrops && facts.drops) {
          checks.push(facts.drops === expDrops ? ok('Amount matches the ledger entry', `${facts.drops} drops`) : bad('Amount matches the ledger entry', `${facts.drops} drops`, `ledger recorded ${expDrops}`));
        }
      }
      return checks;
    }
    case 'E5_PUT_TO_WORK': {
      if (!receipt.txHash) return [bad('0xFE payment recorded', 'no hash', 'no transaction hash on the receipt')];
      const { facts, checks: c } = await xrplValidatedChecks(receipt.txHash, 'Payment');
      checks.push(...c);
      if (facts) {
        checks.push(facts.account === run.omnibusAddress ? ok('Signed by the exchange omnibus (mode B: the client signs nothing)', facts.account) : bad('Signed by the exchange omnibus (mode B: the client signs nothing)', facts.account, `expected ${run.omnibusAddress}`));
        checks.push(facts.destinationTag === undefined ? ok('No destination tag on the mint payment (FAssets rule)', 'none') : bad('No destination tag on the mint payment (FAssets rule)', String(facts.destinationTag), 'a tag would misroute the mint'));
        checks.push(facts.memoHex?.startsWith('FE') ? ok('Memo is a 0xFE custom instruction (42 bytes)', `FE… (${(facts.memoHex.length / 2) | 0} bytes)`) : bad('Memo is a 0xFE custom instruction (42 bytes)', facts.memoHex ?? 'none', 'memo does not start with 0xFE'));
      }
      checks.push(await macUsedCheck(provider, receipt.txHash));
      if (pote && client?.passkeyAccount) {
        try {
          const bal: bigint = await pote.balanceOf(client.passkeyAccount);
          checks.push(bal > BigInt(0) ? ok('The client account holds shares of the pote (the shares are theirs)', `${ethers.formatUnits(bal, 6)} shares`) : bad('The client account holds shares of the pote (the shares are theirs)', '0 shares', 'no shares yet — the mint may still be pending, or they were already redeemed'));
        } catch (e) {
          checks.push(bad('Pote balance readable', 'n/a', (e as Error).message));
        }
      }
      return checks;
    }
    case 'E6_ORDER': {
      if (!receipt.txHash) return [bad('Council order payment recorded', 'no hash', 'no transaction hash on the receipt')];
      const { facts, checks: c } = await xrplValidatedChecks(receipt.txHash, 'Payment');
      checks.push(...c);
      if (facts) {
        checks.push(facts.account === run.councilAddress ? ok('Signed by the council account (the only authority the bridge obeys)', facts.account) : bad('Signed by the council account (the only authority the bridge obeys)', facts.account, `expected ${run.councilAddress}`));
      }
      if (run.bridgeAddress) {
        try {
          const bridge = new ethers.Contract(run.bridgeAddress, BRIDGE_ABI, provider);
          const consumed: boolean = await bridge.consumedTxId('0x' + receipt.txHash.toLowerCase());
          const nonce = await bridge.nextNonce();
          checks.push(consumed ? ok('The bridge consumed this order after an FDC proof (executed on Flare)', `consumedTxId = true · nextNonce ${nonce}`) : bad('The bridge consumed this order after an FDC proof (executed on Flare)', `consumedTxId = false · nextNonce ${nonce}`, 'not executed yet (FDC round pending) or relay not started'));
        } catch (e) {
          checks.push(bad('Bridge readable', 'n/a', (e as Error).message));
        }
      }
      return checks;
    }
    case 'E7_DENIED': {
      const code = String(receipt.expect?.code ?? '');
      checks.push(code ? ok('The cage refused before any signature (pre-flight verdict)', code) : bad('The cage refused before any signature (pre-flight verdict)', 'no code', 'no refusal code recorded'));
      if (receipt.txHash) {
        const rc = await flareReceiptChecks(provider, receipt.txHash);
        // For a DENIED receipt a reverted tx is the PROOF, so invert the reading.
        for (const k of rc) {
          if (k.label.includes('succeeded')) {
            checks.push(k.ok ? bad('The on-chain attempt reverted (the contract itself said no)', k.observed ?? '', 'the transaction succeeded — this was not a refusal') : ok('The on-chain attempt reverted (the contract itself said no)', k.observed ?? ''));
          } else checks.push(k);
        }
      }
      return checks;
    }
    case 'U4_EXIT':
    case 'U4_EXIT_XRP': {
      if (receipt.txHash) {
        if (receipt.chain === 'flare') checks.push(...(await flareReceiptChecks(provider, receipt.txHash)));
        else {
          // El recibo XRPL de U4 es la VUELTA: el pago del agente FAssets al
          // omnibus con el tag del cliente. NO es un 0xFE — pedirle al MAC
          // `isTransactionIdUsed` dejaba un ❌ eterno en el proof. Se
          // prueba lo que ES: aterrizó en el omnibus, etiquetado para el cliente.
          const { facts, checks: c } = await xrplValidatedChecks(receipt.txHash, 'Payment');
          checks.push(...c);
          if (facts) {
            checks.push(facts.destination === run.omnibusAddress ? ok('The redemption landed at the exchange omnibus', String(facts.destination)) : bad('The redemption landed at the exchange omnibus', String(facts.destination ?? '—'), `expected ${run.omnibusAddress}`));
            if (client) {
              checks.push(facts.destinationTag === client.tag ? ok('Carries the client destination tag', String(facts.destinationTag)) : bad('Carries the client destination tag', String(facts.destinationTag ?? '—'), `expected tag ${client.tag}`));
            }
          }
        }
      } else checks.push(bad('Exit transaction recorded', 'no hash', 'no transaction hash on the receipt'));
      if (pote && client?.passkeyAccount) {
        try {
          const bal: bigint = await pote.balanceOf(client.passkeyAccount);
          const before = receipt.expect?.sharesBefore ? BigInt(String(receipt.expect.sharesBefore)) : undefined;
          const decreased = before === undefined ? bal === BigInt(0) : bal < before;
          checks.push(decreased ? ok('The client shares left their account (burned by the pote on their signature)', `${ethers.formatUnits(bal, 6)} shares now`) : bad('The client shares left their account (burned by the pote on their signature)', `${ethers.formatUnits(bal, 6)} shares now`, 'shares did not decrease'));
        } catch (e) {
          checks.push(bad('Pote balance readable', 'n/a', (e as Error).message));
        }
      }
      return checks;
    }
    case 'E8_WITHDRAW': {
      if (!receipt.txHash) return [bad('Withdrawal payment recorded', 'no hash', 'no transaction hash on the receipt')];
      const { facts, checks: c } = await xrplValidatedChecks(receipt.txHash, 'Payment');
      checks.push(...c);
      if (facts) {
        checks.push(facts.account === run.omnibusAddress ? ok('Paid from the exchange omnibus', facts.account) : bad('Paid from the exchange omnibus', facts.account, `expected ${run.omnibusAddress}`));
        if (client?.xrplAddress) {
          checks.push(facts.destination === client.xrplAddress ? ok('Paid to the client own XRPL wallet', facts.destination) : bad('Paid to the client own XRPL wallet', facts.destination ?? '—', `expected ${client.xrplAddress}`));
        }
      }
      return checks;
    }
    case 'NOTE':
    default:
      return [ok('Note recorded (no chain check applies)', receipt.note ?? '')];
  }
}

/** Verify every receipt (or one) of a run in place; returns the run. */
export async function verifyRun(run: DemoRun, opts?: { receiptId?: string; provider?: ethers.Provider }): Promise<DemoRun> {
  const provider = opts?.provider ?? flareProvider();
  const now = new Date().toISOString();
  for (const r of run.receipts) {
    if (opts?.receiptId && r.id !== opts.receiptId) continue;
    r.checks = await verifyReceipt(run, r, provider);
    r.verifiedAt = now;
  }
  return run;
}

/* ── live chain facts for the surfaces (read-only) ─────────────────────── */

export interface ClientChainFacts {
  clientId: string;
  passkeyAccount?: string;
  shares?: string;
  sharesHuman?: string;
  /** FXRP sitting FREE in the client account (redeemed but not sent out). A
   *  surface that only shows pote shares tells someone who just exited that
   *  they hold nothing — the "you hold 0 FXRP" scare of the rehearsal. */
  fxrpFree?: string;
  fxrpFreeHuman?: string;
  registryApproved?: boolean;
  registryTag?: number;
  error?: string;
}

export async function readClientFacts(run: DemoRun, provider?: ethers.Provider): Promise<ClientChainFacts[]> {
  const p = provider ?? flareProvider();
  const pote = run.poteAddress ? new ethers.Contract(run.poteAddress, POTE_ABI, p) : null;
  let registryAddr = run.registryAddress ?? '';
  if (!registryAddr && pote) registryAddr = await pote.userGate().catch(() => '');
  const reg = registryAddr && registryAddr !== ethers.ZeroAddress ? new ethers.Contract(registryAddr, REGISTRY_ABI, p) : null;
  const out: ClientChainFacts[] = [];
  for (const c of run.clients) {
    const f: ClientChainFacts = { clientId: c.id, passkeyAccount: c.passkeyAccount };
    if (!c.passkeyAccount) {
      out.push(f);
      continue;
    }
    try {
      if (pote) {
        const bal: bigint = await pote.balanceOf(c.passkeyAccount);
        f.shares = bal.toString();
        f.sharesHuman = ethers.formatUnits(bal, 6);
        const assetAddr: string = await pote.asset().catch(() => '');
        if (assetAddr && assetAddr !== ethers.ZeroAddress) {
          const free: bigint = await new ethers.Contract(assetAddr, ['function balanceOf(address) view returns (uint256)'], p).balanceOf(c.passkeyAccount).catch(() => BigInt(0));
          f.fxrpFree = free.toString();
          f.fxrpFreeHuman = ethers.formatUnits(free, 6);
        }
      }
      if (reg) {
        f.registryApproved = Boolean(await reg.approved(c.passkeyAccount));
        f.registryTag = Number(await reg.tagOf(c.passkeyAccount));
      }
    } catch (e) {
      f.error = (e as Error).message;
    }
    out.push(f);
  }
  return out;
}
