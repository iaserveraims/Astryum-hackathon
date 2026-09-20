import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * G12-move (ronda 2) — la página pública pintaba el slug crudo.
 *
 * `legacyActionLabel` in ProofPage knew four of the TWELVE action slugs the
 * backend enum accepts, and everything else fell to `default`, which returned
 * `action` itself. /proof is the PUBLIC surface — the page whose whole point is
 * "receipts, not screenshots" — so the last real council order could read
 * «La última orden real: set-max-venue-bps». Our field name, shown to a
 * stranger as if it were a fact about the ledger.
 *
 * The four venue doors shipped in G12 made `propose-venue`, `retire-venue` and
 * `set-max-venue-bps` reachable for real; `set-payees`, `cede`, `end-cession`
 * and `set-constitution-ref` had doors already, so they leaked too.
 *
 * This test reads the BACKEND enum, not a copy of it: a thirteenth action added
 * to `councilOrderSchema` turns it red instead of shipping a slug to the world.
 * Source-level (like councilOrderCard.venueDoors) because the vitest bootstrap
 * is `environment: 'node'` and ProofPage's module graph is the whole landing.
 */

const PAGE = join(__dirname, '..', 'ProofPage.tsx');
const src = readFileSync(PAGE, 'utf8');

const ROUTE = join(__dirname, '..', '..', '..', '..', '..', 'backend', 'src', 'routes', 'xrplDefi.ts');

/** Slice a balanced literal out of `text`, from `open` to its match. */
function balancedSlice(text: string, from: number, open: '{' | '['): string {
  const close = open === '{' ? '}' : ']';
  const start = text.indexOf(open, from);
  expect(start, 'the literal must start somewhere').toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === open) depth += 1;
    else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${open}`);
}

/** The council-order action slugs the backend actually accepts (zod enum). */
function backendActionSlugs(): string[] {
  const route = readFileSync(ROUTE, 'utf8'); // fails loudly if the path moved
  const at = route.indexOf('const councilOrderSchema = z.object({');
  expect(at, 'councilOrderSchema must exist — update this test if the route moved').toBeGreaterThan(-1);
  const enumAt = route.indexOf('action: z.enum(', at);
  expect(enumAt, 'the action enum must exist').toBeGreaterThan(-1);
  const literal = balancedSlice(route, enumAt, '[');
  // eslint-disable-next-line no-new-func
  return new Function(`return ${literal};`)() as string[];
}

/** Pull the shipping switch out of ProofPage and run it with a stub `T`. */
function loadLegacyActionLabel(): (action: string | null, lang: 'es' | 'en') => string {
  const SIGNATURE = 'function legacyActionLabel(action: string | null, lang: Lang): string {';
  const at = src.indexOf(SIGNATURE);
  expect(at, 'legacyActionLabel signature changed — update this test').toBeGreaterThan(-1);
  const body = balancedSlice(src, at + SIGNATURE.length - 1, '{');
  // eslint-disable-next-line no-new-func
  return new Function(
    'T',
    `return function legacyActionLabel(action, lang) ${body};`,
  )((es: string, en: string, lang: 'es' | 'en') => (lang === 'es' ? es : en));
}

const slugs = backendActionSlugs();
const legacyActionLabel = loadLegacyActionLabel();

describe('G12-move — /proof no publica jerga de máquina', () => {
  it('covers EVERY action the backend enum can store (no slug reaches the page)', () => {
    const leaking = slugs.filter(
      (s) => legacyActionLabel(s, 'es') === s || legacyActionLabel(s, 'en') === s,
    );
    expect(leaking, 'these slugs still render raw on the public proof page').toEqual([]);
  });

  it('the three doors G12 opened read as sentences, in both languages', () => {
    for (const s of ['propose-venue', 'retire-venue', 'set-max-venue-bps']) {
      expect(slugs, `${s} must still be a backend action`).toContain(s);
      // Not the slug, not a slug fragment — a sentence, and a different one per
      // language (a switch that forgot `lang` would return the same string).
      expect(legacyActionLabel(s, 'es')).not.toContain(s);
      expect(legacyActionLabel(s, 'en')).not.toContain(s);
      expect(legacyActionLabel(s, 'en').split(' ').length).toBeGreaterThan(2);
      expect(legacyActionLabel(s, 'es')).not.toBe(legacyActionLabel(s, 'en'));
    }
  });

  it('an unknown or missing action never leaks the raw value either', () => {
    // A slug we have never seen is still A COUNCIL ORDER — that much is true of
    // every row in this table. Printing the unknown string would not be.
    expect(legacyActionLabel('some-future-action', 'en')).toBe('a council order');
    expect(legacyActionLabel(null, 'es')).toBe('una orden del consejo');
    expect(legacyActionLabel('some-future-action', 'es')).not.toContain('some-future-action');
  });

  it('the four labels that were already there did not change meaning', () => {
    expect(legacyActionLabel('direct-to', 'en')).toBe('putting capital to work');
    expect(legacyActionLabel('recall', 'en')).toBe('recalling capital from a strategy');
    expect(legacyActionLabel('move', 'en')).toBe('moving capital between strategies');
    expect(legacyActionLabel('evacuate', 'en')).toBe('evacuating a strategy');
  });
});
