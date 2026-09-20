import { describe, expect, it } from 'vitest';
import { gateMode, gateOpenFlag, signGateToken, verifyGateToken } from '../accessGate';

// The launch switch has one job and it failed it once: the six
// gold CTAs of the landing were repointed at /login (the gated door) while
// ACCESS_GATE_OPEN was never seeded on Vercel, so every visitor without the
// week-old cookie was bounced home in silence. These pin the spellings a human
// actually types, so the same switch cannot be "set" and still be off.
describe('gateOpenFlag', () => {
  it('accepts the spellings a dashboard user types', () => {
    for (const v of ['1', 'true', 'TRUE', ' True ', 'yes', 'on']) {
      expect(gateOpenFlag(v), v).toBe(true);
    }
  });

  it('rejects anything that is not an affirmative', () => {
    for (const v of [undefined, '', '  ', '0', 'false', 'no', 'off', 'open']) {
      expect(gateOpenFlag(v), String(v)).toBe(false);
    }
  });
});

describe('GateMode — DEFAULT OPEN (the pre-launch curtain retired)', () => {
  const configured = { code: 'hunter2', secret: 'sshh', nodeEnv: 'production' };

  it('opens by default — unset or affirmative, with or without config', () => {
    expect(gateMode({ ...configured })).toBe('open');
    expect(gateMode({ open: '1', ...configured })).toBe('open');
    expect(gateMode({ open: 'true', ...configured })).toBe('open');
    expect(gateMode({ nodeEnv: 'production' })).toBe('open');
    expect(gateMode({ nodeEnv: 'development' })).toBe('open');
  });

  it('an explicit close spelling + code/secret ⇒ enforced (the cookie gate returns)', () => {
    for (const off of ['0', 'false', 'no', 'off']) {
      expect(gateMode({ open: off, ...configured })).toBe('enforced');
    }
  });

  it('an explicit close WITHOUT config fails closed in production, open in dev', () => {
    expect(gateMode({ open: 'false', nodeEnv: 'production' })).toBe('closed');
    expect(gateMode({ open: 'false', nodeEnv: 'development' })).toBe('open');
    // Half-configured is not configured — a secret without a code cannot verify.
    expect(gateMode({ open: 'false', secret: 'sshh', nodeEnv: 'production' })).toBe('closed');
  });

  it('a typo is NOT a close — only the four explicit spellings raise the wall', () => {
    expect(gateMode({ open: 'flase', ...configured })).toBe('open');
    expect(gateMode({ open: 'closed', ...configured })).toBe('open');
  });
});

describe('gate token', () => {
  it('round-trips a live token and refuses a tampered or expired one', async () => {
    const secret = 'test-secret';
    const expiresAtMs = Date.now() + 60_000;
    const token = await signGateToken(secret, expiresAtMs);

    expect(await verifyGateToken(secret, token)).toEqual({ valid: true, expiresAtMs });
    expect((await verifyGateToken('other-secret', token)).valid).toBe(false);
    expect((await verifyGateToken(secret, undefined)).valid).toBe(false);
    expect((await verifyGateToken(secret, await signGateToken(secret, Date.now() - 1))).valid).toBe(false);
  });
});
