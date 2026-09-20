/**
 * The multisig coordinator (ADR-008) — it fixes the bytes every council member
 * signs. These tests pin the contract that made the mainnet rehearsal
 * work: identical Sequence, fee = base x (1 + signers), the SigningPubKey marker,
 * the SourceTag survives, and the simulate preflight rides along.
 */
import { _resetXrplSourceTagCache } from '../../../../config/xrplSourceTag';
import {
  prepareCouncilMultisig,
  NotACouncilError,
  type MultisigLedgerReader,
} from '../XrplMultisigCoordinator';

const ACCOUNT = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const TEST_TAG = 2607090002;
const ORIGINAL_TAG = process.env.XRPL_SOURCE_TAG;

beforeEach(() => {
  process.env.XRPL_SOURCE_TAG = String(TEST_TAG);
  _resetXrplSourceTagCache();
});
afterAll(() => {
  if (ORIGINAL_TAG === undefined) delete process.env.XRPL_SOURCE_TAG;
  else process.env.XRPL_SOURCE_TAG = ORIGINAL_TAG;
  _resetXrplSourceTagCache();
});

/** A council of `n` members, weight 1 each, quorum = n; deterministic reads. */
function readerWith(n: number, opts: { sequence?: number; baseFee?: number; simulateOk?: boolean } = {}): MultisigLedgerReader {
  const signers = Array.from({ length: n }, (_, i) => ({ account: `r${'S'.repeat(24)}${i}`, weight: 1 }));
  return {
    getSignerCouncil: async () => ({ quorum: n, masterKeyDisabled: false, signers }),
    getAccountSequence: async () => opts.sequence ?? 105597274,
    getBaseFeeDrops: async () => opts.baseFee ?? 10,
    simulateTransaction: async (tx) => ({
      available: true,
      willSucceed: opts.simulateOk ?? true,
      engineResult: (opts.simulateOk ?? true) ? 'tesSUCCESS' : 'tecUNFUNDED',
      // echo back that SigningPubKey was NOT sent to simulate (autofilled there)
      balanceChanges: 'SigningPubKey' in tx ? [{ account: ACCOUNT, value: '-1', currency: 'XRP' }] : [],
    }),
  };
}

const escrowTx = {
  TransactionType: 'EscrowCreate',
  Account: ACCOUNT,
  Destination: ACCOUNT,
  Amount: '1000000',
  FinishAfter: 837462189,
  SourceTag: TEST_TAG,
};

describe('prepareCouncilMultisig', () => {
  it('fixes Sequence, fee = base x (1 + signers), and the multisig marker', async () => {
    const out = await prepareCouncilMultisig(readerWith(3, { sequence: 105597274, baseFee: 10 }), {
      account: ACCOUNT,
      xrplTx: escrowTx,
    });
    expect(out.multisigTx.Sequence).toBe(105597274);
    expect(out.multisigTx.Fee).toBe('40'); // 10 x (1 + 3)
    expect(out.multisigTx.SigningPubKey).toBe('');
    expect(out.fee).toEqual({ drops: '40', baseFeeDrops: 10, signerCount: 3 });
  });

  it('stamps the SourceTag and preserves the original tx fields', async () => {
    const out = await prepareCouncilMultisig(readerWith(2), { account: ACCOUNT, xrplTx: escrowTx });
    expect(out.multisigTx.SourceTag).toBe(TEST_TAG);
    expect(out.multisigTx.TransactionType).toBe('EscrowCreate');
    expect(out.multisigTx.Amount).toBe('1000000');
    expect(out.fee.drops).toBe('30'); // 10 x (1 + 2)
  });

  it('runs the simulate preflight WITHOUT the empty SigningPubKey (so simulate autofills)', async () => {
    const out = await prepareCouncilMultisig(readerWith(3), { account: ACCOUNT, xrplTx: escrowTx });
    // the reader's simulate returns [] when SigningPubKey was present in the tx it got
    expect(out.preflight.available).toBe(true);
    expect(out.preflight.willSucceed).toBe(true);
    expect(out.preflight.balanceChanges).toEqual([]); // proves SigningPubKey was stripped for simulate
  });

  it('surfaces a failing preflight instead of hiding it', async () => {
    const out = await prepareCouncilMultisig(readerWith(3, { simulateOk: false }), {
      account: ACCOUNT,
      xrplTx: escrowTx,
    });
    expect(out.preflight.willSucceed).toBe(false);
    expect(out.preflight.engineResult).toBe('tecUNFUNDED');
  });

  it('throws NotACouncilError when the account has no SignerList', async () => {
    const reader: MultisigLedgerReader = { ...readerWith(3), getSignerCouncil: async () => null };
    await expect(
      prepareCouncilMultisig(reader, { account: ACCOUNT, xrplTx: escrowTx }),
    ).rejects.toBeInstanceOf(NotACouncilError);
  });

  it('carries a real base fee through (not just the 10-drop default)', async () => {
    const out = await prepareCouncilMultisig(readerWith(4, { baseFee: 12 }), {
      account: ACCOUNT,
      xrplTx: escrowTx,
    });
    expect(out.multisigTx.Fee).toBe('60'); // 12 x (1 + 4)
  });

  /**
   * THE CONTESTED SEAT, TAKEN ON PURPOSE.
   *
   * Told a family «the exit takes the seat» while this function pinned whatever
   * `account_info` answered — the rival's number only by luck of timing. The caller
   * may now ask for the exact seat, and the answer says which one was taken and why.
   * What it never does is pin a seat the ledger has moved past: that composes a
   * payload that is tefPAST_SEQ from birth, which is the one way to kill an exit.
   */
  describe('pinSequence — an exit may take the seat another payload is holding', () => {
    it('pins the requested seat when it IS the ledger’s next unused Sequence', async () => {
      const out = await prepareCouncilMultisig(readerWith(3, { sequence: 42 }), {
        account: ACCOUNT,
        xrplTx: escrowTx,
        pinSequence: 42,
      });
      expect(out.multisigTx.Sequence).toBe(42);
      expect(out.sequence).toEqual({ pinned: 42, ledgerNext: 42, requested: 42, source: 'contested-seat' });
    });

    it('IGNORES a seat the ledger has already moved past, and says it was consumed', async () => {
      const out = await prepareCouncilMultisig(readerWith(3, { sequence: 45 }), {
        account: ACCOUNT,
        xrplTx: escrowTx,
        pinSequence: 42,
      });
      expect(out.multisigTx.Sequence).toBe(45);
      expect(out.sequence).toMatchObject({ pinned: 45, source: 'ledger', requestedSeatConsumed: true });
    });

    it('never composes a gap: a seat AHEAD of the ledger is ignored too', async () => {
      const out = await prepareCouncilMultisig(readerWith(3, { sequence: 45 }), {
        account: ACCOUNT,
        xrplTx: escrowTx,
        pinSequence: 60,
      });
      expect(out.multisigTx.Sequence).toBe(45);
      expect(out.sequence).toMatchObject({ pinned: 45, source: 'ledger' });
      expect(out.sequence.requestedSeatConsumed).toBeUndefined();
    });

    it('without a request it reads the ledger exactly as before', async () => {
      const out = await prepareCouncilMultisig(readerWith(3, { sequence: 105597274 }), {
        account: ACCOUNT,
        xrplTx: escrowTx,
      });
      expect(out.sequence).toEqual({ pinned: 105597274, ledgerNext: 105597274, source: 'ledger' });
    });
  });
});
