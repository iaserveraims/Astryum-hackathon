/**
 * Independent regression test for the "lectura ciega al código de resultado"
 * guard in XRPLProvider.getMultisigSignerActivity / getDidSetHistory — written
 * against the REAL on-chain history of the test council
 * (rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf), not synthetic data, and by a different
 * author than the fix. Independent verification against the failure that
 * actually happened IS the discipline this bug family demands.
 *
 * What the real history proves — and what it does NOT:
 * The rehearsal produced 31 validated txs, 6 of them tec-class. But the two
 * EscrowCreate + two EscrowFinish + one DIDSet all succeeded, and every signer of
 * a failed tx also signed a successful one. So for THIS account the guarded and
 * the blind reads are IDENTICAL — the catastrophic misread (a tec EscrowCreate
 * counted as a completed rehearsal → offer to disable the master key against an
 * escrow that never settled) did not occur. It missed only by luck of which tx
 * type drew the tecINSUFFICIENT_RESERVE (it hit TicketCreate 4×, not the escrow).
 *   · Tests 1–3 lock that the guard does not BREAK the real (good) reading.
 *   · Test 4 relocates the exact real failure code onto an EscrowCreate — the
 *     shot that missed — and proves the guard is what prevents the phantom.
 */
import * as fs from 'fs';
import * as path from 'path';
import { XRPLProvider } from '../XRPLProvider';

const mockRequest = jest.fn();
jest.mock('xrpl', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
    request: mockRequest,
  })),
}));

const realFixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'rsmv-council-account-tx.real.json'),
    'utf8',
  ),
) as { _meta: Record<string, unknown>; transactions: any[] };

const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
// The 4 distinct accounts that signed at least one tesSUCCESS multisig tx.
const QUORUM_SIGNERS = [
  'rBGVzjE5JcbZs2toRRLLrE6z62HmmGNSxa',
  'rGb1VJkxmMzZLbWRFfu9Xh5GVjZGYR4d3x',
  'rNaFfVgbqWYotrR3Jz4RorirDUZgLfxhXt',
  'rPbwqPUBRkDtThuGMitT3LCJs7PVfvnTwV',
];

function respondWith(transactions: unknown[]) {
  mockRequest.mockResolvedValueOnce({ result: { transactions } });
}

beforeEach(() => mockRequest.mockReset());

describe('XRPLProvider — real rehearsal history (rsmv… test council)', () => {
  it('fixture provenance: 31 validated txs, 6 tec-class, and none of the failures were escrow txs', () => {
    expect(realFixture.transactions).toHaveLength(31);
    const tec = realFixture.transactions.filter(
      (e) => e.meta.TransactionResult !== 'tesSUCCESS',
    );
    expect(tec).toHaveLength(6);
    // The blind read survived only because the tec draws missed the escrow legs.
    expect(tec.every((e) => !/Escrow/.test(e.tx.TransactionType))).toBe(true);
  });

  it('guarded read of the real history stays correct: 2 escrow creates, resolved, the 4 quorum signers', async () => {
    respondWith(realFixture.transactions);
    const p = new XRPLProvider();
    const act = await p.getMultisigSignerActivity(COUNCIL);
    expect(act.multisigEscrowCreates).toBe(2);
    expect(act.escrowResolved).toBe(true);
    expect(act.signersSeen.slice().sort()).toEqual([...QUORUM_SIGNERS].sort());
  });

  it('DIDSet history from the real ledger lists the one ratified (tesSUCCESS) amendment', async () => {
    respondWith(realFixture.transactions);
    const p = new XRPLProvider();
    const hist = await p.getDidSetHistory(COUNCIL);
    expect(hist).toHaveLength(1);
    expect(hist[0].signedByQuorum).toBe(true);
  });

  it('COUNTERFACTUAL — the shot that missed: a tec EscrowCreate is NOT counted, so the rehearsal cannot complete on a phantom escrow', async () => {
    // Relocate the exact failure code that hit the real TicketCreates
    // (tecINSUFFICIENT_RESERVE) onto the rehearsal EscrowCreate — the single draw
    // that would have been catastrophic on the master-key-disable path.
    const phantomEscrow = {
      validated: true,
      meta: { TransactionResult: 'tecINSUFFICIENT_RESERVE' },
      tx: {
        TransactionType: 'EscrowCreate',
        Account: COUNCIL,
        Signers: [{ Signer: { Account: 'rGhostSignerOnlyOnTheFailedTx0000' } }],
      },
    };
    respondWith([...realFixture.transactions, phantomEscrow]);
    const p = new XRPLProvider();
    const act = await p.getMultisigSignerActivity(COUNCIL);
    // Still 2. Blind (pre-guard) this was 3 → rehearsalComplete over an escrow
    // that never settled → the app offers to disable the master key.
    expect(act.multisigEscrowCreates).toBe(2);
    // And a signer that appears ONLY on the failed tx never enters the roster.
    expect(act.signersSeen).not.toContain('rGhostSignerOnlyOnTheFailedTx0000');
  });
});
