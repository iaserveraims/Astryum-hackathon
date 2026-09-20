import { describe, expect, it } from 'vitest';
import type { PoteTicket } from '../api';
import { decideTicketsBoard, myExitTickets } from '../exitTickets';

/**
 * TicketsBoard returned null without an EVM wallet and ignored tickets whose
 * receiver is the user's Personal Account — the tickets every XRPL exit opens.
 */

const EVM = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
const PA = '0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb';
const OTHER = '0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc';

const tk = (id: number, receiver: string, claimed = false): PoteTicket => ({ id, receiver, assets: '1000', maturity: 0, claimed });

describe('myExitTickets', () => {
  it('matches the EVM wallet and the Personal Account, case-insensitively, unclaimed only', () => {
    const tickets = [tk(0, EVM.toLowerCase()), tk(1, PA.toUpperCase().replace('0X', '0x')), tk(2, OTHER), tk(3, PA, true)];
    const mine = myExitTickets(tickets, { evm: EVM, personalAccount: PA });
    expect(mine.map((m) => [m.ticket.id, m.rail])).toEqual([
      [0, 'evm'],
      [1, 'personal-account'],
    ]);
  });

  it('Personal Account tickets show with no EVM wallet at all', () => {
    expect(myExitTickets([tk(0, PA)], { evm: null, personalAccount: PA })).toHaveLength(1);
  });
});

describe('decideTicketsBoard', () => {
  const base = { evmAddress: null, xrplAddress: null, pa: 'none' as const, personalAccount: null, read: 'ok' as const, tickets: [] };

  it('no wallet: a hint, never silence', () => {
    expect(decideTicketsBoard(base).kind).toBe('no-wallet');
  });

  it('a failed read is said, not hidden', () => {
    expect(decideTicketsBoard({ ...base, evmAddress: EVM, read: 'failed' })).toEqual({ kind: 'failed', reason: 'read' });
  });

  it('XRPL-only user sees the tickets of their Personal Account', () => {
    const v = decideTicketsBoard({ ...base, xrplAddress: 'rXXX', pa: 'resolved', personalAccount: PA, tickets: [tk(4, PA)] });
    expect(v).toMatchObject({ kind: 'list', incomplete: false });
    expect(v.kind === 'list' && v.tickets[0].rail).toBe('personal-account');
  });

  it('an unresolved Personal Account is never "no exits"', () => {
    expect(decideTicketsBoard({ ...base, xrplAddress: 'rXXX', pa: 'failed' })).toEqual({ kind: 'failed', reason: 'personal-account' });
    expect(decideTicketsBoard({ ...base, xrplAddress: 'rXXX', pa: 'resolving' }).kind).toBe('reading');
    expect(
      decideTicketsBoard({ ...base, evmAddress: EVM, xrplAddress: 'rXXX', pa: 'failed', tickets: [tk(0, EVM)] }),
    ).toMatchObject({ kind: 'list', incomplete: true });
  });

  it('"empty" only when everything was read', () => {
    expect(decideTicketsBoard({ ...base, evmAddress: EVM, tickets: [tk(0, OTHER)] }).kind).toBe('empty');
    expect(decideTicketsBoard({ ...base, evmAddress: EVM, read: 'pending' }).kind).toBe('reading');
  });
});
