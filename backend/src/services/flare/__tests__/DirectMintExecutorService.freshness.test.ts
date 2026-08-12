/**
 * Sondeo de frescura del barrido 0xFE (incidente 2026-07-31): s1/s2 de Ripple
 * se congelaron respondiendo `success` con una ventana ~4h vieja — account_tx
 * omitía los Payments nuevos y la rotación por error jamás saltaba, dejando al
 * watcher ciego mientras el XRP de los usuarios esperaba en el Core Vault.
 *
 * Qué se prueba y por qué:
 *  1. Un endpoint con ledger validado reciente es fresco — el barrido puede
 *     fiarse de su account_tx.
 *  2. Un endpoint congelado (close_time viejo) NO es fresco aunque responda
 *     `success` — es exactamente la mentira-por-omisión del incidente.
 *  3. Transporte caído / HTTP no-ok / respuesta sin ledger → no fresco: ante
 *     la duda, rotar.
 *  4. El memo por endpoint evita re-sondear dentro del mismo barrido (varias
 *     páginas por tick) y expira pasado el TTL — un nodo que se recupera no
 *     queda vetado para siempre.
 */
import { xrplEndpointFresh } from '../DirectMintExecutorService';

const RIPPLE_EPOCH_S = 946_684_800;
/** close_time XRPL (epoch ripple, segundos) de hace `ageS` segundos. */
const closeTimeAgo = (nowMs: number, ageS: number) => Math.floor(nowMs / 1000) - RIPPLE_EPOCH_S - ageS;

const ledgerResponse = (closeTime: number) => ({
  ok: true,
  json: async () => ({ result: { status: 'success', ledger: { close_time: closeTime } } }),
});

const originalFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

// URLs únicas por caso: el memo de frescura es por-endpoint a nivel de módulo.
let n = 0;
const url = () => `https://freshness-test-${n++}.invalid:51234`;

describe('xrplEndpointFresh — el barrido no se fía de un nodo congelado', () => {
  it('ledger validado reciente → fresco', async () => {
    const now = Date.now();
    fetchMock.mockResolvedValue(ledgerResponse(closeTimeAgo(now, 10)));
    await expect(xrplEndpointFresh(url(), now)).resolves.toBe(true);
  });

  it('ledger validado de hace horas → NO fresco aunque responda success (el incidente)', async () => {
    const now = Date.now();
    fetchMock.mockResolvedValue(ledgerResponse(closeTimeAgo(now, 4 * 3600)));
    await expect(xrplEndpointFresh(url(), now)).resolves.toBe(false);
  });

  it('justo por encima del umbral de 5 min → NO fresco', async () => {
    const now = Date.now();
    fetchMock.mockResolvedValue(ledgerResponse(closeTimeAgo(now, 301)));
    await expect(xrplEndpointFresh(url(), now)).resolves.toBe(false);
  });

  it('transporte caído → NO fresco (rotar, no lanzar)', async () => {
    const now = Date.now();
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(xrplEndpointFresh(url(), now)).resolves.toBe(false);
  });

  it('HTTP no-ok (402 del gate a datacenter) → NO fresco', async () => {
    const now = Date.now();
    fetchMock.mockResolvedValue({ ok: false, status: 402, json: async () => ({}) });
    await expect(xrplEndpointFresh(url(), now)).resolves.toBe(false);
  });

  it('respuesta sin ledger/close_time → NO fresco', async () => {
    const now = Date.now();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: { status: 'success' } }) });
    await expect(xrplEndpointFresh(url(), now)).resolves.toBe(false);
  });

  it('memo: dentro del TTL no re-sondea; pasado el TTL sí (un nodo recuperado vuelve)', async () => {
    const now = Date.now();
    const target = url();
    fetchMock.mockResolvedValue(ledgerResponse(closeTimeAgo(now, 4 * 3600)));
    await expect(xrplEndpointFresh(target, now)).resolves.toBe(false);
    await expect(xrplEndpointFresh(target, now + 30_000)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // la segunda vino del memo

    fetchMock.mockResolvedValue(ledgerResponse(closeTimeAgo(now + 61_000, 10)));
    await expect(xrplEndpointFresh(target, now + 61_000)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2); // TTL vencido → re-sondeo real
  });
});
