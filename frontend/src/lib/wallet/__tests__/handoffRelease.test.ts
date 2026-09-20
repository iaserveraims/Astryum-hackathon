import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HANDOFF_SEAT_TTL_MIN_DEFAULT,
  notifyHandoffSigned,
  notifyHandoffSignedResult,
  postHandoff,
  releaseHandoffSeat,
  releaseHandoffSeatResult,
  releaseRefusalDetail,
} from '../handoffRelease';
import { __resetLiveRequests, listLiveNotices } from '../../xaman/liveRequests';

/**
 * `postHandoff` swallowed every answer. A session
 * that prepared a 0xFE without a signed binding got 403 NOT_THE_HANDOFF_OWNER on
 * release, nothing said so, and the seat stayed taken for its TTL behind a
 * «released on cancel» sentence. Now the result is typed and a refusal reaches
 * the global banner, without changing any caller.
 */

const MEMO = 'FE' + '0A'.repeat(40);
const HASH = 'D'.repeat(64);

const respond = (status: number, body: unknown) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response);

beforeEach(() => {
  __resetLiveRequests();
  vi.stubGlobal('window', { localStorage: { getItem: (k: string) => (k === 'auth_token' ? 'tok' : null) } });
});

afterEach(() => {
  __resetLiveRequests();
  vi.unstubAllGlobals();
});

describe('postHandoff — a typed answer, never swallowed', () => {
  it('2xx is ok (202 PENDING_LEDGER included), and the session travels', async () => {
    const f = respond(202, { marked: false, status: 'PENDING_LEDGER' });
    const r = await postHandoff('signed', { memoHex: MEMO, txHash: HASH }, f as unknown as typeof fetch);
    expect(r).toEqual({ kind: 'ok', status: 202, body: { marked: false, status: 'PENDING_LEDGER' } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/flare-demo\/handoff\/signed$/);
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', keepalive: true });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(String(init.body))).toEqual({ memoHex: MEMO, txHash: HASH });
  });

  it('403 NOT_THE_HANDOFF_OWNER is a refusal with the server words', async () => {
    const f = respond(403, { error: 'NOT_THE_HANDOFF_OWNER', detail: 'prove the account' });
    const r = await postHandoff('release', { memoHex: MEMO }, f as unknown as typeof fetch);
    // El rechazo lleva además el cuerpo crudo y el `code`, para que la
    // espera (`WAIT_FOR_PAYLOAD_EXPIRY` + `secondsLeft`) llegue a la pantalla en
    // vez de degradarse a una constante del cliente. Lo de siempre sigue igual.
    expect(r).toMatchObject({ kind: 'refused', status: 403, error: 'NOT_THE_HANDOFF_OWNER', detail: 'prove the account' });
    expect(r.kind === 'refused' && r.secondsLeft).toBeUndefined();
    // El CÓDIGO CRUDO ya no encabeza la frase. Lo que se
    // pinta es la prosa del servidor; el código queda en el resultado.
    expect(releaseRefusalDetail(r)).toBe('prove the account');
  });

  it('a non-JSON error still refuses with its status; no answer is «unreachable»; no window is «skipped»', async () => {
    const bad = vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error('html'); } }) as unknown as Response);
    expect(await postHandoff('release', { memoHex: MEMO }, bad as unknown as typeof fetch)).toMatchObject({ kind: 'refused', status: 500, error: 'HTTP 500' });
    const offline = vi.fn(async () => { throw new Error('offline'); });
    expect(await postHandoff('release', { memoHex: MEMO }, offline as unknown as typeof fetch)).toEqual({ kind: 'unreachable', detail: 'offline' });
    vi.unstubAllGlobals();
    expect(await postHandoff('release', { memoHex: MEMO }, offline as unknown as typeof fetch)).toEqual({ kind: 'skipped' });
  });
});

describe('releaseHandoffSeat — a refusal reaches the banner', () => {
  it('403 → a notice with the detail and the seat TTL', async () => {
    const f = respond(403, { error: 'NOT_THE_HANDOFF_OWNER', detail: 'prove the account' });
    await releaseHandoffSeatResult(MEMO, f as unknown as typeof fetch);
    expect(listLiveNotices()).toEqual([
      expect.objectContaining({
        kind: 'seat-release-refused',
        detail: 'prove the account',
        memoHex: MEMO,
        freesInMinutes: HANDOFF_SEAT_TTL_MIN_DEFAULT,
      }),
    ]);
  });

  it('released (or nothing queued under the memo) → no notice', async () => {
    await releaseHandoffSeatResult(MEMO, respond(200, { released: true }) as unknown as typeof fetch);
    await releaseHandoffSeatResult(MEMO, respond(200, { released: false }) as unknown as typeof fetch);
    expect(listLiveNotices()).toEqual([]);
  });

  it('no answer at all → a notice too (the seat stays taken)', async () => {
    await releaseHandoffSeatResult(MEMO, vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch);
    expect(listLiveNotices()[0]?.detail).toContain('did not reach the server');
  });

  /**
   * UNA PETICIÓN QUE NO LLEGÓ MIDIÓ
   * AÚN MENOS QUE UN 503.
   *
   * La dejó sin ventana al 503 «no pude leer el asiento» y paró ahí: el
   * `unreachable` — offline, abortada, CORS, un proxy que la tiró — seguía
   * cayendo en la otra rama y empujaba la constante de cinco minutos del
   * cliente. Cinco minutos después el banner anunciaba «su ventana de firma ha
   * pasado, el asiento debería estar libre»: el hecho que este carril existe
   * para no inventar, inventado desde la prueba más fuerte de que no sabemos
   * nada — que la pregunta ni salió.
   */
  it('Un release que no llegó al servidor NO inventa la ventana de 5 minutos', async () => {
    await releaseHandoffSeatResult(MEMO, vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch);
    const [notice] = listLiveNotices();
    // Lo que dice: no pude comprobar, nada cambió, vuelve a preguntar.
    expect(notice?.unreadable).toBe(true);
    expect(notice?.retryable).toBe(true);
    // Lo que NO dice: ningún número, por tanto ninguna cuenta atrás y ningún
    // «ya debería estar libre» cuando llegue a cero.
    expect(notice?.freesInMinutes).toBeUndefined();
    expect(notice?.freesInSeconds).toBeUndefined();
    expect(notice?.freesAt).toBeUndefined();
    // Y sigue llevando el memo, que es lo que hace posible el reintento.
    expect(notice?.memoHex).toBe(MEMO);
  });

  it('La respuesta que SÍ mide una ventana sigue trayendo su cuenta atrás', async () => {
    // El arreglo no puede llevarse por delante al 409 que de verdad mide: ahí
    // hay un número del servidor y esperar es un camino de verdad.
    const f = respond(409, { error: 'WAIT_FOR_PAYLOAD_EXPIRY', detail: 'still signable', secondsLeft: 92 });
    await releaseHandoffSeatResult(MEMO, f as unknown as typeof fetch);
    const [notice] = listLiveNotices();
    expect(notice?.unreadable).toBeUndefined();
    expect(notice?.freesInSeconds).toBe(92);
    expect(notice?.freesAt).toBeGreaterThan(0);
  });

  it('the fire-and-forget signature every caller uses still surfaces it', async () => {
    vi.stubGlobal('fetch', respond(500, { error: 'HANDOFF_RELEASE_FAILED', detail: 'db down' }));
    releaseHandoffSeat(MEMO);
    await vi.waitFor(() => expect(listLiveNotices()[0]?.detail).toBe('db down'));
  });

  it('no memo → nothing sent', async () => {
    const f = respond(200, {});
    expect(await releaseHandoffSeatResult(undefined, f as unknown as typeof fetch)).toEqual({ kind: 'skipped' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('notifyHandoffSigned — only a real hash is sent (ManagerSetupWizard sent \'\')', () => {
  it('an empty or malformed hash sends nothing', async () => {
    const f = respond(200, {});
    vi.stubGlobal('fetch', f);
    notifyHandoffSigned(MEMO, '');
    notifyHandoffSigned(MEMO, 'not-a-hash');
    notifyHandoffSigned(MEMO, undefined);
    notifyHandoffSigned(undefined, HASH);
    await Promise.resolve();
    expect(f).not.toHaveBeenCalled();
    expect(await notifyHandoffSignedResult(MEMO, '', f as unknown as typeof fetch)).toEqual({ kind: 'skipped' });
  });

  it('a real hash is sent right away', async () => {
    const f = respond(202, { status: 'PENDING_LEDGER' });
    vi.stubGlobal('fetch', f);
    notifyHandoffSigned(MEMO, HASH);
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ memoHex: MEMO, txHash: HASH });
  });
});
