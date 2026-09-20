/**
 * The Make Waves SourceTag on the institutional ceremony's unsigned
 * transactions: on what a USER signs in Xaman, never on what an account Astryum
 * operates signs.
 *
 * The case that made this necessary: `composeCredentialCreate` is shared with
 * ManagerNotaryIssuer, which signs it with Astryum's own issuer seed. Tagging
 * inside the composer would enrol our notary as project activity (T&C §7). So
 * the route decides, per signer — and this file pins that decision.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../../services/flare/AstryumPoteStateService', () => ({
  ...jest.requireActual('../../services/flare/AstryumPoteStateService'),
  readPoteState: jest.fn(),
  readHolderShares: jest.fn(),
}));

import institutionalRouter from '../institutional';
import { _resetXrplSourceTagCache } from '../../config/xrplSourceTag';

const app = express();
app.use(express.json());
app.use('/api/institutional', institutionalRouter);

const TAG = 2607090002;
const NOTARY = 'rHKxjrGRrCegQhLrdnXEPAeGyeJ1JR4Hae'; // Astryum's notary issuer
const USER_ROOT = 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG'; // a user's own root account
const SUBJECT = 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY';

const KEYS = [
  'INSTITUTIONAL_POTES_ENABLED',
  'XRPL_SOURCE_TAG',
  'ASTRYUM_ORDER_ANCHOR',
  'LEGACY_ORDER_ANCHOR',
  'MANAGER_CREDENTIAL_ISSUERS',
  'ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS',
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  process.env.XRPL_SOURCE_TAG = String(TAG);
  process.env.ASTRYUM_ORDER_ANCHOR = '';
  process.env.LEGACY_ORDER_ANCHOR = '';
  process.env.MANAGER_CREDENTIAL_ISSUERS = NOTARY;
  process.env.ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS = '';
  _resetXrplSourceTagCache();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  _resetXrplSourceTagCache();
});

describe('POST /credential-issue/prepare — the issuer signs', () => {
  it("Astryum's notary issuer → NO tag (our own account)", async () => {
    const res = await request(app)
      .post('/api/institutional/credential-issue/prepare')
      .send({ issuer: NOTARY, subject: SUBJECT, credentialType: 'KYC' });
    expect(res.status).toBe(200);
    expect(res.body.txjson.TransactionType).toBe('CredentialCreate');
    expect('SourceTag' in res.body.txjson).toBe(false);
  });

  it("a user's root designating an account → the project tag", async () => {
    const res = await request(app)
      .post('/api/institutional/credential-issue/prepare')
      .send({ issuer: USER_ROOT, subject: SUBJECT, credentialType: 'KYC' });
    expect(res.status).toBe(200);
    expect(res.body.txjson.SourceTag).toBe(TAG);
  });
});

describe('POST /credential-accept/prepare — the subject signs', () => {
  it('a user subject → the project tag', async () => {
    const res = await request(app)
      .post('/api/institutional/credential-accept/prepare')
      .send({ issuer: NOTARY, subject: SUBJECT });
    expect(res.status).toBe(200);
    expect(res.body.txjson.TransactionType).toBe('CredentialAccept');
    expect(res.body.txjson.SourceTag).toBe(TAG);
  });
});

describe('POST /domain/set/prepare — the exchange owner signs', () => {
  it('carries the project tag and keeps the domain shape', async () => {
    const res = await request(app)
      .post('/api/institutional/domain/set/prepare')
      .send({ owner: USER_ROOT, issuer: NOTARY, credentialType: 'KYC' });
    expect(res.status).toBe(200);
    expect(res.body.xrplTx.TransactionType).toBe('PermissionedDomainSet');
    expect(res.body.xrplTx.Account).toBe(USER_ROOT);
    expect(res.body.xrplTx.SourceTag).toBe(TAG);
  });
});
