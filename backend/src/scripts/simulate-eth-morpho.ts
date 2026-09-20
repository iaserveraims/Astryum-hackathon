/**
 * simulate-eth-morpho — la prueba que faltaba: ¿el carril EJECUTA?
 *
 * Los otros dos scripts responden a otras preguntas. `verify:eth-morpho` dice
 * que el venue es el que creemos. `dryrun:eth-morpho` dice QUÉ vas a firmar y
 * simula la PRIMERA pata de cada acción — la única que se puede simular
 * aislada, porque las siguientes dependen del estado que crea la anterior.
 *
 * Queda un hueco entre «compone bien» y «funciona», y ahí es donde vive el
 * dinero. Este script lo cierra con `eth_simulateV1`, que encadena llamadas
 * conservando el estado entre ellas: recorre el viaje REDONDO completo
 *
 *     approve → supplyCollateral → borrow → approve → repay → withdrawCollateral
 *
 * sobre el estado REAL de mainnet, y con NUESTRAS patas — las que construyen
 * los adapters de producción, no calldata escrita a mano para la ocasión. Eso
 * es lo que hace la prueba valer: si esto pasa, lo que pasa es el carril.
 *
 * Lo único fabricado es el saldo de FXRP y RLUSD de la wallet de prueba, con un
 * override de estado. Todo lo demás es real: el singleton de Morpho, el
 * oráculo, la curva de interés, la liquidez viva del mercado y el LLTV.
 *
 * Astryum no firma ni emite nada aquí: `eth_simulateV1` es de solo lectura.
 *
 * Uso:  npm run simulate:eth-morpho [-- --fxrp 100 --rlusd 20]
 * Sale con 0 si el viaje redondo entero pasa; con 7 si alguna pata revierte.
 */
import { ethers } from 'ethers';
import {
  buildSupplyCollateralLegs,
  buildBorrowLegs,
  buildRepayLegs,
  buildWithdrawCollateralLegs,
  FXRP_ETH,
  RLUSD_ETH,
  type EvmLeg,
} from '../connectors/protocols/adapters/MorphoBlueEthAdapter';
import {
  buildBridgeBackLegs,
  FXRP_ETH_OFT,
  FLARE_EID,
} from '../connectors/protocols/adapters/FxrpOftBridgeAdapter';

const USER = '0x1111111111111111111111111111111111111111';

const argv = process.argv.slice(2);
const flag = (n: string, d: string): string => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

function rpcUrl(): string {
  const u = process.env.ETHEREUM_RPC_URL;
  if (!u) {
    console.error('\n  ✖ ETHEREUM_RPC_URL no está puesta — sin RPC no hay nada que simular.\n');
    process.exit(1);
  }
  return u;
}

async function rpc(url: string, method: string, params: unknown[]): Promise<any> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = (await r.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

const balIface = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
const slotFor = (addr: string, slot: bigint): string =>
  ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [addr, slot]));

/**
 * Dónde vive el saldo de un token. Se PRUEBA, no se supone: se escribe un valor
 * en un slot candidato y se pregunta a `balanceOf` si lo ve. Se buscan los
 * slots planos y también los namespaced de ERC-7201 (OpenZeppelin v5), que es
 * lo que usan los tokens modernos — el FXRP OFT, sin ir más lejos, NO tiene el
 * balance en el slot 0 de toda la vida.
 */
async function findBalanceSlot(url: string, token: string): Promise<bigint | null> {
  const BIG = '0x' + (10n ** 24n).toString(16).padStart(64, '0');
  const ns = (n: string): bigint => {
    const h = BigInt(ethers.keccak256(ethers.toUtf8Bytes(n))) - 1n;
    return BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [h]))) & ~0xffn;
  };
  const candidates: bigint[] = [
    ...Array.from({ length: 41 }, (_, i) => BigInt(i)),
    ns('openzeppelin.storage.ERC20'),
    ns('erc7201:openzeppelin.storage.ERC20'),
  ];
  for (const s of candidates) {
    const out = await rpc(url, 'eth_call', [
      { to: token, data: balIface.encodeFunctionData('balanceOf', [USER]) },
      'latest',
      { [token]: { stateDiff: { [slotFor(USER, s)]: BIG } } },
    ]).catch(() => null);
    if (out && BigInt(out) > 0n) return s;
  }
  return null;
}

function human(raw: bigint, decimals: number): string {
  return Number(ethers.formatUnits(raw, decimals)).toLocaleString('es-ES', { maximumFractionDigits: 6 });
}

async function main(): Promise<void> {
  const url = rpcUrl();
  const fxrpAmt = BigInt(Math.round(Number(flag('fxrp', '100')) * 1e6));
  const rlusdAmt = ethers.parseUnits(flag('rlusd', '20'), 18);

  console.log('\n  El viaje REDONDO del carril, simulado sobre mainnet');
  console.log('  ' + '─'.repeat(66));
  console.log(`  Colateral ....... ${human(fxrpAmt, 6)} FXRP`);
  console.log(`  Préstamo ........ ${human(rlusdAmt, 18)} RLUSD`);
  console.log('  Patas construidas por los adapters de PRODUCCIÓN, no a mano.');
  console.log('  Solo se fabrica el saldo de la wallet; el resto es estado real.\n');

  const [fxrpSlot, rlusdSlot] = await Promise.all([
    findBalanceSlot(url, FXRP_ETH),
    findBalanceSlot(url, RLUSD_ETH),
  ]);
  if (fxrpSlot === null || rlusdSlot === null) {
    console.error('  ✖ No se pudo localizar el slot de balances — no se puede fabricar el saldo.\n');
    process.exit(1);
  }

  // El viaje entero, con NUESTRAS patas. El repay va en modo parcial: el modo
  // `full` necesita las borrowShares vivas, que aquí no existen todavía.
  const legs: Array<{ label: string; leg: EvmLeg }> = [];
  const push = (label: string, ls: EvmLeg[]) =>
    ls.forEach((l, i) => legs.push({ label: `${label}${ls.length > 1 ? ` (${i + 1}/${ls.length})` : ''}`, leg: l }));

  /**
   * LA TRAMPA DEL POLVO, y por qué aquí se saca el 99% y no el 100%.
   *
   * Repagar EXACTAMENTE lo que pediste no te deja a cero: el interés corre por
   * bloque, así que entre el borrow y el repay ya se ha devengado algo. Queda
   * un polvo de deuda — y con deuda viva, sacar el 100% del colateral revierte
   * con `insufficient collateral`, porque dejaría esa deuda sin respaldo.
   *
   * No es un fallo del carril: es el carril diciendo la verdad, y lo confirmó
   * esta misma simulación la primera vez que se corrió. Para eso existe el modo
   * `repay full`, que repaga contra las SHARES vivas y sí deja el cero exacto;
   * aquí no se puede usar porque necesita leer las borrowShares a mitad de la
   * secuencia, y `eth_simulateV1` no realimenta lecturas entre llamadas.
   *
   * Así que se saca el 99%, que es lo que hace cualquiera en la vida real, y la
   * lección queda escrita: **si vas a vaciar la posición, repaga con «cerrar
   * toda la deuda», no con el importe que pediste.**
   */
  const withdrawAmt = (fxrpAmt * 99n) / 100n;

  push('ENTRA · aportar colateral', buildSupplyCollateralLegs(USER, fxrpAmt));
  push('ENTRA · pedir prestado', buildBorrowLegs(USER, rlusdAmt));
  push('SALE · repagar', buildRepayLegs(USER, { mode: 'partial', assets: rlusdAmt }));
  push('SALE · sacar el colateral (99%, ver la nota del polvo)', buildWithdrawCollateralLegs(USER, withdrawAmt));

  /**
   * LA VUELTA A CASA. El colateral ya está de nuevo en la wallet del usuario,
   * pero en Ethereum — el recorrido no termina hasta que el FXRP vuelve a
   * Flare, que es donde vive. Se cotiza la comisión de entrega EN VIVO contra
   * el propio OFT: es la cifra que el usuario va a pagar, no una estimación.
   */
  const oft = new ethers.Contract(
    FXRP_ETH_OFT,
    ['function quoteSend((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),bool) view returns ((uint256,uint256))'],
    new ethers.JsonRpcProvider(url),
  );
  const to32 = '0x' + USER.toLowerCase().slice(2).padStart(64, '0');
  let bridgeFee = 0n;
  try {
    const q = await oft.quoteSend([FLARE_EID, to32, withdrawAmt, withdrawAmt, '0x', '0x', '0x'], false);
    bridgeFee = BigInt(q[0]);
    push('VUELVE · puentear el FXRP a Flare', buildBridgeBackLegs(USER, withdrawAmt, bridgeFee));
    console.log(`  Comisión de entrega LayerZero (cotizada en vivo): ${ethers.formatEther(bridgeFee)} ETH\n`);
  } catch (e) {
    console.log(`  ⚠ la vuelta no se pudo cotizar: ${(e as Error).message.slice(0, 70)}\n`);
  }

  const BIG = '0x' + (10n ** 24n).toString(16).padStart(64, '0');
  const result = await rpc(url, 'eth_simulateV1', [
    {
      blockStateCalls: [
        {
          stateOverrides: {
            [FXRP_ETH]: { stateDiff: { [slotFor(USER, fxrpSlot)]: BIG } },
            [RLUSD_ETH]: { stateDiff: { [slotFor(USER, rlusdSlot)]: BIG } },
            // ETH de sobra: tiene que cubrir el gas Y la comision de entrega del puente.
            [USER]: { balance: '0x' + (10n ** 19n).toString(16) },
          },
          calls: legs.map(({ leg }) => ({
            from: USER,
            to: leg.to,
            data: leg.data,
            ...(leg.value && leg.value !== '0x0' ? { value: leg.value } : {}),
          })),
        },
      ],
      validation: false,
      traceTransfers: true,
    },
    'latest',
  ]);

  const calls = (result?.[0]?.calls ?? []) as Array<{
    status: string; error?: { message?: string }; returnData?: string;
    logs?: Array<{ address: string; topics: string[]; data: string }>;
  }>;
  const TRANSFER = ethers.id('Transfer(address,address,uint256)');
  let allOk = true;

  for (const [i, c] of calls.entries()) {
    const ok = c.status === '0x1';
    if (!ok) allOk = false;
    const { label, leg } = legs[i];
    console.log(`  ${ok ? '✓' : '✖'} ${label}`);
    console.log(`      ${leg.description}`);
    if (!ok) {
      console.log(`      → REVIERTE: ${c.error?.message ?? c.returnData ?? 'sin razón'}`);
      continue;
    }
    for (const l of c.logs ?? []) {
      if (l.topics?.[0] !== TRANSFER) continue;
      const t = l.address.toLowerCase();
      const isFxrp = t === FXRP_ETH.toLowerCase();
      const isRlusd = t === RLUSD_ETH.toLowerCase();
      if (!isFxrp && !isRlusd) continue;
      console.log(`      ↳ mueve ${human(BigInt(l.data), isFxrp ? 6 : 18)} ${isFxrp ? 'FXRP' : 'RLUSD'}`);
    }
  }

  console.log('  ' + '─'.repeat(66));
  if (!allOk) {
    console.log('  ✖ Alguna pata REVIERTE. El carril no ejecuta con estos importes.\n');
    process.exit(7);
  }
  console.log('  ✓ EL CARRIL EJECUTA. Entra y sale, sobre el estado real de mainnet,');
  console.log('    con las patas que construye producción. Nada firmado, nada emitido.');
  console.log('');
  console.log('  Nota del polvo: el colateral se saca al 99% a propósito. Repagar el');
  console.log('    importe exacto que pediste NO te deja a cero —el interés corre por');
  console.log('    bloque— y con ese polvo de deuda vivo, sacar el 100% revierte con');
  console.log('    «insufficient collateral». Para vaciar del todo hay que repagar con');
  console.log('    «cerrar toda la deuda», que va contra las shares vivas.\n');
}

main().catch((e) => {
  console.error('\n  ✖ simulación interrumpida:', (e as Error).message, '\n');
  process.exit(1);
});
