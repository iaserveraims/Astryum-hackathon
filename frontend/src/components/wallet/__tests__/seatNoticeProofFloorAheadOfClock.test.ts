import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  describeSeatRelease,
  mayPrepareAgainAfterRelease,
  seatRefusalView,
  seatReleaseSettled,
  tryAgainWaitSeconds,
  undecidedSeatKind,
} from '../SeatRefusalNotice';
import {
  describeRetryableRefusal,
  readSeatRelease,
  seatFreesItselfSentence,
  seatReleaseSentence,
} from '@/lib/xaman/seatRefusal';
import type { HandoffPostResult } from '@/lib/wallet/handoffRelease';

/**
 * LA PANTALLA DEL 0xFE TIRABA `headline` Y `ways`
 * Y VOLVÍA A DECIR «TRY AGAIN IN A MOMENT» SIN LA PUERTA DE LA WALLET.
 */

const t = (s: string) => s;
const BACKEND = readFileSync(
  join(__dirname, '..', '..', '..', '..', '..', 'backend', 'src', 'services', 'identity', 'provenAddresses.ts'),
  'utf8',
);

/** El cuerpo tal y como lo sirven las tres puertas (seatGates.proofFloorAheadOfClock.test.ts). */
const SIGN_IN_WAY =
  'Sign in with the wallet that controls this address — a signed-in wallet proves itself and needs no stored record.';
const SERVER_BODY = {
  error: 'PROOF_FLOOR_AHEAD_OF_CLOCK',
  retryable: true,
  headline: "This account's security record is dated in the future",
  ways: [
    'Try again later — this one clears on its own once our clock passes that date.',
    SIGN_IN_WAY,
    'Or write to us: an administrator can check that date. Re-linking the wallet will not help — a fresh link is dated now, which is still earlier.',
  ],
  detail:
    "This account's security record is dated later than our own clock, so we cannot yet tell which of your linked " +
    'wallets were added before the account last changed hands. We will not guess: guessing could hand the account ' +
    'back to a previous holder. Linked wallets stay out until our clock passes that date, and re-linking one will ' +
    'not help — a fresh link is dated now, which is still earlier. Nothing was composed and nothing moved. Try ' +
    'again later; sign in with the wallet that controls this address, which proves itself and needs no stored ' +
    'record; or write to us, and an administrator can check that date.',
};

describe('el cuerpo del test es el del servidor, literal', () => {
  it('headline y las tres ways están en provenAddresses.ts tal cual', () => {
    expect(BACKEND).toContain(`headline: "${SERVER_BODY.headline}"`);
    expect(BACKEND).toContain(`'${SERVER_BODY.ways[0]}'`);
    expect(BACKEND).toContain(`'${SIGN_IN_WAY}'`);
    expect(BACKEND).toContain(`'${SERVER_BODY.ways[2]}'`);
    // Y sin `retryAfterSeconds`, a propósito (el comentario del servidor lo dice).
    expect(BACKEND).toMatch(/PROOF_FLOOR_AHEAD_OF_CLOCK: \{[\s\S]*?retryable: true,[\s\S]*?\/\/ No `retryAfterSeconds`/);
  });
});

/* ── (a) el consumidor: la vista del aviso sobre el cuerpo del servidor ──── */

describe('seatRefusalView · PROOF_FLOOR_AHEAD_OF_CLOCK deja de ser «transitorio genérico»', () => {
  const view = seatRefusalView(SERVER_BODY, t)!;

  it('tiene su propia clase, y sigue siendo «el servidor no decidió» (ningún número es ventana de firma)', () => {
    expect(view).toBeTruthy();
    expect(view.kind).toBe('floor-ahead-of-clock');
    expect(undecidedSeatKind(view.kind)).toBe(true);
    expect(tryAgainWaitSeconds(view.kind, 30)).toBeNull();
  });

  it('conserva el headline y las TRES ways del servidor, en su orden', () => {
    expect(view.headline).toBe(SERVER_BODY.headline);
    expect(view.ways).toEqual(SERVER_BODY.ways);
  });

  it('abre la puerta de la wallet — la que solo tenían los dos 409 deterministas', () => {
    expect(view.maySignInWithWallet).toBe(true);
  });

  it('NO promete «in a moment»: el servidor no mandó segundos porque puede ser 2099', () => {
    expect(view.text).not.toMatch(/in a moment/i);
    expect(view.retryAfterSeconds).toBeUndefined();
    // Las dos verdades sobreviven hasta la frase.
    expect(view.text).toMatch(/re-linking the wallet would not help/i);
    expect(view.text).toMatch(/ahead of our clock/i);
    // Y ninguna de las dos falsedades de la frase vieja.
    expect(view.text).not.toMatch(/could not read/i);
    expect(view.text).not.toMatch(/PROOF_FLOOR/);
  });

  it('el reintento sigue siendo un camino (el servidor dijo retryable) — sin cuenta atrás y sin liberar nada', () => {
    expect(view.mayTryAgain).toBe(true);
    expect(view.mayFreeSeat).toBe(false);
    expect(view.mayRetryFreeingSeat).toBe(false);
  });

  it('el lector compartido dice lo mismo que la vista: headline, ways, puerta, «later»', () => {
    const shared = describeRetryableRefusal({ status: 503, ...SERVER_BODY }, t)!;
    expect(shared.headline).toBe(SERVER_BODY.headline);
    expect(shared.ways).toEqual(SERVER_BODY.ways);
    expect(shared.maySignInWithWallet).toBe(true);
    expect(shared.text).not.toMatch(/in a moment/i);
    expect(shared.text).toMatch(/Try again later\./);
  });

  it('reenviado SIN ways (backend viejo, o una ruta que las tira): la reserva compartida las repone', () => {
    const bare = seatRefusalView({ error: 'PROOF_FLOOR_AHEAD_OF_CLOCK', retryable: true, detail: 'x y' }, t)!;
    expect(bare.kind).toBe('floor-ahead-of-clock');
    expect(bare.ways?.length).toBe(3);
    expect(bare.ways?.join(' ')).toMatch(/sign in with the wallet that controls this address/i);
    expect(bare.ways?.join(' ')).toMatch(/administrator can check that date/i);
    expect(bare.maySignInWithWallet).toBe(true);
    expect(bare.text).not.toMatch(/in a moment/i);
  });

  it('los demás transitorios NO ganan la puerta por contagio: ACCOUNT_BUSY sigue siendo espera', () => {
    const busy = seatRefusalView({ status: 503, error: 'ACCOUNT_BUSY', retryAfterSeconds: 2 }, t)!;
    expect(busy.kind).toBe('busy');
    expect(busy.maySignInWithWallet).toBeUndefined();
    expect(busy.ways).toBeUndefined();
    expect(busy.headline).toBeUndefined();
  });

  it('y PROOF_STORE_UNREADABLE (la consulta falló de verdad) sigue diciendo «in a moment», que ahí es verdad', () => {
    const store = seatRefusalView({ status: 503, error: 'PROOF_STORE_UNREADABLE', retryable: true, retryAfterSeconds: 3 }, t)!;
    expect(store.kind).toBe('store-unreadable');
    expect(store.retryAfterSeconds).toBe(3);
  });
});

/* ── el piso de abajo: `/handoff/release` reenvía el mismo refusal, sin ways ── */

describe('el camino de /handoff/release dice la misma verdad', () => {
  /** Lo que `handoffOwnerRefusal` (flareDemo.ts) manda: código, retryable y detail. Nada más. */
  const FORWARDED: HandoffPostResult = {
    kind: 'refused',
    status: 503,
    error: 'PROOF_FLOOR_AHEAD_OF_CLOCK',
    detail: SERVER_BODY.detail,
    body: { error: 'PROOF_FLOOR_AHEAD_OF_CLOCK', retryable: true, detail: SERVER_BODY.detail },
  };

  it('readSeatRelease: sigue siendo «no decidido», pero lleva el código', () => {
    const o = readSeatRelease(FORWARDED);
    expect(o.kind).toBe('unreadable');
    expect(o.kind === 'unreadable' && o.code).toBe('PROOF_FLOOR_AHEAD_OF_CLOCK');
  });

  it('seatReleaseSentence: no «could not read the state of that seat», no «in a moment», y las tres salidas', () => {
    const said = seatReleaseSentence(readSeatRelease(FORWARDED), t)!;
    expect(said).not.toMatch(/could not read the state of that seat/i);
    expect(said).not.toMatch(/in a moment/i);
    expect(said).toMatch(/ahead of our clock/i);
    expect(said).toMatch(/sign in with the wallet that controls this address/i);
    expect(said).toMatch(/administrator can check that date/i);
    // Y por el aviso de «rechazaste en Xaman» (XamanSingleSign), la misma frase.
    expect(seatFreesItselfSentence(readSeatRelease(FORWARDED), t)).toBe(said);
  });

  it('un 503 de asiento CORRIENTE sigue diciendo lo de siempre: el arreglo no lo toca', () => {
    const said = seatReleaseSentence(
      readSeatRelease({ kind: 'refused', status: 503, error: 'SEAT_STATE_UNREADABLE', body: { retryAfterSeconds: 3 } }),
      t,
    )!;
    expect(said).toMatch(/could not read the state of that seat/i);
    expect(said).toContain('3');
  });

  it('describeSeatRelease (el botón «Free the seat»): veredicto NO zanjado, con puerta y ways, sin licencia', () => {
    const v = describeSeatRelease(FORWARDED, t, 300);
    expect(v?.kind).toBe('unknown');
    expect(v?.kind === 'unknown' && v.maySignInWithWallet).toBe(true);
    expect(v?.kind === 'unknown' && v.ways?.length).toBe(3);
    expect(v?.text).not.toMatch(/in a moment/i);
    expect(v?.text).not.toMatch(/could not check whether that seat is free/i);
    // El reloj se mueve: no está zanjado, y jamás es permiso para preparar otro.
    expect(seatReleaseSettled(v)).toBe(false);
    expect(mayPrepareAgainAfterRelease(v, false)).toBe(false);
    // Y los 300 s del prepare no se convierten en una cuenta atrás sobre 2099.
    expect(v?.kind === 'unknown' && v.secondsLeft).toBeNull();
  });
});

/* ── por fuente: el aviso pinta lo que la vista ahora lleva ────────────────── */

describe('SeatRefusalNotice pinta headline, ways y la puerta', () => {
  const SRC = readFileSync(join(__dirname, '..', 'SeatRefusalNotice.tsx'), 'utf8');
  it('el titular, la lista de salidas y la puerta sobre el veredicto del release', () => {
    expect(SRC).toMatch(/view\.headline && view\.headline !== view\.text/);
    expect(SRC).toMatch(/shownWays\.map\(\(w\) => \(/);
    expect(SRC).toMatch(/view\.maySignInWithWallet \|\| verdict\?\.kind === 'proof-record' \|\| verdictNamesWalletDoor/);
  });
});
