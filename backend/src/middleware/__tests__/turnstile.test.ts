/**
 * Turnstile middleware — the captcha gate on credential-bearing POSTs.
 * Contract under test:
 *   · unset TURNSTILE_SECRET_KEY → transparent no-op (dev/tests need no network)
 *   · configured + missing token → 403 captcha_required, handler never runs
 *   · configured + Cloudflare says no → 403 captcha_failed
 *   · configured + Cloudflare says yes → next()
 *   · configured + Cloudflare unreachable → 503 captcha_unavailable (fail closed)
 */
import express from 'express';
import request from 'supertest';
import { requireTurnstile, turnstileEnabled, verifyTurnstileToken } from '../turnstile';

const ORIGINAL_SECRET = process.env.TURNSTILE_SECRET_KEY;
const realFetch = global.fetch;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/guarded', requireTurnstile(), (_req, res) => res.json({ reached: true }));
  return app;
}

afterEach(() => {
  global.fetch = realFetch;
  if (ORIGINAL_SECRET === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = ORIGINAL_SECRET;
});

function mockSiteverify(payload: unknown, opts: { reject?: boolean } = {}) {
  global.fetch = jest.fn(async () => {
    if (opts.reject) throw new Error('network down');
    return { json: async () => payload } as Response;
  }) as unknown as typeof fetch;
}

describe('requireTurnstile', () => {
  test('unset secret → no-op, request reaches the handler with no token at all', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(turnstileEnabled()).toBe(false);
    const res = await request(buildApp()).post('/guarded').send({});
    expect(res.status).toBe(200);
    expect(res.body.reached).toBe(true);
  });

  test('configured + missing token → 403 captcha_required, no network call', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret-under-test';
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const res = await request(buildApp()).post('/guarded').send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('captcha_required');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('configured + rejected token → 403 captcha_failed', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret-under-test';
    mockSiteverify({ success: false, 'error-codes': ['invalid-input-response'] });
    const res = await request(buildApp()).post('/guarded').send({ captchaToken: 'bad' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('captcha_failed');
  });

  test('configured + accepted token (from body) → handler runs', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret-under-test';
    mockSiteverify({ success: true });
    const res = await request(buildApp()).post('/guarded').send({ captchaToken: 'good' });
    expect(res.status).toBe(200);
    expect(res.body.reached).toBe(true);
  });

  test('configured + accepted token (x-captcha-token header fallback) → handler runs', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret-under-test';
    mockSiteverify({ success: true });
    const res = await request(buildApp()).post('/guarded').set('x-captcha-token', 'good').send({});
    expect(res.status).toBe(200);
  });

  test('Cloudflare unreachable → 503 captcha_unavailable (fail closed)', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret-under-test';
    mockSiteverify(null, { reject: true });
    const res = await request(buildApp()).post('/guarded').send({ captchaToken: 'whatever' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('captcha_unavailable');
  });
});

describe('verifyTurnstileToken', () => {
  test('posts the secret + token form-encoded to siteverify', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret-under-test';
    const fetchSpy = jest.fn(async () => ({ json: async () => ({ success: true }) }) as Response);
    global.fetch = fetchSpy as unknown as typeof fetch;
    const verdict = await verifyTurnstileToken('tok-123', '203.0.113.5');
    expect(verdict.ok).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('challenges.cloudflare.com/turnstile');
    expect(String(init.body)).toContain('response=tok-123');
    expect(String(init.body)).toContain('remoteip=203.0.113.5');
  });
});
