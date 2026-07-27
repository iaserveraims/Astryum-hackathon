/**
 * canonicalizeSymbol — EL único sitio del frontend donde se normaliza un
 * símbolo on-chain para comparar. El símbolo ERC-20 real de USDT0 usa el
 * carácter ₮ (U+20AE): "USD₮0" — sin esta canonicalización ningún
 * `includes('USDT')` casa, y el mismo carácter ya cobró tres víctimas en dos
 * días (deuda a $0 en paneles 6407f57, pierna de deuda invisible 2cb40bc, hub
 * sin repay/unwind). Prohibido copiar el .replace a mano: se importa esto.
 */
export function canonicalizeSymbol(sym: string): string {
  return sym.toUpperCase().replace(/₮/g, 'T');
}
