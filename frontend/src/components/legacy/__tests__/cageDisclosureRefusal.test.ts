import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from './extractFromSource';
import { isSurfacedUnauthorized } from '@/services/v1Api';

/**
 * productizer it. 17 (R5 5.6) — UN ARREGLO DE SEGURIDAD QUE EXPULSABA AL USUARIO.
 *
 * `withLiveSession` rechaza una escritura de autoridad cuya sesión es anterior a
 * una toma de posesión: 401 `session_revoked`. Eso es un veredicto sobre ESA
 * escritura, no sobre la sesión con la que la persona está navegando — y sin
 * embargo el manejador global miraba solo el status: token borrado, salto a
 * /login y el formulario a medio rellenar, perdido. Encima el modal enseñaba la
 * cadena cruda `session_revoked`.
 *
 * Dos reglas, y las dos se ejecutan aquí sobre el código que se despliega:
 *   · el 401 con `session_revoked` NO es global — quien llama lo enseña;
 *   · el modal nunca pinta el código: dice qué pasó y qué hacer.
 */

const src = readFileSync(join(__dirname, '..', 'CageDisclosureModal.tsx'), 'utf8');

const ackRefusalSentence = extract<(e: unknown, t: (s: string) => string) => string>(
  src,
  'function ackRefusalSentence(e: RefusedCall, t: (s: string) => string): string {',
  'function ackRefusalSentence(e, t) {',
  'ackRefusalSentence',
);

const t = (s: string) => s;

describe('isSurfacedUnauthorized — qué 401 NO expulsa', () => {
  it('`session_revoked` se enseña en su sitio', () => {
    expect(isSurfacedUnauthorized({ error: 'session_revoked' })).toBe(true);
  });

  it('cualquier otro 401 sigue siendo el de siempre', () => {
    expect(isSurfacedUnauthorized({ error: 'session_expired' })).toBe(false);
    expect(isSurfacedUnauthorized({ error: 'unauthorized' })).toBe(false);
    expect(isSurfacedUnauthorized({})).toBe(false);
    expect(isSurfacedUnauthorized(null)).toBe(false);
    // Ni una cadena suelta ni un cuerpo que no se pudo leer valen como permiso
    // para quedarse: sin la prueba explícita, el manejador global actúa.
    expect(isSurfacedUnauthorized('session_revoked')).toBe(false);
  });
});

describe('ackRefusalSentence — ni el código crudo ni «revisa la conexión»', () => {
  it('un `session_revoked` dice qué pasó y que NADA se registró', () => {
    const said = ackRefusalSentence(
      Object.assign(new Error('session_revoked'), { status: 401, body: { error: 'session_revoked' } }),
      t,
    );
    expect(said).not.toMatch(/session_revoked/);
    expect(said).toMatch(/not recorded/i);
    expect(said).toMatch(/sign in again/i);
  });

  it('lo reconoce aunque solo llegue en el mensaje del throw', () => {
    expect(ackRefusalSentence(new Error('session_revoked'), t)).toMatch(/not recorded/i);
  });

  it('un 401 corriente es una sesión caducada, no una toma de posesión', () => {
    const said = ackRefusalSentence(Object.assign(new Error('unauthorized'), { status: 401 }), t);
    expect(said).toMatch(/expired/i);
    expect(said).not.toMatch(/unauthorized/);
  });

  it('cualquier otro fallo no promete nada y no enseña el código', () => {
    const said = ackRefusalSentence(
      Object.assign(new Error('http_500'), { status: 500, body: { detail: 'la BD no responde' } }),
      t,
    );
    expect(said).not.toMatch(/http_500|la BD/);
    expect(said).toMatch(/could not be recorded/i);
    // Y jamás da por hecho que algo se firmó.
    expect(said).toMatch(/nothing was signed/i);
  });
});
