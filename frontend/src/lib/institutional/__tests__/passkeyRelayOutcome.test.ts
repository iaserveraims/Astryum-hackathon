import { describe, expect, it } from 'vitest';
import {
  passkeyRelayFailureAction,
  passkeyRelayRefusal,
  relayNeverBroadcast,
} from '../passkeyRelayOutcome';

/**
 * The client's exit in the demo exchange (one Face ID → relay) printed every
 * failure as a red line beside the same «Take out everything» button — a second
 * exit one tap away when the relay had already broadcast the first. Only the
 * relay's own pre-broadcast refusals may keep that button.
 */

const en = (s: string) => s;

describe('passkeyRelayRefusal', () => {
  it('keeps the message the hook always threw', () => {
    expect(passkeyRelayRefusal({ status: 409, error: 'WOULD_REVERT', detail: 'execution reverted' }).message).toBe(
      'WOULD_REVERT — execution reverted',
    );
    expect(passkeyRelayRefusal({ status: 500, error: 'RELAY_FAILED' }).message).toBe('RELAY_FAILED');
  });
});

describe('relayNeverBroadcast', () => {
  it('validation (400) and the preflight (409) prove nothing was broadcast', () => {
    expect(relayNeverBroadcast(passkeyRelayRefusal({ status: 400, error: 'TARGET_NOT_ALLOWED' }))).toBe(true);
    expect(relayNeverBroadcast(passkeyRelayRefusal({ status: 409, error: 'WOULD_REVERT' }))).toBe(true);
  });

  it('no session (401) and the deploy cap (429) are answered before any broadcast', () => {
    // The route answers 401 missing_siwe_session before
    // relayPasskeyBatch runs, and DEPLOY_LIMIT (429) is checked before sending.
    expect(relayNeverBroadcast(passkeyRelayRefusal({ status: 401, error: 'missing_siwe_session' }))).toBe(true);
    expect(relayNeverBroadcast(passkeyRelayRefusal({ status: 429, error: 'DEPLOY_LIMIT' }))).toBe(true);
  });

  it('a 500, a 503, a proxy 5xx or a dropped connection prove nothing', () => {
    expect(relayNeverBroadcast(passkeyRelayRefusal({ status: 500, error: 'RELAY_FAILED' }))).toBe(false);
    expect(relayNeverBroadcast(passkeyRelayRefusal({ status: 503, error: 'HTTP 503' }))).toBe(false);
    expect(relayNeverBroadcast(passkeyRelayRefusal({ status: 502, error: 'HTTP 502' }))).toBe(false);
    expect(relayNeverBroadcast(passkeyRelayRefusal({ status: 504, error: 'HTTP 504' }))).toBe(false);
    expect(relayNeverBroadcast(new TypeError('Failed to fetch'))).toBe(false);
    expect(relayNeverBroadcast(Object.assign(new Error('x'), { status: 409 }))).toBe(false);
    // Without the relay's code a 401/429 is somebody else's answer: proves nothing.
    expect(relayNeverBroadcast(Object.assign(new Error('x'), { status: 401 }))).toBe(false);
    expect(relayNeverBroadcast(Object.assign(new Error('x'), { status: 429 }))).toBe(false);
  });
});

describe('passkeyRelayFailureAction', () => {
  it('before the hand-off (Face ID cancelled, account unreadable) the button stays', () => {
    const cancelled = Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' });
    expect(passkeyRelayFailureAction(cancelled, false, en).view).toBe('review');
    expect(passkeyRelayFailureAction(new TypeError('Failed to fetch'), false, en).view).toBe('review');
  });

  it('after the hand-off, a pre-broadcast refusal keeps the button', () => {
    const a = passkeyRelayFailureAction(passkeyRelayRefusal({ status: 409, error: 'WOULD_REVERT' }), true, en);
    expect(a.view).not.toBe('unconfirmed');
    for (const status of [401, 429]) {
      const b = passkeyRelayFailureAction(passkeyRelayRefusal({ status, error: 'REFUSED' }), true, en);
      expect(b.view).not.toBe('unconfirmed');
    }
  });

  it('after the hand-off, anything else is unconfirmed — never a second Face ID', () => {
    for (const e of [
      passkeyRelayRefusal({ status: 500, error: 'RELAY_FAILED', detail: 'timeout waiting for receipt' }),
      new TypeError('Failed to fetch'),
    ]) {
      expect(passkeyRelayFailureAction(e, true, en).view).toBe('unconfirmed');
    }
  });
});
