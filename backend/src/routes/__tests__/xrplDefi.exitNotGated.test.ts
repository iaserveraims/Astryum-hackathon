/**
 * THE EXIT IS NEVER GATED (doctrine «LA SALIDA JAMÁS SE GATEA») — the
 * XRPL-native DeFi router.
 *
 * Releasing an escrow (finish), recovering it (cancel — what the EscrowCreate
 * disclosure promises), cancelling one's own resting order and withdrawing one's own
 * AMM liquidity are EXITS: flag-only (XRPL_DEFI_ENABLED → 503 stays), never the
 * geofence. Entries on the same router (escrow-create, offer-create, amm-deposit)
 * keep answering 451 under a blocked region.
 *
 * Hermetic: every exit body below uses an explicit offerSequence / pure builder, so a
 * route that gets past the gate composes the unsigned tx without touching the ledger.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import request from 'supertest';
import xrplDefiRouter from '../xrplDefi';
import { jurisdictionService } from '../../services/JurisdictionService';

const app = express();
app.use(express.json());
app.use('/api/xrpl-defi', xrplDefiRouter);

const ACCOUNT = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const OWNER = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
const ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
const BLOCKED = 'US';

/** A VALID body for every exit route (region added per request). */
const EXIT_BODIES: Record<string, Record<string, unknown>> = {
  '/escrow-finish/prepare': { account: ACCOUNT, owner: OWNER, offerSequence: 7 },
  '/escrow-cancel/prepare': { account: ACCOUNT, owner: OWNER, offerSequence: 7 },
  '/offer-cancel/prepare': { account: ACCOUNT, offerSequence: 12 },
  '/amm-withdraw/prepare': {
    account: ACCOUNT,
    asset: { currency: 'XRP' },
    asset2: { currency: 'USD', issuer: ISSUER },
    withdraw: { mode: 'all' },
  },
};
const EXIT_PATHS = Object.keys(EXIT_BODIES);

const ENV = { ...process.env };
let geoSpy: jest.SpyInstance;

beforeEach(() => {
  process.env = { ...ENV };
  process.env.XRPL_DEFI_ENABLED = 'true';
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  process.env.DEFI_EXEC_BLOCKED_REGIONS = 'US,CN';
  geoSpy = jest.spyOn(jurisdictionService, 'isDefiExecutionAllowed');
});

afterEach(() => {
  geoSpy.mockRestore();
});

afterAll(() => {
  process.env = ENV;
});

describe('xrpl-defi — an EXIT is never blocked by region', () => {
  it.each(EXIT_PATHS)('%s: a blocked region composes the unsigned tx (200, not 451)', async (path) => {
    const res = await request(app)
      .post(`/api/xrpl-defi${path}`)
      .send({ ...EXIT_BODIES[path], region: BLOCKED });
    expect({ path, status: res.status, error: res.body?.error }).toEqual({ path, status: 200, error: undefined });
    expect(geoSpy).not.toHaveBeenCalled();
  });

  it.each(EXIT_PATHS)('%s: the flag still applies — XRPL_DEFI_ENABLED off answers 503', async (path) => {
    delete process.env.XRPL_DEFI_ENABLED;
    const res = await request(app)
      .post(`/api/xrpl-defi${path}`)
      .send({ ...EXIT_BODIES[path], region: BLOCKED });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('XRPL_DEFI_DISABLED');
  });
});

describe('xrpl-defi — an ENTRY in a blocked region still answers 451', () => {
  const ENTRY_BODIES: Record<string, Record<string, unknown>> = {
    '/escrow-create/prepare': {
      account: ACCOUNT,
      amountDrops: '1000000',
      finishAfterISO: '2030-01-01T00:00:00Z',
    },
    '/offer-create/prepare': {
      account: ACCOUNT,
      takerGets: '1000000',
      takerPays: { currency: 'USD', issuer: ISSUER, value: '1' },
    },
    '/amm-deposit/prepare': {
      account: ACCOUNT,
      asset: { currency: 'XRP' },
      asset2: { currency: 'USD', issuer: ISSUER },
      deposit: { mode: 'single-asset', amount: '1000000' },
    },
  };

  it.each(Object.keys(ENTRY_BODIES))('%s → 451 GEOFENCE_BLOCKED', async (path) => {
    const res = await request(app)
      .post(`/api/xrpl-defi${path}`)
      .send({ ...ENTRY_BODIES[path], region: BLOCKED });
    expect(res.status).toBe(451);
    expect(res.body.error).toMatch(/^GEOFENCE_BLOCKED/);
    expect(geoSpy).toHaveBeenCalled();
  });
});

/**
 * council-order/relay DELIVERS an order the council already signed and the XRPL
 * already validated. A 451 here did not stop exposure from opening — it left a
 * signed order (a recall, an evacuation) undelivered and unregistered, so the
 * watcher never recovered it. Flag-only; requireLegacyAccess stays — LEGACY_ENABLED=true opens it here without a DB read.
 *
 * Hermetic: with FLARE_EXECUTOR_ENABLED unset the route answers 503 RELAYER_DISABLED
 * right after the gate — reaching it (instead of 451) is the proof, no FDC launched.
 */
describe('xrpl-defi — delivering an ALREADY-SIGNED council order is never blocked by region', () => {
  const RELAY_BODY = { xrplTxHash: 'A'.repeat(64), orderData: '0x00' };

  beforeEach(() => {
    process.env.LEGACY_ENABLED = 'true';
    delete process.env.FLARE_EXECUTOR_ENABLED;
  });

  it('a blocked region gets past the gate (503 RELAYER_DISABLED, not 451) without asking the geofence', async () => {
    const res = await request(app)
      .post('/api/xrpl-defi/council-order/relay')
      .send({ ...RELAY_BODY, region: BLOCKED });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('RELAYER_DISABLED');
    expect(geoSpy).not.toHaveBeenCalled();
  });

  it('no region under an allowlist (what the frontend sends) gets past the gate too', async () => {
    delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
    process.env.DEFI_EXEC_ALLOWED_REGIONS = 'ES,AD';
    const res = await request(app).post('/api/xrpl-defi/council-order/relay').send(RELAY_BODY);
    expect(res.status).not.toBe(451);
    expect(res.body.error).toBe('RELAYER_DISABLED');
  });

  it('the flag still applies: XRPL_DEFI_ENABLED off answers 503 XRPL_DEFI_DISABLED', async () => {
    delete process.env.XRPL_DEFI_ENABLED;
    const res = await request(app)
      .post('/api/xrpl-defi/council-order/relay')
      .send({ ...RELAY_BODY, region: BLOCKED });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('XRPL_DEFI_DISABLED');
  });
});

describe('by source — every exit uses the flag-only gate; no exit reaches the geofenced one', () => {
  it('council-order/relay uses gateXrplDefiExit() and keeps requireLegacyAccess', () => {
    const src = readFileSync(join(__dirname, '..', 'xrplDefi.ts'), 'utf8');
    const start = src.indexOf("router.post('/council-order/relay'");
    expect(start).toBeGreaterThan(-1);
    const next = src.indexOf('\nrouter.', start + 10);
    const block = src.slice(start, next === -1 ? undefined : next);
    expect(block).toContain('requireLegacyAccess');
    expect(block).toContain('gateXrplDefiExit()');
    expect(block).not.toMatch(/gateXrplDefi\(|isDefiExecutionAllowed/);
  });

  const SOURCE = readFileSync(join(__dirname, '..', 'xrplDefi.ts'), 'utf8');
  const blockOf = (path: string): string => {
    const start = SOURCE.search(new RegExp(`router\\.post\\(\\s*'${path.replace(/[/-]/g, '\\$&')}'`));
    expect({ path, found: start > -1 }).toEqual({ path, found: true });
    const next = SOURCE.indexOf('\nrouter.', start + 10);
    return SOURCE.slice(start, next === -1 ? undefined : next);
  };
  const fnBody = (name: string): string => {
    const start = SOURCE.indexOf(`function ${name}(`);
    expect({ name, found: start > -1 }).toEqual({ name, found: true });
    const end = SOURCE.indexOf('\n}\n', start);
    return SOURCE.slice(start, end);
  };

  it('escrow-finish / escrow-cancel ride escrowReleaseHandler, whose gate is gateXrplDefiExit()', () => {
    for (const path of ['/escrow-finish/prepare', '/escrow-cancel/prepare']) {
      expect(blockOf(path)).toContain('escrowReleaseHandler(');
    }
    const handler = fnBody('escrowReleaseHandler');
    expect(handler).toContain('gateXrplDefiExit()');
    expect(handler).not.toContain('gateXrplDefi(');
  });

  it('offer-cancel / amm-withdraw use prepareExit, never prepare', () => {
    for (const path of ['/offer-cancel/prepare', '/amm-withdraw/prepare']) {
      const body = blockOf(path);
      expect({ path, exit: body.includes('prepareExit(') }).toEqual({ path, exit: true });
      expect({ path, geofenced: /[^t]prepare\(|gateXrplDefi\(/.test(body) }).toEqual({ path, geofenced: false });
    }
    const exitGate = fnBody('gateXrplDefiExit');
    expect(exitGate).not.toContain('isDefiExecutionAllowed');
  });
});


/**
 * EL ASIENTO
 * ILEGIBLE NO ES UN CONFLICTO.
 *
 * `SeatStateUnreadableError` hereda de `NonceSeatTakenError` y conserva su `name`
 * A PROPÓSITO, para que una ruta antigua conteste un 409 conocido en vez de un 500
 * mudo. Estas dos rutas clasifican POR NOMBRE, así que «no pude leer el estado del
 * asiento» salía como 409 definitivo — también sobre una salida. La clase trae su
 * propia marca de instancia (`unreadableSeatState`); leerla es lo que separa «hay
 * algo de alguien ahí» (409) de «no lo sé y no compuse nada» (503, reintentable).
 */
describe('Un asiento que no se pudo LEER responde 503, nunca un 409 definitivo', () => {
  const read = (file: string): string => readFileSync(join(__dirname, '..', file), 'utf8');

  it('xrpl-defi: handoffErrorResponse decide el status por unreadableSeatState', () => {
    const src = read('xrplDefi.ts');
    const start = src.indexOf('function handoffErrorResponse(');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n}\n', start));
    expect(body).toContain('unreadableSeatState');
    expect(body).toContain('503');
    // …y el 409 ya no es incondicional.
    expect(body).not.toMatch(/\n\s*status: 409,/);
  });

  it('institutional: las seis puertas de asiento pasan por seatRefusalStatus', () => {
    const src = read('institutional.ts');
    expect(src).toContain('function seatRefusalStatus(');
    expect(src).toContain('unreadableSeatState');
    // Ni una sola respuesta de asiento con el 409 clavado a mano.
    expect(src).not.toContain('res.status(409).json(nonceSeatBody(e))');
    const uses = src.split('res.status(seatRefusalStatus(e)).json(nonceSeatBody(e))').length - 1;
    expect(uses).toBe(6);
  });
});

/**
 * LA SALIDA PREGUNTA CON
 * «EXIT», Y LA FILA LLEVA LAS DOS MITADES.
 */
describe('Ninguna puerta de 0xFE de este router pregunta en booleano', () => {
  const src = (): string => readFileSync(join(__dirname, '..', 'xrplDefi.ts'), 'utf8');

  it('no queda ni una llamada a la forma booleana en una puerta que compone un 0xFE', () => {
    // La forma booleana pierde el 503 de la tienda ilegible Y el propósito. (Las dos
    // formas en que se llamaba; el nombre a secas sigue apareciendo en el comentario
    // que explica por qué ya no se usa.)
    expect(src()).not.toContain('await sessionMayActOnXrplAccount(');
    expect(src()).not.toContain(').sessionMayActOnXrplAccount(');
  });

  it('existe UNA sola manera de rellenar el par, y usa el contrato del agente E', () => {
    const s = src();
    expect(s).toContain('async function seatProofFieldsFor(');
    expect(s).toContain('seatProofFromVerdict');
    expect(s).toContain('preparedByProofUnreadable');
    // Y propaga el refusal ENTERO en vez de un `false` mudo: este
    // tripwire exigía el literal `code: 'PROOF_STORE_UNREADABLE'`, es decir,
    // consagraba que la puerta colapsara TODO refusal reintentable (también
    // `PROOF_FLOOR_AHEAD_OF_CLOCK`) en ese código con una frase falsa
    // («could not read … in a moment» sobre una fila leída y un instante que
    // puede ser 2099). Lo que se fija ahora es la forma contraria: el error se
    // construye DESDE el refusal, y ningún código de prueba se escribe a mano.
    expect(s).toContain('SeatStateUnreadableError.fromProofRefusal(claim.refusal)');
    expect(s).not.toContain("code: 'PROOF_STORE_UNREADABLE'");
    expect(s).not.toMatch(/PROOF_STORE_UNREADABLE: Astryum could not read/);
    // …y el serializador reenvía ese refusal tal cual (código, headline, ways).
    expect(s).toContain('forwardedProofRefusalBody(e)');
    expect(s).toContain('forwardedProofRefusalStatus(e)');
  });

  it('el cobro de rendimiento —una SALIDA— pregunta con «exit»', () => {
    const s = src();
    const start = s.indexOf("action: 'legacy-yield-claim'");
    expect(start).toBeGreaterThan(-1);
    // El veredicto que alimenta esa fila se pide justo antes, con propósito de salida.
    const before = s.slice(Math.max(0, start - 1500), start);
    expect(before).toContain("seatProofFieldsFor(req, xrplAddr, { purpose: 'exit' })");
  });

  it('las dos ENTRADAS siguen preguntando con «entry» — el arreglo no las ablanda', () => {
    const s = src();
    for (const action of ["action: 'legacy-vault-fund'", "action: 'legacy-cage-create'"]) {
      const at = s.indexOf(action);
      expect({ action, found: at > -1 }).toEqual({ action, found: true });
      const around = s.slice(at, at + 600);
      expect({ action, entry: around.includes("{ purpose: 'entry' }") }).toEqual({ action, entry: true });
    }
  });
});
