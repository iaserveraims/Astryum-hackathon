/**
 * dryrun-em-protection — ¿qué haría tu protección de Ethereum AHORA MISMO?
 *
 * El equivalente en MoneyFlows (W5) del ensayo en seco del carril: en vez de
 * crear una regla, esperar 60 s y ver si llega un aviso, pregunta directamente
 * las tres cosas de las que depende que la red exista de verdad:
 *
 *   1. ¿Está ABIERTO el carril? — flag (#10) + geofence (#5). Una regla puede
 *      estar impecable y no vigilar nada si el módulo está cerrado; desde el
 *      17-ago el tick respeta esa frontera, así que hay que poder verla.
 *   2. ¿Qué dice el MERCADO de tu posición? — el HF que decide el disparo se lee
 *      del mercado vivo, no del snapshot de cartera (que no sabe leer Morpho y
 *      llegaba vacío, dejando la protección muerta en silencio: el bug H6).
 *   3. Con tu umbral, ¿dispararía HOY? — y si dispara, QUÉ aviso sale y a qué
 *      puerta lleva. Un aviso que no abre nada es un aviso que miente.
 *
 * Solo lecturas: no crea reglas, no manda avisos, no firma nada.
 *
 * Uso:
 *   npm run dryrun:em-protection -- --user 0xTuWallet --threshold 1.1
 */
import { emRepayFireCheck, makeEthersMorphoReader } from '../services/EthMorphoMarketService';
import { getRpcForChain } from '../utils/rpcForChain';
import { jurisdictionService } from '../services/JurisdictionService';
import { emRepayPushUrl } from '../engines/automation/emRepayNudge';

const argv = process.argv.slice(2);
function flag(name: string, dflt?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}

function fmt18(raw: bigint): string {
  const whole = raw / 10n ** 18n;
  const frac = (raw % 10n ** 18n).toString().padStart(18, '0').slice(0, 2);
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

async function main() {
  const user = flag('user');
  const threshold = Number(flag('threshold', '1.1'));
  if (!user || !/^0x[0-9a-fA-F]{40}$/.test(user)) {
    console.error('\n  Uso: npm run dryrun:em-protection -- --user 0xTuWallet [--threshold 1.1]\n');
    process.exit(1);
  }

  console.log('\n  ¿Qué haría tu protección de Ethereum AHORA MISMO?');
  console.log('  ' + '─'.repeat(70));
  console.log(`  Wallet .................. ${user}`);
  console.log(`  Umbral de la regla ...... HF < ${threshold}`);

  // 1 — La frontera. Lo primero, porque si está cerrada nada de lo demás importa.
  console.log('  ' + '─'.repeat(70));
  const flagOn = process.env.ETH_RLUSD_FXRP_ENABLED === 'true';
  const geo = jurisdictionService.isDefiExecutionAllowed(null);
  console.log(`  Flag ETH_RLUSD_FXRP_ENABLED ... ${flagOn ? '✓ encendida' : '✖ APAGADA'}`);
  console.log(
    `  Geofence (el tick no tiene región, pregunta con null) ... ${
      geo.allowed ? '✓ permite' : `✖ BLOQUEA (${geo.reason})`
    }`,
  );
  if (!flagOn || !geo.allowed) {
    console.log('');
    console.log('  ⛔ EL CARRIL ESTÁ CERRADO: el tick NO vigila ninguna regla emRepay.');
    console.log('     La regla puede estar perfecta y aun así no haber red debajo. Es');
    console.log('     deliberado (invariantes #10 y #5) y el tick lo dice por consola en');
    console.log('     cada vuelta — pero conviene verlo aquí antes de confiar en ella.');
    console.log('');
    process.exit(3);
  }

  // 2 — Lo que dice el mercado.
  console.log('  ' + '─'.repeat(70));
  let check;
  try {
    check = await emRepayFireCheck(makeEthersMorphoReader(getRpcForChain(1)), user);
  } catch (e) {
    console.log(`  ✖ no se pudo leer el mercado: ${(e as Error).message}`);
    console.log('    Con esta lectura caída, la regla NO dispara este tick — a propósito:');
    console.log('    disparar sin dato sería inventarse el riesgo.');
    process.exit(1);
  }

  if (!check.ok) {
    console.log(`  Posición viva ........... ninguna — ${check.note}`);
    console.log('');
    console.log('  La regla NO avisaría, y está bien: un aviso para repagar una deuda que');
    console.log('  ya no existe es una pantalla que miente. El tick sella el cooldown y calla.');
    console.log('');
    return;
  }

  const hf = check.healthFactor ?? 0;
  console.log(`  Deuda viva .............. ${fmt18(BigInt(check.debtBase ?? '0'))} RLUSD`);
  console.log(`  Health factor (MERCADO) . ${hf.toFixed(4)}`);
  console.log(`  Distancia al umbral ..... ${(hf - threshold).toFixed(4)}`);
  console.log(
    `  Caída de precio que te lleva a HF=1 ... ${(Math.max(0, 1 - 1 / hf) * 100).toFixed(1)}%`,
  );

  // 3 — El veredicto y el aviso exacto.
  console.log('  ' + '─'.repeat(70));
  const wouldFire = hf < threshold;
  if (!wouldFire) {
    console.log(`  Veredicto: NO dispararía (HF ${hf.toFixed(4)} ≥ umbral ${threshold}).`);
    console.log('  Para verla disparar en el ensayo, crea la regla con un umbral POR ENCIMA');
    console.log(`  de tu HF actual — con ${(hf + 0.05).toFixed(2)} salta en el siguiente tick (60 s).`);
    console.log('');
    return;
  }

  console.log(`  Veredicto: DISPARARÍA (HF ${hf.toFixed(4)} < umbral ${threshold}).`);
  console.log('  El aviso que saldría:');
  console.log('    título: MoneyFlow: <nombre de tu regla> — repay ready to prepare');
  console.log(`    puerta: ${emRepayPushUrl(user)}`);
  console.log('    munición: hace falta RLUSD alcanzable EN ETHEREUM para repagar.');
  console.log('');
  console.log('  Astryum no repaga: compone las patas y tú firmas. El aviso abre la puerta');
  console.log('  de repago de ESTA posición, y las patas se componen frescas al abrirla');
  console.log('  (la deuda crece con el interés: calldata de hace 5 minutos llega rancia).');
  console.log('');
}

main().catch((e) => {
  console.error('\n  ✖ ensayo interrumpido:', (e as Error).message, '\n');
  process.exit(1);
});
