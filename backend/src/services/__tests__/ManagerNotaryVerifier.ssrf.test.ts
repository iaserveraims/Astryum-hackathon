/**
 *
 * El `Domain` lo escribe cualquier dueño de cuenta y el endpoint es público:
 * `https://${domain}/.well-known/xrp-ledger.toml` iba a 169.254.169.254 o a
 * *.railway.internal, seguía redirecciones, y el veredicto devolvía el status o
 * el mensaje de error del destino. Lo que se fija aquí: solo hostnames DNS
 * públicos que resuelven a IPs públicas, cero redirecciones, techo de bytes, y
 * motivos genéricos.
 */

const mockGetAccountDomain = jest.fn();
jest.mock('../../integrations/providers/chain/XRPLProvider', () => ({
  xrplProvider: { getAccountDomain: (...a: unknown[]) => mockGetAccountDomain(...a) },
}));

import {
  fetchXrplToml,
  isFetchableDomain,
  isNonPublicIp,
  runNotaryCheck,
} from '../ManagerNotaryVerifier';

const ACCOUNT = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const PUBLIC_LOOKUP = async () => [{ address: '93.184.216.34' }];

type FakeRes = { ok: boolean; status: number; type?: string; headers: { get: (k: string) => string | null }; body: null; text: () => Promise<string> };
const fakeRes = (status: number, text = '', headers: Record<string, string> = {}): FakeRes => ({
  ok: status >= 200 && status < 300,
  status,
  type: 'basic',
  headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  body: null,
  text: async () => text,
});
const asFetch = (fn: jest.Mock) => fn as unknown as typeof fetch;
const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex').toUpperCase();

beforeEach(() => jest.clearAllMocks());

describe('isFetchableDomain — un hostname DNS público, nada más', () => {
  it.each([
    '169.254.169.254',
    '127.0.0.1',
    '[::1]',
    'localhost',
    'printer.local',
    'postgres.railway.internal',
    'metadata.google.internal',
    'evil.example:8080',
    'evil.example/admin',
    'user@evil.example',
    'evil.example?x=1',
    'evil.example#frag',
    '-bad.example',
    'bad-.example',
    'nodot',
  ])('rechaza %s', (d) => {
    expect(isFetchableDomain(d)).toBe(false);
  });

  it('acepta un dominio público normal', () => {
    expect(isFetchableDomain('gestora.example.com')).toBe(true);
    expect(isFetchableDomain('Ripple.COM')).toBe(true);
  });
});

describe('isNonPublicIp', () => {
  it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.20.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', 'not-an-ip'])(
    '%s no es pública',
    (ip) => expect(isNonPublicIp(ip)).toBe(true),
  );
  it.each(['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111'])('%s es pública', (ip) => {
    expect(isNonPublicIp(ip)).toBe(false);
  });
});

describe('fetchXrplToml — la frontera de red', () => {
  it('un dominio no apto no provoca NI resolución NI fetch', async () => {
    const fetchImpl = jest.fn();
    const lookupImpl = jest.fn();
    const out = await fetchXrplToml('169.254.169.254', { fetchImpl: asFetch(fetchImpl), lookupImpl });
    expect(out.accounts).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lookupImpl).not.toHaveBeenCalled();
  });

  it('un hostname público que RESUELVE a una IP privada no se lee', async () => {
    const fetchImpl = jest.fn();
    const out = await fetchXrplToml('rebind.example.com', {
      fetchImpl: asFetch(fetchImpl),
      lookupImpl: async () => [{ address: '93.184.216.34' }, { address: '169.254.169.254' }],
    });
    expect(out.accounts).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('una redirección es un fallo: se pide con redirect manual y un 3xx no se sigue', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeRes(302, '', { location: 'http://169.254.169.254/latest/meta-data' }));
    const out = await fetchXrplToml('gestora.example.com', { fetchImpl: asFetch(fetchImpl), lookupImpl: PUBLIC_LOOKUP });
    expect(out.accounts).toBeNull();
    expect(out.reason).toBe('redirección rechazada');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://gestora.example.com/.well-known/xrp-ledger.toml');
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('un toml correcto se lee', async () => {
    const toml = ['[[ACCOUNTS]]', `address = "${ACCOUNT}"`].join('\n');
    const fetchImpl = jest.fn().mockResolvedValue(fakeRes(200, toml));
    const out = await fetchXrplToml('gestora.example.com', { fetchImpl: asFetch(fetchImpl), lookupImpl: PUBLIC_LOOKUP });
    expect(out).toEqual({ accounts: [ACCOUNT] });
  });

  it('los errores del destino NO se reflejan: ni mensaje, ni status', async () => {
    const boom = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.7:5432'));
    const a = await fetchXrplToml('gestora.example.com', { fetchImpl: asFetch(boom), lookupImpl: PUBLIC_LOOKUP });
    expect(a.reason).toBe('inalcanzable');
    expect(a.reason).not.toContain('ECONNREFUSED');

    const http = jest.fn().mockResolvedValue(fakeRes(418));
    const b = await fetchXrplToml('gestora.example.com', { fetchImpl: asFetch(http), lookupImpl: PUBLIC_LOOKUP });
    expect(b.accounts).toBeNull();
    expect(b.reason).not.toContain('418');
  });

  it('un cuerpo que declara más del techo no se lee', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeRes(200, 'x', { 'content-length': String(10 * 1024 * 1024) }));
    const out = await fetchXrplToml('gestora.example.com', { fetchImpl: asFetch(fetchImpl), lookupImpl: PUBLIC_LOOKUP });
    expect(out).toEqual({ accounts: null, reason: 'toml demasiado grande' });
  });

  it('un nombre que no resuelve es «no pude leer», no una excepción', async () => {
    const fetchImpl = jest.fn();
    const out = await fetchXrplToml('nx.example.com', {
      fetchImpl: asFetch(fetchImpl),
      lookupImpl: async () => { throw new Error('ENOTFOUND nx.example.com'); },
    });
    expect(out).toEqual({ accounts: null, reason: 'no resuelve' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('runNotaryCheck — el Domain del atacante no llega a la red', () => {
  it('Domain = 169.254.169.254 → sin fetch, y el detalle dice «no pude leer», no un status', async () => {
    mockGetAccountDomain.mockResolvedValue(hex('169.254.169.254'));
    const fetchImpl = jest.fn();
    const v = await runNotaryCheck(ACCOUNT, { fetchImpl: asFetch(fetchImpl), lookupImpl: PUBLIC_LOOKUP });
    expect(fetchImpl).not.toHaveBeenCalled();
    const binding = v.checks.find((c) => c.key === 'toml-binding');
    expect(binding?.ok).toBe(false);
    expect(binding?.detail).toContain('No se pudo leer');
    expect(binding?.detail).toContain('dominio no apto para lectura');
  });

  it('Domain con puerto/ruta hacia la red interna → sin fetch', async () => {
    mockGetAccountDomain.mockResolvedValue(hex('postgres.railway.internal:5432/'));
    const fetchImpl = jest.fn();
    await runNotaryCheck(ACCOUNT, { fetchImpl: asFetch(fetchImpl), lookupImpl: PUBLIC_LOOKUP });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
