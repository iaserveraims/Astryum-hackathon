/**
 * TERMINAR UNA CEREMONIA TAMBIÉN DEVUELVE EL ASIENTO DEL 0xFE.
 *
 * Desde la §2.1 el 0xFE de una cuenta que firma por quórum se compone con la vida
 * real de sus payloads (24 h): es lo único que hace que el consejo firme bytes que
 * el ledger todavía admite. El precio es que ese asiento de nonce queda ocupado
 * mientras esos bytes puedan entrar — y si la ceremonia se abandona, la SEGUNDA
 * salida del mismo consejo chocaría con un 409 durante un día entero. Eso sería
 * tapiar una salida con código nuestro.
 */
import express from 'express';
import request from 'supertest';

const mockReleaseCeremonySeatFor = jest.fn();
jest.mock('../councilProposals', () => ({
  ...jest.requireActual('../councilProposals'),
  releaseCeremonySeatFor: (...a: unknown[]) => mockReleaseCeremonySeatFor(...a),
}));

const mockReleaseSeat = jest.fn();
jest.mock('../../services/flare/DirectMintHandoffStore', () => ({
  ...jest.requireActual('../../services/flare/DirectMintHandoffStore'),
  releaseAbandonedCeremonySeat: (...a: unknown[]) => mockReleaseSeat(...a),
}));

const mockAuthority = jest.fn();
jest.mock('../../services/flare/handoffAuthority', () => ({
  ...jest.requireActual('../../services/flare/handoffAuthority'),
  sessionAuthorityOnXrplAccount: (...a: unknown[]) => mockAuthority(...a),
}));

import xrplDefiRouter from '../xrplDefi';

const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const MEMO = 'FE000000000000030D40' + 'AB'.repeat(32);
const URL = '/api/xrpl-defi/multisign/release';

function buildApp(userId: string | null = 'user-1') {
  const app = express();
  app.use(express.json());
  if (userId) {
    app.use((req, _res, next) => {
      (req as express.Request & { siwe: unknown }).siwe = { userId, sessionId: 's1', walletAddress: '0x0' };
      next();
    });
  }
  app.use('/api/xrpl-defi', xrplDefiRouter);
  return app;
}
const app = buildApp();

const ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV };
  // `LEGACY_ENABLED` = cualquier sesión autenticada pasa la puerta del módulo;
  // lo que se prueba aquí es quién puede soltar un ASIENTO, no quién entra.
  process.env.LEGACY_ENABLED = 'true';
  mockReleaseCeremonySeatFor.mockResolvedValue({ reason: 'released' });
  mockReleaseSeat.mockResolvedValue({ released: true, verdict: { release: true, reason: 'ceremony-ended' } });
  // Por defecto, una sesión que NO prueba la cuenta: el derecho tiene que venir
  // de haber tenido el arriendo, no de estar logueado.
  mockAuthority.mockResolvedValue({ mayAct: false, refusal: null, failure: null, outcome: 'not-proven' });
});
afterAll(() => {
  process.env = ENV;
});

describe('la ceremonia termina y su asiento de nonce vuelve', () => {
  it('quien tenía el sitting lo termina y el 0xFE que iba a firmar suelta su asiento', async () => {
    const res = await request(app).post(URL).send({ account: COUNCIL, memoHex: MEMO });

    expect(res.status).toBe(200);
    expect(res.body.released).toBe(true);
    expect(res.body.seat).toEqual({ released: true, reason: 'ceremony-ended' });
    // El nombre del asiento y la cuenta viajan juntos: un memo ajeno no abre nada
    // (lo comprueba el store, con la fila delante).
    expect(mockReleaseSeat).toHaveBeenCalledWith(MEMO, COUNCIL);
  });

  it('sin memo no se toca ningún asiento — la puerta sigue siendo la de siempre', async () => {
    const res = await request(app).post(URL).send({ account: COUNCIL });

    expect(res.status).toBe(200);
    expect(res.body.released).toBe(true);
    expect(res.body.seat).toBeUndefined();
    expect(mockReleaseSeat).not.toHaveBeenCalled();
  });

  /**
   * El caso corriente de verdad: la pantalla se recargó y el arriendo caducó. La
   * ceremonia está igual de terminada, así que la puerta sigue abierta — pero
   * AHORA hay que probar la cuenta. Estar logueado no basta.
   */
  it('sin arriendo, solo pasa quien PRUEBA la cuenta', async () => {
    mockReleaseCeremonySeatFor.mockResolvedValue({ reason: 'no-seat' });

    const stranger = await request(app).post(URL).send({ account: COUNCIL, memoHex: MEMO });
    expect(stranger.status).toBe(200);
    expect(stranger.body.seat).toMatchObject({ released: false, code: 'NOT_THE_CEREMONY_HOLDER' });
    expect(mockReleaseSeat).not.toHaveBeenCalled();

    mockAuthority.mockResolvedValue({ mayAct: true, refusal: null, failure: null, outcome: 'proven' });
    const owner = await request(app).post(URL).send({ account: COUNCIL, memoHex: MEMO });
    expect(owner.body.seat).toMatchObject({ released: true });
    expect(mockReleaseSeat).toHaveBeenCalledWith(MEMO, COUNCIL);
    // Y se pregunta por la cuenta del cuerpo, con propósito de SALIDA: una tienda
    // de pruebas caída no puede convertirse en un «no» definitivo.
    expect(mockAuthority).toHaveBeenCalledWith(expect.anything(), COUNCIL, 'exit');
  });

  it('el sitting de otra persona no se toca, y su asiento tampoco', async () => {
    mockReleaseCeremonySeatFor.mockResolvedValue({ reason: 'not-the-lessee' });

    const res = await request(app).post(URL).send({ account: COUNCIL, memoHex: MEMO });
    expect(res.status).toBe(403);
    expect(mockReleaseSeat).not.toHaveBeenCalled();
  });

  /**
   * LA LÍNEA QUE NO SE CRUZA. Terminar la ceremonia no es una llave maestra: si la
   * regla del asiento dice que aquel Payment todavía puede entrar (o que no se
   * pudo leer si entró), el asiento NO se suelta y la respuesta lo dice con la
   * cuenta atrás del servidor.
   */
  it('si la regla del asiento dice que no, la respuesta lo cuenta — no lo suelta igualmente', async () => {
    mockReleaseSeat.mockResolvedValue({
      released: false,
      verdict: {
        release: false,
        code: 'WAIT_FOR_PAYLOAD_EXPIRY',
        retryable: true,
        secondsLeft: 84_000,
        lastLedgerSequence: 90_020_000,
        detail: 'That dispatch is still signable in Xaman…',
      },
    });

    const res = await request(app).post(URL).send({ account: COUNCIL, memoHex: MEMO });
    expect(res.status).toBe(200);
    expect(res.body.seat).toMatchObject({
      released: false,
      code: 'WAIT_FOR_PAYLOAD_EXPIRY',
      retryable: true,
      secondsLeft: 84_000,
      lastLedgerSequence: 90_020_000,
    });
  });

  it('«no pude leer» sale como tal y reintentable — jamás como «lo solté»', async () => {
    mockReleaseSeat.mockRejectedValue(new Error('the 0xFE queued under that memo could not be read'));

    const res = await request(app).post(URL).send({ account: COUNCIL, memoHex: MEMO });
    expect(res.status).toBe(200);
    expect(res.body.released).toBe(true); // la ceremonia SÍ se terminó
    expect(res.body.seat).toMatchObject({ released: false, code: 'SEAT_STATE_UNREADABLE', retryable: true });
  });

  it('una fila que no es de una ceremonia no pasa por esta puerta', async () => {
    mockReleaseSeat.mockResolvedValue({ released: false, reason: 'not-a-ceremony' });

    const res = await request(app).post(URL).send({ account: COUNCIL, memoHex: MEMO });
    expect(res.body.seat).toEqual({ released: false, reason: 'not-a-ceremony' });
  });

  /**
   * EL CERROJO NUEVO, DICHO CON SU SIGUIENTE PASO.
   *
   * Unos bytes de ceremonia que el coordinador multifirma NO pinó no pueden
   * soltar su asiento antes de tiempo: sin `Sequence` fijada, dos Payments de la
   * misma cuenta entran los dos, y eso es el gemelo. La respuesta lo dice con lo
   * que pasa a continuación — el asiento se suelta solo — para que nadie lea un
   * cerrojo prudente como una salida tapiada.
   */
  it('unos bytes que no pinó el coordinador no sueltan asiento, y se dice por qué', async () => {
    mockReleaseSeat.mockResolvedValue({ released: false, reason: 'not-pinned-by-us' });

    const res = await request(app).post(URL).send({ account: COUNCIL, memoHex: MEMO });
    expect(res.status).toBe(200);
    expect(res.body.released).toBe(true); // la ceremonia SÍ se terminó
    expect(res.body.seat).toMatchObject({ released: false, reason: 'not-pinned-by-us' });
    expect(String(res.body.seat.detail)).toContain('frees');
  });
});

/**
 * EL NOMBRE DEL SITTING ATRAVIESA LA RUTA ENTERA.
 *
 * La cadena real está en `xrplDefi.ceremonySitting.test.ts`; aquí, con las dos
 * puertas fingidas, se prueba lo que la RUTA hace con el id: lo pasa al arriendo
 * y al pin tal cual llegó (cadena, `null`, o nada — tres cosas distintas), y
 * cuando el arriendo contesta `stale-sitting` PARA: la puerta del pin ni se llama,
 * porque ese sitting terminó y el asiento es del que lo sustituyó.
 */
describe('El `sittingId` del cuerpo', () => {
  it('viaja al arriendo y al pin, tal cual', async () => {
    const res = await request(app).post(URL).send({ account: COUNCIL, memoHex: MEMO, sittingId: 'sitting-7' });
    expect(res.status).toBe(200);
    expect(mockReleaseCeremonySeatFor).toHaveBeenCalledWith(COUNCIL, 'user-1', { sittingId: 'sitting-7' });
    expect(mockReleaseSeat).toHaveBeenCalledWith(MEMO, COUNCIL, { sittingId: 'sitting-7' });
  });

  it('`null` (un sitting sin nombre) viaja como `null`, no como «nada»', async () => {
    await request(app).post(URL).send({ account: COUNCIL, memoHex: MEMO, sittingId: null });
    expect(mockReleaseCeremonySeatFor).toHaveBeenCalledWith(COUNCIL, 'user-1', { sittingId: null });
    expect(mockReleaseSeat).toHaveBeenCalledWith(MEMO, COUNCIL, { sittingId: null });
  });

  it('control: sin `sittingId` la puerta del pin recibe la llamada de siempre (dos argumentos)', async () => {
    await request(app).post(URL).send({ account: COUNCIL, memoHex: MEMO });
    expect(mockReleaseCeremonySeatFor).toHaveBeenCalledWith(COUNCIL, 'user-1', { sittingId: undefined });
    expect(mockReleaseSeat).toHaveBeenCalledWith(MEMO, COUNCIL);
  });

  it('el arriendo dice stale-sitting → 200, `released:false`, `seat` obsoleto, y el pin NI SE LLAMA', async () => {
    mockReleaseCeremonySeatFor.mockResolvedValue({ released: false, reason: 'stale-sitting' });
    mockAuthority.mockResolvedValue({ mayAct: true, refusal: null, failure: null, outcome: 'proven' }); // ni probando la cuenta

    const res = await request(app).post(URL).send({ account: COUNCIL, memoHex: MEMO, sittingId: 'sitting-old' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ released: false, reason: 'stale-sitting' });
    expect(res.body.seat).toMatchObject({ released: false, reason: 'stale-sitting' });
    expect(String(res.body.seat.detail)).toMatch(/newer sitting/i);
    expect(mockReleaseSeat).not.toHaveBeenCalled();
    expect(mockAuthority).not.toHaveBeenCalled();
  });

  it('el arriendo dice stale-sitting y no hay memo → sin campo `seat` (no se nombró ningún asiento)', async () => {
    mockReleaseCeremonySeatFor.mockResolvedValue({ released: false, reason: 'stale-sitting' });
    const res = await request(app).post(URL).send({ account: COUNCIL, sittingId: 'sitting-old' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ released: false, reason: 'stale-sitting' });
  });

  it('el pin dice stale-sitting (sin arriendo, cuenta probada): se contesta en `seat` con la misma gramática', async () => {
    mockReleaseCeremonySeatFor.mockResolvedValue({ released: false, reason: 'no-seat' });
    mockAuthority.mockResolvedValue({ mayAct: true, refusal: null, failure: null, outcome: 'proven' });
    mockReleaseSeat.mockResolvedValue({ released: false, reason: 'stale-sitting', pin: 'row' });

    const res = await request(app).post(URL).send({ account: COUNCIL, memoHex: MEMO, sittingId: 'sitting-old' });

    expect(res.status).toBe(200);
    expect(res.body.reason).toBe('no-seat');
    expect(res.body.seat).toMatchObject({ released: false, reason: 'stale-sitting', pin: 'row' });
    expect(String(res.body.seat.detail)).toMatch(/nothing was changed/i);
  });

  it('un `sittingId` vacío o que no es texto es un cuerpo inválido', async () => {
    expect((await request(app).post(URL).send({ account: COUNCIL, sittingId: '' })).status).toBe(400);
    expect((await request(app).post(URL).send({ account: COUNCIL, sittingId: 7 })).status).toBe(400);
    expect(mockReleaseCeremonySeatFor).not.toHaveBeenCalled();
  });
});
