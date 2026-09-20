import { describe, expect, it, vi } from 'vitest';
import { translateError } from '../translateError';

/**
 * productizer it. 23 (it. 22 §3.5) — LOS 503 DEL STEP-UP SE PERDÍAN.
 *
 * `ApiError.message` es literalmente «HTTP 503: Service Unavailable», así que la
 * rama de conectividad de `translateError` se tragaba los dos 503 del step-up
 * (`STEP_UP_UNAVAILABLE`, `ACCOUNT_BUSY`) y los pintaba como «no pudimos
 * contactar con el servidor»: se culpa a la red de nuestra base de datos, se
 * tira el `Retry-After` que la ruta prometió y — lo peor de los tres — la
 * persona se queda dudando de si el problema fue su firma.
 */

const t = (s: string) => s;

describe('un 503 nuestro llega a la pantalla como lo que es', () => {
  it('STEP_UP_UNAVAILABLE: «esto es nuestro, no tu firma», con reintento', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('HTTP 503: Service Unavailable'), {
      status: 503,
      code: 'STEP_UP_UNAVAILABLE',
    });
    const out = translateError(err, t);
    expect(out.kind).toBe('error');
    expect(out.message).toContain('that is us, not your signature');
    expect(out.message).not.toContain("couldn't reach the server");
    expect(out.message).not.toContain('STEP_UP_UNAVAILABLE');
    expect(out.retryable).toBe(true);
    expect(out.code).toBe('STEP_UP_UNAVAILABLE');
  });

  it('ACCOUNT_BUSY: con los segundos que el servidor pidió esperar', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('ACCOUNT_BUSY'), {
      status: 503,
      body: { error: 'ACCOUNT_BUSY', retryable: true, retryAfterSeconds: 2 },
    });
    const out = translateError(err, t);
    expect(out.message).toContain('busy for a moment');
    expect(out.message).toContain('2');
    expect(out.retryAfterSeconds).toBe(2);
    expect(out.retryable).toBe(true);
  });

  it('una caída de red de verdad sigue diciendo lo de siempre', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = translateError(new Error('Failed to fetch'), t);
    expect(out.message).toContain("couldn't reach the server");
    expect(out.retryable).toBeUndefined();
  });

  it('y un «no» de la persona sigue siendo un «no», no un fallo nuestro', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = translateError(new Error('User rejected the request.'), t);
    expect(out.kind).toBe('user-rejection');
  });
});
