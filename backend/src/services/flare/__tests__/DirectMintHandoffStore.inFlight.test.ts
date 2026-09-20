/**
 * inFlightHandoffOf — «ya firmaste, no hay nada que firmar» (fundador 2026-09-15).
 * Pura: de las filas en cola, la orden FIRMADA de esta cuenta y acción.
 */
jest.mock('../../../database/prismaClient', () => ({ prisma: {} }));

import { inFlightHandoffOf } from '../DirectMintHandoffStore';

const row = (over: Partial<{ xrplAddress: string; action: string | null; memoHex: string; signedAt: string | null; signedTxHash: string | null }>) => ({
  xrplAddress: 'raqZZbqWqAr5cJcwP9EjGYCWDTty2eJKvM',
  action: 'astryum-cage-create',
  memoHex: 'AA',
  signedAt: null,
  signedTxHash: null,
  ...over,
});

describe('inFlightHandoffOf', () => {
  it('a signed, still-queued birth of this account is in flight', () => {
    const got = inFlightHandoffOf([row({ signedAt: '2026-09-15T10:00:00.000Z', signedTxHash: 'ABC' })], 'raqZZbqWqAr5cJcwP9EjGYCWDTty2eJKvM', 'astryum-cage-create');
    expect(got).toEqual({ memoHex: 'AA', action: 'astryum-cage-create', signedAt: '2026-09-15T10:00:00.000Z', signedTxHash: 'ABC' });
  });

  it('an unsigned draft is not in flight — the person never signed it', () => {
    expect(inFlightHandoffOf([row({})], 'raqZZbqWqAr5cJcwP9EjGYCWDTty2eJKvM', 'astryum-cage-create')).toBeNull();
  });

  it('another account, or another action, does not count', () => {
    const rows = [row({ signedAt: '2026-09-15T10:00:00.000Z', xrplAddress: 'rOTHER' }), row({ signedAt: '2026-09-15T10:00:00.000Z', action: 'e1' })];
    expect(inFlightHandoffOf(rows, 'raqZZbqWqAr5cJcwP9EjGYCWDTty2eJKvM', 'astryum-cage-create')).toBeNull();
  });

  it('with several signed, the most recent signature is the one reported', () => {
    const rows = [row({ memoHex: 'OLD', signedAt: '2026-09-15T09:00:00.000Z' }), row({ memoHex: 'NEW', signedAt: '2026-09-15T10:00:00.000Z' })];
    expect(inFlightHandoffOf(rows, 'raqZZbqWqAr5cJcwP9EjGYCWDTty2eJKvM', 'astryum-cage-create')?.memoHex).toBe('NEW');
  });

  it('without an action filter any signed order of the account counts', () => {
    expect(inFlightHandoffOf([row({ signedAt: '2026-09-15T10:00:00.000Z', action: 'e1' })], 'raqZZbqWqAr5cJcwP9EjGYCWDTty2eJKvM')?.action).toBe('e1');
  });
});
