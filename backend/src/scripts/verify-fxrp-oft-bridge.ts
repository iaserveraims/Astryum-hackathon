#!/usr/bin/env ts-node
/**
 * verify-fxrp-oft-bridge — el puente FXRP, verificado en LAS DOS DIRECCIONES.
 *
 * H9: los adapters citan `verify-fxrp-oft-bridge.js` como su fuente de verdad
 * y ese fichero NO existe en el repo. Un comentario que apunta a una
 * verificación inexistente es peor que no tener comentario: promete rigor.
 *
 * Y H3: la vuelta (Ethereum→Flare) no estaba construida. Antes de construirla
 * hay que saber, contra la cadena, cuál es el EID de Flare y si los dos lados
 * están emparejados — un `peers()` que no cuadra significa que el envío se
 * traga los tokens en el origen y no aparecen nunca en el destino.
 *
 * Uso:
 *   ETHEREUM_RPC_URL=https://… npm run verify:fxrp-bridge
 *
 * Salidas: 0 ok · 1 falta RPC · 2 cadena equivocada · 3 sin código ·
 *          4 peering roto (NO construir la vuelta) · 5 lectura fallida
 */

import { ethers } from 'ethers';
import {
  FXRP_OFT_ADAPTER_FLARE,
  FXRP_FLARE_ERC20,
  FXRP_ETH_OFT,
  ETHEREUM_EID,
  addrToBytes32,
} from '../connectors/protocols/adapters/FxrpOftBridgeAdapter';

/** Candidato al EID de LayerZero de Flare — se CONFIRMA contra la cadena. */
const FLARE_EID_CANDIDATES = [30295, 30111, 30112];

const OFT_ABI = [
  'function token() view returns (address)',
  'function peers(uint32 eid) view returns (bytes32)',
  'function sharedDecimals() view returns (uint8)',
  'function approvalRequired() view returns (bool)',
];

function die(code: number, msg: string): never {
  console.error(`\n  ✖ ${msg}\n`);
  process.exit(code);
}

async function main(): Promise<void> {
  const ethRpc = process.env.ETHEREUM_RPC_URL;
  const flareRpc = process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc';
  if (!ethRpc) die(1, 'ETHEREUM_RPC_URL no está puesta — la vuelta del puente vive en Ethereum.');

  console.log('\n  Puente FXRP (LayerZero OFT) — verificación de las DOS direcciones');
  console.log('  ' + '─'.repeat(66));

  const eth = new ethers.JsonRpcProvider(ethRpc);
  const flare = new ethers.JsonRpcProvider(flareRpc);

  const net = await eth.getNetwork().catch(() => null);
  if (!net) die(5, 'El RPC de Ethereum no respondió.');
  if (Number(net.chainId) !== 1) die(2, `El RPC apunta a chainId ${net.chainId}, no a Ethereum (1).`);

  for (const [label, provider, addr] of [
    ['Flare  · adapter', flare, FXRP_OFT_ADAPTER_FLARE],
    ['Ethereum · OFT  ', eth, FXRP_ETH_OFT],
  ] as const) {
    const code = await provider.getCode(addr).catch(() => '0x');
    if (!code || code === '0x') die(3, `${label} ${addr} no tiene código en su cadena.`);
  }

  // ── Ida: Flare → Ethereum (lo ya construido) ──────────────────────────────
  const flareOft = new ethers.Contract(FXRP_OFT_ADAPTER_FLARE, OFT_ABI, flare);
  const [wrapped, sharedDecFlare, approvalRequired, peerEth] = await Promise.all([
    flareOft.token() as Promise<string>,
    flareOft.sharedDecimals() as Promise<bigint>,
    flareOft.approvalRequired().catch(() => null) as Promise<boolean | null>,
    flareOft.peers(ETHEREUM_EID) as Promise<string>,
  ]);
  const wrapsCanonical = String(wrapped).toLowerCase() === FXRP_FLARE_ERC20.toLowerCase();
  const peerEthOk = String(peerEth).toLowerCase() === addrToBytes32(FXRP_ETH_OFT).toLowerCase();
  console.log(`  IDA · Flare → Ethereum (EID ${ETHEREUM_EID})`);
  console.log(`    adapter envuelve el FXRP canónico ... ${wrapsCanonical ? '✓' : '✖ ' + wrapped}`);
  console.log(`    approvalRequired .................... ${approvalRequired === null ? 'n/d' : approvalRequired}`);
  console.log(`    sharedDecimals ..................... ${sharedDecFlare}`);
  console.log(`    peers(ETH) == OFT de Ethereum ...... ${peerEthOk ? '✓' : '✖ ' + peerEth}`);
  if (!wrapsCanonical || !peerEthOk) die(4, 'La IDA no está bien emparejada — no enviar.');

  // ── Vuelta: Ethereum → Flare (H3) ─────────────────────────────────────────
  // El EID de Flare NO se asume: se prueba cada candidato contra `peers()` del
  // OFT de Ethereum y solo se acepta el que devuelve el adapter de Flare.
  const ethOft = new ethers.Contract(FXRP_ETH_OFT, OFT_ABI, eth);
  const expectFlarePeer = addrToBytes32(FXRP_OFT_ADAPTER_FLARE).toLowerCase();
  let flareEid: number | null = null;
  for (const eid of FLARE_EID_CANDIDATES) {
    try {
      const p = String(await ethOft.peers(eid)).toLowerCase();
      if (p === expectFlarePeer) {
        flareEid = eid;
        break;
      }
    } catch {
      /* ese EID no está registrado — se sigue probando */
    }
  }
  const sharedDecEth = await ethOft.sharedDecimals().catch(() => null);
  const ethApproval = await ethOft.approvalRequired().catch(() => null);
  console.log('  ' + '─'.repeat(66));
  console.log('  VUELTA · Ethereum → Flare');
  console.log(`    sharedDecimals ..................... ${sharedDecEth ?? 'n/d'}`);
  console.log(`    approvalRequired ................... ${ethApproval === null ? 'n/d (OFT nativo: no hace falta)' : ethApproval}`);
  if (flareEid === null) {
    console.log('    EID de Flare ....................... ✖ NINGÚN candidato empareja');
    console.log(`      probados: ${FLARE_EID_CANDIDATES.join(', ')}`);
    die(4, 'La VUELTA no está emparejada con ninguno de los EIDs probados — no construir el envío de vuelta.');
  }
  console.log(`    EID de Flare ....................... ✓ ${flareEid} (peers → adapter de Flare)`);
  if (sharedDecEth !== null && Number(sharedDecEth) !== Number(sharedDecFlare)) {
    console.log('    ⚠ sharedDecimals DIFIEREN entre lados: habría redondeo silencioso.');
  }

  console.log('  ' + '─'.repeat(66));
  console.log(`  Puente verificado en las dos direcciones. FLARE_EID = ${flareEid}.`);
  console.log('  Re-córrelo si cambia cualquiera de los dos contratos.\n');
}

main().catch((e) => {
  console.error('\n  ✖ Fallo inesperado:', (e as Error).message, '\n');
  process.exit(5);
});
