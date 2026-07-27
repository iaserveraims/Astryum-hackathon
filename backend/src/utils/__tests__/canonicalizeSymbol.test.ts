import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalizeSymbol } from '../canonicalizeSymbol';

// El ₮ (U+20AE) cobró tres víctimas en 48 h. Un solo origen de verdad por
// lado; este test fija el mapeo Y que NormalisationEngine lo importe en vez
// de copiar el replace a mano.
describe('canonicalizeSymbol (backend)', () => {
  it('USD₮0 → USDT0 (y el resto pasa intacto en mayúsculas)', () => {
    expect(canonicalizeSymbol('USD₮0')).toBe('USDT0');
    expect(canonicalizeSymbol('usd₮0')).toBe('USDT0');
    expect(canonicalizeSymbol('wflr')).toBe('WFLR');
  });

  it('NormalisationEngine consume el helper — sin copias sueltas del replace', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', 'engines', 'normalisation', 'NormalisationEngine.ts'),
      'utf8',
    );
    expect(src).toMatch(/canonicalizeSymbol\(/);
    expect(src).not.toMatch(/replace\(\/₮\//);
  });
});
