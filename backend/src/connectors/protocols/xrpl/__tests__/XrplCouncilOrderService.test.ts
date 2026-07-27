/**
 * Council orders — the commitment the quorum signs. These pin the byte-level
 * contract with the bridge: orderData layout, memo derivation, and the Payment
 * shape (1 drop, SourceTag, 32-byte memo). If any of this drifts, orders stop
 * matching on-chain — so it is tested at the encoding level, deterministically.
 */
import { ethers } from 'ethers';
import { _resetXrplSourceTagCache } from '../../../../config/xrplSourceTag';
import { encodeCouncilOrder, buildOrderPaymentTx, resolveOrderFee } from '../XrplCouncilOrderService';

const REF = '0x' + 'ab'.repeat(32);
const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const ANCHOR = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';

const TAG = 2607090002;
const ORIGINAL = process.env.XRPL_SOURCE_TAG;
beforeEach(() => {
  process.env.XRPL_SOURCE_TAG = String(TAG);
  _resetXrplSourceTagCache();
});
afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.XRPL_SOURCE_TAG;
  else process.env.XRPL_SOURCE_TAG = ORIGINAL;
  _resetXrplSourceTagCache();
});

describe('encodeCouncilOrder — the committed bytes', () => {
  it('encodes direct-to and derives the memo from keccak256(orderData)', () => {
    const o = encodeCouncilOrder('direct-to', { venueId: 0, amount: '60000000000' }, REF, 0);
    // orderData = abi.encode(uint64 nonce, bytes calldata) — decode round-trips.
    const [nonce, calldata] = ethers.AbiCoder.defaultAbiCoder().decode(['uint64', 'bytes'], o.orderData);
    expect(Number(nonce)).toBe(0);
    expect(calldata).toBe(o.vaultCalldata);
    expect(o.orderHash).toBe(ethers.keccak256(o.orderData));
    expect(o.memoHex).toBe(o.orderHash.slice(2).toUpperCase());
    expect(o.memoHex).toHaveLength(64);
    // The calldata targets directTo(venueId, amount, ref).
    const iface = new ethers.Interface(['function directTo(uint256,uint256,bytes32)']);
    const dec = iface.decodeFunctionData('directTo', o.vaultCalldata);
    expect(Number(dec[0])).toBe(0);
    expect(dec[1]).toBe(60000000000n);
    expect(dec[2]).toBe(REF);
  });

  it('is deterministic: same inputs, same hash (the quorum signs a stable commitment)', () => {
    const a = encodeCouncilOrder('evacuate', { venueId: 2 }, REF, 7);
    const b = encodeCouncilOrder('evacuate', { venueId: 2 }, REF, 7);
    expect(a.orderHash).toBe(b.orderHash);
    // A different nonce is a DIFFERENT commitment.
    const c = encodeCouncilOrder('evacuate', { venueId: 2 }, REF, 8);
    expect(c.orderHash).not.toBe(a.orderHash);
  });

  it('encodes set-payees arrays (any complexity fits behind one 32-byte memo)', () => {
    const o = encodeCouncilOrder(
      'set-payees',
      { payees: [{ account: '0x' + '11'.repeat(20), bps: 6000 }, { account: '0x' + '22'.repeat(20), bps: 4000 }] },
      REF,
      3,
    );
    const iface = new ethers.Interface(['function setPayees(address[],uint16[],bytes32)']);
    const dec = iface.decodeFunctionData('setPayees', o.vaultCalldata);
    expect(dec[0]).toHaveLength(2);
    expect(Number(dec[1][0])).toBe(6000);
  });

  it('cede converts the ISO date to unix seconds', () => {
    const until = '2027-01-01T00:00:00.000Z';
    const o = encodeCouncilOrder('cede', { director: '0x' + '33'.repeat(20), untilISO: until }, REF, 1);
    const iface = new ethers.Interface(['function cede(address,uint64,bytes32)']);
    const dec = iface.decodeFunctionData('cede', o.vaultCalldata);
    expect(Number(dec[1])).toBe(Math.floor(Date.parse(until) / 1000));
  });

  it('rejects garbage: unknown action, bad ref, negative amounts, past cession dates', () => {
    expect(() => encodeCouncilOrder('withdraw-principal' as never, {}, REF, 0)).toThrow(/unknown/);
    expect(() => encodeCouncilOrder('evacuate', { venueId: 0 }, '0x1234', 0)).toThrow(/bytes32/);
    expect(() => encodeCouncilOrder('direct-to', { venueId: 0, amount: '-5' }, REF, 0)).toThrow();
    expect(() => encodeCouncilOrder('cede', { director: '0x' + '33'.repeat(20), untilISO: '2020-01-01' }, REF, 0)).toThrow(/future/);
  });
});

describe('buildOrderPaymentTx — the 1-drop carrier', () => {
  const MEMO = 'A'.repeat(64);

  it('composes the ceremonial Payment: 1 drop, SourceTag, one 32-byte memo', () => {
    const tx = buildOrderPaymentTx(COUNCIL, ANCHOR, MEMO);
    expect(tx.TransactionType).toBe('Payment');
    expect(tx.Account).toBe(COUNCIL);
    expect(tx.Destination).toBe(ANCHOR);
    expect(tx.Amount).toBe('1');
    expect(tx.SourceTag).toBe(TAG);
    expect((tx.Memos as Array<{ Memo: { MemoData: string } }>)[0].Memo.MemoData).toBe(MEMO);
  });

  it('refuses self-payment (XRPL rule) and malformed memos/addresses', () => {
    expect(() => buildOrderPaymentTx(COUNCIL, COUNCIL, MEMO)).toThrow(/self-payment/);
    expect(() => buildOrderPaymentTx(COUNCIL, ANCHOR, 'abc')).toThrow(/32 bytes/);
    expect(() => buildOrderPaymentTx('not-an-address', ANCHOR, MEMO)).toThrow(/valid XRPL/);
  });

  it('carries the fee amount when priced, and rejects a non-positive drops amount', () => {
    const tx = buildOrderPaymentTx(COUNCIL, ANCHOR, MEMO, '500001'); // 1 drop + 0.5 XRP
    expect(tx.Amount).toBe('500001');
    expect(() => buildOrderPaymentTx(COUNCIL, ANCHOR, MEMO, '0')).toThrow(/positive integer drops/);
  });
});

describe('resolveOrderFee — the fixed service fee (never charity)', () => {
  const SAVED = { enabled: process.env.LEGACY_ORDER_FEE_ENABLED, xrp: process.env.LEGACY_ORDER_FEE_XRP };
  afterEach(() => {
    if (SAVED.enabled === undefined) delete process.env.LEGACY_ORDER_FEE_ENABLED;
    else process.env.LEGACY_ORDER_FEE_ENABLED = SAVED.enabled;
    if (SAVED.xrp === undefined) delete process.env.LEGACY_ORDER_FEE_XRP;
    else process.env.LEGACY_ORDER_FEE_XRP = SAVED.xrp;
  });

  it('off by default → 1 drop, no fee (a founder vessel pays nothing)', () => {
    delete process.env.LEGACY_ORDER_FEE_ENABLED;
    expect(resolveOrderFee()).toEqual({ enabled: false, feeXrp: '0', amountDrops: '1' });
  });

  it('on → amount is 1 drop + the fixed fee, in drops', () => {
    process.env.LEGACY_ORDER_FEE_ENABLED = 'true';
    process.env.LEGACY_ORDER_FEE_XRP = '0.5';
    expect(resolveOrderFee()).toEqual({ enabled: true, feeXrp: '0.5', amountDrops: '500001' });
    process.env.LEGACY_ORDER_FEE_XRP = '2';
    expect(resolveOrderFee().amountDrops).toBe('2000001');
  });

  it('enabled but misconfigured fee = throws (fails loud, never charges 0 silently)', () => {
    process.env.LEGACY_ORDER_FEE_ENABLED = 'true';
    for (const bad of ['', '0', '-1', 'abc', '0.1234567']) {
      process.env.LEGACY_ORDER_FEE_XRP = bad;
      expect(() => resolveOrderFee()).toThrow(/positive XRP amount/);
    }
  });
});
