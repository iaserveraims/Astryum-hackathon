#!/usr/bin/env ts-node
/**
 * DIAGNOSE-STUCK-MINTS — autopsia read-only de Payments 0xFE atascados.
 *
 * Para cada tx: lee el Payment XRPL, resuelve el userOpData (store →
 * reconstrucción), compara el nonce del userOp con el nonce actual del PA,
 * regenera el abiEncodedRequest en el verifier (determinista — debe casar con
 * el MIC ya pagado on-chain), recoge del DA layer un proof de una ronda YA
 * PAGADA por el executor y simula executeDirectMintingWithData con
 * `from = executor`. NO firma, NO gasta: eth_call + HTTP GETs.
 *
 * Uso: npx ts-node src/scripts/diagnose-stuck-mints.ts <txHash:attestationUnixTs> [...]
 *   (attestationUnixTs = timestamp del bloque de una requestAttestation ya
 *    pagada para esa tx — sirve para computar el votingRoundId sin re-pagar)
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { ethers } from 'ethers';
import {
  DEFAULTS,
  ExecutorAbort,
  describeRevert,
  fetchXrplPayment,
  parseMemo0xFE,
  resolveUserOpData,
} from '../services/flare/DirectMintExecutorService';
import { resolveAssetManagerFxrp } from '../connectors/protocols/flare/FlareDirectMintService';
import {
  resolveMasterAccountController,
  resolvePersonalAccount,
  getNonce,
} from '../connectors/protocols/flare/FlareSmartAccountService';

const EXECUTOR = '0xD8767C3C4dC0A1E13F23368B172a5ff78B54CecE';
const REGISTRY = '0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019';

const XRP_PAYMENT_RESPONSE_TUPLE =
  'tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, ' +
  'tuple(bytes32 transactionId, address proofOwner) requestBody, ' +
  'tuple(uint64 blockNumber, uint64 blockTimestamp, string sourceAddress, bytes32 sourceAddressHash, ' +
  'bytes32 receivingAddressHash, bytes32 intendedReceivingAddressHash, int256 spentAmount, ' +
  'int256 intendedSpentAmount, int256 receivedAmount, int256 intendedReceivedAmount, bool hasMemoData, ' +
  'bytes firstMemoData, bool hasDestinationTag, uint256 destinationTag, uint8 status) responseBody)';

async function diagnose(txHash: string, attestationTs: number): Promise<void> {
  console.log(`\n════ ${txHash} ════`);
  const provider = new ethers.JsonRpcProvider(process.env.FLARE_RPC_URL || DEFAULTS.rpcUrl);
  const log = (m: string) => console.log(`  ${m}`);

  const payment = await fetchXrplPayment(txHash, process.env.XRPL_WSS_URL || DEFAULTS.wssUrl);
  const memo = parseMemo0xFE(payment.memoHex);
  log(`Payment: ${Number(payment.grossDrops) / 1e6} XRP de ${payment.account} → ${payment.destination}`);
  log(`memo: walletId=${memo.walletId} fee=${memo.executorFeeUBA} userOpHash=${memo.userOpHash}`);

  const personalAccount = await resolvePersonalAccount(provider, payment.account);
  const nonce = await getNonce(provider, personalAccount);
  log(`PA: ${personalAccount} — nonce actual: ${nonce}`);

  const mac = new ethers.Contract(
    await resolveMasterAccountController(provider),
    ['function isTransactionIdUsed(bytes32) view returns (bool)', 'function getExecutor(address) view returns (address)'],
    provider,
  );
  const txId = '0x' + txHash.toLowerCase();
  log(`isTransactionIdUsed: ${await mac.isTransactionIdUsed(txId)} · pinnedExecutor: ${await mac.getExecutor(personalAccount).catch(() => 'n/a')}`);

  // userOpData (store → reconstrucción)
  let userOpData: string;
  try {
    const resolved = await resolveUserOpData(provider, { memo, payment, personalAccount, nonce, log });
    userOpData = resolved.userOpData;
    log(`userOpData: ${resolved.source} (${(userOpData.length - 2) / 2} bytes)`);
  } catch (e) {
    log(`✗ userOpData IRRESOLUBLE: ${(e as Error).message}`);
    return;
  }
  const op = ethers.AbiCoder.defaultAbiCoder().decode(
    ['tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)'],
    userOpData,
  )[0];
  log(`userOp.nonce=${op.nonce} vs PA nonce actual=${nonce} ${BigInt(op.nonce) === BigInt(nonce) ? '✓' : '✗ DESFASADO'}`);

  // abiEncodedRequest determinista (mismo que el ya pagado)
  const toHex32 = (s: string) => '0x' + Buffer.from(s).toString('hex').padEnd(64, '0');
  const prepResp = await fetch(`${DEFAULTS.verifierBase}/verifier/xrp/XRPPayment/prepareRequest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': process.env.FDC_VERIFIER_API_KEY || DEFAULTS.verifierKey },
    body: JSON.stringify({
      attestationType: toHex32('XRPPayment'),
      sourceId: toHex32('XRP'),
      requestBody: { transactionId: txId, proofOwner: EXECUTOR },
    }),
  });
  const prep = (await prepResp.json()) as { abiEncodedRequest?: string };
  if (!prep.abiEncodedRequest) {
    log(`✗ verifier no devolvió request (${prepResp.status})`);
    return;
  }
  log(`abiEncodedRequest regenerado (MIC ${prep.abiEncodedRequest.slice(130, 146)}…)`);

  // roundId de la attestation YA pagada
  const registry = new ethers.Contract(REGISTRY, ['function getContractAddressByName(string) view returns (address)'], provider);
  const fsm = new ethers.Contract(
    await registry.getContractAddressByName('FlareSystemsManager'),
    ['function firstVotingRoundStartTs() view returns (uint64)', 'function votingEpochDurationSeconds() view returns (uint64)'],
    provider,
  );
  const [firstTs, epochSec] = await Promise.all([fsm.firstVotingRoundStartTs(), fsm.votingEpochDurationSeconds()]);
  const roundId = Number((BigInt(attestationTs) - BigInt(firstTs)) / BigInt(epochSec));
  log(`votingRound ya pagado: ${roundId}`);

  const daResp = await fetch(`${DEFAULTS.daLayerBase}/api/v1/fdc/proof-by-request-round-raw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ votingRoundId: roundId, requestBytes: prep.abiEncodedRequest }),
  });
  const da = (await daResp.json().catch(() => ({}))) as { response_hex?: string; proof?: string[] };
  if (!da.response_hex) {
    log(`✗ DA layer sin proof para la ronda ${roundId} (HTTP ${daResp.status})`);
    return;
  }
  log(`proof recuperado del DA layer (${(da.proof ?? []).length} nodos) — SIN pagar nada`);

  const resp = ethers.AbiCoder.defaultAbiCoder().decode([XRP_PAYMENT_RESPONSE_TUPLE], da.response_hex)[0];
  const rb = resp.responseBody;
  const proofStruct = {
    merkleProof: da.proof ?? [],
    data: {
      attestationType: resp.attestationType,
      sourceId: resp.sourceId,
      votingRound: resp.votingRound,
      lowestUsedTimestamp: resp.lowestUsedTimestamp,
      requestBody: { transactionId: resp.requestBody.transactionId, proofOwner: resp.requestBody.proofOwner },
      responseBody: {
        blockNumber: rb.blockNumber, blockTimestamp: rb.blockTimestamp, sourceAddress: rb.sourceAddress,
        sourceAddressHash: rb.sourceAddressHash, receivingAddressHash: rb.receivingAddressHash,
        intendedReceivingAddressHash: rb.intendedReceivingAddressHash, spentAmount: rb.spentAmount,
        intendedSpentAmount: rb.intendedSpentAmount, receivedAmount: rb.receivedAmount,
        intendedReceivedAmount: rb.intendedReceivedAmount, hasMemoData: rb.hasMemoData,
        firstMemoData: rb.firstMemoData, hasDestinationTag: rb.hasDestinationTag,
        destinationTag: rb.destinationTag, status: rb.status,
      },
    },
  };

  const paIface = new ethers.Interface(['function executeUserOp((address target, uint256 value, bytes data)[] _calls) payable']);
  const calls = paIface.decodeFunctionData('executeUserOp', op.callData)[0] as Array<{ value: bigint }>;
  const totalCallValue = calls.reduce((a, c) => a + BigInt(c.value), 0n);

  const am = new ethers.Contract(
    await resolveAssetManagerFxrp(provider),
    [`function executeDirectMintingWithData(tuple(bytes32[] merkleProof, ${XRP_PAYMENT_RESPONSE_TUPLE} data) _payment, bytes _data) payable`],
    provider,
  );
  try {
    await am.executeDirectMintingWithData.staticCall(proofStruct, userOpData, { from: EXECUTOR, value: totalCallValue });
    log('✓✓ LA SIMULACIÓN PASA — esto es ejecutable tal cual (el proof ya está pagado)');
  } catch (e) {
    log(`✗ REVERT: ${describeRevert(e)}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('uso: diagnose-stuck-mints.ts <txHash:attestationUnixTs> [...]');
    process.exit(1);
  }
  for (const a of args) {
    const [hash, ts] = a.split(':');
    try {
      await diagnose(hash.toUpperCase(), Number(ts));
    } catch (e) {
      console.error(`  ✗ fallo del diagnóstico: ${e instanceof ExecutorAbort ? 'ABORT ' : ''}${(e as Error).message}`);
    }
  }
}

void main();
