import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RULE_PILL_TONE, rulePillState } from '@/lib/rules/runHealth';

/**
 * G4-strategies (auditoría 2026-08-17 §G4) — el rayo verde de una regla que no
 * avisaba a nadie.
 *
 * La lista de reglas de ahorro de MovementsPanel coloreaba su rayo desde
 * `rule.enabled` a secas (`text-volt` vs `text-white/30`) y solo imprimía
 * `totalTimesTriggered`. Una regla IDLE_BALANCE / TIME_TRIGGER cuyo disparo
 * REVIENTA se guarda como `status: 'error'` con el motivo en `notes` y —por la
 * guarda del «éxito no ganado»— NO incrementa ese contador ni manda push. Así
 * que la superficie enseñaba un rayo encendido, sin avisos y sin explicación:
 * exactamente la lectura de una regla que no ha funcionado nunca, disfrazada de
 * una que simplemente aún no ha disparado.
 *
 * Fuente-nivel: vitest corre en `environment: 'node'` y tsconfig deja
 * `jsx: "preserve"`, así que importar el .tsx revienta en el transform.
 */

const PANEL = join(__dirname, '..', 'MovementsPanel.tsx');
const src = readFileSync(PANEL, 'utf8');

describe('MovementsPanel · el cable de G4-strategies (reglas de ahorro)', () => {
  it('usa el reductor COMPARTIDO, no otra copia local', () => {
    expect(src).toMatch(/from '\.\.\/\.\.\/lib\/rules\/runHealth'/);
    expect(src).not.toMatch(/function summarizeRuns\(/);
  });

  it('lee de verdad GET /rules/:id/runs (antes solo llamaba a rulesApi.list)', () => {
    expect(src).toMatch(/rulesApi\.runs\(/);
    expect(src).toMatch(/loadRunHealth\(/);
  });

  // G4-pildoras (ronda 3): el rayo volt se encendía también con `unread` y con
  // `unreadable`, así que un /runs roto reencendía como viva una regla fallida.
  it('el rayo volt exige una historia de runs leída y sana', () => {
    // Las dos formas viejas de la mentira — ninguna puede volver:
    expect(src).not.toContain("className={rule.enabled ? 'text-volt' : 'text-white/30'}");
    expect(src).not.toMatch(/!rule\.enabled \? 'text-white\/30' : failing \? 'text-tone-danger' : 'text-volt'/);
    expect(src).toContain('const pill = rulePillState(rule.enabled, health);');
    expect(src).toMatch(/pill === 'active'\s+\? 'text-volt'/);
    expect(src).toMatch(/pill === 'unreadable'\s+\? 'text-tone-warning'/);
    // Y el COMPORTAMIENTO que ese cable transporta, ejecutado de verdad
    // (la red completa del veredicto vive en lib/rules/__tests__/runHealth.test.ts):
    expect(RULE_PILL_TONE[rulePillState(true, undefined)]).not.toBe('success');
    expect(RULE_PILL_TONE[rulePillState(true, { state: 'unreadable', detail: 'HTTP 500' })]).not.toBe('success');
    expect(RULE_PILL_TONE[rulePillState(true, { state: 'ok' })]).toBe('success');
  });

  it('la fila enseña el PORQUÉ, con las MISMAS frases que las superficies hermanas', () => {
    expect(src).toContain('Its last run FAILED — this rule is armed but it produced nothing to sign.');
    expect(src).toMatch(/health\.note \?\? t\('the engine recorded no reason'\)/);
    expect(src).toMatch(/health\.consecutive > 1/);
    expect(src).toMatch(/<RuleRunHealthNote health=\{health\} enabled=\{rule\.enabled\} t=\{t\} \/>/);
  });

  it('si la lectura falla lo DICE — «no lo sé» nunca se pinta como «va bien»', () => {
    expect(src).toMatch(/state === 'unreadable'/);
    expect(src).toContain('Could not read this rule’s run history');
  });

  it('un refresco NO borra los veredictos ya leídos (la regla fallida no vuelve a encenderse en verde)', () => {
    expect(src).toMatch(/setRunHealth\(\(prev\) => retainKnownRuns\(prev, ruleIds\)\)/);
  });

  it('la lectura de runs no añade su propio temporizador (el único setInterval del panel es el tick de 30s de "releasable")', () => {
    // Un solo setInterval en todo el fichero, y es el que ya existía.
    expect(src.match(/setInterval/g)?.length).toBe(1);
    expect(src).toMatch(/setNowTick\(\(n\) => n \+ 1\), 30_000/);
  });
});
