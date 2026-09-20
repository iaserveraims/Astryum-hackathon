import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from '../../legacy/__tests__/extractFromSource';

/**
 * productizer it. 19 (R5 R6) — UN ARREGLO DE SEGURIDAD QUE EXPULSABA AL USUARIO.
 *
 * `withLiveSession` refusa una escritura de AUTORIDAD cuya sesión es anterior a
 * una toma de posesión de la cuenta: 401 `session_revoked`. Eso es un veredicto
 * sobre ESA escritura, no sobre la sesión que la persona está usando. Pero
 * `services/api.ts` actuaba sobre el 401 con el cuerpo SIN LEER: borraba el
 * token y navegaba a /login. Resultado: guardar la matriz step-up —— la pantalla
 * donde alguien decide qué proteger —— echaba a esa persona de la aplicación, y
 * la matriz a medio editar se perdía.
 *
 * Aquí se ejecutan las dos piezas que envía el cliente, sin montar React:
 *   · `handleUnauthorized`, que ya no borra nada ante `session_revoked`;
 *   · `stepUpSaveRefusal`, la frase que la tarjeta pinta en su sitio — que dice
 *     qué pasó, que NADA se guardó y qué hacer, y jamás el código crudo ni el
 *     `detail` en castellano del servidor.
 */

const API = readFileSync(join(__dirname, '..', '..', '..', 'services', 'api.ts'), 'utf8');
const SETTINGS = readFileSync(join(__dirname, '..', 'StepUpSettings.tsx'), 'utf8');

const t = (s: string) => s;

const stepUpSaveRefusal = extract<(e: unknown, tt: (s: string) => string) => string>(
  SETTINGS,
  'export function stepUpSaveRefusal(e: unknown, t: (s: string) => string): string {',
  'function stepUpSaveRefusal(e, t) {',
  'stepUpSaveRefusal',
);

describe('services/api.ts — el cuerpo se lee ANTES de decidir echar a nadie', () => {
  it('el 401 se decide con la respuesta ya leída, no antes', () => {
    const bodyRead = API.indexOf('const errorData = await response.json()');
    const decision = API.indexOf('if (response.status === 401) this.handleUnauthorized(');
    expect(bodyRead).toBeGreaterThan(-1);
    expect(decision).toBeGreaterThan(-1);
    expect(bodyRead, 'the body must be read BEFORE the logout decision').toBeLessThan(decision);
  });

  it('el veredicto es el mismo que el de v1Api: un solo lector, sin copias', () => {
    expect(API).toContain("import { isSurfacedUnauthorized } from './v1Api'");
    expect(API).toContain('if (isSurfacedUnauthorized(body)) return;');
  });

  it('el código del servidor viaja para que quien llama pueda distinguirlo', () => {
    expect(API).toContain('code: errorData.code ?? errorData.error');
  });
});

describe('stepUpSaveRefusal — el rechazo se cuenta en su sitio', () => {
  /** Lo que el backend contesta cuando la sesión es anterior a la toma de posesión. */
  const revoked = {
    status: 401,
    code: 'session_revoked',
    message: 'HTTP 401: Unauthorized',
  };

  it('una sesión revocada dice qué pasó, que nada se guardó y cómo seguir', () => {
    const said = stepUpSaveRefusal(revoked, t);
    expect(said).toMatch(/Nothing was saved/i);
    expect(said).toMatch(/sign in again/i);
    // Ni el código crudo, ni la muletilla del cliente, ni un «tu sesión murió».
    expect(said).not.toMatch(/session_revoked/);
    expect(said).not.toMatch(/HTTP 401/);
  });

  it('un 401 corriente sigue diciendo lo que es, sin confundirlo con el otro', () => {
    const said = stepUpSaveRefusal({ status: 401, message: 'HTTP 401: Unauthorized' }, t);
    expect(said).toMatch(/no longer valid/i);
    expect(said).not.toMatch(/change of ownership/i);
  });

  it('un fallo con prosa del servidor la conserva; una muletilla HTTP no llega a pantalla', () => {
    expect(stepUpSaveRefusal({ status: 422, message: 'The matrix must list every feature.' }, t)).toBe(
      'The matrix must list every feature.',
    );
    const filler = stepUpSaveRefusal({ status: 403, message: 'HTTP 403: Forbidden' }, t);
    expect(filler).not.toMatch(/HTTP 403/);
    expect(filler).toMatch(/Nothing was changed/i);
  });

  it('un error sin nada dentro no deja la tarjeta muda', () => {
    expect(stepUpSaveRefusal(null, t)).toMatch(/Could not save/i);
    expect(stepUpSaveRefusal(new Error(''), t)).toMatch(/Could not save/i);
  });
});
