/**
 * AstryumRegistryReadService — la whitelist de Astryum, leída de la cadena.
 *
 * El `AstryumRegistry` es el scanner: la lista de destinos sin liquidación que
 * un pote puede tocar. El propio pote la consulta en `_addVenue`; aquí solo se
 * ENSEÑA, para que un gestor elija dentro de ella desde su pote (decisión)
 * y para que un depositante vea contra qué se mide la jaula.
 *
 * Lectura pública de estado público. Ningún juicio de Astryum sobre venues aquí:
 * lo que está, está porque pasó el scanner y el timelock; lo que se retiró, se
 * enseña como retirado (bloquea capital NUEVO; las posiciones no se tocan).
 */

import { ethers } from 'ethers';

export const REGISTRY_READ_ABI = [
  'function venueCount() view returns (uint256)',
  'function venueAt(uint256 i) view returns (uint32 chainId, address target, (uint8 kind, uint64 activeAt, bool active) entry)',
  'function TIMELOCK() view returns (uint64)',
  'function governor() view returns (address)',
];

export type RegistryVenueKind = 'erc4626' | 'compoundv2' | 'erc4626queued' | 'unknown';
export type RegistryVenueStatus = 'active' | 'pending' | 'removed';

export interface RegistryVenue {
  chainId: number;
  target: string;
  kind: RegistryVenueKind;
  kindCode: number;
  status: RegistryVenueStatus;
  /** Cuándo entra/entró en vigor (unix s); 0 si fue retirada. */
  activeAt: number;
}

export function decodeRegistryKind(kind: number): RegistryVenueKind {
  if (kind === 0) return 'erc4626';
  if (kind === 1) return 'compoundv2';
  if (kind === 2) return 'erc4626queued';
  return 'unknown';
}

/** Pura: de la fila del contrato a lo que el catálogo enseña. */
export function decodeRegistryRow(row: {
  chainId: bigint | number;
  target: string;
  entry: { kind: bigint | number; activeAt: bigint | number; active: boolean };
}): RegistryVenue {
  const activeAt = Number(row.entry.activeAt);
  const kindCode = Number(row.entry.kind);
  const status: RegistryVenueStatus = row.entry.active ? 'active' : activeAt === 0 ? 'removed' : 'pending';
  return {
    chainId: Number(row.chainId),
    target: ethers.getAddress(row.target),
    kind: decodeRegistryKind(kindCode),
    kindCode,
    status,
    activeAt,
  };
}

/** Toda la whitelist, en orden de alta. Lanza si no se pudo leer: «no pude leer» ≠ «vacía». */
export async function readRegistryVenues(
  provider: ethers.Provider,
  registry: string,
): Promise<{ registry: string; timelockSeconds: number; governor: string; venues: RegistryVenue[] }> {
  const c = new ethers.Contract(registry, REGISTRY_READ_ABI, provider);
  const [count, timelock, governor] = await Promise.all([
    c.venueCount() as Promise<bigint>,
    c.TIMELOCK() as Promise<bigint>,
    c.governor() as Promise<string>,
  ]);
  const venues: RegistryVenue[] = [];
  // En serie: pocas entradas, RPC compartido.
  for (let i = 0; i < Number(count); i++) {
    const row = (await c.venueAt(i)) as { chainId: bigint; target: string; entry: { kind: bigint; activeAt: bigint; active: boolean } };
    venues.push(decodeRegistryRow(row));
  }
  return { registry: ethers.getAddress(registry), timelockSeconds: Number(timelock), governor: ethers.getAddress(governor), venues };
}
