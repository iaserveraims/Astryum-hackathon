/**
 * El APY de la bóveda llevaba días sin aparecer, y no dejó rastro.
 *
 * La consulta preguntaba por `vaultByAddress` — la puerta de las bóvedas V1 —
 * contra una Vault V2 (senRLUSDv2). La API contesta «no encontrado», pero lo
 * hace con **HTTP 200 y un array `errors`**, así que el `if (!resp.ok)` lo daba
 * por bueno, leía `undefined` y degradaba a nulls. La card decía «tasa en vivo
 * en Morpho — fuente no disponible», que es verdad y no es útil: nadie podía
 * saber si Morpho estaba caído o si preguntábamos mal.
 *
 * Estos tests fijan las dos formas de «no» que hay que distinguir de un cero, y
 * la forma de la respuesta buena (campos PLANOS en V2, no envueltos en `state`,
 * y la comisión llamada `performanceFee`).
 */
import { parseVaultApy } from '../ethMorpho';

const SOURCE = 'Morpho API (blue-api.morpho.org) — netApy includes incentives';

/** Respuesta real de la API el 2026-08-21 para senRLUSDv2. */
const LIVE = {
  data: {
    vaultV2ByAddress: {
      apy: 0.05305787146521218,
      netApy: 0.0816278011763094,
      performanceFee: 0.1,
    },
  },
};

describe('parseVaultApy', () => {
  it('lee la respuesta V2 real y la deja en porcentaje', () => {
    const { rate, refusal } = parseVaultApy(LIVE, SOURCE);
    expect(refusal).toBeUndefined();
    expect(rate.apyPct).toBe(5.31);
    expect(rate.netApyPct).toBe(8.16);
    expect(rate.performanceFeePct).toBe(10);
    expect(rate.source).toBe(SOURCE);
  });

  it('un refusal de GraphQL NO pasa por bueno — y dice por qué', () => {
    // Esto es lo que devolvía la consulta V1 contra esta bóveda, con HTTP 200.
    const { rate, refusal } = parseVaultApy(
      { errors: [{ message: 'No results matching given parameters' }], data: null },
      SOURCE,
    );
    expect(refusal).toContain('No results matching given parameters');
    expect(rate.netApyPct).toBeNull();
  });

  it('un `data` vacío tampoco pasa por bueno', () => {
    const { rate, refusal } = parseVaultApy({ data: { vaultV2ByAddress: null } }, SOURCE);
    expect(refusal).toBe('no vault returned for this address');
    expect(rate.apyPct).toBeNull();
  });

  it('la forma V1 (envuelta en `state`) ya no se acepta en silencio', () => {
    // Si alguien vuelve a la consulta vieja, esto lo canta en vez de servir nulls.
    const { rate, refusal } = parseVaultApy(
      { data: { vaultByAddress: { state: { apy: 0.05, netApy: 0.08, fee: 0.1 } } } },
      SOURCE,
    );
    expect(refusal).toBe('no vault returned for this address');
    expect(rate.netApyPct).toBeNull();
  });

  it('un campo ausente es null, nunca un cero que parezca medido', () => {
    const { rate } = parseVaultApy({ data: { vaultV2ByAddress: { netApy: 0.08 } } }, SOURCE);
    expect(rate.netApyPct).toBe(8);
    expect(rate.apyPct).toBeNull();
    expect(rate.performanceFeePct).toBeNull();
  });

  it('un cero de verdad SÍ es cero — una bóveda sin comisión no es una lectura fallida', () => {
    const { rate } = parseVaultApy(
      { data: { vaultV2ByAddress: { apy: 0, netApy: 0, performanceFee: 0 } } },
      SOURCE,
    );
    expect(rate.apyPct).toBe(0);
    expect(rate.performanceFeePct).toBe(0);
  });

  it('basura o NaN degradan a null sin romper', () => {
    expect(parseVaultApy(null, SOURCE).rate.apyPct).toBeNull();
    expect(parseVaultApy({ data: { vaultV2ByAddress: { apy: 'mucho' } } }, SOURCE).rate.apyPct).toBeNull();
    expect(parseVaultApy({ data: { vaultV2ByAddress: { apy: NaN } } }, SOURCE).rate.apyPct).toBeNull();
  });
});
