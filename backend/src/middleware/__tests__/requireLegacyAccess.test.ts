/**
 * requireLegacyAccess — the server-side half of the Legacy gate (§1.3).
 *
 * Pins the contract: fail-closed by default (no switch + no list ⇒ nobody,
 * unknown user ⇒ nobody, DB error ⇒ nobody); the global switch opens without
 * a DB read; a listed email passes; an unlisted one gets a structured 403.
 */

const findUnique = jest.fn();
jest.mock('../../database/prismaClient', () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));

import type { Request, Response } from 'express';
import { requireLegacyAccess, __resetLegacyAccessGateForTests } from '../requireLegacyAccess';
import { _resetLegacyAccessCache } from '../../config/legacyAccess';

function run(userId?: string) {
  const req = { siwe: userId ? { userId } : undefined } as unknown as Request;
  let statusCode = 0;
  let body: unknown = null;
  let nexted = false;
  const res = {
    status: (c: number) => {
      statusCode = c;
      return { json: (b: unknown) => void (body = b) };
    },
  } as unknown as Response;
  const done = requireLegacyAccess(req, res, () => void (nexted = true));
  return done.then(() => ({ statusCode, body, nexted }));
}

describe('requireLegacyAccess', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env };
    delete process.env.LEGACY_ENABLED;
    delete process.env.LEGACY_ACCESS_EMAILS;
    delete process.env.ALLOW_NO_AUTH;
    findUnique.mockReset();
    __resetLegacyAccessGateForTests();
    _resetLegacyAccessCache();
  });
  afterEach(() => {
    process.env = env;
  });

  it('fail-closed: no switch and no list ⇒ 403 even for a known user', async () => {
    findUnique.mockResolvedValue({ email: 'familia@example.com' });
    const r = await run('u1');
    expect(r.nexted).toBe(false);
    expect(r.statusCode).toBe(403);
    expect((r.body as { error: string }).error).toBe('LEGACY_ACCESS_REQUIRED');
  });

  it('the global switch opens without touching the users table', async () => {
    process.env.LEGACY_ENABLED = 'true';
    const r = await run('u1');
    expect(r.nexted).toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('a listed email passes; an unlisted one gets 403', async () => {
    process.env.LEGACY_ACCESS_EMAILS = 'Familia@Example.com';
    findUnique.mockResolvedValueOnce({ email: 'familia@example.com' });
    expect((await run('u1')).nexted).toBe(true);
    __resetLegacyAccessGateForTests();
    findUnique.mockResolvedValueOnce({ email: 'otro@example.com' });
    expect((await run('u2')).statusCode).toBe(403);
  });

  it('no session ⇒ 401; unknown user ⇒ 403; DB error ⇒ 403 (never open)', async () => {
    process.env.LEGACY_ACCESS_EMAILS = 'familia@example.com';
    expect((await run(undefined)).statusCode).toBe(401);
    findUnique.mockResolvedValueOnce(null);
    expect((await run('u3')).statusCode).toBe(403);
    __resetLegacyAccessGateForTests();
    findUnique.mockRejectedValueOnce(new Error('db down'));
    expect((await run('u4')).statusCode).toBe(403);
  });

  it('caches the email lookup inside the TTL', async () => {
    process.env.LEGACY_ACCESS_EMAILS = 'familia@example.com';
    findUnique.mockResolvedValue({ email: 'familia@example.com' });
    await run('u5');
    await run('u5');
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
