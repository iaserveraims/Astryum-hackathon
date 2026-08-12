import { describe, it, expect, vi, afterEach } from 'vitest';
import { settlementAuthHeader, fetchMintExecuted, fetchCouncilOrderExecuted } from '../statusReads';

/**
 * Regresión del bug 2026-07-29: `mint-status` vive tras requireSiweAuth; sin la
 * cabecera Bearer devuelve 401, el tracker lee null para siempre y el toast se
 * queda colgado en "Still settling on Flare…" aunque la orden SÍ se ejecutó
 * (isTransactionIdUsed=true). Estas lecturas DEBEN mandar el token.
 */
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (globalThis as { window?: unknown }).window;
});

function stubWindow(token: string | null) {
  (globalThis as { window?: unknown }).window = {
    localStorage: { getItem: (k: string) => (k === 'auth_token' ? token : null) },
  };
}

describe('settlementAuthHeader', () => {
  it('añade el Bearer cuando hay token', () => {
    stubWindow('tok123');
    expect(settlementAuthHeader()).toEqual({ Authorization: 'Bearer tok123' });
  });
  it('SSR / sin token → sin cabecera (no revienta)', () => {
    delete (globalThis as { window?: unknown }).window;
    expect(settlementAuthHeader()).toEqual({});
    stubWindow(null);
    expect(settlementAuthHeader()).toEqual({});
  });
});

describe('fetchMintExecuted — manda el Authorization (o el toast se cuelga)', () => {
  it('envía el Bearer y devuelve executed', async () => {
    stubWindow('tok123');
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ executed: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchMintExecuted('ABC123')).toBe(true);
    const opts = (fetchMock.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> };
    expect(opts.headers.Authorization).toBe('Bearer tok123');
  });

  it('401 → null (jamás un falso settled)', async () => {
    stubWindow(null);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    expect(await fetchMintExecuted('ABC')).toBeNull();
  });

  it('executed:false se propaga como false (sigue vigilando)', async () => {
    stubWindow('t');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ executed: false }) })));
    expect(await fetchMintExecuted('ABC')).toBe(false);
  });
});

describe('fetchCouncilOrderExecuted — mismo arreglo de auth', () => {
  it('envía el Bearer y devuelve executed', async () => {
    stubWindow('tok999');
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ executed: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchCouncilOrderExecuted('DEF')).toBe(true);
    const opts = (fetchMock.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> };
    expect(opts.headers.Authorization).toBe('Bearer tok999');
  });
});
