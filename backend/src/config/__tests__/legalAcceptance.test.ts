/**
 * Legal acceptance gate — the pure logic behind GET /me `legal` and
 * POST /auth/legal-accept (founder 2026-07-30: both published legal pages
 * must be presented at first dashboard entry and the acceptance recorded).
 */
import {
  computeLegalStatus,
  unreadableLegalStatus,
  withLegalAcceptance,
  PRIVACY_NOTICE_VERSION,
} from '../legalAcceptance';

const TERMS = '2026-07-30';

describe('computeLegalStatus — who gets the gate', () => {
  it('requires the gate for a blank account (wallet-first / SIWE users)', () => {
    expect(computeLegalStatus(null, TERMS).required).toBe(true);
    expect(computeLegalStatus(undefined, TERMS).required).toBe(true);
    expect(computeLegalStatus({}, TERMS).required).toBe(true);
  });

  it('requires the gate for an account that accepted an OLDER terms version (the €50-cap bump)', () => {
    const prefs = {
      legal: { termsVersion: '2026-07-26', privacyVersion: PRIVACY_NOTICE_VERSION, acceptedAt: 'x' },
    };
    expect(computeLegalStatus(prefs, TERMS).required).toBe(true);
  });

  it('requires the gate when only the register click-wrap exists (privacy never presented)', () => {
    // Fresh email signup: demoTerms current, but the privacy notice record is missing.
    const prefs = { demoTerms: { version: TERMS, acceptedAt: 'x' } };
    expect(computeLegalStatus(prefs, TERMS).required).toBe(true);
  });

  it('does NOT require the gate once the unified record carries both current versions', () => {
    const prefs = withLegalAcceptance({}, TERMS);
    expect(computeLegalStatus(prefs, TERMS).required).toBe(false);
  });

  it('register click-wrap at the current version satisfies the TERMS half (no double-ask semantics)', () => {
    const prefs = {
      demoTerms: { version: TERMS, acceptedAt: 'x' },
      legal: { termsVersion: 'stale', privacyVersion: PRIVACY_NOTICE_VERSION, acceptedAt: 'x' },
    };
    // terms via demoTerms fallback + privacy via legal ⇒ gate closed
    expect(computeLegalStatus(prefs, TERMS).required).toBe(false);
  });

  it('says WHY the gate is open, so the client asks only for what changed (2026-09-13)', () => {
    expect(computeLegalStatus(null, TERMS).reason).toBe('first');
    expect(computeLegalStatus(null, TERMS).accepted).toBeNull();
    // Terms bumped, privacy current ⇒ only the terms are re-presented.
    const termsStale = { legal: { termsVersion: 'old', privacyVersion: PRIVACY_NOTICE_VERSION, acceptedAt: 'x' } };
    expect(computeLegalStatus(termsStale, TERMS).reason).toBe('terms');
    // Privacy bumped, terms current ⇒ only the notice is re-presented.
    const privacyStale = { legal: { termsVersion: TERMS, privacyVersion: 'old', acceptedAt: 'x' } };
    expect(computeLegalStatus(privacyStale, TERMS).reason).toBe('privacy');
    // Register click-wrap only ⇒ terms current, privacy never presented ⇒ 'privacy'.
    const clickWrap = { demoTerms: { version: TERMS, acceptedAt: 'y' } };
    const s = computeLegalStatus(clickWrap, TERMS);
    expect(s.reason).toBe('privacy');
    expect(s.accepted).toEqual({ termsVersion: TERMS, privacyVersion: null, acceptedAt: 'y' });
    // Both stale ⇒ both.
    const bothStale = { legal: { termsVersion: 'old', privacyVersion: 'old', acceptedAt: 'x' } };
    expect(computeLegalStatus(bothStale, TERMS).reason).toBe('both');
    // Closed gate ⇒ no reason, record still reported.
    const fine = withLegalAcceptance({}, TERMS, new Date('2026-09-13T10:00:00Z'));
    expect(computeLegalStatus(fine, TERMS).reason).toBeNull();
    expect(computeLegalStatus(fine, TERMS).accepted?.acceptedAt).toBe('2026-09-13T10:00:00.000Z');
  });

  // ── it. 15 (4.2) — a click-wrap is a PERSON's signature ───────────────────
  describe('an account takeover re-opens the gate for the new holder', () => {
    const TAKEOVER = '2026-09-14T10:00:00.000Z';
    const security = { security: { credentialsEpoch: TAKEOVER, takeoverAt: TAKEOVER } };

    it('an acceptance stamped BEFORE the takeover does not count', () => {
      const prefs = { ...security, ...withLegalAcceptance({}, TERMS, new Date('2026-09-14T09:00:00Z')) };
      const status = computeLegalStatus(prefs, TERMS);
      expect(status.required).toBe(true);
      expect(status.reason).toBe('first');
      expect(status.accepted).toBeNull();
    });

    it('the register click-wrap of the previous holder does not satisfy the terms half either', () => {
      const prefs = { ...security, demoTerms: { version: TERMS, acceptedAt: '2026-09-14T09:00:00.000Z' } };
      expect(computeLegalStatus(prefs, TERMS).accepted).toBeNull();
      expect(computeLegalStatus(prefs, TERMS).required).toBe(true);
    });

    it('the new holder signing AFTER the takeover closes it', () => {
      const prefs = { ...security, ...withLegalAcceptance({}, TERMS, new Date('2026-09-14T10:00:01Z')) };
      expect(computeLegalStatus(prefs, TERMS).required).toBe(false);
    });

    it('an acceptance with no date, under a READABLE takeover, is asked again', () => {
      const undated = { ...security, legal: { termsVersion: TERMS, privacyVersion: PRIVACY_NOTICE_VERSION } };
      expect(computeLegalStatus(undated, TERMS).required).toBe(true);
      expect(computeLegalStatus(undated, TERMS).unreadable).toBe(false);
    });

    it('an account that was never taken over is untouched by the rule', () => {
      const prefs = withLegalAcceptance({}, TERMS);
      expect(computeLegalStatus(prefs, TERMS).required).toBe(false);
      expect(computeLegalStatus({ security: {}, ...prefs }, TERMS).required).toBe(false);
      expect(computeLegalStatus({ security: { credentialsEpoch: TAKEOVER }, ...prefs }, TERMS).required).toBe(false);
    });
  });

  // ── it. 27 — LA OTRA PUERTA DEL MISMO BUCLE ───────────────────────────────
  //
  // It. 25 cerró el bucle que entraba por la LEGIBILIDAD. Pero la condición que
  // abre la ceremonia no es «la marca parsea»: es `acceptedAt > takeoverAt`. Una
  // marca de toma de posesión que parsea LIMPIO y queda POR DELANTE del reloj
  // del servidor produce exactamente el mismo bucle —ninguna firma futura puede
  // superarla— y salía con `unreadable: false`, así que el tercer estado no la
  // capturaba. Llega por desfase de reloj entre réplicas, por una reparación
  // manual de la fila o por una copia del espejo de cuentas.
  describe('una marca de toma de posesión ADELANTADA no encierra a nadie', () => {
    const NOW = new Date('2026-09-15T12:00:00.000Z');
    const FUTURO = '2027-01-01T00:00:00.000Z';
    const adelantada = { security: { credentialsEpoch: FUTURO, takeoverAt: FUTURO } };

    it('CADENA: firmar, releer, firmar — y la ceremonia no vuelve NUNCA', () => {
      // Día uno: la cuenta tiene la marca adelantada y nada firmado.
      let prefs: Record<string, unknown> = { ...adelantada };
      for (let intento = 0; intento < 3; intento++) {
        const status = computeLegalStatus(prefs, TERMS, NOW);
        // EL ARREGLO, EN UNA LÍNEA: la puerta NO se levanta sobre esta fila.
        expect(status.required).toBe(false);
        expect(status.unreadable).toBe(true);
        // Y la firma SÍ aterriza (la fila es un objeto bien formado, así que
        // `applyPreferencesUpdate` no la rechaza: no hay 409 que avise).
        prefs = withLegalAcceptance(prefs, TERMS, new Date(NOW.getTime() + intento * 1000));
        expect((prefs.legal as { acceptedAt: string }).acceptedAt).toBeTruthy();
      }
      // Antes de it. 27, las tres vueltas devolvían `required: true` y la
      // ceremonia —no descartable— volvía en cada /auth/me, para siempre.
      expect(computeLegalStatus(prefs, TERMS, NOW).required).toBe(false);
    });

    it('no enseña una firma que no puede atribuir, ni inventa un motivo', () => {
      const prefs = { ...adelantada, ...withLegalAcceptance({}, TERMS, NOW) };
      const status = computeLegalStatus(prefs, TERMS, NOW);
      expect(status.accepted).toBeNull();
      expect(status.reason).toBeNull();
      // Misma forma exacta que el tercer estado de it. 25: una sola respuesta
      // para «no pude establecer qué firmó esta cuenta».
      expect(status).toEqual(unreadableLegalStatus(TERMS));
    });

    it('la marca EXACTAMENTE en el ahora sigue siendo una marca válida', () => {
      // No es adelantada: `>` estricto. Una firma posterior cuenta, como siempre.
      const prefs = {
        security: { takeoverAt: NOW.toISOString() },
        ...withLegalAcceptance({}, TERMS, new Date(NOW.getTime() + 1000)),
      };
      const status = computeLegalStatus(prefs, TERMS, NOW);
      expect(status.unreadable).toBe(false);
      expect(status.required).toBe(false);
    });

    it('no se ha aflojado el suelo: una marca PASADA sigue invalidando lo anterior', () => {
      const PASADA = '2026-09-14T10:00:00.000Z';
      const prefs = {
        security: { takeoverAt: PASADA },
        ...withLegalAcceptance({}, TERMS, new Date('2026-09-14T09:00:00Z')),
      };
      const status = computeLegalStatus(prefs, TERMS, NOW);
      expect(status.unreadable).toBe(false);
      expect(status.required).toBe(true);
      expect(status.accepted).toBeNull();
    });

    it('cuando el reloj alcanza la marca, la fila vuelve a leerse y se pide firmar', () => {
      // El caso REAL de desfase entre réplicas: se cura solo, sin ventana de
      // tolerancia y sin admitir jamás la firma del poseedor anterior.
      const prefs = { security: { takeoverAt: FUTURO }, ...withLegalAcceptance({}, TERMS, NOW) };
      const despues = new Date('2027-01-02T00:00:00.000Z');
      const status = computeLegalStatus(prefs, TERMS, despues);
      expect(status.unreadable).toBe(false);
      expect(status.required).toBe(true);
    });
  });

  // ── it. 25 — «no pude leer tu ficha» NO ES UNA CÁRCEL ─────────────────────
  //
  // The takeover mark is read STRICTLY on purpose (a mark nobody can parse must
  // never let a previous holder's click-wrap pass as this person's signature).
  // That strictness used to arrive at the client as `required: true`, and
  // `required: true` mounts a modal with no X, no Escape and no backdrop, in
  // front of the whole /app tree — exits included. Its only button posts
  // /auth/legal-accept, which answers 409 PREFERENCES_UNREADABLE, not
  // retryable. The person was locked out of their own application by OUR
  // unreadable row. Now the unreadable case is its OWN state.
  describe('an unreadable record is the third state, not «you have not signed»', () => {
    const CORRUPT: unknown[] = [
      // The whole column is not an object (the shape that ALSO makes
      // /auth/legal-accept refuse — the closed loop).
      'oops',
      42,
      [1, 2],
      // The column parses but `security` does not.
      { security: 'nope', ...withLegalAcceptance({}, TERMS) },
      { security: ['nope'], ...withLegalAcceptance({}, TERMS) },
      // `security` parses but `takeoverAt` is not an instant (the shape where
      // the WRITE lands and the gate re-opens for ever: an infinite signature).
      { security: { takeoverAt: 'not a date' }, ...withLegalAcceptance({}, TERMS) },
      { security: { takeoverAt: 12345 }, ...withLegalAcceptance({}, TERMS) },
    ];

    it.each(CORRUPT.map((c) => [JSON.stringify(c) ?? String(c), c] as const))(
      'does NOT block the app: %s',
      (_label, prefs) => {
        const status = computeLegalStatus(prefs, TERMS);
        expect(status.unreadable).toBe(true);
        // THE POINT OF THE WHOLE ITERATION: no door.
        expect(status.required).toBe(false);
      },
    );

    it('never claims the person failed to sign, and never shows a signature it cannot attribute', () => {
      const prefs = { security: { takeoverAt: 'not a date' }, ...withLegalAcceptance({}, TERMS) };
      const status = computeLegalStatus(prefs, TERMS);
      // `reason` is «why the gate is open» — there is no open gate to explain,
      // and 'first' would have been a lie («nothing on record») about a row we
      // simply could not read.
      expect(status.reason).toBeNull();
      // The stored acceptance is NOT echoed: we cannot prove it belongs to
      // whoever holds the account now, which is exactly what the strict read
      // exists to stop.
      expect(status.accepted).toBeNull();
      // Versions still travel, so the client can name the current texts.
      expect(status.termsVersion).toBe(TERMS);
      expect(status.privacyVersion).toBe(PRIVACY_NOTICE_VERSION);
    });

    it('the shape the route sends on the 409 is the same status /auth/me computes', () => {
      expect(unreadableLegalStatus(TERMS)).toEqual(computeLegalStatus('corrupt-column', TERMS));
    });

    it('a READABLE row keeps both of the old answers, unreadable:false', () => {
      expect(computeLegalStatus(null, TERMS)).toMatchObject({ required: true, unreadable: false });
      expect(computeLegalStatus(withLegalAcceptance({}, TERMS), TERMS)).toMatchObject({
        required: false,
        unreadable: false,
      });
      // An EMPTY `security` object, or one with only the epoch, reads fine.
      expect(computeLegalStatus({ security: {}, ...withLegalAcceptance({}, TERMS) }, TERMS).unreadable).toBe(false);
    });
  });

  it('always reports the CURRENT versions for the client to display', () => {
    const s = computeLegalStatus(null, TERMS);
    expect(s.termsVersion).toBe(TERMS);
    expect(s.privacyVersion).toBe(PRIVACY_NOTICE_VERSION);
  });
});

describe('withLegalAcceptance — the record that gets stored', () => {
  it('stamps both versions and an ISO timestamp', () => {
    const now = new Date('2026-07-30T18:00:00Z');
    const merged = withLegalAcceptance(null, TERMS, now) as {
      legal: { termsVersion: string; privacyVersion: string; acceptedAt: string };
    };
    expect(merged.legal).toEqual({
      termsVersion: TERMS,
      privacyVersion: PRIVACY_NOTICE_VERSION,
      acceptedAt: '2026-07-30T18:00:00.000Z',
    });
  });

  it('preserves sibling preference keys (demoTerms from register, anything else)', () => {
    const prev = { demoTerms: { version: '2026-07-26', acceptedAt: 'x' }, theme: 'dark' };
    const merged = withLegalAcceptance(prev, TERMS) as Record<string, unknown>;
    expect(merged.demoTerms).toEqual(prev.demoTerms);
    expect(merged.theme).toBe('dark');
    expect((merged.legal as { termsVersion: string }).termsVersion).toBe(TERMS);
  });

  it('a non-object preferences value (corruption) is replaced, not crashed on', () => {
    for (const junk of ['oops', 42, [1, 2]]) {
      const merged = withLegalAcceptance(junk, TERMS) as { legal?: unknown };
      expect(merged.legal).toBeDefined();
    }
  });

  it('round-trip: accepting closes the gate; a later terms bump re-opens it exactly once', () => {
    const accepted = withLegalAcceptance({}, TERMS);
    expect(computeLegalStatus(accepted, TERMS).required).toBe(false);
    // Material change to /demo-terms → version bump → gate re-opens…
    expect(computeLegalStatus(accepted, '2026-09-01').required).toBe(true);
    // …and closes again after re-acceptance of the new version.
    const reAccepted = withLegalAcceptance(accepted, '2026-09-01');
    expect(computeLegalStatus(reAccepted, '2026-09-01').required).toBe(false);
  });
});
