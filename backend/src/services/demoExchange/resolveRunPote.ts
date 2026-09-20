/**
 * resolveRunPote — the run's pote, resolved GENERATION-first.
 *
 * A council belongs to exactly ONE registry (lesson of the multi-registry
 * resolver hazard, 28-ago: a council with both a v1 pote and a v2 cage silently
 * resolved to the v1 stack). Here the order is explicit and v2-first: if the
 * cage factory knows the council, that IS its generation — its bridge is the
 * cage's bridge (same verification ABI: `consumedTxId`/`nextNonce` are
 * inherited), and its pote is the cage's most recent pote. Only when no cage
 * exists do we consult the v1 pote factory.
 *
 * Never throws: an unreadable factory means "cannot prove a pote right now",
 * and the caller keeps whatever it had — "could not read" is never "you have
 * nothing".
 */

import { ethers } from 'ethers';

const CAGE_MINI_ABI = [
  'function poteCount() view returns (uint256)',
  'function potes(uint256) view returns (address)',
];

export interface ResolvedRunPote {
  generation: 'v1' | 'v2';
  /** null = the cage is born but has not opened a pote yet (v2 only). */
  pote: string | null;
  bridge: string;
  /** The governing cage (v2 only). */
  cage: string | null;
}

export async function resolveRunPote(
  provider: ethers.Provider,
  councilR: string,
): Promise<ResolvedRunPote | null> {
  const cageFactory = process.env.ASTRYUM_CAGE_FACTORY_ADDRESS;
  if (cageFactory) {
    try {
      const { resolveAstryumCage } = await import('../flare/AstryumCageCreationService');
      const c = await resolveAstryumCage(provider, cageFactory, councilR);
      if (c) {
        const cage = new ethers.Contract(c.cage, CAGE_MINI_ABI, provider);
        const n = Number((await cage.poteCount()) as bigint);
        const pote = n > 0 ? ethers.getAddress((await cage.potes(n - 1)) as string) : null;
        return { generation: 'v2', pote, bridge: c.bridge, cage: c.cage };
      }
    } catch {
      /* v2 unreadable does not decide the generation — fall through to v1 */
    }
  }
  const factory = process.env.ASTRYUM_FACTORY_ADDRESS;
  if (!factory) return null;
  try {
    const { resolveAstryumPote } = await import('../flare/AstryumPoteCreationService');
    const r = await resolveAstryumPote(provider, factory, councilR);
    if (r?.vault && r.vault !== ethers.ZeroAddress) {
      return { generation: 'v1', pote: r.vault, bridge: r.bridge, cage: null };
    }
  } catch {
    /* no readable registry — the caller keeps what it had */
  }
  return null;
}
