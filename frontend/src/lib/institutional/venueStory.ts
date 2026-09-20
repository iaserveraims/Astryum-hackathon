/**
 * venueStory — qué HACE cada destino con el FXRP de la bóveda, en una frase
 * (fundador 11-sep: «me gustaría que se supiera qué te da dejar los tokens en
 * ese vault en concreto»). Un vault gestionado NO es un préstamo ni pone nada
 * en colateral: el gestor solo puede llevar el FXRP común a estos destinos, y
 * lo que produzcan queda en la bóveda a prorrata de las participaciones.
 *
 * Lo que se dice es el MECANISMO del destino (préstamo a terceros
 * sobrecolateralizados, vault de staking…), nunca una cifra: el tipo lo fija
 * el destino a cada momento y Astryum no promete rendimiento (invariante #9).
 */

import { venueIdentity } from './venueIdentity';

export interface VenueStory {
  /** Nombre visible: protocolo · producto, o la dirección abreviada. */
  label: string;
  known: boolean;
  /** Qué hace con el FXRP, en una frase. */
  does: string;
}

/** kind: 0 = lending market (Compound v2) · 1 = ERC-4626 salida inmediata · 2 = ERC-4626 con cola. */
export function venueStory(address: string, kind: number, t: (s: string) => string): VenueStory {
  const id = venueIdentity(address);
  const short = address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
  const label = id.known ? `${id.name}${id.product ? ` · ${id.product}` : ''}` : short;
  if (id.known && id.name === 'Kinetic') {
    return { label, known: true, does: t('Lends the vault’s FXRP to over-collateralised borrowers on Kinetic. The vault earns the supply interest that market sets at each moment.') };
  }
  if (id.known && id.name === 'Firelight') {
    return { label, known: true, does: t('Deposits the vault’s FXRP in Firelight’s stXRP vault. The vault earns whatever that vault distributes to its depositors.') };
  }
  const generic =
    kind === 0
      ? t('A lending market: the FXRP is lent to borrowers and the vault earns the supply rate that market sets.')
      : kind === 1
        ? t('A vault with immediate exit: the FXRP is deposited there and the vault earns what it distributes.')
        : t('A vault that exits through a queue: the FXRP is deposited there and the vault earns what it distributes; getting it back takes that queue.');
  return { label, known: id.known, does: generic };
}

/** Un tono estable por destino: los conocidos con su color; el resto, de su dirección. */
export function venueHue(address: string): number {
  const id = venueIdentity(address);
  if (id.known && id.name === 'Kinetic') return 205;
  if (id.known && id.name === 'Firelight') return 22;
  let h = 0;
  const key = address.toLowerCase();
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 360;
}
