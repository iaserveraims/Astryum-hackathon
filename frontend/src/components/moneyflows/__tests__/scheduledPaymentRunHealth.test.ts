import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RULE_PILL_TONE, rulePillState } from '@/lib/rules/runHealth';

/**
 * G4-strategies (auditoría 2026-08-17 §G4) — la domiciliación que juraba estar
 * en pie.
 *
 * `ScheduledPaymentCard` es la superficie de pagos recurrentes de /app/strategies
 * (y del carril personal). Decidía el estado de la regla con `r.enabled` a secas
 * — `<Pill tone={r.enabled ? 'success' : 'neutral'}>` — y una regla
 * `scheduledPayment` cuyo tick NO puede validar el pago se guarda como
 * `status: 'error'` con `scheduled_payment_invalid: …` en `notes`, sin
 * incrementar `totalTimesTriggered` y sin push (guarda del «éxito no ganado»).
 * Resultado: verde «active» sobre una domiciliación que en su última fecha no
 * preparó NADA que firmar — el único fallo que una domiciliación no puede tener.
 *
 * Fuente-nivel por la misma razón que el resto de la familia: vitest corre en
 * `environment: 'node'` y tsconfig deja `jsx: "preserve"`.
 */

const CARD = join(__dirname, '..', 'ScheduledPaymentCard.tsx');
const src = readFileSync(CARD, 'utf8');

describe('ScheduledPaymentCard · el cable de G4-strategies', () => {
  it('usa el reductor COMPARTIDO, no otra copia local', () => {
    expect(src).toMatch(/from '\.\.\/\.\.\/lib\/rules\/runHealth'/);
    expect(src).not.toMatch(/function summarizeRuns\(/);
  });

  it('lee de verdad GET /rules/:id/runs (antes solo llamaba a rulesApi.list)', () => {
    expect(src).toMatch(/rulesApi\.runs\(/);
    expect(src).toMatch(/loadRunHealth\(/);
  });

  // G4-pildoras (ronda 3): el ternario local dejaba `unread` y `unreadable` en
  // el brazo VERDE — el primer pintado y cualquier timeout de /runs decían
  // «active» sobre una salud que nadie había leído.
  it('la píldora ya no puede ponerse verde sobre un veredicto sin leer', () => {
    expect(src).not.toContain(
      "<Pill tone={r.enabled ? 'success' : 'neutral'}>{r.enabled ? t('active') : t('paused')}</Pill>",
    );
    expect(src).not.toMatch(/tone=\{!r\.enabled \? 'neutral' : failing \? 'danger' : 'success'\}/);
    expect(src).toContain('const pill = rulePillState(r.enabled, health);');
    expect(src).toContain('<Pill tone={RULE_PILL_TONE[pill]}>');
    expect(src).toContain("t('failing')");
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
    expect(src).toMatch(/<RunHealthNote health=\{health\} enabled=\{r\.enabled\} t=\{t\} \/>/);
  });

  it('si la lectura falla lo DICE — «no lo sé» nunca se pinta como «va bien»', () => {
    expect(src).toMatch(/state === 'unreadable'/);
    expect(src).toContain('Could not read this rule’s run history');
  });

  it('una lectura por montaje/refresco: nada de polling agresivo', () => {
    expect(src).not.toMatch(/setInterval/);
  });

  it('un refresco NO borra los veredictos ya leídos (la regla fallida no parpadea a verde)', () => {
    expect(src).toMatch(/setRunHealth\(\(prev\) => retainKnownRuns\(prev, ruleIds\)\)/);
  });
});
