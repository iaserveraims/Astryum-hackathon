/**
 * Los guardarraíles de público del pote (doc Producto A §7.1, §14.8, §15.1).
 *
 * Hasta el 24-ago-2026 `institutional.ts` era el ÚNICO carril DeFi del backend
 * sin geofence y sin cap: sus cinco hermanos (xrplDefi, ethMorpho, flareDemo,
 * walletTransfer, councilProposals) ya llamaban a `isDefiExecutionAllowed`, y
 * el cap de `config/demoCap` lo aplicaban tres de ellos. El pote, ninguno de los
 * dos. Un usuario no necesita nuestra UI para llamar a un endpoint: le basta
 * curl — así que un envoltorio de frontend no era protección.
 *
 * Este test existe para que no se vuelva a caer, y cubre lo que la allowlist de
 * venues NO puede cubrir (§15.5): la allowlist protege del venue; esto protege
 * de que la RUTA deje de hacer lo que dice que hace.
 *
 * Tres invariantes:
 *  1) GEOFENCE (#5) — toda ruta que mueve capital responde 451 fuera de región.
 *  2) CAP — las dos rutas que abren posición cuentan contra `config/demoCap`.
 *     Las SALIDAS 0xFE solo capan el TAMAÑO de su carrier, por transacción: el
 *     cupo diario por dirección jamás rechaza una salida (la salida nunca se gatea).
 *  3) FEE = 0 (§15.1) — ningún redeem compone una fee de Astryum al cliente.
 *
 * El geofence se comprueba por FUENTE además de por runtime: una ruta nueva que
 * copie `poteGate()` en vez de `capitalGate(req)` nace sin geofence y en runtime
 * solo la cazaríamos si alguien se acordara de añadirle un caso aquí.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import request from 'supertest';

jest.mock('../../services/flare/AstryumPoteStateService', () => ({
  ...jest.requireActual('../../services/flare/AstryumPoteStateService'),
  readPoteState: jest.fn(),
  readHolderShares: jest.fn(),
}));

// La salida 0xFE resuelve la Personal Account on-chain justo DESPUÉS del cap. Sin
// PA (el mock devuelve undefined tras resetAllMocks) la ruta responde 409
// NO_PERSONAL_ACCOUNT: la señal determinista, sin RPC, de que el cap ya dejó pasar.
jest.mock('../../connectors/protocols/flare/FlareSmartAccountService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareSmartAccountService'),
  resolvePersonalAccount: jest.fn(),
}));

import institutionalRouter from '../institutional';
import { readPoteState, type AstryumPoteState } from '../../services/flare/AstryumPoteStateService';
import { _resetSwrForTests } from '../../services/flare/swrCache';
import { _resetDemoCapState, checkDemoCap } from '../../config/demoCap';

const app = express();
app.use(express.json());
app.use('/api/institutional', institutionalRouter);

const POTE = '0xb0b0000000000000000000000000000000000001';
const ASSET = '0xad552a648c74d49e10027ab8a618a3ad4901c5be';
const CLIENT = '0xeeee000000000000000000000000000000000001';
const XRPL_ACCOUNT = 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY';

function fixtureState(): AstryumPoteState {
  return {
    pote: POTE,
    name: 'Astryum Pote A',
    symbol: 'apA-FXRP',
    shareDecimals: 9,
    asset: { address: ASSET, symbol: 'FXRP', decimals: 6 },
    totalAssets: '100000000000',
    totalSupply: '100000000000000',
    sharePrice: '1000000',
    cooldownSeconds: 0,
    bufferFloorBps: 1000,
    freeBalance: '10000000000',
    earmarkedAssets: '0',
    totalClaimable: '0',
    maxVenueBps: 10_000,
    venues: [
      {
        id: 0,
        target: '0xAAaa000000000000000000000000000000000001',
        kind: 'compoundv2',
        readyAt: 0,
        retired: false,
        basis: '90000000000',
        value: '90000000000',
        queuedTotal: '0',
      },
    ],
    tickets: [],
    governance: {
      council: '0xcccc000000000000000000000000000000000001',
      constitutionRef: '0x' + '11'.repeat(32),
      director: '0xdddd000000000000000000000000000000000001',
      directorUntil: Math.floor(Date.now() / 1000) + 30 * 86_400,
      payees: [],
    },
  };
}

const ENV = { ...process.env };

beforeEach(() => {
  // El estado del pote se sirve de caché (swrCache, 2026-09-11): cada caso
  // fija SU fixture, así que la caché se vacía entre casos.
  _resetSwrForTests();
  jest.resetAllMocks();
  _resetDemoCapState();
  process.env = { ...ENV };
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  // Cap holgado por defecto: los tests que lo miden lo aprietan ellos.
  process.env.DEMO_MAX_XRP_PER_TX = '1000';
  process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY = '10000';
  (readPoteState as jest.Mock).mockResolvedValue(fixtureState());
});

afterAll(() => {
  process.env = ENV;
});

// ── 1. GEOFENCE (invariante #5) ──────────────────────────────────────────────

describe('geofence — invariante #5', () => {
  // El bloqueo lo declara la env (JurisdictionService no detecta región: la
  // recibe del caller y aplica DEFI_EXEC_BLOCKED_REGIONS / _ALLOWED_REGIONS).
  const BLOCKED = 'US';
  beforeEach(() => {
    process.env.DEFI_EXEC_BLOCKED_REGIONS = 'US,CN';
  });

  it('el depósito responde 451 GEOFENCE_BLOCKED en región bloqueada', async () => {
    const res = await request(app)
      .post('/api/institutional/pote-deposit/prepare')
      .send({ pote: POTE, amountBase: '1000000', receiver: CLIENT, region: BLOCKED });

    expect(res.status).toBe(451);
    expect(res.body.error).toBe('GEOFENCE_BLOCKED');
  });

  it('la entrada con XRP responde 451 en región bloqueada', async () => {
    const res = await request(app)
      .post('/api/institutional/pote-fund-xrp/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE, amountXrp: '1', receiver: CLIENT, region: BLOCKED });

    expect(res.status).toBe(451);
    expect(res.body.error).toBe('GEOFENCE_BLOCKED');
  });

  it('la SALIDA no se bloquea por región — el capital del user nunca queda preso', async () => {
    const res = await request(app)
      .post('/api/institutional/pote-redeem/prepare')
      .send({ pote: POTE, sharesBase: '1000000', receiver: CLIENT, owner: CLIENT, region: BLOCKED });

    // Si algún día se decide bloquear también la salida, este test debe cambiarse
    // A PROPÓSITO y con una nota: encerrar el capital de alguien por su región es
    // una decisión de producto grave, nunca un efecto lateral de un refactor.
    expect(res.status).not.toBe(451);
  });

  it('sin región declarada y CON allowlist, falla cerrado (no abierto)', async () => {
    delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
    process.env.DEFI_EXEC_ALLOWED_REGIONS = 'ES,AD';

    const res = await request(app)
      .post('/api/institutional/pote-deposit/prepare')
      .send({ pote: POTE, amountBase: '1000000', receiver: CLIENT });

    // «No sé de dónde eres» no puede significar «pasa».
    expect(res.status).toBe(451);
    expect(res.body.detail).toContain('region_required_under_allowlist');
  });

  it('región dentro de la allowlist pasa', async () => {
    delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
    process.env.DEFI_EXEC_ALLOWED_REGIONS = 'ES,AD';

    const res = await request(app)
      .post('/api/institutional/pote-deposit/prepare')
      .send({ pote: POTE, amountBase: '1000000', receiver: CLIENT, region: 'ES' });

    expect(res.status).toBe(200);
  });
});

// ── 2. CAP off-chain ─────────────────────────────────────────────────────────

describe('cap off-chain — protección pre-auditoría', () => {
  it('el depósito por encima del tope por transacción se para antes de firmar', async () => {
    process.env.DEMO_MAX_XRP_PER_TX = '5';

    const res = await request(app)
      .post('/api/institutional/pote-deposit/prepare')
      // 6 FXRP en unidades base (6 decimales) — por encima del tope de 5
      .send({ pote: POTE, amountBase: '6000000', receiver: CLIENT });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('DEMO_TX_CAP_EXCEEDED');
  });

  it('la entrada con XRP por encima del tope se para antes de firmar', async () => {
    process.env.DEMO_MAX_XRP_PER_TX = '5';

    const res = await request(app)
      .post('/api/institutional/pote-fund-xrp/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE, amountXrp: '6', receiver: CLIENT });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('DEMO_TX_CAP_EXCEEDED');
  });

  it('por debajo del tope, el cap deja pasar', async () => {
    process.env.DEMO_MAX_XRP_PER_TX = '100';

    const res = await request(app)
      .post('/api/institutional/pote-deposit/prepare')
      .send({ pote: POTE, amountBase: '1000000', receiver: CLIENT });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.calls)).toBe(true);
  });
});

// ── 2b. SALIDA 0xFE — se capa el tamaño del carrier, nunca la salida ─────────
//
// LA SALIDA NUNCA SE GATEA. `/pote-exit` y `/pote-claim-exit` mintean un carrier
// 0xFE, y ese carrier mantiene el tope POR TRANSACCIÓN (radio de explosión). Lo
// que no puede volver a pasar: que el cupo DIARIO por dirección — compartido con
// los depósitos — deje a quien depositó hoy sin poder salir hoy, ni que el carrier
// por defecto (antes 2 XRP, por encima del tope por defecto de 1) rechace sola una
// salida que nadie pidió con carrier.

describe('salida 0xFE — se capa el tamaño del carrier, nunca la salida', () => {
  beforeEach(() => {
    process.env.DEMO_MAX_XRP_PER_TX = '1';
    process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY = '2';
  });

  it('quien ya agotó su cupo diario (depositó hoy) sigue pudiendo salir hoy', async () => {
    // Los depósitos del día reservaron el cupo entero de esta dirección…
    // (dos depósitos de 1 XRP: el tope por tx es 1).
    expect(await checkDemoCap(1, XRPL_ACCOUNT)).toBeNull();
    expect(await checkDemoCap(1, XRPL_ACCOUNT)).toBeNull();
    // …y una ENTRADA más ya se rechaza (control: el cupo está de verdad agotado).
    expect((await checkDemoCap(1, XRPL_ACCOUNT))?.body.error).toBe('DEMO_DAILY_CAP_EXCEEDED');

    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE, amountXrpForMint: '1' });

    expect(res.body.error).not.toBe('DEMO_DAILY_CAP_EXCEEDED');
    expect(res.body.error).not.toBe('DEMO_TX_CAP_EXCEEDED');
    // Pasó el cap: lo siguiente que la ruta necesita es la PA (aquí no hay).
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NO_PERSONAL_ACCOUNT');
  });

  it('un carrier EXPLÍCITO por encima del tope por tx se rechaza sin tocarlo — y dice que la salida no tiene límite', async () => {
    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE, amountXrpForMint: '1.5' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('DEMO_TX_CAP_EXCEEDED');
    expect(res.body.detail).toMatch(/salida en sí no tiene límite/);
    expect(res.body.detail).toMatch(/carrier/);
  });

  it('el carrier POR DEFECTO cabe bajo el tope por tx y la salida pasa', async () => {
    delete process.env.DEMO_MAX_XRP_PER_TX; // el default real: 1 XRP por transacción

    const res = await request(app)
      .post('/api/institutional/pote-exit/prepare')
      .send({ account: XRPL_ACCOUNT, pote: POTE });

    expect(res.body.error).not.toBe('DEMO_TX_CAP_EXCEEDED');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NO_PERSONAL_ACCOUNT');
  });
});

// ── 3. FEE = 0 al cliente (§15.1) ────────────────────────────────────────────

describe('fee de Astryum al cliente — debe ser CERO', () => {
  it('el redeem no compone ninguna fee aunque las envs estén puestas', async () => {
    // Las envs que ANTES la encendían. Ahora no hacen nada: redeemServiceFee()
    // es inerte porque el ingreso viene del lado del operador (§15.1).
    process.env.INSTITUTIONAL_FEE_COLLECTOR = '0xfeee000000000000000000000000000000000001';
    process.env.INSTITUTIONAL_REDEEM_FEE_BPS = '500';

    const res = await request(app)
      .post('/api/institutional/pote-redeem/prepare')
      .send({ pote: POTE, sharesBase: '1000000', receiver: CLIENT, owner: CLIENT });

    expect(res.status).toBe(200);
    expect(res.body.fee).toBeNull();

    // Y ninguna call transfiere participaciones a un colector: el user redime
    // exactamente lo que firmó.
    const calls: Array<{ label: string }> = res.body.calls ?? [];
    expect(calls.some((c) => /fee/i.test(c.label))).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

// ── 4. FUENTE — que una ruta nueva no nazca sin geofence ─────────────────────

describe('barrido de fuente — ninguna ruta de capital se queda sin geofence', () => {
  const SOURCE = readFileSync(join(__dirname, '..', 'institutional.ts'), 'utf8');

  /** Ceremonias de identidad XRPL: no mueven capital, el geofence no aplica. */
  const CEREMONIES = [
    '/credential-issue/prepare',
    '/credential-accept/prepare',
    '/council/anchor/prepare',
    '/domain/set/prepare',
  ];

  /**
   * Salidas y reducciones de exposición: NUNCA se bloquean por región. El
   * geofence existe para impedir que se ABRA exposición DeFi donde no toca;
   * usarlo para impedir salir convertiría un límite regulatorio en un secuestro
   * de fondos ajenos.
   *
   * El precedente es del propio contrato: `userGate` de AstryumVault es
   * ENTRY-ONLY («la salida nunca lo llama»), y las redenciones pueden cruzar el
   * suelo del colchón porque la salida del holder manda sobre el buffer.
   *
   * Mover una ruta de esta lista a la de geofence es una decisión de producto
   * consciente — que es exactamente lo que este test obliga a hacer explícito.
   */
  const EXITS = [
    '/pote-redeem/prepare',
    '/pote-claim-redeem/prepare',
    '/pote-exit-xrp/prepare',
    '/pote-creator-exit/prepare',
    '/pote-recall/prepare',
    // La salida completa del modo no-custodial: redeem + unmint en una firma.
    // Lo que SALE no se capa ni se geofencea; su CARRIER sí (mintea de verdad y
    // consume presupuesto del executor) — eso lo cubre el test de más abajo.
    '/pote-exit/prepare',
    // El COBRO del ticket de cola: la segunda pierna del mismo exit no-custodial.
    // Geofencear el cobro de una salida ya vencida sería el secuestro que esta
    // lista existe para impedir. Su carrier 0xFE SÍ está capado (capitalCap en
    // la propia ruta) — el test del carrier de abajo lo fija.
    '/pote-claim-exit/prepare',
  ];

  it('toda ruta sin geofence es una excepción DECLARADA (ceremonia o salida)', () => {
    const offenders: string[] = [];
    let current: string | null = null;

    for (const line of SOURCE.split('\n')) {
      const m = line.match(/router\.(?:get|post)\('([^']+)'/);
      if (m) current = m[1];
      const exempt = CEREMONIES.includes(current ?? '') || EXITS.includes(current ?? '');
      if (/=\s*poteGate\(\)/.test(line) && current && !exempt) {
        offenders.push(current);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('capitalGate existe y compone flag + geofence', () => {
    expect(SOURCE).toContain('function capitalGate(');
    expect(SOURCE).toContain('isDefiExecutionAllowed');
    expect(SOURCE).toContain('GEOFENCE_BLOCKED');
  });

  it('las salidas declaradas que MINTAN un carrier 0xFE lo capan SOLO por transacción (capitalCap exit) dentro de la ruta', () => {
    // La salida no se geofencea, pero su carrier minta de verdad: sin tope por
    // transacción, la excepción de salida sería un grifo. Lo que NO puede
    // aplicarle es el cupo diario por dirección (compartido con los depósitos):
    // eso bloquearía salir a quien entró hoy. Se fija por ruta: el bloque entre
    // el router.post y el siguiente router.* capa el carrier en modo salida y
    // su carrier por defecto sale de defaultExitCarrierXrp (cabe bajo el tope),
    // nunca de un literal por encima de él.
    for (const route of ['/pote-exit/prepare', '/pote-claim-exit/prepare']) {
      const start = SOURCE.indexOf(`router.post('${route}'`);
      expect(start).toBeGreaterThan(-1);
      const next = SOURCE.indexOf('router.', start + 10);
      const body = SOURCE.slice(start, next === -1 ? undefined : next);
      expect(body).toMatch(/capitalCap\([^;]*\{\s*exit:\s*true\s*\}\)/);
      expect(body).toContain('defaultExitCarrierXrp()');
      expect(body).not.toMatch(/amountXrpForMint \?\? '\d/);
    }
  });

  it('redeemServiceFee sigue inerte — devuelve null antes de leer ninguna env', () => {
    const body = SOURCE.slice(SOURCE.indexOf('function redeemServiceFee('));
    const firstStatement = body.slice(0, body.indexOf('\n}'));
    expect(firstStatement).toContain('return null;');
    // La lectura de la env solo puede vivir comentada, después del return.
    const live = firstStatement
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(live).not.toContain('INSTITUTIONAL_FEE_COLLECTOR');
  });
});

// ── 4. EL ASIENTO DEL DIRECTOR (incidente 23-ago-2026) ───────────────────────
//
// `/pote-direct` y `/pote-recall` componen una firma EVM DEL DIRECTOR. Sin
// cesión vigente esa firma revierte con `NotDirectorOrCouncil` (0x16baed6b) y el
// firmante paga gas por una transacción condenada: pasó en vivo, con horas de
// diagnóstico detrás. El prepare tiene que negarse ANTES, y decir por dónde va
// el camino bueno (la orden de consejo). En la generación v2 el asiento está
// vacío SIEMPRE — el director vive en la jaula — así que este guard es también
// el que impide componer una firma que allí no puede funcionar nunca.

describe('asiento del director — no se compone una firma condenada', () => {
  const NOW = () => Math.floor(Date.now() / 1000);
  const body = { pote: POTE, venueId: 0, amountBase: '1000000' };

  function stateWithDirector(director: string, until: number): AstryumPoteState {
    const s = fixtureState();
    s.governance = { ...s.governance, director, directorUntil: until };
    return s;
  }

  for (const path of ['/pote-direct/prepare', '/pote-recall/prepare']) {
    it(`${path} se niega cuando NO hay director cedido`, async () => {
      (readPoteState as jest.Mock).mockResolvedValue(
        stateWithDirector('0x0000000000000000000000000000000000000000', 0),
      );
      const res = await request(app).post(`/api/institutional${path}`).send(body);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('NO_DIRECTOR_CEDED');
      // Y dice por dónde se hace de verdad, sin dejar al firmante a ciegas.
      expect(res.body.detail).toContain('/pote-council-order/prepare');
      expect(res.body.detail).toContain('/cage-order/prepare');
    });

    it(`${path} se niega cuando la cesión CADUCÓ`, async () => {
      (readPoteState as jest.Mock).mockResolvedValue(
        stateWithDirector('0xdddd000000000000000000000000000000000001', NOW() - 60),
      );
      const res = await request(app).post(`/api/institutional${path}`).send(body);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('NO_DIRECTOR_CEDED');
    });

    it(`${path} NO se dispara con una cesión vigente (el guard no sobra-actúa)`, async () => {
      (readPoteState as jest.Mock).mockResolvedValue(
        stateWithDirector('0xdddd000000000000000000000000000000000001', NOW() + 86_400),
      );
      const res = await request(app).post(`/api/institutional${path}`).send(body);
      expect(res.body.error).not.toBe('NO_DIRECTOR_CEDED');
    });
  }
});
