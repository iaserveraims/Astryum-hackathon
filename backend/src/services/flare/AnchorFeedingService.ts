/**
 * AnchorFeedingService — B3: el "feeding hop" del anchor.
 *
 * La fee de la orden del consejo (0,2 XRP) se acumula en el ANCHOR (rK4t…, infra
 * PROPIA de Astryum). Con la MISMA estructura que el refuel del executor, este
 * servicio dispara cuando el anchor junta ≥ X XRP libre:
 *
 *   anchor (XRP acumulado)
 *     → Payment de direct-mint DEL ANCHOR al core vault de FAssets  (su XRP → FXRP)
 *     → batch: transfer del FXRP acuñado → el EXECUTOR
 *     → el executor recoge el Payment por su memo (como cualquier mint 0xFE),
 *       acuña, corre el batch, y su REFUEL vuelve el FXRP a FLR.
 *
 * Así el ingreso de la orden (XRP en el anchor) acaba siendo FLR en el executor —
 * cerrando el bucle que el mint ya cierra directo. Reutiliza TODA la tubería:
 * `buildDirectMintHandoff` (el mint) + el executor (recogida + refuel).
 *
 * Frontera regulatoria (idéntica al executor): el anchor es infra propia de
 * Astryum, JAMÁS fondos del usuario. La clave del anchor (`LEGACY_ANCHOR_SEED`)
 * vive en env como `FLARE_EXECUTOR_PK`; sin ella → no-op (nunca revienta el tick).
 * El backend firma+manda el Payment del anchor con el patrón ya probado de
 * `XrplEscrowKeeper` (xrplWalletFromSecret → autofill → sign → submitAndWait).
 */
import { ethers } from 'ethers';
import { xrplProvider } from '../../integrations/providers/chain/XRPLProvider';
import { executorAlert } from './ExecutorFuelService';
import {
  buildDirectMintHandoff,
  readDirectMintParams,
  computeNetMint,
} from '../../connectors/protocols/flare/FlareDirectMintService';
import type { EncodedAction } from '../../connectors/protocols/IProtocolAdapter';

/** FXRP en Flare mainnet (6 decimales, == UBA). */
const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const FXRP_IFACE = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)']);

/** Umbral: el anchor dispara cuando su XRP LIBRE (por encima de la reserva) ≥ esto. */
export function anchorFeedMinXrp(): number {
  const n = Number(process.env.LEGACY_ANCHOR_FEED_MIN_XRP || 5);
  return Number.isFinite(n) && n > 0 ? n : 5;
}
/** Reserva a dejar SIEMPRE en el anchor (base reserve XRPL ~1 + buffer). */
export function anchorReserveXrp(): number {
  const n = Number(process.env.LEGACY_ANCHOR_RESERVE_XRP || 2);
  return Number.isFinite(n) && n >= 0 ? n : 2;
}

/**
 * Margen sobre la reserva del ledger para la fee de la propia tx del hop. La fee
 * real son ~12 drops; 0,01 XRP es holgadísimo y sigue siendo ruido frente a los
 * 0,3 XRP fijos que cobra el mint.
 */
const RESERVE_FEE_MARGIN_XRP = 0.01;

/**
 * La reserva que de verdad hay que dejar: la del env NUNCA puede quedar por
 * debajo de la del ledger más la fee de la tx.
 *
 * El fallo que esto cierra (visto en mainnet 8-ago-2026, `LEGACY_ANCHOR_RESERVE_XRP=1`
 * con la base reserve en 1 XRP exacto): el hop manda `saldo − reserva`, así que
 * al descontar además la fee el anchor queda POR DEBAJO de su reserva y XRPL
 * rechaza el Payment con `tecUNFUNDED_PAYMENT` — cada tick, para siempre, y el
 * panel entretanto pintaba «¿Dispara ahora? SÍ» sobre una tx imposible.
 *
 * La reserva del ledger se lee EN VIVO (base + objetos), no se hardcodea: si el
 * anchor llega a tener objetos propios, la reserva sube con ellos.
 */
export function effectiveReserveXrp(configuredXrp: number, ledgerReserveXrp: number): number {
  const floor = (Number.isFinite(ledgerReserveXrp) ? ledgerReserveXrp : 1) + RESERVE_FEE_MARGIN_XRP;
  return Math.max(configuredXrp, floor);
}

export interface AnchorFeedDecision {
  /** true = hay XRP libre suficiente para disparar el feed. */
  shouldFeed: boolean;
  /** XRP a convertir (todo lo libre por encima de la reserva), 0 si no dispara. */
  feedXrp: number;
  /** XRP libre por encima de la reserva (para el gauge, aunque no dispare). */
  freeXrp: number;
}

/**
 * Decisión PURA (unit-testeable, como el umbral del executor): dado el saldo del
 * anchor, la reserva y el mínimo, ¿convertir y cuánto? Nunca deja el anchor por
 * debajo de la reserva.
 */
export function computeAnchorFeed(
  anchorXrp: number,
  reserveXrp: number,
  minFeedXrp: number,
): AnchorFeedDecision {
  const free = Math.max(0, anchorXrp - reserveXrp);
  if (!(minFeedXrp > 0) || free < minFeedXrp) {
    return { shouldFeed: false, feedXrp: 0, freeXrp: free };
  }
  return { shouldFeed: true, feedXrp: free, freeXrp: free };
}

/**
 * El batch interno del mint del anchor: transferir TODO el FXRP acuñado
 * (`supplyUBA`) al executor, para que su refuel lo vuelva FLR. Puro y testeable.
 */
export function buildAnchorFeedBatch(executor: string, supplyUBA: bigint): EncodedAction[] {
  if (!ethers.isAddress(executor)) throw new Error('ANCHOR_FEED_BAD_EXECUTOR');
  if (supplyUBA <= 0n) throw new Error('ANCHOR_FEED_BAD_SUPPLY');
  return [
    {
      to: FXRP,
      calldata: FXRP_IFACE.encodeFunctionData('transfer', [executor, supplyUBA]),
      value: '0',
    },
  ];
}

/**
 * Deriva la wallet del anchor desde `LEGACY_ANCHOR_SEED`, en cualquiera de los
 * dos formatos que enseña Xaman: family seed (`s…`) o los "secret numbers" (8
 * grupos de 6 dígitos). Antes se rechazaban los secret numbers pidiendo una
 * conversión a mano — y aun convirtiéndola a mano la derivación salía mal, por
 * el default ed25519 de `Wallet.fromSeed`. Las dos trampas viven ya en
 * `utils/xrplSecret`; aquí solo se le pasa la cuenta que TIENE que salir.
 */
export async function anchorWalletFromSeed(raw: string, expected?: string): Promise<import('xrpl').Wallet> {
  const { xrplWalletFromSecret } = await import('../../utils/xrplSecret');
  return xrplWalletFromSecret(raw, expected ?? process.env.LEGACY_ORDER_ANCHOR);
}

/**
 * La clave del anchor no abre la cuenta del anchor. Da igual el motivo — dígitos
 * mal tecleados, formato ilegible, o una seed de OTRA cuenta: es CONFIG, y no se
 * cura reintentando. Se avisa como tal, con el arreglo escrito, en vez de dejar
 * el mensaje críptico del `catch` genérico repitiéndose en cada tick.
 */
async function anchorKeyAlert(anchor: string, why: string): Promise<void> {
  await executorAlert('critical', `LEGACY_ANCHOR_SEED ${why} — anchor-feed abortado (config, no se arregla solo)`, {
    key: 'anchor-feed:bad-key',
    facts: { anchor },
    runbook:
      `Reexporta los secret numbers del anchor ${anchor} desde Xaman y vuelve a pegarlos en ` +
      'LEGACY_ANCHOR_SEED (Railway). Qué cuenta abre la clave de ahora: /app/admin → Sistema → anchor, campo `seed`.',
  });
}

export interface AnchorFeedGauge extends AnchorFeedDecision {
  /** true = se firmó+mandó el Payment del mint del anchor este tick. */
  fed: boolean;
  txHash?: string;
}

/**
 * El gauge (misma forma que `checkExecutorFuel`): lee el saldo del anchor, decide,
 * y si dispara construye el mint del anchor (con el batch que transfiere el FXRP
 * al executor), lo FIRMA con la clave del anchor y lo MANDA. El executor lo recoge
 * por el memo y el refuel cierra el bucle. Best-effort: nunca lanza; no-op sin
 * `LEGACY_ANCHOR_SEED` / `FLARE_EXECUTOR_PK` / `LEGACY_ORDER_ANCHOR`.
 */
export async function checkAnchorFeeding(
  provider: ethers.JsonRpcProvider,
): Promise<AnchorFeedGauge | null> {
  const seed = process.env.LEGACY_ANCHOR_SEED;
  const pk = process.env.FLARE_EXECUTOR_PK;
  const anchor = process.env.LEGACY_ORDER_ANCHOR;
  if (!seed || !pk || !anchor) return null; // no-op sin clave/executor/anchor

  try {
    // Saldo Y reserva del ledger en la misma lectura: la reserva efectiva depende
    // de la de verdad (base + objetos), no solo de lo que diga el env.
    const bal = await xrplProvider.getSpendableBalance(anchor);
    const reserve = effectiveReserveXrp(anchorReserveXrp(), bal.reserveXrp);
    const decision = computeAnchorFeed(bal.balanceXrp, reserve, anchorFeedMinXrp());
    if (!decision.shouldFeed) return { ...decision, fed: false };

    // Construir el mint del anchor con el batch → executor.
    const { xrpToDrops, Client } = await import('xrpl');
    // Que la clave NO se lea y que lea OTRA cuenta son el mismo problema: config.
    // Se tratan igual — antes, un checksum roto se escapaba al catch de abajo y
    // salía como fallo pasajero, sin decir qué hacer.
    let wallet: import('xrpl').Wallet;
    try {
      wallet = await anchorWalletFromSeed(seed, anchor);
    } catch (e) {
      await anchorKeyAlert(anchor, `no se puede leer (${(e as Error).message})`);
      return { ...decision, fed: false };
    }
    if (wallet.classicAddress !== anchor) {
      await anchorKeyAlert(anchor, `abre ${wallet.classicAddress}, que no es el anchor`);
      return { ...decision, fed: false };
    }
    const executor = new ethers.Wallet(pk).address;
    const grossXrpDrops = BigInt(xrpToDrops(decision.feedXrp.toFixed(6)));
    const params = await readDirectMintParams(provider);
    const net = computeNetMint(grossXrpDrops, params);
    const innerCalls = buildAnchorFeedBatch(executor, net.supplyUBA);
    const handoff = await buildDirectMintHandoff(provider, {
      xrplAddress: anchor,
      grossXrpDrops,
      innerCalls,
      action: 'anchor-feed',
    });

    // Firmar + mandar el Payment del anchor (patrón XrplEscrowKeeper).
    const client = new Client(process.env.XRPL_WS_URL || 'wss://xrplcluster.com', {
      connectionTimeout: 10_000,
    });
    try {
      await client.connect();
      const prepared = await client.autofill(handoff.xrplPayment as never);
      const signed = wallet.sign(prepared);
      const res = await client.submitAndWait(signed.tx_blob);
      const result = (res.result.meta as { TransactionResult?: string })?.TransactionResult ?? '?';
      if (result === 'tesSUCCESS') {
        await executorAlert(
          'info',
          `anchor-feed: ${decision.feedXrp} XRP → mint FXRP → executor ${executor} (tx ${res.result.hash}). ` +
            'El executor lo recogerá por el memo; el refuel lo volverá FLR.',
        );
        return { ...decision, fed: true, txHash: res.result.hash };
      }
      await executorAlert('warn', `anchor-feed: el Payment del mint no asentó (${result}) — se reintenta el próximo tick`);
      return { ...decision, fed: false };
    } finally {
      await client.disconnect().catch(() => undefined);
    }
  } catch (e) {
    // Best-effort: un fallo del feed NO puede tumbar el tick del executor.
    await executorAlert('warn', `anchor-feed falló: ${(e as Error).message}`);
    return null;
  }
}
