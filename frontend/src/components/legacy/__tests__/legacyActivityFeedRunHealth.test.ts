import { describe, it, expect } from 'vitest';

import { summarizeRuns as reduceRuns, type RuleRun } from '@/lib/rules/runHealth';
import { buildFeedEntries, errText, seatUnresolvedOf } from '../LegacyActivityFeed';
import type { AutomationRule, CouncilProposalRecord, XrplEscrowRow } from '@/services/v1Api';

/**
 * G4-residuos / G4-pildoras — el «watching» que no vigila y el «active» que ya
 * no puede firmarse, en la superficie donde viven.
 *
 * `LegacyActivityFeed` decidía el estado de una regla gobernada mirando SOLO su
 * fila (`enabled` + `expiresAt`) y el de una propuesta mirando SOLO su status.
 * Ronda 1 le enseñó a leer GET /rules/:id/runs; ronda 3 cierra los dos huecos
 * que quedaron:
 *
 *  1. `unread` y `unreadable` caían en el brazo VERDE de la píldora, así que el
 *     primer pintado —y cualquier timeout de /runs— decía «active» sobre una
 *     salud que nadie había leído.
 *  2. una propuesta cuyo asiento fijado el ledger da por GASTADO (o que no
 *     pudimos leer) seguía pintándose verde, con «0 days left», el subtítulo
 *     «ready to emit» y un botón «Go to the inbox to sign» que lleva a una
 *     bandeja donde esa fila ya no ofrece firma. Y su «Withdraw» llamaba al
 *     endpoint sin el acuse que el servidor exige, así que el consejo recibía el
 *     código crudo `LEDGER_CHECK_UNACKNOWLEDGED` de un botón que funcionaba.
 *
 * POR QUÉ ESTOS TESTS SON DISTINTOS A LOS DE LA RONDA 2: aquellos eran
 * `readFileSync` + regex sobre este mismo fichero. Muerden contra el texto, no
 * contra el comportamiento — y de hecho una de sus aserciones («la píldora ya
 * no es incondicional») estaba VERDE mientras la píldora pintaba en verde un
 * veredicto sin leer. La decisión vive ahora en dos funciones puras exportadas
 * (`buildFeedEntries`, `seatUnresolvedOf`) y en el lector de errores del
 * servidor (`errText`), y se ejecutan de verdad.
 */

const t = (s: string) => s;
const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const run = (status: string, notes: string | null = null, triggeredAt = '2026-08-18T10:00:00.000Z'): RuleRun => ({
  triggeredAt,
  status,
  notes,
});

function proposal(over: Partial<CouncilProposalRecord>): CouncilProposalRecord {
  return {
    id: 'p1',
    account: 'rCouncilAccount',
    title: 'Monthly rent',
    txType: 'Payment',
    txjson: {},
    quorum: 2,
    signerList: [
      { account: 'rA', weight: 1 },
      { account: 'rB', weight: 1 },
    ],
    status: 'ready',
    txHash: null,
    createdAt: iso(-9),
    expiresAt: iso(-2),
    signatures: [],
    ...over,
  } as unknown as CouncilProposalRecord;
}

function rule(over: Partial<AutomationRule>): AutomationRule {
  return {
    id: 'r1',
    name: 'Council rent order',
    enabled: true,
    trigger: { type: 'TIME_TRIGGER' },
    action: { kind: 'councilPayment' },
    totalTimesTriggered: 0,
    createdAt: iso(-30),
    expiresAt: iso(60),
    ...over,
  } as unknown as AutomationRule;
}

const CONSUMED = {
  state: 'consumed' as const,
  deadlinePassed: true as const,
  pinnedSequence: 41,
  accountSequence: 43,
  checkedAt: iso(0),
  detail: 'The account is at Sequence 43; this proposal pinned 41.',
};
const UNVERIFIED = {
  state: 'unverified' as const,
  deadlinePassed: true as const,
  pinnedSequence: 41,
  reason: 'rpc_timeout',
  checkedAt: iso(0),
  detail: 'We could not reach the XRP Ledger to read Sequence 41.',
};

const build = (over: {
  proposals?: CouncilProposalRecord[];
  rules?: AutomationRule[];
  commitments?: XrplEscrowRow[];
  lastRuns?: Parameters<typeof buildFeedEntries>[0]['lastRuns'];
}) =>
  buildFeedEntries(
    {
      proposals: over.proposals ?? [],
      rules: over.rules ?? [],
      commitments: over.commitments ?? [],
      amendments: [],
      lastRuns: over.lastRuns ?? {},
    },
    t,
  );

const only = (entries: ReturnType<typeof build>) => {
  expect(entries).toHaveLength(1);
  return entries[0];
};

/* ------------------------------------------------------------------ */
/* 1 · LA PÍLDORA DE UNA REGLA                                         */
/* ------------------------------------------------------------------ */

describe('buildFeedEntries · reglas — el verde exige una historia de runs LEÍDA', () => {
  it('sin veredicto todavía (primer pintado) NO dice «active»: dice que está mirando', () => {
    const e = only(build({ rules: [rule({})], lastRuns: {} }));
    // Antes: `active: enabled && !expired` → píldora verde «active» antes de
    // leer un solo run.
    expect(e.pillTone).not.toBe('success');
    expect(e.pillTone).toBe('neutral');
    expect(e.pillLabel).toBe('checking…');
  });

  it('la lectura de /runs reventó → ámbar y «unknown», nunca verde', () => {
    const e = only(build({ rules: [rule({})], lastRuns: { r1: { state: 'unreadable', detail: 'HTTP 500' } } }));
    expect(e.pillTone).toBe('warning');
    expect(e.pillLabel).toBe('unknown');
    expect(e.subtitle).toBe('armed — its run history could not be read');
  });

  it('leída y sana → verde «active» (el camino bueno sigue intacto)', () => {
    const e = only(build({ rules: [rule({})], lastRuns: { r1: { state: 'ok' } } }));
    expect(e.pillTone).toBe('success');
    expect(e.pillLabel).toBe('active');
    expect(e.subtitle).toBe('watching');
  });

  it('último disparo en error → rojo «failing», y el subtítulo lo dice', () => {
    const e = only(
      build({
        rules: [rule({})],
        lastRuns: { r1: reduceRuns([run('error', 'council_compose_failed: NoCageForLegacy')]) },
      }),
    );
    expect(e.pillTone).toBe('danger');
    expect(e.pillLabel).toBe('failing');
    expect(e.subtitle).toBe('its last run FAILED — it is watching nothing');
    expect(e.runHealth).toMatchObject({ state: 'failed', consecutive: 1 });
  });

  it('G3 · la ocurrencia ABANDONADA (run `expired`) pinta rojo, no verde', () => {
    // El motor cierra la ocurrencia con `status:'expired'` al cruzar las 36 h.
    // Con el reductor de ayer ese run era `ok`: la regla se ponía verde en el
    // instante exacto en que el motor se rendía con ella.
    const e = only(
      build({
        rules: [rule({})],
        lastRuns: {
          r1: reduceRuns([run('expired', 'the 2026-08-01 occurrence left the 36h catch-up window')]),
        },
      }),
    );
    expect(e.pillTone).toBe('danger');
    expect(e.pillLabel).toBe('failing');
  });

  it('pausada → neutra «paused» aunque su último disparo fallara', () => {
    const e = only(
      build({ rules: [rule({ enabled: false })], lastRuns: { r1: reduceRuns([run('error', 'boom')]) } }),
    );
    expect(e.pillTone).toBe('neutral');
    expect(e.pillLabel).toBe('paused');
    expect(e.active).toBe(false);
  });

  it('caducada → ámbar «expired» y fuera de «Active now», gane lo que gane la salud', () => {
    const e = only(build({ rules: [rule({ expiresAt: iso(-1) })], lastRuns: { r1: { state: 'ok' } } }));
    expect(e.pillTone).toBe('warning');
    expect(e.pillLabel).toBe('expired');
    expect(e.active).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 2 · EL ASIENTO SIN RESOLVER (G1-cadena)                             */
/* ------------------------------------------------------------------ */

describe('seatUnresolvedOf — el mismo corte que usa la bandeja (trayOf)', () => {
  it('viva + el ledger dice que el asiento se GASTÓ → sin resolver', () => {
    expect(seatUnresolvedOf(proposal({ status: 'ready', ledgerCheck: CONSUMED }))).toBe(true);
    expect(seatUnresolvedOf(proposal({ status: 'collecting', ledgerCheck: CONSUMED }))).toBe(true);
  });

  it('viva + no pudimos LEER el ledger → sin resolver (no es un veredicto, es un hueco)', () => {
    expect(seatUnresolvedOf(proposal({ status: 'ready', ledgerCheck: UNVERIFIED }))).toBe(true);
  });

  it('`unused` NO ensucia: el servidor ya la archivó como expired', () => {
    expect(
      seatUnresolvedOf(
        proposal({
          status: 'ready',
          ledgerCheck: { ...CONSUMED, state: 'unused' } as CouncilProposalRecord['ledgerCheck'],
        }),
      ),
    ).toBe(false);
  });

  it('dentro de su plazo (sin ledgerCheck) → resuelta, y una emitida tampoco lo está', () => {
    expect(seatUnresolvedOf(proposal({ status: 'ready' }))).toBe(false);
    expect(seatUnresolvedOf(proposal({ status: 'submitted', txHash: 'ABC', ledgerCheck: CONSUMED }))).toBe(false);
  });
});

describe('buildFeedEntries · propuestas — lo que la bandeja nueva prohibió, aquí tampoco', () => {
  it('asiento gastado: ni verde, ni «active now», ni «ready to emit»', () => {
    const e = only(build({ proposals: [proposal({ status: 'ready', ledgerCheck: CONSUMED })] }));
    // Los tres repintados exactos que denunció el veredicto de G1-cadena.
    expect(e.pillTone).toBe('warning');
    expect(e.pillTone).not.toBe('success');
    expect(e.pillLabel).toBe('unresolved');
    expect(e.subtitle).not.toBe('ready to emit');
    expect(e.subtitle).toBe('unresolved — the account already used its seat, so this MAY have executed');
    expect(e.active).toBe(false);
    expect(e.seatUnresolved).toBe(true);
  });

  it('ledger ilegible: lo dice con OTRAS palabras — «no pude leer» ≠ «se gastó»', () => {
    const e = only(build({ proposals: [proposal({ status: 'collecting', ledgerCheck: UNVERIFIED })] }));
    expect(e.pillLabel).toBe('unresolved');
    expect(e.subtitle).toBe('unresolved — we could not read the ledger, so we do not know whether it executed');
    expect(e.active).toBe(false);
  });

  it('una propuesta viva de verdad conserva su lectura verde y su subtítulo', () => {
    const e = only(build({ proposals: [proposal({ status: 'ready', expiresAt: iso(4) })] }));
    expect(e.seatUnresolved).toBe(false);
    expect(e.pillTone).toBeUndefined(); // cae en la lectura genérica: active → success
    expect(e.active).toBe(true);
    expect(e.subtitle).toBe('ready to emit');
  });

  it('el filtro «Active now» deja de contar los callejones sin salida', () => {
    const entries = build({
      proposals: [
        proposal({ id: 'live', status: 'ready', expiresAt: iso(4) }),
        proposal({ id: 'zombie', status: 'ready', ledgerCheck: CONSUMED }),
      ],
    });
    expect(entries.filter((x) => x.active).map((x) => x.proposal?.id)).toEqual(['live']);
  });

  it('emitida: historia firmada, no trabajo vivo', () => {
    const e = only(build({ proposals: [proposal({ status: 'submitted', txHash: 'DEAD' })] }));
    expect(e.signed).toBe(true);
    expect(e.active).toBe(false);
    expect(e.subtitle).toBe('emitted on-chain');
  });
});

/* ------------------------------------------------------------------ */
/* 3 · LOS ERRORES DEL SERVIDOR                                        */
/* ------------------------------------------------------------------ */

describe('errText — un código crudo no es una frase para un consejo', () => {
  it('LEDGER_CHECK_UNACKNOWLEDGED: se lee el `detail`, no el código', () => {
    // Exactamente lo que devuelve POST /council/proposals/:id/withdraw cuando
    // el asiento no está resuelto y no viene el acuse.
    const prose =
      'The account is at Sequence 43; this proposal pinned 41. Filing it as withdrawn would record that it never happened.';
    const e = Object.assign(new Error('LEDGER_CHECK_UNACKNOWLEDGED'), {
      status: 409,
      body: { error: 'LEDGER_CHECK_UNACKNOWLEDGED', detail: prose },
    });
    expect(errText(e)).toBe(prose);
    expect(errText(e)).not.toContain('LEDGER_CHECK_UNACKNOWLEDGED');
  });

  it('un `detail` en lista (zod) se junta en una sola frase', () => {
    const e = Object.assign(new Error('INVALID_BODY'), { body: { detail: ['expected boolean', 'at acknowledge'] } });
    expect(errText(e)).toBe('expected boolean; at acknowledge');
  });

  it('sin `detail` cae al mensaje, y sin nada dice algo antes que nada', () => {
    expect(errText(new Error('network down'))).toBe('network down');
    expect(errText({})).toBe('Unexpected error');
  });
});

/* ------------------------------------------------------------------ */
/* 4 · LO QUE NO DEBÍA CAMBIAR                                         */
/* ------------------------------------------------------------------ */

describe('buildFeedEntries · las demás entradas siguen leyéndose como antes', () => {
  it('un compromiso (escrow) no lleva píldora propia: cae en la lectura genérica', () => {
    const e = only(
      build({
        commitments: [
          { amount: '100', currency: 'XRP', destination: 'rDest', finishAfterISO: iso(30), previousTxnID: 'T1' } as unknown as XrplEscrowRow,
        ],
      }),
    );
    expect(e.pillTone).toBeUndefined();
    expect(e.active).toBe(true);
    expect(e.signed).toBe(true);
  });

  it('la línea de tiempo sigue ordenada de lo más reciente a lo más viejo', () => {
    const entries = build({
      rules: [rule({ id: 'old', createdAt: iso(-40) }), rule({ id: 'new', createdAt: iso(-1) })],
    });
    expect(entries.map((x) => x.rule?.id)).toEqual(['new', 'old']);
  });
});
