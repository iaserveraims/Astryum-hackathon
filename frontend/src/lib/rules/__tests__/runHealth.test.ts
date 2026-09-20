import { describe, it, expect } from 'vitest';

import {
  RULE_PILL_TONE,
  UNREAD,
  isFailing,
  loadRunHealth,
  loadRunReadings,
  retainKnownRuns,
  rulePillState,
  summarizeReading,
  summarizeRuns as reduceRuns,
  toRuns,
  unreadableReading,
  worstPillState,
  type RuleRun,
  type RunHealth,
} from '../runHealth';

/**
 * G4-strategies (auditorí §G4) — la fuente ÚNICA del veredicto.
 *
 * El reductor vivía TRIPLICADO literalmente (LegacyActivityFeed,
 * DefiPositionsBoard, MoneyFlowsPanel) y las tres copias solo se probaban
 * raspando el texto del componente con `new Function` — una técnica que no
 * podía cubrir ni el cargador ni el «qué se conserva mientras la lectura viaja».
 * Aquí se prueba el módulo de verdad, importado, incluidas las dos piezas que
 * antes no tenían red: `loadRunHealth` (una lectura que revienta se DICE, no
 * desaparece) y `retainKnownRuns` (un refresco no devuelve a verde una regla
 * que ya sabíamos fallando).
 */

const run = (
  status: string,
  notes: string | null = null,
  triggeredAt = '2026-08-17T10:00:00.000Z',
): RuleRun => ({ triggeredAt, status, notes });

/** Same widening the surface suites use: `at`/`note`/`consecutive` only exist
 *  on the `failed` arm, and narrowing in every case would bury the assertion. */
type Verdict = { state: string; at?: string; note?: string | null; consecutive?: number };
const summarizeRuns = (runs: RuleRun[]): Verdict => reduceRuns(runs);

describe('summarizeRuns — el veredicto sale de los runs LEÍDOS, jamás del silencio', () => {
  it('sin runs → "never" (nunca disparó; no es un fallo y no es salud)', () => {
    expect(summarizeRuns([])).toEqual({ state: 'never' });
  });

  it('último run en error → "failed" con SU nota y SU fecha', () => {
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
      run('error', 'scheduled_payment_invalid: invalid destination'),
      run('error', 'council_proposal_failed (NOT_A_COUNCIL): …'),
      run('proposal_created', 'trigger fired — proposal p1 in the council inbox'),
    ]);
    expect(v.state).toBe('failed');
    expect(v.consecutive).toBe(3);
  });

  it('un error VIEJO bajo un disparo bueno NO ensucia el estado actual', () => {
    expect(summarizeRuns([run('proposal_created', 'p9'), run('error', 'old failure')]).state).toBe('ok');
  });

  it('«consejo ocupado» (status triggered) NO es fallo — el motor reintenta tras el cooldown', () => {
    expect(summarizeRuns([run('triggered', 'council busy (one live proposal per account)')]).state).toBe('ok');
  });

  it('nota ausente → null explícito (jamás se inventa un motivo)', () => {
    const v = summarizeRuns([run('error', null)]);
    expect(v.state).toBe('failed');
    expect(v.note).toBeNull();
  });
});

describe('isFailing — la única pregunta que una píldora debe hacerse antes de ponerse verde', () => {
  it('solo `failed` es fallo; `unread` y `unreadable` NO son salud, pero tampoco fallo', () => {
    expect(isFailing({ state: 'failed', at: 'x', note: null, consecutive: 1 })).toBe(true);
    expect(isFailing({ state: 'ok' })).toBe(false);
    expect(isFailing({ state: 'never' })).toBe(false);
    expect(isFailing({ state: 'unreadable', detail: 'HTTP 500' })).toBe(false);
    expect(isFailing(UNREAD)).toBe(false);
    expect(isFailing(undefined)).toBe(false);
  });
});

describe('toRuns — filas del API a filas del reductor, sin inventar nada', () => {
  it('una respuesta que no es lista → lista vacía (no revienta la superficie)', () => {
    expect(toRuns(undefined)).toEqual([]);
    expect(toRuns(null)).toEqual([]);
    expect(toRuns({ nope: 1 })).toEqual([]);
  });

  it('`notes` ausente o no-string → null, JAMÁS un motivo inventado', () => {
    expect(toRuns([{ triggeredAt: 'a', status: 'error' }])[0].notes).toBeNull();
    expect(toRuns([{ triggeredAt: 'a', status: 'error', notes: 42 }])[0].notes).toBeNull();
  });
});

describe('loadRunHealth — «no pude leer» NO es «nunca disparó» y NO es «va bien»', () => {
  it('una lectura que revienta deja `unreadable` CON su motivo, no un hueco', async () => {
    const out = await loadRunHealth(['r1'], async () => {
      throw new Error('HTTP 502');
    });
    expect(out.r1).toEqual({ state: 'unreadable', detail: 'HTTP 502' });
  });

  it('TODA regla preguntada recibe entrada: un hueco se lee como «sana» y ese era el bug', async () => {
    const out = await loadRunHealth(['ok', 'broken', 'unreadable'], async (id) => {
      if (id === 'unreadable') throw new Error('boom');
      if (id === 'broken') return { runs: [{ triggeredAt: 't', status: 'error', notes: 'why' }] };
      return { runs: [{ triggeredAt: 't', status: 'intent_prepared', notes: null }] };
    });
    expect(Object.keys(out).sort()).toEqual(['broken', 'ok', 'unreadable']);
    expect(out.ok.state).toBe('ok');
    expect(out.broken.state).toBe('failed');
    expect(out.unreadable.state).toBe('unreadable');
  });

  it('una respuesta sin `runs` es «never» (leída y vacía), NO «unreadable»', async () => {
    const out = await loadRunHealth(['r1'], async () => ({}));
    expect(out.r1).toEqual({ state: 'never' });
  });

  it('sin ids no pregunta nada', async () => {
    let calls = 0;
    const out = await loadRunHealth([], async () => {
      calls += 1;
      return { runs: [] };
    });
    expect(out).toEqual({});
    expect(calls).toBe(0);
  });
});

/**
 * REUSE (auditoria) - la sexta superficie entra en casa.
 *
 * `DefiPositionsBoard` era la unica de las seis que seguia leyendo
 * GET /rules/:id/runs por su cuenta (`fetch` + sus propios headers), con la
 * excusa de que ademas necesita `count` / `lastAt` / `lastStatus` para la linea
 * de historia bajo el nombre de la regla. En vez de dejar fuera el ultimo
 * lector privado, el modulo compartido aprendio esos tres datos:
 * `loadRunReadings` es `loadRunHealth` CON los contadores, y `loadRunHealth`
 * pasa a ser su proyeccion - una sola definicion de "no pude leer" para las
 * seis. Esto es lo que fija que las dos salidas no puedan discrepar.
 */
describe('loadRunReadings - el mismo veredicto que loadRunHealth, con los contadores', () => {
  it('summarizeReading conserva `notes`, la fecha y el estado del ULTIMO run', () => {
    const r = summarizeReading({
      count: 9,
      runs: [
        { triggeredAt: '2026-08-17T10:00:00.000Z', status: 'error', notes: 'council_compose_failed' },
        { triggeredAt: '2026-08-17T09:00:00.000Z', status: 'triggered', notes: null },
      ],
    });
    expect(r.count).toBe(9);
    expect(r.lastAt).toBe('2026-08-17T10:00:00.000Z');
    expect(r.lastStatus).toBe('error');
    expect(r.verdict).toEqual({
      state: 'failed',
      at: '2026-08-17T10:00:00.000Z',
      note: 'council_compose_failed',
      consecutive: 1,
    });
  });

  it('sin `count` en la respuesta, el contador sale de las filas LEIDAS, nunca de un supuesto', () => {
    expect(summarizeReading({ runs: [{ triggeredAt: 't', status: 'triggered' }] }).count).toBe(1);
    expect(summarizeReading({}).count).toBe(0);
    expect(summarizeReading(undefined)).toEqual({
      count: 0,
      lastAt: undefined,
      lastStatus: undefined,
      verdict: { state: 'never' },
    });
  });

  it('una lectura rota deja contadores a CERO y el veredicto `unreadable` con su motivo', async () => {
    const out = await loadRunReadings(['r1'], async () => {
      throw new Error('http_502');
    });
    expect(out.r1).toEqual(unreadableReading('http_502'));
    expect(out.r1.count).toBe(0);
    expect(out.r1.verdict).toEqual({ state: 'unreadable', detail: 'http_502' });
  });

  it('TODA regla preguntada recibe entrada, tambien la que revento (un hueco se lee como sana)', async () => {
    const read = async (id: string) => {
      if (id === 'broken') throw new Error('boom');
      if (id === 'failing') return { count: 2, runs: [{ triggeredAt: 't', status: 'error', notes: 'why' }] };
      return { count: 1, runs: [{ triggeredAt: 't', status: 'intent_prepared', notes: null }] };
    };
    const out = await loadRunReadings(['ok', 'failing', 'broken'], read);
    expect(Object.keys(out).sort()).toEqual(['broken', 'failing', 'ok']);
    expect(out.broken.verdict.state).toBe('unreadable');
    expect(out.failing.verdict.state).toBe('failed');
    expect(out.ok.verdict.state).toBe('ok');
  });

  it('loadRunHealth es EXACTAMENTE la proyeccion de loadRunReadings: las dos salidas no pueden discrepar', async () => {
    const read = async (id: string) => {
      if (id === 'broken') throw new Error('boom');
      if (id === 'failing') return { count: 2, runs: [{ triggeredAt: 't', status: 'expired', notes: 'gave up' }] };
      if (id === 'never') return { count: 0, runs: [] };
      return { count: 1, runs: [{ triggeredAt: 't', status: 'user_acted', notes: null }] };
    };
    const ids = ['ok', 'failing', 'broken', 'never'];
    const health = await loadRunHealth(ids, read);
    const readings = await loadRunReadings(ids, read);
    expect(Object.keys(health).sort()).toEqual(Object.keys(readings).sort());
    for (const id of ids) expect(health[id]).toEqual(readings[id].verdict);
  });

  it('sin ids no pregunta nada (ni una peticion por una card sin reglas)', async () => {
    let calls = 0;
    const out = await loadRunReadings([], async () => {
      calls += 1;
      return { runs: [] };
    });
    expect(out).toEqual({});
    expect(calls).toBe(0);
  });

  it('lee las N reglas EN PARALELO: la card con varias no paga la suma de sus round-trips', async () => {
    let live = 0;
    let peak = 0;
    const read = async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
      return { count: 0, runs: [] };
    };
    await loadRunReadings(['a', 'b', 'c'], read);
    expect(peak).toBe(3);
  });
});

describe('retainKnownRuns — un refresco no devuelve a verde lo que ya sabíamos roto', () => {
  const failed: RunHealth = { state: 'failed', at: '2026-08-17T10:00:00.000Z', note: 'why', consecutive: 3 };

  it('conserva el veredicto de las reglas que siguen en la lista', () => {
    expect(retainKnownRuns({ a: failed, b: { state: 'ok' } }, ['a', 'b'])).toEqual({
      a: failed,
      b: { state: 'ok' },
    });
  });

  it('suelta las reglas que ya no están (una regla borrada no deja veredicto colgando)', () => {
    expect(retainKnownRuns({ a: failed, gone: { state: 'ok' } }, ['a'])).toEqual({ a: failed });
  });

  it('una regla nueva no recibe veredicto inventado: sin entrada = `unread`', () => {
    const kept = retainKnownRuns({ a: failed }, ['a', 'brandNew']);
    expect(kept.brandNew).toBeUndefined();
  });

  it('lo que sustituye a `setLastRuns({})`: el borrado devolvía una regla FALLIDA a verde', () => {
    // The round-1 shape, spelled out: wiping the map means the surface reads
    // `unread` for a rule it already knew was failing, and `unread` renders as
    // the previous (green) wording for the whole round-trip.
    const wiped: Record<string, RunHealth> = {};
    expect(wiped.a).toBeUndefined();
    expect(isFailing(wiped.a)).toBe(false);
    // …whereas retaining keeps the fact until a fresher one lands.
    expect(isFailing(retainKnownRuns({ a: failed }, ['a']).a)).toBe(true);
  });
});

/**
 * G4-pildoras (ronda 3, del veredicto de G3-tormenta) — el run de CIERRE.
 *
 * G3 enseñó al motor a cerrar una ocurrencia abandonada con un run propio
 * (`AutomationEngine.announceExpiredOccurrence` → `status: 'expired'`, el motivo
 * en `notes`) cuando la ocurrencia cruza la ventana de 36 h y NO se reintenta.
 * Ese run entra a la CABEZA de GET /rules/:id/runs. El reductor contestaba
 * `!== 'error'` → `ok`, así que la regla se ponía VERDE en el instante exacto en
 * que el motor se rendía con ella: el aviso era invisible y además inverso.
 */
describe('summarizeRuns · `expired` — el motor se rindió con la ocurrencia; eso no es salud', () => {
  it('un run `expired` a la cabeza es FALLO, con su motivo y su fecha', () => {
    const v = summarizeRuns([
      run(
        'expired',
        'The 2026-08-01T09:00:00.000Z occurrence of "Rent" never produced anything to sign and has left the 36h catch-up window',
        '2026-08-18T09:00:00.000Z',
      ),
    ]);
    expect(v.state).toBe('failed');
    expect(v.at).toBe('2026-08-18T09:00:00.000Z');
    expect(v.note).toContain('catch-up window');
    expect(v.consecutive).toBe(1);
  });

  it('la racha mezcla `error` y `expired`: son la misma cosa — no produjo nada que firmar', () => {
    const v = summarizeRuns([
      run('expired', 'abandoned'),
      run('error', 'council_compose_failed'),
      run('expired', 'abandoned'),
      run('proposal_created', 'p1'),
    ]);
    expect(v.state).toBe('failed');
    expect(v.consecutive).toBe(3);
  });

  it('un `expired` VIEJO bajo un disparo bueno no ensucia el estado actual', () => {
    expect(summarizeRuns([run('proposal_created', 'p9'), run('expired', 'abandoned')]).state).toBe('ok');
  });

  it('la píldora de una regla abandonada NO puede quedar verde', () => {
    const health = reduceRuns([run('expired', 'abandoned')]);
    expect(rulePillState(true, health)).toBe('failing');
    expect(RULE_PILL_TONE[rulePillState(true, health)]).toBe('danger');
  });
});

/**
 * G4-pildoras (ronda 3) — el tono de la píldora sale del veredicto LEÍDO.
 *
 * Las seis superficies escribían a mano
 * `tone={!enabled ? 'neutral': failing ? 'danger': 'success'}` con
 * `failing = isFailing(health)`. `isFailing` solo es cierto para `failed`, así
 * que `unread` y `unreadable` caían en el brazo VERDE: el primer pintado decía
 * «active» antes de leer un solo run, y un timeout de /runs devolvía a verde una
 * regla que ya sabíamos FALLANDO. Doctrina: «no pude leer» no es «va
 * bien».
 */
describe('rulePillState — el verde EXIGE una historia de runs leída', () => {
  const failed: RunHealth = { state: 'failed', at: '2026-08-18T10:00:00.000Z', note: 'why', consecutive: 2 };

  it('sin entrada (primer pintado) → `unread`, y su tono NO es success', () => {
    expect(rulePillState(true, undefined)).toBe('unread');
    expect(RULE_PILL_TONE.unread).not.toBe('success');
    expect(RULE_PILL_TONE.unread).toBe('neutral');
  });

  it('UNREAD explícito → `unread` (mismo trato que el hueco)', () => {
    expect(rulePillState(true, UNREAD)).toBe('unread');
  });

  it('la lectura reventó → `unreadable` en ámbar: es un hecho sobre NOSOTROS, no un veredicto', () => {
    expect(rulePillState(true, { state: 'unreadable', detail: 'HTTP 500' })).toBe('unreadable');
    expect(RULE_PILL_TONE.unreadable).toBe('warning');
  });

  it('ni el hueco ni la lectura rota pueden pintar lo mismo que una regla sana', () => {
    expect(RULE_PILL_TONE[rulePillState(true, failed)]).toBe('danger');
    expect(RULE_PILL_TONE[rulePillState(true, undefined)]).not.toBe('success');
    expect(RULE_PILL_TONE[rulePillState(true, { state: 'unreadable', detail: 'HTTP 500' })]).not.toBe('success');
  });

  it('leída y sana → verde; leída y sin disparos → verde (armada, y es cierto)', () => {
    expect(RULE_PILL_TONE[rulePillState(true, { state: 'ok' })]).toBe('success');
    expect(RULE_PILL_TONE[rulePillState(true, { state: 'never' })]).toBe('success');
  });

  it('pausada manda sobre todo lo demás: no reclama nada sobre su salud', () => {
    expect(rulePillState(false, failed)).toBe('paused');
    expect(rulePillState(false, { state: 'ok' })).toBe('paused');
    expect(RULE_PILL_TONE.paused).toBe('neutral');
  });

  it('SOLO estos cinco estados existen, y solo UNO de ellos es verde', () => {
    const greens = (['paused', 'failing', 'unreadable', 'unread', 'active'] as const).filter(
      (k) => RULE_PILL_TONE[k] === 'success',
    );
    expect(greens).toEqual(['active']);
  });
});

describe('worstPillState — una tarjeta que habla por VARIAS reglas no redondea a verde', () => {
  it('una sola fallando tiñe la tarjeta entera', () => {
    expect(worstPillState(['active', 'active', 'failing'])).toBe('failing');
  });

  it('«todavía no lo sé» gana a «active»: un flow con una regla sin leer no es verde', () => {
    expect(worstPillState(['active', 'unread'])).toBe('unread');
    expect(RULE_PILL_TONE[worstPillState(['active', 'unread'])]).not.toBe('success');
  });

  it('una lectura rota gana a una sin leer, y el fallo gana a todo', () => {
    expect(worstPillState(['unread', 'unreadable'])).toBe('unreadable');
    expect(worstPillState(['unreadable', 'failing'])).toBe('failing');
  });

  it('pausada + activa = activa (una regla viva basta para que el flow lo esté)', () => {
    expect(worstPillState(['paused', 'active'])).toBe('active');
  });

  it('todas pausadas → pausada; sin reglas no reclama nada', () => {
    expect(worstPillState(['paused', 'paused'])).toBe('paused');
    expect(worstPillState([])).toBe('paused');
  });
});
