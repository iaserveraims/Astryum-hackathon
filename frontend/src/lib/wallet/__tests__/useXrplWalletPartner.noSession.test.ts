/**
 * sendIntent SIN sesión de Xaman en este navegador (fundador 2026-09-17: «me
 * dice que conecte mi XRPL wallet cuando ya está conectada»): un pago que PINNA
 * su Account firma por el QR del servidor; solo un pago sin Account exige la
 * sesión. Misma armadura que quorumRouting, con el store VACÍO.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const submitTransaction = vi.fn(async () => 'B'.repeat(64));
const ACCOUNT = 'rNyrefquhQfqFYwHojT8aHwVPmKtqYZtg8';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useMemo: (f: () => unknown) => f(), useCallback: (f: unknown) => f };
});
vi.mock('@/services/wallets/WalletServiceFactory', () => ({
  WalletServiceFactory: { getWalletService: () => ({ submitTransaction }) },
}));
vi.mock('@/services/wallets/XamanWalletService', () => ({ XamanWalletService: class {} }));
// NO Xaman session in this browser: an empty store.
vi.mock('@/stores/walletStore', () => ({
  useWalletStore: (selector: (s: unknown) => unknown) => selector({ activeWallet: null, wallets: [] }),
}));

import { useXrplWalletPartner } from '../useXrplWalletPartner';
import { __resetAccountQuorumCache } from '@/lib/xrpl/accountQuorum';

beforeEach(() => {
  submitTransaction.mockClear();
  __resetAccountQuorumCache();
  // Every node says: this account signs alone (no SignerList).
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ result: { account_objects: [] } }),
  })) as unknown as typeof fetch;
  vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  __resetAccountQuorumCache();
});

describe('sendIntent without a Xaman session', () => {
  it('a payment pinned to an account signs through the server QR — no session needed', async () => {
    const { sendIntent, isConnected } = useXrplWalletPartner();
    expect(isConnected).toBe(false);
    const tx = { TransactionType: 'Payment', Account: ACCOUNT, Destination: 'rSomebody11111111111111111111111111', Amount: '1' };
    const out = await sendIntent({ tx } as never);
    expect(out.txHash).toBe('B'.repeat(64));
    expect(submitTransaction).toHaveBeenCalledTimes(1);
    expect((submitTransaction.mock.calls[0] as unknown[])[0]).toMatchObject({ Account: ACCOUNT });
  });

  it('a payment with no Account still needs the session: refused before anything is built', async () => {
    const { sendIntent } = useXrplWalletPartner();
    await expect(sendIntent({ tx: { TransactionType: 'Payment', Destination: 'rSomebody11111111111111111111111111', Amount: '1' } } as never)).rejects.toThrow(
      'XRPL_WALLET_PARTNER_NOT_CONNECTED',
    );
    expect(submitTransaction).not.toHaveBeenCalled();
  });
});
