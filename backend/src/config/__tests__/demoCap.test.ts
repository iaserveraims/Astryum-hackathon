// Account-based exemption resolves userId → email through prisma (lazy import in
// demoCap.ts). Mock the client so the lookup never touches a real DB; backgroundJob
// no-ops keep the (DATABASE_URL-guarded) daily layer quiet in the account tests.
const mockUserFindUnique = jest.fn();
jest.mock('../../database/prismaClient', () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
    backgroundJob: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      create: jest.fn(),
    },
  },
}));

import {
  checkDemoCap,
  demoCapFromBody,
  assertDemoCapSane,
  isDemoCapExempt,
  isDemoCapExemptUser,
  isXrplMintBody,
  getDemoMaxXrpPerTx,
  getDemoMaxXrpPerAddressPerDay,
  _resetDemoCapState,
} from '../demoCap';

const ENV = process.env;
beforeEach(() => {
  _resetDemoCapState();
  mockUserFindUnique.mockReset();
  process.env = { ...ENV };
  delete process.env.DEMO_MAX_XRP_PER_TX;
  delete process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY;
  delete process.env.DEMO_CAP_EXEMPT_ADDRESSES;
  delete process.env.DEMO_CAP_EXEMPT_EMAILS;
  delete process.env.DATABASE_URL; // in-memory daily path in tests
});
afterAll(() => {
  process.env = ENV;
});

describe('demoCap — per-tx cap is FAIL-CLOSED', () => {
  it('defaults to 1 XRP when the env is unset', async () => {
    expect(getDemoMaxXrpPerTx()).toBe(1);
    expect(await checkDemoCap(1, 'rAlice')).toBeNull();
    const over = await checkDemoCap(1.01, 'rAlice');
    expect(over?.body.error).toBe('DEMO_TX_CAP_EXCEEDED');
    expect(over?.status).toBe(400);
  });

  it('fails closed to 1 on malformed / empty / non-positive config (absence ≠ no protection)', () => {
    for (const bad of ['not-a-number', '-5', '', '0', 'NaN']) {
      process.env.DEMO_MAX_XRP_PER_TX = bad;
      expect(getDemoMaxXrpPerTx()).toBe(1);
    }
  });

  it('honors a valid configured cap', async () => {
    process.env.DEMO_MAX_XRP_PER_TX = '2';
    expect(await checkDemoCap(2, 'rAlice')).toBeNull();
    expect((await checkDemoCap(2.5, 'rAlice'))?.status).toBe(400);
  });
});

describe('demoCap — §2 recalibrated daily default against the real 80 FLR budget', () => {
  it('defaults the per-address daily volume to 2 XRP (≈2 mints ≈ 40 FLR of 80 effective)', () => {
    expect(getDemoMaxXrpPerAddressPerDay()).toBe(2);
  });
  it('fails closed to 2 on malformed config', () => {
    process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY = 'oops';
    expect(getDemoMaxXrpPerAddressPerDay()).toBe(2);
  });
});

describe('demoCap — exemption is the EXPLICIT list, never the execution allowlist', () => {
  it('exempts only DEMO_CAP_EXEMPT_ADDRESSES (case-insensitive) and bypasses both layers', async () => {
    process.env.DEMO_CAP_EXEMPT_ADDRESSES = 'rTeam1, 0xABCdef0000000000000000000000000000000001';
    expect(isDemoCapExempt('rTeam1')).toBe(true);
    expect(isDemoCapExempt('0xabcdef0000000000000000000000000000000001')).toBe(true);
    expect(isDemoCapExempt('rStranger')).toBe(false);
    expect(await checkDemoCap(1000, 'rTeam1')).toBeNull(); // no per-tx, no daily
    expect((await checkDemoCap(2, 'rStranger'))?.body.error).toBe('DEMO_TX_CAP_EXCEEDED');
  });
});

describe('demoCap — ACCOUNT-based exemption (DEMO_CAP_EXEMPT_EMAILS, 2026-07-25)', () => {
  const FOUNDER = 'founder@astryum.xyz';

  it('exempts the authenticated account whichever wallet it pays from (case-insensitive)', async () => {
    process.env.DEMO_CAP_EXEMPT_EMAILS = ` Other@Team.xyz , ${FOUNDER.toUpperCase()} `;
    process.env.DATABASE_URL = 'postgres://mocked';
    mockUserFindUnique.mockResolvedValue({ email: FOUNDER });
    expect(await isDemoCapExemptUser('user-1')).toBe(true);
    // Over-cap mint from ANY address goes through — no address enumeration needed.
    expect(await demoCapFromBody({ amountXrp: 5, xrplAddress: 'rAnyWalletAtAll' }, 'user-1')).toBeNull();
    expect(await demoCapFromBody({ amountFxrp: 5, evmAddress: '0xAnotherWallet' }, 'user-1')).toBeNull();
  });

  it('is FAIL-CLOSED: not on the list / no userId / no DB / lookup error ⇒ the cap stays on', async () => {
    process.env.DEMO_CAP_EXEMPT_EMAILS = FOUNDER;
    process.env.DATABASE_URL = 'postgres://mocked';
    mockUserFindUnique.mockResolvedValue({ email: 'someone-else@example.com' });
    expect(await isDemoCapExemptUser('user-2')).toBe(false);
    expect((await demoCapFromBody({ amountXrp: 5, xrplAddress: 'rX' }, 'user-2'))?.body.error).toBe(
      'DEMO_TX_CAP_EXCEEDED',
    );

    expect(await isDemoCapExemptUser(null)).toBe(false); // anonymous never exempts
    expect(await isDemoCapExemptUser(undefined)).toBe(false);

    delete process.env.DATABASE_URL; // no DB ⇒ protection ON, lookup never attempted
    expect(await isDemoCapExemptUser('user-1')).toBe(false);

    process.env.DATABASE_URL = 'postgres://mocked';
    mockUserFindUnique.mockRejectedValue(new Error('db down'));
    expect(await isDemoCapExemptUser('user-1')).toBe(false);
  });

  it('with no list configured the DB is never consulted', async () => {
    process.env.DATABASE_URL = 'postgres://mocked';
    expect(await isDemoCapExemptUser('user-1')).toBe(false);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('startup log reports the parsed account count alongside the address count', () => {
    process.env.DEMO_CAP_EXEMPT_EMAILS = `${FOUNDER}, other@team.xyz`;
    const logs: string[] = [];
    expect(assertDemoCapSane({ warn: () => undefined, log: (m) => logs.push(m) })).toBeNull();
    expect(logs.join('\n')).toMatch(/2 exempt account\(s\)/);
  });
});

describe('demoCap — per-address daily volume (persisted; in-memory in tests)', () => {
  it('blocks once the daily sum exceeds the limit, per address', async () => {
    process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY = '2';
    expect(await checkDemoCap(1, 'rBob')).toBeNull(); // 1
    expect(await checkDemoCap(1, 'rBob')).toBeNull(); // 2
    expect((await checkDemoCap(1, 'rBob'))?.body.error).toBe('DEMO_DAILY_CAP_EXCEEDED'); // 3 > 2
    expect((await checkDemoCap(1, 'rBob'))?.status).toBe(429);
    expect(await checkDemoCap(1, 'rCarol')).toBeNull(); // a different address is unaffected
  });

  it('a rejected tx does not consume daily budget', async () => {
    process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY = '2';
    expect((await checkDemoCap(5, 'rDave'))?.body.error).toBe('DEMO_TX_CAP_EXCEEDED'); // over per-tx → not recorded
    expect(await checkDemoCap(1, 'rDave')).toBeNull();
    expect(await checkDemoCap(1, 'rDave')).toBeNull(); // full budget was intact
  });
});

describe('demoCap — startup sanity vs the direct-mint fee floor', () => {
  it('warns when the cap is at/below the ~0.3 XRP viable floor (would reject all mints)', () => {
    process.env.DEMO_MAX_XRP_PER_TX = '0.2';
    expect(assertDemoCapSane({ warn: () => undefined, log: () => undefined })).toMatch(/every mint would fail/);
  });
  it('is silent (no warn) for a sane cap and logs the effective caps + exempt count', () => {
    process.env.DEMO_MAX_XRP_PER_TX = '1';
    process.env.DEMO_CAP_EXEMPT_ADDRESSES = 'rTeam1,rTeam2';
    const logs: string[] = [];
    expect(assertDemoCapSane({ warn: () => undefined, log: (m) => logs.push(m) })).toBeNull();
    expect(logs.join('\n')).toMatch(/2 exempt address\(es\) parsed/);
  });
});

describe('demoCapFromBody / isXrplMintBody — self-select the mint rail', () => {
  it('caps amountXrp / amountFxrp / amountXrpForMint', async () => {
    expect((await demoCapFromBody({ amountXrp: 2, xrplAddress: 'rX' }))?.body.error).toBe('DEMO_TX_CAP_EXCEEDED');
    expect((await demoCapFromBody({ amountFxrp: 2, evmAddress: '0xabc' }))?.status).toBe(400);
    expect((await demoCapFromBody({ amountXrpForMint: 2, xrplAddress: 'rY' }))?.status).toBe(400);
    expect(await demoCapFromBody({ amountXrp: 1, xrplAddress: 'rZ' })).toBeNull();
  });

  it('lets E2 (amountFlr) and read/withdraw bodies through untouched', async () => {
    expect(await demoCapFromBody({ amountFlr: 1000, evmAddress: '0xabc' })).toBeNull();
    expect(await demoCapFromBody({})).toBeNull();
    expect(await demoCapFromBody(undefined)).toBeNull();
  });

  it('isXrplMintBody: only XRPL-mint (xrplAddress + mint amount) is budget-relevant', () => {
    expect(isXrplMintBody({ xrplAddress: 'rX', amountXrp: 1 })).toBe(true);
    expect(isXrplMintBody({ xrplAddress: 'rX', amountXrpForMint: 1 })).toBe(true);
    expect(isXrplMintBody({ evmAddress: '0xabc', amountFxrp: 1 })).toBe(false); // EVM-direct: no executor
    expect(isXrplMintBody({ amountFlr: 1 })).toBe(false); // E2
  });
});

describe('demoCap v2 — reserva → confirmación (incidente del gauge, 2026-07-25)', () => {
  const { confirmDailySpendXrp, getDemoCapStatus } = require('../demoCap');
  const T0 = 1_700_000_000_000;
  const MIN = 60_000;

  beforeEach(() => {
    process.env.DEMO_MAX_XRP_PER_TX = '2';
    process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY = '2';
  });

  it('una reserva sin firmar EXPIRA y devuelve el cupo (el prepare cancelado deja de contar)', async () => {
    expect(await checkDemoCap(2, 'rEve', T0)).toBeNull(); // reserva el cupo entero
    expect((await checkDemoCap(1, 'rEve', T0 + MIN))?.status).toBe(429); // fresca: bloquea
    expect(await checkDemoCap(1, 'rEve', T0 + 31 * MIN)).toBeNull(); // expirada: el cupo vuelve
  });

  it('la CONFIRMACIÓN del executor hace el gasto permanente — jamás expira', async () => {
    expect(await checkDemoCap(2, 'rFrank', T0)).toBeNull();
    await confirmDailySpendXrp('rFrank', 2, T0 + 2 * MIN); // el mint ejecutó en Flare
    expect((await checkDemoCap(1, 'rFrank', T0 + 31 * MIN))?.status).toBe(429); // sigue contando
  });

  it('RE-ASERCIÓN: un mint ejecutado sin reserva viva se suma igual (el acaparador no escapa)', async () => {
    // Sin prepare previo (o con la reserva ya purgada): la ejecución ES la verdad.
    await confirmDailySpendXrp('rGrace', 1.5, T0);
    const st = await getDemoCapStatus('rGrace', null, T0 + MIN);
    expect(st.confirmedTodayXrp).toBeCloseTo(1.5);
    expect((await checkDemoCap(1, 'rGrace', T0 + MIN))?.status).toBe(429); // 1.5 + 1 > 2
  });

  it('el status separa confirmado vs reservado y leerlo no mueve el gauge', async () => {
    expect(await checkDemoCap(1, 'rIvy', T0)).toBeNull(); // reserva
    await confirmDailySpendXrp('rIvy', 0.5, T0); // re-aserción confirmada aparte
    const st = await getDemoCapStatus('rIvy', null, T0 + MIN);
    expect(st.reservedTodayXrp).toBeCloseTo(1);
    expect(st.confirmedTodayXrp).toBeCloseTo(0.5);
    expect(st.spentTodayXrp).toBeCloseTo(1.5);
    const st2 = await getDemoCapStatus('rIvy', null, T0 + MIN);
    expect(st2.spentTodayXrp).toBeCloseTo(1.5); // idéntico — el read no graba
  });

  it('confirmar marca la reserva del MISMO importe en vez de duplicarla', async () => {
    expect(await checkDemoCap(1, 'rJudy', T0)).toBeNull(); // reserva 1
    await confirmDailySpendXrp('rJudy', 1, T0 + MIN); // el mint de ese prepare ejecutó
    const st = await getDemoCapStatus('rJudy', null, T0 + 2 * MIN);
    expect(st.spentTodayXrp).toBeCloseTo(1); // 1 confirmado, NO 1 reservado + 1 confirmado
    expect(st.confirmedTodayXrp).toBeCloseTo(1);
    expect(st.reservedTodayXrp).toBeCloseTo(0);
  });
});
