/**
 * The Make Waves SourceTag on the credential tray's unsigned transactions —
 * exactly on what a USER signs, never on what an account Astryum operates signs.
 *
 * Why it is its own file: the tag rule cuts across every POST of the router and
 * depends on env (the project tag, the anchors, the accepted issuers). Keeping
 * that env setup here leaves the behaviour tests of xrplCredentials.test.ts
 * untouched.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../../services/XrplCredentialVerifier', () => ({
  ...jest.requireActual('../../services/XrplCredentialVerifier'),
  readAccountCredentials: jest.fn(),
}));

import router from '../xrplCredentials';
import { _resetXrplSourceTagCache } from '../../config/xrplSourceTag';

const app = express();
app.use(express.json());
app.use('/api/xrpl-credentials', router);

const TAG = 2607090002;
const ASTRYUM_ANCHOR = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const LEGACY_ANCHOR = 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm';
const NOTARY = 'rHKxjrGRrCegQhLrdnXEPAeGyeJ1JR4Hae';
const USER_ANCHOR = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const SUBJECT = 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY';
const ISSUER = 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG';

const KEYS = [
  'XRPL_SOURCE_TAG',
  'ASTRYUM_ORDER_ANCHOR',
  'LEGACY_ORDER_ANCHOR',
  'MANAGER_CREDENTIAL_ISSUERS',
  'ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS',
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.XRPL_SOURCE_TAG = String(TAG);
  process.env.ASTRYUM_ORDER_ANCHOR = ASTRYUM_ANCHOR;
  process.env.LEGACY_ORDER_ANCHOR = LEGACY_ANCHOR;
  process.env.MANAGER_CREDENTIAL_ISSUERS = NOTARY;
  process.env.ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS = '';
  _resetXrplSourceTagCache();
});

afterAll(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  _resetXrplSourceTagCache();
});

describe('POST accept/prepare — the subject signs', () => {
  it('a user subject gets the project tag', async () => {
    const res = await request(app).post('/api/xrpl-credentials/accept/prepare').send({ issuer: ISSUER, subject: SUBJECT });
    expect(res.status).toBe(200);
    expect(res.body.txjson.TransactionType).toBe('CredentialAccept');
    expect(res.body.txjson.SourceTag).toBe(TAG);
  });

  it('a subject Astryum operates gets NO tag', async () => {
    process.env.ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS = SUBJECT;
    const res = await request(app).post('/api/xrpl-credentials/accept/prepare').send({ issuer: ISSUER, subject: SUBJECT });
    expect(res.status).toBe(200);
    expect('SourceTag' in res.body.txjson).toBe(false);
  });
});

describe('POST domain/prepare — the manager signs', () => {
  it('carries the project tag', async () => {
    const res = await request(app).post('/api/xrpl-credentials/domain/prepare').send({ account: USER_ANCHOR, domain: 'gestora.example' });
    expect(res.status).toBe(200);
    expect(res.body.txjson.TransactionType).toBe('AccountSet');
    expect(res.body.txjson.SourceTag).toBe(TAG);
  });
});

describe('anchor gate — the anchor owner signs', () => {
  it("Astryum's own anchor (ASTRYUM_ORDER_ANCHOR) → deposit-auth goes out WITHOUT the tag", async () => {
    const res = await request(app).post('/api/xrpl-credentials/anchor/deposit-auth/prepare').send({ anchor: ASTRYUM_ANCHOR });
    expect(res.status).toBe(200);
    expect(res.body.txjson.TransactionType).toBe('AccountSet');
    expect('SourceTag' in res.body.txjson).toBe(false);
  });

  it('the legacy anchor (LEGACY_ORDER_ANCHOR) → authorize-credentials WITHOUT the tag', async () => {
    const res = await request(app)
      .post('/api/xrpl-credentials/anchor/authorize-credentials/prepare')
      .send({ anchor: LEGACY_ANCHOR, credentials: [{ issuer: NOTARY, credentialType: 'AIFM' }] });
    expect(res.status).toBe(200);
    expect(res.body.txjson.TransactionType).toBe('DepositPreauth');
    expect('SourceTag' in res.body.txjson).toBe(false);
  });

  it("a user's own anchor → the tag, because a user signs it", async () => {
    const res = await request(app).post('/api/xrpl-credentials/anchor/deposit-auth/prepare').send({ anchor: USER_ANCHOR });
    expect(res.status).toBe(200);
    expect(res.body.txjson.SourceTag).toBe(TAG);
  });
});
