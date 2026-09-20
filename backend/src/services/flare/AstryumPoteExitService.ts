/**
 * AstryumPoteExitService — la vuelta a casa en UNA firma.
 *
 * Hasta ahora la salida del pote existía en dos mitades que nunca se juntaron:
 * `/pote-redeem/prepare` devuelve una call EVM plana (sirve si las
 * participaciones están en una wallet EVM que firma sola), y
 * `/pote-exit-xrp/prepare` desmintea FXRP→XRP (pero exige que el FXRP ya esté
 * en la cuenta). Un usuario cuyo dueño de participaciones es su **Personal
 * Account** no podía usar ninguna de las dos: su PA no firma, la mueve el raíl
 * 0xFE con una firma XRPL suya.
 *
 * Resultado: se podía entrar por XRPL y no salir por donde se entró. Este
 * módulo cierra esa asimetría — mismo patrón que `LegacyVaultYieldService`
 * (una firma XRPL → batch en la PA), con las dos calls encadenadas:
 *
 *   1. la salida del pote (redeem síncrono, o claimRedeem si hubo cooldown)
 *   2. el unmint FXRP → XRP nativo a la r-address del usuario
 *
 * ── EL PROBLEMA DEL IMPORTE, y por qué se dimensiona a la baja ──────────────
 *
 * `redeem` entrega los assets que valgan las participaciones EN EJECUCIÓN, no
 * los que valían al preparar. El unmint, en cambio, pide una cifra fija. Si esa
 * cifra fuera mayor que lo que el redeem entrega, el unmint revierte y se cae
 * el batch entero (el usuario no pierde capital, pero sí la firma y el peaje).
 *
 * La misma lección que dejó escrita el raíl del Legacy: *«dimensionar el redeem
 * a una cifra obsoleta y MAYOR es la dirección peligrosa»*. Así que el unmint se
 * dimensiona SIEMPRE por debajo de lo previsto, y el sobrante se queda como FXRP
 * en la propia Personal Account del usuario — visible, suyo, y redimible después.
 * Nunca se pierde.
 *
 * Prepare-only: aquí se codifican bytes y se leen números. Ni firma, ni envía,
 * ni tiene llave (invariantes #1/#8).
 */

import { ethers } from 'ethers';
import type { EncodedAction } from '../../connectors/protocols/IProtocolAdapter';

export class PoteExitError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PoteExitError';
  }
}

/**
 * Margen por defecto con el que el unmint se queda por debajo de lo previsto:
 * 25 bps (0,25%). Cubre el movimiento normal del precio de la participación
 * entre el prepare y la ejecución del 0xFE (~1-2 min de ventana FDC).
 *
 * No es una comisión: lo que no se desmintea sigue siendo del usuario, en FXRP,
 * en su propia cuenta.
 */
export const DEFAULT_EXIT_MARGIN_BPS = 25;

/** Tope de cordura: más de un 5% de margen sería quedarse corto por sistema. */
export const MAX_EXIT_MARGIN_BPS = 500;

export interface UnmintSizing {
  /** Lo que se pedirá desmintear, en unidades base del activo (UBA). */
  unmintUBA: bigint;
  /** Lo que se prevé recibir del pote ahora mismo. */
  previewedUBA: bigint;
  /** Lo que se deja de margen y quedará en FXRP en la PA si no hace falta. */
  marginUBA: bigint;
  marginBps: number;
}

/**
 * Dimensiona el unmint a la baja: `previewedUBA − margen`, y comprueba que lo
 * que queda sigue por encima del mínimo que FAssets acepta redimir.
 *
 * Lógica pura a propósito (vive aquí, no dentro de la ruta): esta es la decisión
 * que evita un batch condenado, y tiene que poder probarse sin red ni cadena.
 */
export function sizeUnmintConservatively(input: {
  previewedUBA: bigint;
  minimumUBA: bigint;
  marginBps?: number;
}): UnmintSizing {
  const { previewedUBA, minimumUBA } = input;
  const marginBps = input.marginBps ?? DEFAULT_EXIT_MARGIN_BPS;

  if (previewedUBA <= 0n) {
    throw new PoteExitError('BAD_AMOUNT', 'Lo previsto a recibir del pote debe ser > 0.');
  }
  if (!Number.isInteger(marginBps) || marginBps < 0 || marginBps > MAX_EXIT_MARGIN_BPS) {
    throw new PoteExitError(
      'BAD_MARGIN',
      `El margen debe ser un entero entre 0 y ${MAX_EXIT_MARGIN_BPS} bps.`,
    );
  }

  const marginUBA = (previewedUBA * BigInt(marginBps)) / 10_000n;
  const unmintUBA = previewedUBA - marginUBA;

  if (minimumUBA > 0n && unmintUBA < minimumUBA) {
    throw new PoteExitError(
      'BELOW_FASSETS_MINIMUM',
      `Tras el margen quedarían ${unmintUBA} y FAssets no redime por debajo de ${minimumUBA}. ` +
        'Sal con más importe, o redime a FXRP y desmintea después.',
    );
  }

  return { unmintUBA, previewedUBA, marginUBA, marginBps };
}

/**
 * El batch que ejecutará la Personal Account tras UNA firma XRPL del usuario.
 *
 * `poteExitCall` y `unmintCall` se pasan construidas desde fuera, no se rehacen
 * aquí: la primera la compone la ruta según la forma del pote (redeem síncrono
 * vs claimRedeem), y la segunda es de `buildRedeemToXrplCall`, para que el
 * executor, el destino y el mínimo de FAssets sigan siendo de ese raíl y de
 * nadie más. Mismo criterio que `buildYieldClaimBatch`.
 */
export function buildPoteExitBatch(input: {
  pote: string;
  poteExitCall: EncodedAction;
  unmintCall: EncodedAction;
}): EncodedAction[] {
  const { pote, poteExitCall, unmintCall } = input;

  if (!ethers.isAddress(pote)) {
    throw new PoteExitError('BAD_POTE', 'pote no es una dirección válida.');
  }
  if (!poteExitCall?.to || !poteExitCall?.calldata) {
    throw new PoteExitError('BAD_EXIT_CALL', 'Falta la call de salida del pote.');
  }
  if (!unmintCall?.to || !unmintCall?.calldata) {
    throw new PoteExitError('BAD_UNMINT_CALL', 'Falta la call de unmint.');
  }

  // La salida tiene que ir AL POTE. Si apuntara a otro sitio, este batch estaría
  // moviendo algo que no es lo que dice mover.
  if (poteExitCall.to.toLowerCase() !== pote.toLowerCase()) {
    throw new PoteExitError(
      'EXIT_CALL_NOT_TO_POTE',
      'La call de salida debe ir al pote, no a otra dirección.',
    );
  }

  // Y el unmint JAMÁS al pote: va al AssetManager de FAssets. Si alguien
  // encadenara aquí una segunda llamada al pote, dejaría de ser una salida.
  if (unmintCall.to.toLowerCase() === pote.toLowerCase()) {
    throw new PoteExitError(
      'UNMINT_CALL_TO_POTE',
      'El unmint debe ir al AssetManager, nunca de vuelta al pote.',
    );
  }

  return [
    { to: ethers.getAddress(poteExitCall.to), calldata: poteExitCall.calldata, value: '0' },
    { to: ethers.getAddress(unmintCall.to), calldata: unmintCall.calldata, value: '0' },
  ];
}

const POTE_EXIT_ABI = [
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
  'function requestRedeem(uint256 shares, address receiver) returns (uint256)',
  'function claimRedeem(uint256 ticketId, (uint256 venueId, uint256 period)[] venueClaims)',
  'function previewRedeem(uint256 shares) view returns (uint256)',
];

/**
 * La salida CON cooldown, primer paso: `requestRedeem(shares, PA)`.
 *
 * Quema las participaciones AHORA y abre un ticket a nombre de la PA (el
 * receiver del FXRP al cobrar). `requestRedeem` es owner-only sin allowance
 * (invariante #18): la firma sale de la propia PA por 0xFE, nadie más la mueve.
 * No hay unmint en este paso — el FXRP no existe hasta cobrar el ticket.
 */
export function buildPoteRequestRedeemCall(input: {
  pote: string;
  sharesBase: bigint;
  personalAccount: string;
}): EncodedAction {
  const { pote, sharesBase, personalAccount } = input;
  if (!ethers.isAddress(pote)) throw new PoteExitError('BAD_POTE', 'pote no es una dirección válida.');
  if (!ethers.isAddress(personalAccount)) {
    throw new PoteExitError('BAD_PA', 'La Personal Account no es una dirección válida.');
  }
  if (sharesBase <= 0n) throw new PoteExitError('BAD_SHARES', 'sharesBase debe ser > 0.');

  const pa = ethers.getAddress(personalAccount);
  const iface = new ethers.Interface(POTE_EXIT_ABI);
  return {
    to: ethers.getAddress(pote),
    value: '0',
    calldata: iface.encodeFunctionData('requestRedeem', [sharesBase, pa]),
  };
}

/**
 * La salida síncrona: `redeem(shares, PA, PA)`.
 *
 * Receiver y owner son la MISMA Personal Account a propósito. El owner es quien
 * tiene las participaciones y `requestRedeem`/`redeem` son owner-only sin
 * allowance (invariante #18): nadie más puede sacarlas. Y el receiver es ella
 * misma porque el FXRP tiene que aterrizar donde la siguiente call lo va a
 * gastar — si fuera a otra dirección, el unmint no encontraría nada.
 */
export function buildPoteRedeemCall(input: {
  pote: string;
  sharesBase: bigint;
  personalAccount: string;
}): EncodedAction {
  const { pote, sharesBase, personalAccount } = input;
  if (!ethers.isAddress(pote)) throw new PoteExitError('BAD_POTE', 'pote no es una dirección válida.');
  if (!ethers.isAddress(personalAccount)) {
    throw new PoteExitError('BAD_PA', 'La Personal Account no es una dirección válida.');
  }
  if (sharesBase <= 0n) throw new PoteExitError('BAD_SHARES', 'sharesBase debe ser > 0.');

  const pa = ethers.getAddress(personalAccount);
  const iface = new ethers.Interface(POTE_EXIT_ABI);
  return {
    to: ethers.getAddress(pote),
    value: '0',
    calldata: iface.encodeFunctionData('redeem', [sharesBase, pa, pa]),
  };
}

/** La salida con cooldown ya cumplido: `claimRedeem(ticketId, venueClaims)`. */
export function buildPoteClaimRedeemCall(input: {
  pote: string;
  ticketId: bigint;
  venueClaims: Array<{ venueId: bigint; period: bigint }>;
}): EncodedAction {
  const { pote, ticketId, venueClaims } = input;
  if (!ethers.isAddress(pote)) throw new PoteExitError('BAD_POTE', 'pote no es una dirección válida.');
  if (ticketId < 0n) throw new PoteExitError('BAD_TICKET', 'ticketId debe ser >= 0.');

  const iface = new ethers.Interface(POTE_EXIT_ABI);
  return {
    to: ethers.getAddress(pote),
    value: '0',
    calldata: iface.encodeFunctionData('claimRedeem', [
      ticketId,
      venueClaims.map((c) => [c.venueId, c.period]),
    ]),
  };
}

/** Lo que el pote entregaría AHORA por esas participaciones (UBA). */
export async function previewPoteRedeem(
  provider: ethers.Provider,
  pote: string,
  sharesBase: bigint,
): Promise<bigint> {
  const c = new ethers.Contract(pote, POTE_EXIT_ABI, provider);
  return BigInt(await c.previewRedeem(sharesBase));
}
