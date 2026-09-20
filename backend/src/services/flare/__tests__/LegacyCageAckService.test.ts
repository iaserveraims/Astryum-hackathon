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
const userFindUnique = jest.fn();
// The write is guarded (identity/liveSession), so the double must answer the
// lock + session reads that guard takes before the auditLog.create runs.
const liveSession = {
  isActive: true,
  userId: 'live-user',
  createdAt: new Date(Date.now() - 60_000),
  expiresAt: new Date(Date.now() + 3_600_000),
};
jest.mock('../../../database/prismaClient', () => {
  const client: Record<string, unknown> = {
    auditLog: { findMany: (...a: unknown[]) => findMany(...a), create: (...a: unknown[]) => create(...a) },
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      updateMany: async () => ({ count: 1 }),
    },
    session: { findUnique: async () => ({ ...liveSession, userId: sessionUserId }) },
  };
  client.$transaction = async (fn: (tx: unknown) => unknown) => fn(client);
  return { prisma: client };
});

/** The user the mocked session belongs to — set per test before recordCageAck. */
let sessionUserId = 'u1';
/** A live session reference for `userId` (recordCageAck now requires one). */
function sessionFor(userId: string) {
  sessionUserId = userId;
  return { userId, sessionId: 's1' };
}

import { CAGE_ACK_IDS, CAGE_DISCLOSURE_VERSION, cageDisclosureHash } from '../../../config/cageDisclosure';
import {
  __resetCageAckCacheForTests,
  acknowledgementsComplete,
  cageAckGate,
  CAGE_ACK_REFUSAL_DETAIL,
  forgetCageAck,
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
    userFindUnique.mockReset();
    // No takeover on the account unless a test says otherwise.
    userFindUnique.mockResolvedValue({ preferences: null });
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

  // ── TRES LECTURAS DISTINTAS, TRES FRASES ─────────────────────────
  //
  // La puerta NO se mueve: guarda ENTRADAS (nacimiento de jaula, aporte a un
  // pote), capital que no vuelve a salir a una dirección, así que fallar cerrado
  // ahí es lo correcto. Lo que estaba mal era la FRASE: «no hay fila», «la marca
  // no parsea» y «la consulta reventó» salían las tres como «lee "How a cage
  // works" y confírmalo» — la misma mentira que acababa de quitar de la
  // puerta legal, viva en el otro lado de la casa. Y con la fila corrupta la
  // confirmación SÍ aterriza (va a auditLog, no a preferences), de modo que la
  // persona podía confirmar infinitas veces oyendo siempre que no lo ha leído.
  describe('el 409 dice POR QUÉ, y solo una de las cuatro causas se arregla leyendo', () => {
    it('no hay fila ⇒ «no_record», y la frase de siempre: leer y confirmar SÍ lo arregla', async () => {
      findMany.mockResolvedValue([]);
      expect((await readCageAck('c1')).cause).toBe('no_record');
      const gate = await cageAckGate('c1');
      expect(gate?.status).toBe(409);
      expect(gate?.body.error).toBe('CAGE_ACK_REQUIRED');
      expect(gate?.body.cause).toBe('no_record');
      expect(gate?.body.detail).toMatch(/Read “How a cage works” and confirm/);
    });

    it('la marca ilegible ⇒ «unreadable_mark», y NO le pide releer lo que ya leyó', async () => {
      findMany.mockResolvedValue([
        { timestamp: new Date('2026-09-14T10:00:01Z'), newValues: { version: CAGE_DISCLOSURE_VERSION } },
      ]);
      userFindUnique.mockResolvedValue({ preferences: { security: { takeoverAt: 'not a date' } } });
      const gate = await cageAckGate('c2');
      expect(gate?.status).toBe(409); // la puerta sigue CERRADA
      expect(gate?.body.cause).toBe('unreadable_mark');
      // Jamás la frase que nombra una acción que no puede funcionar…
      expect(gate?.body.detail).not.toMatch(/Read “How a cage works” and confirm/);
      // …y sí la vía real, más el hecho de que confirmar otra vez no sirve.
      expect(gate?.body.detail).toMatch(/Confirming again will not clear this/i);
      expect(gate?.body.detail).toMatch(/write to us/i);
      expect(gate?.body.detail).toMatch(/not in anything you did/i);
    });

    it('una cuenta que no aparece ⇒ «unreadable_mark»', async () => {
      findMany.mockResolvedValue([
        { timestamp: new Date('2026-09-14T10:00:01Z'), newValues: { version: CAGE_DISCLOSURE_VERSION } },
      ]);
      userFindUnique.mockResolvedValue(null);
      expect((await readCageAck('c3')).cause).toBe('unreadable_mark');
    });

    /**
     * LA MARCA ADELANTADA YA NO ES «LA MISMA CAUSA». Hasta aquí se
     * plegaba en `unreadable_mark`, cuya frase afirma «cannot be read … we will
     * repair the record» sobre una fila que se lee bien y que nadie tiene que
     * reparar: se cura sola cuando el reloj pasa la marca. Sigue cerrada (es una
     * ENTRADA) y confirmar sigue sin servir — pero la vía es «más tarde», no
     * «escríbenos».
     */
    it('una marca ADELANTADA ⇒ «ahead_of_clock», cerrada, y su frase no promete una reparación', async () => {
      findMany.mockResolvedValue([
        { timestamp: new Date('2026-09-14T10:00:01Z'), newValues: { version: CAGE_DISCLOSURE_VERSION } },
      ]);
      userFindUnique.mockResolvedValue({
        preferences: { security: { takeoverAt: new Date(Date.now() + 86_400_000).toISOString() } },
      });
      expect((await readCageAck('c4')).cause).toBe('ahead_of_clock');
      const gate = await cageAckGate('c4');
      expect(gate?.status).toBe(409); // la puerta sigue CERRADA: es una entrada
      expect(gate?.body.cause).toBe('ahead_of_clock');
      expect(gate?.body.detail).toMatch(/dated later than our own clock/i);
      expect(gate?.body.detail).toMatch(/clears on its own/i);
      expect(gate?.body.detail).toMatch(/Confirming again will not clear this/i);
      // Ni «read it», ni «cannot be read», ni «we will repair».
      expect(gate?.body.detail).not.toMatch(/Read “How a cage works” and confirm/);
      expect(gate?.body.detail).not.toMatch(/cannot be read/i);
      expect(gate?.body.detail).not.toMatch(/we will repair/i);
    });

    it('la consulta que revienta ⇒ «read_failed»: es un hecho sobre NUESTRA base', async () => {
      findMany.mockRejectedValue(new Error('db down'));
      const gate = await cageAckGate('c5');
      expect(gate?.status).toBe(409);
      expect(gate?.body.cause).toBe('read_failed');
      expect(gate?.body.detail).toMatch(/our database did not answer/i);
      expect(gate?.body.detail).not.toMatch(/Read “How a cage works” and confirm/);
    });

    it('ninguna de las cuatro frases acusa a la persona, y todas dicen que nada se movió', () => {
      for (const detail of Object.values(CAGE_ACK_REFUSAL_DETAIL)) {
        expect(detail).not.toMatch(/you have not (read|understood)/i);
        expect(detail).toMatch(/no capital has moved/i);
      }
      // Las cuatro son distintas: ese era el fallo entero (tres; La adelantada aparte).
      expect(new Set(Object.values(CAGE_ACK_REFUSAL_DETAIL)).size).toBe(4);
      // Y solo UNA pide leer y confirmar — la única que eso arregla.
      const asksToRead = Object.entries(CAGE_ACK_REFUSAL_DETAIL).filter(([, d]) => /Read “How a cage works” and confirm/.test(d));
      expect(asksToRead.map(([k]) => k)).toEqual(['no_record']);
    });

    it('un ack válido sigue abriendo la puerta y no lleva causa', async () => {
      findMany.mockResolvedValue([
        { timestamp: new Date('2026-08-06T10:00:00Z'), newValues: { version: CAGE_DISCLOSURE_VERSION } },
      ]);
      const status = await readCageAck('c6');
      expect(status.acceptedAt).toBe('2026-08-06T10:00:00.000Z');
      expect(status.cause).toBeUndefined();
      expect(await cageAckGate('c6')).toBeNull();
    });
  });

  // ── An ack belongs to the PERSON who read it ────────────────
  describe('an account takeover invalidates the acknowledgement on record', () => {
    const TAKEOVER = '2026-09-14T10:00:00.000Z';
    const ackAt = (iso: string) => [{ timestamp: new Date(iso), newValues: { version: CAGE_DISCLOSURE_VERSION } }];

    it('an ack written BEFORE the takeover does not count for the new holder', async () => {
      userFindUnique.mockResolvedValue({ preferences: { security: { takeoverAt: TAKEOVER } } });
      findMany.mockResolvedValue(ackAt('2026-09-14T09:59:59.000Z'));
      expect((await readCageAck('u6')).acceptedAt).toBeNull();
      expect((await cageAckGate('u6'))?.body.error).toBe('CAGE_ACK_REQUIRED');
    });

    it('the owner reading it AFTER the takeover opens the gate', async () => {
      userFindUnique.mockResolvedValue({ preferences: { security: { takeoverAt: TAKEOVER } } });
      findMany.mockResolvedValue(ackAt('2026-09-14T10:00:01.000Z'));
      expect((await readCageAck('u7')).acceptedAt).toBe('2026-09-14T10:00:01.000Z');
    });

    it('a takeover mark we cannot read is not consent, and neither is a missing account', async () => {
      findMany.mockResolvedValue(ackAt('2026-09-14T10:00:01.000Z'));
      userFindUnique.mockResolvedValue({ preferences: { security: { takeoverAt: 'not a date' } } });
      expect((await readCageAck('u8')).acceptedAt).toBeNull();
      userFindUnique.mockResolvedValue({ preferences: { security: 'nonsense' } });
      expect((await readCageAck('u9')).acceptedAt).toBeNull();
      userFindUnique.mockResolvedValue(null);
      expect((await readCageAck('u10')).acceptedAt).toBeNull();
      userFindUnique.mockRejectedValue(new Error('db down'));
      expect((await readCageAck('u11')).acceptedAt).toBeNull();
    });

    it('forgetCageAck drops a cached positive (the takeover calls it after committing)', async () => {
      findMany.mockResolvedValue(ackAt('2026-09-14T09:00:00.000Z'));
      expect((await readCageAck('u12')).acceptedAt).toBe('2026-09-14T09:00:00.000Z');
      // Same cache entry would have answered "accepted" for the whole TTL.
      userFindUnique.mockResolvedValue({ preferences: { security: { takeoverAt: TAKEOVER } } });
      forgetCageAck('u12');
      expect((await readCageAck('u12')).acceptedAt).toBeNull();
    });

    /**
     * Deleting the entry is not enough. A read that
     * STARTED before the takeover lands after it and calls `ackCache.set` with
     * the positive it computed on the pre-takeover row: the deletion is undone
     * and the owner funds a cage on a reading that was never theirs. The
     * tombstone (per user, stamped with the takeover instant) makes that late
     * write a no-op, and any entry computed against an older floor is discarded.
     */
    describe('a read in flight cannot re-seed the pre-takeover positive', () => {
      it('the late write is refused and the next read goes to the database', async () => {
        // A read that sees NO takeover (the row it read predates the handover).
        userFindUnique.mockResolvedValue({ preferences: null });
        findMany.mockResolvedValue(ackAt('2026-09-14T09:00:00.000Z'));
        const inFlight = readCageAck('u13');

        // …while the takeover commits and plants the tombstone.
        forgetCageAck('u13', new Date(TAKEOVER));

        // The in-flight read still answers what it saw — it cannot un-see it —
        // but it must NOT leave that answer in the cache.
        expect((await inFlight).acceptedAt).toBe('2026-09-14T09:00:00.000Z');

        // The next read is served from the database, now with the real floor,
        // and the pre-takeover ack does not count.
        userFindUnique.mockResolvedValue({ preferences: { security: { takeoverAt: TAKEOVER } } });
        findMany.mockClear();
        expect((await readCageAck('u13')).acceptedAt).toBeNull();
        expect(findMany).toHaveBeenCalled();
      });

      it('an entry cached BEFORE the tombstone is discarded on the next hit', async () => {
        userFindUnique.mockResolvedValue({ preferences: null });
        findMany.mockResolvedValue(ackAt('2026-09-14T09:00:00.000Z'));
        expect((await readCageAck('u14')).acceptedAt).toBe('2026-09-14T09:00:00.000Z');

        forgetCageAck('u14', new Date(TAKEOVER));
        userFindUnique.mockResolvedValue({ preferences: { security: { takeoverAt: TAKEOVER } } });
        expect((await readCageAck('u14')).acceptedAt).toBeNull();
      });

      it('a reading that DID see the handover is cached normally', async () => {
        forgetCageAck('u15', new Date(TAKEOVER));
        userFindUnique.mockResolvedValue({ preferences: { security: { takeoverAt: TAKEOVER } } });
        findMany.mockResolvedValue(ackAt('2026-09-14T10:00:01.000Z'));
        expect((await readCageAck('u15')).acceptedAt).toBe('2026-09-14T10:00:01.000Z');

        // Served from cache now: the entry's floor is the takeover itself.
        findMany.mockClear();
        expect((await readCageAck('u15')).acceptedAt).toBe('2026-09-14T10:00:01.000Z');
        expect(findMany).not.toHaveBeenCalled();
      });

      it('a SECOND takeover discards the entry the first one allowed', async () => {
        forgetCageAck('u16', new Date(TAKEOVER));
        userFindUnique.mockResolvedValue({ preferences: { security: { takeoverAt: TAKEOVER } } });
        findMany.mockResolvedValue(ackAt('2026-09-14T10:00:01.000Z'));
        expect((await readCageAck('u16')).acceptedAt).toBe('2026-09-14T10:00:01.000Z');

        const later = new Date('2026-09-15T10:00:00.000Z');
        forgetCageAck('u16', later);
        userFindUnique.mockResolvedValue({ preferences: { security: { takeoverAt: later.toISOString() } } });
        expect((await readCageAck('u16')).acceptedAt).toBeNull();
      });

      it('a write records the ack under the tombstone it already knows about', async () => {
        forgetCageAck('u17', new Date(TAKEOVER));
        create.mockResolvedValue({ timestamp: new Date('2026-09-14T10:30:00.000Z') });
        await recordCageAck({ userId: 'u17', account: null, acknowledgements: CAGE_ACK_IDS, session: sessionFor('u17') });
        // Served from the cache the write primed — the owner just read it.
        findMany.mockReset();
        expect(await cageAckGate('u17')).toBeNull();
        expect(findMany).not.toHaveBeenCalled();
      });
    });
  });

  // ── The guard is not optional ───────────────────────
  it('refuses to record an ack with no live session — the reading would belong to nobody', async () => {
    create.mockResolvedValue({ timestamp: new Date('2026-08-06T12:00:00Z') });
    const { isSessionRevoked } = await import('../../identity/liveSession');
    for (const session of [null, { userId: 'u20', sessionId: '' }] as const) {
      const err = await recordCageAck({
        userId: 'u20',
        account: null,
        acknowledgements: CAGE_ACK_IDS,
        session: session as never,
      }).then(() => null, (e) => e);
      expect(isSessionRevoked(err)).toBe(true);
    }
    // Nothing written: an unattributable acknowledgement is not an acknowledgement.
    expect(create).not.toHaveBeenCalled();
  });

  it('records the SERVER hash, never a hash the client claimed', async () => {
    create.mockResolvedValue({ timestamp: new Date('2026-08-06T12:00:00Z') });
    await recordCageAck({ userId: 'u4', account: 'rCouncil', acknowledgements: CAGE_ACK_IDS, session: sessionFor('u4') });
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
