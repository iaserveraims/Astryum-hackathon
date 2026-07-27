/**
 * canonicalizeSymbol — EL único sitio del backend donde se normaliza un
 * símbolo on-chain para comparar/mapear. El símbolo ERC-20 real de USDT0 usa
 * el carácter ₮ (U+20AE): "USD₮0" — sin esta canonicalización el mapeo de
 * símbolos jamás casaba y la deuda valía $0 en todos los paneles (incidente
 * 2026-07-25, y dos víctimas más del mismo carácter en 48 h). Prohibido copiar
 * el .replace a mano: se importa esto. Espejo frontend:
 * frontend/src/lib/canonicalizeSymbol.ts.
 */
export function canonicalizeSymbol(sym: string): string {
  return sym.toUpperCase().replace(/₮/g, 'T');
}
