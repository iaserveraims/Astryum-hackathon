/**
 * ¿A qué FILA apunta un deep-link? Es lo que decide qué modal se abre cuando
 * llega el aviso de la protección — y hasta hoy no tenía un solo test.
 *
 * El caso que lo motivó (regresión introducida por la fila LEND, `d9851fa`):
 * hasta que la bóveda tuvo fila, `morpho-blue` + dueño solo casaba con
 * colateral o deuda. Con la fila nueva casa también con el préstamo, así que un
 * aviso de repago podía abrir el modal de repago sobre una posición sin deuda y
 * el backend contestaba 400. Un aviso que abre una puerta que da error es la
 * misma familia que uno que no abre nada, y esa ya se cerró una vez.
 */
import { describe, it, expect } from 'vitest';
import { matchesAutoAction, rowNames, type AutoActionRow } from '../positionAutoAction';

const OWNER = '0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa';

const row = (over: Partial<AutoActionRow> = {}): AutoActionRow => ({
  protocolId: 'morpho-blue',
  owner: OWNER,
  kindUpper: 'DEBT',
  asset: 'RLUSD',
  ...over,
});

describe('matchesAutoAction — el repago no apunta a un préstamo', () => {
  it('un repago NO casa con la fila de la bóveda', () => {
    expect(matchesAutoAction(
      { action: 'repay', protocolId: 'morpho-blue', owner: OWNER },
      row({ kindUpper: 'LEND' }),
    )).toBe(false);
  });

  it('el mismo repago SÍ casa con la deuda y con el colateral', () => {
    const a = { action: 'repay' as const, protocolId: 'morpho-blue', owner: OWNER };
    expect(matchesAutoAction(a, row({ kindUpper: 'DEBT' }))).toBe(true);
    expect(matchesAutoAction(a, row({ kindUpper: 'COLLATERAL' }))).toBe(true);
  });

  it('una RETIRADA sí puede apuntar a la bóveda — ahí sí hay puerta', () => {
    expect(matchesAutoAction(
      { action: 'withdraw', protocolId: 'morpho-blue', owner: OWNER },
      row({ kindUpper: 'LEND' }),
    )).toBe(true);
  });
});

describe('matchesAutoAction — lo de siempre, ahora con red', () => {
  it('otro protocolo no casa', () => {
    expect(matchesAutoAction(
      { action: 'repay', protocolId: 'kinetic', owner: OWNER },
      row(),
    )).toBe(false);
  });

  it('otro dueño no casa — la regla se ata a quien SOSTIENE la posición', () => {
    expect(matchesAutoAction(
      { action: 'repay', protocolId: 'morpho-blue', owner: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      row(),
    )).toBe(false);
  });

  it('sin dueño en el enlace, casa por protocolo (el hub no siempre lo sabe)', () => {
    expect(matchesAutoAction({ action: 'repay', protocolId: 'morpho-blue' }, row())).toBe(true);
  });

  it('el nombre filtra por el símbolo del SUBYACENTE, no solo por asset', () => {
    const p = row({ protocolId: 'upshift', asset: '0xAd55…c5bE', raw: { vaultName: 'earnXRP' } });
    expect(matchesAutoAction({ action: 'withdraw', protocolId: 'upshift', name: 'earnXRP' }, p)).toBe(true);
    expect(matchesAutoAction({ action: 'withdraw', protocolId: 'upshift', name: 'MXRPY' }, p)).toBe(false);
  });

  it('la comparación de nombre no distingue mayúsculas', () => {
    const p = row({ protocolId: 'upshift', raw: { token: 'stXRP' } });
    expect(matchesAutoAction({ action: 'withdraw', protocolId: 'upshift', name: 'STXRP' }, p)).toBe(true);
  });
});

describe('rowNames — por qué nombres puede reconocerse una fila', () => {
  it('recoge token, vaultName, symbol y asset, en minúsculas', () => {
    expect(rowNames(row({ asset: 'RLUSD', raw: { token: 'FXRP', symbol: 'kFXRP' } })))
      .toEqual(['fxrp', 'kfxrp', 'rlusd']);
  });

  it('sin raw no revienta', () => {
    expect(rowNames(row({ asset: 'RLUSD', raw: undefined }))).toEqual(['rlusd']);
  });
});
