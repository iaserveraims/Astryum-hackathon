/**
 * classifyBridgeRevert — el veredicto del puente: NonceMismatch con el nonce por detrás
 * es caducada para siempre; por delante, esperar; cualquier otra cosa, otro error.
 */
import { classifyBridgeRevert, NONCE_MISMATCH_SELECTOR, RelayStale, RelayAbort } from '../LegacyOrderRelayService';

const word = (n: number) => n.toString(16).padStart(64, '0');

describe('classifyBridgeRevert', () => {
  it('Reads NonceMismatch(expected, actual) — the two orders stuck', () => {
    expect(classifyBridgeRevert(NONCE_MISMATCH_SELECTOR + word(3) + word(0))).toEqual({ kind: 'nonce-behind', expected: 3, actual: 0 });
    expect(classifyBridgeRevert(NONCE_MISMATCH_SELECTOR + word(1) + word(0))).toEqual({ kind: 'nonce-behind', expected: 1, actual: 0 });
  });

  it('an order ahead of the bridge is a wait, not a verdict', () => {
    expect(classifyBridgeRevert(NONCE_MISMATCH_SELECTOR + word(2) + word(4))).toEqual({ kind: 'nonce-ahead', expected: 2, actual: 4 });
  });

  it('anything else is «other»: no data, another selector, a truncated payload', () => {
    expect(classifyBridgeRevert(undefined)).toEqual({ kind: 'other' });
    expect(classifyBridgeRevert('0x12345678' + word(1) + word(0))).toEqual({ kind: 'other' });
    expect(classifyBridgeRevert(NONCE_MISMATCH_SELECTOR + word(1))).toEqual({ kind: 'other' });
  });

  it('the selector is keccak(NonceMismatch(uint64,uint64))', () => {
    const { ethers } = require('ethers');
    expect(ethers.id('NonceMismatch(uint64,uint64)').slice(0, 10)).toBe(NONCE_MISMATCH_SELECTOR);
  });

  it('RelayStale is a RelayAbort with the stale mark the watcher reads by shape', () => {
    const e = new RelayStale('behind', 3, 0);
    expect(e).toBeInstanceOf(RelayAbort);
    expect(e.stale).toBe(true);
    expect(e.expected).toBe(3);
    expect(e.actual).toBe(0);
  });
});
