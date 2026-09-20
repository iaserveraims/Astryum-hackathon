/**
 * PROTECT_EM — el contrato entre la plantilla y el motor, sin red que lo fije
 * hasta hoy.
 */
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@/components/moneyflows/templateCatalog';

const TARGET = { protocolId: 'morpho-blue', positionId: 'morpho-blue:FXRP:COLLATERAL' };

const build = (over: Record<string, string> = {}) =>
  TEMPLATES.PROTECT_EM.build(
    { hf: '1.10', full: 'false', cooldown: '60', ...over },
    TARGET as never,
  );

describe('PROTECT_EM.build — el vocabulario que el tick entiende', () => {
  it('emite HF_BELOW + emRepay, con el umbral como número', () => {
    const r = build();
    expect(r.trigger).toEqual({ type: 'HF_BELOW', threshold: 1.1 });
    expect(r.action.kind).toBe('emRepay');
    // Sin este kind exacto, el tick agruparía la regla por la chain de la
    // WALLET (14) y escanearía Flare para una posición de Ethereum.
    expect(r.action.protocolId).toBe('morpho-blue');
    expect(r.action.positionId).toBe(TARGET.positionId);
  });

  it('el toggle se traduce a los DOS modos que la puerta acepta', () => {
    expect((build({ full: 'false' }).action.params as { mode: string }).mode).toBe('partial');
    expect((build({ full: 'true' }).action.params as { mode: string }).mode).toBe('full');
  });

  it('el cooldown viaja como entero de minutos, nunca como texto ni NaN', () => {
    expect(build({ cooldown: '60' }).cooldownMinutes).toBe(60);
    expect(build({ cooldown: '12.6' }).cooldownMinutes).toBe(13);
    // Un campo vacío no puede convertirse en NaN: el backend lo rechazaría y
    // el usuario vería un error incomprensible tras rellenar el formulario.
    expect(build({ cooldown: '' }).cooldownMinutes).toBe(0);
  });

  it('el umbral por defecto está POR ENCIMA de la liquidación (1,00)', () => {
    const hf = TEMPLATES.PROTECT_EM.fields.find((f) => f.key === 'hf');
    expect(Number(hf?.default)).toBeGreaterThan(1);
    expect(Number(hf?.min)).toBeGreaterThan(1); // un umbral ≤1 no protege: ya te liquidaron
  });

  it('el blurb DICE dónde hace falta la munición — es la letra que evita el revert', () => {
    // Binding adjustment #3: el repago gasta RLUSD EN ETHEREUM. Si esta frase
    // desaparece, el usuario arma la protección sin saber qué necesita.
    expect(TEMPLATES.PROTECT_EM.blurb).toMatch(/RLUSD/);
    expect(TEMPLATES.PROTECT_EM.blurb).toMatch(/Ethereum/);
  });

  it('promete NUDGE + firma del dueño, jamás ejecución automática', () => {
    const blurb = TEMPLATES.PROTECT_EM.blurb.toLowerCase();
    expect(blurb).toMatch(/you sign/);
    expect(blurb).not.toMatch(/automatic|on your behalf|we repay/);
  });
});
