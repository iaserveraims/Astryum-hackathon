/**
 * The cage disclosure gate — the acknowledgement that must exist before capital
 * can enter a one-way vessel.
 *
 * Pins three contracts:
 *  1. THE TEXT CANNOT DRIFT SILENTLY. The version+hash pair is asserted against
 *     a literal. Reword the disclosure and this test goes red — which is the
 *     point: the edit must also bump CAGE_DISCLOSURE_VERSION (so every user
 *     re-reads) and update the pin here, deliberately, in the same PR.
 *  2. FAIL-CLOSED. No session, an ack for an older version, or a database we
 *     cannot read ⇒ no ack. Seconds of friction against a capital movement with
 *     no way back.
 *  3. ALL FOUR BOXES. A partial (or padded) set is not an acknowledgement.
 */

const findMany = jest.fn();
const create = jest.fn();
jest.mock('../../../database/prismaClient', () => ({
  prisma: { auditLog: { findMany: (...a: unknown[]) => findMany(...a), create: (...a: unknown[]) => create(...a) } },
}));

import { CAGE_ACK_IDS, CAGE_DISCLOSURE_VERSION, cageDisclosureHash } from '../../../config/cageDisclosure';
import {
  __resetCageAckCacheForTests,
  acknowledgementsComplete,
  cageAckGate,
  readCageAck,
  recordCageAck,
} from '../LegacyCageAckService';

describe('cage disclosure', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env };
    delete process.env.ALLOW_NO_AUTH;
    findMany.mockReset();
    create.mockReset();
    __resetCageAckCacheForTests();
  });
  afterEach(() => {
    process.env = env;
  });

  it('the text is pinned: a reword must bump the version and update this line', () => {
    expect({ version: CAGE_DISCLOSURE_VERSION, hash: cageDisclosureHash() }).toEqual({
      version: 1,
      hash: '2bff23a1655602ebaf2eea51c590d289c35863555c3b15b4302637dc4d954e9c',
    });
  });

  it('needs every acknowledgement, no more and no less', () => {
    expect(acknowledgementsComplete(CAGE_ACK_IDS)).toBe(true);
    expect(acknowledgementsComplete(CAGE_ACK_IDS.slice(1))).toBe(false);
    expect(acknowledgementsComplete([...CAGE_ACK_IDS, 'invented'])).toBe(false);
    expect(acknowledgementsComplete('all of them')).toBe(false);
  });

  it('no session ⇒ no ack, and the gate refuses', async () => {
    expect((await readCageAck(undefined)).acceptedAt).toBeNull();
    const gate = await cageAckGate(undefined);
    expect(gate?.status).toBe(409);
    expect(gate?.body.error).toBe('CAGE_ACK_REQUIRED');
  });

  it('an ack for an older version does not count', async () => {
    findMany.mockResolvedValue([
      { timestamp: new Date('2026-08-01T10:00:00Z'), newValues: { version: CAGE_DISCLOSURE_VERSION - 1 } },
    ]);
    expect((await readCageAck('u1')).acceptedAt).toBeNull();
    expect((await cageAckGate('u1'))?.body.error).toBe('CAGE_ACK_REQUIRED');
  });

  it('an ack for the current version opens the gate', async () => {
    findMany.mockResolvedValue([
      { timestamp: new Date('2026-08-06T10:00:00Z'), newValues: { version: CAGE_DISCLOSURE_VERSION } },
    ]);
    expect((await readCageAck('u2')).acceptedAt).toBe('2026-08-06T10:00:00.000Z');
    expect(await cageAckGate('u2')).toBeNull();
  });

  it('never caches a "not accepted": another replica may have just written one', async () => {
    findMany.mockResolvedValueOnce([]);
    expect((await readCageAck('u5')).acceptedAt).toBeNull();
    findMany.mockResolvedValueOnce([
      { timestamp: new Date('2026-08-06T11:00:00Z'), newValues: { version: CAGE_DISCLOSURE_VERSION } },
    ]);
    expect((await readCageAck('u5')).acceptedAt).toBe('2026-08-06T11:00:00.000Z');
  });

  it('fail-closed when the audit table cannot be read', async () => {
    findMany.mockRejectedValue(new Error('db down'));
    expect((await readCageAck('u3')).acceptedAt).toBeNull();
    expect((await cageAckGate('u3'))?.status).toBe(409);
  });

  it('the dev bypass mirrors requireSiweAuth, and never applies in production', async () => {
    process.env.ALLOW_NO_AUTH = '1';
    process.env.NODE_ENV = 'development';
    expect(await cageAckGate(undefined)).toBeNull();
    process.env.NODE_ENV = 'production';
    expect((await cageAckGate(undefined))?.status).toBe(409);
  });

  it('records the SERVER hash, never a hash the client claimed', async () => {
    create.mockResolvedValue({ timestamp: new Date('2026-08-06T12:00:00Z') });
    await recordCageAck({ userId: 'u4', account: 'rCouncil', acknowledgements: CAGE_ACK_IDS });
    const written = create.mock.calls[0][0].data;
    expect(written.newValues.hash).toBe(cageDisclosureHash());
    expect(written.newValues.version).toBe(CAGE_DISCLOSURE_VERSION);
    expect(written.resource).toBe('rCouncil');
    // And the write primes the cache — the gate right after must not re-query.
    findMany.mockReset();
    expect(await cageAckGate('u4')).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});
