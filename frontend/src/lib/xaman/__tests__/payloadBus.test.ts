import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  cancelPayloadAndDecide,
  cancelRefusalOutcome,
  cancelUiForAction,
  cancelXamanPayload,
  decideCloseStep,
  emitXamanPayload,
  emitXamanStatus,
  humanizeXamanSummary,
  onXamanCancelled,
  onXamanPayload,
  onXamanStatus,
  payloadStrayNotice,
  releaseInFlightCancel,
  resolveCancelAction,
  resolveClearAction,
  resolvePanelVoice,
  resolveStatusAction,
  shouldReportPayloadResolved,
  shouldWarnPayloadAlive,
  strayStateOf,
  type XamanCancelResult,
  type XamanCancelUi,
  type XamanPayloadPrompt,
  type XamanPayloadStatus,
} from '../payloadBus';

/**
 * UI-qr-xaman (R6.4 / R6.5) + QR-cierre.
 *
 * The Xaman signing surface has one job it must never get wrong: never let the
 * user believe a request is dead while it is still signable on their phone.
 * These cover the logic behind that claim.
 */

const t = (s: string) => s; // identity: assert the ENGLISH source strings

describe('humanizeXamanSummary — what am I signing, in words', () => {
  it('splits "Type · figure" and translates the type (old code left it raw)', () => {
    expect(humanizeXamanSummary('Payment · 5 XRP', t)).toEqual({
      headline: 'Sends money out of your account',
      detail: '5 XRP',
    });
  });

  it('never claims XRP over an IOU payment', () => {
    const lines = humanizeXamanSummary('Payment · 100 RLUSD', t);
    expect(lines?.detail).toBe('100 RLUSD');
    expect(lines?.headline).not.toMatch(/XRP/);
  });

  it('uses the shared XRPL label map for types it already knows', () => {
    expect(humanizeXamanSummary('EscrowCreate · 10 XRP', t)).toEqual({
      headline: 'Set XRP aside until a date',
      detail: '10 XRP',
    });
    expect(humanizeXamanSummary('AccountSet', t)).toEqual({
      headline: 'Account settings — moves no funds',
      detail: null,
    });
    expect(humanizeXamanSummary('SignerListSet', t)).toEqual({
      headline: 'Change who signs for this account',
      detail: null,
    });
    expect(humanizeXamanSummary('TrustSet', t)).toEqual({
      headline: 'Allow the account to hold a token',
      detail: null,
    });
  });

  it('completes the shared map with the types this rail also signs', () => {
    expect(humanizeXamanSummary('AMMDeposit · 25 XRP', t)?.headline).toBe('Adds liquidity to a pool');
    expect(humanizeXamanSummary('AMMWithdraw', t)?.headline).toBe('Takes liquidity out of a pool');
    expect(humanizeXamanSummary('SignIn', t)?.headline).toBe('Sign-in proof — moves no funds');
  });

  it('invents nothing for an unfamiliar type: shows it exactly as it came', () => {
    expect(humanizeXamanSummary('Frobnicate · 3 XRP', t)).toEqual({
      headline: 'Frobnicate · 3 XRP',
      detail: null,
    });
  });

  it('leaves prose the emitter already wrote intact', () => {
    expect(humanizeXamanSummary('Repay the RLUSD loan in full', t)).toEqual({
      headline: 'Repay the RLUSD loan in full',
      detail: null,
    });
  });

  it('stays silent when there is no summary', () => {
    expect(humanizeXamanSummary(undefined, t)).toBeNull();
    expect(humanizeXamanSummary('   ', t)).toBeNull();
  });
});

describe('cancelXamanPayload — Cancel must report the truth', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const res = (
    ok: boolean,
    body: unknown = { result: { cancelled: true, reason: 'OK' } },
    status = ok ? 200 : 400,
  ) => ({ ok, status, json: async () => body });

  it('DELETEs the payload and confirms the kill', async () => {
    fetchMock.mockResolvedValue(res(true));
    await expect(cancelXamanPayload('abc-123')).resolves.toMatchObject({ outcome: 'cancelled' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/xaman/status/abc-123',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('sends an abort signal with every DELETE (a cancel must never hang)', async () => {
    fetchMock.mockResolvedValue(res(true));
    await cancelXamanPayload('abc-123');
    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports "unknown" — not "still signable" — on a non-ok proxy answer', async () => {
    // 400 = the proxy has no XAMAN_API_* keys. We do not know whether Xaman
    // ever heard us, so we must not assert either state.
    fetchMock.mockResolvedValue(res(false, { error: 'Xaman API keys not configured' }, 400));
    await expect(cancelXamanPayload('abc-123')).resolves.toEqual({
      outcome: 'unknown',
      reason: 'HTTP_400',
    });
  });

  it('reports "still-live" only when Xaman actually refuses', async () => {
    fetchMock.mockResolvedValue(res(true, { result: { cancelled: false, reason: 'NOPE' } }));
    await expect(cancelXamanPayload('abc-123')).resolves.toEqual({
      outcome: 'still-live',
      reason: 'NOPE',
    });
  });

  it('QR-cierre C: an ALREADY_EXPIRED payload is gone, not "signable until it expires"', async () => {
    // expiresAt is computed AFTER the payload is created, so the modal can
    // still be counting down over a payload Xaman already buried. Collapsing
    // this into `false` shouted the amber warning over nothing.
    fetchMock.mockResolvedValue(res(true, { result: { cancelled: false, reason: 'ALREADY_EXPIRED' } }));
    await expect(cancelXamanPayload('abc-123')).resolves.toEqual({
      outcome: 'already-gone',
      reason: 'ALREADY_EXPIRED',
    });
  });

  it('QR-cierre C: ALREADY_RESOLVED is gone too — and NEVER reported as cancelled', async () => {
    // ALREADY_RESOLVED can mean the user SIGNED it on their phone. Telling the
    // waiting ceremony "cancelled" would discard a real signature (and, for
    // submit:true payloads, a broadcast transaction).
    const seen: string[] = [];
    const off = onXamanCancelled((uuid) => seen.push(uuid));
    fetchMock.mockResolvedValue(res(true, { result: { cancelled: false, reason: 'ALREADY_RESOLVED' } }));

    await expect(cancelXamanPayload('signed-upstream')).resolves.toEqual({
      outcome: 'already-gone',
      reason: 'ALREADY_RESOLVED',
    });
    expect(seen).toEqual([]);
    off();
  });

  it('reports "unknown" when the proxy is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(cancelXamanPayload('abc-123')).resolves.toEqual({
      outcome: 'unknown',
      reason: 'UNREACHABLE',
    });
  });

  it('QR-cierre A: a hung upstream gives up after the timeout instead of trapping the modal', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );

    const pending = cancelXamanPayload('abc-123');
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(pending).resolves.toEqual({ outcome: 'unknown', reason: 'TIMEOUT' });
  });

  it('QR-cierre A: the caller can abort the wait and gets the honest answer', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );

    const escape = new AbortController();
    const pending = cancelXamanPayload('abc-123', { signal: escape.signal });
    escape.abort();
    await expect(pending).resolves.toEqual({ outcome: 'unknown', reason: 'ABORTED' });
  });

  it('accepts an ok answer whose body carries no result envelope', async () => {
    fetchMock.mockResolvedValue(res(true, {}));
    await expect(cancelXamanPayload('abc-123')).resolves.toMatchObject({ outcome: 'cancelled' });
  });

  it('a body we never finished reading is no answer, not an empty 200', async () => {
    // The response arrived but the stream stalled and the timeout fired mid
    // read. `json().catch(() => null)` looks exactly like an empty 200 from
    // here, and an empty 200 counts as a kill — so without the abort check
    // this path would light up green over a payload nobody confirmed dead.
    const escape = new AbortController();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_resolve, reject) => {
          const fail = () => reject(new Error('stream aborted'));
          if (escape.signal.aborted) fail();
          else escape.signal.addEventListener('abort', fail);
        }),
    });

    const pending = cancelXamanPayload('abc-123', { signal: escape.signal });
    escape.abort();
    await expect(pending).resolves.toEqual({ outcome: 'unknown', reason: 'ABORTED' });
  });

  it('never bothers Xaman about a mock payload', async () => {
    await expect(cancelXamanPayload('mock-1755500000000-abc')).resolves.toMatchObject({
      outcome: 'cancelled',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('notifies subscribers only when the payload is confirmed dead', async () => {
    const seen: string[] = [];
    const off = onXamanCancelled((uuid) => seen.push(uuid));

    fetchMock.mockResolvedValue(res(true));
    await cancelXamanPayload('killed-1');
    expect(seen).toEqual(['killed-1']);

    fetchMock.mockResolvedValue(res(false, { error: 'boom' }));
    await cancelXamanPayload('survived-1');
    expect(seen).toEqual(['killed-1']); // a failed cancel signals nothing

    off();
    fetchMock.mockResolvedValue(res(true));
    await cancelXamanPayload('after-unsubscribe');
    expect(seen).toEqual(['killed-1']);
  });
});

describe('CancelRefusalOutcome: ALREADY_* is not one family', () => {
  // xumm-sdk XummCancelReason: ALREADY_CANCELLED | ALREADY_RESOLVED |
  // ALREADY_OPENED | ALREADY_EXPIRED. ALREADY_OPENED used to become
  // 'already-gone' → 'close' → «Request cancelled in Xaman. Nothing was signed.»
  // over a request OPEN and SIGNABLE on the phone; the parent then offered a
  // second payload beside it.
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const res = (ok: boolean, body: unknown) => ({ ok, status: ok ? 200 : 400, json: async () => body });

  const decide = (reason: string) =>
    resolveCancelAction({
      onScreenUuid: 'payload-A',
      answeredUuid: 'payload-A',
      result: { outcome: cancelRefusalOutcome(reason), reason },
    });

  it('ALREADY_OPENED is still signable: still-live → warn-alive, never close', async () => {
    expect(cancelRefusalOutcome('ALREADY_OPENED')).toBe('still-live');
    expect(decide('ALREADY_OPENED')).toBe('warn-alive');
    fetchMock.mockResolvedValue(res(true, { result: { cancelled: false, reason: 'ALREADY_OPENED' } }));
    const seen: string[] = [];
    const off = onXamanCancelled((uuid) => seen.push(uuid));
    await expect(cancelXamanPayload('open-on-phone')).resolves.toEqual({
      outcome: 'still-live',
      reason: 'ALREADY_OPENED',
    });
    expect(seen).toEqual([]); // nobody is told it died
    off();
  });

  it('ALREADY_EXPIRED and ALREADY_CANCELLED close in silence', () => {
    expect(cancelRefusalOutcome('ALREADY_EXPIRED')).toBe('already-gone');
    expect(cancelRefusalOutcome('ALREADY_CANCELLED')).toBe('already-gone');
    expect(decide('ALREADY_EXPIRED')).toBe('close');
    expect(decide('ALREADY_CANCELLED')).toBe('close');
  });

  it('ALREADY_RESOLVED warns that it may have been signed', () => {
    expect(cancelRefusalOutcome('ALREADY_RESOLVED')).toBe('already-gone');
    expect(decide('ALREADY_RESOLVED')).toBe('warn-resolved');
  });

  it('an ALREADY_* we have never read is unknown — never a licence to close', async () => {
    expect(cancelRefusalOutcome('ALREADY_SOMETHING_NEW')).toBe('unknown');
    expect(decide('ALREADY_SOMETHING_NEW')).toBe('warn-unknown');
    fetchMock.mockResolvedValue(res(true, { result: { cancelled: false, reason: 'ALREADY_SOMETHING_NEW' } }));
    await expect(cancelXamanPayload('abc-123')).resolves.toEqual({
      outcome: 'unknown',
      reason: 'ALREADY_SOMETHING_NEW',
    });
  });

  it('reads the reason case-insensitively, and a non-ALREADY refusal is still-live', () => {
    expect(cancelRefusalOutcome('already_opened')).toBe('still-live');
    expect(cancelRefusalOutcome('already_expired')).toBe('already-gone');
    expect(cancelRefusalOutcome('NOPE')).toBe('still-live');
    expect(cancelRefusalOutcome(undefined)).toBe('still-live');
  });
});

describe('resolveCancelAction — QR-cierre B: the answer must describe what is on screen', () => {
  const result = (outcome: XamanCancelResult['outcome']): XamanCancelResult => ({ outcome });

  it('drops a late answer once a DIFFERENT payload is on screen', () => {
    // The regression that reopened the bug: cancel A over a slow network, let
    // prompt B arrive, and A's answer landed on B. B was then marked "failed",
    // so the next Cancel took the already-failed branch and closed with NO
    // DELETE — B stayed signable on the phone, in silence.
    expect(
      resolveCancelAction({
        onScreenUuid: 'payload-B',
        answeredUuid: 'payload-A',
        result: result('still-live'),
      }),
    ).toBe('ignore');
  });

  it('still acts on its own answer once the panel has already cleared', () => {
    // QR-cierre final: on the happy path the confirmed kill resolves the
    // waiting ceremony, which clears the prompt — so whether promptRef is
    // still set when this runs was pure microtask luck. Treating an EMPTY
    // panel as "someone else's answer" left the cancel state stuck at
    // 'cancelling'. 'close' is idempotent and deterministic.
    expect(
      resolveCancelAction({ onScreenUuid: null, answeredUuid: 'payload-A', result: result('cancelled') }),
    ).toBe('close');
  });

  it('closes only for the payload it was asked about', () => {
    expect(
      resolveCancelAction({
        onScreenUuid: 'payload-A',
        answeredUuid: 'payload-A',
        result: result('cancelled'),
      }),
    ).toBe('close');
  });

  it('closes on an ALREADY_EXPIRED payload without any "still signable" alarm', () => {
    expect(
      resolveCancelAction({
        onScreenUuid: 'payload-A',
        answeredUuid: 'payload-A',
        result: { outcome: 'already-gone', reason: 'ALREADY_EXPIRED' },
      }),
    ).toBe('close');
  });

  it('QR-cierre final: ALREADY_RESOLVED never closes in silence', () => {
    // The blocker: 'already-gone' collapsed both reasons into a mute close.
    // ALREADY_RESOLVED means Xaman had an ANSWER for the request before we
    // asked — the user may have signed it seconds earlier, and submitTransaction
    // sets options.submit so Xaman BROADCASTS. The panel vanished over a
    // transaction that could already be on the ledger.
    expect(
      resolveCancelAction({
        onScreenUuid: 'payload-A',
        answeredUuid: 'payload-A',
        result: { outcome: 'already-gone', reason: 'ALREADY_RESOLVED' },
      }),
    ).toBe('warn-resolved');
  });

  it('does not invent a resolution when Xaman gave no reason at all', () => {
    expect(
      resolveCancelAction({
        onScreenUuid: 'payload-A',
        answeredUuid: 'payload-A',
        result: result('already-gone'),
      }),
    ).toBe('close');
  });

  it('warns that it is alive only when Xaman said so', () => {
    expect(
      resolveCancelAction({
        onScreenUuid: 'payload-A',
        answeredUuid: 'payload-A',
        result: result('still-live'),
      }),
    ).toBe('warn-alive');
  });

  it('separates "we could not read" from "it is alive"', () => {
    expect(
      resolveCancelAction({
        onScreenUuid: 'payload-A',
        answeredUuid: 'payload-A',
        result: result('unknown'),
      }),
    ).toBe('warn-unknown');
  });
});

describe('shouldWarnPayloadAlive — QR-cierre C: no alarm under a signature', () => {
  it('never paints the warning once the payload is signed', () => {
    // The guard used to be `!terminal && cancelState === "failed"`, and
    // `terminal` covers only rejected/expired — so a cancel that failed moments
    // before the user approved kept the alarm on screen under the ceremony.
    expect(shouldWarnPayloadAlive('signed', 'alive')).toBe(false);
    expect(shouldWarnPayloadAlive('signed', 'unknown')).toBe(false);
  });

  it('never paints it over the calm terminal panels either', () => {
    expect(shouldWarnPayloadAlive('rejected', 'alive')).toBe(false);
    expect(shouldWarnPayloadAlive('expired', 'unknown')).toBe(false);
  });

  it('paints it while the request is genuinely still out there', () => {
    expect(shouldWarnPayloadAlive('pending', 'alive')).toBe(true);
    expect(shouldWarnPayloadAlive('opened', 'unknown')).toBe(true);
  });

  it('says nothing when there is nothing to say', () => {
    expect(shouldWarnPayloadAlive('pending', 'idle')).toBe(false);
    expect(shouldWarnPayloadAlive('pending', 'cancelling')).toBe(false);
  });
});

describe('shouldReportPayloadResolved — QR-cierre final: the panel Xaman already answered', () => {
  it('speaks while nothing else has explained what happened', () => {
    expect(shouldReportPayloadResolved('pending', 'resolved')).toBe(true);
    expect(shouldReportPayloadResolved('opened', 'resolved')).toBe(true);
  });

  it('yields the moment the real resolution lands', () => {
    // The signature ceremony, the "you declined" panel and the expiry panel all
    // say it better, and with proof. This one only fills the gap where our own
    // cancel is the only thing that ever learned anything.
    expect(shouldReportPayloadResolved('signed', 'resolved')).toBe(false);
    expect(shouldReportPayloadResolved('rejected', 'resolved')).toBe(false);
    expect(shouldReportPayloadResolved('expired', 'resolved')).toBe(false);
  });

  it('is not the same statement as "still signable on your phone"', () => {
    // Two different facts, two different panels: one says the request is ALIVE,
    // this one says it was ANSWERED. Neither may borrow the other's sentence.
    expect(shouldReportPayloadResolved('pending', 'alive')).toBe(false);
    expect(shouldReportPayloadResolved('pending', 'unknown')).toBe(false);
    expect(shouldWarnPayloadAlive('pending', 'resolved')).toBe(false);
  });
});

describe('releaseInFlightCancel — QR-cierre final: only the user kills a DELETE', () => {
  const inFlight = () => ({ uuid: 'payload-A', controller: new AbortController() });

  it('lets the request finish when a new payload takes the panel', () => {
    // THE BLOCKER. The prompt listener used to abort here, so payload A's
    // DELETE died mid-flight the instant payload B arrived: A stayed signable
    // on the phone for the rest of its five minutes, its ceremony never got
    // onXamanCancelled and hung to PAYLOAD_TIMEOUT, and nobody was told.
    const f = inFlight();
    expect(releaseInFlightCancel(f, 'superseded')).toBeNull();
    expect(f.controller.signal.aborted).toBe(false);
  });

  it('lets the request finish when the panel itself goes away', () => {
    const f = inFlight();
    expect(releaseInFlightCancel(f, 'closed')).toBeNull();
    expect(f.controller.signal.aborted).toBe(false);
  });

  it('aborts only when the user asked to stop waiting', () => {
    // The one legitimate abort: the panel must never be a cage, and giving up
    // on the ANSWER is honest ('unknown'), because we really did stop listening.
    const f = inFlight();
    expect(releaseInFlightCancel(f, 'stop-waiting')).toBeNull();
    expect(f.controller.signal.aborted).toBe(true);
  });

  it('is safe with nothing in flight', () => {
    expect(releaseInFlightCancel(null, 'stop-waiting')).toBeNull();
    expect(releaseInFlightCancel(null, 'superseded')).toBeNull();
  });
});

describe('decideCloseStep — a live payload never leaves the screen without a DELETE', () => {
  it('asks Xaman to kill a live payload', () => {
    expect(decideCloseStep({ hasPrompt: true, status: 'pending', cancelUi: 'idle' })).toBe('cancel');
    expect(decideCloseStep({ hasPrompt: true, status: 'opened', cancelUi: 'idle' })).toBe('cancel');
  });

  it('QR-cierre A: the second press is a way OUT, not a dead end', () => {
    expect(decideCloseStep({ hasPrompt: true, status: 'pending', cancelUi: 'cancelling' })).toBe(
      'stop-waiting',
    );
  });

  it('closes without a second DELETE once the user has read the answer', () => {
    expect(decideCloseStep({ hasPrompt: true, status: 'pending', cancelUi: 'alive' })).toBe('close');
    expect(decideCloseStep({ hasPrompt: true, status: 'pending', cancelUi: 'unknown' })).toBe('close');
    expect(decideCloseStep({ hasPrompt: true, status: 'pending', cancelUi: 'resolved' })).toBe('close');
  });

  it('never bothers Xaman about something already resolved', () => {
    expect(decideCloseStep({ hasPrompt: true, status: 'signed', cancelUi: 'idle' })).toBe('close');
    expect(decideCloseStep({ hasPrompt: true, status: 'rejected', cancelUi: 'idle' })).toBe('close');
    expect(decideCloseStep({ hasPrompt: true, status: 'expired', cancelUi: 'idle' })).toBe('close');
    expect(decideCloseStep({ hasPrompt: false, status: 'pending', cancelUi: 'idle' })).toBe('close');
  });

  it('the whole way out of a hung upstream costs three presses and no more', () => {
    // Cancel -> (round trip hangs) -> press again to stop waiting -> the panel
    // says what it could not confirm -> "Close anyway". Every step is reachable;
    // none of them is the sign button.
    let ui: XamanCancelUi = 'idle';
    const press = () => decideCloseStep({ hasPrompt: true, status: 'pending', cancelUi: ui });
    expect(press()).toBe('cancel');
    ui = 'cancelling';
    expect(press()).toBe('stop-waiting');
    ui = 'unknown';
    expect(press()).toBe('close');
  });
});

describe('QR-cierre final: cancelling A and then receiving B', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('kills A for real and drops its answer, instead of killing the request', async () => {
    // The exact sequence the panel runs: press Cancel on A, B arrives while the
    // DELETE is still travelling, A answers late.
    const cancelled: string[] = [];
    const off = onXamanCancelled((uuid) => cancelled.push(uuid));

    let release: (() => void) | null = null;
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
          release = () =>
            resolve({ ok: true, status: 200, json: async () => ({ result: { cancelled: true } }) });
        }),
    );

    // press Cancel on A
    const inFlight = { uuid: 'payload-A', controller: new AbortController() };
    const pending = cancelXamanPayload(inFlight.uuid, { signal: inFlight.controller.signal });

    // B arrives on the bus: the panel lets go of the handle, it does NOT abort.
    expect(releaseInFlightCancel(inFlight, 'superseded')).toBeNull();

    // A's DELETE completes because nobody killed it.
    (release as unknown as () => void)();
    const result = await pending;
    expect(result).toMatchObject({ outcome: 'cancelled' });
    // ...so A's waiting ceremony is released instead of hanging to PAYLOAD_TIMEOUT.
    expect(cancelled).toEqual(['payload-A']);
    // ...and the late answer still does not touch the payload now on screen.
    expect(
      resolveCancelAction({ onScreenUuid: 'payload-B', answeredUuid: 'payload-A', result }),
    ).toBe('ignore');

    off();
  });
});

/**
 * ─── xaman-cancelar ────────────────────────────────────────────
 *
 * The same failure, in the doors QR-cierre did not reach. Three of them are the
 * literal shape of "Cancel does not cancel"; one is the fix for the first round
 * having made the collision LIKELIER; one is a panel standing down for a fact
 * it invented itself.
 */

describe('resolveClearAction — xaman-cancelar 1: a clear names its payload', () => {
  const args = (over: Partial<Parameters<typeof resolveClearAction>[0]>) =>
    resolveClearAction({
      onScreenUuid: 'payload-B',
      clearedUuid: 'payload-B',
      status: 'pending',
      cancelUi: 'idle',
      ...over,
    });

  it('THE REGRESSION: A resolving must not wipe B off the screen', () => {
    // Real sequence, and it got FASTER with the last fix: the user cancels A,
    // the DELETE now comes back confirmed in seconds (it used to hang to the
    // 5-minute PAYLOAD_TIMEOUT), A's ceremony resolves, and its caller emits a
    // clear. Untagged, that clear dropped the panel for B — alive, on the
    // phone, one tap from a signature — with no DELETE and nothing said.
    expect(args({ clearedUuid: 'payload-A' })).toBe('ignore');
  });

  it('the payload it IS about does get cleared', () => {
    expect(args({ clearedUuid: 'payload-B' })).toBe('clear');
  });

  it('an empty panel accepts any clear: nothing to protect, and it stays idempotent', () => {
    expect(args({ onScreenUuid: null, clearedUuid: 'payload-A' })).toBe('clear');
    expect(args({ onScreenUuid: undefined, clearedUuid: null })).toBe('clear');
  });

  it('the panel closing itself carries no uuid and still closes', () => {
    // forceClose(): it has already dropped its own state, so the emit is only
    // there to keep other listeners in sync.
    expect(args({ onScreenUuid: null, clearedUuid: null })).toBe('clear');
  });

  it('keeps the terminal panels up (a decline/expiry is read, then dismissed)', () => {
    expect(args({ status: 'rejected' })).toBe('keep-panel');
    expect(args({ status: 'expired' })).toBe('keep-panel');
  });

  it('xaman-cancelar 5: a warning nobody has read does NOT erase itself', () => {
    // After 'alive' / 'unknown' / 'resolved' this panel is the only place that
    // knows something may still be signable — or may already be on the ledger.
    // The ceremony behind it rejects at PAYLOAD_TIMEOUT and its catch emits a
    // clear: five minutes later the alarm vanished on its own, unread.
    for (const cancelUi of ['alive', 'unknown', 'resolved'] as XamanCancelUi[]) {
      expect(args({ cancelUi })).toBe('keep-panel');
    }
    // ...while an ordinary wait clears exactly as before.
    expect(args({ cancelUi: 'idle' })).toBe('clear');
    expect(args({ cancelUi: 'cancelling' })).toBe('clear');
  });
});

describe('the bus, end to end: cancelling A must not take B down with it', () => {
  /**
   * The modal's prompt listener, wired exactly as it ships. The vitest env is
   * `node` with no jsdom, so this is how the WIRING gets executed — and the
   * wiring is where this bug has lived all three times.
   */
  function mountPanel() {
    const panel = {
      prompt: null as XamanPayloadPrompt | null,
      status: 'pending' as XamanPayloadStatus,
      cancelUi: 'idle' as XamanCancelUi,
    };
    const offPrompt = onXamanPayload((p, clearedUuid) => {
      if (p) {
        panel.prompt = p;
        panel.status = 'pending';
        panel.cancelUi = 'idle';
        return;
      }
      const action = resolveClearAction({
        onScreenUuid: panel.prompt?.uuid ?? null,
        clearedUuid,
        status: panel.status,
        cancelUi: panel.cancelUi,
      });
      if (action !== 'clear') return;
      panel.prompt = null;
    });
    // ...and the STATUS listener with it (uuid-status). The payload channel was
    // the only one wired here, which is precisely how the bug survived: the
    // panel's OTHER input took whatever arrived, from whichever ceremony.
    const offStatus = onXamanStatus((s, statusUuid) => {
      const action = resolveStatusAction({
        onScreenUuid: panel.prompt?.uuid ?? null,
        statusUuid,
      });
      if (action !== 'apply') return;
      panel.status = s;
    });
    return {
      panel,
      off: () => {
        offPrompt();
        offStatus();
      },
    };
  }

  const prompt = (uuid: string): XamanPayloadPrompt => ({ uuid, qrPng: 'qr', deeplink: 'x://' });

  it('A resolving after its cancel leaves B on screen; B\u2019s own clear closes it', () => {
    const { panel, off } = mountPanel();
    try {
      emitXamanPayload(prompt('payload-A'));
      emitXamanPayload(prompt('payload-B'));

      // A's ceremony finally resolves and clears ITS payload.
      emitXamanPayload(null, 'payload-A');
      expect(panel.prompt?.uuid).toBe('payload-B'); // still scannable, still true

      emitXamanPayload(null, 'payload-B');
      expect(panel.prompt).toBeNull();
    } finally {
      off();
    }
  });

  it('uuid-status: A resolving must not mark B finished — B keeps its DELETE', () => {
    const { panel, off } = mountPanel();
    try {
      emitXamanPayload(prompt('payload-A'));
      emitXamanPayload(prompt('payload-B'));

      // A resolves (the user signed it in Xaman). Untagged, this landed on the
      // panel showing B.
      emitXamanStatus('signed', 'payload-A');
      expect(panel.status).toBe('pending'); // B is still waiting for a signature

      // ...and THIS is the door that was left open: with A's 'signed' written
      // onto B, decideCloseStep answered 'close', so the next press left the
      // screen with NO DELETE and B stayed alive and signable on the phone,
      // in silence. The founding bug, fifth door.
      expect(
        decideCloseStep({
          hasPrompt: !!panel.prompt,
          status: panel.status,
          cancelUi: panel.cancelUi,
        }),
      ).toBe('cancel');
    } finally {
      off();
    }
  });

  it('and neither may A’s decline or expiry: B still has to be killed', () => {
    for (const stray of ['rejected', 'expired'] as XamanPayloadStatus[]) {
      const { panel, off } = mountPanel();
      try {
        emitXamanPayload(prompt('payload-B'));
        emitXamanStatus(stray, 'payload-A');
        expect(panel.status).toBe('pending');
        // The panel would otherwise have painted "You declined the signature in
        // Xaman" / "The code expired. Nothing was signed." over a live request.
        expect(resolvePanelVoice(panel.status, panel.cancelUi)).toBe('invite');
        expect(
          decideCloseStep({
            hasPrompt: !!panel.prompt,
            status: panel.status,
            cancelUi: panel.cancelUi,
          }),
        ).toBe('cancel');
      } finally {
        off();
      }
    }
  });

  it('THE OTHER ORDER: a stray status cannot erase a terminal panel nobody read', () => {
    // The coupling status → resolveClearAction cuts both ways. B’s own
    // decline is what keeps its panel on screen when the ceremony clears at
    // PAYLOAD_TIMEOUT; a 'pending' / 'opened' heartbeat from ANOTHER ceremony
    // overwrote that guard, and the next clear then wiped the panel before the
    // person had read it.
    const { panel, off } = mountPanel();
    try {
      emitXamanPayload(prompt('payload-B'));
      emitXamanStatus('rejected', 'payload-B'); // B’s own resolution: READ
      expect(panel.status).toBe('rejected');

      emitXamanStatus('opened', 'payload-A'); // another ceremony, still running
      expect(panel.status).toBe('rejected');

      emitXamanPayload(null, 'payload-B'); // the ceremony clears its own payload
      expect(panel.prompt?.uuid).toBe('payload-B'); // "you declined" stays up
    } finally {
      off();
    }
  });

  it('a status for a payload nobody is showing describes nothing', () => {
    // connectAdditionalAccount and connectWithUserFeedback drive this channel
    // and raise NO prompt at all, so the bus carries statuses with no panel
    // behind them as a matter of course.
    const { panel, off } = mountPanel();
    try {
      emitXamanStatus('signed', 'payload-Z');
      expect(panel.status).toBe('pending');
      expect(panel.prompt).toBeNull();
    } finally {
      off();
    }
  });

  it('a timed-out ceremony cannot erase the warning it left behind', () => {
    const { panel, off } = mountPanel();
    try {
      emitXamanPayload(prompt('payload-C'));
      panel.cancelUi = 'resolved'; // Xaman said it had already answered it
      emitXamanPayload(null, 'payload-C'); // PAYLOAD_TIMEOUT, 5 minutes later
      expect(panel.prompt?.uuid).toBe('payload-C');
    } finally {
      off();
    }
  });
});

describe('xaman-cancelar 2: a countdown this app invented is not a resolution', () => {
  const guessed = { expiryIsLocalGuess: true };

  it('THE ORDER THAT WAS NOT COVERED: local expiry first, ALREADY_RESOLVED second', () => {
    // The guard only worked when the answer arrived BEFORE the timer. The other
    // way round, `status` was already 'expired', the resolved panel stood down,
    // and the screen read "The code expired. Nothing was signed." over a
    // request Xaman had just told us was ANSWERED — possibly signed, and for a
    // submit:true payload possibly already on the ledger.
    expect(shouldReportPayloadResolved('expired', 'resolved')).toBe(false);
    expect(shouldReportPayloadResolved('expired', 'resolved', guessed)).toBe(true);
  });

  it('the same fallacy silenced the "still signable" alarm', () => {
    // Xaman REFUSED the cancel — the request is alive — but a local tick had
    // already written 'expired', and the amber warning went quiet. The local
    // deadline is now+5min on THIS machine's clock, measured only after the
    // create round trip had already spent part of Xaman's own 300 s window: a
    // reading always outranks it. (uuid-status 3: this note used to cite a
    // 24 h `expire: 1440` hand-off — real in CloseDoorSign and councilSigning,
    // but neither of them emits on this bus.)
    expect(shouldWarnPayloadAlive('expired', 'alive')).toBe(false);
    expect(shouldWarnPayloadAlive('expired', 'alive', guessed)).toBe(true);
    expect(shouldWarnPayloadAlive('expired', 'unknown', guessed)).toBe(true);
  });

  it('an expiry Xaman actually reported still closes both panels', () => {
    // The flag is only ever set by the local timer; anything arriving on the
    // status channel was READ, and clears it.
    expect(shouldReportPayloadResolved('expired', 'resolved', { expiryIsLocalGuess: false })).toBe(false);
    expect(shouldWarnPayloadAlive('expired', 'alive', { expiryIsLocalGuess: false })).toBe(false);
  });

  it('a real signature or a real decline silences them whatever the timer thinks', () => {
    expect(shouldReportPayloadResolved('signed', 'resolved', guessed)).toBe(false);
    expect(shouldReportPayloadResolved('rejected', 'resolved', guessed)).toBe(false);
    expect(shouldWarnPayloadAlive('signed', 'alive', guessed)).toBe(false);
    expect(shouldWarnPayloadAlive('rejected', 'unknown', guessed)).toBe(false);
  });
});

describe('one vocabulary for three surfaces (xaman-cancelar 3 + 4)', () => {
  it('every warn-* answer becomes its panel state, and nothing else does', () => {
    expect(cancelUiForAction('warn-alive')).toBe('alive');
    expect(cancelUiForAction('warn-unknown')).toBe('unknown');
    expect(cancelUiForAction('warn-resolved')).toBe('resolved');
    expect(cancelUiForAction('close')).toBe('idle');
    expect(cancelUiForAction('ignore')).toBe('idle');
  });

  it('only the unconfirmed states raise a warning', () => {
    expect(strayStateOf('alive')).toBe('alive');
    expect(strayStateOf('unknown')).toBe('unknown');
    expect(strayStateOf('resolved')).toBe('resolved');
    expect(strayStateOf('idle')).toBeNull();
    expect(strayStateOf('cancelling')).toBeNull();
  });

  it('the three sentences stay three different claims', () => {
    const id = (x: string) => x;
    const alive = payloadStrayNotice('alive', id);
    const unknown = payloadStrayNotice('unknown', id);
    const resolved = payloadStrayNotice('resolved', id);
    expect(new Set([alive, unknown, resolved]).size).toBe(3);
    // "we could not read it" is never dressed as a verdict...
    expect(unknown).toMatch(/cannot confirm/i);
    expect(unknown).not.toMatch(/\bstays signable\b/);
    // ...and "already answered" is never reported as a signature we read.
    expect(resolved).toMatch(/may have been signed/i);
    expect(resolved).not.toMatch(/\bwas signed\b/);
  });

  it('every sentence goes through the translator (a raw English string is the bug)', () => {
    const shouted = payloadStrayNotice('alive', (x) => `es::${x}`);
    expect(shouted.startsWith('es::')).toBe(true);
  });
});

describe('cancelPayloadAndDecide — the round trip the three Cancels now share', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const res = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });

  it('xaman-cancelar 3: the Legacy close-door Cancel now DELETEs the payload', () => {
    // It called onCancel() and nothing else, over the AccountSet that disables
    // the master key — options { submit: true, expire: 1440 }, so Xaman
    // broadcasts it alone and it stays signable for 24 HOURS.
    fetchMock.mockResolvedValue(res({ result: { cancelled: true } }));
    return cancelPayloadAndDecide('close-door-1', () => 'close-door-1').then((out) => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/xaman/status/close-door-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(out).toMatchObject({ action: 'close', cancelUi: 'idle' });
    });
  });

  it('an answered payload never closes in silence — it becomes the resolved panel', async () => {
    fetchMock.mockResolvedValue(res({ result: { cancelled: false, reason: 'ALREADY_RESOLVED' } }));
    const out = await cancelPayloadAndDecide('close-door-2', () => 'close-door-2');
    expect(out).toMatchObject({ action: 'warn-resolved', cancelUi: 'resolved' });
  });

  it('an upstream that never answers is "unknown", never "cancelled"', async () => {
    fetchMock.mockRejectedValue(new Error('proxy down'));
    const out = await cancelPayloadAndDecide('close-door-3', () => 'close-door-3');
    expect(out).toMatchObject({ action: 'warn-unknown', cancelUi: 'unknown' });
    expect(out.result.outcome).toBe('unknown');
  });

  it('reads what is on screen AFTER the trip, so a late answer is still dropped', async () => {
    fetchMock.mockResolvedValue(res({ result: { cancelled: false, reason: 'REFUSED' } }));
    const out = await cancelPayloadAndDecide('payload-A', () => 'payload-B');
    expect(out.action).toBe('ignore');
  });
});

describe('xaman-cancelar 4: "New QR" kills the payload it replaces', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * The council inbox's supersede step, run for real. Xaman locks a payload to
   * the first client that opens it, so "New QR" is a genuine cure — but it
   * minted a SECOND signable multisign payload for the same seat and left the
   * first alive, and both live for 24 h. Press it N times, get N valid
   * signatures waiting on N phones.
   */
  async function newQr(previousUuid: string | null): Promise<{ stray: string | null }> {
    if (!previousUuid) return { stray: null };
    const { cancelUi } = await cancelPayloadAndDecide(previousUuid, () => previousUuid);
    return { stray: strayStateOf(cancelUi) };
  }

  it('the previous request is DELETEd before a new one is minted', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ result: { cancelled: true } }) });
    expect(await newQr('ms-1')).toEqual({ stray: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/xaman/status/ms-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('a kill we could not confirm is NAMED, not swallowed by the new QR', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: { cancelled: false, reason: 'REFUSED' } }),
    });
    expect(await newQr('ms-2')).toEqual({ stray: 'alive' });
  });

  it('the first QR of a session bothers nobody', async () => {
    expect(await newQr(null)).toEqual({ stray: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('decideCloseStep drives the two Legacy Cancels too', () => {
  it('a live Legacy payload is never abandoned without asking Xaman to kill it', () => {
    // CloseDoorSign / ProposalInbox: `hasPrompt` is "there is a uuid", and the
    // status they pass is 'pending' — those surfaces have no live status
    // channel, only a poll that closes the box when it resolves.
    expect(decideCloseStep({ hasPrompt: true, status: 'pending', cancelUi: 'idle' })).toBe('cancel');
  });

  it('the second press, after an answer we could not act on, just leaves', () => {
    for (const cancelUi of ['alive', 'unknown', 'resolved'] as XamanCancelUi[]) {
      expect(decideCloseStep({ hasPrompt: true, status: 'pending', cancelUi })).toBe('close');
    }
  });

  it('a press while the DELETE is in flight never fires a second one', () => {
    expect(decideCloseStep({ hasPrompt: true, status: 'pending', cancelUi: 'cancelling' })).toBe(
      'stop-waiting',
    );
  });
});

describe('resolveStatusAction — whose status is this? (uuid-status)', () => {
  it('a status raised by ANOTHER ceremony never describes this panel', () => {
    // Five ceremonies share one bus. This is the whole bug: A’s resolution
    // arriving while B is on screen.
    expect(resolveStatusAction({ onScreenUuid: 'payload-B', statusUuid: 'payload-A' })).toBe(
      'ignore',
    );
  });

  it('the payload on screen is described by its own status', () => {
    expect(resolveStatusAction({ onScreenUuid: 'payload-B', statusUuid: 'payload-B' })).toBe(
      'apply',
    );
  });

  it('with nothing on screen there is nothing for a status to describe', () => {
    // Deliberately NOT the idempotent 'clear' that resolveClearAction answers
    // over an empty panel: keeping a status here would only arm the NEXT
    // payload’s state with another payload’s fate.
    expect(resolveStatusAction({ onScreenUuid: null, statusUuid: 'payload-A' })).toBe('ignore');
    expect(resolveStatusAction({ onScreenUuid: undefined, statusUuid: 'payload-A' })).toBe(
      'ignore',
    );
  });
});

describe('resolvePanelVoice — the panel says ONE thing at a time (uuid-status 2)', () => {
  it('a cancel we could not confirm withdraws the invitation to sign', () => {
    // THE CONTRADICTORY PANEL: the amber "It stays signable on your phone —
    // open Xaman and decline it there" was painted with the scannable code and
    // "Waiting for your signature in Xaman…" still on screen, because both
    // were gated on `terminal` alone. One panel asking the person to kill the
    // request and to sign it, in the same breath — and on a submit:true
    // payload the invitation it accidentally extends is a broadcast.
    expect(resolvePanelVoice('pending', 'alive')).toBe('stray');
    expect(resolvePanelVoice('pending', 'unknown')).toBe('stray');
    expect(resolvePanelVoice('opened', 'alive')).toBe('stray');
  });

  it('an expiry we only GUESSED does not promote the warning to a verdict', () => {
    const guessed = { expiryIsLocalGuess: true };
    expect(resolvePanelVoice('expired', 'alive', guessed)).toBe('stray');
    expect(resolvePanelVoice('expired', 'resolved', guessed)).toBe('answered');
    // …and an expiry Xaman actually reported does close them (a reading
    // outranks the local timer, never the other way round).
    expect(resolvePanelVoice('expired', 'alive')).toBe('terminal');
  });

  it('a resolution we READ outranks a cancel we could not confirm', () => {
    expect(resolvePanelVoice('rejected', 'alive')).toBe('terminal');
    expect(resolvePanelVoice('rejected', 'unknown')).toBe('terminal');
    expect(resolvePanelVoice('expired', 'resolved')).toBe('terminal');
  });

  it('a signature is not a notice: the signed cover plays over the code itself', () => {
    // QR-cierre C — nothing about a signed payload is still pending. Un check
    // quieto tacha el QR gastado en el sitio (la CEREMONIA suena una sola vez,
    // en el bloque de settlement — fundador).
    expect(resolvePanelVoice('signed', 'alive')).toBe('invite');
    expect(resolvePanelVoice('signed', 'resolved')).toBe('invite');
  });

  it('an ordinary live request is the only voice allowed to show a code', () => {
    expect(resolvePanelVoice('pending', 'idle')).toBe('invite');
    expect(resolvePanelVoice('opened', 'idle')).toBe('invite');
    expect(resolvePanelVoice('pending', 'cancelling')).toBe('invite');
  });
});
