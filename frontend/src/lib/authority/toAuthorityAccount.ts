/**
 * toAuthorityAccount — the ONE mapping from the authority model (ADR-009) to
 * the adapter vocabulary (AuthorityAccount, ADR-011). Extracted pure
 * (E2) so the third state is testable without dragging the hook
 * graph: a wrong mapping here paints a quorum as single-key — or a personal
 * wallet as a Legacy.
 *
 * The three states it speaks:
 *   kind 'simple'   + authority 'single' — a normal wallet.
 *   kind 'simple'   + authority 'quorum' — E2: the reinforced personal
 *     account. A CONFIRMED SignerList (ledger-read, owner-marked) on a
 *     wallet that is NOT a Legacy: your wallet, quorum keys.
 *   kind 'governed' + authority 'quorum' — a Legacy: the council signs.
 */

import { getLegacyNickname } from '../../components/legacy/legacyLocal';
import type { Authority, GovernedAuthority } from '../authority';
import type { AuthorityAccount } from './authorityAccounts';

export function toAuthorityAccount(a: Authority): AuthorityAccount | null {
  if (a.kind === 'single') {
    // E2 third state: only a CONFIRMED quorum paints (hasCouncil read true);
    // a stale mark with no SignerList on the ledger stays 'single'.
    const hq = a.hardenedQuorum;
    return {
      id: a.id,
      kind: 'simple',
      address: a.wallet.address,
      chain: a.wallet.ecosystem === 'xrpl' ? 'xrp' : (a.wallet.ecosystem ?? 'evm'),
      nickname: a.wallet.label,
      authority:
        hq?.hasCouncil === true
          ? { type: 'quorum', quorum: hq.quorum, total: hq.memberCount }
          : { type: 'single' },
      ...(hq?.hasCouncil === true && hq.health ? { health: hq.health } : {}),
      isConnected: a.wallet.isActive,
      executors: [] as never[],
    };
  }
  if (a.kind === 'governed') {
    const g = a as GovernedAuthority;
    return {
      id: g.id,
      kind: 'governed',
      address: g.address,
      chain: 'xrp',
      nickname: g.label || getLegacyNickname(g.address) || undefined,
      authority: { type: 'quorum', quorum: g.quorum, total: g.memberCount },
      health: g.health,
      executors: [] as never[],
    };
  }
  return null; // the overview has no single-account representation in this API
}
