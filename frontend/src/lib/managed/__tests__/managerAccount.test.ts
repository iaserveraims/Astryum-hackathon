import { describe, expect, it } from 'vitest';
import {
  isXrplLinkedWallet,
  linkedManagerWallets,
  managerCandidates,
  resolveManagerAccount,
  type ConnectedXaman,
  type LinkedWallet,
} from '../managerAccount';

const R1 = 'rNyrefAAAAAAAAAAAAAAAAAAAAAAAZtg8';
const R2 = 'rpM7wQNUmAPSSbbb6J3yFJGnS9eoZthu8v';
const R3 = 'rwc9BBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const linked = (address: string, extra: Partial<LinkedWallet> = {}): LinkedWallet => ({ id: `w-${address.slice(1, 5)}`, address, ecosystem: 'xrpl', walletType: 'xaman', ...extra });
const session = (address: string, id = `s-${address.slice(1, 5)}`): ConnectedXaman => ({ id, address });

describe('linkedManagerWallets', () => {
  it('keeps XRPL rows linked to the account and drops EVM ones', () => {
    const rows = [linked(R1), { id: 'evm', address: '0x7B3f9C2a1D4e8F0a6C5b2E1d9A8c7B6f5E4d3C2b', ecosystem: 'evm' }];
    expect(linkedManagerWallets(rows).map((w) => w.address)).toEqual([R1]);
  });

  it('never offers the synthetic Legacy row as a manager', () => {
    expect(isXrplLinkedWallet({ id: 'legacy:' + R2, address: R2, ecosystem: 'xrpl' })).toBe(false);
    expect(linkedManagerWallets([linked(R1), { id: `legacy:${R2}`, address: R2, ecosystem: 'xrpl' }]).map((w) => w.address)).toEqual([R1]);
  });

  it('recognises an r-address even when the row carries no ecosystem', () => {
    expect(isXrplLinkedWallet({ address: R1 })).toBe(true);
    expect(isXrplLinkedWallet({ address: '0x7B3f9C2a1D4e8F0a6C5b2E1d9A8c7B6f5E4d3C2b' })).toBe(false);
  });
});

describe('managerCandidates', () => {
  it('a wallet linked to the account but not connected in this browser IS a candidate (the 15-sep bug)', () => {
    const out = managerCandidates([], [linked(R1)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ address: R1, live: false, session: null });
    expect(out[0].linked?.address).toBe(R1);
  });

  it('connected sessions come first, keep their linked row, and are not repeated', () => {
    const out = managerCandidates([session(R2)], [linked(R1, { nickname: 'Desk' }), linked(R2, { nickname: 'Family' })]);
    expect(out.map((c) => [c.address, c.live])).toEqual([[R2, true], [R1, false]]);
    expect(out[0].linked?.nickname).toBe('Family');
    expect(out[0].session?.address).toBe(R2);
  });

  it('a session with no linked row still counts, without a name to borrow', () => {
    const out = managerCandidates([session(R3)], [linked(R1)]);
    expect(out.map((c) => c.address)).toEqual([R3, R1]);
    expect(out[0].linked).toBeNull();
  });

  it('two sessions of the same address collapse into one row', () => {
    const out = managerCandidates([session(R1, 'a'), session(R1, 'b')], []);
    expect(out).toHaveLength(1);
    expect(out[0].session?.id).toBe('a');
  });
});

describe('resolveManagerAccount', () => {
  const cands = managerCandidates([session(R2)], [linked(R1), linked(R2)]);

  it('the hand-picked account wins while it is still a candidate', () => {
    expect(resolveManagerAccount(cands, R1, R2)).toBe(R1);
  });

  it('a hand-picked account that is gone falls back to the live session', () => {
    expect(resolveManagerAccount(cands, R3, R2)).toBe(R2);
  });

  it('with no session, the first linked wallet governs — no session needed to read a ledger', () => {
    const only = managerCandidates([], [linked(R1), linked(R2)]);
    expect(resolveManagerAccount(only, null, null)).toBe(R1);
  });

  it('a live session that is not a candidate (an EVM active wallet, a stale address) is ignored', () => {
    const only = managerCandidates([], [linked(R1)]);
    expect(resolveManagerAccount(only, null, R3)).toBe(R1);
  });

  it('nothing to choose from is null, never a made-up address', () => {
    expect(resolveManagerAccount([], null, null)).toBeNull();
    expect(resolveManagerAccount([], R1, R1)).toBeNull();
  });
});
