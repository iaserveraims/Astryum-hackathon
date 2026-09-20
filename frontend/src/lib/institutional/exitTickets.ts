/**
 * exitTickets — which exit tickets are YOURS, and what the board may say.
 *
 * Why this exists: TicketsBoard returned `null` without a
 * connected EVM wallet and matched tickets only against the EVM address. An
 * XRPL exit opens its ticket for the user's Flare Personal Account, so those
 * tickets — capital already burned out of the pot, waiting to be collected —
 * never showed anywhere. Money that seems lost.
 *
 * Pure. Tickets are pot-wide in `pote-state`; matching is by receiver.
 */

import type { PoteTicket } from './api';
import type { PaResolution } from './positionRead';

export type TicketRail = 'evm' | 'personal-account';

export interface MyTicket {
  ticket: PoteTicket;
  /** 'evm' = claim with the EVM wallet · 'personal-account' = claim by 0xFE, signed in Xaman. */
  rail: TicketRail;
}

export function myExitTickets(
  tickets: PoteTicket[],
  holders: { evm?: string | null; personalAccount?: string | null },
): MyTicket[] {
  const evm = holders.evm?.toLowerCase() ?? null;
  const pa = holders.personalAccount?.toLowerCase() ?? null;
  const out: MyTicket[] = [];
  for (const ticket of tickets) {
    if (ticket.claimed) continue;
    const receiver = ticket.receiver.toLowerCase();
    if (evm && receiver === evm) out.push({ ticket, rail: 'evm' });
    else if (pa && receiver === pa) out.push({ ticket, rail: 'personal-account' });
  }
  return out;
}

export type PotReadStatus = 'pending' | 'ok' | 'failed';

export type TicketsBoardView =
  | { kind: 'no-wallet' }
  | { kind: 'reading' }
  | { kind: 'failed'; reason: 'read' | 'personal-account' }
  | { kind: 'empty' }
  /** `incomplete` = the Personal Account is unknown: tickets held there may be missing. */
  | { kind: 'list'; tickets: MyTicket[]; incomplete: boolean };

export function decideTicketsBoard(input: {
  evmAddress: string | null | undefined;
  xrplAddress: string | null | undefined;
  pa: PaResolution;
  personalAccount: string | null | undefined;
  read: PotReadStatus;
  tickets: PoteTicket[];
}): TicketsBoardView {
  if (!input.evmAddress && !input.xrplAddress) return { kind: 'no-wallet' };
  if (input.read === 'failed') return { kind: 'failed', reason: 'read' };
  if (input.read === 'pending') return { kind: 'reading' };

  const mine = myExitTickets(input.tickets, {
    evm: input.evmAddress,
    personalAccount: input.pa === 'resolved' ? input.personalAccount : null,
  });
  const paUnknown = input.pa === 'failed' || input.pa === 'resolving';

  if (mine.length > 0) return { kind: 'list', tickets: mine, incomplete: paUnknown };
  if (input.pa === 'resolving') return { kind: 'reading' };
  if (input.pa === 'failed') return { kind: 'failed', reason: 'personal-account' };
  return { kind: 'empty' };
}
