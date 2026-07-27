#!/usr/bin/env ts-node
// One-off: measure abi.encode(PackedUserOperation) byte size for the E1 4-call
// ISO batch, to decide if it fits the 0xFF memo cap (~900 bytes usable / 1024 hard).
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import { KineticAdapter } from '../connectors/protocols/adapters/KineticAdapter';
import { buildExecuteUserOpCallData, buildPackedUserOp } from '../connectors/protocols/flare/FlareDirectMintService';

async function main() {
  const batch = await new KineticAdapter().buildIsoSupplyBorrowBatch({ supplyUBA: 4_695_300n, borrowUsdt0: 1_038_568n });
  const callData = await buildExecuteUserOpCallData(batch);
  const { dataHex } = await buildPackedUserOp({
    sender: '0x015604d5ec2AB273A0a9d11f25236862ACEa8D52',
    nonce: 0n,
    callData,
  });
  const userOpBytes = (dataHex.length - 2) / 2;
  const memoBytes = 10 + userOpBytes; // 0xFF = 10-byte header + abi.encode(userOp)
  console.log(`callData bytes:        ${(callData.length - 2) / 2}`);
  console.log(`abi.encode(userOp):    ${userOpBytes} bytes`);
  console.log(`0xFF memo total:       ${memoBytes} bytes (10-byte header + userOp)`);
  console.log(`XRPL memo cap:         1024 bytes`);
  console.log(`Fits 0xFF (<~900 rec / <1024 hard)? ${memoBytes < 1024 ? (memoBytes <= 900 ? 'YES (comfortable)' : 'TIGHT (>900, <1024)') : 'NO — exceeds cap → must use 0xFE'}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
