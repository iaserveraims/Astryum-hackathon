import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { multisignPrepareRefusal, xamanTypeRefused } from '../CouncilMultisigFlow';
import { describeServerRefusal } from '@/lib/errors/serverRefusal';

/**
 * detail-ceremonia — the same-sitting ceremony is the surface where the seat
 * guard's 422 lands, and it is mounted by FOUR call sites (LegacyPanel,
 * CouncilOrderCard, CouncilVaultEntry, CageBirthCard). One component, four
 * families: the refusal has to read as prose in all of them.
 *
 * Two things are pinned here, and BOTH were broken before this change:
 *  1. the ceremony's catch blocks go through the ONE server-refusal reader, so
 *     `PRIOR_SEAT_UNRESOLVED` reaches the screen as the server's sentence,
 *  2. humanising that copy does not disarm the Xaman 1217 dead-end guard —
 *     which used to match the strings ON SCREEN and now matches the raw ones.
 *
 * The wiring itself (which state the render reads) is checked by evaluating the
 * shipped source's own expressions, never by asserting on substrings of it.
 */

const SOURCE = readFileSync(join(__dirname, '..', 'CouncilMultisigFlow.tsx'), 'utf8');
const t = (s: string) => s;

/** Exactly what `jpost` throws (services/v1Api). */
function jpostError(status: number, body: unknown): Error {
  const b = body as { error?: string } | null;
  return Object.assign(new Error(b?.error ?? `http_${status}`), { status, body });
}

const SEAT_GUARD_DETAIL =
  'A previous proposal on this account (Monthly payment to the school) is not settled: ' +
  'the account Sequence has moved past the one this proposal pinned. ' +
  'Composing another one now is exactly how a council pays twice. Open it in the proposal inbox, ' +
  'check the account on an explorer, and either register the transaction hash it produced (any member can) ' +
  'or file it — then compose.';

const seatGuard422 = () =>
  jpostError(422, {
    error: 'PRIOR_SEAT_UNRESOLVED',
    detail: SEAT_GUARD_DETAIL,
    proposalId: 'cprop_1',
    ledgerCheck: { verdict: 'seat_spent' },
  });

describe('CouncilMultisigFlow — the 422 that stops a double payment', () => {
  it('renders the server prose that the ceremony used to swallow', () => {
    const shown = describeServerRefusal(seatGuard422(), t).text;
    expect(shown).toBe(SEAT_GUARD_DETAIL);
    expect(shown).not.toBe('PRIOR_SEAT_UNRESOLVED');
  });

  it('keeps a human reserve if the server ever drops the detail', () => {
    const shown = describeServerRefusal(jpostError(422, { error: 'PRIOR_SEAT_UNRESOLVED' }), t).text;
    expect(shown).toMatch(/pays twice/);
    expect(shown).not.toMatch(/PRIOR_SEAT_UNRESOLVED/);
  });
});

/**
 * productizer it.14 (R3 3.1 / 3.3) — UNA SALIDA NO SE CIERRA POR LA REGIÓN.
 *
 * `/multisign/prepare` está geofenced por defecto y una SALIDA la abre con su
 * pase (`exitToken`) o con la clasificación del servidor. Cuando ninguna de las
 * dos funcionaba, la negativa llegaba como 451 y el lector genérico decía «DeFi
 * execution is not available for your region»: falso sobre una salida, y manda a
 * la familia a Ajustes a arreglar algo que no está roto.
 */
describe('multisignPrepareRefusal — lo que NO es la región', () => {
  it('503 EXIT_CLASSIFICATION_UNREADABLE: no se pudo leer, que no es «no es una salida»', () => {
    const shown = multisignPrepareRefusal(jpostError(503, { error: 'EXIT_CLASSIFICATION_UNREADABLE' }), t);
    expect(shown?.text).toMatch(/could not read/i);
    expect(shown?.text).not.toMatch(/region/i);
    expect(shown?.text).toMatch(/nothing was signed|never closed/i);
  });

  it('un handoff que ya no es firmable se dice como tal, no como una puerta cerrada por región', () => {
    const shown = multisignPrepareRefusal(jpostError(409, { error: 'GEOFENCE_BLOCKED', exitClassification: 'handoff-not-queued' }), t);
    expect(shown?.text).toMatch(/no longer waiting to be signed/i);
    expect(shown?.text).not.toMatch(/region/i);
  });

  it('un pase caducado (15 min) o minteado para otros bytes dice qué hacer', () => {
    expect(multisignPrepareRefusal(jpostError(451, { error: 'GEOFENCE_BLOCKED', exitTokenRejected: 'expired' }), t)?.text).toMatch(/15 minutes/);
    expect(multisignPrepareRefusal(jpostError(451, { error: 'GEOFENCE_BLOCKED', exitTokenRejected: 'other-tx' }), t)?.text).toMatch(/not for these exact bytes/i);
  });

  it('una clasificación que no encontró la salida no culpa a la región tampoco', () => {
    const shown = multisignPrepareRefusal(jpostError(451, { error: 'GEOFENCE_BLOCKED', exitClassification: 'unknown-memo' }), t);
    expect(shown?.text).toMatch(/could not match this transaction to an exit/i);
    expect(shown?.text).not.toMatch(/region/i);
  });

  it('una ENTRADA desde una región cerrada sigue siendo lo que era: cae al lector de siempre', () => {
    expect(multisignPrepareRefusal(jpostError(451, { error: 'GEOFENCE_BLOCKED', exitClassification: 'not-an-exit' }), t)).toBeNull();
    expect(multisignPrepareRefusal(jpostError(451, { error: 'GEOFENCE_BLOCKED' }), t)).toBeNull();
    // Y el 422 del asiento previo tampoco se toca: su prosa ya era la buena.
    expect(multisignPrepareRefusal(seatGuard422(), t)).toBeNull();
  });

  it('la prosa del servidor no se pierde: viaja entre paréntesis', () => {
    const shown = multisignPrepareRefusal(
      jpostError(503, { error: 'EXIT_CLASSIFICATION_UNREADABLE', detail: 'the store timed out after 5 s' }),
      t,
    );
    expect(shown?.text).toContain('the store timed out after 5 s');
  });
});

describe('CouncilMultisigFlow — the Xaman dead-end guard still guards', () => {
  const XAMAN_1217 =
    'Xaman does not allow this app to create SignerListSet sign requests. ' +
    'Account-security transaction types are granted per app by Xaman support (in-app). ' +
    'Meanwhile the quorum can sign this transaction with its own multisign tool.';

  it('fires on the raw Xaman refusal, wherever it lands', () => {
    const r = describeServerRefusal(new Error(XAMAN_1217), t);
    expect(xamanTypeRefused([r.raw])).toBe(true);
    expect(xamanTypeRefused([undefined, undefined, r.raw])).toBe(true);
  });

  it('does not fire on an unrelated refusal', () => {
    const r = describeServerRefusal(seatGuard422(), t);
    expect(xamanTypeRefused([r.raw])).toBe(false);
    expect(xamanTypeRefused([undefined, undefined])).toBe(false);
    expect(xamanTypeRefused([])).toBe(false);
  });

  it('would have been disarmed by a TRANSLATED sentence — which is why it reads raw', () => {
    // Simulate the dictionary doing its job on a hypothetical humanised copy.
    const translated = 'Xaman no permite a esta app crear solicitudes de firma de este tipo.';
    expect(xamanTypeRefused([translated])).toBe(false);
    // The raw text, carried alongside, keeps the way out visible.
    expect(xamanTypeRefused([describeServerRefusal(new Error(XAMAN_1217), () => translated).raw])).toBe(true);
  });

  it('the render feeds the guard with raw text, not with the visible sentence', () => {
    const call = SOURCE.match(/xamanTypeRefused\(\[[^\]]*\]\)/)?.[0];
    expect(call, 'the guard must be called from the render').toBeTruthy();
    // Evaluate the ARGUMENT of the shipped call against a state where the
    // visible copy is humanised and only the raw text carries the 1217 marker.
    // Reading `error.text` / `m.error` here yields false — the regression.
    const argSrc = call!.slice('xamanTypeRefused('.length, -1);
    const state = {
      error: { text: 'Something went wrong.', raw: XAMAN_1217 },
      members: [{ error: 'Something went wrong.', errorRaw: XAMAN_1217 }],
    };
    const evaluate = new Function('error', 'members', `return ${argSrc};`) as (
      error: unknown,
      members: unknown,
    ) => (string | undefined)[];
    expect(xamanTypeRefused(evaluate(state.error, state.members))).toBe(true);
  });
});
