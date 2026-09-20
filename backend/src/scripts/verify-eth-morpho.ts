#!/usr/bin/env ts-node
/**
 * verify-eth-morpho — la verificación B0 del venue, REPETIBLE.
 *
 * El plan del mes (§13.5, riesgo 3) exige re-correr B0 antes del ensayo E2E:
 * el mercado FXRP/RLUSD navegaba al ~90% de utilización y «la liquidez del
 * mercado se mueve». Hasta hoy esa verificación era manual — es
 * decir, no repetible, que en la práctica significa que no se repite.
 */

import { ethers } from 'ethers';
import {
  makeEthersMorphoReader,
  readMarketSnapshot,
  preflightBorrow,
} from '../services/EthMorphoMarketService';
import {
  FXRP_RLUSD_MARKET_ID,
  MORPHO_BLUE_SINGLETON,
} from '../connectors/protocols/adapters/MorphoBlueEthAdapter';
import { SENTORA_RLUSD_VAULT } from '../connectors/protocols/adapters/SentoraRlusdVaultAdapter';

const VAULT_READ_ABI = [
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function symbol() view returns (string)',
  // El que decide si HOY puedes salir. Ver la nota de liquidez más abajo.
  'function liquidityAdapter() view returns (address)',
];

/** base units → decimal legible, sin floats (patrón baseUnits de la casa). */
function fmt(raw: bigint, decimals: number, maxFrac = 2): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = (raw % base).toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${frac ? `.${frac}` : ''}`;
}

function die(code: number, msg: string): never {
  console.error(`\n  ✖ ${msg}\n`);
  process.exit(code);
}

async function main(): Promise<void> {
  const rpc = process.env.ETHEREUM_RPC_URL;
  if (!rpc) {
    die(1, 'ETHEREUM_RPC_URL no está puesta — sin RPC de Ethereum no hay nada que verificar.');
  }

  const borrowArgIdx = process.argv.indexOf('--borrow');
  const borrowHuman = borrowArgIdx >= 0 ? process.argv[borrowArgIdx + 1] : null;

  console.log('\n  Verificación del venue FXRP/RLUSD (Morpho Blue + bóveda Sentora)');
  console.log('  ' + '─'.repeat(66));

  const provider = new ethers.JsonRpcProvider(rpc);

  // 1. ¿Es la cadena que decimos? Un RPC equivocado que responde bonito es
  //    peor que uno caído: los números serían de otra red.
  const net = await provider.getNetwork().catch(() => null);
  if (!net) die(5, 'El RPC no respondió a getNetwork().');
  if (Number(net.chainId) !== 1) {
    die(2, `El RPC apunta a chainId ${net.chainId}, no a Ethereum mainnet (1).`);
  }
  console.log(`  Cadena .................. Ethereum mainnet (chainId 1) ✓`);

  // 2. El singleton existe en esta cadena.
  const code = await provider.getCode(MORPHO_BLUE_SINGLETON).catch(() => '0x');
  if (!code || code === '0x') {
    die(3, `El singleton de Morpho ${MORPHO_BLUE_SINGLETON} no tiene código en esta cadena.`);
  }
  console.log(`  Morpho Blue ............. ${MORPHO_BLUE_SINGLETON} (con código) ✓`);

  // 3+4+5+6. Drift-check + estado vivo, con las MISMAS lecturas de la ruta.
  const reader = makeEthersMorphoReader(provider);
  let snap;
  try {
    snap = await readMarketSnapshot(reader, FXRP_RLUSD_MARKET_ID);
  } catch (e) {
    const err = e as Error & { code?: string; onchain?: unknown; pinned?: unknown };
    if (err.code === 'MARKET_PARAMS_DRIFT') {
      console.error('\n  ✖ DRIFT de parámetros del mercado — el carril NO debe encenderse.');
      console.error('    on-chain:', JSON.stringify(err.onchain, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
      console.error('    fijados :', JSON.stringify(err.pinned, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
      process.exit(4);
    }
    die(5, `No se pudo leer el mercado: ${err.message}`);
  }

  const { params, state, availableLiquidity, utilization, oraclePrice, loanDecimals, collateralDecimals } = snap;
  console.log(`  Params del mercado ...... sin drift ✓ (LLTV ${Number(params.lltv) / 1e16}%)`);
  console.log(`  Oráculo ................. ${params.oracle} → price() responde ✓`);
  console.log(`  Decimales LEÍDOS ........ colateral FXRP ${collateralDecimals} · préstamo RLUSD ${loanDecimals}`);
  if (collateralDecimals !== 6 || loanDecimals !== 18) {
    console.log('    ⚠ Los decimales NO son los 6/18 esperados — revisa antes de tocar importes.');
  }
  console.log('  ' + '─'.repeat(66));
  console.log(`  Supplied ................ ${fmt(state.totalSupplyAssets, loanDecimals)} RLUSD`);
  console.log(`  Borrowed ................ ${fmt(state.totalBorrowAssets, loanDecimals)} RLUSD`);
  console.log(`  LIQUIDEZ DISPONIBLE ..... ${fmt(availableLiquidity, loanDecimals)} RLUSD`);
  console.log(`  Utilización ............. ${(utilization * 100).toFixed(2)}%`);
  console.log(
    `  Borrow APR .............. ${
      snap.borrowAprPct === undefined ? 'no disponible (se dice, no se inventa)' : `${snap.borrowAprPct.toFixed(2)}%`
    }`,
  );
  console.log(`    fuente: ${snap.borrowAprSource}`);
  console.log(`  Precio del oráculo ...... ${oraclePrice.toString()} (escala 1e36 ajustada)`);

  // 7. La bóveda Sentora — la pata lend-only.
  console.log('  ' + '─'.repeat(66));
  try {
    const vault = new ethers.Contract(SENTORA_RLUSD_VAULT, VAULT_READ_ABI, provider);
    const [asset, totalAssets, symbol] = await Promise.all([
      vault.asset() as Promise<string>,
      vault.totalAssets() as Promise<bigint>,
      vault.symbol().catch(() => '?') as Promise<string>,
    ]);
    const assetOk = asset.toLowerCase() === params.loanToken.toLowerCase();
    console.log(`  Bóveda Sentora .......... ${SENTORA_RLUSD_VAULT} (${symbol})`);
    console.log(`    asset() == RLUSD ...... ${assetOk ? '✓' : '✖ NO COINCIDE — no depositar'}`);
    console.log(`    totalAssets ........... ${fmt(BigInt(totalAssets), loanDecimals)} RLUSD`);
    if (!assetOk) die(5, 'La bóveda no sostiene RLUSD: el carril lend-only NO debe encenderse.');

    // LA LIQUIDEZ DE SALIDA — lo que de verdad decide si hoy puedes salir.
    // Es Morpho Vault V2: sus `max*` son stubs a 0 y no dicen nada. Con
    // `liquidityAdapter() == address(0)` el camino de `withdraw` NO desasigna
    // de los mercados al vuelo, así que el saldo líquido de la bóveda es el
    // TECHO DURO de una retirada instantánea. Por eso se relee antes de cada
    // ensayo: 319M de totalAssets no significan que puedas sacar hoy.
    const erc20 = new ethers.Contract(
      asset, ['function balanceOf(address) view returns (uint256)'], provider,
    );
    const [idle, liqAdapter] = await Promise.all([
      erc20.balanceOf(SENTORA_RLUSD_VAULT) as Promise<bigint>,
      (vault.liquidityAdapter() as Promise<string>).catch(() => ethers.ZeroAddress),
    ]);
    const onDemand = liqAdapter !== ethers.ZeroAddress;
    const pct = totalAssets > 0n ? Number((BigInt(idle) * 10000n) / BigInt(totalAssets)) / 100 : 0;
    console.log(
      `    SALIDA disponible ..... ${fmt(BigInt(idle), loanDecimals)} RLUSD (${pct.toFixed(2)}% del total)`,
    );
    console.log(
      `    liquidityAdapter ...... ${
        onDemand
          ? `${liqAdapter} — puede desasignar al vuelo, la salida real es MAYOR`
          : 'ninguno — la salida NO puede pasar de esa cifra'
      }`,
    );
  } catch (e) {
    console.log(`  Bóveda Sentora .......... ⚠ no se pudo leer (${(e as Error).message})`);
  }

  // 8. Pre-flight real del borrow pedido.
  if (borrowHuman) {
    console.log('  ' + '─'.repeat(66));
    let assets: bigint;
    try {
      const [w, f = ''] = String(borrowHuman).split('.');
      if (f.length > loanDecimals) throw new Error(`más de ${loanDecimals} decimales`);
      assets = BigInt(w + f.padEnd(loanDecimals, '0'));
    } catch (e) {
      die(5, `--borrow ${borrowHuman}: ${(e as Error).message}`);
    }
    // `strict` está apagado en este repo: el narrowing por discriminante
    // booleano no funciona en la rama else (mismo motivo por el que
    // TranslateResult lleva sus campos `?: undefined`).
    const verdict = preflightBorrow(snap, assets) as { ok: boolean; code?: string; message?: string };
    if (verdict.ok) {
      console.log(`  Pre-flight borrow ....... ${borrowHuman} RLUSD CABE en la liquidez ✓`);
    } else {
      console.log(`  Pre-flight borrow ....... ✖ ${verdict.code}: ${verdict.message}`);
      console.log('\n  El venue está vivo, pero ESE importe no entra hoy.\n');
      process.exit(6);
    }
  }

  console.log('  ' + '─'.repeat(66));
  console.log('  Venue verificado. Re-córrelo justo antes del ensayo E2E:');
  console.log('  la liquidez se mueve y la ficha del usuario debe decir la verdad del día.\n');
}

main().catch((e) => {
  console.error('\n  ✖ Fallo inesperado:', (e as Error).message, '\n');
  process.exit(5);
});
