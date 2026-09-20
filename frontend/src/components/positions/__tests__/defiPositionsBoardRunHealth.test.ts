import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RULE_PILL_TONE, rulePillState } from '@/lib/rules/runHealth';

import {
  loadRunReadings,
  summarizeReading,
  summarizeRuns as reduceRuns,
  type RuleRun,
} from '@/lib/rules/runHealth';

/**
 * G4-residuos (auditorí §G4) — el tablero que SÍ leía los runs y aun
 * así no decía que habían fallado.
 */

const BOARD = join(__dirname, '..', 'DefiPositionsBoard.tsx');
const src = readFileSync(BOARD, 'utf8');

/**
 * G4-strategies — the reducer this suite exercises now lives in ONE
 * place, `src/lib/rules/runHealth.ts`, and is IMPORTED here instead of being
 * scraped out of the component source with `new Function`. The behavioural
 * cases below are unchanged on purpose: they are the red net proving the
 * extraction did not move a single verdict. The source-level block underneath
 * keeps checking the CABLE of this surface, which no shared module can prove.
 */

/**
 * The verdict union, widened for assertions: several cases probe `at` / `note`
 * / `consecutive`, which only exist on the `failed` arm. Narrowing in every
 * test would bury the fact each one pins, so the arms are widened HERE, once.
 */
type Verdict = { state: string; at?: string; note?: string | null; consecutive?: number };
const summarizeRuns = (runs: RuleRun[]): Verdict => reduceRuns(runs);

const run = (status: string, notes: string | null = null, triggeredAt = '2026-08-17T10:00:00.000Z'): RuleRun => ({
  triggeredAt,
  status,
  notes,
});

describe('DefiPositionsBoard · summarizeRuns — `error` ya no se confunde con salud', () => {
  it('sin runs → "never" (es lo que de verdad significa «No triggers yet»)', () => {
    expect(summarizeRuns([])).toEqual({ state: 'never' });
  });

  it('último run en error → "failed" con la nota del motor (la que se tiraba)', () => {
    const v = summarizeRuns([run('error', 'prepare failed: HF read unavailable', '2026-08-17T08:00:00.000Z')]);
    expect(v.state).toBe('failed');
    expect(v.note).toContain('HF read unavailable');
    expect(v.at).toBe('2026-08-17T08:00:00.000Z');
    expect(v.consecutive).toBe(1);
  });

  it('la automatización que falla en TODOS sus disparos cuenta la racha entera', () => {
    const v = summarizeRuns([
      run('error', 'prepare failed'),
      run('error', 'prepare failed'),
      run('intent_prepared', 'repay prepared — waiting for your signature'),
    ]);
    expect(v.state).toBe('failed');
    expect(v.consecutive).toBe(2);
  });

  it('un `intent_prepared` reciente es salud aunque haya errores antiguos debajo', () => {
    expect(summarizeRuns([run('intent_prepared', 'ok'), run('error', 'old')]).state).toBe('ok');
  });

  it('`triggered` (reintento tras cooldown) NO es fallo', () => {
    expect(summarizeRuns([run('triggered', 'cooldown')]).state).toBe('ok');
  });

  it('nota ausente → null explícito (jamás se inventa un motivo)', () => {
    expect(summarizeRuns([run('error', null)]).note).toBeNull();
  });
});

describe('DefiPositionsBoard · el cable de G4', () => {
  it('el reductor sale del MÓDULO COMPARTIDO, no de una tercera copia local', () => {
    expect(src).toMatch(/from '\.\.\/\.\.\/lib\/rules\/runHealth'/);
    expect(src).not.toMatch(/function summarizeRuns\(/);
  });

  // REUSE (auditoria) - esta superficie era la UNICA de las seis que
  // seguia llamando a GET /rules/:id/runs a mano, con sus propios headers y su
  // propia idea de que significa una lectura rota. Las dos aserciones que aqui
  // raspaban ese `fetch` ya no describen nada: el cable es ahora
  // `loadRunReadings` y la conducta que defendian se EJECUTA de verdad debajo,
  // sobre el modulo compartido que la board corre.
  it('el READ sale del modulo compartido: aqui no queda ningun fetch propio de /runs', () => {
    // Las tres formas viejas de leerlo por su cuenta - ninguna puede volver:
    expect(src).not.toMatch(/fetch\(`\$\{API_BASE\}\/rules\//);
    expect(src).not.toContain('if (!r.ok) continue;');
    expect(src).not.toMatch(/\} catch \{\s*\n\s*\/\* history is best-effort/);
    // ...y el cargador unico que las sustituye, con el mismo cliente que usan
    // las otras cinco superficies (rulesApi.runs -> v1Api, que ademas trata el 401).
    expect(src).toMatch(/loadRunReadings\(ruleIdsKey\.split\(','\)\.filter\(Boolean\), \(id\) => rulesApi\.runs\(id\)\)/);
  });

  it('ya no descarta `notes`, y los contadores de la linea de historia salen del MISMO read', () => {
    // Ejecutado sobre el reductor que la board corre ahora, no raspado del fuente.
    const reading = summarizeReading({
      count: 4,
      runs: [run('error', 'prepare failed: HF read unavailable', '2026-08-17T08:00:00.000Z'), run('triggered')],
    });
    expect(reading.count).toBe(4);
    expect(reading.lastAt).toBe('2026-08-17T08:00:00.000Z');
    expect(reading.lastStatus).toBe('error');
    expect(reading.verdict).toMatchObject({ state: 'failed', note: 'prepare failed: HF read unavailable' });
  });

  it('una lectura fallida se DICE, no se convierte en <<No triggers yet>>', async () => {
    const out = await loadRunReadings(['r1'], async () => {
      throw new Error('HTTP 502');
    });
    // El veredicto es `unreadable` CON su motivo...
    expect(out.r1.verdict).toEqual({ state: 'unreadable', detail: 'HTTP 502' });
    // ...y `count` es 0 porque no leimos ninguno, que es justo por lo que la
    // fila debe decidir por el VEREDICTO y jamas por `count === 0`.
    expect(out.r1.count).toBe(0);
    // La fila que lo pinta: el brazo `unreadable` va ANTES del <<No triggers yet>>.
    expect(src).toContain('Could not read this rule\u2019s run history');
    expect(src.indexOf("verdict.state === 'unreadable'")).toBeLessThan(src.indexOf('health.count === 0'));
  });

  it('«todavía no leído» no se pinta como «nunca disparó»', () => {
    expect(src).toContain("t('Reading its run history…')");
    expect(src).toContain("t('No triggers yet')");
  });

  // G4-pildoras (ronda 3): `state === 'failed'` a secas dejaba `unread` y
  // `unreadable` en el brazo VERDE — el primer pintado decía «active» antes de
  // leer un solo run, y un /runs roto devolvía a verde una regla fallida.
  it('la píldora ya no puede ponerse verde sobre un veredicto sin leer', () => {
    // Las dos formas viejas de la mentira — ninguna puede volver:
    expect(src).not.toContain("tone={r.enabled ? 'success' : 'neutral'}");
    expect(src).not.toMatch(/const failing = runsByRule\[r\.id\]\?\.verdict\.state === 'failed'/);
    expect(src).toContain("const pill = rulePillState(r.enabled, runsByRule[r.id]?.verdict);");
    expect(src).toContain('<Pill tone={RULE_PILL_TONE[pill]}>');
    expect(src).toContain("t('failing')");
    // Y el COMPORTAMIENTO que ese cable transporta, ejecutado de verdad
    // (la red completa del veredicto vive en lib/rules/__tests__/runHealth.test.ts):
    expect(RULE_PILL_TONE[rulePillState(true, undefined)]).not.toBe('success');
    expect(RULE_PILL_TONE[rulePillState(true, { state: 'unreadable', detail: 'HTTP 500' })]).not.toBe('success');
    expect(RULE_PILL_TONE[rulePillState(true, { state: 'ok' })]).toBe('success');
  });

  it('la fila enseña el PORQUÉ del fallo, no una palabra de máquina entre paréntesis', () => {
    expect(src).toContain('Its last run FAILED — this rule is armed but it produced nothing to sign.');
    expect(src).toMatch(/verdict\.note \?/);
    expect(src).toMatch(/verdict\.consecutive > 1/);
  });

  // G4-strategies (residuo de la ronda 1): el efecto dependía SOLO de
  // `ruleIdsKey`, así que con la card abierta el veredicto quedaba congelado en
  // el del montaje — una regla que empezaba a fallar conservaba su píldora
  // verde hasta plegar la card, y un `onChanged()` que devolvía los MISMOS ids
  // no releía nada. El encargo pedía montar Y refrescar.
  it('lee al MONTAR y al REFRESCAR: el efecto sigue también la revisión del tablero', () => {
    expect(src).toMatch(/\}, \[ruleIdsKey, runsRevision\]\);/);
    // …y esa revisión la emite de verdad el tablero al terminar de leer reglas
    // (un productor sin consumidor, o al revés, es justo el fallo perseguido).
    expect(src).toMatch(/setRunsRevision\(\(n\) => n \+ 1\);/);
    expect(src).toMatch(/runsRevision=\{runsRevision\}/);
  });

  // G4-strategies: el contador «N ⚡» de la cabecera es la ÚNICA señal de
  // automatización que enseña la card plegada — y en /app/strategies
  // (showStrategyPanel={false}) la única que enseña la posición, punto. Iba en
  // verde por `enabled` a secas: tres reglas fallando cada disparo se leían
  // como «3 ⚡» sanas.
  it('el contador ⚡ de la cabecera ya no promete salud que nunca leyó', () => {
    expect(src).not.toMatch(/<Pill tone="success">\{activeCount\}/);
    expect(src).toMatch(/<Pill tone="neutral">\{activeCount\} ⚡<\/Pill>/);
    expect(src).toContain('Armed automations. This count does not say whether their last run worked.');
  });
});
