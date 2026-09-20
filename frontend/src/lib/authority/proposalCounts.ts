/**
 * Proposal counters for the authority list (E1).
 *
 * ONE read of /council/proposals?status=live feeds two different facts, so
 * the badge and the band never pay a second request for the same rows:
 */

import type { CouncilProposalRecord, CouncilSignatureRow } from '../../services/v1Api';

export interface ProposalForCounts {
  account: CouncilProposalRecord['account'];
  status: CouncilProposalRecord['status'];
  signerList: Array<{ account: string; weight: number }>;
  signatures: Array<Pick<CouncilSignatureRow, 'signerAccount'>>;
}

export interface ProposalCounts {
  /** Per council account: proposals waiting for one of MY seats to sign. */
  pendingForMe: Record<string, number>;
  /** Per council account: proposals still in flight (collecting | ready). */
  live: Record<string, number>;
}

export function countProposals(
  proposals: ProposalForCounts[],
  accounts: string[],
  mine: Set<string>,
): ProposalCounts {
  const pendingForMe: Record<string, number> = {};
  const live: Record<string, number> = {};
  // Listed accounts start at 0 — a known account with nothing pending reads
  // as ZERO, distinct from an account the read never covered (undefined).
  for (const a of accounts) {
    pendingForMe[a] = 0;
    live[a] = 0;
  }
  for (const p of proposals) {
    if (p.status !== 'collecting' && p.status !== 'ready') continue;
    live[p.account] = (live[p.account] ?? 0) + 1;
    if (p.status !== 'collecting') continue;
    const signed = new Set(p.signatures.map((s) => s.signerAccount));
    if (p.signerList.some((s) => mine.has(s.account) && !signed.has(s.account))) {
      pendingForMe[p.account] = (pendingForMe[p.account] ?? 0) + 1;
    }
  }
  return { pendingForMe, live };
}
