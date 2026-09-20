/**
 * La regla de conteo del panel Make Waves, pura (sin red, sin DB).
 *
 * Lo que importa: solo cuenta lo validado y tesSUCCESS con EL tag; deduplica
 * por hash (un Payment entre dos cuentas conocidas aparece en el account_tx
 * de ambas); en multisig los Active Users son los MIEMBROS que firmaron; las
 * cuentas operativas de Astryum jamás cuentan; y el volumen es lo ENTREGADO
 * (delivered_amount), nunca lo pedido — y solo en XRP nativo.
 */
import { reduceTaggedEntries, type AccountTxEntry } from '../XrplSourceTagMetricsService';

const TAG = 2607090002;
const ALICE = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const BOB = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';
const CAROL = 'rDarPNJEzCnJvTeGVwjrsbJBZTk4npWonD';
// A base58-VALID address (the exclusion must win because the set names it,
// not because the regex quietly rejected a malformed fake).
const KEEPER = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';

function payment(over: Partial<AccountTxEntry> & { tx?: Record<string, unknown> } = {}): AccountTxEntry {
  return {
    hash: over.hash ?? 'HASH-1',
    validated: true,
    meta: { TransactionResult: 'tesSUCCESS', ...(over.meta ?? {}) },
    tx: {
      TransactionType: 'Payment',
      Account: ALICE,
      Destination: BOB,
      Amount: '10000000',
      SourceTag: TAG,
      date: 800000000,
      ...(over.tx ?? {}),
    },
  };
}

describe('reduceTaggedEntries', () => {
  it('counts a tagged, validated tesSUCCESS Payment once — with signer and drops', () => {
    const byHash = reduceTaggedEntries([payment()], TAG, new Set());
    expect(byHash.size).toBe(1);
    const facts = byHash.get('HASH-1')!;
    expect(facts.signers).toEqual([ALICE]);
    expect(facts.drops).toBe(10_000_000n);
    expect(facts.dateISO).toContain('T');
  });

  it('dedupes the same hash seen from BOTH sides of the payment', () => {
    // Alice's account_tx and Bob's account_tx both return the same tx.
    const byHash = reduceTaggedEntries([payment(), payment()], TAG, new Set());
    expect(byHash.size).toBe(1);
  });

  it('skips untagged, wrong-tagged, failed and unvalidated entries', () => {
    const byHash = reduceTaggedEntries(
      [
        payment({ hash: 'H-untagged', tx: { SourceTag: undefined } }),
        payment({ hash: 'H-wrong', tx: { SourceTag: 12345 } }),
        payment({ hash: 'H-failed', meta: { TransactionResult: 'tecUNFUNDED_PAYMENT' } }),
        { ...payment({ hash: 'H-unvalidated' }), validated: false },
      ],
      TAG,
      new Set(),
    );
    expect(byHash.size).toBe(0);
  });

  it('multisig: the Active Users are the MEMBERS who signed, not the account', () => {
    const byHash = reduceTaggedEntries(
      [
        payment({
          hash: 'H-multi',
          tx: {
            Account: CAROL, // the council account
            Signers: [
              { Signer: { Account: ALICE } },
              { Signer: { Account: BOB } },
            ],
          },
        }),
      ],
      TAG,
      new Set(),
    );
    expect(byHash.get('H-multi')!.signers.sort()).toEqual([ALICE, BOB].sort());
  });

  it('excludes operational signers — a tx signed ONLY by Astryum never counts', () => {
    const excluded = new Set([KEEPER]);
    const byHash = reduceTaggedEntries(
      [payment({ hash: 'H-ops', tx: { Account: KEEPER } })],
      TAG,
      excluded,
    );
    expect(byHash.size).toBe(0);
  });

  it('volume = delivered_amount when present, and NEVER an IOU object', () => {
    const byHash = reduceTaggedEntries(
      [
        // partial payment: asked 10 XRP, delivered 4 — the truth is 4.
        payment({ hash: 'H-partial', meta: { TransactionResult: 'tesSUCCESS', delivered_amount: '4000000' } }),
        // IOU payment: counts as a tx, adds zero XRP volume.
        payment({
          hash: 'H-iou',
          meta: {
            TransactionResult: 'tesSUCCESS',
            delivered_amount: { currency: 'RLUSD', issuer: CAROL, value: '9' },
          },
          tx: { Amount: { currency: 'RLUSD', issuer: CAROL, value: '9' } },
        }),
        // non-Payment (SignerListSet): a tx, no volume.
        payment({ hash: 'H-sls', tx: { TransactionType: 'SignerListSet', Amount: undefined } }),
      ],
      TAG,
      new Set(),
    );
    expect(byHash.size).toBe(3);
    expect(byHash.get('H-partial')!.drops).toBe(4_000_000n);
    expect(byHash.get('H-iou')!.drops).toBe(0n);
    expect(byHash.get('H-sls')!.drops).toBe(0n);
  });

  it('reads api_version 2 shape (tx_json + meta at the top)', () => {
    const byHash = reduceTaggedEntries(
      [
        {
          hash: 'H-v2',
          validated: true,
          meta: { TransactionResult: 'tesSUCCESS' },
          tx_json: {
            TransactionType: 'Payment',
            Account: BOB,
            Amount: '2000000',
            SourceTag: TAG,
          },
        },
      ],
      TAG,
      new Set(),
    );
    expect(byHash.get('H-v2')!.signers).toEqual([BOB]);
    expect(byHash.get('H-v2')!.drops).toBe(2_000_000n);
  });
});
