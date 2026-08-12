/**
 * Sentinel — el vigía de los vigías.
 *
 * Lo que fijan estos tests es la propiedad que hace que un canal de alertas se
 * siga leyendo a los tres meses: se avisa en los CAMBIOS (aparece, empeora,
 * mejora, se resuelve) y se recuerda lo que sigue roto con cadencia, nunca en
 * cada pasada. Y que el texto que sale es accionable: objeto + arreglo.
 */

const sent: Array<{ source: string; level: string; message: string; opts?: Record<string, unknown> }> = [];

jest.mock('../../OpsAlertService', () => ({
  opsAlert: jest.fn(async (source: string, level: string, message: string, opts?: Record<string, unknown>) => {
    sent.push({ source, level, message, opts });
  }),
  alertChannels: () => [{ name: 'webhook', armed: false, minLevel: 'info' }],
}));

import { Sentinel, decideAlert, decorateMessage, humanAge, repeatConfigFromEnv } from '../SentinelService';
import type { Probe, ProbeFinding } from '../sentinelTypes';

const CFG = { criticalMs: 60 * 60_000, warnMs: 6 * 3_600_000, infoMs: Number.POSITIVE_INFINITY };
const T0 = 1_700_000_000_000;

beforeEach(() => {
  sent.length = 0;
});

describe('decideAlert — la máquina de estados del aviso', () => {
  it('avisa la primera vez que aparece un problema', () => {
    expect(decideAlert(null, 'warn', T0, CFG)).toBe('new');
  });

  it('calla mientras el problema sigue igual dentro de la ventana', () => {
    expect(decideAlert({ level: 'warn', lastAlertMs: T0 }, 'warn', T0 + 60_000, CFG)).toBeNull();
  });

  it('recuerda un crítico pasada su ventana (1 h) y un warn en la suya (6 h)', () => {
    expect(decideAlert({ level: 'critical', lastAlertMs: T0 }, 'critical', T0 + 61 * 60_000, CFG)).toBe('repeat');
    expect(decideAlert({ level: 'warn', lastAlertMs: T0 }, 'warn', T0 + 61 * 60_000, CFG)).toBeNull();
    expect(decideAlert({ level: 'warn', lastAlertMs: T0 }, 'warn', T0 + 7 * 3_600_000, CFG)).toBe('repeat');
  });

  it('avisa al empeorar y al mejorar sin cerrarse', () => {
    expect(decideAlert({ level: 'warn', lastAlertMs: T0 }, 'critical', T0 + 1000, CFG)).toBe('escalated');
    expect(decideAlert({ level: 'critical', lastAlertMs: T0 }, 'warn', T0 + 1000, CFG)).toBe('eased');
  });

  it('anuncia la resolución de lo que era incidencia — pero no la de un info', () => {
    expect(decideAlert({ level: 'critical', lastAlertMs: T0 }, 'ok', T0 + 1000, CFG)).toBe('recovered');
    expect(decideAlert({ level: 'info', lastAlertMs: T0 }, 'ok', T0 + 1000, CFG)).toBeNull();
    expect(decideAlert(null, 'ok', T0, CFG)).toBeNull();
  });

  it('lee las ventanas del entorno', () => {
    process.env.OPS_SENTINEL_REPEAT_CRITICAL_MIN = '15';
    expect(repeatConfigFromEnv().criticalMs).toBe(15 * 60_000);
    delete process.env.OPS_SENTINEL_REPEAT_CRITICAL_MIN;
    expect(repeatConfigFromEnv().criticalMs).toBe(60 * 60_000);
  });
});

describe('texto para humanos', () => {
  it('cuenta la edad como la contaría una persona', () => {
    expect(humanAge(45_000)).toBe('0 min');
    expect(humanAge(47 * 60_000)).toBe('47 min');
    expect(humanAge(125 * 60_000)).toBe('2 h 5 min');
    expect(humanAge(27 * 3_600_000)).toBe('1 d 3 h');
  });

  it('dice en el propio mensaje qué tipo de cambio es', () => {
    expect(decorateMessage('new', 'la tx X está pillada', 0)).toBe('la tx X está pillada');
    expect(decorateMessage('repeat', 'la tx X está pillada', 3 * 3_600_000)).toContain('SIGUE SIN RESOLVERSE (3 h)');
    expect(decorateMessage('recovered', 'la tx X está pillada', 60_000)).toContain('RESUELTO tras 1 min');
  });
});

/** Un probe de mentira cuyo veredicto se cambia desde el test. */
function fakeProbe(state: { findings: ProbeFinding[] }): Probe {
  return {
    id: 'falso',
    title: 'Probe de prueba',
    run: async () => state.findings,
  };
}

describe('pasada completa', () => {
  it('avisa una vez, calla mientras dure y anuncia la resolución', async () => {
    const state = {
      findings: [
        {
          key: '7BFC',
          level: 'critical' as const,
          message: 'la tx 7BFC… lleva 47 min pillada en el executor',
          runbook: '/app/admin → Sistema → Desatascar',
          facts: { hash: '7BFC', xrp: 12.5 },
        },
      ],
    };
    const sentinel = new Sentinel([fakeProbe(state)]);

    await sentinel.runPass();
    expect(sent).toHaveLength(1);
    expect(sent[0].source).toBe('sentinel/falso');
    expect(sent[0].level).toBe('critical');
    expect(sent[0].message).toContain('7BFC');
    // El arreglo viaja con el aviso: eso es lo que lo hace accionable.
    expect(sent[0].opts?.runbook).toContain('Desatascar');
    expect((sent[0].opts?.facts as Record<string, unknown>).hash).toBe('7BFC');

    // Segunda pasada con el mismo problema: silencio (la ventana no ha pasado).
    await sentinel.runPass();
    expect(sent).toHaveLength(1);

    const snap = sentinel.snapshot();
    expect(snap.counts.critical).toBe(1);
    expect(snap.issues[0].id).toBe('falso#7BFC');
    expect(snap.issues[0].runbook).toContain('Desatascar');

    // Se resuelve → un único aviso de cierre, en info.
    state.findings = [];
    await sentinel.runPass();
    expect(sent).toHaveLength(2);
    expect(sent[1].level).toBe('info');
    expect(sent[1].message).toContain('RESUELTO');
    expect(sentinel.snapshot().counts.critical).toBe(0);
  });

  it('escala el aviso cuando el mismo objeto empeora', async () => {
    const state = {
      findings: [{ key: 'x', level: 'warn' as const, message: 'saldo bajo' }],
    };
    const sentinel = new Sentinel([fakeProbe(state)]);
    await sentinel.runPass();
    state.findings = [{ key: 'x', level: 'critical' as const, message: 'saldo bajo' }];
    await sentinel.runPass();
    expect(sent.map((s) => s.level)).toEqual(['warn', 'critical']);
    expect(sent[1].message).toContain('EMPEORA');
  });

  it('un probe que revienta es una incidencia, no un verde', async () => {
    const roto: Probe = {
      id: 'roto',
      title: 'Probe roto',
      run: async () => {
        throw new Error('boom');
      },
    };
    const sentinel = new Sentinel([roto]);
    const snap = await sentinel.runPass();
    expect(sent).toHaveLength(1);
    expect(sent[0].level).toBe('warn');
    expect(sent[0].message).toContain('boom');
    expect(snap.probes[0].level).toBe('warn');
  });

  it('un carril apagado se marca como no comprobado, no como sano', async () => {
    const apagado: Probe = {
      id: 'apagado',
      title: 'Carril apagado',
      applies: () => false,
      run: async () => ({ level: 'critical', message: 'no debería ejecutarse' }),
    };
    const sentinel = new Sentinel([apagado]);
    const snap = await sentinel.runPass();
    expect(sent).toHaveLength(0);
    expect(snap.probes[0].skipped).toBe(true);
  });

  it('agrupa por objeto: dos txs pilladas son dos avisos independientes', async () => {
    const state = {
      findings: [
        { key: 'AAA', level: 'warn' as const, message: 'tx AAA pillada' },
        { key: 'BBB', level: 'warn' as const, message: 'tx BBB pillada' },
      ],
    };
    const sentinel = new Sentinel([fakeProbe(state)]);
    await sentinel.runPass();
    expect(sent).toHaveLength(2);

    // Una se arregla; la otra sigue. Solo se cierra la que se arregló.
    state.findings = [{ key: 'BBB', level: 'warn' as const, message: 'tx BBB pillada' }];
    await sentinel.runPass();
    expect(sent).toHaveLength(3);
    expect(sent[2].message).toContain('RESUELTO');
    expect(sent[2].message).toContain('AAA');
    expect(sentinel.snapshot().issues.map((i) => i.id)).toEqual(['falso#BBB']);
  });
});
