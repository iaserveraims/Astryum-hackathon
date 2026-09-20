/**
 * The counting rule behind two different facts on the structure cards:
 * "your signature is due" (pendingForMe) vs "decisions in flight" (live).
 * One misread here paints a false badge over a quorum's money.
 */
import { describe, it, expect } from 'vitest';
import { countProposals, type ProposalForCounts } from '../authority/proposalCounts';

const COUNCIL = 'rCouncil111111111111111111111111111';
const ME = 'rMe11111111111111111111111111111111';
const OTHER = 'rOther1111111111111111111111111111';

function proposal(over: Partial<ProposalForCounts>): ProposalForCounts {
  return {
    account: COUNCIL,
    status: 'collecting',
    signerList: [
      { account: ME, weight: 1 },
      { account: OTHER, weight: 1 },
    ],
    signatures: [],
    ...over,
  };
}

describe('countProposals', () => {
  it('counts a collecting proposal with my unsigned seat for BOTH facts', () => {
    const res = countProposals([proposal({})], [COUNCIL], new Set([ME]));
    expect(res.pendingForMe[COUNCIL]).toBe(1);
    expect(res.live[COUNCIL]).toBe(1);
  });

  it('keeps a proposal I already signed live, but never pending for me', () => {
    const res = countProposals(
      [proposal({ signatures: [{ signerAccount: ME }] })],
      [COUNCIL],
      new Set([ME]),
    );
    expect(res.pendingForMe[COUNCIL]).toBe(0);
    expect(res.live[COUNCIL]).toBe(1);
  });

  it('treats ready as live only — the quorum is already reached', () => {
    const res = countProposals([proposal({ status: 'ready' })], [COUNCIL], new Set([ME]));
    expect(res.pendingForMe[COUNCIL]).toBe(0);
    expect(res.live[COUNCIL]).toBe(1);
  });

  it('counts settled proposals nowhere', () => {
    for (const status of ['submitted', 'expired', 'withdrawn'] as const) {
      const res = countProposals([proposal({ status })], [COUNCIL], new Set([ME]));
      expect(res.pendingForMe[COUNCIL]).toBe(0);
      expect(res.live[COUNCIL]).toBe(0);
    }
  });

  it('never pends a proposal where none of my seats are listed', () => {
    const res = countProposals(
      [proposal({ signerList: [{ account: OTHER, weight: 1 }] })],
      [COUNCIL],
      new Set([ME]),
    );
    expect(res.pendingForMe[COUNCIL]).toBe(0);
    expect(res.live[COUNCIL]).toBe(1);
  });

  it('seeds every listed account at zero — known and empty is not unknown', () => {
    const quiet = 'rQuiet111111111111111111111111111';
    const res = countProposals([], [COUNCIL, quiet], new Set([ME]));
    expect(res.pendingForMe).toEqual({ [COUNCIL]: 0, [quiet]: 0 });
    expect(res.live).toEqual({ [COUNCIL]: 0, [quiet]: 0 });
  });
});
