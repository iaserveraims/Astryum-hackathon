import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { releaseHandoffSeatResult, releaseRefusalDetail } from '../handoffRelease';
import { __resetLiveRequests, listLiveNotices, liveNoticeCountdown } from '../../xaman/liveRequests';

/**
 * productizer it. 23 (it. 22 §3.1 y §3.7) — EL BANNER CONTRADECÍA A LA TARJETA.
 *
 * `releaseHandoffSeatResult` empujaba SIEMPRE la constante de cinco minutos,
 * también cuando el release contestó **503 `SEAT_STATE_UNREADABLE`** — una
 * respuesta que no midió NADA: el servidor ni siquiera pudo leer si el asiento
 * sigue ocupado. Trescientos segundos después el banner cambiaba de frase y
 * anunciaba «su ventana ha pasado, el asiento debería estar libre, merece la
 * pena preparar otra vez», justo al lado de la tarjeta donde
 * `mayPrepareAgainAfterRelease` se niega a ofrecer exactamente eso para este
 * caso. Inventar el hecho que todo este carril existe para no inventar.
 *
 * Y §3.7: la frase del aviso venía encabezada por el CÓDIGO CRUDO
 * («SEAT_STATE_UNREADABLE — …»), que es justo lo que `describeRetryableRefusal`
 * promete no hacer.
 */

const MEMO = 'FE0A0A0A';

function respond(status: number, body: Record<string, unknown>) {
  return vi.fn(async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response);
}

beforeEach(() => {
  __resetLiveRequests();
  vi.stubGlobal('window', { localStorage: { getItem: () => null } } as unknown as Window);
});
afterEach(() => vi.unstubAllGlobals());

describe('503 SEAT_STATE_UNREADABLE — no se mide nada, así que no se cuenta nada', () => {
  it('el aviso NO lleva ventana: ni constante, ni `freesAt`, ni cuenta atrás', async () => {
    const f = respond(503, { error: 'SEAT_STATE_UNREADABLE', retryable: true });
    await releaseHandoffSeatResult(MEMO, f as unknown as typeof fetch);
    const [n] = listLiveNotices();
    expect(n).toBeDefined();
    expect(n.unreadable).toBe(true);
    expect(n.retryable).toBe(true);
    expect(n.freesInMinutes).toBeUndefined();
    expect(n.freesAt).toBeUndefined();
    // Y por tanto el banner no puede decir «la ventana pasó» nunca — ni ahora,
    // ni dentro de una hora.
    expect(liveNoticeCountdown(n, Date.now() + 3_600_000)).toEqual({ secondsLeft: null, expired: false });
  });

  it('la frase es la legible, y el código crudo no aparece', async () => {
    const f = respond(503, { error: 'SEAT_STATE_UNREADABLE', retryable: true, retryAfterSeconds: 4 });
    const r = await releaseHandoffSeatResult(MEMO, f as unknown as typeof fetch);
    const said = releaseRefusalDetail(r) ?? '';
    expect(said).not.toContain('SEAT_STATE_UNREADABLE');
    expect(said).toContain('could not read');
    expect(said).toContain('4');
    expect(listLiveNotices()[0].detail).toBe(said);
  });

  it('un 409 que SÍ midió conserva su cuenta atrás — esto no apaga lo que funciona', async () => {
    const f = respond(409, { error: 'WAIT_FOR_PAYLOAD_EXPIRY', secondsLeft: 90 });
    await releaseHandoffSeatResult(MEMO, f as unknown as typeof fetch);
    const [n] = listLiveNotices();
    expect(n.unreadable).toBeUndefined();
    expect(n.freesInSeconds).toBe(90);
    expect(n.freesAt).toBeDefined();
  });

  it('ningún otro rechazo pinta su código: un slug no es una frase', async () => {
    const f = respond(500, { error: 'HANDOFF_RELEASE_FAILED' });
    const r = await releaseHandoffSeatResult(MEMO, f as unknown as typeof fetch);
    expect(releaseRefusalDetail(r)).toBe('the server refused to release it and did not say why');
  });

  it('el castellano del servidor tampoco llega a una pantalla inglesa', async () => {
    const f = respond(403, { error: 'NOT_THE_HANDOFF_OWNER', detail: 'el asiento ya está ocupado por otra orden' });
    const r = await releaseHandoffSeatResult(MEMO, f as unknown as typeof fetch);
    expect(releaseRefusalDetail(r)).toBe('the server refused to release it and did not say why');
  });
});

describe('el banner ofrece el reintento que la tarjeta niega poder ofrecer', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/xrpl/LiveXamanRequests.tsx'), 'utf8');

  it('con una lectura fallida dice que no se pudo comprobar, y no que la ventana pasó', () => {
    expect(src).toContain('We could not check the seat of the unsigned 0xFE');
    const unreadableBranch = src.indexOf('n.unreadable');
    const expiredSentence = src.indexOf('Its signing window has passed');
    expect(unreadableBranch).toBeGreaterThan(0);
    expect(unreadableBranch).toBeLessThan(expiredSentence);
  });

  it('y pone un «Try again» que vuelve a preguntar de verdad', () => {
    expect(src).toContain('releaseHandoffSeatResult(n.memoHex)');
    expect(src).toContain("t('Try again')");
  });
});

/**
 * productizer it. 31 (§3) — EL ASIENTO DE UNA CEREMONIA, LEÍDO EN SU PROPIO CAMPO.
 *
 * `/xrpl-defi/multisign/release` contesta DOS cosas: el arriendo de la Sequence
 * (`released`, arriba) y el asiento de nonce del 0xFE (`seat`, aparte). Hasta aquí
 * `releaseCeremonySeat` leía sólo el primero: cerrar en `idle` (sin pin del
 * coordinador) dejaba el asiento medido por la regla ordinaria — 24 h — y la
 * pantalla no decía nada. La cadena entera (cerrar → release → banner) se prueba
 * en `lib/xrpl/__tests__/quorumCeremonyClose.test.tsx`; aquí, la forma del aviso
 * por cada respuesta del servidor, sin inventar ninguna ventana.
 */
describe('ceremonySeatNotice — qué se le dice a la persona por cada respuesta del asiento', () => {
  const CEREMONY_MEMO = 'FE000000000000030D40' + 'AB'.repeat(32);

  it('un asiento que sigue ocupado con ventana MEDIDA → aviso con la cuenta atrás del servidor', async () => {
    const { ceremonySeatNotice } = await import('../handoffRelease');
    const n = ceremonySeatNotice(CEREMONY_MEMO, {
      released: false,
      reason: 'not-pinned-by-us',
      code: 'WAIT_FOR_PAYLOAD_EXPIRY',
      secondsLeft: 86_100,
      detail: 'We have no record that this app’s multisig coordinator pinned these bytes.',
    });
    expect(n?.kind).toBe('seat-release-refused');
    expect(n?.freesInSeconds).toBe(86_100);
    expect(n?.unreadable).toBeUndefined();
    expect(n?.detail).toMatch(/no record/);
  });

  it('un asiento que NO se pudo leer → aviso sin ventana y reintentable, jamás una cuenta atrás', async () => {
    const { ceremonySeatNotice } = await import('../handoffRelease');
    const n = ceremonySeatNotice(CEREMONY_MEMO, { released: false, code: 'SEAT_STATE_UNREADABLE', retryable: true });
    expect(n?.unreadable).toBe(true);
    expect(n?.retryable).toBe(true);
    expect(n?.freesInSeconds).toBeUndefined();
  });

  it('un asiento soltado, una fila que ya no está en cola o una respuesta sin medida → ningún aviso', async () => {
    const { ceremonySeatNotice } = await import('../handoffRelease');
    expect(ceremonySeatNotice(CEREMONY_MEMO, { released: true, reason: 'ceremony-ended' })).toBeNull();
    expect(ceremonySeatNotice(CEREMONY_MEMO, { released: false, reason: 'not-found' })).toBeNull();
    expect(ceremonySeatNotice(CEREMONY_MEMO, { released: false, reason: 'not-a-ceremony' })).toBeNull();
    expect(ceremonySeatNotice(CEREMONY_MEMO, undefined)).toBeNull();
  });

  it('…y `releaseCeremonySeat` lo empuja al banner leyendo `seat` aunque el arriendo dijera «no-seat»', async () => {
    const { releaseCeremonySeat } = await import('../handoffRelease');
    __resetLiveRequests();
    global.fetch = respond(200, {
      released: false,
      reason: 'no-seat',
      seat: { released: false, reason: 'not-pinned-by-us', code: 'WAIT_FOR_PAYLOAD_EXPIRY', secondsLeft: 600 },
    }) as unknown as typeof fetch;

    const outcome = await releaseCeremonySeat('rCOUNCIL', CEREMONY_MEMO);

    expect(outcome).toBe('not-held'); // the LEASE's answer, unchanged for its callers
    const n = listLiveNotices().find((x) => x.memoHex === CEREMONY_MEMO);
    expect(n?.kind).toBe('seat-release-refused');
    expect(liveNoticeCountdown(n!).secondsLeft).toBeGreaterThan(590);
  });
});
