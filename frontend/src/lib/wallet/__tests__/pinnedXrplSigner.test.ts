import { describe, expect, it } from 'vitest';
import { pinnedXrplSigner } from '../xrplSigner';

describe('pinnedXrplSigner — a pinned Account signs without a Xaman session', () => {
  it('reads the Account a prepared payload is pinned to', () => {
    expect(pinnedXrplSigner({ TransactionType: 'Payment', Account: 'rNyrefquhQfqFYwHojT8aHwVPmKtqYZtg8' })).toBe('rNyrefquhQfqFYwHojT8aHwVPmKtqYZtg8');
  });

  it('an unpinned payload, a bad address or no payload at all → null (the session is needed)', () => {
    expect(pinnedXrplSigner({ TransactionType: 'Payment' })).toBeNull();
    expect(pinnedXrplSigner({ Account: '0xdE9554D04Ee85324C6530ffc4d0a0284E2A6521d' })).toBeNull();
    expect(pinnedXrplSigner({ Account: 42 })).toBeNull();
    expect(pinnedXrplSigner(null)).toBeNull();
    expect(pinnedXrplSigner(undefined)).toBeNull();
  });
});
