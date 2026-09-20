/**
 * rehearse-attestation — ensaya la tubería de atestación FDC SIN el quórum.
 *
 *   npx ts-node src/scripts/rehearse-attestation.ts <xrplTxHash>
 */

import dotenv from 'dotenv';
import path from 'path';

// Sin esto el script NO lee backend/.env → DATABASE_URL queda sin definir y el
// chequeo de "persistencia round-trip" reportaría NO SIEMPRE (savePaidAttestation
// hace no-op sin DATABASE_URL), aunque el código y la DB estuvieran perfectos.
// Mismo patrón que los demás CLI (execute-direct-mint.ts:41-43).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { rehearseAttestationPipeline, RelayAbort } from '../services/flare/LegacyOrderRelayService';

async function main(): Promise<void> {
  const [txHash] = process.argv.slice(2);
  if (!txHash) {
    console.error('usage: rehearse-attestation.ts <xrplTxHash>');
    process.exit(1);
  }
  try {
    await rehearseAttestationPipeline({ xrplTxHash: txHash, log: (m) => console.log(m) });
  } catch (e) {
    console.error(`\n✗ ${e instanceof RelayAbort ? 'ABORTED' : 'FAILED'}: ${(e as Error).message}`);
    process.exit(1);
  }
}

void main();
