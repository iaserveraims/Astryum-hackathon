import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalizeSymbol } from '../canonicalizeSymbol';

// El carácter ₮ (U+20AE) cobró tres víctimas en dos días (deuda a $0, pierna
// invisible, hub sin repay). Este test fija la canonicalización Y que nadie
// vuelva a copiarla a mano: un solo origen por lado.
describe('canonicalizeSymbol', () => {
  it('USD₮0 (el símbolo ERC-20 real) → USDT0', () => {
    expect(canonicalizeSymbol('USD₮0')).toBe('USDT0');
    expect(canonicalizeSymbol('usd₮0')).toBe('USDT0');
    expect(canonicalizeSymbol('FXRP')).toBe('FXRP');
  });

  it('ninguna copia suelta del replace fuera del helper (frontend)', () => {
    const SRC = join(__dirname, '..', '..');
    const consumers = [
      'app/app/strategies/page.tsx',
      'components/positions/DefiPositionsBoard.tsx',
    ];
    for (const rel of consumers) {
      const src = readFileSync(join(SRC, rel), 'utf8');
      expect(src).toMatch(/canonicalizeSymbol\(/);
      expect(src).not.toMatch(/replace\(\/₮\//);
    }
  });
});
