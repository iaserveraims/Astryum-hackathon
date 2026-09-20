import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { join } from 'node:path';
import { composeKindOf, staleLockBlocks, type StaleOrderFate } from '../../../lib/xrpl/singleSignVerdict';

/**
 * G12 (auditorí) — «cuatro acciones del cage sin puerta».
 *
 * `move`, `propose-venue`, `retire-venue` and `set-max-venue-bps` were built
 * end to end — `VAULT_COUNCIL_ABI` (moveToVenue / proposeVenue / retireVenue /
 * setMaxVenueBps), the zod enum of `POST /council-order/prepare`, and the
 * callables on LegacyVault — and `ACTION_FORMS` never listed them. The council
 * could not add or retire a venue from the product at all: the cage's venue set
 * was frozen at whatever it was deployed with, in silence.
 */

const COMPONENT = join(__dirname, '..', 'CouncilOrderCard.tsx');
const src = readFileSync(COMPONENT, 'utf8');

interface ActionForm {
  action: string;
  label: string;
  fields: Array<{ id: string; label: string; kind: string }>;
  notice?: string;
}

/** Slice a balanced literal out of the source, from `open` to its match. */
function balancedSlice(from: number, open: '{' | '['): string {
  const close = open === '{' ? '}' : ']';
  const start = src.indexOf(open, from);
  expect(start, 'the literal must start somewhere').toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === open) depth += 1;
    else if (src[i] === close) {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${open} in CouncilOrderCard.tsx`);
}

function loadActionForms(): ActionForm[] {
  const DECL = 'const ACTION_FORMS: ActionForm[] = [';
  const at = src.indexOf(DECL);
  expect(at, `${DECL} must exist — update this test if the catalog moved`).toBeGreaterThan(-1);
  const literal = balancedSlice(at + DECL.length - 1, '[');
  // eslint-disable-next-line no-new-func
  return new Function(`return ${literal};`)() as ActionForm[];
}

function loadVenueOrderIssue(): (action: string, params: Record<string, unknown>) => string | null {
  const SIGNATURE =
    'function venueOrderIssue(action: string, params: Record<string, unknown>): string | null {';
  const at = src.indexOf(SIGNATURE);
  expect(at, `venueOrderIssue signature changed — update this test`).toBeGreaterThan(-1);
  const body = balancedSlice(at + SIGNATURE.length - 1, '{');
  // eslint-disable-next-line no-new-func
  return new Function(`function venueOrderIssue(action, params) ${body}; return venueOrderIssue;`)();
}

const forms = loadActionForms();
const venueOrderIssue = loadVenueOrderIssue();
const byAction = (a: string) => forms.find((f) => f.action === a);

describe('G12 — las cuatro acciones del cage tienen puerta', () => {
  it('the catalog offers the four actions the backend already accepted', () => {
    for (const action of ['move', 'propose-venue', 'retire-venue', 'set-max-venue-bps']) {
      expect(byAction(action), `${action} must have a door in ACTION_FORMS`).toBeTruthy();
    }
  });

  it('every field id matches the params the backend encoder reads', () => {
    // XrplCouncilOrderService.ACTIONS: moveToVenue(fromId,toId,amount),
    // proposeVenue(target,kind), retireVenue(venueId), setMaxVenueBps(bps).
    expect(byAction('move')!.fields.map((f) => f.id)).toEqual(['fromId', 'toId', 'amount']);
    expect(byAction('propose-venue')!.fields.map((f) => f.id)).toEqual(['target', 'kind']);
    expect(byAction('retire-venue')!.fields.map((f) => f.id)).toEqual(['venueId']);
    expect(byAction('set-max-venue-bps')!.fields.map((f) => f.id)).toEqual(['bps']);
  });

  it('the actions already on screen are untouched', () => {
    for (const action of [
      'direct-to',
      'recall',
      'evacuate',
      'set-linaje-fee-bps',
      'set-payees',
      'cede',
      'end-cession',
      'set-constitution-ref',
    ]) {
      expect(byAction(action), `${action} must keep its door`).toBeTruthy();
    }
    // direct-to stays the default of the selector (ACTION_FORMS[0]).
    expect(forms[0].action).toBe('direct-to');
  });
});

describe('G12 — el tempo real se dice en la superficie, no se inventa', () => {
  it('propose-venue states the 30-day delay before anything is composed', () => {
    expect(byAction('propose-venue')!.notice).toMatch(/30 days/);
    expect(byAction('propose-venue')!.label).toMatch(/30 days/);
  });

  it('retire-venue never claims a wait it does not have (retireVenue is immediate)', () => {
    const notice = byAction('retire-venue')!.notice ?? '';
    expect(notice).toMatch(/immediately/);
    // The contract delays proposeVenue ONLY. Promising 30 days here would be a
    // figure nobody read from the ledger.
    expect(notice).not.toMatch(/wait 30 days|after 30 days|in 30 days/);
    expect(notice).toMatch(/never liquidates/);
  });

  it('the notice is rendered in the form, not only in the backend summary', () => {
    expect(src).toMatch(/\{form\.notice && <InlineNotice tone="warning">\{t\(form\.notice\)\}<\/InlineNotice>\}/);
  });
});

describe('G12 — el guard que el backend NO tiene', () => {
  it('a move onto the same venue is refused before the quorum signs', () => {
    expect(venueOrderIssue('move', { fromId: 1, toId: 1, amount: '10' })).toMatch(/same venue/);
    expect(venueOrderIssue('move', { fromId: 0, toId: 1, amount: '10' })).toBeNull();
  });

  it('a venue target that is not a Flare address never composes', () => {
    expect(venueOrderIssue('propose-venue', { target: 'kinetic', kind: 0 })).toMatch(/0x/);
    expect(venueOrderIssue('propose-venue', { target: '0x1234', kind: 0 })).toMatch(/0x/);
    expect(
      venueOrderIssue('propose-venue', { target: `0x${'a'.repeat(40)}`, kind: 1 }),
    ).toBeNull();
  });

  it('the venue kind is one of the contract enum ordinals, never free text', () => {
    const target = `0x${'b'.repeat(40)}`;
    // The REACHABLE case (G12-move): nothing chosen in the select. See the
    // reachability suite below — before that fix this expectation described a
    // path no user could take.
    expect(venueOrderIssue('propose-venue', { target, kind: undefined })).toMatch(/venue kind/);
    expect(venueOrderIssue('propose-venue', { target, kind: 0 })).toBeNull();
    expect(venueOrderIssue('propose-venue', { target, kind: 1 })).toBeNull();
  });

  it('the entry cap respects the vault bounds (MIN_VENUE_CAP_BPS 1000 … BPS 10000)', () => {
    expect(venueOrderIssue('set-max-venue-bps', { bps: 500 })).toMatch(/1000 and 10000/);
    expect(venueOrderIssue('set-max-venue-bps', { bps: 10_001 })).toMatch(/1000 and 10000/);
    expect(venueOrderIssue('set-max-venue-bps', { bps: Number.NaN })).toMatch(/1000 and 10000/);
    expect(venueOrderIssue('set-max-venue-bps', { bps: 1000 })).toBeNull();
    expect(venueOrderIssue('set-max-venue-bps', { bps: 10_000 })).toBeNull();
  });

  it('it says nothing about the orders it cannot judge', () => {
    // No vault read happens on this side: direct-to/recall/retire-venue are
    // judged by the SERVER pre-flight (councilOrderPreflight), which is the only
    // one that can read the cage. This guard must never pretend to be a second
    // authority nor guess at state it does not have.
    expect(venueOrderIssue('direct-to', { venueId: 99, amount: '1' })).toBeNull();
    expect(venueOrderIssue('retire-venue', { venueId: 99 })).toBeNull();
  });
});

/**
 * G12-move (ronda 2) — el guard muerto.
 *
 * The `kind` branch of `venueOrderIssue` was UNREACHABLE: `prepare()` walked
 * the fields and threw the generic «Fill every field of the order first.» on
 * the select's `value=""` before the guard ever ran, and the select can only
 * emit '0' or '1', so `params.kind` was always 0 or 1 by the time the guard saw
 * it. Its sentence — the one that names WHY the vault refuses an ordinal it
 * does not know — could never render.
 */
describe('G12-move — el guard del venue kind es alcanzable', () => {
  it('an empty venueKind falls through to the guard instead of the generic message', () => {
    // The one field whose empty value is NOT answered by "Fill every field".
    expect(src).toMatch(/if \(f\.kind === 'venueKind'\) continue;/);
  });

  it('an empty venueKind is never coerced to an ordinal (Number("") === 0 === ERC-4626)', () => {
    // The coercion must stay BELOW the empty check, so it can only ever run on
    // a value the person actually chose.
    const emptyCheck = src.indexOf("if (f.kind === 'venueKind') continue;");
    const coercion = src.indexOf("f.kind === 'venueId' || f.kind === 'bps' || f.kind === 'venueKind'");
    expect(emptyCheck).toBeGreaterThan(-1);
    expect(coercion).toBeGreaterThan(emptyCheck);
  });

  it('the guard names the two kinds the vault knows, so the sentence is actionable', () => {
    const msg = venueOrderIssue('propose-venue', { target: `0x${'c'.repeat(40)}` });
    expect(msg).toMatch(/ERC-4626/);
    expect(msg).toMatch(/Compound V2/);
  });

  it('the guard runs on the composed params, inside prepare()', () => {
    expect(src).toMatch(/const venueIssue = venueOrderIssue\(form\.action, params\);/);
    expect(src).toMatch(/if \(venueIssue\) throw new Error\(t\(venueIssue\)\);/);
  });
});

describe('G12 — el ordinal del enum se envía como número y se elige, no se teclea', () => {
  it('venueKind is coerced to a Number like venueId/bps', () => {
    expect(src).toMatch(/f\.kind === 'venueId' \|\| f\.kind === 'bps' \|\| f\.kind === 'venueKind'/);
  });

  it('the kind field is a closed list built from the contract enum', () => {
    expect(src).toMatch(/const VENUE_KINDS: Array<\{ value: string; label: string \}> = \[/);
    expect(src).toMatch(/\{ value: '0', label: 'ERC-4626 vault' \}/);
    expect(src).toMatch(/\{ value: '1', label: 'Compound V2 market' \}/);
    expect(src).toMatch(/f\.kind === 'venueKind' \? \(/);
    // No preselected ordinal: the empty option is the default.
    expect(src).toMatch(/<option value="" className="bg-surface-2">/);
  });

  it('the kind field declares that kind in the catalog', () => {
    const kindField = byAction('propose-venue')!.fields.find((f) => f.id === 'kind');
    expect(kindField?.kind).toBe('venueKind');
  });
});

/**
 * G12-final — prepare() se EJECUTA, no se lee.
 *
 * Until this suite, the reachability of every guard in this file was proved by
 * grep: `expect(src).toMatch(...)`. That is exactly the hole that let the bug
 * below ship — the guard existed, the source matched, and the path that reaches
 * it composed the wrong order anyway.
 */
// Prepare takes the explicit «compose another order anyway» confirm of a
// 409 COUNCIL_ORDER_IN_FLIGHT (never passed by the plain «Compose the order»).
const PREPARE_PARAMS = '(opts?: { confirmAnotherOrder?: boolean })';
const PREPARE_DECL = `const prepare = useCallback(async ${PREPARE_PARAMS} => {`;

function loadPrepareSource(): string {
  const at = src.indexOf(PREPARE_DECL);
  expect(at, 'prepare() moved or changed signature — update this test').toBeGreaterThan(-1);
  const body = balancedSlice(at + PREPARE_DECL.length - 1, '{');
  // The body is TypeScript (`const params: Record<string, unknown>`), so it is
  // compiled, never pattern-stripped: a new annotation must not silently skip
  // half of this suite.
  return ts.transpileModule(`async function prepareBody${PREPARE_PARAMS} ` + body, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;
}
const PREPARE_JS = loadPrepareSource();

interface PrepareRun {
  /** What the card would show. null = it composed. */
  error: string | null;
  /** The body handed to POST /council-order/prepare, or null if nothing was sent. */
  sent: Record<string, unknown> | null;
  /** The same body AFTER the JSON round trip the network performs. */
  wire: Record<string, unknown> | null;
  stages: string[];
}

async function runPrepare(o: {
  action: string;
  values?: Record<string, string>;
  payeeRows?: Array<{ account: string; pct: string }>;
  capitalizeAll?: boolean;
  /** The card is paused after a stale order that may already have gone out. */
  staleLocked?: boolean;
  /** The person's explicit «compose it again anyway». */
  confirmAnotherOrder?: boolean;
}): Promise<PrepareRun> {
  const form = byAction(o.action);
  expect(form, `${o.action} must have a door`).toBeTruthy();
  const out: PrepareRun = { error: null, sent: null, wire: null, stages: [] };
  const deps: Record<string, unknown> = {
    form,
    values: o.values ?? {},
    payeeRows: o.payeeRows ?? [{ account: '', pct: '' }],
    capitalizeAll: o.capitalizeAll ?? false,
    t: (k: string) => k,
    setError: (m: string | null) => {
      out.error = m;
    },
    setStage: (st: string) => {
      out.stages.push(st);
    },
    setHandoff: () => undefined,
    setInFlight: () => undefined,
    // The card is PAUSED while a stale order of this council may already
    // be on its way (R2 2.3). The lock is asked WHAT is being
    // composed — the real `staleLockBlocks`, not a stub of it — so an EXIT is
    // warned and never stopped, and «compose it again anyway» composes.
    staleLocked: o.staleLocked === true && composeKindOf(o.action) === 'other',
    staleLock: {
      blocks: (kind: 'exit' | 'other', opts?: { confirmed?: boolean }) =>
        staleLockBlocks(o.staleLocked === true ? ({ kind: 'already-out' } as StaleOrderFate) : null, kind, opts),
    },
    composeKindOf,
    // The door now also answers DUPLICATE_CHECK_UNREADABLE —
    // «we could not check whether it went out», which is our read failing and
    // carries its own retry plus the server's explicit «compose another anyway».
    mayConfirmAnotherOrder: (b: { error?: string } | null | undefined) =>
      !!b &&
      (b.error === 'SAME_ORDER_RECENTLY_LAUNCHED' ||
        b.error === 'COUNCIL_ORDER_IN_FLIGHT' ||
        b.error === 'DUPLICATE_CHECK_UNREADABLE'),
    sameOrderMinutesAgo: () => null,
    venueOrderIssue,
    xrplLegacy: {
      councilOrderPrepare: async (body: Record<string, unknown>) => {
        out.sent = body;
        return { order: {}, xrplTx: {} };
      },
    },
    account: 'rCouncilAccount',
    getUserRegion: () => null,
    // The real one maps ORDER_WOULD_REVERT → detail; for a locally thrown guard
    // both return the message, which is what these cases exercise.
    orderError: (e: unknown) => (e as Error).message,
  };
  const names = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  const prepareBody = new Function(...names, `${PREPARE_JS}; return prepareBody;`)(
    ...names.map((n) => deps[n]),
  );
  await prepareBody(o.confirmAnotherOrder ? { confirmAnotherOrder: true } : undefined);
  out.wire = out.sent ? JSON.parse(JSON.stringify(out.sent)) : null;
  return out;
}

describe('G12-final — un venue id mal tecleado no compone el venue #0', () => {
  it('the silent chain this guard breaks is real, end to end', () => {
    // Not a claim about our code — the three coercions that turned "x" into
    // venue #0. If any of them ever stops holding, the guard can be revisited.
    expect(Number('x')).toBeNaN();
    expect(JSON.parse(JSON.stringify({ venueId: Number('x') })).venueId).toBeNull();
    expect(Number(null)).toBe(0); // what councilOrderPreflight / NUM() then read
  });

  it('an evacuate with a mistyped venue is refused before anything is sent', async () => {
    const r = await runPrepare({ action: 'evacuate', values: { venueId: 'x' } });
    expect(r.sent, 'nothing may reach the wire').toBeNull();
    expect(r.error).toMatch(/whole number/);
    expect(r.error).toMatch(/Venue #/); // the field is named, not just scolded
    expect(r.stages).toEqual(['review', 'form']); // and the card returns to the form
  });

  it.each(['x', '1.5', '-1', '1e3', '0x2', '3 4', '#3'])(
    'refuses the ordinal %s instead of coercing it',
    async (raw) => {
      const r = await runPrepare({ action: 'retire-venue', values: { venueId: raw } });
      expect(r.sent).toBeNull();
      expect(r.error).toMatch(/whole number/);
    },
  );

  it('a mistyped move ordinal never composes a move off venue #0', async () => {
    const r = await runPrepare({
      action: 'move',
      values: { fromId: 'zero', toId: '2', amount: '1000' },
    });
    expect(r.sent).toBeNull();
    expect(r.error).toMatch(/whole number/);
  });

  it('the bps setters are ordinals too — a decimal cap is refused as typed', async () => {
    const r = await runPrepare({ action: 'set-max-venue-bps', values: { bps: '2.5' } });
    expect(r.sent).toBeNull();
    expect(r.error).toMatch(/whole number/);
  });

  it('a well-typed order still composes, and reaches the wire as integers', async () => {
    const r = await runPrepare({
      action: 'move',
      values: { fromId: '1', toId: '2', amount: '1000' },
    });
    expect(r.error).toBeNull();
    expect(r.wire).toMatchObject({ action: 'move', account: 'rCouncilAccount' });
    // The JSON that actually leaves the browser: integers, and no null anywhere.
    expect((r.wire as unknown as { params: unknown }).params).toEqual({
      fromId: 1,
      toId: 2,
      amount: '1000',
    });
  });

  it('leading zeros are a typo, not a refusal (the vault reads 007 as 7)', async () => {
    const r = await runPrepare({ action: 'retire-venue', values: { venueId: '007' } });
    expect(r.error).toBeNull();
    expect((r.wire as unknown as { params: { venueId: number } }).params.venueId).toBe(7);
  });
});

describe('G12-final — las ramas que antes solo probaba el grep, ejecutadas', () => {
  it('the venue kind branch is reachable from prepare(), not only from the guard', async () => {
    // The address filled, the select untouched: the param stays ABSENT and the
    // kind sentence is what the council reads.
    const r = await runPrepare({
      action: 'propose-venue',
      values: { target: `0x${'a'.repeat(40)}` },
    });
    expect(r.sent).toBeNull();
    expect(r.error).toMatch(/venue kind/);
    expect(r.error).toMatch(/ERC-4626/);
  });

  it('an unanswered select never composes kind 0 (ERC-4626) by coercion', async () => {
    const r = await runPrepare({
      action: 'propose-venue',
      values: { target: `0x${'b'.repeat(40)}`, kind: '' },
    });
    expect(r.sent).toBeNull();
  });

  it('a chosen kind composes the ordinal the contract enum declares', async () => {
    const r = await runPrepare({
      action: 'propose-venue',
      values: { target: `0x${'c'.repeat(40)}`, kind: '1' },
    });
    expect(r.error).toBeNull();
    expect((r.wire as unknown as { params: unknown }).params).toEqual({
      target: `0x${'c'.repeat(40)}`,
      kind: 1,
    });
  });

  it('the same-venue move is refused inside prepare(), not only by the guard alone', async () => {
    const r = await runPrepare({
      action: 'move',
      values: { fromId: '2', toId: '2', amount: '1' },
    });
    expect(r.sent).toBeNull();
    expect(r.error).toMatch(/same venue/);
  });

  it('an empty text field still gets the generic sentence', async () => {
    const r = await runPrepare({ action: 'propose-venue', values: { kind: '0' } });
    expect(r.sent).toBeNull();
    expect(r.error).toMatch(/Fill every field/);
  });
});

/**
 * EL PADRE TAMBIÉN SE PARA.
 *
 * La tarjeta de firma decía «otra petición de esta misma orden ya salió» y esta
 * tarjeta seguía componiendo otra en cuanto la anterior desaparecía: el mismo
 * capital, movido dos veces, un nivel más arriba. `prepare()` se ejecuta aquí de
 * verdad — el botón deshabilitado no basta como prueba, porque `prepare` también
 * se llama desde el confirm del 409.
 */
describe('prepare() se niega mientras el candado del stale está puesto', () => {
  it('con el candado puesto una ENTRADA no llega al wire, ni siquiera perfectamente válida', async () => {
    const ok = await runPrepare({ action: 'direct-to', values: { venueId: '0', amount: '1' } });
    expect(ok.sent, 'sin candado esta orden sí compone').not.toBeNull();

    const locked = await runPrepare({ action: 'direct-to', values: { venueId: '0', amount: '1' }, staleLocked: true });
    expect(locked.sent).toBeNull();
    // Y no se pinta un error: la nota del candado ya explica la pausa y ofrece
    // la única salida («I checked — compose a new order»).
    expect(locked.error).toBeNull();
    expect(locked.stages).toEqual([]);
  });

  /**
   * LA REGRESIÓN QUE ESTE MISMO TEST FIJABA.
   *
   * La versión anterior comprobaba que un `recall` con el candado puesto NO
   * componía. Eso es exactamente el fallo: un recall saca capital, y una salida
   * se avisa, jamás se para — ni por un registro, ni por la BD, ni por una
   * región, ni por una pantalla nuestra. Ahora se exige lo contrario.
   */
  it('una SALIDA compone con el candado puesto: se avisa, no se para', async () => {
    const recall = await runPrepare({ action: 'recall', values: { venueId: '0', amount: '1' }, staleLocked: true });
    expect(recall.sent, 'un recall es una salida: compone igual').not.toBeNull();
    expect(recall.error).toBeNull();

    const evacuate = await runPrepare({ action: 'evacuate', values: { venueId: '0' }, staleLocked: true });
    expect(evacuate.sent, 'evacuar un venue también saca capital').not.toBeNull();
  });

  it('«Compose it again anyway» compone la entrada que el candado paraba (R5 5.5)', async () => {
    const confirmed = await runPrepare({
      action: 'direct-to',
      values: { venueId: '0', amount: '1' },
      staleLocked: true,
      confirmAnotherOrder: true,
    });
    expect(confirmed.sent, 'la confirmación explícita es la comprobación de la persona').not.toBeNull();
    expect(confirmed.sent).toMatchObject({ confirmAnotherOrder: true });
  });
});
