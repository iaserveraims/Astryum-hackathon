import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { notePayloadOpenedResult } from '../handoffRelease';

/**
 * productizer it. 19 (R1 1.3 — parte de cliente) — EL RELOJ DEL ASIENTO EMPIEZA
 * CUANDO SE CREA EL PAYLOAD, NO CUANDO SE COMPUSO EL 0xFE.
 *
 * `payloadExpiresAt` se estampaba al COMPONER, y el `expire: 5` de Xaman corre
 * desde que el payload EXISTE (al abrir el modal de firma). Una firma viva a los
 * 4:30 se liberaba como «caducada» a los 5:01 y su asiento se le daba a una
 * segunda instrucción: el gemelo, esta vez construido por nuestro propio desfase
 * de reloj. El único proceso que conoce ese instante es el que pidió el payload,
 * así que lo dice.
 *
 * BEST EFFORT: un backend sin el endpoint contesta 404 y la ventana se sigue
 * midiendo como antes — nunca peor. Nada aquí firma ni difunde nada.
 */

const MEMO = 'FE' + '22'.repeat(40);
const FRONTEND_SRC = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(FRONTEND_SRC, rel), 'utf8');

describe('notePayloadOpened — a qué puerta llama y con qué', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { localStorage: { getItem: () => null } } as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('manda el memo y la caducidad REAL del payload', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ stamped: true }) });
    const expiry = new Date('2026-09-14T10:05:00.000Z');
    const r = await notePayloadOpenedResult(MEMO, expiry);
    expect(r.kind).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/flare-demo/handoff/payload-opened');
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      memoHex: MEMO,
      expiresAt: '2026-09-14T10:05:00.000Z',
    });
  });

  it('sin memo o sin instante no se manda nada (un aviso vacío no enseña nada)', async () => {
    expect((await notePayloadOpenedResult('', new Date())).kind).toBe('skipped');
    expect((await notePayloadOpenedResult(MEMO, null)).kind).toBe('skipped');
    expect((await notePayloadOpenedResult(MEMO, new Date(Number.NaN))).kind).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un backend que aún no tiene el endpoint no rompe nada: es un rechazo leído, no una excepción', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'NOT_FOUND' }) });
    await expect(notePayloadOpenedResult(MEMO, new Date())).resolves.toMatchObject({ kind: 'refused', status: 404 });
  });
});

describe('el cable: quien crea el payload es quien lo dice', () => {
  const src = read('components/xrpl/XamanSingleSign.tsx');

  it('XamanSingleSign avisa justo después de que Xaman devuelva el uuid', () => {
    expect(src).toContain('notePayloadOpened');
    const created = src.indexOf('registerLiveRequest(meta(uuid))');
    const noted = src.indexOf('notePayloadOpened(instructionMemo');
    expect(created).toBeGreaterThan(0);
    expect(noted).toBeGreaterThan(created);
  });

  it('solo sobre un 0xFE: un Payment XRP nativo no tiene asiento de nonce que corregir', () => {
    expect(src).toContain('flareInstructionMemoOf(tx)');
  });

  /**
   * it. 21 (it. 20 3.9) — UNA constante, y encima solo el SUELO.
   *
   * Hasta aquí el `5` estaba escrito a mano en este fichero Y en el backend
   * (`HANDOFF_PAYLOAD_EXPIRY_MIN`), y el servidor lleva desde la it. 19
   * contestando el suyo (`payloadExpiryMin`) en cada prepare: el frontend nunca
   * lo leía. Dos copias a mano de un mismo número divergen el día que alguien
   * toca una, y la dirección que duele es muda (un asiento que sobrevive a su
   * payload, o soltado mientras el payload aún se puede firmar).
   */
  it('el `expire` de Xaman y la caducidad del asiento salen del MISMO número', () => {
    // El mismo valor alimenta el payload y el sello del asiento.
    //
    // it. 25 (§2): …y ese número es el de ESTA fila. `payloadExpiryMin()` a secas
    // leía un global de módulo, así que la última respuesta leída en la pestaña
    // decidía el `expire` de todo lo que se firmara después — y desde la §2.1 una
    // salida de consejo contesta 1440. El memo del 0xFE nombra la fila.
    expect(src).toContain('const expireMin = payloadExpiryMin(undefined, instructionMemo)');
    expect(src).toContain('expire: expireMin');
    expect(src).toContain('expireMin * 60_000');
  });

  it('la constante es el SUELO, no la verdad: manda lo que diga el servidor', () => {
    // Una sola definición del número, en handoffRelease, y XamanSingleSign la
    // reexporta — nunca un literal nuevo.
    expect(src).toContain('export const XAMAN_EXPIRE_MIN = XAMAN_PAYLOAD_EXPIRY_MIN_DEFAULT');
    const lib = read('lib/wallet/handoffRelease.ts');
    expect(lib).toContain('export const XAMAN_PAYLOAD_EXPIRY_MIN_DEFAULT = 5');
    // Y se aprende de la respuesta del servidor, también la de `payload-opened`
    // — contra el memo por el que se preguntó (it. 25, §2: la ventana de una
    // ceremonia es de su fila, no de la pestaña).
    expect(lib).toContain('notePayloadExpiryMin(parsed.payloadExpiryMin, body.memoHex)');
    // it. 27 (§3): …y las OTRAS TRES puertas también lo pasan. Hasta aquí lo
    // aprendían SIN memo, y como 1440 pasa del clamp ordinario la rama de
    // pestaña lo descartaba: el número del servidor no llegaba a ningún payload
    // y lo que hacía funcionar la ceremonia era un `expire: 1440` a mano.
    // it. 31 (§5): …junto con si esa ventana fue LEÍDA (`signerListRead`) — sin
    // eso una ventana corta pasaba por veredicto «firma sola» (prueba ejecutable
    // en `useXrplWalletPartner.quorumRouting.test.ts`).
    expect(read('lib/institutional/api.ts')).toContain(
      'notePayloadExpiryMin(resBody.payloadExpiryMin, resBody.memoHex, resBody.signerListRead)',
    );
    expect(read('services/v1Api.ts')).toContain('notePayloadExpiryMin(v, b?.memoHex, b?.signerListRead)');
    expect(read('lib/demo-exchange/api.ts')).toContain('handoff.memoHex ?? body.memoHex,');
  });
});

describe('it. 19 (R3 N4 / R5 R7) — la entrega solo se afirma cuando el servidor la dice', () => {
  it('lib/institutional/api la lee en TODA respuesta compuesta, en las dos formas', () => {
    const src = read('lib/institutional/api.ts');
    expect(src).toContain('noteFlareInstructionDelivery(composed, declared)');
    // Una orden de consejo no es un `FE…`: la otra mitad de la misma verdad.
    expect(src).toContain('noteCouncilOrderDelivery(composed, declared)');
    // Defensivo: `serverDelivery.executorEnabled`, luego el de primer nivel, y
    // nada inventado cuando no viaja ninguno.
    expect(src).toContain("typeof resBody.executorEnabled === 'boolean'");
  });

  it('services/v1Api la lee en los prepares que llevan un 0xFE o una orden', () => {
    const src = read('services/v1Api.ts');
    for (const route of [
      'vault-fund/prepare',
      'cage-create/prepare',
      'vault-yield/claim/prepare',
      'vault-yield/harvest/prepare',
      'council-order/prepare',
    ]) {
      // La llamada real, no una mención en un comentario.
      const at = src.indexOf(`'/xrpl-defi/${route}'`);
      expect(at, route).toBeGreaterThan(0);
      expect(src.slice(at, at + 160), route).toContain('noteInstructionDelivery');
    }
    expect(src).toContain('noteCouncilOrderDelivery(tx, delivery)');
  });
});

describe('it. 19 — el candado stale es UN hecho, no uno por instancia montada', () => {
  const src = read('components/xrpl/XamanSingleSign.tsx');

  it('vive en el módulo y las instancias se suscriben', () => {
    expect(src).toContain('let sharedStaleLock');
    expect(src).toContain('staleLockListeners');
    expect(src).toContain('staleLockListeners.add(sync)');
    expect(src).toContain('staleLockListeners.delete(sync)');
  });

  it('soltar el candado se PUBLICA: la instancia hermana tenía que enterarse', () => {
    const release = src.indexOf('const release = useCallback');
    expect(release).toBeGreaterThan(0);
    expect(src.slice(release, release + 400)).toContain('publishStaleLock(null)');
  });

  it('«Compose it again anyway» no se gatea a sí mismo con el candado', () => {
    const confirm = src.indexOf('export function CouncilOrderInFlightConfirm');
    // Solo el cuerpo del componente: lo que viene después es el candado mismo.
    const end = src.indexOf('/* ── the lock is ONE fact', confirm);
    expect(confirm).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(confirm);
    const block = src.slice(confirm, end);
    expect(block).toContain('Compose it again anyway');
    // El único motivo para apagar ese botón es que su propia llamada esté en
    // vuelo. Si alguna vez el candado apareciera aquí, sería un callejón: la
    // persona confirma justamente PARA salir de él.
    expect(block).not.toContain('staleLock');
    expect(block).not.toContain('staleLockBlocks');
  });
});
