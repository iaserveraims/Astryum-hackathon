import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CEREMONY_ORPHAN_SENTENCE,
  CEREMONY_UNCONFIRMED_BROADCAST_SENTENCE,
  broadcastMayLand,
  ceremonyExit,
  ceremonyHoldsSeat,
  ceremonyKillSet,
  ceremonyOrphanWarned,
  livePayloadUuids,
  payloadAnswered,
  releaseCeremonySeat,
  seatDoorNotice,
  seatHoldOf,
  unmountReleasesSeat,
} from '../CouncilMultisigFlow';
import { BroadcastUnconfirmedError, broadcast } from '@/lib/xrpl/councilSigning';
import { cancelPayloadAndDecide, strayStateOf } from '@/lib/xaman/payloadBus';

/**
 * consejo-superficies 1 + 2 — LAS DOS PUERTAS DEL PAGO DOBLE, EN LA CEREMONIA.
 *
 * 1. «New QR» minted a SECOND signable multisign payload for the same member
 *    and left the first alive. They are created with `expire: 1440`, so N
 *    presses left N requests signable on that phone for 24 hours, each of them
 *    producing a signature this browser would happily combine — and the surface
 *    had no Cancel at all, so leaving the screen left them all behind.
 */

const PHASES = ['idle', 'preparing', 'signing', 'submitting', 'done', 'error'] as const;
type Phase = (typeof PHASES)[number];

/** Xaman's DELETE answer, stubbed at the network edge so the REAL bus code runs. */
function stubXamanDelete(body: unknown, ok = true): void {
  global.fetch = vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('livePayloadUuids — que sigue vivo en el movil de un miembro', () => {
  const members = [
    { account: 'rWAIT', uuid: 'pay-wait', status: 'waiting' as const },
    { account: 'rSIGNED', uuid: 'pay-signed', status: 'signed' as const },
    { account: 'rREJECTED', uuid: 'pay-rejected', status: 'rejected' as const },
    { account: 'rERROR', uuid: 'pay-error', status: 'error' as const },
    { account: 'rNEW', status: 'creating' as const },
  ];

  it('only a request still WAITING is alive — that is the one a fresh QR must kill', () => {
    expect(livePayloadUuids(members)).toEqual(['pay-wait']);
  });

  it('never a signed one: Xaman ANSWERED that request, and killing it warns about a good signature', () => {
    // ALREADY_RESOLVED renders as "it may have been signed on your phone" — an
    // alarm over a signature that arrived perfectly well.
    expect(livePayloadUuids(members, 'rSIGNED')).toEqual([]);
  });

  it('never a rejected/expired one, and never a member with no payload at all', () => {
    expect(livePayloadUuids(members, 'rREJECTED')).toEqual([]);
    expect(livePayloadUuids(members, 'rERROR')).toEqual([]);
    expect(livePayloadUuids(members, 'rNEW')).toEqual([]);
  });

  it('scoped to one member for the fresh QR, unscoped for cancelling the whole ceremony', () => {
    expect(livePayloadUuids(members, 'rWAIT')).toEqual(['pay-wait']);
    const twoLive = [...members, { account: 'rWAIT2', uuid: 'pay-wait-2', status: 'waiting' as const }];
    expect(livePayloadUuids(twoLive, 'rWAIT')).toEqual(['pay-wait']);
    expect(livePayloadUuids(twoLive)).toEqual(['pay-wait', 'pay-wait-2']);
  });
});

describe('el reemplazo mata al anterior — y lo que no puede confirmar, lo dice', () => {
  it('the payload a fresh QR replaces gets a real DELETE', async () => {
    stubXamanDelete({ result: { cancelled: true } });
    const [uuid] = livePayloadUuids([{ account: 'rA', uuid: 'pay-A1', status: 'waiting' }], 'rA');
    const { cancelUi } = await cancelPayloadAndDecide(uuid, () => uuid);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/xaman/status/pay-A1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    // Confirmed dead: nothing to warn about.
    expect(strayStateOf(cancelUi)).toBeNull();
  });

  it('a Xaman that REFUSES the kill becomes a named warning, not silence', async () => {
    // THE SILENCE: before this round nothing was even asked, so this answer
    // could not exist — the request simply stayed signable for 24 more hours.
    stubXamanDelete({ result: { cancelled: false, reason: 'PAYLOAD_OPENED' } });
    const { cancelUi } = await cancelPayloadAndDecide('pay-A1', () => 'pay-A1');
    expect(strayStateOf(cancelUi)).toBe('alive');
  });

  it('an upstream that never answers is unknown — never cancelled', async () => {
    stubXamanDelete(null, false);
    const { cancelUi } = await cancelPayloadAndDecide('pay-A1', () => 'pay-A1');
    expect(strayStateOf(cancelUi)).toBe('unknown');
  });
});

describe('ceremonyHoldsSeat — mientras la ceremonia sujeta el asiento, la otra puerta no', () => {
  it('nothing is pinned before the council starts: the async door is the way in', () => {
    expect(ceremonyHoldsSeat('idle', false)).toBe(false);
    // Even a stale prep cannot reopen it: idle means the seat was handed back.
    expect(ceremonyHoldsSeat('idle', true)).toBe(false);
  });

  it('from the prepare onwards the seat is taken — this is the door that was open', () => {
    // THE REGRESSION: the async button sat right here, composing the same
    // transaction onto the same Sequence.
    expect(ceremonyHoldsSeat('preparing', false)).toBe(true);
    expect(ceremonyHoldsSeat('signing', true)).toBe(true);
    expect(ceremonyHoldsSeat('submitting', true)).toBe(true);
    expect(ceremonyHoldsSeat('done', true)).toBe(true);
  });

  it('a prepare that failed before answering pinned NOTHING: closing the last door there is a dead end', () => {
    expect(ceremonyHoldsSeat('error', false)).toBe(false);
    // But a failure AFTER the tx was pinned (a Xaman refusal, a broadcast that
    // no node took) happened over a Sequence this account is committed to.
    expect(ceremonyHoldsSeat('error', true)).toBe(true);
  });
});

describe('ceremonyExit — cerrar una puerta sin dejar salida seria la misma trampa', () => {
  it('a live sitting can always be abandoned: that is what kills the QRs', () => {
    expect(ceremonyExit('signing')).toBe('cancel');
    expect(ceremonyExit('error')).toBe('cancel');
  });

  it('never while a round trip is in flight, and never after this browser broadcast', () => {
    expect(ceremonyExit('preparing')).toBe('none');
    expect(ceremonyExit('submitting')).toBe('none');
    // 'done' means bytes left this browser: nothing here may suggest starting
    // again over a transaction that may be on the ledger.
    expect(ceremonyExit('done')).toBe('none');
    expect(ceremonyExit('idle')).toBe('none');
  });

  it('every phase that shuts the async door either offers the exit or is unanswered/broadcast', () => {
    const trapped = PHASES.filter(
      (p: Phase) => ceremonyHoldsSeat(p, true) && ceremonyExit(p) === 'none',
    );
    // arriendo-ceremonia: this list used to be the END of the test —
    // it FROZE the dead end. Those three phases are still exitless (a round trip
    // with no answer, and bytes already sent, must not offer "start again"), but
    // what they are TOLD is now checked below: the copy no longer sends the
    // family to a Cancel that is not on their screen.
    expect(trapped).toEqual(['preparing', 'submitting', 'done']);
    for (const p of trapped) expect(seatHoldOf(p, true, false)).toBe('committed');
  });

  /**
   * `error` ES DOS ESTADOS. `broadcast()` solo lanza si
   * fallan los TRES nodos, y el primero pudo aplicar el blob y perder la respuesta:
   * ese `error` es un Payment que puede estar en el ledger, y ofrecer «Cancel»
   * sobre él (que liberaba el asiento) era construir el gemelo con nuestro botón.
   * Comprometida la sesión, `error` no ofrece Cancel: ofrece el ledger.
   */
  it('An `error` AFTER the bytes were committed to a node offers the ledger, never «Cancel»', () => {
    expect(ceremonyExit('error', false)).toBe('cancel'); // a QR Xaman refused: nothing left, the exit stays
    expect(ceremonyExit('error', true)).toBe('check-ledger'); // a broadcast no node confirmed: only the ledger answers
    expect(ceremonyExit('error')).toBe(ceremonyExit('error', false)); // the default is the pre-commit reading
    // `committed` changes nothing in any other phase: `signing` cannot be committed
    // (submit() leaves it), and the exitless phases stay exitless.
    for (const p of PHASES.filter((x) => x !== 'error')) expect(ceremonyExit(p, true)).toBe(ceremonyExit(p, false));
    // …and the async door beside it reads that hold as COMMITTED, never as exitable.
    expect(seatHoldOf('error', true, false, true)).toBe('committed');
    expect(seatHoldOf('error', true, false, false)).toBe('exitable');
    const trappedOnceCommitted = PHASES.filter((p: Phase) => ceremonyHoldsSeat(p, true) && ceremonyExit(p, true) !== 'cancel');
    expect(trappedOnceCommitted).toEqual(['preparing', 'submitting', 'done', 'error']);
    for (const p of trappedOnceCommitted) expect(seatHoldOf(p, true, false, true)).toBe('committed');
  });

  it('The post-commit sentence names the two halves: it may have gone out, and nothing is handed back', () => {
    expect(CEREMONY_UNCONFIRMED_BROADCAST_SENTENCE).toMatch(/may have gone out/);
    expect(CEREMONY_UNCONFIRMED_BROADCAST_SENTENCE).toMatch(/cannot be cancelled from here/);
    expect(CEREMONY_UNCONFIRMED_BROADCAST_SENTENCE).toMatch(/Nothing is being handed back/);
    expect(CEREMONY_UNCONFIRMED_BROADCAST_SENTENCE).toMatch(/Check the account on the explorer/);
    expect(CEREMONY_UNCONFIRMED_BROADCAST_SENTENCE).not.toMatch(/cancel this ceremony|start again|guarantee/i);
  });
});

/**
 * `broadcast()` NOMBRA A TODOS LOS NODOS, NO SOLO AL ÚLTIMO.
 *
 * `lastFailure` se sobrescribía por nodo y el último de la lista (`s1.ripple.com`)
 * falla SIEMPRE por CORS desde un navegador: la pantalla decía «s1.ripple.com:
 * Failed to fetch» hiciera lo que hiciera el primero con el blob. Aquí el
 * transporte se finge en el borde y se ejecuta el `broadcast()` REAL.
 */
describe('broadcast — what the thrown error says when no node confirmed', () => {
  it('names every node in order and says the submission may have entered when any node went unanswered', async () => {
    const answers = [
      () => {
        throw new Error('Failed to fetch');
      },
      () => ({ ok: false, status: 502, json: async () => ({}) }),
      () => {
        throw new Error('Failed to fetch');
      },
    ];
    let i = 0;
    global.fetch = vi.fn(async () => answers[i++]()) as unknown as typeof fetch;

    const err = (await broadcast('BLOB').catch((e) => e)) as BroadcastUnconfirmedError;
    expect(err).toBeInstanceOf(BroadcastUnconfirmedError);
    expect(err.mayHaveEntered).toBe(true);
    expect(err.failures.map((f) => f.kind)).toEqual(['unanswered', 'unanswered', 'unanswered']);
    expect(err.message).toMatch(/xrplcluster\.com: Failed to fetch; xrpl\.link: HTTP 502; s1\.ripple\.com:51234: Failed to fetch/);
    expect(err.message).toMatch(/No XRPL node confirmed taking the submission/);
    expect(err.message).toMatch(/may still have entered/);
  });

  it('when EVERY node refused at RPC level (it read the bytes and applied nothing) it says so, and does not claim it may have entered', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: { error: 'invalidTransaction', error_exception: 'fails local checks: Non-canonical signature' } }),
    })) as unknown as typeof fetch;

    const err = (await broadcast('BLOB').catch((e) => e)) as BroadcastUnconfirmedError;
    expect(err.mayHaveEntered).toBe(false);
    expect(err.failures.every((f) => f.kind === 'refused')).toBe(true);
    expect(err.message).toMatch(/^Every XRPL node refused the submission/);
    expect(err.message).toMatch(/invalidTransaction — fails local checks/);
    expect(err.message).not.toMatch(/may still have entered/);
  });

  it('a node that answers with an engine result wins, whatever the earlier nodes did', async () => {
    const answers = [
      () => {
        throw new Error('Failed to fetch');
      },
      () => ({ ok: true, json: async () => ({ result: { engine_result: 'tesSUCCESS', tx_json: { hash: 'AB'.repeat(32) } } }) }),
    ];
    let i = 0;
    global.fetch = vi.fn(async () => answers[i++]()) as unknown as typeof fetch;
    await expect(broadcast('BLOB')).resolves.toEqual({ engine: 'tesSUCCESS', hash: 'AB'.repeat(32), message: undefined });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

/**
 * arriendo-ceremonia — LO QUE LA PUERTA CERRADA PROMETE.
 *
 * The closed door said ONE sentence for every hold: «cancel the ceremony there,
 * and this door opens again». In `preparing`, `submitting` and `done` there is
 * no Cancel at all — a broadcast the node refused lands on `done` like any other
 * outcome — so the family read an instruction pointing at a button that was not
 * there. And after «Cancel this ceremony» the door REOPENED while the server
 * kept refusing for up to 30 minutes, because nothing had asked for the seat.
 *
 * These fail on the code as it shipped in 256a6b0: `onSeatHeld` was a boolean
 * and there was exactly one sentence.
 */
describe('seatHoldOf — la puerta cerrada dice POR QUE, y solo promete lo que existe', () => {
  it('a live sitting with a Cancel on screen is the only hold that may promise one', () => {
    expect(seatHoldOf('signing', true, false)).toBe('exitable');
    expect(seatHoldOf('error', true, false)).toBe('exitable');
  });

  it('a round trip in flight, or a transaction already sent, is committed — never "cancel it there"', () => {
    expect(seatHoldOf('preparing', true, false)).toBe('committed');
    expect(seatHoldOf('submitting', true, false)).toBe('committed');
    // THE DEAD END: a broadcast the node refused ends here too.
    expect(seatHoldOf('done', true, false)).toBe('committed');
  });

  it('idle with the seat handed back is the async door OPEN — that is the ordinary case', () => {
    expect(seatHoldOf('idle', false, false)).toBe('none');
    expect(seatHoldOf('error', false, false)).toBe('none'); // a prepare that pinned nothing
  });

  it('a release we could not confirm keeps the door CLOSED — reopening it lands on a 422', () => {
    // THE TRAP, FROM THE OTHER SIDE: the ceremony is over, so the boolean said
    // "open"; the lease is still there, so the server says 422 for 30 minutes.
    expect(seatHoldOf('idle', false, true)).toBe('unreleased');
    // …but a sitting that is still live is described as itself, not as a lease.
    expect(seatHoldOf('signing', true, true)).toBe('exitable');
  });
});

describe('seatDoorNotice — una frase por estado, elegida por el mismo predicado', () => {
  const t = (x: string) => x;

  it('only the exitable hold points at the Cancel button', () => {
    expect(seatDoorNotice('exitable', t).body).toMatch(/cancel the ceremony there/i);
  });

  it('the exitless holds never do — that sentence was the dead end', () => {
    const committed = seatDoorNotice('committed', t);
    expect(committed.body).not.toMatch(/cancel the ceremony there/i);
    // And it says what IS true: the seat frees itself, and when.
    expect(committed.body).toMatch(/30 minutes/);
    expect(committed.headline).not.toBe(seatDoorNotice('exitable', t).headline);
  });

  it('an unconfirmed release is named as ours, never as a verdict about the seat', () => {
    const unreleased = seatDoorNotice('unreleased', t);
    expect(unreleased.body).toMatch(/could not be reached/i);
    expect(unreleased.body).not.toMatch(/cancel the ceremony there/i);
    expect(unreleased.body).toMatch(/30 minutes/);
  });

  it('every hold the doors can report has its own copy — none falls through to another', () => {
    const holds = ['exitable', 'committed', 'unreleased'] as const;
    const bodies = holds.map((h) => seatDoorNotice(h, t).body);
    expect(new Set(bodies).size).toBe(3);
    // Every phase that closes the door maps to one of them, and never to 'none'.
    for (const p of PHASES) {
      const hold = seatHoldOf(p, true, false);
      if (hold !== 'none') expect(bodies).toContain(seatDoorNotice(hold, t).body);
    }
  });
});

/**
 * arriendo-ceremonia — EL HUERFANO DE 24 h, POR LA PUERTA NUEVA.
 *
 * `abandon()` asked `livePayloadUuids(members)` alone. A payload minted while
 * that cancel was in flight (the «New QR» button stayed enabled through the
 * whole DELETE fan-out, up to 8s × N) is live on a member's phone for 24 hours
 * and is NOT in `members` yet — and `setMembers([])` right after threw the uuid
 * away for good: never stored, never cancelled, never named in any warning.
 * `resetMember` had the mirror case ('creating' hides the row from
 * `livePayloadUuids`) and `start()` a third by index.
 *
 * The register is the class fix, and this is the decision it feeds.
 */
describe('ceremonyKillSet — nada acunado puede quedar donde el cancel no mira', () => {
  const members = [
    { account: 'rWAIT', uuid: 'pay-wait', status: 'waiting' as const },
    { account: 'rSIGNED', uuid: 'pay-signed', status: 'signed' as const },
    { account: 'rMINTING', status: 'creating' as const },
  ];

  it('a payload minted milliseconds ago is killed even though no row can see it', () => {
    // THE ORPHAN: `livePayloadUuids` cannot see it — that IS the regression.
    expect(livePayloadUuids(members)).not.toContain('pay-just-minted');
    expect(ceremonyKillSet(members, ['pay-just-minted'])).toContain('pay-just-minted');
  });

  it('the rows and the register are a union, never one instead of the other', () => {
    expect(ceremonyKillSet(members, ['pay-just-minted']).sort()).toEqual(
      ['pay-just-minted', 'pay-wait'].sort(),
    );
  });

  it('a uuid in both is asked about ONCE — a second DELETE alarms about our own kill', () => {
    expect(ceremonyKillSet(members, ['pay-wait'])).toEqual(['pay-wait']);
  });

  it('an answered request is never in it: the register retires them, the rows exclude them', () => {
    // 'pay-signed' is out of the rows by status and out of the register by
    // `payloadAnswered` — cancelling it would raise ALREADY_RESOLVED over a
    // signature that arrived perfectly well.
    expect(ceremonyKillSet(members, [])).toEqual(['pay-wait']);
  });

  it('with nothing minted and nothing waiting there is nothing to ask Xaman', () => {
    expect(ceremonyKillSet([], [])).toEqual([]);
  });
});

describe('payloadAnswered — cuando Xaman ya contesto, la peticion sale del registro', () => {
  it('signed, cancelled and expired are all answers', () => {
    expect(payloadAnswered({ signed: true })).toBe(true);
    expect(payloadAnswered({ cancelled: true })).toBe(true);
    expect(payloadAnswered({ expired: true })).toBe(true);
  });

  it('a poll that says nothing yet leaves it killable — silence is not an answer', () => {
    expect(payloadAnswered({})).toBe(false);
    expect(payloadAnswered({ signed: false, cancelled: false, expired: false })).toBe(false);
  });
});

/**
 * arriendo-ceremonia — DEVOLVER EL ASIENTO.
 *
 * `abandon()` claimed in its own comment that "the ceremony gives the seat
 * back" and made NO server call: the 30-minute lease stayed, and «Propose to
 * the council» answered 422 CEREMONY_IN_FLIGHT ("finish or abandon that
 * sitting") to a family that had just abandoned it.
 */
describe('releaseCeremonySeat — y lo que no puede leer, no lo pinta verde', () => {
  function stubRelease(body: unknown, ok = true): void {
    global.fetch = vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
  }

  it('asks the release door for THIS account — the call that did not exist', async () => {
    stubRelease({ released: true });
    await releaseCeremonySeat('rCOUNCIL');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/xrpl-defi/multisign/release'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ account: 'rCOUNCIL' }) }),
    );
  });

  it('a confirmed release is the only thing reported as released', async () => {
    stubRelease({ released: true });
    expect(await releaseCeremonySeat('rCOUNCIL')).toBe('released');
  });

  it('nothing was leased -> not held: the async door may open, nothing blocks it', async () => {
    stubRelease({ released: false, reason: 'no-seat' });
    expect(await releaseCeremonySeat('rCOUNCIL')).toBe('not-held');
  });

  it('a refusal (another session holds it) is UNCONFIRMED, never "released"', async () => {
    stubRelease({ error: 'NOT_THE_LESSEE' }, false);
    expect(await releaseCeremonySeat('rCOUNCIL')).toBe('unconfirmed');
  });

  it('a server that could not read its own store is unconfirmed, not a verdict', async () => {
    stubRelease({ error: 'SEAT_NOT_RELEASED' }, false);
    expect(await releaseCeremonySeat('rCOUNCIL')).toBe('unconfirmed');
  });

  it('a network failure is unconfirmed too — and that keeps the door honestly closed', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const outcome = await releaseCeremonySeat('rCOUNCIL');
    expect(outcome).toBe('unconfirmed');
    // …which is exactly the state that keeps ProposeToCouncil shut with a reason.
    expect(seatHoldOf('idle', false, outcome === 'unconfirmed')).toBe('unreleased');
  });
});

/**
 * SOLTAR EL ASIENTO CUANDO XAMAN SE NEGÓ A MATAR UNA PETICIÓN.
 *
 * `abandon()` recogía los fallos de cancelación en `strayPayload` y soltaba el
 * asiento incondicionalmente, sin decir nada. La decisión de soltar es correcta
 * (la Sequence fijada hace imposible el gemelo; retener sería tapiar la siguiente
 * salida por una respuesta que NOSOTROS no pudimos leer) — lo que faltaba era
 * nombrar el riesgo real, el huérfano. Esta es la regla que decide cuándo.
 */
describe('ceremonyOrphanWarned — cuándo hay que decir que puede quedar un huérfano', () => {
  const stray = { kind: 'unconfirmed' } as unknown as Parameters<typeof ceremonyOrphanWarned>[0];

  it('una petición sin confirmar muerta Y un asiento que de verdad volvió: se avisa', () => {
    expect(ceremonyOrphanWarned(stray, 'released')).toBe(true);
  });

  it('sin petición perdida no hay huérfano posible, vuelva o no el asiento', () => {
    expect(ceremonyOrphanWarned(null, 'released')).toBe(false);
    expect(ceremonyOrphanWarned(null, 'unconfirmed')).toBe(false);
  });

  it('con petición perdida pero el asiento NO soltado (o sin nada que soltar) no es este aviso', () => {
    // 'unconfirmed' already keeps the async door shut with its own sentence;
    // 'not-held' means no seat was ever pinned — nothing for a stray to orphan.
    expect(ceremonyOrphanWarned(stray, 'unconfirmed')).toBe(false);
    expect(ceremonyOrphanWarned(stray, 'not-held')).toBe(false);
    expect(ceremonyOrphanWarned(stray, null)).toBe(false);
  });

  it('la frase dice las dos mitades: que el gemelo es imposible y qué haría un aterrizaje tardío', () => {
    expect(CEREMONY_ORPHAN_SENTENCE).toMatch(/pinned Sequence/);
    expect(CEREMONY_ORPHAN_SENTENCE).toMatch(/only one of any two can ever reach the ledger/);
    expect(CEREMONY_ORPHAN_SENTENCE).toMatch(/already filed as abandoned/);
    expect(CEREMONY_ORPHAN_SENTENCE).not.toMatch(/guarantee|recommend/i);
  });
});

/**
 * LA REGLA DEL DESMONTAJE, POR FASE.
 *
 * La cadena real (cerrar/«Back» → desmontar → liberar o no) se ejecuta en
 * `lib/xrpl/__tests__/quorumCeremonyClose.test.tsx`; aquí la tabla entera, para
 * que ninguna fase que nadie demoea se quede sin regla: la limpieza de desmontaje
 * devuelve el asiento que ESTA sesión pinó — salvo si la sesión ya se comprometió
 * a emitir, en cuyo caso jamás, diga lo que diga la fase (un broadcast que
 * revienta cae en `error`, la misma fase que un QR que falló).
 */
describe('unmountReleasesSeat — que desmontar devuelva el asiento, y cuando no', () => {
  it('sigue exactamente a «la sesión sujeta el asiento» mientras no se ha emitido nada', () => {
    for (const p of PHASES) {
      expect(unmountReleasesSeat(p, true, false)).toBe(ceremonyHoldsSeat(p, true));
      expect(unmountReleasesSeat(p, false, false)).toBe(ceremonyHoldsSeat(p, false));
    }
    expect(unmountReleasesSeat('idle', false, false)).toBe(false); // this sitting pinned nothing
    expect(unmountReleasesSeat('preparing', false, false)).toBe(true); // the pin may be landing
    expect(unmountReleasesSeat('signing', true, false)).toBe(true);
    expect(unmountReleasesSeat('error', true, false)).toBe(true); // a failed mint over a pinned seat
    expect(unmountReleasesSeat('error', false, false)).toBe(false); // a prepare that pinned nothing
  });

  it('una vez comprometida a emitir, NINGUNA fase libera — ni `error` tras un broadcast que reventó', () => {
    for (const p of PHASES) {
      expect(unmountReleasesSeat(p, true, true)).toBe(false);
      expect(unmountReleasesSeat(p, false, true)).toBe(false);
    }
  });

  it('el hash sólo se reporta al asiento cuando el submit aún puede entrar en un ledger', () => {
    expect(broadcastMayLand('tesSUCCESS')).toBe(true);
    expect(broadcastMayLand('tecINSUFFICIENT_RESERVE')).toBe(true); // applied, fee claimed
    expect(broadcastMayLand('terQUEUED')).toBe(true); // the node retries it
    expect(broadcastMayLand('tefPAST_SEQ')).toBe(false);
    expect(broadcastMayLand('tefMAX_LEDGER')).toBe(false);
    expect(broadcastMayLand('temBAD_SIGNATURE')).toBe(false);
    expect(broadcastMayLand(undefined)).toBe(false);
  });
});
