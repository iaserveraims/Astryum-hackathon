/**
 * Waitlist noise blocklist (founder 2026-07-23 — the panel was flooded with
 * bot signups against the public POST). Two things under test:
 *
 *   1. `isNoiseEmail` — the pure predicate, exercised directly against the
 *      RFC 2606/6761 reserved domains + the disposable-domain list.
 *   2. POST /api/waitlist — a noisy email is rejected with the SAME 400
 *      invalid_email shape as a malformed one (no signal to the bot that it
 *      hit a blocklist specifically), and never reaches prisma.create.
 */
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockCreate = jest.fn();

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    waitlistSignup: {
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
      create: (...a: unknown[]) => mockCreate(...a),
    },
  },
}));

// The route fires a confirmation mail (fire-and-forget) on real signups —
// stub the mailer so no test touches SMTP/Resend.
const mockSendWaitlistWelcome = jest.fn();
jest.mock('../../services/waitlistMailer', () => ({
  sendWaitlistWelcome: (...a: unknown[]) => mockSendWaitlistWelcome(...a),
  mailerDiag: jest.fn(),
  verifyMailer: jest.fn(),
  testSend: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import waitlistRouter, { isNoiseEmail } from '../waitlist';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/waitlist', waitlistRouter);
  return app;
}

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpdate.mockReset();
  mockCreate.mockReset();
  mockSendWaitlistWelcome.mockReset();
});

describe('isNoiseEmail', () => {
  it.each([
    'bot@example.com',
    'bot@example.org',
    'bot@example.net',
    'bot@example.io', // example.* — reserved second-level label under any tld
    'bot@sub.example.com',
    'bot@foo.example', // *.example — reserved tld
    'bot@foo.test',
    'bot@foo.invalid',
    'bot@foo.localhost',
    'bot@localhost', // bare reserved tld, no second label
    'spam@mailinator.com',
    'spam@guerrillamail.com',
    'spam@sharklasers.com',
    'spam@yopmail.com',
    'spam@10minutemail.com',
    'spam@tempmail.com',
    'spam@trashmail.com',
    'SPAM@MAILINATOR.COM', // case-insensitive
  ])('flags %s as noise', (email) => {
    expect(isNoiseEmail(email)).toBe(true);
  });

  it.each([
    'founder@astryum.xyz',
    'real.person@gmail.com',
    'someone@protonmail.com',
    'name@example-startup.com', // "example" as a substring, not the sld itself
    'name@myexample.com',
  ])('does not flag %s as noise', (email) => {
    expect(isNoiseEmail(email)).toBe(false);
  });
});

describe('POST /api/waitlist — noise rejection', () => {
  it('rejects a reserved-domain email with 400 invalid_email, same shape as a malformed one', async () => {
    const res = await request(buildApp()).post('/api/waitlist').send({ email: 'bot@example.com' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'invalid_email' });
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects a disposable-domain email with 400 invalid_email, never touches storage', async () => {
    const res = await request(buildApp()).post('/api/waitlist').send({ email: 'spam@mailinator.com' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'invalid_email' });
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('a real signup still passes through to storage untouched', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'w1' });
    const res = await request(buildApp())
      .post('/api/waitlist')
      .send({ email: 'founder@astryum.xyz', source: 'early-access', lang: 'en' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockCreate).toHaveBeenCalledWith({
      data: { email: 'founder@astryum.xyz', source: 'early-access', lang: 'en' },
    });
  });
});

describe('POST /api/waitlist — honeypot', () => {
  it('a filled "website" field gets a fake success and stores NOTHING', async () => {
    const res = await request(buildApp())
      .post('/api/waitlist')
      // Own IP bucket so this test never shares the module-level rate limit.
      .set('x-forwarded-for', '203.0.113.77')
      .send({ email: 'looks-real@gmail.com', website: 'https://spam.example' });
    // Same shape as a real signup — the bot learns nothing.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSendWaitlistWelcome).not.toHaveBeenCalled();
  });

  it('an empty honeypot (real humans) does not interfere with the signup', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'w2' });
    const res = await request(buildApp())
      .post('/api/waitlist')
      .set('x-forwarded-for', '203.0.113.78')
      .send({ email: 'human@gmail.com', website: '' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockCreate).toHaveBeenCalled();
  });
});
