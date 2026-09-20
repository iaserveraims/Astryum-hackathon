/**
 * El lector del carril de Ethereum, y las dos reglas que decidían mal.
 *
 * Auditoría 2026-08-17, hallazgos B y D. Los dos son la misma familia («éxito
 * no ganado») aplicada al riesgo, que es su versión peor:
 *
 *   D — si `/position` fallaba, la fila DESAPARECÍA del tablero. Sin fila no
 *       hay botón de repago: la puerta de salida se cerraba sola justo cuando
 *       podía hacer falta, y la pantalla decía «no tienes posiciones».
 *   B — la tira de salud declaraba «no liquidation risk» con deuda VIVA en
 *       Ethereum, porque el snapshot agregado no tiene adapter para
 *       morpho-blue y devolvía HF null.
 *
 * Lo que se fija aquí: no leer NUNCA se confunde con no tener.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  scanEthMorpho,
  worstHealthFactor,
  toRows,
  anyVaultLegUnread,
  healthByWallet,
  type EthMorphoPositionRead,
} from '../ethMorphoPosition';

const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function read(over: Partial<EthMorphoPositionRead> = {}): EthMorphoPositionRead {
  return {
    wallet: A,
    chainId: 1,
    hasPosition: true,
    collateralBase: '10000000',          // 10 FXRP (6 dec)
    collateralSymbol: 'FXRP',
    collateralDecimals: 6,
    debtBase: '1000000000000000000000',  // 1000 RLUSD (18 dec)
    debtSymbol: 'RLUSD',
    debtDecimals: 18,
    healthFactor: 1.4,
    lltvPct: 77,
    readAt: '2026-08-17T00:00:00.000Z',
    ...over,
  };
}

/** Un fetch de mentira: mapa de fragmento de URL → respuesta. */
function fakeFetch(routes: Array<[string, { ok: boolean; body?: unknown }]>) {
  return vi.fn(async (url: string) => {
    const hit = routes.find(([frag]) => String(url).includes(frag));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: hit[1].ok, status: hit[1].ok ? 200 : 500, json: async () => hit[1].body };
  }) as unknown as typeof fetch;
}

const deps = (fetchImpl: typeof fetch) => ({
  apiBase: 'http://api', headers: () => ({}), region: 'ES', fetchImpl,
});

describe('scanEthMorpho — no leer NO es no tener', () => {
  it('una dirección que falla se REPORTA, no se traga', async () => {
    const f = vi.fn(async (url: string) => {
      if (String(url).includes('/status')) return { ok: true, json: async () => ({ active: true }) };
      if (String(url).includes(B)) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, json: async () => read() };
    }) as unknown as typeof fetch;

    const scan = await scanEthMorpho([A, B], deps(f));
    expect(scan.active).toBe(true);
    expect(scan.reads).toHaveLength(1);
    // Ésta es la línea que evita que la posición se esfume en silencio.
    expect(scan.unreadable).toEqual([B]);
  });

  it('el carril apagado da cero filas y lo dice (fail-closed, invariante #10)', async () => {
    const scan = await scanEthMorpho([A], deps(fakeFetch([['/status', { ok: true, body: { active: false } }]])));
    expect(scan.active).toBe(false);
    expect(scan.reads).toEqual([]);
    // Apagado no es «no lo sé»: no hay nada pendiente de leer.
    expect(scan.unreadable).toEqual([]);
  });

  it('un backend inalcanzable deja active en NULL — «no lo sé», no «apagado»', async () => {
    const f = vi.fn(async () => { throw new Error('network'); }) as unknown as typeof fetch;
    const scan = await scanEthMorpho([A], deps(f));
    expect(scan.active).toBeNull();
  });

  it('publica el interruptor caliente del carril', async () => {
    const onRailStatus = vi.fn();
    await scanEthMorpho([A], {
      ...deps(fakeFetch([['/status', { ok: true, body: { active: false } }]])),
      onRailStatus,
    });
    expect(onRailStatus).toHaveBeenCalledWith(false);
  });

  it('ignora lo que no es una dirección EVM sin romper el barrido', async () => {
    const scan = await scanEthMorpho(['rXrpAddress', A], deps(fakeFetch([
      ['/status', { ok: true, body: { active: true } }],
      ['/position', { ok: true, body: read() }],
    ])));
    expect(scan.reads).toHaveLength(1);
    expect(scan.unreadable).toEqual([]);
  });
});

describe('worstHealthFactor — manda el peor, nunca el más bonito', () => {
  it('coge el mínimo entre varias posiciones con deuda', () => {
    expect(worstHealthFactor([read({ healthFactor: 2.1 }), read({ healthFactor: 1.05 })])).toBe(1.05);
  });

  it('sin deuda no hay HF que vigilar — y no se inventa uno', () => {
    expect(worstHealthFactor([read({ debtBase: '0', healthFactor: 9 })])).toBeNull();
  });

  it('un HF ausente o no finito no cuenta como sano', () => {
    expect(worstHealthFactor([read({ healthFactor: null })])).toBeNull();
    expect(worstHealthFactor([read({ healthFactor: Number.NaN })])).toBeNull();
  });

  it('sin posición, nada', () => {
    expect(worstHealthFactor([read({ hasPosition: false, healthFactor: 1.01 })])).toBeNull();
    expect(worstHealthFactor([])).toBeNull();
  });
});

describe('toRows — los importes siguen viajando en base units, con SUS decimales', () => {
  it('la asimetría 6/18 se conserva en la fila (la trampa F4)', () => {
    const rows = toRows(read());
    expect(rows.map((r) => [r.kind, r.amount, r.decimals])).toEqual([
      ['COLLATERAL', '10000000', 6],
      ['DEBT', '1000000000000000000000', 18],
    ]);
  });
});

/**
 * La pata LEND-ONLY. Sin esta fila, el RLUSD depositado en la bóveda no existía
 * en NINGUNA pantalla —ni tablero, ni portfolio, ni una salida con saldo—
 * mientras la pantalla de éxito prometía que aparecería en Positions. El
 * usuario que no ve su dinero vuelve a depositar (auditoría 2026-08-17).
 */
describe('toRows — la bóveda deja de ser dinero invisible', () => {
  const lent = (over: Partial<EthMorphoPositionRead> = {}) =>
    read({
      collateralBase: '0', debtBase: '0',
      lentReadOk: true,
      lentSharesBase: '495000000000000000000',
      lentAssetsBase: '500000000000000000000',   // 500 RLUSD
      lentSymbol: 'RLUSD', lentDecimals: 18,
      vaultAvailableNowBase: '17542693000000000000000000',
      vault: '0x6dC58a0FdfC8D694e571DC59B9A52EEEa780E6bf',
      healthFactor: null,
      ...over,
    });

  it('un depósito en la bóveda SÍ produce fila, con sus 18 decimales', () => {
    const rows = toRows(lent());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'LEND', asset: 'RLUSD', amount: '500000000000000000000', decimals: 18,
    });
  });

  it('prestar no se liquida: la fila NO lleva health factor', () => {
    // Colgarle el HF del carry sería atribuirle un riesgo que no tiene.
    expect(toRows(lent())[0].healthFactor).toBeNull();
    expect(toRows(lent())[0].raw.healthFactor).toBeNull();
  });

  it('lleva lo que hace útil su salida: shares y lo que la bóveda puede pagar hoy', () => {
    const raw = toRows(lent())[0].raw;
    expect(raw.lentSharesBase).toBe('495000000000000000000');
    expect(raw.vaultAvailableNowBase).toBe('17542693000000000000000000');
  });

  it('convive con el carry: tres filas, cada una con SUS decimales', () => {
    const rows = toRows(lent({ collateralBase: '10000000', debtBase: '1000000000000000000000' }));
    expect(rows.map((r) => [r.kind, r.decimals])).toEqual([
      ['COLLATERAL', 6], ['DEBT', 18], ['LEND', 18],
    ]);
  });

  it('cero prestado no inventa una fila vacía', () => {
    expect(toRows(lent({ lentAssetsBase: '0', hasPosition: false }))).toEqual([]);
  });
});

/**
 * Home pinta una fila POR WALLET. Decirle «sana» a la que sostiene el carry
 * porque OTRA está limpia es la misma mentira en versión granular — y hasta el
 * 18-ago eso es literalmente lo que pasaba: el snapshot agregado no tiene
 * adapter para morpho-blue, así que `debtUSD` era 0 y la fila decía «Sana —
 * sin deuda abierta — nada puede liquidarse».
 */
describe('healthByWallet — el riesgo va atado a la wallet que lo sostiene', () => {
  const W2 = '0xcccccccccccccccccccccccccccccccccccccccc';

  it('devuelve el HF de cada dirección con deuda viva', () => {
    expect(healthByWallet([read({ healthFactor: 1.4 }), read({ wallet: W2, healthFactor: 2.2 })]))
      .toEqual({ [A.toLowerCase()]: 1.4, [W2.toLowerCase()]: 2.2 });
  });

  it('las claves van en minúsculas — quien consulta no lidia con el checksum', () => {
    const out = healthByWallet([read({ wallet: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })]);
    expect(Object.keys(out)).toEqual(['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']);
  });

  it('una wallet sin deuda NO entra — y su fila puede decir «sana» con razón', () => {
    expect(healthByWallet([read({ debtBase: '0', healthFactor: 9 })])).toEqual({});
  });

  it('si la misma wallet trae dos lecturas, manda la peor', () => {
    expect(healthByWallet([read({ healthFactor: 2.0 }), read({ healthFactor: 1.1 })]))
      .toEqual({ [A.toLowerCase()]: 1.1 });
  });

  it('un HF ausente no cuenta como sano', () => {
    expect(healthByWallet([read({ healthFactor: null })])).toEqual({});
  });
});

describe('anyVaultLegUnread — un cero silencioso ahí parece un depósito perdido', () => {
  it('lo dice cuando la bóveda no contestó', () => {
    expect(anyVaultLegUnread([read({ lentReadOk: false })])).toBe(true);
  });

  it('no lo dice cuando contestó, aunque conteste cero', () => {
    expect(anyVaultLegUnread([read({ lentReadOk: true, lentAssetsBase: '0' })])).toBe(false);
  });

  it('una lectura vieja sin el campo no se toma por fallo', () => {
    // `undefined` = un backend anterior a la pata lend-only, no un error.
    expect(anyVaultLegUnread([read()])).toBe(false);
  });
});
