/**
 * The autopilot pays a client out only to a PROVEN wallet: an account the
 * watcher saw paying a credited deposit in for that client, or a wallet the
 * row's owner proved with their own signature (SIWE login wallet / signed
 * WalletBinding) when it was written. Data anyone can write — receipts,
 * movement keys, a wallet typed into the row — proves nothing.
 */
import { payoutWalletProven } from '../payoutProof';
import { movementKey, type DemoClient, type DemoRun } from '../DemoExchangeStore';

const WALLET = 'rClientOwnWallet1111111111111111';
const ATTACKER = 'rAttackerWallet22222222222222222';
const HASH = 'A'.repeat(64);

function run(partial: Partial<Pick<DemoRun, 'receipts' | 'appliedTxHashes' | 'provenDepositSenders' | 'clients'>>): DemoRun {
  return {
    receipts: partial.receipts ?? [],
    appliedTxHashes: partial.appliedTxHashes ?? [],
    provenDepositSenders: partial.provenDepositSenders,
    clients: partial.clients ?? [],
  } as unknown as DemoRun;
}

const c1 = (extra: Partial<DemoClient>) => ({ id: 'c1', xrplAddress: WALLET, ...extra }) as DemoClient;

describe('payoutWalletProven — ledger proof', () => {
  it('a wallet the watcher saw paying a credited deposit in for this client is proven', () => {
    expect(payoutWalletProven(run({ provenDepositSenders: { c1: [WALLET] } }), 'c1', WALLET)).toBe(true);
  });

  it('a wallet merely written into the client row is NOT proven', () => {
    expect(payoutWalletProven(run({ provenDepositSenders: { c1: [WALLET] } }), 'c1', ATTACKER)).toBe(false);
  });

  it('iteration-3 attack: a forged U1_DEPOSIT receipt replaying a credited hash proves NOTHING', () => {
    const forged = run({
      receipts: [{ step: 'U1_DEPOSIT', clientId: 'c1', txHash: HASH, expect: { from: ATTACKER } }] as unknown as DemoRun['receipts'],
      appliedTxHashes: [movementKey('deposit', HASH)],
    });
    expect(payoutWalletProven(forged, 'c1', ATTACKER)).toBe(false);
  });

  it("another client's proven sender does not prove this client's wallet", () => {
    expect(payoutWalletProven(run({ provenDepositSenders: { c2: [WALLET] } }), 'c1', WALLET)).toBe(false);
  });

  it('no wallet on file, or no senders recorded → not proven', () => {
    expect(payoutWalletProven(run({ provenDepositSenders: { c1: [WALLET] } }), 'c1', undefined)).toBe(false);
    expect(payoutWalletProven(run({}), 'c1', WALLET)).toBe(false);
  });
});

describe('payoutWalletProven — signature proof of the owner', () => {
  it("'session' and 'binding' prove the wallet on file — even with no deposit from it (deposited before registering)", () => {
    expect(payoutWalletProven(run({ clients: [c1({ xrplAddressProof: 'session' })] }), 'c1', WALLET)).toBe(true);
    expect(payoutWalletProven(run({ clients: [c1({ xrplAddressProof: 'binding' })] }), 'c1', WALLET)).toBe(true);
  });

  it("'admin' (a founder typed it) and no proof at all do not", () => {
    expect(payoutWalletProven(run({ clients: [c1({ xrplAddressProof: 'admin' })] }), 'c1', WALLET)).toBe(false);
    expect(payoutWalletProven(run({ clients: [c1({})] }), 'c1', WALLET)).toBe(false);
  });

  it('the signature proof covers only the wallet it was given for', () => {
    expect(payoutWalletProven(run({ clients: [c1({ xrplAddressProof: 'session' })] }), 'c1', ATTACKER)).toBe(false);
  });

  it('an explicit client row wins over the run lookup', () => {
    expect(payoutWalletProven(run({}), 'c1', WALLET, { xrplAddress: WALLET, xrplAddressProof: 'binding' })).toBe(true);
  });

  it('iteration-4 attack (circular proof): an attacker wallet written without proof, then 1 drop credited as a return → not proven', () => {
    // The 1 drop from the attacker is a 'return' (no sender recorded) unless the
    // wallet is already on the row — and the row now only takes a wallet its
    // owner proved. Without that write there is nothing to be circular about.
    const attacked = run({ clients: [c1({ xrplAddress: ATTACKER })], provenDepositSenders: {} });
    expect(payoutWalletProven(attacked, 'c1', ATTACKER)).toBe(false);
  });
});
