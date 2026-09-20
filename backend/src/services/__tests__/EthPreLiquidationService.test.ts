/**
 * La protección que funciona mientras duermes — `PreLiquidation` de Morpho.
 *
 * Lo que estos tests fijan NO es nuestra lógica de negocio: son los límites que
 * el CONTRATO impone y que la pantalla tiene que respetar antes de dejar firmar.
 * Si alguno de estos cede, el usuario firmaría una autorización que el contrato
 * va a rechazar — o peor, una que le protege más tarde de lo que cree.
 */
import {
  validatePreLiquidationParams,
  suggestParams,
  prepareArmPreLiquidation,
  prepareDisarmPreLiquidation,
  PRELIQUIDATION_FACTORY_ETH,
  type PreLiquidationParams,
} from '../EthPreLiquidationService';
import { MORPHO_BLUE_SINGLETON } from '../../connectors/protocols/adapters/MorphoBlueEthAdapter';
import { Interface } from 'ethers';

const WAD = 10n ** 18n;
/** El LLTV real del mercado FXRP/RLUSD, leído de mainnet: 0,77. */
const LLTV = 770_000_000_000_000_000n;
const USER = '0x1111111111111111111111111111111111111111';
const ORACLE = '0x5AC03061500E0C97862a466a38a7e87FAC4Ac39D';
const INSTANCE = '0x94CBd5633172dcAcBD21509624a73C9F53c02C5E';

const base = (over: Partial<PreLiquidationParams> = {}): PreLiquidationParams => ({
  ...suggestParams(LLTV, 'balanced', ORACLE),
  ...over,
});

describe('los límites del contrato', () => {
  it('el umbral tiene que estar POR DEBAJO del LLTV — o no protege de nada', () => {
    expect(validatePreLiquidationParams(base({ preLltv: LLTV }), LLTV))
      .toMatchObject({ ok: false, code: 'PRELLTV_TOO_HIGH' });
    expect(validatePreLiquidationParams(base({ preLltv: LLTV + 1n }), LLTV))
      .toMatchObject({ ok: false, code: 'PRELLTV_TOO_HIGH' });
    expect(validatePreLiquidationParams(base({ preLltv: LLTV - 1n }), LLTV).ok).toBe(true);
  });

  it('el incentivo no puede ser negativo ni pasar de 1/LLTV', () => {
    expect(validatePreLiquidationParams(base({ preLIF1: WAD - 1n }), LLTV))
      .toMatchObject({ ok: false, code: 'PRELIF1_TOO_LOW' });
    const techo = (WAD * WAD) / LLTV; // 1,2987 con LLTV 0,77
    expect(validatePreLiquidationParams(base({ preLIF1: techo, preLIF2: techo }), LLTV).ok).toBe(true);
    expect(validatePreLiquidationParams(base({ preLIF1: techo, preLIF2: techo + 1n }), LLTV))
      .toMatchObject({ ok: false, code: 'PRELIF2_TOO_HIGH' });
  });

  it('los factores van en orden y el de cierre no pasa del 100%', () => {
    expect(validatePreLiquidationParams(base({ preLCF1: 2n * WAD, preLCF2: 3n * WAD }), LLTV))
      .toMatchObject({ ok: false, code: 'PRELCF1_TOO_HIGH' });
    expect(validatePreLiquidationParams(base({ preLCF1: WAD / 2n, preLCF2: WAD / 4n }), LLTV))
      .toMatchObject({ ok: false, code: 'PRELCF_ORDER' });
    expect(validatePreLiquidationParams(base({ preLIF1: 11n * WAD / 10n, preLIF2: WAD }), LLTV))
      .toMatchObject({ ok: false, code: 'PRELIF_ORDER' });
  });
});

describe('umbrales sugeridos', () => {
  it('se DERIVAN del LLTV del mercado, no se copian de otros', () => {
    // Los seis contratos vivos usan preLltv 0,898-0,958, pero son mercados de
    // LLTV alto. Copiarlos aquí (LLTV 0,77) daría un umbral inválido.
    for (const modo of ['early', 'balanced', 'late'] as const) {
      const p = suggestParams(LLTV, modo, ORACLE);
      expect(p.preLltv).toBeLessThan(LLTV);
      expect(validatePreLiquidationParams(p, LLTV).ok).toBe(true);
    }
  });

  it('cuanto más tarde salta, más caro sale — y siempre antes de la liquidación', () => {
    const early = suggestParams(LLTV, 'early', ORACLE);
    const late = suggestParams(LLTV, 'late', ORACLE);
    expect(early.preLltv).toBeLessThan(late.preLltv);
    expect(early.preLIF1).toBeLessThan(late.preLIF1);
    expect(late.preLltv).toBeLessThan(LLTV);
  });

  it('un LLTV distinto mueve los umbrales con él', () => {
    const otro = 915_000_000_000_000_000n;
    expect(suggestParams(otro, 'balanced', ORACLE).preLltv)
      .toBeGreaterThan(suggestParams(LLTV, 'balanced', ORACLE).preLltv);
  });
});

describe('composición de las patas', () => {
  it('con la instancia ya creada: UNA pata, autorizar en Morpho', () => {
    const r = prepareArmPreLiquidation({ user: USER, params: base(), existingInstance: INSTANCE }, LLTV);
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0].to).toBe(MORPHO_BLUE_SINGLETON);
    const d = new Interface(['function setAuthorization(address,bool)'])
      .decodeFunctionData('setAuthorization', r.legs[0].data);
    expect(d[0]).toBe(INSTANCE);
    expect(d[1]).toBe(true);
    expect(r.plan.mustCreate).toBe(false);
  });

  it('sin instancia: se CREA primero, y la autorización queda para un segundo paso', () => {
    // Nada de autorizar una dirección adivinada: hasta que se mine no se sabe.
    const r = prepareArmPreLiquidation({ user: USER, params: base(), existingInstance: null }, LLTV);
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0].to).toBe(PRELIQUIDATION_FACTORY_ETH);
    expect(r.plan.mustCreate).toBe(true);
    expect(r.plan.instance).toBeNull();
  });

  it('con params inválidos NO compone nada', () => {
    const r = prepareArmPreLiquidation(
      { user: USER, params: base({ preLltv: LLTV + 1n }), existingInstance: INSTANCE }, LLTV,
    );
    expect(r.preflight.ok).toBe(false);
    expect(r.legs).toHaveLength(0);
  });

  it('el plan dice en cifras lo que la pantalla tiene que contar', () => {
    const r = prepareArmPreLiquidation({ user: USER, params: base(), existingInstance: INSTANCE }, LLTV);
    expect(r.plan.marketLltvPct).toBeCloseTo(77, 1);
    expect(r.plan.preLltvPct).toBeLessThan(77);
    // El incentivo es lo que le CUESTA al usuario que salte: 1,7% aquí.
    expect(r.plan.incentivePct).toBeGreaterThan(0);
    expect(r.plan.incentivePct).toBeLessThan(30);
  });

  it('dice quién ejecuta, qué cuesta y cómo se retira — los tres', () => {
    const r = prepareArmPreLiquidation({ user: USER, params: base(), existingInstance: INSTANCE }, LLTV);
    expect(r.disclosure.whoExecutes).toContain('permissionless');
    expect(r.disclosure.whoExecutes).toContain('Astryum does not run it');
    expect(r.disclosure.costNote).toContain('incentive');
    expect(r.disclosure.revokeNote).toContain('revoke');
    expect(r.disclosure.astryumFeeBase).toBe('0');
  });

  it('retirar la protección es una pata, y la firma el dueño', () => {
    const legs = prepareDisarmPreLiquidation(INSTANCE);
    expect(legs).toHaveLength(1);
    const d = new Interface(['function setAuthorization(address,bool)'])
      .decodeFunctionData('setAuthorization', legs[0].data);
    expect(d[0]).toBe(INSTANCE);
    expect(d[1]).toBe(false);
  });
});
