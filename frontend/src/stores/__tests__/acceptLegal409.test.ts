/**
 * productizer it. 34 (agente D) — EL 409 LEGAL TRAÍA SU VEREDICTO Y EL STORE LO TIRABA.
 *
 * `POST /auth/legal-accept` contesta, cuando la columna `preferences` no se puede
 * leer, 409 `PREFERENCES_UNREADABLE` con `retryable: false` Y con
 * `legal: { unreadable: true, required: false }` — el MISMO estado que /auth/me
 * reporta para esa fila, y que desde it. 25 es la instrucción de retirar el modal
 * y enseñar la nota del tercer estado. `acceptLegal` solo miraba `res.ok` y
 * `body.error`: guardaba `legalAcceptRefusal: 'server'`, la puerta —un modal NO
 * descartable— pintaba «The server could not record your signature — try again in
 * a moment» sobre un rechazo que el servidor acababa de declarar no reintentable,
 * y hacía falta un segundo viaje (`refreshMe`) para que el modal se fuera.
 *
 * Aquí se ejerce el CONSUMIDOR: el store real, con `fetch` fingido devolviendo el
 * cuerpo del backend (routes/auth.ts + config/legalAcceptance.unreadableLegalStatus).
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
vi.stubGlobal('window', { localStorage: localStorageStub, location: { origin: 'http://localhost' } });

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { useAuthStore } = await import('../authStore');
const { legalGateMode } = await import('../../lib/legal/legalGateMode');

function answer(status: number, body: Record<string, unknown>) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Lo que `unreadableLegalStatus(DEMO_TERMS_VERSION)` construye en el backend. */
const UNREADABLE_LEGAL = {
  required: false,
  termsVersion: '2026-06-01',
  privacyVersion: '2026-06-01',
  reason: null,
  accepted: null,
  unreadable: true,
};

describe('acceptLegal · 409 PREFERENCES_UNREADABLE con `legal` dentro', () => {
  beforeEach(() => {
    bag.clear();
    bag.set('auth_token', 'a-real-token');
    fetchMock.mockReset();
    useAuthStore.setState({
      legalAcceptRefusal: null,
      legalGate: { required: true, termsVersion: '2026-06-01', privacyVersion: '2026-06-01', reason: 'first', unreadable: false, accepted: null },
    });
  });

  it('adopta el veredicto del propio 409: la puerta pasa a «unreadable» en el MISMO viaje, y la razón no promete un momento', async () => {
    fetchMock.mockResolvedValue(
      answer(409, {
        error: 'PREFERENCES_UNREADABLE',
        detail: 'We could not read this account’s stored settings, and waiting will not fix it.',
        retryable: false,
        legal: UNREADABLE_LEGAL,
      }),
    );
    const ok = await useAuthStore.getState().acceptLegal();
    expect(ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    const s = useAuthStore.getState();
    // El decisor que pinta la pantalla ya no bloquea: el modal se retira sin segundo viaje.
    expect(s.legalGate?.unreadable).toBe(true);
    expect(s.legalGate?.required).toBe(false);
    expect(legalGateMode(s.legalGate)).toEqual({ kind: 'unreadable' });
    // Y la razón es la suya, no «server» (= «try again in a moment» en la puerta).
    expect(s.legalAcceptRefusal).toBe('record_unreadable');
  });

  it('un 409 SIN `legal` bien formado sigue siendo «server»: no se inventa ningún estado', async () => {
    fetchMock.mockResolvedValue(answer(409, { error: 'PREFERENCES_UNREADABLE', retryable: false }));
    expect(await useAuthStore.getState().acceptLegal()).toBe(false);
    const s = useAuthStore.getState();
    expect(s.legalAcceptRefusal).toBe('server');
    expect(s.legalGate?.required).toBe(true);
    expect(legalGateMode(s.legalGate)).toEqual({ kind: 'sign' });
  });

  it('un 409 con `legal` legible pero NO ilegible tampoco cambia la puerta (no es este caso)', async () => {
    fetchMock.mockResolvedValue(
      answer(409, { error: 'SOMETHING_ELSE', legal: { ...UNREADABLE_LEGAL, unreadable: false, required: true } }),
    );
    expect(await useAuthStore.getState().acceptLegal()).toBe(false);
    const s = useAuthStore.getState();
    expect(s.legalAcceptRefusal).toBe('server');
    expect(s.legalGate?.required).toBe(true);
  });

  it('los 401 siguen diciendo lo suyo: sesión revocada / caducada', async () => {
    fetchMock.mockResolvedValue(answer(401, { error: 'session_revoked' }));
    expect(await useAuthStore.getState().acceptLegal()).toBe(false);
    expect(useAuthStore.getState().legalAcceptRefusal).toBe('session_revoked');
    fetchMock.mockResolvedValue(answer(401, { error: 'expired' }));
    expect(await useAuthStore.getState().acceptLegal()).toBe(false);
    expect(useAuthStore.getState().legalAcceptRefusal).toBe('session_expired');
  });

  it('EL CABLE: la puerta tiene frase propia para esa razón, y no dice «in a moment»', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const GATE = readFileSync(join(__dirname, '..', '..', 'components', 'access', 'LegalAcceptGate.tsx'), 'utf8');
    const at = GATE.indexOf("refusal === 'record_unreadable'");
    expect(at).toBeGreaterThan(-1);
    const block = GATE.slice(at, GATE.indexOf("refusal === 'server'", at));
    expect(block).toMatch(/waiting will not fix that/);
    expect(block).not.toMatch(/in a moment/i);
    // La rama se evalúa ANTES que la genérica «server».
    expect(at).toBeLessThan(GATE.indexOf("refusal === 'server'"));
  });
});
