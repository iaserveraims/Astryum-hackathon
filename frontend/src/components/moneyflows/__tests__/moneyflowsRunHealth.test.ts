import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RULE_PILL_TONE, rulePillState, worstPillState } from '@/lib/rules/runHealth';

import { summarizeRuns as reduceRuns, type RuleRun } from '@/lib/rules/runHealth';

/**
 * G4 (auditorí) — «watching» que no vigila.
 *
 * A `councilOrder` rule on a Legacy with no cage throws `NoCageForLegacy`, the
 * engine stores the run as `status:'error'` with the reason in `notes`, and —
 * correctly — neither increments `totalTimesTriggered` nor pushes anything.
 * Consequence on this surface: a rule that failed EVERY fire rendered exactly
 * like a healthy one (green "active", "expires in 87d"). Same for
 * `NOT_A_COUNCIL`, `council_compose_failed` and `scheduled_payment_invalid`.
 */

const PANEL = join(__dirname, '..', 'MoneyFlowsPanel.tsx');
const src = readFileSync(PANEL, 'utf8');

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

describe('summarizeRuns — el veredicto sale de los runs LEÍDOS, jamás del silencio', () => {
  it('sin runs → "never" (nunca disparó; no es un fallo y no es salud)', () => {
    expect(summarizeRuns([])).toEqual({ state: 'never' });
  });

  it('último run en error → "failed" con SU nota y SU fecha (el porqué que la superficie escondía)', () => {
    const v = summarizeRuns([
      run('error', 'council_compose_failed: NoCageForLegacy rNoCage…', '2026-08-17T09:30:00.000Z'),
    ]);
    expect(v.state).toBe('failed');
    expect(v.note).toContain('NoCageForLegacy');
    expect(v.at).toBe('2026-08-17T09:30:00.000Z');
    expect(v.consecutive).toBe(1);
  });

  it('la regla que falla en TODOS sus disparos cuenta la racha entera', () => {
    const v = summarizeRuns([
      run('error', 'council_compose_failed: NoCageForLegacy'),
      run('error', 'council_compose_failed: NoCageForLegacy'),
      run('error', 'council_proposal_failed (NOT_A_COUNCIL): …'),
      run('proposal_created', 'trigger fired — proposal p1 in the council inbox'),
    ]);
    expect(v.state).toBe('failed');
    expect(v.consecutive).toBe(3);
  });

  it('scheduled_payment_invalid también es fallo (misma familia, otra pata)', () => {
    const v = summarizeRuns([run('error', 'scheduled_payment_invalid: invalid destination')]);
    expect(v.state).toBe('failed');
    expect(v.note).toContain('scheduled_payment_invalid');
  });

  it('un error VIEJO bajo un disparo bueno NO ensucia el estado actual', () => {
    const v = summarizeRuns([run('proposal_created', 'proposal p9 in the inbox'), run('error', 'old failure')]);
    expect(v.state).toBe('ok');
  });

  it('«consejo ocupado» (status triggered) NO es un fallo — el motor lo reintenta tras el cooldown', () => {
    const v = summarizeRuns([run('triggered', 'trigger fired — council busy (one live proposal per account)')]);
    expect(v.state).toBe('ok');
  });

  it('nota ausente → null explícito (jamás se inventa un motivo)', () => {
    const v = summarizeRuns([run('error', null)]);
    expect(v.state).toBe('failed');
    expect(v.note).toBeNull();
  });
});

describe('MoneyFlowsPanel — el cable de G4 (sin esto el reducer no sirve de nada)', () => {
  it('el reductor sale del MÓDULO COMPARTIDO, no de una cuarta copia local', () => {
    expect(src).toMatch(/from '\.\.\/\.\.\/lib\/rules\/runHealth'/);
    expect(src).not.toMatch(/function summarizeRuns\(/);
  });

  it('lee de verdad GET /rules/:id/runs (el endpoint existía y esta superficie no lo llamaba)', () => {
    expect(src).toMatch(/rulesApi\.runs\(/);
    expect(src).toMatch(/loadRunHealth\(/);
  });

  it('pinta la NOTA del run, no solo el estado (el board EVM tiraba las notas)', () => {
    expect(src).toMatch(/run\.note/);
    expect(src).toMatch(/run\.at/);
  });

  it('si la lectura falla lo DICE — nunca se confunde "no lo sé" con "va bien"', () => {
    expect(src).toMatch(/state === 'unreadable'/);
    expect(src).toMatch(/Could not read this rule’s run history/);
  });

  // G4-pildoras (ronda 3): `isFailing` es falso para `unread` y `unreadable`,
  // así que ambos caían en el brazo VERDE — en las DOS tarjetas.
  it('ninguna de las dos tarjetas puede ponerse verde sobre un veredicto sin leer', () => {
    // The exact shape of the old lie, in both cards — it must be gone:
    expect(src).not.toMatch(/tone=\{anyEnabled \? 'success' : 'neutral'\}/);
    expect(src).not.toMatch(/tone=\{r\.enabled \? 'success' : 'neutral'\}/);
    expect(src).not.toMatch(/tone=\{!anyEnabled \? 'neutral' : anyFailing \? 'danger' : 'success'\}/);
    expect(src).not.toMatch(/tone=\{!r\.enabled \? 'neutral' : failing \? 'danger' : 'success'\}/);
    // El flow agrupa N reglas: lo peor que sepamos manda, y «todavía no lo sé»
    // gana a «active».
    expect(src).toContain(
      'const pill = worstPillState(f.rules.map((r) => rulePillState(r.enabled, lastRuns[r.id])));',
    );
    expect(src).toContain('const pill = rulePillState(r.enabled, lastRun);');
    expect(src.match(/<Pill tone=\{RULE_PILL_TONE\[pill\]\}>/g) ?? []).toHaveLength(2);
    expect(src).toContain("t('failing')");
    // Y el COMPORTAMIENTO que ese cable transporta, ejecutado de verdad
    // (la red completa del veredicto vive en lib/rules/__tests__/runHealth.test.ts):
    expect(RULE_PILL_TONE[rulePillState(true, undefined)]).not.toBe('success');
    expect(RULE_PILL_TONE[rulePillState(true, { state: 'unreadable', detail: 'HTTP 500' })]).not.toBe('success');
    expect(RULE_PILL_TONE[rulePillState(true, { state: 'ok' })]).toBe('success');
    expect(RULE_PILL_TONE[worstPillState(['active', 'unread'])]).not.toBe('success');
  });

  it('una lectura por montaje/refresco: nada de polling agresivo', () => {
    expect(src).not.toMatch(/setInterval/);
  });

  // G4-strategies (residuo de la ronda 1): `setLastRuns({})` al empezar CADA
  // refresco devolvía toda regla a `unread` durante el viaje de ida y vuelta —
  // una regla que YA sabíamos fallando volvía un instante a la píldora verde
  // «active». Ese borrado no puede volver.
  it('un refresco NO borra los veredictos ya leídos (la regla fallida no parpadea a verde)', () => {
    expect(src).not.toMatch(/setLastRuns\(\{\}\);\n\s*void loadRuns/);
    expect(src).toMatch(/setLastRuns\(\(prev\) => retainKnownRuns\(prev, ruleIds\)\)/);
  });
});
