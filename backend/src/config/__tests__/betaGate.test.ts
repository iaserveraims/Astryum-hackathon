/**
 * betaGate — DEFAULT OPEN, and it
 * guards CREATION only.
 *
 * The contract flipped: only the literal 'false' closes registration.
 * Closed-mode behaviour (waitlist approval as the only door) is unchanged
 * and still tested below — the founder can raise the wall again with one env.
 */
import { isBetaRegistrationOpen, isEmailApproved, assertSignupAllowed } from '../betaGate';

const findUnique = jest.fn();
jest.mock('../../database/prismaClient', () => ({
  prisma: { waitlistSignup: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}));

const ENV = process.env;
beforeEach(() => {
  findUnique.mockReset();
  process.env = { ...ENV };
  delete process.env.BETA_REGISTRATION_OPEN;
});
afterAll(() => {
  process.env = ENV;
});

describe('BetaGate — BETA_REGISTRATION_OPEN is DEFAULT OPEN', () => {
  it('unset ⇒ open (the closed-beta phase ended; deploying opens public registration)', () => {
    expect(isBetaRegistrationOpen()).toBe(true);
  });

  it("only the literal 'false' closes registration (case-insensitive, trimmed)", () => {
    for (const off of ['false', 'FALSE', ' False ']) {
      process.env.BETA_REGISTRATION_OPEN = off;
      expect(isBetaRegistrationOpen()).toBe(false);
    }
  });

  it('any other value reads as OPEN (true, legacy spellings, typos)', () => {
    for (const on of ['true', '1', 'yes', 'on', '', '   ', 'flase']) {
      process.env.BETA_REGISTRATION_OPEN = on;
      expect(isBetaRegistrationOpen()).toBe(true);
    }
  });
});

describe('betaGate — assertSignupAllowed', () => {
  it('open switch ⇒ any identity may sign up, and the DB is never consulted', async () => {
    process.env.BETA_REGISTRATION_OPEN = 'true';
    await expect(assertSignupAllowed('anyone@example.com')).resolves.toBeUndefined();
    await expect(assertSignupAllowed(null)).resolves.toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('closed + approved waitlist email ⇒ allowed (normalised before lookup)', async () => {
    process.env.BETA_REGISTRATION_OPEN = 'false';
    findUnique.mockResolvedValue({ approvedAt: new Date() });
    await expect(assertSignupAllowed('  Approved@Example.ORG ')).resolves.toBeUndefined();
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'approved@example.org' } }),
    );
  });

  it('closed + waitlisted-but-not-approved ⇒ not_invited (being on the list is not a seat)', async () => {
    process.env.BETA_REGISTRATION_OPEN = 'false';
    findUnique.mockResolvedValue({ approvedAt: null });
    await expect(assertSignupAllowed('waiting@example.org')).rejects.toMatchObject({ code: 'not_invited' });
  });

  it('closed + unknown email ⇒ not_invited', async () => {
    process.env.BETA_REGISTRATION_OPEN = 'false';
    findUnique.mockResolvedValue(null);
    await expect(assertSignupAllowed('stranger@example.org')).rejects.toMatchObject({ code: 'not_invited' });
    expect(await isEmailApproved('stranger@example.org')).toBe(false);
  });

  it('closed + wallet-first (no email) ⇒ not_invited — a new wallet cannot mint an account', async () => {
    process.env.BETA_REGISTRATION_OPEN = 'false';
    await expect(assertSignupAllowed(null)).rejects.toMatchObject({ code: 'not_invited' });
    await expect(assertSignupAllowed(undefined)).rejects.toMatchObject({ code: 'not_invited' });
    // No email means nothing to look up — the DB must not be touched.
    expect(findUnique).not.toHaveBeenCalled();
  });
});
