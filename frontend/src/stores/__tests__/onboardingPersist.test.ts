/**
 * EL 409 DEL ASISTENTE DEJA TRAZA.
 *
 * `persistToAccount` solo tenía `.catch()`, y un rechazo CON CUERPO —un 409—
 * RESUELVE: la promesa no lanza, así que el rechazo se descartaba en silencio.
 * Con la columna `preferences` ilegible, el backend contesta 409
 * `PREFERENCES_UNREADABLE` (no reintentable), `completed` no llega jamás a la
 * cuenta y el asistente se reabre en cada navegador nuevo. No es una cárcel
 * —hay «Omitir» y lo local sostiene la sesión— pero era fricción permanente
 * sin una frase para la persona ni una traza para nosotros.
 *
 * Nada de esto afloja el rechazo: el servidor sigue negándose a escribir encima
 * de una fila que no puede leer. Lo único que cambia es que ahora se SABE.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bag = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => bag.get(k) ?? null,
  setItem: (k: string, v: string) => void bag.set(k, v),
  removeItem: (k: string) => void bag.delete(k),
  clear: () => bag.clear(),
  key: () => null,
  length: 0,
};

vi.stubGlobal('localStorage', localStorageStub);
vi.stubGlobal('window', { localStorage: localStorageStub });

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { useOnboardingStore, ONBOARDING_NOT_SAVED_EN, ONBOARDING_NOT_SAVED_ES } = await import(
  '../onboardingStore'
);

/** Una respuesta como la del backend: cuerpo JSON y `ok` según el status. */
function answer(status: number, body: Record<string, unknown>) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Deja correr la cadena de promesas de `persistToAccount` (fire-and-forget). */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('el asistente sabe cuándo NO se guardó en la cuenta', () => {
  beforeEach(() => {
    bag.clear();
    bag.set('auth_token', 'a-real-token');
    fetchMock.mockReset();
    useOnboardingStore.setState({ persistRefusal: null });
  });

  it('un 409 PREFERENCES_UNREADABLE se ve: antes RESOLVÍA y se perdía', async () => {
    fetchMock.mockResolvedValue(
      answer(409, { error: 'PREFERENCES_UNREADABLE', detail: 'esperar no lo arregla', retryable: false }),
    );
    useOnboardingStore.getState().skip();
    await settle();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(useOnboardingStore.getState().persistRefusal).toBe('unreadable');
    // Y NO es una cárcel: el asistente se da por contestado en este navegador.
    expect(useOnboardingStore.getState().completed).toBe(true);
  });

  it('cualquier otro rechazo del servidor se distingue del ilegible', async () => {
    fetchMock.mockResolvedValue(answer(500, { error: 'boom' }));
    useOnboardingStore.getState().finish('protect');
    await settle();
    expect(useOnboardingStore.getState().persistRefusal).toBe('server');
  });

  it('sin red, la traza lo dice — y lo local sigue en pie', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    useOnboardingStore.getState().rememberLang('es');
    await settle();
    expect(useOnboardingStore.getState().persistRefusal).toBe('network');
    expect(useOnboardingStore.getState().lang).toBe('es');
  });

  it('una escritura que SÍ aterriza limpia el aviso', async () => {
    fetchMock.mockResolvedValueOnce(answer(409, { error: 'PREFERENCES_UNREADABLE' }));
    useOnboardingStore.getState().skip();
    await settle();
    expect(useOnboardingStore.getState().persistRefusal).toBe('unreadable');

    fetchMock.mockResolvedValueOnce(answer(200, { ok: true, onboarding: { completed: true } }));
    useOnboardingStore.getState().markTourDone('home');
    await settle();
    expect(useOnboardingStore.getState().persistRefusal).toBeNull();
  });

  it('la frase no acusa a quien la lee y dice qué cuesta exactamente', () => {
    for (const text of [ONBOARDING_NOT_SAVED_EN, ONBOARDING_NOT_SAVED_ES]) {
      expect(text).not.toMatch(/you (did|failed)/i);
      expect(text).not.toMatch(/error|try again/i);
    }
    expect(ONBOARDING_NOT_SAVED_EN).toMatch(/could not save your answers to your account/i);
    expect(ONBOARDING_NOT_SAVED_EN).toMatch(/nothing is being asked of you/i);
  });
});
