/**
 * La fuente de un número se traduce, no se borra.
 *
 * Es la línea fina del invariante #9: un APY sin procedencia es una oferta
 * nuestra; con procedencia es un dato del protocolo. Así que estos tests
 * protegen las dos mitades a la vez — que lo que se lee esté en castellano
 * llano, y que la cadena técnica siga viajando para poder comprobarla.
 */
import { describe, it, expect } from 'vitest';
import { readableAsOf, readableNote, readableSource } from '../rateSource';

describe('la fuente se dice, no se recita', () => {
  it('la de Kinetic con incentivos deja de ser el nombre de una función', () => {
    const r = readableSource(
      'kFXRP_ISO.supplyRatePerTimestamp (base, on-chain) + DeFiLlama apyReward (WFLR incentives, same pool)',
    )!;
    expect(r.text).toBe('Read from Kinetic on the chain, plus the rewards DeFiLlama reports');
    expect(r.text).not.toMatch(/supplyRatePerTimestamp|apyReward|kFXRP_ISO/);
  });

  it('pero la cadena técnica NO se pierde: viaja para poder comprobarla', () => {
    const raw = 'kFXRP_ISO.supplyRatePerTimestamp (live, simple APR, per-second rate)';
    expect(readableSource(raw)!.tech).toBe(raw);
  });

  it('el coste de pedir prestado gana a la regla general', () => {
    // Orden importa: «borrowRate» tiene que casar antes que «RatePerTimestamp».
    const r = readableSource('kUSDT0_ISO.borrowRatePerTimestamp (live, per-second borrow rate)')!;
    expect(r.text).toBe('The cost Kinetic charges right now, read from the chain');
  });

  it('reconoce las demás procedencias vivas', () => {
    expect(readableSource('Upshift (August Digital) API')!.text).toMatch(/Upshift/);
    expect(readableSource('DeFiLlama /pools (live)')!.text).toMatch(/DeFiLlama/);
    expect(readableSource('live on-chain (balanceOfUnderlying / borrowBalanceCurrent)')!.text).toBe(
      'Read from your position on the chain',
    );
  });

  it('una fuente desconocida se deja tal cual — jamás se queda huérfano un número', () => {
    // Preferimos una procedencia que nadie entienda a ninguna procedencia: lo
    // segundo convertiría el dato del protocolo en una oferta nuestra (#9).
    const raw = 'algún oráculo nuevo v3.2';
    expect(readableSource(raw)!.text).toBe(raw);
  });

  it('sin fuente no se inventa ninguna', () => {
    expect(readableSource(null)).toBeNull();
    expect(readableSource('   ')).toBeNull();
  });
});

describe('la hora y la nota', () => {
  it('la hora pierde los segundos: precisión que el dato no tiene', () => {
    const at = readableAsOf('2026-08-25T20:53:28.000Z');
    expect(at).toMatch(/^\d{2}:\d{2}$/);
    expect(at).not.toMatch(/:\d{2}:\d{2}/);
  });

  it('una hora ilegible no se pinta', () => {
    expect(readableAsOf('mañana por la tarde')).toBeNull();
    expect(readableAsOf(null)).toBeNull();
  });

  it('la nota cambia el vocabulario y conserva los NÚMEROS', () => {
    const n = readableNote('Base 0.05% + rewards 0.80% (WFLR incentives).')!;
    expect(n).toContain('0.05%');
    expect(n).toContain('0.80%');
    expect(n).not.toMatch(/\bBase\b/);
    expect(n).not.toMatch(/incentives/);
  });
});
