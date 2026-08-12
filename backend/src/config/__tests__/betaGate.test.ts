/**
 * betaGate — the closed beta's door is FAIL-CLOSED and guards CREATION only.
 *
 * The stakes (2026-08-01): the public X post says "Closed beta", the Make
 * Waves posture leans on a real limited pilot, and the founders open on 08-06
 * by approving waitlist emails. A typo'd env that silently OPENED registration
 * would falsify all three — so absence/typo must read as CLOSED, and only an
 * approved waitlist email (or the literal 'true' switch) may mint an account.
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

describe('betaGate — BETA_REGISTRATION_OPEN is FAIL-CLOSED', () => {
  it('unset ⇒ closed (deploying the gate closes public registration, nothing to configure wrong)', () => {
    expect(isBetaRegistrationOpen()).toBe(false);
  });

  it("only the literal 'true' opens registration (case-insensitive, trimmed)", () => {
    for (const on of ['true', 'TRUE', ' True ']) {
      process.env.BETA_REGISTRATION_OPEN = on;
      expect(isBetaRegistrationOpen()).toBe(true);
    }
  });

  it('malformed values read as CLOSED (absence/typo ≠ open)', () => {
    for (const bad of ['false', '1', 'yes', 'on', '', '   ', 'ture']) {
      process.env.BETA_REGISTRATION_OPEN = bad;
      expect(isBetaRegistrationOpen()).toBe(false);
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
    findUnique.mockResolvedValue({ approvedAt: new Date() });
    await expect(assertSignupAllowed('  Approved@Example.ORG ')).resolves.toBeUndefined();
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'approved@example.org' } }),
    );
  });

  it('closed + waitlisted-but-not-approved ⇒ not_invited (being on the list is not a seat)', async () => {
    findUnique.mockResolvedValue({ approvedAt: null });
    await expect(assertSignupAllowed('waiting@example.org')).rejects.toMatchObject({ code: 'not_invited' });
  });

  it('closed + unknown email ⇒ not_invited', async () => {
    findUnique.mockResolvedValue(null);
    await expect(assertSignupAllowed('stranger@example.org')).rejects.toMatchObject({ code: 'not_invited' });
    expect(await isEmailApproved('stranger@example.org')).toBe(false);
  });

  it('closed + wallet-first (no email) ⇒ not_invited — a new wallet cannot mint an account', async () => {
    await expect(assertSignupAllowed(null)).rejects.toMatchObject({ code: 'not_invited' });
    await expect(assertSignupAllowed(undefined)).rejects.toMatchObject({ code: 'not_invited' });
    // No email means nothing to look up — the DB must not be touched.
    expect(findUnique).not.toHaveBeenCalled();
  });
});
