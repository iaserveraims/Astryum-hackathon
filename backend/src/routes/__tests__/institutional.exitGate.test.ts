/**
 * «LA SALIDA JAMÁS SE GATEA» — las órdenes de consejo del pote y de la jaula.
 *
 * `/pote-council-order/prepare` y `/cage-order/prepare` componen órdenes que ABREN
 * exposición (direct-to…) y órdenes que la REDUCEN (recall, evacuate) en el mismo
 * handler. Hasta hoy las dos pasaban por `capitalGate` (flag + geofence) y, en la
 * jaula, además por la puerta del título de gestor. El frontend no manda región:
 * con una allowlist configurada TODO recall se rechazaba, y en un pote síncrono sin
 * colchón el holder no puede redimir sin un recall (`NOT_REDEEMABLE_NOW`).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import request from 'supertest';

jest.mock('../../services/flare/LegacyCageResolver', () => ({
  ...jest.requireActual('../../services/flare/LegacyCageResolver'),
  isCageV2Council: jest.fn(async () => false),
  cageForCouncil: jest.fn(async () => null),
  astryumCageFactoryAddress: jest.fn(() => null),
}));

const mockCheckManagerCredential = jest.fn();
jest.mock('../../services/ManagerCredentialGate', () => ({
  managerGateConfig: jest.fn(() => ({ enabled: true, credentialTypes: ['AIFM'], issuers: new Set(['rIssuer']) })),
  checkManagerCredential: (...a: unknown[]) => mockCheckManagerCredential(...a),
  managerGateRefusal: jest.fn(() => ({
    status: 403,
    body: { error: 'NO_MANAGER_CREDENTIAL', detail: 'hace falta una credencial AIFM' },
  })),
}));

import institutionalRouter from '../institutional';
import { jurisdictionService } from '../../services/JurisdictionService';

const app = express();
app.use(express.json());
app.use('/api/institutional', institutionalRouter);

const COUNCIL = 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY';
const POTE = '0xb0b0000000000000000000000000000000000001';
const BLOCKED = 'US';

const ENV = { ...process.env };
let geoSpy: jest.SpyInstance;

beforeEach(() => {
  process.env = { ...ENV };
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  process.env.DEFI_EXEC_BLOCKED_REGIONS = 'US,CN';
  mockCheckManagerCredential.mockReset();
  mockCheckManagerCredential.mockResolvedValue({
    ok: false,
    code: 'NO_MANAGER_CREDENTIAL',
    credentialTypes: ['AIFM'],
    missing: ['AIFM'],
    issuers: ['rIssuer'],
  });
  geoSpy = jest.spyOn(jurisdictionService, 'isDefiExecutionAllowed');
});

afterEach(() => {
  geoSpy.mockRestore();
});

afterAll(() => {
  process.env = ENV;
});

describe('/pote-council-order/prepare — recall es salida; direct-to abre exposición', () => {
  const body = (action: string, extra: Record<string, unknown> = {}) => ({
    council: COUNCIL,
    action,
    venueId: 0,
    amount: '1000000',
    ...extra,
  });

  it('recall en región bloqueada pasa la puerta (409 NO_CAGE, no 451) sin preguntar al geofence', async () => {
    const res = await request(app).post('/api/institutional/pote-council-order/prepare').send(body('recall', { region: BLOCKED }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NO_CAGE');
    expect(geoSpy).not.toHaveBeenCalled();
  });

  it('recall SIN región y con allowlist configurada (lo que manda el frontend) también pasa', async () => {
    delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
    process.env.DEFI_EXEC_ALLOWED_REGIONS = 'ES,AD';
    const res = await request(app).post('/api/institutional/pote-council-order/prepare').send(body('recall'));
    expect(res.status).not.toBe(451);
    expect(res.body.error).toBe('NO_CAGE');
  });

  it('direct-to en región bloqueada sigue respondiendo 451', async () => {
    const res = await request(app).post('/api/institutional/pote-council-order/prepare').send(body('direct-to', { region: BLOCKED }));
    expect(res.status).toBe(451);
    expect(res.body.error).toBe('GEOFENCE_BLOCKED');
  });

  it('una acción desconocida cae en la puerta ESTRICTA (451 antes que 400): nunca se abre por un typo', async () => {
    const res = await request(app).post('/api/institutional/pote-council-order/prepare').send(body('recal', { region: BLOCKED }));
    expect(res.status).toBe(451);
  });

  it('con el flag apagado, recall responde 503 — el kill-switch se queda', async () => {
    delete process.env.INSTITUTIONAL_POTES_ENABLED;
    const res = await request(app).post('/api/institutional/pote-council-order/prepare').send(body('recall', { region: BLOCKED }));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('INSTITUTIONAL_DISABLED');
  });
});

describe('/cage-order/prepare — recall y evacuate son salida: sin geofence y sin título de gestor', () => {
  const body = (action: string, extra: Record<string, unknown> = {}) => ({
    council: COUNCIL,
    action,
    params: { pote: POTE, venueId: 0, amount: '1000000' },
    ...extra,
  });

  it.each(['recall', 'evacuate'])(
    '%s en región bloqueada y SIN credencial de gestor pasa las dos puertas (ni 451 ni 403)',
    async (action) => {
      const res = await request(app).post('/api/institutional/cage-order/prepare').send(body(action, { region: BLOCKED }));
      expect({ action, status: res.status, error: res.body.error }).toEqual({
        action,
        status: 503,
        error: 'CAGE_FACTORY_UNCONFIGURED',
      });
      expect(geoSpy).not.toHaveBeenCalled();
      expect(mockCheckManagerCredential).not.toHaveBeenCalled();
    },
  );

  it('recall SIN región y con allowlist configurada (lo que manda el frontend) también pasa', async () => {
    delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
    process.env.DEFI_EXEC_ALLOWED_REGIONS = 'ES,AD';
    const res = await request(app).post('/api/institutional/cage-order/prepare').send(body('recall'));
    expect(res.status).not.toBe(451);
    expect(res.body.error).toBe('CAGE_FACTORY_UNCONFIGURED');
  });

  it('direct-to en región bloqueada sigue respondiendo 451', async () => {
    const res = await request(app).post('/api/institutional/cage-order/prepare').send(body('direct-to', { region: BLOCKED }));
    expect(res.status).toBe(451);
    expect(res.body.error).toBe('GEOFENCE_BLOCKED');
    expect(mockCheckManagerCredential).not.toHaveBeenCalled();
  });

  it.each(['direct-to', 'move', 'create-pote'])(
    'control: %s en región permitida sigue exigiendo el título de gestor (403)',
    async (action) => {
      const res = await request(app).post('/api/institutional/cage-order/prepare').send(body(action));
      expect({ action, status: res.status, error: res.body.error }).toEqual({
        action,
        status: 403,
        error: 'NO_MANAGER_CREDENTIAL',
      });
      expect(mockCheckManagerCredential).toHaveBeenCalled();
    },
  );

  it('con el flag apagado, evacuate responde 503 — el kill-switch se queda', async () => {
    delete process.env.INSTITUTIONAL_POTES_ENABLED;
    const res = await request(app).post('/api/institutional/cage-order/prepare').send(body('evacuate', { region: BLOCKED }));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('INSTITUTIONAL_DISABLED');
  });
});

describe('por fuente — las salidas de consejo no llegan al geofence', () => {
  const SOURCE = readFileSync(join(__dirname, '..', 'institutional.ts'), 'utf8');
  const blockOf = (path: string): string => {
    const start = SOURCE.indexOf(`router.post('${path}'`);
    expect({ path, found: start > -1 }).toEqual({ path, found: true });
    const next = SOURCE.indexOf('\nrouter.', start + 10);
    return SOURCE.slice(start, next === -1 ? undefined : next);
  };

  it('exitGate es solo el flag: no lee la región ni llama al geofence', () => {
    const start = SOURCE.indexOf('function exitGate(');
    expect(start).toBeGreaterThan(-1);
    const body = SOURCE.slice(start, SOURCE.indexOf('\n}\n', start));
    expect(body).toContain('poteGate()');
    expect(body).not.toMatch(/isDefiExecutionAllowed|capitalGate|regionOf/);
  });

  it('las salidas de jaula son EXACTAMENTE recall y evacuate (ampliar la lista es una decisión explícita)', () => {
    // La jaula usa LA clasificación compartida (services/councilExitToken.ts).
    expect(SOURCE).toMatch(/const CAGE_EXIT_ACTIONS[^=]*=\s*COUNCIL_ORDER_EXIT_ACTIONS/);
    const TOKEN_SOURCE = readFileSync(join(__dirname, '..', '..', 'services', 'councilExitToken.ts'), 'utf8');
    const m = TOKEN_SOURCE.match(/export const COUNCIL_ORDER_EXIT_ACTIONS[^=]*=\s*new Set\(\[([^\]]*)\]\)/);
    expect(m).not.toBeNull();
    const listed = (m as RegExpMatchArray)[1]
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean)
      .sort();
    expect(listed).toEqual(['evacuate', 'recall']);
  });

  /**
   * TODA SALIDA ENTREGA SU TOKEN.
   *
   * Sin token, la ceremonia multifirma depende de que el servidor reconozca el memo,
   * y una BD caída o un registro lleno cerraban la salida con un 451 de región. El
   * token es un MAC sobre ESOS bytes: viaja con la tx y abre la puerta de solo flag.
   * Tripwire por fuente: una salida nueva que se olvide el token falla aquí.
   */
  it.each([
    ['/pote-exit/prepare', 2], // las dos ramas: cola (request) e inmediata (sync)
    ['/pote-claim-exit/prepare', 1],
    ['/pote-creator-exit/prepare', 1],
    ['/pote-council-order/prepare', 1],
    ['/cage-order/prepare', 1],
  ])('%s entrega exitToken en su respuesta', (path, times) => {
    const body = blockOf(path);
    expect({ path, tokens: (body.match(/exitTokenFor\(/g) ?? []).length }).toEqual({ path, tokens: times });
  });

  it('el Legacy y el cobro de yield también lo entregan (xrplDefi.ts)', () => {
    const XRPL_DEFI = readFileSync(join(__dirname, '..', 'xrplDefi.ts'), 'utf8');
    expect((XRPL_DEFI.match(/issueCouncilExitToken\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    const claim = XRPL_DEFI.slice(XRPL_DEFI.indexOf("router.post('/vault-yield/claim/prepare'"));
    expect(claim.slice(0, claim.indexOf('\nrouter.'))).toContain('issueCouncilExitToken');
  });

  it('/pote-council-order/prepare elige la puerta por acción: recall → exitGate()', () => {
    const body = blockOf('/pote-council-order/prepare');
    expect(body).toMatch(/action === 'recall' \? exitGate\(\) : capitalGate\(req\)/);
  });

  it('/cage-order/prepare: salida → exitGate() y la puerta del gestor la salta', () => {
    const body = blockOf('/cage-order/prepare');
    expect(body).toMatch(/isExit \? exitGate\(\) : capitalGate\(req\)/);
    expect(body).toMatch(/action !== 'accept-pote' && !isExit/);
  });
});
