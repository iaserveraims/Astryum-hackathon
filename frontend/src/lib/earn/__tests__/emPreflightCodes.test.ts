/**
 * Los «no» del carril, en el idioma del usuario.
 *
 * El backend redacta la prosa de sus pre-flights en inglés y la manda como
 * `message`; la interfaz la pintaba cruda. Resultado: el bloqueo de la ÚNICA
 * salida del lend-only aparecía en inglés dentro de un recuadro por lo demás en
 * castellano — justo la frase que explica por qué no puedes sacar tu dinero.
 *
 * La regla que se fija aquí: manda el CÓDIGO, la prosa del servidor es sólo el
 * respaldo, y un código desconocido degrada a esa prosa — jamás a un
 * identificador en mayúsculas delante de alguien que va a firmar.
 */
import { describe, it, expect } from 'vitest';
import { emPreflightMessage, KNOWN_PREFLIGHT_CODES } from '../emPreflightCodes';

/** `t` de mentira: devuelve la clave, para ver QUÉ se pide traducir. */
const id = (s: string) => s;

describe('emPreflightMessage', () => {
  it('traduce el bloqueo de la salida de la bóveda', () => {
    expect(emPreflightMessage('WITHDRAW_EXCEEDS_VAULT_LIQUIDITY', id))
      .toContain('its live liquidity decides');
  });

  it('traduce el bloqueo por valor de tus shares', () => {
    expect(emPreflightMessage('WITHDRAW_EXCEEDS_BALANCE', id))
      .toContain('lent position is worth');
  });

  it('un código DESCONOCIDO devuelve null — para caer en la prosa del backend', () => {
    // Lo que NO puede pasar es enseñar «WITHDRAW_EXCEEDS_FOO» al usuario.
    expect(emPreflightMessage('CODIGO_QUE_NO_EXISTE', id)).toBeNull();
  });

  it('sin código, null', () => {
    expect(emPreflightMessage(undefined, id)).toBeNull();
    expect(emPreflightMessage(null, id)).toBeNull();
    expect(emPreflightMessage('', id)).toBeNull();
  });

  it('todo lo que devuelve pasa por t() — nada se cuela sin traducir', () => {
    const seen: string[] = [];
    const spy = (s: string) => { seen.push(s); return 'ES:' + s; };
    for (const code of KNOWN_PREFLIGHT_CODES) {
      expect(emPreflightMessage(code, spy)).toMatch(/^ES:/);
    }
    expect(seen).toHaveLength(KNOWN_PREFLIGHT_CODES.length);
  });
});

/**
 * El contrato con el backend. Si allí nace un código nuevo y aquí no entra, el
 * usuario ve la frase inglesa del servidor — degradación honesta, pero hay que
 * enterarse. Esta lista es la del backend (grep de `code: '…'`
 * en EthMorphoPrepareService + EthMorphoMarketService).
 */
describe('cobertura frente a los códigos que el backend emite', () => {
  const BACKEND_CODES = [
    'AMOUNT_NOT_POSITIVE', 'BORROW_EXCEEDS_LIQUIDITY', 'BORROW_WOULD_LIQUIDATE',
    'BRIDGE_EXCEEDS_BALANCE', 'BRIDGE_PEER_DRIFT', 'BRIDGE_TOKEN_DRIFT',
    'DEPOSIT_EXCEEDS_CAP', 'INSUFFICIENT_BALANCE', 'INSUFFICIENT_BALANCE_WITH_VAULT',
    'INSUFFICIENT_ETH_FOR_FEE',
    'INSUFFICIENT_FLR_FOR_FEE', 'INVALID_ACTION', 'INVALID_AMOUNT',
    'MARKET_PARAMS_DRIFT', 'NO_DEBT', 'REPAY_EXCEEDS_DEBT', 'VAULT_ASSET_MISMATCH',
    'WITHDRAW_EXCEEDS_BALANCE', 'WITHDRAW_EXCEEDS_COLLATERAL',
    'WITHDRAW_EXCEEDS_VAULT_LIQUIDITY', 'WITHDRAW_WOULD_LIQUIDATE',
  ];

  it('los cubre TODOS', () => {
    const missing = BACKEND_CODES.filter((c) => emPreflightMessage(c, id) === null);
    expect(missing).toEqual([]);
  });

  it('y no inventa códigos que el backend no emite', () => {
    const extra = KNOWN_PREFLIGHT_CODES.filter((c) => !BACKEND_CODES.includes(c));
    expect(extra).toEqual([]);
  });
});
