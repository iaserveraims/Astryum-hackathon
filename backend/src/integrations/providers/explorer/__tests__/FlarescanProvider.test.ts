import { FlarescanProvider } from '../FlarescanProvider';

const PRIMARY = 'https://primary.example/api';
const FALLBACK = 'https://fallback.example/api';

/** fetch falso enrutado por host: cada puerta responde lo que le toque. */
function routedFetch(byHost: Record<string, () => unknown>) {
  return jest.fn(async (url: string) => {
    const host = new URL(String(url)).host;
    const handler = byHost[host];
    if (!handler) throw new Error(`unexpected host ${host}`);
    const out = handler();
    if (out instanceof Error) throw out;
    const body = out as { httpStatus?: number; body?: unknown };
    return {
      ok: (body.httpStatus ?? 200) < 400,
      status: body.httpStatus ?? 200,
      json: async () => body.body,
    };
  }) as unknown as typeof fetch;
}

const okBalance = () => ({ body: { status: '1', message: 'OK', result: '1' } });
const txlist = (rows: unknown[]) => ({ body: { status: '1', message: 'OK', result: rows } });

describe('FlarescanProvider', () => {
  afterEach(() => {
    global.fetch = undefined as unknown as typeof fetch;
  });

  test('metadata: indexer-verified explorer', () => {
    const p = new FlarescanProvider([PRIMARY]);
    expect(p.id).toBe('flarescan');
    expect(p.trustLevel).toBe('indexer_verified');
  });

  // El ping viejo (`block/eth_block_number`) es una acción propia de Blockscout:
  // Routescan la rechaza con HTTP 200 + status "0". Un chequeo que solo mire el
  // código HTTP pinta de verde un error — mentir en el vigía es peor que no
  // vigilar, porque nadie va a mirar dos veces.
  test('health() = down on HTTP 200 with an API-level error body', async () => {
    global.fetch = routedFetch({
      'primary.example': () => ({ body: { status: '0', message: 'NOTOK', result: 'Error!' } }),
    });
    const h = await new FlarescanProvider([PRIMARY]).health();
    expect(h.status).toBe('down');
    expect(h.reason).toMatch(/NOTOK/);
  });

  test('health() = healthy when the primary answers', async () => {
    global.fetch = routedFetch({ 'primary.example': okBalance });
    const h = await new FlarescanProvider([PRIMARY, FALLBACK]).health();
    expect(h.status).toBe('healthy');
  });

  // 2026-08-03: la API de Blockscout devolvió 503 en todas sus rutas y dejó
  // ciego el carril entero. Con segunda puerta, eso es 'degraded' — el carril
  // sigue leyendo — y el motivo dice cuál cayó y por dónde estamos sirviendo.
  test('health() = degraded (not down) when only the fallback answers', async () => {
    global.fetch = routedFetch({
      'primary.example': () => ({ httpStatus: 503, body: {} }),
      'fallback.example': okBalance,
    });
    const h = await new FlarescanProvider([PRIMARY, FALLBACK]).health();
    expect(h.status).toBe('degraded');
    expect(h.reason).toContain('fallback.example');
    expect(h.reason).toContain('primary.example: HTTP 503');
  });

  test('health() = down only when NO door answers', async () => {
    global.fetch = routedFetch({
      'primary.example': () => new Error('ECONNRESET'),
      'fallback.example': () => ({ httpStatus: 503, body: {} }),
    });
    const h = await new FlarescanProvider([PRIMARY, FALLBACK]).health();
    expect(h.status).toBe('down');
    expect(h.reason).toMatch(/ECONNRESET/);
  });

  test('reads fail over to the second door and stick to it', async () => {
    const fetchMock = routedFetch({
      'primary.example': () => new Error('no healthy upstream'),
      'fallback.example': () => txlist([{ hash: '0xabc' }]),
    });
    global.fetch = fetchMock;
    const p = new FlarescanProvider([PRIMARY, FALLBACK]);

    const first = await p.call('explorer.getActivity', { address: '0xdead' }, { traceId: 't' });
    expect((first.data as unknown[]).length).toBe(1);

    // Pegajoso: la segunda lectura arranca ya en la puerta que abrió, así que no
    // vuelve a pagar el timeout de la caída en cada consulta.
    (fetchMock as unknown as jest.Mock).mockClear();
    await p.call('explorer.getActivity', { address: '0xdead' }, { traceId: 't' });
    const hosts = (fetchMock as unknown as jest.Mock).mock.calls.map(
      (c) => new URL(String(c[0])).host,
    );
    expect(hosts).toEqual(['fallback.example']);
  });

  // Una cartera tranquila no es una caída: "No transactions found" es una
  // respuesta legítima y no puede disparar el failover (si no, cada lectura de
  // una cartera quieta martillearía todos los indexadores).
  test('"No transactions found" is an answer, not an outage — no failover', async () => {
    const fetchMock = routedFetch({
      'primary.example': () => ({ body: { status: '0', message: 'No transactions found', result: [] } }),
    });
    global.fetch = fetchMock;
    const p = new FlarescanProvider([PRIMARY, FALLBACK]);
    const r = await p.call('explorer.getActivity', { address: '0xdead' }, { traceId: 't' });
    expect(r.data).toEqual([]);
    const hosts = (fetchMock as unknown as jest.Mock).mock.calls.map(
      (c) => new URL(String(c[0])).host,
    );
    expect(hosts).toEqual(['primary.example']);
  });

  test('throws with every door named when none answers', async () => {
    global.fetch = routedFetch({
      'primary.example': () => new Error('boom-a'),
      'fallback.example': () => new Error('boom-b'),
    });
    const p = new FlarescanProvider([PRIMARY, FALLBACK]);
    await expect(
      p.call('explorer.getActivity', { address: '0xdead' }, { traceId: 't' }),
    ).rejects.toThrow(/flarescan_unreachable.*primary\.example.*fallback\.example/s);
  });
});
