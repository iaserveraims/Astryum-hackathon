/**
 * productizer it. 8 — PRE-ACCOUNT HIJACK.
 *
 * `register` stores any address without verification. `oauthLogin` linked a
 * provider-verified identity onto that row by email and flipped
 * `emailVerified` to true WITHOUT clearing the squatter's password or killing
 * their sessions — and the admin / cap-exemption / Legacy doors key on
 * `emailVerified`. So a stranger who registered a founder's address with a
 * password became a verified founder the moment the real founder signed in
 * with Google/Apple/XRP Identity.
 *
 * productizer it. 11 — the takeover RACE and its residue: a refresh, a password
 * login or a passkey registration that passed its check before the takeover and
 * wrote after it; wallets and contacts left behind; resets that prove the
 * mailbox; logout on an unverified token.
 *
 * These run the REAL AuthService, SiweAuth and PasskeyService against an
 * in-memory prisma fake. Races are simulated by ordering: the takeover is run
 * inside a hook placed between the victim flow's check and its write.
 */
jest.mock('../../database/prismaClient', () => {
  const db = {
    users: new Map<string, any>(),
    sessions: new Map<string, any>(),
    passkeys: [] as any[],
    bindings: [] as any[],
    wallets: [] as any[],
    contacts: [] as any[],
    automationRules: [] as any[],
    auditLogs: [] as any[],
    // it. 13/15 — the previous holder's residue, one array per model. It is
    // REASSIGNED to the quarantine account now (it. 14, 4.3), never deleted.
    residue: {} as Record<string, any[]>,
    seq: 0,
  };
  const RESIDUE_MODELS = [
    'agentDocument',
    'agentRule',
    'agentConversation',
    'userAnthropicKey',
    'userMCPConnection',
    'triggerRule',
    'moneyFlow',
    'governedAccount',
    'walletWatchlist',
    'alert',
    'partnerIntent',
    'taxEvent',
    'transactionExecution',
    'transactionConfirmation',
    'stepUpLockConfig',
  ];
  const match = (row: any, where: any) =>
    Object.entries(where).every(([k, v]: [string, any]) =>
      v !== null && typeof v === 'object' && 'gt' in v ? row[k] instanceof Date && row[k] > v.gt : (row[k] ?? null) === v,
    );
  const updateManyIn = (rows: Iterable<any>, where: any, data: any) => {
    let count = 0;
    for (const r of rows) {
      if (match(r, where)) {
        Object.assign(r, data);
        count++;
      }
    }
    return { count };
  };
  const deleteManyIn = (key: 'passkeys' | 'wallets' | 'contacts' | 'automationRules', where: any) => {
    const before = db[key].length;
    db[key] = db[key].filter((r: any) => !match(r, where));
    return { count: before - db[key].length };
  };
  const user = {
    findUnique: jest.fn(async ({ where }: any) => {
      const u = [...db.users.values()].find((r) => match(r, where));
      return u ? { ...u } : null;
    }),
    findFirst: jest.fn(async ({ where }: any) => {
      const u = [...db.users.values()].find((r) => match(r, where));
      return u ? { ...u } : null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const u = {
        id: `user-${++db.seq}`,
        oauthSub: null,
        emailVerified: false,
        passwordHash: null,
        resetToken: null,
        resetTokenExpiresAt: null,
        authProvider: 'email',
        preferences: null,
        isActive: true,
        ...data,
      };
      db.users.set(u.id, u);
      return { ...u };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const u = db.users.get(where.id);
      if (!u) throw new Error('user not found');
      Object.assign(u, data);
      return { ...u };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => updateManyIn(db.users.values(), where, data)),
  };
  const session = {
    create: jest.fn(async ({ data }: any) => {
      const s = { id: `session-${++db.seq}`, createdAt: new Date(), ...data };
      db.sessions.set(s.id, s);
      return { ...s };
    }),
    findUnique: jest.fn(async ({ where }: any) => (db.sessions.has(where.id) ? { ...db.sessions.get(where.id) } : null)),
    findFirst: jest.fn(async ({ where }: any) => {
      const s = [...db.sessions.values()].find((r) => match(r, where));
      return s ? { ...s } : null;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const s = db.sessions.get(where.id);
      if (!s) throw new Error('session not found');
      Object.assign(s, data);
      return { ...s };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => updateManyIn(db.sessions.values(), where, data)),
  };
  const passkeyCredential = {
    findMany: jest.fn(async ({ where }: any) => db.passkeys.filter((p) => match(p, where))),
    create: jest.fn(async ({ data }: any) => {
      const p = { id: `pk-${++db.seq}`, ...data };
      db.passkeys.push(p);
      return { ...p };
    }),
    deleteMany: jest.fn(async ({ where }: any) => deleteManyIn('passkeys', where)),
    findUnique: jest.fn(async ({ where }: any) => {
      const p = db.passkeys.find((r) => match(r, where));
      return p ? { ...p } : null;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => updateManyIn(db.passkeys, where, data)),
  };
  const walletBinding = {
    findMany: jest.fn(async ({ where }: any) => db.bindings.filter((b) => match(b, where))),
    updateMany: jest.fn(async ({ where, data }: any) => updateManyIn(db.bindings, where, data)),
  };
  const wallet = {
    deleteMany: jest.fn(async ({ where }: any) => deleteManyIn('wallets', where)),
    updateMany: jest.fn(async ({ where, data }: any) => updateManyIn(db.wallets, where, data)),
  };
  const addressBookEntry = {
    deleteMany: jest.fn(async ({ where }: any) => deleteManyIn('contacts', where)),
    updateMany: jest.fn(async ({ where, data }: any) => updateManyIn(db.contacts, where, data)),
  };
  // Relation filter { wallet: { userId } } — the rules of that user's wallets.
  const automationRule = {
    deleteMany: jest.fn(async ({ where }: any) => {
      const walletIds = new Set(db.wallets.filter((w: any) => match(w, where.wallet)).map((w: any) => w.id));
      const before = db.automationRules.length;
      db.automationRules = db.automationRules.filter((r: any) => !walletIds.has(r.walletId));
      return { count: before - db.automationRules.length };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const { wallet: walletWhere, ...own } = where;
      const walletIds = new Set(db.wallets.filter((w: any) => match(w, walletWhere)).map((w: any) => w.id));
      return updateManyIn(
        db.automationRules.filter((r: any) => walletIds.has(r.walletId)),
        own,
        data,
      );
    }),
  };
  const auditLog = {
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `al-${++db.seq}`, timestamp: data.timestamp ?? new Date(), ...data };
      db.auditLogs.push(row);
      return { ...row };
    }),
    findMany: jest.fn(async ({ where }: any) =>
      db.auditLogs
        .filter((r: any) => match(r, where))
        .sort((a: any, b: any) => b.timestamp.getTime() - a.timestamp.getTime()),
    ),
  };
  const client: any = { user, session, passkeyCredential, walletBinding, wallet, addressBookEntry, automationRule, auditLog };
  for (const model of RESIDUE_MODELS) {
    client[model] = {
      deleteMany: jest.fn(async ({ where }: any) => {
        const rows = db.residue[model] ?? [];
        const kept = rows.filter((r: any) => !match(r, where));
        db.residue[model] = kept;
        return { count: rows.length - kept.length };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => updateManyIn(db.residue[model] ?? [], where, data)),
    };
  }
  client.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(client));
  return { prisma: client, __db: db };
});

jest.mock('../../config/betaGate', () => ({ assertSignupAllowed: jest.fn(async () => undefined) }));

jest.mock(
  '@simplewebauthn/server',
  () => ({
    generateRegistrationOptions: jest.fn(async () => ({ challenge: 'reg-challenge' })),
    verifyRegistrationResponse: jest.fn(async () => ({
      verified: true,
      registrationInfo: {
        credentialID: 'cred-new',
        credentialPublicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        credentialBackedUp: false,
      },
    })),
    generateAuthenticationOptions: jest.fn(async () => ({ challenge: 'auth-challenge' })),
    verifyAuthenticationResponse: jest.fn(async () => ({ verified: true, authenticationInfo: { newCounter: 1 } })),
  }),
  { virtual: true },
);

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authService, resetTokenExposureEnabled } from '../AuthService';
import { issueSessionForUser, resolveJwtSecret, revokeSessionForToken, verifyToken } from '../SiweAuth';
import {
  getAuthenticationOptions,
  getRegistrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from '../PasskeyService';
import { updateUserPreferences } from '../identity/userPreferences';
import {
  QUARANTINED_PREFERENCES_KEY,
  readTakeoverAtStrict,
  splitTakeoverPreferences,
  withCredentialsReset,
} from '../identity/credentialsEpoch';
import { provenAddressesDetailed } from '../identity/provenAddresses';
import {
  __resetCageAckCacheForTests,
  readCageAck,
  recordCageAck,
} from '../flare/LegacyCageAckService';
import { CAGE_ACK_IDS } from '../../config/cageDisclosure';
import { computeLegalStatus, withLegalAcceptance } from '../../config/legalAcceptance';
import passkeyRouter from '../../routes/passkey';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __db: db, prisma } = require('../../database/prismaClient') as { __db: any; prisma: any };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const webauthn = require('@simplewebauthn/server') as {
  verifyRegistrationResponse: jest.Mock;
  verifyAuthenticationResponse: jest.Mock;
};

const FOUNDER = 'founder@astryum.xyz';
const SQUATTER_PASSWORD = 'squatter-password-1';
const XRPL_INTRUDER = 'rDarPNJEpCnpBZSfmcquydockkePkjPGA2';
const googleClaims = (over: Record<string, unknown> = {}) =>
  ({ provider: 'google', sub: 'g-owner', email: FOUNDER, emailVerified: true, ...over }) as any;

const activeSessionIds = (userId: string) =>
  [...db.sessions.values()].filter((s: any) => s.userId === userId && s.isActive).map((s: any) => s.id);

/** The account the takeover created to hold the previous holder's rows. */
const quarantineRowFor = (fromUserId: string) => {
  const row = [...db.users.values()].find(
    (u: any) => (u.preferences as any)?.quarantine?.fromUserId === fromUserId,
  );
  expect(row).toBeTruthy();
  return row as any;
};

/** Run `hook` right before the NEXT transaction starts — i.e. after the flow's
 *  check, before its write. Nested transactions inside the hook run normally. */
function beforeNextTransaction(hook: () => Promise<unknown>) {
  prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
    await hook();
    return fn(prisma);
  });
}

/** The session row a READ COMMITTED sweep can miss: re-activated, born earlier. */
function escapeSweep(sessionId: string) {
  const s = db.sessions.get(sessionId);
  s.isActive = true;
  s.createdAt = new Date(Date.now() - 60_000);
}

let warn: jest.SpyInstance;
let info: jest.SpyInstance;
beforeEach(() => {
  db.users.clear();
  db.sessions.clear();
  db.passkeys = [];
  db.bindings = [];
  db.wallets = [];
  db.contacts = [];
  db.automationRules = [];
  db.auditLogs = [];
  db.residue = {};
  __resetCageAckCacheForTests();
  jest.clearAllMocks();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
  info.mockRestore();
});

describe('oauthLogin — the verified owner TAKES OVER an unverified password account', () => {
  it('kills the squatter: session and refresh token rejected, password gone, passkeys gone, reset token dead', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    await expect(verifyToken(squatter.accessToken)).resolves.toMatchObject({ userId: squatter.userId });
    // While logged in, the squatter adds a login passkey and requests a reset.
    db.passkeys.push({ id: 'pk-1', userId: squatter.userId, credentialId: 'cred-squatter' });
    const { resetToken } = await authService.forgotPassword(FOUNDER);
    expect(resetToken).toBeTruthy();

    const owner = await authService.oauthLogin(googleClaims());

    expect(owner.created).toBe(false);
    expect(owner.userId).toBe(squatter.userId);
    await expect(verifyToken(squatter.accessToken)).rejects.toMatchObject({ code: 'session_revoked' });
    await expect(authService.refresh(squatter.refreshToken)).rejects.toMatchObject({ code: 'refresh_token_invalid' });
    await expect(authService.login(FOUNDER, SQUATTER_PASSWORD)).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(authService.resetPassword(resetToken, 'new-password-2')).rejects.toMatchObject({ code: 'reset_token_invalid' });
    expect(db.passkeys).toHaveLength(0);

    const row = db.users.get(squatter.userId);
    expect(row.passwordHash).toBeNull();
    expect(row.resetToken).toBeNull();
    expect(row.emailVerified).toBe(true);
    expect(row.oauthSub).toBe('google:g-owner');
    expect(row.authProvider).toBe('google');

    // The owner's own session, issued AFTER the revocation, is alive.
    await expect(verifyToken(owner.accessToken)).resolves.toMatchObject({ userId: squatter.userId });
    // The takeover is logged by user id, never by address.
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain(squatter.userId);
    expect(logged).not.toContain(FOUNDER);
  });

  it('if the revocation cannot be written, the owner is NOT signed in (no session issued)', async () => {
    await authService.register(FOUNDER, SQUATTER_PASSWORD);
    prisma.passkeyCredential.deleteMany.mockRejectedValueOnce(new Error('db down'));
    const sessionsBefore = db.sessions.size;
    await expect(authService.oauthLogin(googleClaims())).rejects.toThrow('db down');
    expect(db.sessions.size).toBe(sessionsBefore);
  });

  it('an UNVERIFIED provider email never links, so it never takes over either', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    await expect(authService.oauthLogin(googleClaims({ emailVerified: false }))).rejects.toMatchObject({
      code: 'oauth_email_unverified',
    });
    await expect(verifyToken(squatter.accessToken)).resolves.toMatchObject({ userId: squatter.userId });
    expect(db.users.get(squatter.userId).emailVerified).toBe(false);
  });
});

describe('oauthLogin — rows with proof, or without a password, link as before', () => {
  it('an already VERIFIED password row keeps its password and its sessions', async () => {
    const existing = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    db.users.get(existing.userId).emailVerified = true;

    const owner = await authService.oauthLogin(googleClaims());

    expect(owner.userId).toBe(existing.userId);
    await expect(verifyToken(existing.accessToken)).resolves.toMatchObject({ userId: existing.userId });
    await expect(authService.login(FOUNDER, SQUATTER_PASSWORD)).resolves.toMatchObject({ userId: existing.userId });
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
    expect(prisma.passkeyCredential.deleteMany).not.toHaveBeenCalled();
    expect(db.users.get(existing.userId).oauthSub).toBe('google:g-owner');
  });

  it('a row WITHOUT a password links (flag flipped) and keeps its sessions', async () => {
    db.users.set('user-wallet', {
      id: 'user-wallet',
      email: FOUNDER,
      passwordHash: null,
      emailVerified: false,
      oauthSub: null,
      authProvider: 'wallet',
      isActive: true,
    });
    const earlier = await (authService as any)._createSession('user-wallet');

    const owner = await authService.oauthLogin(googleClaims({ provider: 'xrplid', sub: 'x-1' }));

    expect(owner.userId).toBe('user-wallet');
    await expect(verifyToken(earlier.accessToken)).resolves.toMatchObject({ userId: 'user-wallet' });
    expect(db.users.get('user-wallet')).toMatchObject({ emailVerified: true, oauthSub: 'xrplid:x-1', authProvider: 'wallet' });
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
  });
});

describe('it. 11/15 — takeover residue and the preferences.security contract', () => {
  it('stamps takeoverAt + credentialsEpoch (other preference keys kept), deactivates bindings, REASSIGNS wallets and contacts, logs counts only', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    const row = db.users.get(squatter.userId);
    row.preferences = { appearance: { theme: 'dark' }, security: { note: 'kept' } };
    db.bindings.push(
      { id: 'b1', userId: squatter.userId, address: XRPL_INTRUDER, chainType: 'xrpl', signatureProof: 'blob', isActive: true },
      { id: 'b-other', userId: 'someone-else', address: XRPL_INTRUDER, chainType: 'xrpl', signatureProof: 'blob', isActive: true },
    );
    db.wallets.push({ id: 'w1', userId: squatter.userId, address: XRPL_INTRUDER }, { id: 'w-other', userId: 'someone-else', address: 'x' });
    db.contacts.push({ id: 'c1', userId: squatter.userId, address: XRPL_INTRUDER, label: 'My Ledger' });

    const before = Date.now();
    await authService.oauthLogin(googleClaims());

    const prefs = db.users.get(squatter.userId).preferences;
    expect(prefs.appearance).toEqual({ theme: 'dark' });
    expect(prefs.security.note).toBe('kept');
    expect(typeof prefs.security.takeoverAt).toBe('string');
    expect(prefs.security.credentialsEpoch).toBe(prefs.security.takeoverAt);
    expect(Date.parse(prefs.security.takeoverAt)).toBeGreaterThanOrEqual(before);

    expect(db.bindings.find((b: any) => b.id === 'b1').isActive).toBe(false);
    expect(db.bindings.find((b: any) => b.id === 'b-other').isActive).toBe(true);
    // Nothing is deleted: the rows move to the quarantine account (it. 14, 4.3 —
    // deleting a wallet cascaded into intents, executions and positions).
    const quarantine = quarantineRowFor(squatter.userId);
    expect(db.wallets.map((w: any) => w.id).sort()).toEqual(['w-other', 'w1']);
    expect(db.wallets.find((w: any) => w.id === 'w1').userId).toBe(quarantine.id);
    expect(db.wallets.find((w: any) => w.id === 'w-other').userId).toBe('someone-else');
    expect(db.contacts).toHaveLength(1);
    expect(db.contacts[0].userId).toBe(quarantine.id);

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toMatch(/1 wallet bindings/);
    expect(logged).toMatch(/1 wallet rows, 1 address-book entries/);
    expect(logged).not.toContain(XRPL_INTRUDER);
  });
});

describe('it. 11 — credential epoch: nothing issued across the takeover survives it', () => {
  it('refresh that passed its session check BEFORE the takeover and writes AFTER it → refused, no session born', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    let owner: any;
    beforeNextTransaction(async () => {
      owner = await authService.oauthLogin(googleClaims());
    });

    await expect(authService.refresh(squatter.refreshToken)).rejects.toMatchObject({ code: 'refresh_token_invalid' });
    expect(activeSessionIds(squatter.userId)).toEqual([owner.sessionId]);
  });

  it('…even if the old session row escaped the sweep: the CAS on the password state refuses the rotation', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    let owner: any;
    beforeNextTransaction(async () => {
      owner = await authService.oauthLogin(googleClaims());
      escapeSweep(squatter.sessionId);
    });

    await expect(authService.refresh(squatter.refreshToken)).rejects.toMatchObject({ code: 'refresh_token_invalid' });
    // No new session was created for the squatter; the escaped row dies at the epoch.
    expect(activeSessionIds(squatter.userId).sort()).toEqual([owner.sessionId, squatter.sessionId].sort());
    await expect(verifyToken(squatter.accessToken)).rejects.toMatchObject({ code: 'session_revoked' });
    await expect(authService.refresh(squatter.refreshToken)).rejects.toMatchObject({ code: 'refresh_token_invalid' });
  });

  it('refresh whose session check straddles the takeover (session read before, user read after) → refused by the epoch', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    db.sessions.get(squatter.sessionId).createdAt = new Date(Date.now() - 60_000);
    const original = prisma.session.findFirst.getMockImplementation();
    prisma.session.findFirst.mockImplementationOnce(async (args: any) => {
      const snapshot = await original(args);
      await authService.oauthLogin(googleClaims());
      return snapshot;
    });

    await expect(authService.refresh(squatter.refreshToken)).rejects.toMatchObject({ code: 'refresh_token_invalid' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1); // only the takeover's
  });

  it('password login verified just BEFORE the takeover → no active session for it', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    let owner: any;
    beforeNextTransaction(async () => {
      owner = await authService.oauthLogin(googleClaims());
    });

    await expect(authService.login(FOUNDER, SQUATTER_PASSWORD)).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect(activeSessionIds(squatter.userId)).toEqual([owner.sessionId]);
  });

  it('verifyToken refuses a token issued before the epoch, even on a live session row', async () => {
    await authService.register(FOUNDER, SQUATTER_PASSWORD);
    const owner = await authService.oauthLogin(googleClaims());
    const epoch = Date.parse(db.users.get(owner.userId).preferences.security.credentialsEpoch);
    const stale = jwt.sign(
      { sub: owner.userId, sid: owner.sessionId, addr: '', iat: Math.floor(epoch / 1000) - 5 },
      resolveJwtSecret(),
      { expiresIn: 3600 },
    );
    await expect(verifyToken(stale)).rejects.toMatchObject({ code: 'session_revoked' });
    await expect(verifyToken(owner.accessToken)).resolves.toMatchObject({ userId: owner.userId });
  });
});

describe('it. 11 — passkey registration cannot outlive the takeover', () => {
  it('takeover commits DURING the WebAuthn verification → session_revoked, no passkey written', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    const auth = await verifyToken(squatter.accessToken); // requireSiweAuth passed
    await getRegistrationOptions(auth.userId, FOUNDER);
    webauthn.verifyRegistrationResponse.mockImplementationOnce(async () => {
      await authService.oauthLogin(googleClaims());
      return {
        verified: true,
        registrationInfo: { credentialID: 'cred-squatter', credentialPublicKey: new Uint8Array([9]), counter: 0 },
      };
    });

    await expect(verifyRegistration(auth.userId, { response: {} }, 'squatter phone', auth.sessionId)).rejects.toMatchObject({
      code: 'session_revoked',
    });
    expect(db.passkeys).toHaveLength(0);
  });

  it('takeover commits after the auth check but before registration starts → session_revoked (session re-read under the lock)', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    const auth = await verifyToken(squatter.accessToken);
    await getRegistrationOptions(auth.userId, FOUNDER);
    await authService.oauthLogin(googleClaims());

    await expect(verifyRegistration(auth.userId, { response: {} }, undefined, auth.sessionId)).rejects.toMatchObject({
      code: 'session_revoked',
    });
    expect(db.passkeys).toHaveLength(0);
  });

  it('the owner, after the takeover, registers a passkey normally', async () => {
    await authService.register(FOUNDER, SQUATTER_PASSWORD);
    const owner = await authService.oauthLogin(googleClaims());
    const auth = await verifyToken(owner.accessToken);
    await getRegistrationOptions(auth.userId, FOUNDER);

    await expect(verifyRegistration(auth.userId, { response: {} }, 'owner laptop', auth.sessionId)).resolves.toEqual({ verified: true });
    expect(db.passkeys).toHaveLength(1);
    expect(db.passkeys[0]).toMatchObject({ userId: owner.userId, credentialId: 'cred-new' });
  });
});

describe('it. 11 — resetPassword', () => {
  const withNodeEnv = async (value: string, fn: () => Promise<void>) => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = value;
    try {
      await fn();
    } finally {
      process.env.NODE_ENV = original;
    }
  };

  it('in production the link proves the mailbox: emailVerified set, and the Google login that follows is NOT a takeover', async () => {
    const founder = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    const { resetToken } = await authService.forgotPassword(FOUNDER);
    await withNodeEnv('production', () => authService.resetPassword(resetToken, 'founder-new-password'));

    expect(db.users.get(founder.userId).emailVerified).toBe(true);
    const relogged = await authService.login(FOUNDER, 'founder-new-password');
    await authService.oauthLogin(googleClaims());
    await expect(verifyToken(relogged.accessToken)).resolves.toMatchObject({ userId: founder.userId });
    expect(db.users.get(founder.userId).passwordHash).toBeTruthy();
    expect(db.users.get(founder.userId).preferences?.security?.takeoverAt).toBeUndefined();
  });

  const withExposeOptIn = async (value: string | undefined, fn: () => Promise<void>) => {
    const original = process.env.AUTH_EXPOSE_RESET_TOKEN;
    if (value === undefined) delete process.env.AUTH_EXPOSE_RESET_TOKEN;
    else process.env.AUTH_EXPOSE_RESET_TOKEN = value;
    try {
      await fn();
    } finally {
      if (original === undefined) delete process.env.AUTH_EXPOSE_RESET_TOKEN;
      else process.env.AUTH_EXPOSE_RESET_TOKEN = original;
    }
  };

  it('it. 13 — with the explicit dev opt-in the token is handed out, so the reset proves nothing: emailVerified stays false', async () => {
    const founder = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    const { resetToken } = await authService.forgotPassword(FOUNDER);
    await withExposeOptIn('true', () =>
      withNodeEnv('development', () => authService.resetPassword(resetToken, 'founder-new-password')),
    );
    expect(db.users.get(founder.userId).emailVerified).toBe(false);
  });

  it('it. 13 — exposure needs BOTH non-production AND AUTH_EXPOSE_RESET_TOKEN=true; default is never', async () => {
    await withExposeOptIn(undefined, () => withNodeEnv('development', async () => expect(resetTokenExposureEnabled()).toBe(false)));
    await withExposeOptIn('1', () => withNodeEnv('development', async () => expect(resetTokenExposureEnabled()).toBe(false)));
    await withExposeOptIn('true', () => withNodeEnv('production', async () => expect(resetTokenExposureEnabled()).toBe(false)));
    await withExposeOptIn('true', () => withNodeEnv('development', async () => expect(resetTokenExposureEnabled()).toBe(true)));
  });

  it('it. 13 — without the opt-in the token is neither logged nor exposed, so outside production the reset DOES prove the mailbox', async () => {
    await withExposeOptIn(undefined, () =>
      withNodeEnv('development', async () => {
        const founder = await authService.register(FOUNDER, SQUATTER_PASSWORD);
        const { resetToken } = await authService.forgotPassword(FOUNDER);
        expect(info.mock.calls.flat().join(' ')).not.toContain(resetToken);
        await authService.resetPassword(resetToken, 'founder-new-password');
        expect(db.users.get(founder.userId).emailVerified).toBe(true);
      }),
    );
  });

  it('a takeover that commits while the new password is hashed voids the reset (no password lands on the owner row)', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    const { resetToken } = await authService.forgotPassword(FOUNDER);
    beforeNextTransaction(() => authService.oauthLogin(googleClaims()));

    await expect(authService.resetPassword(resetToken, 'squatter-again')).rejects.toMatchObject({ code: 'reset_token_invalid' });
    expect(db.users.get(squatter.userId).passwordHash).toBeNull();
    await expect(authService.login(FOUNDER, 'squatter-again')).rejects.toMatchObject({ code: 'invalid_credentials' });
  });
});

describe('it. 11 — logout verifies the token before revoking', () => {
  it('a forged token naming a live session id revokes nothing', async () => {
    const victim = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    const forged = jwt.sign({ sub: victim.userId, sid: victim.sessionId, addr: '' }, 'attacker-secret-attacker-secret-0000');
    await expect(revokeSessionForToken(forged)).rejects.toMatchObject({ code: 'token_invalid' });
    await expect(revokeSessionForToken('not.a.jwt')).rejects.toMatchObject({ code: 'token_invalid' });
    expect(db.sessions.get(victim.sessionId).isActive).toBe(true);
  });

  it('an authentic token revokes its session — even once expired (the refresh session outlives the 24h JWT)', async () => {
    const user = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    const expired = jwt.sign(
      { sub: user.userId, sid: user.sessionId, addr: '', exp: Math.floor(Date.now() / 1000) - 60 },
      resolveJwtSecret(),
    );
    await expect(revokeSessionForToken(expired)).resolves.toEqual({ revoked: true });
    expect(db.sessions.get(user.sessionId).isActive).toBe(false);
  });
});

// ── it. 13 ────────────────────────────────────────────────────────────────────

function seedPasskey(userId: string, credentialId = 'cred-login', createdAt = new Date()) {
  const p = {
    id: `pk-${++db.seq}`,
    userId,
    credentialId,
    publicKey: Buffer.from([1, 2, 3]),
    counter: BigInt(0),
    transports: [],
    createdAt,
  };
  db.passkeys.push(p);
  return p;
}

function seedPasskeyOnlyUser(id = 'user-pk', preferences: unknown = null) {
  db.users.set(id, { id, email: null, passwordHash: null, emailVerified: false, oauthSub: null, preferences, isActive: true });
  return id;
}

async function passkeyLogin(credentialId = 'cred-login') {
  const { challengeId } = await getAuthenticationOptions();
  return passkeyLoginWith(challengeId, credentialId);
}

/** Same, on a challenge the caller already holds (to reuse or race one). */
function passkeyLoginWith(challengeId: string, credentialId = 'cred-login') {
  return verifyAuthentication(challengeId, { id: credentialId }, (tx, userId) => issueSessionForUser(userId, null, {}, tx));
}

describe('it. 13 — passkey LOGIN issues its session inside the credential lock (5.1)', () => {
  it('happy path: session born, counter advanced, lastLogin stamped, token verifies', async () => {
    const userId = seedPasskeyOnlyUser();
    seedPasskey(userId);

    const { userId: loggedIn, issued } = await passkeyLogin();

    expect(loggedIn).toBe(userId);
    expect(activeSessionIds(userId)).toEqual([issued.sessionId]);
    expect(db.passkeys[0].counter).toBe(BigInt(1));
    expect(db.passkeys[0].lastUsedAt).toBeInstanceOf(Date);
    expect(db.users.get(userId).lastLogin).toBeInstanceOf(Date);
    await expect(verifyToken(issued.token)).resolves.toMatchObject({ userId });
  });

  it('takeover commits DURING the WebAuthn verification → refused, no session, the passkey is gone', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    seedPasskey(squatter.userId, 'cred-squatter');
    let owner: any;
    webauthn.verifyAuthenticationResponse.mockImplementationOnce(async () => {
      owner = await authService.oauthLogin(googleClaims());
      return { verified: true, authenticationInfo: { newCounter: 1 } };
    });

    await expect(passkeyLogin('cred-squatter')).rejects.toMatchObject({ code: 'credentials_changed' });
    expect(activeSessionIds(squatter.userId)).toEqual([owner.sessionId]);
    expect(db.passkeys).toHaveLength(0);
  });

  it('takeover commits between the verification and the issue → refused, no session', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    seedPasskey(squatter.userId, 'cred-squatter');
    let owner: any;
    beforeNextTransaction(async () => {
      owner = await authService.oauthLogin(googleClaims());
    });

    await expect(passkeyLogin('cred-squatter')).rejects.toMatchObject({ code: 'credentials_changed' });
    expect(activeSessionIds(squatter.userId)).toEqual([owner.sessionId]);
  });

  it('credential deleted concurrently with no other state change → credential_revoked, no session', async () => {
    const userId = seedPasskeyOnlyUser();
    seedPasskey(userId);
    beforeNextTransaction(async () => {
      db.passkeys = [];
    });

    await expect(passkeyLogin()).rejects.toMatchObject({ code: 'credential_revoked' });
    expect(activeSessionIds(userId)).toEqual([]);
  });

  it('credential epoch moved during the window (no password on the row) → credentials_changed, no session', async () => {
    const userId = seedPasskeyOnlyUser();
    seedPasskey(userId);
    beforeNextTransaction(async () => {
      const iso = new Date().toISOString();
      db.users.get(userId).preferences = { security: { credentialsEpoch: iso, takeoverAt: iso } };
    });

    await expect(passkeyLogin()).rejects.toMatchObject({ code: 'credentials_changed' });
    expect(activeSessionIds(userId)).toEqual([]);
  });

  it('a credential born before the epoch that escaped the sweep → credential_revoked', async () => {
    const epoch = new Date();
    const userId = seedPasskeyOnlyUser('user-pk', { security: { credentialsEpoch: epoch.toISOString() } });
    seedPasskey(userId, 'cred-login', new Date(epoch.getTime() - 60_000));

    await expect(passkeyLogin()).rejects.toMatchObject({ code: 'credential_revoked' });
    expect(activeSessionIds(userId)).toEqual([]);
  });

  it('a disabled account gets no session', async () => {
    const userId = seedPasskeyOnlyUser();
    db.users.get(userId).isActive = false;
    seedPasskey(userId);

    await expect(passkeyLogin()).rejects.toMatchObject({ code: 'account_disabled' });
    expect(activeSessionIds(userId)).toEqual([]);
  });

  describe('POST /auth/verify (route)', () => {
    const app = express();
    app.use(express.json());
    app.use('/', passkeyRouter);

    it('takeover during the verification → 401 without a token', async () => {
      const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
      seedPasskey(squatter.userId, 'cred-squatter');
      webauthn.verifyAuthenticationResponse.mockImplementationOnce(async () => {
        await authService.oauthLogin(googleClaims());
        return { verified: true, authenticationInfo: { newCounter: 1 } };
      });
      const { body: opts } = await request(app).post('/auth/options').send({});

      const res = await request(app)
        .post('/auth/verify')
        .send({ challengeId: opts.challengeId, response: { id: 'cred-squatter' } });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'credentials_changed' });
      expect(activeSessionIds(squatter.userId)).toHaveLength(1); // the owner's only
    });

    it('normal login → 200 with a session token', async () => {
      const userId = seedPasskeyOnlyUser();
      seedPasskey(userId);
      const { body: opts } = await request(app).post('/auth/options').send({});

      const res = await request(app).post('/auth/verify').send({ challengeId: opts.challengeId, response: { id: 'cred-login' } });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      await expect(verifyToken(res.body.token)).resolves.toMatchObject({ userId });
    });
  });
});

describe('it. 15 — a passkey challenge is consumed atomically (menores)', () => {
  it('two assertions racing on the SAME challenge: exactly one session, the other challenge_expired', async () => {
    const userId = seedPasskeyOnlyUser();
    seedPasskey(userId);
    const { challengeId } = await getAuthenticationOptions();
    // An authenticator that always reports counter 0 (most platform passkeys)
    // leaves the conditional counter advance unable to tell the two apart — the
    // challenge is what has to be single-use.
    webauthn.verifyAuthenticationResponse.mockImplementation(async () => ({
      verified: true,
      authenticationInfo: { newCounter: 0 },
    }));

    const results = await Promise.allSettled([
      verifyAuthentication(challengeId, { id: 'cred-login' }, (tx, uid) => issueSessionForUser(uid, null, {}, tx)),
      verifyAuthentication(challengeId, { id: 'cred-login' }, (tx, uid) => issueSessionForUser(uid, null, {}, tx)),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'challenge_expired' });
    expect(activeSessionIds(userId)).toHaveLength(1);
    webauthn.verifyAuthenticationResponse.mockReset();
    webauthn.verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 1 } });
  });

  it('a failed verification burns the challenge (it is never reusable)', async () => {
    const userId = seedPasskeyOnlyUser();
    seedPasskey(userId);
    const { challengeId } = await getAuthenticationOptions();
    webauthn.verifyAuthenticationResponse.mockResolvedValueOnce({ verified: false });

    await expect(passkeyLoginWith(challengeId)).rejects.toMatchObject({ code: 'authentication_failed' });
    await expect(passkeyLoginWith(challengeId)).rejects.toMatchObject({ code: 'challenge_expired' });
    expect(activeSessionIds(userId)).toEqual([]);
  });
});

describe('it. 15 — the takeover QUARANTINES the residue instead of destroying it (4.3)', () => {
  const BY_USER = [
    'agentDocument',
    'agentRule',
    'agentConversation',
    'userAnthropicKey',
    'userMCPConnection',
    'triggerRule',
    'governedAccount',
    'walletWatchlist',
    'alert',
    'partnerIntent',
    'taxEvent',
    'transactionExecution',
    'transactionConfirmation',
    'stepUpLockConfig',
  ];

  function seedResidue(victimId: string, other = 'someone-else') {
    db.wallets.push({ id: 'w1', userId: victimId, address: XRPL_INTRUDER }, { id: 'w-other', userId: other, address: 'x' });
    db.automationRules.push({ id: 'ar1', walletId: 'w1', enabled: true }, { id: 'ar-other', walletId: 'w-other', enabled: true });
    for (const model of BY_USER) {
      db.residue[model] = [
        { id: `${model}-1`, userId: victimId, address: XRPL_INTRUDER, enabled: true, isActive: true },
        { id: `${model}-other`, userId: other, enabled: true, isActive: true },
      ];
    }
    db.residue.triggerRule[0].suggestedActionParams = { to: XRPL_INTRUDER };
    db.residue.moneyFlow = [
      { id: 'moneyFlow-1', ownerId: victimId, enabled: true },
      { id: 'moneyFlow-other', ownerId: other, enabled: true },
    ];
  }

  it('re-points every row at the quarantine account — nothing deleted, the owner sees none of it, counts only in the log', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    seedResidue(squatter.userId);

    await authService.oauthLogin(googleClaims());
    const quarantine = quarantineRowFor(squatter.userId);

    for (const model of BY_USER) {
      const rows = db.residue[model];
      // Both rows still exist: the audit trail is not a casualty of a takeover.
      expect({ model, ids: rows.map((r: any) => r.id).sort() }).toEqual({
        model,
        ids: [`${model}-1`, `${model}-other`].sort(),
      });
      expect({ model, owner: rows.find((r: any) => r.id === `${model}-1`).userId }).toEqual({
        model,
        owner: quarantine.id,
      });
      expect(rows.find((r: any) => r.id === `${model}-other`).userId).toBe('someone-else');
    }
    expect(db.residue.moneyFlow.find((r: any) => r.id === 'moneyFlow-1').ownerId).toBe(quarantine.id);
    expect(db.residue.moneyFlow.find((r: any) => r.id === 'moneyFlow-other').ownerId).toBe('someone-else');
    // Wallets travel with everything that hangs off them (intents, executions,
    // positions): nothing was deleted, so nothing cascaded.
    expect(prisma.wallet.deleteMany).not.toHaveBeenCalled();
    expect(db.wallets.find((w: any) => w.id === 'w1').userId).toBe(quarantine.id);

    // What can move money or data is switched OFF as it moves — no background
    // tick keeps working for a quarantined account.
    expect(db.automationRules.find((r: any) => r.id === 'ar1').enabled).toBe(false);
    expect(db.automationRules.find((r: any) => r.id === 'ar-other').enabled).toBe(true);
    expect(db.residue.triggerRule.find((r: any) => r.id === 'triggerRule-1').enabled).toBe(false);
    expect(db.residue.moneyFlow.find((r: any) => r.id === 'moneyFlow-1').enabled).toBe(false);
    expect(db.residue.agentRule.find((r: any) => r.id === 'agentRule-1').isActive).toBe(false);
    expect(db.residue.userMCPConnection.find((r: any) => r.id === 'userMCPConnection-1').isActive).toBe(false);
    expect(db.residue.walletWatchlist.find((r: any) => r.id === 'walletWatchlist-1').isActive).toBe(false);

    // The rules are switched off BEFORE the wallets move (they are found
    // through their wallet's owner).
    expect(prisma.automationRule.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.wallet.updateMany.mock.invocationCallOrder[0],
    );

    const logged = warn.mock.calls.flat().join(' ');
    for (const phrase of [
      `quarantine account ${quarantine.id}`,
      '1 automation rules',
      '1 agent documents',
      '1 agent rules',
      '1 agent conversations',
      '1 Anthropic keys',
      '1 MCP connections',
      '1 trigger rules',
      '1 money flows',
      '1 governed accounts',
      '1 watchlist entries',
      '1 alerts',
      '1 partner intents',
      '1 tax events',
      '1 transaction executions',
      '1 transaction confirmations',
      '1 step-up lock configs',
    ]) {
      expect(logged).toContain(phrase);
    }
    expect(logged).not.toContain(XRPL_INTRUDER);
    expect(logged).not.toContain(FOUNDER);
  });

  it('nothing that can cascade is deleted: only the passkeys (login keys with no dependants)', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    seedResidue(squatter.userId);

    await authService.oauthLogin(googleClaims());

    for (const model of ['wallet', 'addressBookEntry', 'automationRule', ...BY_USER, 'moneyFlow']) {
      expect({ model, deleted: (prisma as any)[model].deleteMany.mock.calls.length }).toEqual({ model, deleted: 0 });
    }
    expect(prisma.passkeyCredential.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('the quarantine account can never be signed into, and takes no identity on', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    await authService.oauthLogin(googleClaims());
    const quarantine = quarantineRowFor(squatter.userId);

    expect(quarantine).toMatchObject({ isActive: false, emailVerified: false, passwordHash: null, oauthSub: null });
    expect(quarantine.email).toMatch(new RegExp(`^takeover-quarantine\\+${squatter.userId}\\+\\d+@invalid$`));
    expect(quarantine.xrplAddress).toBeNull();
    expect(db.passkeys.filter((p: any) => p.userId === quarantine.id)).toHaveLength(0);
    expect(activeSessionIds(quarantine.id)).toEqual([]);

    await expect(authService.login(quarantine.email, SQUATTER_PASSWORD)).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    await expect(authService.forgotPassword(quarantine.email)).resolves.toEqual({ resetToken: '' });
    // Even a provider that somehow attested that address links nothing.
    await expect(
      authService.oauthLogin(googleClaims({ email: quarantine.email, sub: 'g-quarantine' })),
    ).rejects.toMatchObject({ code: 'account_disabled' });
    expect(db.users.get(quarantine.id).oauthSub).toBeNull();
  });

  it('if a residue write fails, nothing is linked and no session is issued', async () => {
    await authService.register(FOUNDER, SQUATTER_PASSWORD);
    prisma.triggerRule.updateMany.mockRejectedValueOnce(new Error('db down'));
    const sessionsBefore = db.sessions.size;
    await expect(authService.oauthLogin(googleClaims())).rejects.toThrow('db down');
    expect(db.sessions.size).toBe(sessionsBefore);
  });
});

describe('it. 15 — the owner inherits no consent of the previous holder (4.1, 4.2)', () => {
  const TERMS = '2026-07-30';

  it('the legal signature and the register click-wrap move to quarantine, and the gate re-opens for the owner', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    const row = db.users.get(squatter.userId);
    row.preferences = {
      ...withLegalAcceptance({ demoTerms: { version: TERMS, acceptedAt: new Date().toISOString() } }, TERMS),
      appearance: { theme: 'dark' },
    };
    expect(computeLegalStatus(row.preferences, TERMS).required).toBe(false);

    await authService.oauthLogin(googleClaims());

    const ownerPrefs = db.users.get(squatter.userId).preferences;
    expect(ownerPrefs.legal).toBeUndefined();
    expect(ownerPrefs.demoTerms).toBeUndefined();
    expect(ownerPrefs.appearance).toEqual({ theme: 'dark' });
    expect(computeLegalStatus(ownerPrefs, TERMS).required).toBe(true);
    expect(computeLegalStatus(ownerPrefs, TERMS).reason).toBe('first');

    // Not destroyed: it still proves what the previous holder accepted.
    const quarantine = quarantineRowFor(squatter.userId);
    expect(quarantine.preferences.legal.termsVersion).toBe(TERMS);
    expect(quarantine.preferences.demoTerms.version).toBe(TERMS);
    expect(quarantine.preferences.quarantine.fromUserId).toBe(squatter.userId);
  });

  it('a legal record that somehow survives, dated before the takeover, still does not count', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    await authService.oauthLogin(googleClaims());
    const prefs = db.users.get(squatter.userId).preferences;
    const before = new Date(Date.parse(prefs.security.takeoverAt) - 1000);

    const forged = { ...prefs, ...withLegalAcceptance({}, TERMS, before) };

    expect(computeLegalStatus(forged, TERMS).required).toBe(true);
    // …and the owner's own acceptance, after the takeover, closes it. (An
    // acceptance in the takeover's own millisecond fails closed: it is asked
    // again, which costs a click and proves the signature is the owner's.)
    const after = new Date(Date.parse(prefs.security.takeoverAt) + 1000);
    const signed = { ...prefs, ...withLegalAcceptance({}, TERMS, after) };
    expect(computeLegalStatus(signed, TERMS).required).toBe(false);
  });

  it('the cage acknowledgement of the previous holder does not open the gate for the owner', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    // The previous holder reads the disclosure (and the positive is cached).
    // The ack is written under THEIR live session — it. 19 made that mandatory
    // (it. 18, 3.2), so an acknowledgement always belongs to a provable reader.
    await recordCageAck({
      userId: squatter.userId,
      account: 'rCouncil',
      acknowledgements: CAGE_ACK_IDS,
      session: { userId: squatter.userId, sessionId: squatter.sessionId },
    });
    expect((await readCageAck(squatter.userId)).acceptedAt).toBeTruthy();

    const owner = await authService.oauthLogin(googleClaims());

    // Same user id, same AuditLog row — and no acknowledgement for the owner.
    expect((await readCageAck(squatter.userId)).acceptedAt).toBeNull();
    expect(db.auditLogs).toHaveLength(1); // the proof is still there
    // …and the previous holder's session cannot write a new one either: the
    // takeover killed it, and the guard now refuses before anything is stamped.
    await expect(
      recordCageAck({
        userId: squatter.userId,
        account: 'rCouncil',
        acknowledgements: CAGE_ACK_IDS,
        session: { userId: squatter.userId, sessionId: squatter.sessionId },
      }),
    ).rejects.toMatchObject({ code: 'session_revoked' });
    expect(db.auditLogs).toHaveLength(1);

    // The owner reads it themselves, on their own session → the gate opens
    // again. (A few ms so the new stamp cannot share a millisecond with
    // `takeoverAt`.)
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordCageAck({
      userId: squatter.userId,
      account: 'rCouncil',
      acknowledgements: CAGE_ACK_IDS,
      session: { userId: owner.userId, sessionId: owner.sessionId },
    });
    expect((await readCageAck(squatter.userId)).acceptedAt).toBeTruthy();
  });
});

describe('it. 13 — preferences writers can never drop or set `security` (5.2)', () => {
  it('a write in flight across the takeover (auth passed before, write after) keeps security', async () => {
    const squatter = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    const auth = await verifyToken(squatter.accessToken); // requireSiweAuth passed
    beforeNextTransaction(async () => {
      await authService.oauthLogin(googleClaims());
    });

    await updateUserPreferences(auth.userId, (p) => ({ ...p, appearance: { skin: 'x', theme: 'dark' } }));

    const prefs = db.users.get(squatter.userId).preferences;
    expect(prefs.appearance).toEqual({ skin: 'x', theme: 'dark' });
    expect(typeof prefs.security.takeoverAt).toBe('string');
    expect(prefs.security.credentialsEpoch).toBe(prefs.security.takeoverAt);
  });

  it('lock → read → write, all inside ONE transaction (no snapshot read outside it)', async () => {
    const userId = seedPasskeyOnlyUser('user-prefs', { legal: { termsVersion: 'v1' } });
    let insideTx = false;
    prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
      insideTx = true;
      try {
        return await fn(prisma);
      } finally {
        insideTx = false;
      }
    });
    const seen: string[] = [];
    const record = (name: string) => () => void seen.push(`${name}:${insideTx}`);
    prisma.user.updateMany.mockImplementationOnce(async (args: any) => {
      record('lock')();
      return { count: db.users.has(args.where.id) ? 1 : 0 };
    });
    const originalFind = prisma.user.findUnique.getMockImplementation();
    prisma.user.findUnique.mockImplementationOnce(async (args: any) => {
      record('read')();
      return originalFind(args);
    });
    const originalUpdate = prisma.user.update.getMockImplementation();
    prisma.user.update.mockImplementationOnce(async (args: any) => {
      record('write')();
      return originalUpdate(args);
    });

    await updateUserPreferences(userId, (p) => ({ ...p, managerMode: true }));

    expect(seen).toEqual(['lock:true', 'read:true', 'write:true']);
    expect(db.users.get(userId).preferences).toEqual({ legal: { termsVersion: 'v1' }, managerMode: true });
  });

  it('a client patch can neither set, change nor remove security — and never sees it', async () => {
    const security = { credentialsEpoch: '2026-09-13T00:00:00.000Z', takeoverAt: '2026-09-13T00:00:00.000Z' };
    const userId = seedPasskeyOnlyUser('user-prefs', { security, legal: { termsVersion: 'v1' } });

    let visible: Record<string, unknown> = {};
    const returned = await updateUserPreferences(userId, (p) => {
      visible = p;
      return { managerMode: true, security: { credentialsEpoch: null } }; // drops legal, forges security
    });

    expect(visible).not.toHaveProperty('security');
    expect(returned).not.toHaveProperty('security');
    expect(db.users.get(userId).preferences).toEqual({ managerMode: true, security });

    await updateUserPreferences(userId, () => ({}));
    expect(db.users.get(userId).preferences).toEqual({ security });
  });

  it('on a row without security, a patch cannot create one', async () => {
    const userId = seedPasskeyOnlyUser('user-prefs', null);
    await updateUserPreferences(userId, (p) => ({ ...p, security: { credentialsEpoch: '2099-01-01T00:00:00.000Z' } }));
    expect(db.users.get(userId).preferences).toEqual({});
  });

  it('unknown user → user_not_found, nothing written', async () => {
    await expect(updateUserPreferences('nobody', (p) => p)).rejects.toMatchObject({ code: 'user_not_found' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  /**
   * productizer it. 22, 1.8 — A CORRUPT COLUMN IS NOT AN EMPTY ONE.
   *
   * `asObject(current) ?? {}` turned a `preferences` value that is not an object
   * into `{}`, so `hasOwnProperty('security')` was false and the next appearance
   * patch persisted a clean object WITHOUT `security`. And a row with no
   * `security` key reads as «there was no takeover», so every binding the
   * PREVIOUS holder attached came back to life — with a commit behind it.
   */
  it.each([
    ['a string', 'not-an-object'],
    ['an array', [1, 2, 3]],
    ['a number', 7],
  ])('a CORRUPT preferences column (%s) refuses the write instead of dropping security', async (_name, corrupt) => {
    const userId = seedPasskeyOnlyUser('user-corrupt', corrupt);

    await expect(
      updateUserPreferences(userId, (p) => ({ ...p, appearance: { skin: 'x', theme: 'dark' } })),
    ).rejects.toMatchObject({ code: 'preferences_unreadable', status: 409, retryable: false });

    // Nothing was written: the column is EXACTLY as it was.
    expect(db.users.get(userId).preferences).toEqual(corrupt);
    expect(prisma.user.update).not.toHaveBeenCalled();
    // And it still reads as «I could not read the floor» — never as «no takeover»,
    // which is what would resurrect a pre-takeover binding.
    expect(readTakeoverAtStrict(db.users.get(userId).preferences)).toEqual({ readable: false });
  });

  it('a PRE-TAKEOVER binding does not come back after an appearance write on a corrupt column', async () => {
    const userId = seedPasskeyOnlyUser('user-corrupt', 'not-an-object');
    db.bindings.push({
      id: 'b1',
      userId,
      address: XRPL_INTRUDER,
      isActive: true,
      signatureProof: '0xsig',
      linkedAt: new Date('2020-01-01T00:00:00.000Z'),
    });

    await expect(updateUserPreferences(userId, (p) => ({ ...p, onboarding: { lang: 'es' } }))).rejects.toMatchObject({
      code: 'preferences_unreadable',
    });

    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://test';
    try {
      const after = await provenAddressesDetailed(userId, null);
      expect(after.floorReadable).toBe(false);
      expect(after.failure).toBe('unreadable-floor');
      expect(after.addresses).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });

  /**
   * The takeover is the ONE writer that cannot refuse: the verified owner is
   * taking the account back. So it quarantines the unreadable value instead of
   * dropping it, and writes a well-formed `security` on top.
   */
  it('the takeover writes over a corrupt column, quarantining the raw value and never losing it', async () => {
    const at = new Date('2026-09-15T10:00:00.000Z');
    const owner = withCredentialsReset('not-an-object', at);
    expect(owner[QUARANTINED_PREFERENCES_KEY]).toBe('not-an-object');
    expect(owner.security).toEqual({
      credentialsEpoch: at.toISOString(),
      takeoverAt: at.toISOString(),
    });
    expect(readTakeoverAtStrict(owner)).toEqual({ readable: true, at });

    const split = splitTakeoverPreferences([1, 2], at);
    expect(split.owner[QUARANTINED_PREFERENCES_KEY]).toEqual([1, 2]);
    expect(readTakeoverAtStrict(split.owner)).toEqual({ readable: true, at });
    expect(split.quarantined).toEqual({});
  });

  it('the quarantined raw value is never shown to a caller, nor merged into', async () => {
    const userId = seedPasskeyOnlyUser('user-quarantined', {
      [QUARANTINED_PREFERENCES_KEY]: 'was-a-string',
      security: { takeoverAt: '2026-09-13T00:00:00.000Z' },
    });
    let visible: Record<string, unknown> = { seen: true };
    const returned = await updateUserPreferences(userId, (p) => {
      visible = p;
      return { ...p, managerMode: true, [QUARANTINED_PREFERENCES_KEY]: 'forged' };
    });
    expect(visible).not.toHaveProperty(QUARANTINED_PREFERENCES_KEY);
    expect(returned).not.toHaveProperty(QUARANTINED_PREFERENCES_KEY);
    expect(db.users.get(userId).preferences[QUARANTINED_PREFERENCES_KEY]).toBe('was-a-string');
    expect(db.users.get(userId).preferences.managerMode).toBe(true);
  });
});

describe('it. 13 — verifyToken with no preferences.security keeps today\'s behaviour', () => {
  it.each([
    ['null preferences', null],
    ['empty object', {}],
    ['other keys only', { appearance: { theme: 'dark' }, legal: { termsVersion: 'v1' } }],
    ['empty security', { security: {} }],
    ['security without an epoch (takeoverAt alone does not refuse sessions)', { security: { takeoverAt: '2026-09-13T00:00:00.000Z' } }],
    ['garbled epoch', { security: { credentialsEpoch: 'not-a-date' } }],
  ])('%s → no epoch, the live session is accepted', async (_label, preferences) => {
    const user = await authService.register(FOUNDER, SQUATTER_PASSWORD);
    db.users.get(user.userId).preferences = preferences;
    await expect(verifyToken(user.accessToken)).resolves.toMatchObject({ userId: user.userId, sessionId: user.sessionId });
  });
});
