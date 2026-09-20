/**
 * dryrun-eth-morpho — el ensayo EN SECO del carril FXRP/RLUSD.
 *
 * `verify-eth-morpho` comprueba que el VENUE es el que creemos. Esto comprueba
 * otra cosa, y es la que de verdad falta antes de poner dinero: **qué va a
 * firmar exactamente el usuario**. Compone las patas reales de cada acción
 * contra lecturas vivas de mainnet, las DECODIFICA (contrato, función,
 * argumentos) y simula por `eth_call` la primera pata de cada acción — la única
 * que se puede simular honestamente, porque las siguientes dependen del estado
 * que crea la anterior.
 *
 * Usa los MISMOS lectores que la ruta (`services/ethMorphoReaders`), no una
 * copia: un ensayo sobre lectores duplicados verificaría un carril que el
 * usuario no firma.
 *
 * Astryum sigue sin firmar y sin emitir nada: aquí solo hay `eth_call`.
 *
 * Uso:
 *   npm run dryrun:eth-morpho -- --user 0xTuWallet
 *   npm run dryrun:eth-morpho -- --user 0x… --fxrp 10 --rlusd 5 --deposit 100
 *
 * Salidas: 0 todo compone · 1 error de uso/RPC · 7 alguna pata revierte HOY.
 */
import { ethers, Interface } from 'ethers';
import {
  prepareEthMorpho,
  prepareSentoraVault,
  prepareFxrpBridge,
  prepareFxrpBridgeBack,
  type EthMorphoAction,
} from '../services/EthMorphoPrepareService';
import {
  makeMorphoReader,
  makeSentoraReader,
  makeBridgeReader,
  makeBridgeBackReader,
} from '../services/ethMorphoReaders';
import { getRpcForChain } from '../utils/rpcForChain';
import { FXRP_ETH, RLUSD_ETH } from '../connectors/protocols/adapters/MorphoBlueEthAdapter';
import { SENTORA_RLUSD_VAULT } from '../connectors/protocols/adapters/SentoraRlusdVaultAdapter';
import { FXRP_OFT_ADAPTER_FLARE, FXRP_ETH_OFT } from '../connectors/protocols/adapters/FxrpOftBridgeAdapter';

/** Todo lo que este carril puede llegar a llamar. Para decodificar, no para firmar. */
const KNOWN = new Interface([
  'function approve(address spender, uint256 amount)',
  'function deposit(uint256 assets, address receiver)',
  'function withdraw(uint256 assets, address receiver, address owner)',
  'function supplyCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, bytes data)',
  'function withdrawCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, address receiver)',
  'function borrow((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)',
  'function repay((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data)',
  'function send((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, (uint256 nativeFee, uint256 lzTokenFee) fee, address refundTo)',
]);

/** Nombres legibles para que el informe no sea una lista de direcciones. */
const LABEL: Record<string, string> = {
  [FXRP_ETH.toLowerCase()]: 'FXRP (Ethereum, 6 dec)',
  [RLUSD_ETH.toLowerCase()]: 'RLUSD (Ethereum, 18 dec)',
  [SENTORA_RLUSD_VAULT.toLowerCase()]: 'bóveda Sentora',
  [FXRP_OFT_ADAPTER_FLARE.toLowerCase()]: 'adapter OFT (Flare)',
  [FXRP_ETH_OFT.toLowerCase()]: 'FXRP OFT (Ethereum)',
  '0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb': 'Morpho Blue (singleton)',
};

function fmt(raw: bigint, decimals: number, maxFrac = 6): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = (raw % base).toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

/** humano → base units, sin floats (un float aquí es dinero perdido). */
function toBase(human: string, decimals: number): string {
  const [w, f = ''] = String(human).split('.');
  if (f.length > decimals) throw new Error(`"${human}" tiene más de ${decimals} decimales`);
  return BigInt((w || '0') + f.padEnd(decimals, '0')).toString();
}

function arg(v: unknown): string {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return `[${v.map(arg).join(', ')}]`;
  const s = String(v);
  return LABEL[s.toLowerCase()] ? `${s.slice(0, 10)}… (${LABEL[s.toLowerCase()]})` : s;
}

function decode(data: string): string {
  try {
    const parsed = KNOWN.parseTransaction({ data });
    if (!parsed) return `${data.slice(0, 10)}… (selector desconocido)`;
    return `${parsed.name}(${parsed.args.map(arg).join(', ')})`;
  } catch {
    return `${data.slice(0, 10)}… (NO decodificable — revísalo a mano)`;
  }
}

const argv = process.argv.slice(2);
function flag(name: string, dflt?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}

let anyRevert = false;

/** Compone, decodifica y —la primera pata— simula. */
async function report(
  title: string,
  chainId: number,
  user: string,
  build: () => Promise<{
    legs: Array<{ to: string; data: string; value?: string; description?: string }>;
    preflight?: { ok: boolean; checks: Array<{ name: string; ok: boolean; code?: string; message?: string }> };
  }>,
): Promise<void> {
  console.log('  ' + '─'.repeat(72));
  console.log(`  ${title}`);
  let out;
  try {
    out = await build();
  } catch (e) {
    const err = e as { code?: string; message?: string };
    // Un rechazo del compositor NO es un fallo del ensayo: muchas veces es el
    // producto diciendo «esto no se firma» — que es justo lo que queremos ver.
    console.log(`    ⛔ el compositor se NIEGA a construir: ${err.code ?? ''} ${err.message ?? String(e)}`);
    return;
  }

  for (const [i, leg] of out.legs.entries()) {
    const to = leg.to.toLowerCase();
    console.log(`    leg ${i}  → ${LABEL[to] ?? leg.to}`);
    console.log(`             ${decode(leg.data)}`);
    // `value` viaja en HEX ('0x0' en todo lo de Morpho) — compararlo con '0'
    // como cadena pintaba «value: 0» en cada pata. Se compara el número.
    const value = leg.value ? BigInt(leg.value) : 0n;
    if (value > 0n) {
      console.log(`             value: ${fmt(value, 18)} ${chainId === 14 ? 'FLR' : 'ETH'} (comisión de entrega)`);
    }
  }

  if (out.preflight) {
    for (const c of out.preflight.checks) {
      console.log(`    pre-flight ${c.name}: ${c.ok ? '✓' : `✖ ${c.code ?? ''} — ${c.message ?? ''}`}`);
    }
    if (!out.preflight.ok) {
      console.log('    ⛔ el pre-flight BLOQUEA la firma. No se simula: el producto ya dijo que no.');
      return;
    }
  }

  // Solo la pata 0 se puede simular honestamente: las siguientes dependen del
  // estado que crea la anterior (misma semántica que el servicio).
  const leg0 = out.legs[0];
  if (!leg0) return;
  try {
    const provider = getRpcForChain(chainId);
    await provider.call({
      to: leg0.to, from: user, data: leg0.data,
      ...(leg0.value && leg0.value !== '0' ? { value: BigInt(leg0.value) } : {}),
    });
    console.log('    simulación leg 0: ✓ pasaría HOY');
    if (out.legs.length > 1) {
      console.log(`    legs 1..${out.legs.length - 1}: depende del estado que crea la anterior (no se simula: sería mentir)`);
    }
  } catch (e) {
    anyRevert = true;
    console.log(`    simulación leg 0: ✖ REVIERTE — ${((e as Error).message || '').slice(0, 120)}`);
  }
}

async function main() {
  const user = flag('user');
  if (!user || !/^0x[0-9a-fA-F]{40}$/.test(user)) {
    console.error('\n  Uso: npm run dryrun:eth-morpho -- --user 0xTuWallet [--fxrp 10] [--rlusd 5] [--deposit 100]\n');
    process.exit(1);
  }
  if (!process.env.ETHEREUM_RPC_URL && !process.env.ALCHEMY_API_KEY) {
    console.error('\n  ✖ ETHEREUM_RPC_URL no está puesta — sin RPC de Ethereum no hay nada que ensayar.\n');
    process.exit(1);
  }

  const fxrp = toBase(flag('fxrp', '10')!, 6);
  const rlusd = toBase(flag('rlusd', '5')!, 18);
  const deposit = toBase(flag('deposit', '100')!, 18);

  console.log('\n  Ensayo EN SECO del carril FXRP/RLUSD — qué firmarías exactamente');
  console.log('  ' + '─'.repeat(72));
  console.log(`  Wallet .................. ${user}`);
  console.log(`  Importes del ensayo ..... colateral ${fmt(BigInt(fxrp), 6)} FXRP · borrow ${fmt(BigInt(rlusd), 18)} RLUSD · depósito ${fmt(BigInt(deposit), 18)} RLUSD`);
  console.log('  Astryum no firma nada aquí: todo son eth_call de solo lectura.');

  const morpho = makeMorphoReader();
  const vault = makeSentoraReader();

  // ── El mercado (carry) ────────────────────────────────────────────────────
  const acciones: Array<[string, EthMorphoAction, Record<string, unknown>]> = [
    ['CARRY — abrir en una sesión (approve + colateral + borrow)', 'open_carry', { amountBase: fxrp, borrowBase: rlusd }],
    ['Aportar colateral suelto', 'supply_collateral', { amountBase: fxrp }],
    ['Pedir prestado suelto', 'borrow', { amountBase: rlusd }],
    ['Repagar parcial', 'repay', { amountBase: rlusd, repayMode: 'partial' }],
    ['Repagar TODO (contra la deuda viva, sin polvo)', 'repay', { repayMode: 'full' }],
    ['Sacar colateral', 'withdraw_collateral', { amountBase: fxrp }],
  ];
  for (const [title, action, extra] of acciones) {
    await report(title, 1, user, () =>
      prepareEthMorpho(morpho, { action, user, ...extra } as never),
    );
  }

  // ── La bóveda (lend-only) ─────────────────────────────────────────────────
  await report('BÓVEDA — depositar RLUSD (approve + deposit)', 1, user, () =>
    prepareSentoraVault(vault, { action: 'vault_deposit', user, amountBase: deposit }),
  );
  await report('BÓVEDA — retirar RLUSD (la única salida del lend-only)', 1, user, () =>
    prepareSentoraVault(vault, { action: 'vault_withdraw', user, amountBase: deposit }),
  );

  // ── El puente, las dos direcciones ────────────────────────────────────────
  await report('PUENTE ida — FXRP de Flare a Ethereum (se firma EN FLARE)', 14, user, () =>
    prepareFxrpBridge(makeBridgeReader(), { user, amountBase: fxrp }),
  );
  await report('PUENTE vuelta — FXRP de Ethereum a Flare (sin approve, comisión en ETH)', 1, user, () =>
    prepareFxrpBridgeBack(makeBridgeBackReader(), { user, amountBase: fxrp }),
  );

  console.log('  ' + '─'.repeat(72));
  if (anyRevert) {
    console.log('  ⚠ Alguna pata REVIERTE hoy. Léela arriba antes del ensayo: con esa wallet');
    console.log('    y esos importes, esa acción costaría gas para nada.');
    process.exit(7);
  }
  console.log('  Todo lo que se pudo componer, compone; y ninguna primera pata revierte hoy.');
  console.log('  Lo que sale bloqueado por pre-flight es el producto diciendo que NO, y está bien.');
  console.log('');
}

main().catch((e) => {
  console.error('\n  ✖ ensayo interrumpido:', (e as Error).message, '\n');
  process.exit(1);
});
