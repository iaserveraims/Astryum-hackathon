#!/usr/bin/env ts-node
/**
 * EXECUTE-DIRECT-MINT — CLI manual del executor `0xFE` (rescate + operación).
 *
 * Desde 2026-07-12 el executor corre AUTOMÁTICO en el backend
 * (services/flare/DirectMintExecutorService, tras FLARE_EXECUTOR_ENABLED +
 * FLARE_EXECUTOR_PK): barre el Core Vault y ejecuta todo 0xFE firmado usando
 * el handoff persistido en el prepare (DirectMintHandoffStore). Este CLI es
 * la misma maquinaria a mano, para: rescatar txs anteriores a la persistencia
 * (override USER_OP_DATA / reconstrucción), inspeccionar pendientes (--check)
 * y ejecutar puntualmente sin backend.
 *
 * Línea de custodia (invariantes #1/#7): ni el CLI ni el watcher tocan fondos
 * de usuario ni deciden nada — el contrato solo acepta los bytes EXACTOS que
 * la firma de Xaman comprometió (keccak256(_data) == hash del memo + sender +
 * nonce). Quien ejecuta tiene cero discreción: o ejecuta lo firmado, o
 * revierte. La clave del executor firma únicamente (1) la solicitud de
 * attestation al FDC Hub y (2) la llamada de ejecución — gas propio, nunca
 * del backend de Astryum como custodio. Verificado contra
 * MemoInstructionsFacet.sol (flare-smart-accounts) y DirectMintingFacet.sol
 * (fassets): el camino Core Vault NO tiene ventana de expiración
 * (PaymentProofExpired es del carril del operator, no de este).
 *
 * Uso:
 *   npx ts-node src/scripts/execute-direct-mint.ts                  # DRY-RUN (sin clave, no firma nada)
 *   npx ts-node src/scripts/execute-direct-mint.ts --live           # ejecuta (requiere FLARE_EXECUTOR_PK)
 *   npx ts-node src/scripts/execute-direct-mint.ts --check [--mine] # barrido de pendientes (exit 1 si hay)
 *
 * Env:
 *   XRPL_TX_HASH          hash del Payment XRPL a ejecutar (default: 7BFCF65F… del 2026-07-12)
 *   FLARE_EXECUTOR_PK     clave de la EOA del executor — SOLO en .env local/Railway, jamás en el repo
 *   EXECUTOR_ADDRESS      (dry-run) dirección a la que ligar el proof si no hay PK
 *   VAULT                 pista de shape: firelight | earnxrp | monarq | e3-kinetic (default firelight)
 *   USER_OP_DATA          override: bytes exactos del userOp si store+reconstrucción no cuadran
 *   SUPPLY_UBA            override: supply exacto si los params del protocolo cambiaron desde el prepare
 *   FDC_VERIFIER_URL      default https://fdc-verifiers-mainnet.flare.network
 *   FDC_VERIFIER_API_KEY  default clave pública (rate-limited)
 *   DA_LAYER_URL          default https://flr-data-availability.flare.network
 *   FLARE_RPC_URL / XRPL_WSS_URL   RPCs (defaults públicos)
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { ethers } from 'ethers';
import {
  DEFAULTS,
  ExecutorAbort,
  executeDirectMint,
  sweepInstructionPayments,
} from '../services/flare/DirectMintExecutorService';
import { resolveFxrpToken } from '../connectors/protocols/flare/FlareDirectMintService';

const DROPS = 1_000_000;

/** Tx atascada del 2026-07-12 (5 XRP → FXRP → Firelight stXRP). */
const DEFAULT_XRPL_TX_HASH =
  '7BFCF65F8B7853C58B3990E9496EFFED132E78D44871E787993CA692E622F2DE';

const ERC20_READ_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

function fail(msg: string): never {
  console.error(`\n✗ ABORT: ${msg}`);
  process.exit(1);
}

/**
 * Modo --check: barre los Payments entrantes al Core Vault con memo de
 * instrucción Smart Account y comprueba contra el MasterAccountController si
 * cada uno se ejecutó. Un 0xFE tesSUCCESS sin ejecutar = XRP de un usuario
 * aparcado esperando executor. Exit 1 si hay pendientes (alarma para cron).
 */
async function runCheck(): Promise<void> {
  const rpcUrl = process.env.FLARE_RPC_URL || DEFAULTS.rpcUrl;
  const wssUrl = process.env.XRPL_WSS_URL || DEFAULTS.wssUrl;
  const onlyMine = process.argv.includes('--mine');
  const sourceTag = Number(process.env.XRPL_SOURCE_TAG || DEFAULTS.sourceTag);
  const maxPages = Number(process.env.CHECK_PAGES || '10'); // ~2000 txs

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  console.log(`═══ execute-direct-mint --check ═══`);
  const { coreVault, rows } = await sweepInstructionPayments({
    provider,
    wssUrl,
    onlyTag: onlyMine ? sourceTag : null,
    maxPages,
  });
  console.log(`Core Vault: ${coreVault}${onlyMine ? ` · solo SourceTag ${sourceTag}` : ''}`);

  let pending = 0;
  console.log(`Payments con instrucción encontrados: ${rows.length}`);
  for (const r of rows) {
    const ageMin = Math.round((Date.now() - Date.parse(r.dateISO)) / 60_000);
    if (!r.used) pending++;
    console.log(
      `${r.used ? '  ✓ ejecutado ' : '🔴 PENDIENTE  '} ${r.dateISO} · 0x${r.opcode} · ${Number(r.drops) / DROPS} XRP · ` +
        `${r.account} · tag=${r.tag ?? '—'} · ${r.hash}${r.used ? '' : ` · lleva ${ageMin} min sin executor`}`,
    );
  }
  if (pending > 0) {
    console.log(`\n🔴 ${pending} Payment(s) sin ejecutar. Para cada uno:`);
    console.log('   XRPL_TX_HASH=<hash> npx ts-node src/scripts/execute-direct-mint.ts --live');
    console.log('   (o arranca el backend con FLARE_EXECUTOR_ENABLED=true — los ejecuta solo)');
    process.exit(1);
  }
  console.log('\n✓ Sin pendientes — todo lo firmado está ejecutado.');
}

async function main(): Promise<void> {
  if (process.argv.includes('--check')) return runCheck();
  const live = process.argv.includes('--live');
  const txHash = (process.env.XRPL_TX_HASH || DEFAULT_XRPL_TX_HASH).toUpperCase();
  const shapeHint = (process.env.VAULT || 'firelight').toLowerCase();
  const rpcUrl = process.env.FLARE_RPC_URL || DEFAULTS.rpcUrl;

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  let wallet: ethers.Wallet | null = null;
  let executorAddr: string;
  if (live) {
    const pk = process.env.FLARE_EXECUTOR_PK;
    if (!pk) fail('--live requiere FLARE_EXECUTOR_PK en backend/.env (la clave nunca va al repo)');
    wallet = new ethers.Wallet(pk, provider);
    executorAddr = wallet.address;
  } else {
    executorAddr = ethers.getAddress(
      (process.env.EXECUTOR_ADDRESS || '0xeabcd745598916b0131ece397c8d6a332088462c').toLowerCase(),
    );
  }

  console.log(`═══ execute-direct-mint ${live ? '— LIVE' : '— DRY-RUN (no firma nada)'} ═══`);
  console.log(`XRPL tx:   ${txHash}`);
  console.log(`Executor:  ${executorAddr}`);
  console.log('');

  const outcome = await executeDirectMint({
    provider,
    wallet,
    executorAddr,
    txHash,
    wssUrl: process.env.XRPL_WSS_URL,
    verifierBase: process.env.FDC_VERIFIER_URL,
    verifierKey: process.env.FDC_VERIFIER_API_KEY,
    daLayerBase: process.env.DA_LAYER_URL,
    userOpDataOverride: process.env.USER_OP_DATA?.trim() || undefined,
    supplyUbaOverride: process.env.SUPPLY_UBA ? BigInt(process.env.SUPPLY_UBA) : undefined,
    shapeHint,
    log: console.log,
  });

  if (outcome.stage === 'dry-run-ok') {
    console.log('\n═══ DRY-RUN OK ═══');
    console.log('Todo verificado sin firmar nada. Para ejecutar de verdad:');
    console.log('  1. Añade FLARE_EXECUTOR_PK=<clave de la EOA> a backend/.env (solo local)');
    console.log('  2. npx ts-node src/scripts/execute-direct-mint.ts --live');
    console.log(`  3. Coste: fee FDC ${outcome.requestFeeFLR} FLR + gas de 2 txs`);
    console.log(`  4. La fee de executor vuelve en FXRP a ${outcome.executor}`);
    return;
  }

  if (outcome.stage === 'delayed') {
    console.log(
      `\n⚠ DirectMintingDelayed: ejecutable a partir de ${new Date((outcome.executionAllowedAt ?? 0) * 1000).toISOString()}`,
    );
    console.log('  Vuelve a correr este script con --live después de esa hora (el proof se reutiliza).');
    return;
  }

  // ── Verificación post-settlement (ExecutionReceipt, #11) ─────────────────
  const fxrp = new ethers.Contract(await resolveFxrpToken(provider), ERC20_READ_ABI, provider);
  const [paFxrp, execFxrp] = await Promise.all([
    fxrp.balanceOf(outcome.personalAccount),
    fxrp.balanceOf(outcome.executor),
  ]);
  console.log('\n═══ RESULTADO ═══');
  console.log(`Flare tx:    ${outcome.flareTxHash}`);
  console.log(`userOp:      ${outcome.userOpHash} (fuente: ${outcome.userOpSource})`);
  console.log(`FXRP en PA:  ${ethers.formatUnits(paFxrp, 6)} (buffer esperado)`);
  console.log(`FXRP del executor: ${ethers.formatUnits(execFxrp, 6)} (incluye la fee comprometida)`);
  const stxrpAddr = process.env.FIRELIGHT_STXRP;
  if (shapeHint === 'firelight' && stxrpAddr) {
    const stxrp = new ethers.Contract(stxrpAddr, ERC20_READ_ABI, provider);
    console.log(`stXRP en PA: ${ethers.formatUnits(await stxrp.balanceOf(outcome.personalAccount), 6)}`);
  }
  console.log('\nEl mint quedó ejecutado exactamente como se firmó en Xaman.');
}

void main().catch((e) => {
  if (e instanceof ExecutorAbort) fail(e.message);
  console.error('ERROR:', (e as Error).message ?? e);
  process.exit(1);
});
