/**
 * emPreflightCodes — los «no» del carril de Ethereum, en el idioma del usuario.
 *
 * El backend redacta la prosa de sus pre-flights en inglés y la manda como
 * `message`. La interfaz la pintaba cruda, así que el bloqueo de la ÚNICA
 * salida del lend-only aparecía en inglés dentro de un recuadro por lo demás en
 * castellano — justo la frase que explica por qué no puedes sacar tu dinero.
 *
 * Lo que viaja como CONTRATO es el `code`; la prosa del backend es sólo el
 * respaldo para un código que esta tabla todavía no conozca. Nunca al revés: un
 * código nuevo debe degradar a la frase inglesa del servidor, jamás a un
 * identificador en mayúsculas delante del usuario.
 */

/** Cada código, contado como se lo dirías a alguien que va a firmar. */
const MESSAGES: Record<string, string> = {
  /* — Saldos y munición — */
  INSUFFICIENT_BALANCE: "Your wallet doesn't hold enough of that token on Ethereum for this action.",
  INSUFFICIENT_BALANCE_WITH_VAULT:
    "Your wallet and your Sentora lend position together don't hold enough RLUSD on Ethereum for this repay.",
  BRIDGE_EXCEEDS_BALANCE: "You're trying to bridge more FXRP than that wallet holds.",
  INSUFFICIENT_FLR_FOR_FEE: "The LayerZero delivery fee is paid in FLR, and your wallet doesn't hold enough.",
  INSUFFICIENT_ETH_FOR_FEE: "The LayerZero delivery fee is paid in ETH, and your wallet doesn't hold enough.",

  /* — La bóveda (lend-only) — */
  WITHDRAW_EXCEEDS_BALANCE: 'That is more than your lent position is worth right now.',
  WITHDRAW_EXCEEDS_VAULT_LIQUIDITY:
    "The vault cannot pay that out right now — its live liquidity decides, not your balance.",
  DEPOSIT_EXCEEDS_CAP: "The vault cannot take that much right now — its deposit cap decides, not your balance.",

  /* — El mercado (carry) — */
  BORROW_EXCEEDS_LIQUIDITY: 'The market cannot lend that much right now.',
  BORROW_WOULD_LIQUIDATE: 'That borrow would put your position past its liquidation limit.',
  WITHDRAW_EXCEEDS_COLLATERAL: 'You cannot take out more collateral than the position holds.',
  WITHDRAW_WOULD_LIQUIDATE:
    'Taking that much collateral out would cross the liquidation line while you still owe.',
  REPAY_EXCEEDS_DEBT: 'That is more than you owe — use "close the whole debt" instead.',
  NO_DEBT: 'This position has no debt to repay.',

  /* — Cosas que NO deberían pasar, y por eso se dicen fuerte — */
  MARKET_PARAMS_DRIFT: 'The market on-chain no longer matches the one this app was built against. Nothing was prepared.',
  VAULT_ASSET_MISMATCH: 'That vault does not hold RLUSD. Nothing was prepared.',
  BRIDGE_PEER_DRIFT: 'The bridge endpoints no longer match. Nothing was prepared.',
  BRIDGE_TOKEN_DRIFT: 'The bridge no longer wraps the FXRP this app expects. Nothing was prepared.',

  /* — Entrada del usuario — */
  AMOUNT_NOT_POSITIVE: 'The amount has to be greater than zero.',
  INVALID_AMOUNT: 'That amount is not a valid figure.',
  INVALID_ACTION: 'That action is not one this rail can prepare.',
};

/**
 * `code` → frase traducida. `null` cuando el código es desconocido, para que
 * quien llame use la prosa del backend en vez de enseñar el identificador.
 */
export function emPreflightMessage(
  code: string | undefined | null,
  t: (s: string) => string,
): string | null {
  if (!code) return null;
  const en = MESSAGES[code];
  return en ? t(en) : null;
}

/** Los códigos que esta tabla cubre — el test los contrasta con el backend. */
export const KNOWN_PREFLIGHT_CODES = Object.keys(MESSAGES);
