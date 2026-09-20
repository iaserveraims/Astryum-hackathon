/**
 * 3.8 — AN ORPHAN SUB-ORG THAT LIVES ONLY IN A ROTATED LOG
 * IS NOT RECONCILIABLE.
 *
 * `POST /api/wallets/embedded/create` talks to Turnkey first and writes our row
 * second. When the second half fails, a sub-org exists at Turnkey holding a key
 * only the user's passkey can reach, and nothing in our database points at it.
 * Made that greppable; a log line on a platform that rotates logs is a
 * record for about a week. Here: it lands in a durable `background_jobs` row of
 * its own job type, the write is READ BACK (kvUpsert swallows its own failure),
 * and an admin sees it in the panel's alert inbox either way.
 */

const mockKvUpsert = jest.fn();
const mockKvGetStrict = jest.fn();
const mockKvList = jest.fn();
const mockKvListStrict = jest.fn();
jest.mock('../../persistence/backgroundJobKv', () => ({
  kvUpsert: (...a: unknown[]) => mockKvUpsert(...a),
  kvGetStrict: (...a: unknown[]) => mockKvGetStrict(...a),
  kvList: (...a: unknown[]) => mockKvList(...a),
  kvListStrict: (...a: unknown[]) => mockKvListStrict(...a),
}));

const mockOpsAlert = jest.fn();
jest.mock('../../OpsAlertService', () => ({
  opsAlert: (...a: unknown[]) => mockOpsAlert(...a),
}));

import {
  ORPHAN_SUBORG_JOB_TYPE,
  ORPHAN_SUBORG_KEY_FIELD,
  listOrphanSubOrgs,
  listOrphanSubOrgsStrict,
  orphanSubOrgPayload,
  orphanSubOrgRecordMatches,
  recordOrphanSubOrg,
} from '../orphanSubOrgLedger';

const SUB_ORG = 'suborg-abc123';
const USER = 'user-1';
const ADDRESS = '0xEabCD745000000000000000000000000000000cd';

let warn: jest.SpyInstance;
let err: jest.SpyInstance;
/** The one row the fake background_jobs store holds for this sub-org. */
let kvStore: Record<string, unknown> | null = null;
beforeEach(() => {
  jest.clearAllMocks();
  // The happy path is a store that REALLY wrote what it was given: the read-back
  // now compares the PAYLOAD (task 4), so a stub that echoed only the
  // key would be asserting the very bug this closes. A test that wants a lost
  // write overrides `mockKvGetStrict` directly, which replaces this.
  kvStore = null;
  mockKvUpsert.mockImplementation(async (_jobType, _keyField, _key, payload) => {
    kvStore = payload as Record<string, unknown>;
  });
  mockKvGetStrict.mockImplementation(async () => kvStore);
  mockKvList.mockResolvedValue([]);
  mockKvListStrict.mockResolvedValue([]);
  mockOpsAlert.mockResolvedValue(undefined);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
  err.mockRestore();
});

describe('orphanSubOrgPayload', () => {
  it('carries the four things a reconciliation needs, and never a raw undefined', () => {
    const rec = orphanSubOrgPayload({
      subOrgId: SUB_ORG,
      userId: USER,
      address: ADDRESS,
      reason: 'account-busy',
      error: Object.assign(new Error('deadlock detected'), { name: 'PrismaClientKnownRequestError' }),
      at: '2026-09-15T10:00:00.000Z',
    });
    expect(rec).toEqual({
      subOrgId: SUB_ORG,
      userId: USER,
      address: ADDRESS,
      reason: 'account-busy',
      errorName: 'PrismaClientKnownRequestError',
      errorMessage: 'deadlock detected',
      at: '2026-09-15T10:00:00.000Z',
      reconciled: false,
    });
  });

  it('survives an error that is not an Error', () => {
    const rec = orphanSubOrgPayload({ subOrgId: SUB_ORG, userId: USER, reason: 'write-failed', error: 'boom' });
    expect(rec.errorName).toBe('Error');
    expect(rec.errorMessage).toBe('unknown');
    expect(rec.address).toBe('');
  });
});

describe('recordOrphanSubOrg', () => {
  it('writes the DURABLE row under its own job type, keyed by the sub-org', async () => {
    const out = await recordOrphanSubOrg({
      subOrgId: SUB_ORG,
      userId: USER,
      address: ADDRESS,
      reason: 'session-revoked',
      error: new Error('session_revoked'),
    });
    expect(out.persisted).toBe(true);
    expect(mockKvUpsert).toHaveBeenCalledTimes(1);
    const [jobType, keyField, key, payload] = mockKvUpsert.mock.calls[0];
    expect(jobType).toBe(ORPHAN_SUBORG_JOB_TYPE);
    expect(keyField).toBe(ORPHAN_SUBORG_KEY_FIELD);
    expect(key).toBe(SUB_ORG);
    expect(payload).toMatchObject({ subOrgId: SUB_ORG, userId: USER, address: ADDRESS, reason: 'session-revoked' });
  });

  it('keeps the greppable log line and raises the admin alert with a runbook', async () => {
    await recordOrphanSubOrg({ subOrgId: SUB_ORG, userId: USER, address: ADDRESS, reason: 'write-failed' });
    expect(warn.mock.calls.map(String).join(' ')).toContain('orphan-suborg');
    const [source, level, message, opts] = mockOpsAlert.mock.calls[0];
    expect(source).toBe('turnkey');
    expect(level).toBe('critical');
    expect(message).toContain(SUB_ORG);
    expect(opts.key).toBe(`orphan-suborg:${SUB_ORG}`);
    expect(opts.runbook).toMatch(/turnkey-orphan-suborg/);
    expect(opts.facts).toMatchObject({ subOrgId: SUB_ORG, userId: USER, address: ADDRESS, durableRecord: true });
  });

  /**
   * kvUpsert swallows its own database failure and returns as if it had written.
   * «It returned» is not «it is written»: the read-back is what makes the claim,
   * and when it fails the alert SAYS the log is the only copy.
   */
  it('a swallowed write is not reported as a record', async () => {
    mockKvGetStrict.mockResolvedValue(null);
    const out = await recordOrphanSubOrg({ subOrgId: SUB_ORG, userId: USER, reason: 'write-failed' });
    expect(out.persisted).toBe(false);
    expect(mockOpsAlert.mock.calls[0][2]).toMatch(/durable record could not be written/i);
    expect(mockOpsAlert.mock.calls[0][3].facts.durableRecord).toBe(false);
    expect(err.mock.calls.map(String).join(' ')).toMatch(/NOT PERSISTED/);
  });

  it('a read-back that THROWS is not a record either', async () => {
    mockKvGetStrict.mockRejectedValue(new Error('db down'));
    const out = await recordOrphanSubOrg({ subOrgId: SUB_ORG, userId: USER, reason: 'write-failed' });
    expect(out.persisted).toBe(false);
    expect(mockOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('never throws, whatever fails — recording an orphan cannot break the response', async () => {
    mockKvUpsert.mockRejectedValue(new Error('db down'));
    mockOpsAlert.mockRejectedValue(new Error('no channel'));
    await expect(
      recordOrphanSubOrg({ subOrgId: SUB_ORG, userId: USER, reason: 'write-failed' }),
    ).resolves.toEqual({ persisted: false });
  });

  it('nothing is recorded when there is no sub-org to record', async () => {
    const out = await recordOrphanSubOrg({ subOrgId: '', userId: USER, reason: 'write-failed' });
    expect(out.persisted).toBe(false);
    expect(mockKvUpsert).not.toHaveBeenCalled();
    expect(mockOpsAlert).not.toHaveBeenCalled();
  });
});

describe('listOrphanSubOrgs', () => {
  it('lists what is on record and drops malformed rows', async () => {
    mockKvList.mockResolvedValue([{ subOrgId: SUB_ORG, userId: USER }, { nothing: true }, { subOrgId: '' }]);
    const rows = await listOrphanSubOrgs();
    expect(rows).toHaveLength(1);
    expect(rows[0].subOrgId).toBe(SUB_ORG);
    expect(mockKvList).toHaveBeenCalledWith(ORPHAN_SUBORG_JOB_TYPE, 200);
  });
});
