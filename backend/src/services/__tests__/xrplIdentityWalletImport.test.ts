/**
 * Importing the wallet from XRP Identity — and, above all, what it must NOT do.
 *
 * The address arrives on the operator's word: they store what their wallet
 * connector returned and do not verify or persist proof of ownership (Thomas
 * Hussenet). So the interesting tests here are not "does it write a
 * row" but the three refusals — never overwrite, never resurrect, never become
 * primary — because each of them is a way a weak claim could quietly displace a
 * strong one the user made by signing.
 */
const rows: any[] = [];
let seq = 0;
let createShouldThrow = false;

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    wallet: {
      findUnique: async ({ where }: any) => {
        const k = where.userId_address_network;
        return rows.find((r) => r.userId === k.userId && r.address === k.address && r.network === k.network) ?? null;
      },
      create: async ({ data }: any) => {
        if (createShouldThrow) throw new Error('db down');
        const row = { id: `w${++seq}`, ...data };
        rows.push(row);
        return row;
      },
    },
  },
}));

import { importXrplIdentityWallet, XRPL_IDENTITY_WALLET_TYPE } from '../xrplIdentityWalletImport';

const USER = 'user-1';
const ADDRESS = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w';

beforeEach(() => {
  rows.length = 0;
  seq = 0;
  createShouldThrow = false;
});

describe('importXrplIdentityWallet', () => {
  test('brings the address in as watch-only, never primary, with its provenance on the row', async () => {
    await expect(importXrplIdentityWallet(USER, ADDRESS)).resolves.toBe('imported');

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      userId: USER,
      address: ADDRESS,
      network: 'xrpl',
      ecosystem: 'xrpl',
      caip2: 'xrpl:0',
      walletType: XRPL_IDENTITY_WALLET_TYPE,
      // The ceiling, in the database: Capital Map only.
      purpose: 'watch',
      // The primary wallet is the default signer for its ecosystem. A hint is not that.
      isPrimary: false,
    });
    expect(row.permissions).toMatchObject({ importedFrom: 'xrp_identity', ownershipProof: 'none' });
  });

  test('nothing to import is not an error', async () => {
    await expect(importXrplIdentityWallet(USER, null)).resolves.toBe('skipped');
    expect(rows).toHaveLength(0);
  });

  test('NEVER downgrades a wallet the user proved by signing', async () => {
    rows.push({
      id: 'w0',
      userId: USER,
      address: ADDRESS,
      network: 'xrpl',
      walletType: 'xaman',
      purpose: 'both',
      isPrimary: true,
      permissions: {},
    });

    await expect(importXrplIdentityWallet(USER, ADDRESS)).resolves.toBe('already_known');

    // Untouched: same type, same purpose, still primary, and no second row.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ walletType: 'xaman', purpose: 'both', isPrimary: true });
  });

  test('NEVER resurrects a wallet the user deleted', async () => {
    rows.push({
      id: 'w0',
      userId: USER,
      address: ADDRESS,
      network: 'xrpl',
      walletType: 'xaman',
      purpose: 'watch',
      isConnected: false,
      permissions: { unlinkedAt: '2026-08-18T10:00:00.000Z' },
    });

    await expect(importXrplIdentityWallet(USER, ADDRESS)).resolves.toBe('already_known');
    expect(rows).toHaveLength(1);
    expect(rows[0].permissions).toMatchObject({ unlinkedAt: '2026-08-18T10:00:00.000Z' });
  });

  test('is idempotent: a second login adds nothing', async () => {
    await importXrplIdentityWallet(USER, ADDRESS);
    await expect(importXrplIdentityWallet(USER, ADDRESS)).resolves.toBe('already_known');
    expect(rows).toHaveLength(1);
  });

  test('the same address for a DIFFERENT user is a different wallet', async () => {
    await importXrplIdentityWallet(USER, ADDRESS);
    await expect(importXrplIdentityWallet('user-2', ADDRESS)).resolves.toBe('imported');
    expect(rows).toHaveLength(2);
  });

  test('a write that fails is reported, not thrown — a login must not die for a row', async () => {
    createShouldThrow = true;
    await expect(importXrplIdentityWallet(USER, ADDRESS)).resolves.toBe('failed');
  });
});
