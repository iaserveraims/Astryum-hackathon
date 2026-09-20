import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ORDINARY_PAYLOAD_EXPIRY_MAX_MIN,
  XAMAN_PAYLOAD_EXPIRY_MIN_DEFAULT,
  __resetPayloadExpiryMin,
  notePayloadExpiryMin,
  payloadExpiryMin,
} from '../handoffRelease';

/**
 * productizer it. 25 (§2 y §3) — LA VENTANA DE FIRMA VIAJA POR FILA, NO POR PESTAÑA.
 *
 * EL FALLO. `payloadExpiryMin` guardaba UN número para todo el módulo, así que la
 * ÚLTIMA respuesta leída en la pestaña decidía el `expire` de cualquier payload
 * acuñado después. Desde la §2.1, la salida de un pote con consejo contesta
 * `payloadExpiryMin: 1440` (24 h) — abrir esa pantalla y firmar luego CUALQUIER
 * 0xFE corriente acuñaba un payload de un día y dejaba el asiento de nonce de esa
 * cuenta ocupado otro tanto. Y al revés es el gemelo en persona: un 5 aprendido en
 * otra pantalla, aplicado a una ceremonia, suelta el asiento con el quórum todavía
 * firmando.
 *
 * LA REGLA. Una ventana más larga de lo que una firma simple puede ser es, por
 * construcción, de una fila que declaró CEREMONIA: se recuerda contra su memo y
 * solo se devuelve para ese memo. Una ventana corriente sigue actualizando el
 * valor de la pestaña, porque esa sí es una preferencia del despliegue
 * (`HANDOFF_PAYLOAD_EXPIRY_MIN`), que es para lo que se aprendía.
 */
describe('la ventana de una CEREMONIA no se contagia al resto de la pestaña', () => {
  beforeEach(() => __resetPayloadExpiryMin());
  afterEach(() => __resetPayloadExpiryMin());

  const CEREMONY_MEMO = 'FE00' + 'AB'.repeat(20);
  const PLAIN_MEMO = 'FE00' + 'CD'.repeat(20);

  it('un 1440 leído en la salida del consejo NO decide el payload del siguiente 0xFE', () => {
    notePayloadExpiryMin(1440, CEREMONY_MEMO);

    // El siguiente payload corriente de esta pestaña sigue siendo el de siempre…
    expect(payloadExpiryMin()).toBe(XAMAN_PAYLOAD_EXPIRY_MIN_DEFAULT);
    expect(payloadExpiryMin(undefined, PLAIN_MEMO)).toBe(XAMAN_PAYLOAD_EXPIRY_MIN_DEFAULT);
    // …y la ceremonia conserva la suya, que es la que su asiento mide.
    expect(payloadExpiryMin(undefined, CEREMONY_MEMO)).toBe(1440);
  });

  it('una ventana CORRIENTE del servidor sí es del despliegue, y se aprende para todos', () => {
    notePayloadExpiryMin(10, PLAIN_MEMO);
    expect(payloadExpiryMin()).toBe(10);
    expect(payloadExpiryMin(undefined, 'FE00' + '11'.repeat(20))).toBe(10);
    expect(ORDINARY_PAYLOAD_EXPIRY_MAX_MIN).toBe(60); // el techo del servidor, no uno inventado aquí
  });

  it('el valor que trae quien compone manda sobre todo lo demás', () => {
    notePayloadExpiryMin(10);
    expect(payloadExpiryMin(1440)).toBe(1440);
    expect(payloadExpiryMin(1440, PLAIN_MEMO)).toBe(1440);
  });

  it('nada se inventa: un número absurdo se ignora y la ventana anterior se queda', () => {
    notePayloadExpiryMin(10);
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 1441, '5', null, undefined]) {
      notePayloadExpiryMin(bad as unknown, PLAIN_MEMO);
    }
    expect(payloadExpiryMin()).toBe(10);
    expect(payloadExpiryMin(undefined, PLAIN_MEMO)).toBe(10);
  });

  it('el memo se lee como el servidor lo escribe: sin espacios y sin importar la caja', () => {
    notePayloadExpiryMin(1440, CEREMONY_MEMO.toLowerCase());
    expect(payloadExpiryMin(undefined, `  ${CEREMONY_MEMO}  `)).toBe(1440);
  });
});

/**
 * it. 25 (§2 y §3) — Y LA FIRMA SIMPLE LO USA. Esto es lo que impide que el cable
 * vuelva a desconectarse: `payloadExpiryMin()` sin memo era exactamente la llamada
 * que dejaba a la última respuesta de la pestaña decidir, y sellar «ahora + lo que
 * pedimos» era la conjetura que la mesa lleva corrigiendo desde la it. 23.
 */
describe('XamanSingleSign acuña con la ventana de SU fila y sella el instante REAL', () => {
  const SRC = readFileSync(join(__dirname, '..', '..', '..', 'components', 'xrpl', 'XamanSingleSign.tsx'), 'utf8');

  it('pide la ventana con el memo del 0xFE que va a firmar', () => {
    expect(SRC).toContain('const instructionMemo = flareInstructionMemoOf(tx);');
    expect(SRC).toContain('const expireMin = payloadExpiryMin(undefined, instructionMemo);');
    expect(SRC).toContain('options: { submit: true, expire: expireMin }');
  });

  it('sella primero la estimación y luego el `expires_at` que Xaman está contando', () => {
    expect(SRC).toContain('notePayloadOpened(instructionMemo, new Date(Date.now() + expireMin * 60_000));');
    expect(SRC).toContain('void sealRealPayloadExpiry(uuid, instructionMemo, expireMin);');
    // La verdad es la del payload, no la del navegador…
    expect(SRC).toContain('body?.payload?.expires_at');
    // …y nunca se acepta un instante MÁS ALLÁ de la ventana que pedimos.
    expect(SRC).toMatch(/atMs - Date\.now\(\) > \(expireMin \+ 1\) \* 60_000/);
  });
});

/** El helper no habla con la red en estas pruebas: nada de fetch de verdad. */
afterEach(() => vi.restoreAllMocks());
