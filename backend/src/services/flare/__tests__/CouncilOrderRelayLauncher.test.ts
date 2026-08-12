/**
 * CouncilOrderRelayLauncher — the shared start of every council-order relay.
 *
 * Pins the three behaviours the 2026-08-01 fix introduced:
 *  1. one launch per tx while relaying (a duplicate join never re-runs),
 *  2. "not validated yet" is a WAIT (bounded retries), not an error verdict,
 *  3. isCouncilOrderPayment detects the pinned order Payment and NEVER throws
 *     on an unset legacy stack (the /submitted report must not fail on it).
 */

const relayCouncilOrder = jest.fn();

class RelayAbort extends Error {}

jest.mock('../LegacyOrderRelayService', () => ({
  relayCouncilOrder: (...args: unknown[]) => relayCouncilOrder(...args),
  RelayAbort,
}));

// El almacén persistente del vigía: sin DB los helpers son no-op, así que se
// simulan para poder fijar QUÉ se recuerda y qué se olvida.
const kvRows: Record<string, unknown>[] = [];
jest.mock('../../persistence/backgroundJobKv', () => ({
  kvList: async () => kvRows.slice(),
  kvUpsert: async (_j: string, _f: string, key: string, payload: Record<string, unknown>) => {
    const i = kvRows.findIndex((r) => r.xrplTxHash === key);
    if (i >= 0) kvRows[i] = payload;
    else kvRows.push(payload);
  },
  kvDelete: async (_j: string, _f: string, key: string) => {
    const i = kvRows.findIndex((r) => r.xrplTxHash === key);
    if (i >= 0) kvRows.splice(i, 1);
  },
}));

import {
  getCouncilOrderRelayState,
  isCouncilOrderPayment,
  launchCouncilOrderRelay,
} from '../CouncilOrderRelayLauncher';

const HASH_A = 'A'.repeat(64);
const HASH_B = 'B'.repeat(64);
const HASH_C = 'C'.repeat(64);
const HASH_D = 'D'.repeat(64);
const HASH_E = 'E'.repeat(64);
const HASH_F = 'F'.repeat(64);
const HASH_G = '9'.repeat(64);

async function waitForState(hash: string, state: string, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (getCouncilOrderRelayState(hash)?.state === state) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`state never reached ${state}: ${JSON.stringify(getCouncilOrderRelayState(hash))}`);
}

describe('launchCouncilOrderRelay', () => {
  beforeEach(() => {
    relayCouncilOrder.mockReset();
    kvRows.length = 0;
  });

  it('recuerda la orden mientras no se entregue y la olvida al ejecutarse', async () => {
    relayCouncilOrder.mockResolvedValue({ stage: 'executed' });
    launchCouncilOrderRelay(HASH_F);
    await waitForState(HASH_F, 'executed');
    // Un momento para que el olvido (fire-and-forget) llegue al almacén.
    await new Promise((r) => setTimeout(r, 20));
    expect(kvRows.find((r) => r.xrplTxHash === HASH_F)).toBeUndefined();
  });

  it('una orden que falla SIGUE recordada — nadie tiene que pulsar nada', async () => {
    relayCouncilOrder.mockRejectedValue(new RelayAbort('the XRPL tx did not succeed (tecPATH_DRY)'));
    launchCouncilOrderRelay(HASH_G, undefined, { waitMs: 1 });
    await waitForState(HASH_G, 'error');
    await new Promise((r) => setTimeout(r, 20));
    expect(kvRows.find((r) => r.xrplTxHash === HASH_G)).toBeDefined();
  });

  it('launches once and lets a duplicate join, not re-run', async () => {
    let release: (v: unknown) => void = () => {};
    relayCouncilOrder.mockImplementation(() => new Promise((r) => (release = r)));

    expect(launchCouncilOrderRelay(HASH_A)).toEqual({ started: true, state: 'relaying' });
    expect(launchCouncilOrderRelay(HASH_A)).toEqual({ started: false, state: 'relaying' });
    await new Promise((r) => setTimeout(r, 20)); // the launch is fire-and-forget — let the dynamic import land
    expect(relayCouncilOrder).toHaveBeenCalledTimes(1);

    release({ stage: 'executed', flareTxHash: '0xfab' });
    await waitForState(HASH_A, 'executed');
    expect(getCouncilOrderRelayState(HASH_A)).toEqual({ state: 'executed', flareTxHash: '0xfab' });
  });

  it('retries a "not validated yet" abort until the ledger catches up', async () => {
    relayCouncilOrder
      .mockRejectedValueOnce(new RelayAbort('the XRPL tx is not validated yet — wait a few seconds and retry'))
      .mockResolvedValueOnce({ stage: 'executed' });

    launchCouncilOrderRelay(HASH_B, undefined, { waitMs: 1 });
    await waitForState(HASH_B, 'executed');
    expect(relayCouncilOrder).toHaveBeenCalledTimes(2);
  });

  it('the FDC verifier saying "TRANSACTION DOES NOT EXIST" is a WAIT — its index lags the ledger', async () => {
    // Incidente 2026-08-03: una orden validada a las 15:04 con sus 3 firmas fue
    // rechazada por el verifier a las 15:05 con esas palabras, y el relé se
    // rindió sobre una transacción que estaba en mainnet.
    relayCouncilOrder
      .mockRejectedValueOnce(
        new RelayAbort('verifier prepareRequest failed (200): {"status":"INVALID: TRANSACTION DOES NOT EXIST"}'),
      )
      .mockResolvedValueOnce({ stage: 'executed' });

    launchCouncilOrderRelay(HASH_E, undefined, { waitMs: 1 });
    await waitForState(HASH_E, 'executed');
    expect(relayCouncilOrder).toHaveBeenCalledTimes(2);
  });

  it('a terminal abort surfaces as the error state without retrying', async () => {
    relayCouncilOrder.mockRejectedValue(new RelayAbort('the XRPL tx did not succeed (tecPATH_DRY) — nothing to relay'));

    launchCouncilOrderRelay(HASH_C, undefined, { waitMs: 1 });
    await waitForState(HASH_C, 'error');
    expect(relayCouncilOrder).toHaveBeenCalledTimes(1);
    expect(getCouncilOrderRelayState(HASH_C)?.detail).toContain('tecPATH_DRY');
  });

  it('gives up after maxAttempts of not-validated', async () => {
    relayCouncilOrder.mockRejectedValue(new RelayAbort('the XRPL tx is not validated yet — wait a few seconds and retry'));

    launchCouncilOrderRelay(HASH_D, undefined, { waitMs: 1, maxAttempts: 3 });
    await waitForState(HASH_D, 'error');
    expect(relayCouncilOrder).toHaveBeenCalledTimes(3);
  });
});

describe('isCouncilOrderPayment', () => {
  const ANCHOR = 'rrrrrrrrrrrrrrrrrrrrrhoLvTp'; // ACCOUNT_ZERO — a valid classic address
  const MEMO = 'AB'.repeat(32);
  const order = {
    TransactionType: 'Payment',
    Destination: ANCHOR,
    Memos: [{ Memo: { MemoData: MEMO } }],
  };

  const env = process.env;
  beforeEach(() => {
    process.env = {
      ...env,
      LEGACY_CHAIN: 'flare',
      LEGACY_BRIDGE_ADDRESS: '0x02aE9fcB76768e42b8D3Ed9FE842238A6616b26F',
      LEGACY_VAULT_ADDRESS: '0xc8379c79779cCE3B738424892709fe0D4339E3b1',
      LEGACY_ORDER_ANCHOR: ANCHOR,
    };
  });
  afterEach(() => {
    process.env = env;
  });

  it('recognises the pinned order Payment (anchor + 32-byte memo)', () => {
    expect(isCouncilOrderPayment(order)).toBe(true);
  });

  it('rejects a Payment to any other destination', () => {
    expect(isCouncilOrderPayment({ ...order, Destination: 'rDNvpqSzJzk8Qx2oGmYzhFj7uRzAbfnFmA' })).toBe(false);
  });

  it('rejects a Payment without the 32-byte memo', () => {
    expect(isCouncilOrderPayment({ ...order, Memos: [] })).toBe(false);
    expect(isCouncilOrderPayment({ ...order, Memos: [{ Memo: { MemoData: 'AB12' } }] })).toBe(false);
  });

  it('rejects non-Payment transactions', () => {
    expect(isCouncilOrderPayment({ ...order, TransactionType: 'EscrowCreate' })).toBe(false);
  });

  it('answers false — never throws — when the legacy stack is unset', () => {
    delete process.env.LEGACY_ORDER_ANCHOR;
    expect(isCouncilOrderPayment(order)).toBe(false);
  });
});
