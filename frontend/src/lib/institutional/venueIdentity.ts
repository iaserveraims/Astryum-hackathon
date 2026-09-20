/**
 * venueIdentity — de la dirección cruda de un venue a su identidad de Earn.
 *
 * El registro on-chain solo da (dirección, kind). Para pintar un venue como en
 * Earn (nombre del protocolo · empresa, con el logo del activo) hace falta
 * mapear la dirección al protocolo conocido. Este mapa es la ÚNICA fuente:
 * direcciones verificadas on-chain (underlying/asset == FXRP), en minúsculas.
 *
 * Un venue que NO esté aquí se pinta con su dirección abreviada y su tipo —
 * honesto, nunca un nombre inventado.
 */

import { PROTOCOLS, type ProtocolId } from '../earn/protocols';

interface VenueMeta {
  protocol: ProtocolId;
  /** El nombre del producto/receipt (isoFXRP, stXRP…), lo que el gestor reconoce. */
  product: string;
  /** El activo, para el TokenLogo. */
  asset: string;
}

/** Direcciones verificadas on-chain (6-sep). Claves en minúsculas. */
const VENUES: Record<string, VenueMeta> = {
  '0xd1b7a5efa9bd88f291f7a4563a8f6185c0249cb3': { protocol: 'kinetic', product: 'isoFXRP', asset: 'FXRP' },
  '0x4c18ff3c89632c3dd62e796c0afa5c07c4c1b2b3': { protocol: 'firelight', product: 'stXRP', asset: 'FXRP' },
};

export interface VenueIdentity {
  known: boolean;
  /** Nombre del protocolo (Kinetic, Firelight) o null si no está mapeado. */
  name: string | null;
  company: string | null;
  product: string | null;
  asset: string | null;
  /** La web oficial del protocolo (del catálogo de Earn), para «compruébalo allí». */
  website: string | null;
}

export function venueIdentity(address: string): VenueIdentity {
  const meta = VENUES[address.toLowerCase()];
  if (!meta) return { known: false, name: null, company: null, product: null, asset: null, website: null };
  const p = PROTOCOLS[meta.protocol];
  return {
    known: true,
    name: p?.name ?? null,
    company: p?.company ?? null,
    product: meta.product,
    asset: meta.asset,
    website: p?.website ?? null,
  };
}
