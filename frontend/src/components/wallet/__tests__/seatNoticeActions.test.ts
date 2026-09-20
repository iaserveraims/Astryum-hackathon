import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  WALLET_SIGN_IN_HREF,
  describeSeatRelease,
  seatRefusalView,
  seatReleaseOffer,
  seatReleaseSettled,
  tryAgainWaitSeconds,
  undecidedSeatKind,
} from '../SeatRefusalNotice';
import type { HandoffPostResult } from '@/lib/wallet/handoffRelease';

/**
 * §3 (UN «TRY AGAIN» QUE SOLO PODÍA FALLAR) y §4 (PROSA SIN
 * NINGÚN BOTÓN).
 */

const t = (s: string) => s;
const SRC = readFileSync(join(__dirname, '..', 'SeatRefusalNotice.tsx'), 'utf8');

/* ── §3: el reintento espera a que pueda funcionar ────────────────────────── */

describe('§3 — ningún reintento que solo pueda fallar', () => {
  it('con la ventana del SERVIDOR corriendo, el reintento está bloqueado y dice cuánto queda', () => {
    expect(tryAgainWaitSeconds('taken-retryable', 300)).toBe(300);
    expect(tryAgainWaitSeconds('taken-window-open', 42)).toBe(42);
  });

  it('cuando esa ventana se acaba, deja de bloquear — y ahí empieza «Prepare it again»', () => {
    expect(tryAgainWaitSeconds('taken-retryable', 0)).toBeNull();
    expect(tryAgainWaitSeconds('taken-retryable', null)).toBeNull();
  });

  it('un «no pude leer» NO bloquea nada: su número es consejo, no veredicto', () => {
    // LA SALIDA JAMÁS SE GATEA por una lectura nuestra que falló: el `Retry-After`
    // de un 503 no es una ventana de firma y no puede comportarse como una.
    for (const kind of ['busy', 'store-unreadable', 'unreadable'] as const) {
      expect(undecidedSeatKind(kind), kind).toBe(true);
      expect(tryAgainWaitSeconds(kind, 30), kind).toBeNull();
    }
    expect(undecidedSeatKind('taken-retryable')).toBe(false);
  });

  it('el estado exacto del fallo: `taken-retryable` con segundos ofrece reintento, y esperando', () => {
    const view = seatRefusalView({ error: 'NONCE_SEAT_TAKEN', retryable: true, secondsLeft: 300, memoHex: 'FE01' }, t);
    expect(view?.kind).toBe('taken-retryable');
    // Sigue siendo un camino real (el servidor dijo que esta sesión puede
    // desplazar ese borrador): no se le quita a nadie, se le pone el reloj.
    expect(view?.mayTryAgain).toBe(true);
    expect(tryAgainWaitSeconds(view?.kind, view?.secondsLeft ?? null)).toBe(300);
    // Y mientras tanto «Free the seat» sigue escondido: la ventana está viva.
    expect(seatReleaseOffer({ error: 'NONCE_SEAT_TAKEN', retryable: true, secondsLeft: 300, memoHex: 'FE01' })).toEqual({
      memoHex: 'FE01',
    });
  });

  it('por fuente: el botón se deshabilita y dice la espera, en vez de prometer', () => {
    expect(SRC).toMatch(/const tryAgainBlockedFor = tryAgainWaitSeconds\(view\.kind, left\);/);
    expect(SRC).toMatch(/disabled=\{tryAgainBlockedFor !== null\}/);
    expect(SRC).toMatch(/Try again in/);
  });
});

/* ── §4: el perfil de email tiene al menos una puerta ─────────────────────── */

describe('§4 — los dos 409 deterministas dejan de ser prosa sin botón', () => {
  for (const code of ['ACCOUNT_RECORD_MISSING', 'PROOF_FLOOR_UNREADABLE']) {
    it(`${code}: la vista nombra la puerta de la wallet, y sigue sin prometer un reintento`, () => {
      const view = seatRefusalView({ status: 409, error: code, retryable: false }, t);
      expect(view?.maySignInWithWallet).toBe(true);
      // Esperar no lo arregla: ofrecer «Try again» aquí sería la promesa que el
      // servidor ya dijo que no puede cumplir (`retryable: false`).
      expect(view?.mayTryAgain).toBe(false);
      expect(view?.mayFreeSeat).toBe(false);
      // Y la frase sigue siendo frase: ni el código ni la genérica que lo tragaba.
      expect(view?.text).not.toMatch(new RegExp(code));
      expect(view?.text).toMatch(/sign in with the wallet/i);
    });
  }

  it('un asiento normal NO gana esa puerta: es de estos dos códigos, no de todos', () => {
    expect(seatRefusalView({ error: 'NONCE_SEAT_TAKEN', secondsLeft: 300 }, t)?.maySignInWithWallet).toBeUndefined();
    expect(seatRefusalView({ status: 503, error: 'ACCOUNT_BUSY' }, t)?.maySignInWithWallet).toBeUndefined();
  });

  it('la puerta apunta a una ruta que existe de verdad en la app', () => {
    expect(WALLET_SIGN_IN_HREF).toBe('/app/wallets');
    // Un enlace a una página que no existe es otra forma de dejar a alguien parado.
    expect(existsSync(join(__dirname, '..', '..', '..', 'app', 'app', 'wallets', 'page.tsx'))).toBe(true);
  });

  it('por fuente: los dos avisos la pintan — el del rechazo y el del asiento abandonado', () => {
    // Tres anclas, no dos — el aviso del asiento abandonado
    // pinta la puerta también cuando el release contesta el 503 del reloj
    // (`verdict.kind === 'unknown' && verdict.maySignInWithWallet`), que NO es
    // un veredicto zanjado y por eso no cabe en la rama `proof-record`.
    expect(SRC.match(/href=\{WALLET_SIGN_IN_HREF\}/g)?.length).toBe(3);
    expect(SRC).toMatch(/verdict\?\.kind === 'unknown' && verdict\.maySignInWithWallet \? \(/);
    expect(SRC).toMatch(/view\.maySignInWithWallet \|\| verdict\?\.kind === 'proof-record'/);
    expect(SRC).toMatch(/\{verdict\?\.kind === 'proof-record' \? \(/);
  });

  it('y cuando el 409 llega como respuesta del RELEASE, el veredicto sigue zanjado (con puerta)', () => {
    const said = describeSeatRelease(
      { kind: 'refused', status: 409, error: 'PROOF_FLOOR_UNREADABLE', detail: 'no se pudo leer el bloque' } as HandoffPostResult,
      t,
      300,
    );
    expect(said?.kind).toBe('proof-record');
    // Zanjado ⇒ desaparecen los botones que preguntan otra vez; por eso la
    // puerta de la wallet se pinta justamente sobre este veredicto.
    expect(seatReleaseSettled(said)).toBe(true);
    expect(said?.text).not.toMatch(/no se pudo leer/);
  });
});
