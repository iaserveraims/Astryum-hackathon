import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RULE_PILL_TONE, rulePillState } from '@/lib/rules/runHealth';

/**
 * G4-strategies (auditorí §G4) — la página dedicada a las
 * automatizaciones era la que más mentía.
 */

const SECTION = join(__dirname, '..', 'StrategySection.tsx');
const src = readFileSync(SECTION, 'utf8');

const PAGE = join(__dirname, '..', '..', '..', 'app', 'app', 'strategies', 'page.tsx');
const page = readFileSync(PAGE, 'utf8');

describe('StrategySection · el cable de G4-strategies', () => {
  it('usa el reductor COMPARTIDO, no una cuarta copia local', () => {
    expect(src).toMatch(/from '\.\.\/\.\.\/lib\/rules\/runHealth'/);
    expect(src).not.toMatch(/function summarizeRuns\(/);
  });

  it('lee de verdad GET /rules/:id/runs (antes solo llamaba a rulesApi.list)', () => {
    expect(src).toMatch(/rulesApi\.runs\(/);
    expect(src).toMatch(/loadRunHealth\(/);
  });

  // G4-pildoras (ronda 3): el ternario local dejaba `unread` y `unreadable` en
  // el brazo VERDE, así que el primer pintado —y cualquier timeout de /runs—
  // decía «active» sobre una salud que nadie había leído.
  it('la píldora ya no puede ponerse verde sobre un veredicto sin leer', () => {
    // Las dos formas viejas de la mentira — ninguna puede volver:
    expect(src).not.toContain(
      "<Pill tone={r.enabled ? 'success' : 'neutral'}>{r.enabled ? t('active') : t('paused')}</Pill>",
    );
    expect(src).not.toContain("const failing = r.enabled && isFailing(health);");
    expect(src).toContain('const pill = rulePillState(r.enabled, health);');
    expect(src).toContain('<Pill tone={RULE_PILL_TONE[pill]}>');
    expect(src).toContain("t('failing')");
    // Y el COMPORTAMIENTO que ese cable transporta, ejecutado de verdad
    // (la red completa del veredicto vive en lib/rules/__tests__/runHealth.test.ts):
    expect(RULE_PILL_TONE[rulePillState(true, undefined)]).not.toBe('success');
    expect(RULE_PILL_TONE[rulePillState(true, { state: 'unreadable', detail: 'HTTP 500' })]).not.toBe('success');
    expect(RULE_PILL_TONE[rulePillState(true, { state: 'ok' })]).toBe('success');
  });

  it('la card enseña el PORQUÉ del fallo, no solo un color', () => {
    expect(src).toContain('Its last run FAILED — this rule is armed but it produced nothing to sign.');
    expect(src).toMatch(/health\.note \?\? t\('the engine recorded no reason'\)/);
    expect(src).toMatch(/health\.consecutive > 1/);
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

  it('lee EXACTAMENTE las reglas que pinta (el predicado es uno solo, no dos que derivan)', () => {
    expect(src).toMatch(/function visibleFlows\(/);
    expect(src).toMatch(/const ruleIds = visibleFlows\(next, mode\)\.map/);
    expect(src).toMatch(/useMemo\(\(\) => visibleFlows\(allRules, mode\)/);
  });
});

/**
 * La decisión (4) del encargo, fijada donde se puede comprobar: el panel
 * embebido del tablero SIGUE oculto en /app/strategies — es el split del
 * fundador, no un descuido — y por eso las automatizaciones de esa página TIENEN
 * que salir honestas por sus propias superficies. Si alguien vuelve a poner
 * `showStrategyPanel` en true aquí, el apartado se duplica; si alguien quita
 * StrategySection, la página se queda sin superficie honesta de reglas.
 */
describe('/app/strategies · la composición que hace de este apartado LA superficie de automatizaciones', () => {
  it('El tablero sigue montado con el panel embebido oculto (split del fundador)', () => {
    expect(page).toContain('<DefiPositionsBoard autoAction={autoAction} showStrategyPanel={false} embedded />');
  });

  /**
   * El fundador esconde MoneyFlows y el pago recurrente de esta
   * pantalla («escóndela… esconde también el toggle de running saved»), y a la
   * vez le añade un botón que CREA protecciones. Eso deja exactamente el
   * agujero que este bloque existe para impedir: reglas que se pueden crear
   * aquí y ninguna superficie donde una que revienta en cada disparo lo diga.
   *
   * Por eso la aserción no se borra: se MUEVE al sitio nuevo. La página sigue
   * obligada a tener UNA superficie honesta de reglas — ahora `ProtectionsHealth`,
   * pegada al health factor — y esa superficie sigue obligada a repartir por el
   * reductor compartido en vez de por `enabled` a secas.
   */
  it('…y la página conserva UNA superficie honesta de reglas (ProtectionsHealth)', () => {
    expect(page).toMatch(/<ProtectionsHealth \/>/);
    expect(page).toMatch(/function ProtectionsHealth\(/);
    // Reparte por el reductor compartido, no por `enabled` a secas.
    expect(page).toMatch(/rulePillState\(true, health\[/);
    expect(page).toMatch(/isFailing\(health\[r\.id\] \?\? UNREAD\)/);
    // Y dice el PORQUÉ del fallo, no solo un color.
    expect(page).toContain("t('the engine recorded no reason')");
  });

  it('las superficies escondidas siguen MONTADAS en el árbol, no borradas', () => {
    // Esconder no es borrar: el día que vuelvan, vuelven enteras.
    expect(page).toMatch(/import StrategySection from/);
    expect(page).toMatch(/import ScheduledPaymentCard from/);
  });

  /**
   * La SEXTA superficie, y vive dentro de la propia página: `ActiveSavings`
   * clavaba `<Pill tone="success">{t('active')}</Pill>` y un rayo encendido en
   * TODA regla de escrow habilitada, bajo el título «Active savings», sin leer
   * jamás qué produjeron sus disparos.
   */
  it('«Active savings» ya no pinta verde toda regla habilitada sin leer sus runs', () => {
    // La forma vieja del rayo (la píldora verde se cita en el comentario del
    // arreglo, así que el rayo es el marcador inequívoco):
    expect(page).not.toContain('<Zap size={14} className="text-volt" />');
    expect(page).toMatch(/from '\.\.\/\.\.\/\.\.\/lib\/rules\/runHealth'/);
    expect(page).toMatch(/loadRunHealth\(/);
    // G4 · la SÉPTIMA superficie. Estas dos aserciones clavaban antes
    // la forma de un arreglo A MEDIAS: `isFailing` es FALSO para `unread` y
    // `unreadable`, así que el brazo verde se comía los dos ⇒ «active» en el
    // primer pintado y tras cualquier timeout de /runs — y en la MISMA fila ya
    // se imprimía el descargo ámbar de «no pudimos leer». El desmentido y la
    // mentira juntos. Ahora reparte por el mismo `rulePillState` que las otras
    // seis, y esto fija el arreglo en vez del hueco.
    expect(page).not.toMatch(/tone=\{failing \? 'danger' : 'success'\}/);
    expect(page).toContain('const pill = rulePillState(rule.enabled !== false, health);');
    expect(page).toContain('<Pill tone={RULE_PILL_TONE[pill]}>');
    // Y el COMPORTAMIENTO que ese cable transporta, ejecutado de verdad:
    // ninguna salud sin leer puede salir verde.
    expect(RULE_PILL_TONE[rulePillState(true, undefined)]).not.toBe('success');
    expect(RULE_PILL_TONE[rulePillState(true, { state: 'unread' })]).not.toBe('success');
    expect(RULE_PILL_TONE[rulePillState(true, { state: 'unreadable', detail: 'HTTP 500' })]).not.toBe('success');
    // El literal va COMPLETO: `failed` lleva su cuándo, su porqué y su racha.
    // Sin ellos el tipo no casa y tsc lo cantaba — y lo que se comprueba aquí
    // (que un último disparo fallido pinta danger) no cambia ni un ápice.
    expect(
      RULE_PILL_TONE[
        rulePillState(true, { state: 'failed', at: '2026-08-20T00:00:00.000Z', note: null, consecutive: 1 })
      ],
    ).toBe('danger');
    expect(RULE_PILL_TONE[rulePillState(true, { state: 'ok' })]).toBe('success');
    expect(page).toContain('Its last run FAILED — this rule is armed but it produced nothing to sign.');
    expect(page).toContain('Could not read this rule’s run history');
  });

  it('el veredicto viaja de verdad del hook a la card (emisor Y consumidor, no una tubería muerta)', () => {
    expect(page).toMatch(/return \{ escrows, rules, runHealth, refresh \};/);
    expect(page).toMatch(/runHealth: savingsRunHealth/);
    expect(page).toMatch(/runHealth=\{savingsRunHealth\}/);
  });

  it('un refresco NO borra los veredictos ya leídos', () => {
    expect(page).toMatch(/setRunHealth\(\(prev\) => retainKnownRuns\(prev, ruleIds\)\)/);
  });
});
