/**
 * productizer it. 16 (4.1) — the last two authority writes that were still
 * outside `withLiveSession`.
 *
 *  · the Anthropic key (`UserAnthropicKey`): it decides WHOSE account receives
 *    the copilot's prompts — the owner's portfolio, their addresses, the text
 *    they type at it. `validateKey` is a network round-trip to Anthropic before
 *    the write, so the window a takeover has is wide.
 *  · the step-up lock matrix (`StepUpLockConfig`): it decides which of the
 *    owner's features demand a fresh wallet signature. An intruder's matrix
 *    either disarms their protections or arms `wallet_security:write` so they
 *    cannot put them back.
 *
 * Both now write inside a transaction that first proves the session is still
 * live, and both refuse with `session_revoked` and write nothing.
 */

const keyUpsert = jest.fn();
const lockUpsert = jest.fn();

const live = {
  userRows: 1,
  user: null as unknown,
  session: null as unknown,
};
function resetLive() {
  live.userRows = 1;
  live.user = { isActive: true, preferences: null };
  live.session = {
    id: 's1',
    userId: 'u1',
    isActive: true,
    createdAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 3_600_000),
  };
}
resetLive();

jest.mock('../../database/prismaClient', () => {
  const client: Record<string, unknown> = {
    userAnthropicKey: { upsert: (...a: unknown[]) => keyUpsert(...a) },
    stepUpLockConfig: {
      upsert: (...a: unknown[]) => lockUpsert(...a),
      // No stored row: getConfig falls back to the default (everything off).
      findUnique: async () => null,
    },
    user: {
      updateMany: async () => ({ count: live.userRows }),
      findUnique: async () => live.user,
    },
    session: { findUnique: async () => live.session },
  };
  client.$transaction = async (fn: (tx: unknown) => unknown) => fn(client);
  return { prisma: client };
});

import { agentKeyService } from '../AgentKeyService';
import { __resetStepUpCacheForTests, forgetStepUpConfig, getConfig, setConfig } from '../StepUpLockService';
import { isSessionRevoked } from '../identity/liveSession';

const SESSION = { userId: 'u1', sessionId: 's1' };

const KILLS: [string, () => void][] = [
  ['the session was revoked', () => { (live.session as { isActive: boolean }).isActive = false; }],
  ['the account was quarantined', () => { live.user = { isActive: false, preferences: null }; }],
  ['the session belongs to another account', () => { (live.session as { userId: string }).userId = 'intruder'; }],
  ['the session predates the credential epoch', () => {
    const epoch = new Date().toISOString();
    live.user = { isActive: true, preferences: { security: { credentialsEpoch: epoch, takeoverAt: epoch } } };
    (live.session as { createdAt: Date }).createdAt = new Date(Date.now() - 3_600_000);
  }],
];

beforeEach(() => {
  resetLive();
  keyUpsert.mockReset();
  keyUpsert.mockResolvedValue({ userId: 'u1' });
  lockUpsert.mockReset();
  lockUpsert.mockImplementation(async ({ create }: any) => ({
    enabled: create.enabled,
    grantTtlSeconds: create.grantTtlSeconds,
    matrix: create.matrix,
  }));
  __resetStepUpCacheForTests();
});

describe('AgentKeyService.saveUserAPIKey', () => {
  it('writes while the session is live', async () => {
    await agentKeyService.saveUserAPIKey('u1', 'sk-ant-whatever', 'claude-sonnet-4-6', SESSION);
    expect(keyUpsert).toHaveBeenCalledTimes(1);
    // The key is encrypted at rest either way — never the plaintext.
    expect(JSON.stringify(keyUpsert.mock.calls[0][0])).not.toContain('sk-ant-whatever');
  });

  it.each(KILLS)('refuses when %s — the intruder\'s key never lands', async (_label, kill) => {
    kill();
    const err = await agentKeyService
      .saveUserAPIKey('u1', 'sk-ant-intruder', undefined, SESSION)
      .then(() => null, (e) => e);
    expect(isSessionRevoked(err)).toBe(true);
    expect(keyUpsert).not.toHaveBeenCalled();
  });

  // ── it. 19 (it. 18, 3.2) — OPTIONAL IS NOT A GUARD ────────────────────────
  //
  // This test used to assert the opposite: «without a session reference the
  // write is unguarded (callers that have one must pass it)». That sentence
  // describes the hole, and pinning it made the hole correct — the next caller
  // omits the argument and writes authority with no check, in silence and
  // without a compile error. The reference is now required, and a falsy one is
  // a refusal rather than a free pass.
  it.each([[undefined], [null], [{ userId: 'u1', sessionId: '' }]])(
    'refuses when the session reference is %p — there is no unguarded path left',
    async (session) => {
      (live.session as { isActive: boolean }).isActive = false;
      const err = await agentKeyService
        .saveUserAPIKey('u1', 'sk-ant-legacy', undefined, session as never)
        .then(() => null, (e) => e);
      expect(isSessionRevoked(err)).toBe(true);
      expect(keyUpsert).not.toHaveBeenCalled();
    },
  );
});

describe('StepUpLockService.setConfig', () => {
  it('writes while the session is live', async () => {
    const config = await setConfig('u1', { enabled: true }, SESSION);
    expect(config.enabled).toBe(true);
    expect(lockUpsert).toHaveBeenCalledTimes(1);
  });

  it.each(KILLS)('refuses when %s — the matrix is untouched', async (_label, kill) => {
    kill();
    const err = await setConfig('u1', { enabled: true }, SESSION).then(() => null, (e) => e);
    expect(isSessionRevoked(err)).toBe(true);
    expect(lockUpsert).not.toHaveBeenCalled();
  });

  it.each([[undefined], [null], [{ userId: 'u1', sessionId: '' }]])(
    'refuses when the session reference is %p — there is no unguarded path left',
    async (session) => {
      const err = await setConfig('u1', { enabled: true }, session as never).then(() => null, (e) => e);
      expect(isSessionRevoked(err)).toBe(true);
      expect(lockUpsert).not.toHaveBeenCalled();
    },
  );

  it('a refused write leaves nothing cached either', async () => {
    (live.session as { isActive: boolean }).isActive = false;
    await setConfig('u1', { enabled: true }, SESSION).catch(() => undefined);
    // Falls through to the row (none) → the default, not the refused patch.
    lockUpsert.mockClear();
    const config = await getConfig('u1');
    expect(config.enabled).toBe(false);
  });
});

/**
 * productizer it. 18 (3.7) — THE REFUSAL MUST NOT BE THE PUNISHMENT.
 *
 * `PUT /api/security/step-up/config` is called by a client that signs the user
 * out on ANY 401 (the client half is fixed separately). The backend's side of
 * the contract: the body always carries `error: 'session_revoked'` and an
 * English `detail` that says the locks were not touched, so the screen can show
 * it in place instead of the client guessing «your login is gone». And a write
 * that merely lost the race against the takeover answers 503, not 401 and not
 * 500 — a wait must never read as a logout.
 */
describe('PUT /config — the 401 body, and a busy write that is not a 401 at all', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const express = require('express');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const request = require('supertest');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const router = require('../../routes/securityStepUp').default;

  const app = express();
  app.use(express.json());
  app.use((req: { siwe: unknown }, _res: unknown, next: () => void) => {
    req.siwe = SESSION;
    next();
  });
  app.use('/api/security/step-up', router);

  it('a revoked session answers 401 session_revoked with an English detail, and changes nothing', async () => {
    (live.session as { isActive: boolean }).isActive = false;
    const res = await request(app).put('/api/security/step-up/config').send({ enabled: true });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('session_revoked');
    expect(res.body.detail).toMatch(/step-up locks were NOT changed/);
    expect(lockUpsert).not.toHaveBeenCalled();
  });

  it('losing the race against the takeover is 503 ACCOUNT_BUSY — never a 401, never a 500', async () => {
    lockUpsert.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Transaction API error: Transaction already closed'), { code: 'P2028' });
    });
    const res = await request(app).put('/api/security/step-up/config').send({ enabled: true });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'ACCOUNT_BUSY', retryable: true });
  });
});

describe('forgetStepUpConfig — the takeover drops the intruder\'s matrix from memory', () => {
  it('a cached matrix is not served after the handover', async () => {
    await setConfig('u1', { enabled: true, matrix: { wallet_security: { read: false, write: true } } }, SESSION);
    expect((await getConfig('u1')).enabled).toBe(true); // served from cache

    // The takeover moved the row to the quarantine account; this process must
    // stop serving what it remembers of it.
    forgetStepUpConfig('u1');
    expect((await getConfig('u1')).enabled).toBe(false);
  });
});
