/**
 * GET /api/platform/trust — the public feed behind the landing's /proof page.
 *
 * What matters here:
 *  1. PRIVACY: the 0xfe-handoff payload row carries the user's xrplAddress and
 *     personalAccount — the public response must NEVER leak them (aviso §3.2).
 *  2. The sample requires the full verifier triplet (bytes + hash + memo);
 *     rows missing any piece are skipped, not half-served.
 *  3. Failure posture: RPC/DB down → nulls and 200, never a 500 (same doctrine
 *     as /status and /activity: this route announces, it must not invent).
 *
 * The chain resolvers are mocked (covered by their own suites); what stays
 * REAL is the route: selection, mapping, redaction and the failure posture.
 */
import express from 'express';
import request from 'supertest';

const EXEC = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const AM = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const MAC = '0x434936d47503353f06750Db1A444DBDC5F0AD37c';
const CORE_VAULT = 'rCoreVaultFAssetsXrplAddress123456789';
const USER_XRPL = 'rUserPrivateXrplAddressMustNotLeak111';
const USER_PA = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d';
const ZERO = '0x0000000000000000000000000000000000000000';

const LEGACY_VAULT = '0xc837000000000000000000000000000000000E3b';
const LEGACY_BRIDGE = '0x02aE000000000000000000000000000000000b26';
const LEGACY_ANCHOR = 'rAnchorAstryumOrderFeesXrpl1111111';
const COUNCIL_XRPL = 'rFamilyCouncilPrivateMustNotLeak2222';
const CONSTITUTION = '0x' + '78'.repeat(32);

// Mutable fixture the hoisted mocks close over — each test shapes it, then
// builds a FRESH router (module-level trust cache) via freshApp().
const state = {
  throwAll: false,
  executor: EXEC as string,
  rows: [] as unknown[],
  legacyRows: [] as unknown[],
  legacyCfg: null as null | { chain: string; rpcUrl: string; vault: string; bridge: string; orderAnchor: string },
  dbError: null as Error | null,
};

function guard<T>(value: T): T {
  if (state.throwAll) throw new Error('resolver down');
  return value;
}

// Chain reads for the legacy block (constitutionRef / nextNonce) — faked so no
// test ever fires a real RPC request.
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeProvider {}
  class FakeContract {
    constitutionRef = async () => CONSTITUTION;
    nextNonce = async () => 1n;
  }
  return { ...actual, ethers: { ...actual.ethers, JsonRpcProvider: FakeProvider, Contract: FakeContract } };
});

jest.mock('../../connectors/protocols/xrpl/XrplCouncilOrderService', () => ({
  legacyStackConfig: jest.fn(() => {
    if (!state.legacyCfg) throw new Error('LEGACY stack env unset');
    return state.legacyCfg;
  }),
}));

jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => ({
  resolveAssetManagerFxrp: jest.fn(async () => guard(AM)),
  readDirectMintParams: jest.fn(async () =>
    guard({
      fxrpToken: AM,
      paymentAddress: CORE_VAULT,
      minFeeUBA: 0n,
      feeBIPS: 0n,
      executorFeeUBA: 0n,
      granularityUBA: 1n,
    }),
  ),
  resolveRedemptionExecutor: jest.fn(async () => guard(state.executor)),
}));

jest.mock('../../connectors/protocols/flare/FlareSmartAccountService', () => ({
  resolveMasterAccountController: jest.fn(async () => guard(MAC)),
}));

jest.mock('../adminPanel', () => ({
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Fiel al motor en lo que estas rutas dependen: jobType, la ventana
// completedAt (el cupo público se apoya en ella) y el take.
interface FakeWhere {
  jobType?: string;
  completedAt?: { lt?: Date; gte?: Date };
}
jest.mock('../../database/prismaClient', () => ({
  prisma: {
    backgroundJob: {
      findMany: jest.fn(async ({ where, take }: { where?: FakeWhere; take?: number } = {}) => {
        if (state.dbError) throw state.dbError;
        const all = (where?.jobType === 'legacy-council-order' ? state.legacyRows : state.rows) as Array<{
          completedAt: Date;
        }>;
        const win = where?.completedAt;
        const rows = all
          .filter((r) => (!win?.lt || r.completedAt < win.lt) && (!win?.gte || r.completedAt >= win.gte))
          .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
        return take ? rows.slice(0, take) : rows;
      }),
      // El contador NO conoce el cupo: cuenta todas (agregado sin identidad).
      count: jest.fn(async () => state.rows.length),
    },
    configuration: { findUnique: jest.fn(async () => null) },
  },
}));

/** Fresh router per test — the module-level trust cache must not bleed across tests. */
function freshApp() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const router = require('../platformStatus').default;
  const app = express();
  app.use(express.json());
  app.use('/api/platform', router);
  return app;
}

const GOOD_ROW = {
  completedAt: new Date('2026-07-28T10:00:00Z'),
  payload: {
    userOpHash: '0x' + 'ab'.repeat(32),
    userOpData: '0x' + 'cd'.repeat(64),
    memoHex: 'FE01' + '00'.repeat(8) + 'AB'.repeat(32),
    grossXrpDrops: '2590000',
    xrplAddress: USER_XRPL,
    personalAccount: USER_PA,
    walletId: 1,
  },
  result: { xrplTxHash: 'F'.repeat(64), flareTxHash: '0x' + '1'.repeat(64) },
};

// A row the verifier can't use (no bytes) — must be skipped, never half-served.
const INCOMPLETE_ROW = {
  completedAt: new Date('2026-07-29T10:00:00Z'),
  payload: { userOpHash: '0x' + 'ee'.repeat(32), grossXrpDrops: '1000000', xrplAddress: USER_XRPL },
  result: { flareTxHash: '0x' + '2'.repeat(64) },
};

// Una operación de un USUARIO de la beta: posterior al cierre del cupo y desde
// una cuenta que no es nuestra. Nada suyo puede aparecer en la landing.
const USER_ROW = {
  completedAt: new Date('2026-08-10T10:00:00Z'),
  payload: {
    userOpHash: '0x' + '99'.repeat(32),
    userOpData: '0x' + '77'.repeat(64),
    memoHex: 'FE02' + '00'.repeat(8) + '99'.repeat(32),
    grossXrpDrops: '5000000',
    xrplAddress: USER_XRPL,
    personalAccount: USER_PA,
    walletId: 2,
  },
  result: { xrplTxHash: 'B'.repeat(64), flareTxHash: '0x' + '4'.repeat(64) },
};

// La misma operación pero desde una cuenta NUESTRA de prueba: tras el corte
// tampoco entra (founder: "dejamos visible todo lo que hay hoy; no van a entrar
// más"). Mover el cupo es un acto deliberado, no un efecto secundario.
const OURS_XRPL = 'rAstryumTestAccount33333333333333';
const OURS_ROW = {
  ...USER_ROW,
  completedAt: new Date('2026-08-11T10:00:00Z'),
  payload: { ...USER_ROW.payload, xrplAddress: OURS_XRPL, personalAccount: '0xOurPa', walletId: 3 },
  result: { xrplTxHash: 'C'.repeat(64), flareTxHash: '0x' + '5'.repeat(64) },
};

beforeEach(() => {
  state.throwAll = false;
  state.executor = EXEC;
  state.rows = [];
  state.legacyRows = [];
  state.legacyCfg = null;
  state.dbError = null;
  delete process.env.PROOF_PUBLIC_CUTOFF_AT;
});

describe('GET /api/platform/trust', () => {
  test('serves the four path pieces and the newest COMPLETE sample — without user addresses', async () => {
    state.rows = [INCOMPLETE_ROW, GOOD_ROW]; // newest-first, newest unusable
    const res = await request(freshApp()).get('/api/platform/trust');

    expect(res.status).toBe(200);
    expect(res.body.path).toEqual({
      coreVaultXrpl: CORE_VAULT,
      assetManagerFxrp: AM,
      masterAccountController: MAC,
      executor: EXEC,
    });
    // The incomplete row was skipped; the sample is the full triplet.
    expect(res.body.sample.userOpHash).toBe(GOOD_ROW.payload.userOpHash);
    expect(res.body.sample.userOpData).toBe(GOOD_ROW.payload.userOpData);
    expect(res.body.sample.memoHex).toBe(GOOD_ROW.payload.memoHex);
    expect(res.body.sample.xrp).toBeCloseTo(2.59);
    expect(res.body.sample.xrplTxHash).toBe(GOOD_ROW.result.xrplTxHash);
    expect(res.body.sample.flareTxHash).toBe(GOOD_ROW.result.flareTxHash);

    // THE assertion this route exists for: user addresses never travel.
    expect(res.text).not.toContain(USER_XRPL);
    expect(res.text).not.toContain(USER_PA);
    expect(res.text.toLowerCase()).not.toContain(USER_PA.toLowerCase());
  });

  test('executor without key (zero address) reads as null, not as a fake piece', async () => {
    state.executor = ZERO;
    state.rows = [GOOD_ROW];
    const res = await request(freshApp()).get('/api/platform/trust');
    expect(res.status).toBe(200);
    expect(res.body.path.executor).toBeNull();
  });

  test('chain and DB down → nulls with 200, never a 500', async () => {
    state.throwAll = true;
    state.dbError = new Error('db unreachable');
    const res = await request(freshApp()).get('/api/platform/trust');
    expect(res.status).toBe(200);
    expect(res.body.path).toEqual({
      coreVaultXrpl: null,
      assetManagerFxrp: null,
      masterAccountController: null,
      executor: null,
    });
    expect(res.body.sample).toBeNull();
    expect(res.body.legacy).toBeNull();
  });

  test('legacy block: deployed stack + live reads + executed order — without the council address', async () => {
    state.legacyCfg = {
      chain: 'flare',
      rpcUrl: 'http://fake',
      vault: LEGACY_VAULT,
      bridge: LEGACY_BRIDGE,
      orderAnchor: LEGACY_ANCHOR,
    };
    state.legacyRows = [
      {
        completedAt: new Date('2026-07-29T12:00:00Z'),
        payload: { action: 'direct-to', summary: 'directTo Kinetic', council: COUNCIL_XRPL },
        result: { xrplTxHash: 'A'.repeat(64), flareTxHash: '0x' + '3'.repeat(64), relayer: EXEC },
      },
    ];
    const res = await request(freshApp()).get('/api/platform/trust');

    expect(res.status).toBe(200);
    expect(res.body.legacy.vault).toBe(LEGACY_VAULT);
    expect(res.body.legacy.bridge).toBe(LEGACY_BRIDGE);
    expect(res.body.legacy.orderAnchor).toBe(LEGACY_ANCHOR);
    expect(res.body.legacy.constitutionRef).toBe(CONSTITUTION);
    expect(res.body.legacy.ordersExecuted).toBe(1);
    expect(res.body.legacy.sample.action).toBe('direct-to');
    expect(res.body.legacy.sample.xrplTxHash).toBe('A'.repeat(64));

    // The family's council account never travels (same doctrine as user addresses).
    expect(res.text).not.toContain(COUNCIL_XRPL);
    // Neither does the human summary (it may name amounts/venues).
    expect(res.text).not.toContain('directTo Kinetic');
  });
});

// ── El cupo público (founder 2026-08-01) ─────────────────────────────────────
//
// Un tx hash ES un identificador: quien lo abre en el explorador ve la cuenta
// del usuario. Por eso la landing publica lo que había al cerrar el cupo y, de
// ahí en adelante, solo operaciones de cuentas nuestras allowlisted.
describe('el cupo público de /proof', () => {
  test('la operación de un usuario no sale ni en el feed ni en la muestra', async () => {
    state.rows = [USER_ROW, GOOD_ROW]; // la del usuario es la más reciente
    const app = freshApp();

    const trust = await request(app).get('/api/platform/trust');
    // La muestra se queda en la nuestra, no salta a la del usuario.
    expect(trust.body.sample.userOpHash).toBe(GOOD_ROW.payload.userOpHash);
    expect(trust.text).not.toContain(USER_ROW.result.xrplTxHash);
    expect(trust.text).not.toContain(USER_ROW.result.flareTxHash);

    const activity = await request(app).get('/api/platform/activity');
    expect(activity.body.recent).toHaveLength(1);
    expect(activity.body.recent[0].flareTxHash).toBe(GOOD_ROW.result.flareTxHash);
    expect(activity.text).not.toContain(USER_ROW.result.xrplTxHash);
    // …pero el contador sigue contándolas todas: es un agregado sin identidad.
    expect(activity.body.total).toBe(2);
  });

  test('tampoco entra una prueba NUESTRA posterior al corte', async () => {
    state.rows = [OURS_ROW, USER_ROW, GOOD_ROW];
    const app = freshApp();

    const trust = await request(app).get('/api/platform/trust');
    expect(trust.body.sample.userOpHash).toBe(GOOD_ROW.payload.userOpHash);

    const activity = await request(app).get('/api/platform/activity');
    expect(activity.body.recent.map((r: { flareTxHash: string }) => r.flareTxHash)).toEqual([
      GOOD_ROW.result.flareTxHash,
    ]);
    expect(activity.text).not.toContain(OURS_ROW.result.xrplTxHash);
    // El contador, en cambio, las cuenta todas.
    expect(activity.body.total).toBe(3);
  });

  test('el cupo se mueve solo si alguien mueve la fecha a mano', async () => {
    process.env.PROOF_PUBLIC_CUTOFF_AT = '2026-08-11T00:00:00Z';
    state.rows = [OURS_ROW, USER_ROW, GOOD_ROW];
    const res = await request(freshApp()).get('/api/platform/activity');
    // Entra la del usuario del 10-ago porque el corte se movió a propósito: la
    // fecha es la única palanca, y es deliberada.
    expect(res.body.recent).toHaveLength(2);
    expect(res.text).not.toContain(OURS_ROW.result.xrplTxHash); // el 11-ago sigue fuera
  });

  test('una fecha de corte ilegible cae al default — nunca a «pasa todo»', async () => {
    process.env.PROOF_PUBLIC_CUTOFF_AT = 'mañana por la tarde';
    state.rows = [USER_ROW, GOOD_ROW];
    const res = await request(freshApp()).get('/api/platform/activity');
    expect(res.body.recent).toHaveLength(1);
    expect(res.text).not.toContain(USER_ROW.result.xrplTxHash);
  });

  test('la orden de un consejo posterior al corte tampoco se publica', async () => {
    state.legacyCfg = {
      chain: 'flare',
      rpcUrl: 'http://fake',
      vault: LEGACY_VAULT,
      bridge: LEGACY_BRIDGE,
      orderAnchor: LEGACY_ANCHOR,
    };
    state.legacyRows = [
      {
        completedAt: new Date('2026-08-12T12:00:00Z'),
        payload: { action: 'recall', council: COUNCIL_XRPL },
        result: { xrplTxHash: 'D'.repeat(64), flareTxHash: '0x' + '6'.repeat(64) },
      },
    ];
    const res = await request(freshApp()).get('/api/platform/trust');
    expect(res.body.legacy.sample).toBeNull();
    expect(res.text).not.toContain('D'.repeat(64));
    // El contador on-chain de órdenes sí sigue vivo (dato público del puente).
    expect(res.body.legacy.ordersExecuted).toBe(1);
  });
});
