import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from './extractFromSource';
import { cancelPayloadAndDecide, type XamanCancelAction } from '@/lib/xaman/payloadBus';

/**
 * consejo-superficies 3 + 4 — LO QUE LA BANDEJA SE TRAGABA, Y A QUIEN LE OFRECE
 * PUERTAS QUE EL SERVIDOR VA A CERRAR.
 */

const inboxSrc = readFileSync(join(__dirname, '..', 'ProposalInbox.tsx'), 'utf8');

type CancelAnswerSink = 'close-box' | 'in-box' | 'banner' | 'drop';

const cancelAnswerSink = extract<(action: XamanCancelAction, stillOnScreen: boolean) => CancelAnswerSink>(
  inboxSrc,
  'function cancelAnswerSink(action: XamanCancelAction, stillOnScreen: boolean): CancelAnswerSink {',
  'function cancelAnswerSink(action, stillOnScreen) {',
  'cancelAnswerSink',
);

const seatClaimOf = extract<
  (seats: string[], linkedAddrs: Set<string>, myAddrs: Set<string>) => 'linked' | 'unlinked' | 'none'
>(
  inboxSrc,
  'function seatClaimOf(seats: string[], linkedAddrs: Set<string>, myAddrs: Set<string>): SeatClaim {',
  'function seatClaimOf(seats, linkedAddrs, myAddrs) {',
  'seatClaimOf',
);

function stubXamanDelete(body: unknown, ok = true): void {
  global.fetch = vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cancelAnswerSink — una respuesta tardia no se tira: cambia de sitio', () => {
  it('a refusal about a box that moved on goes to the tray banner', () => {
    // THE REGRESSION: this answer was dropped, and the payload stayed signable
    // for 24 hours with nothing on screen about it.
    expect(cancelAnswerSink('warn-alive', false)).toBe('banner');
    expect(cancelAnswerSink('warn-unknown', false)).toBe('banner');
    expect(cancelAnswerSink('warn-resolved', false)).toBe('banner');
  });

  it('the same refusal about the box on screen stays IN the box', () => {
    expect(cancelAnswerSink('warn-alive', true)).toBe('in-box');
    expect(cancelAnswerSink('warn-unknown', true)).toBe('in-box');
    expect(cancelAnswerSink('warn-resolved', true)).toBe('in-box');
  });

  it('a confirmed kill closes its OWN box, and never somebody else’s', () => {
    expect(cancelAnswerSink('close', true)).toBe('close-box');
    // A new session took the box while we waited: closing it would wipe a QR
    // that is alive and being scanned right now.
    expect(cancelAnswerSink('close', false)).toBe('drop');
  });

  it('«ignore» carries no outcome, so it invents none', () => {
    expect(cancelAnswerSink('ignore', true)).toBe('drop');
    expect(cancelAnswerSink('ignore', false)).toBe('drop');
  });

  it('nothing is ever dropped in silence except a confirmed death or an empty answer', () => {
    const actions: XamanCancelAction[] = ['close', 'warn-alive', 'warn-unknown', 'warn-resolved', 'ignore'];
    const swallowed = actions.filter((a) => cancelAnswerSink(a, false) === 'drop');
    expect(swallowed).toEqual(['close', 'ignore']);
  });

  it('runs the REAL bus: a refused DELETE for a superseded session reaches the banner', async () => {
    stubXamanDelete({ result: { cancelled: false, reason: 'PAYLOAD_OPENED' } });
    const { action } = await cancelPayloadAndDecide('pay-1', () => 'pay-1');
    // The box moved on (a second «Sign as …» press) — the warning survives it.
    expect(cancelAnswerSink(action, false)).toBe('banner');
  });

  it('runs the REAL bus: an upstream that never answered also reaches the banner', async () => {
    stubXamanDelete(null, false);
    const { action } = await cancelPayloadAndDecide('pay-1', () => 'pay-1');
    expect(cancelAnswerSink(action, false)).toBe('banner');
  });
});

describe('seatClaimOf — la pertenencia que el servidor mide no es la que pinta la UI', () => {
  const seats = ['rALICE', 'rBOB', 'rCARLA'];

  it('a linked wallet is a claim the server can see', () => {
    expect(seatClaimOf(seats, new Set(['rBOB']), new Set(['rBOB']))).toBe('linked');
  });

  it('a seat held ONLY by the Xaman connected in this tab is not one', () => {
    // THE HOLE: the row offered «record its hash» and «file it» to somebody the
    // route answers 403 — on the one door whose refusal arrives with the money
    // already moved.
    expect(seatClaimOf(seats, new Set(), new Set(['rCARLA']))).toBe('unlinked');
  });

  it('linked wins whenever ANY seat is registered — one linked wallet is enough', () => {
    expect(seatClaimOf(seats, new Set(['rALICE']), new Set(['rALICE', 'rCARLA']))).toBe('linked');
  });

  it('a stranger to this council is neither, so nothing is said to them', () => {
    expect(seatClaimOf(seats, new Set(['rZED']), new Set(['rZED']))).toBe('none');
    expect(seatClaimOf([], new Set(['rALICE']), new Set(['rALICE']))).toBe('none');
  });
});
