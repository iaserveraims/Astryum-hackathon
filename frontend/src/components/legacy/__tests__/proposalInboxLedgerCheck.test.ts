import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from './extractFromSource';
import {
  describeServerRefusal,
  serverRefusalText,
  type ReadableRefusal,
} from '../../../lib/errors/serverRefusal';

/**
 * G1-cadena — «el veredicto del ledger no llegaba a los ojos».
 *
 * Round 1 taught the SERVER to read XRPL before writing the word "expired": a
 * past-deadline proposal whose pinned Sequence was already CONSUMED (it may
 * have executed) — or could not be READ — keeps its stored status and carries
 * `ledgerCheck`. Nobody told the browser: `grep ledgerCheck frontend/src`
 * returned ZERO. So the inbox, which buckets on `status` alone, kept filing
 * those rows as live work:
 */

const INBOX = join(__dirname, '..', 'ProposalInbox.tsx');
const POSITIONS = join(__dirname, '..', 'FormalPositions.tsx');
const inboxSrc = readFileSync(INBOX, 'utf8');
const positionsSrc = readFileSync(POSITIONS, 'utf8');

// The extractor itself now lives in ./extractFromSource — it was copied into
// three test files, and the one piece that must never drift is the matcher
// (a loose signature match skips a test instead of failing it).

type Tray = 'unresolved' | 'toSign' | 'waiting' | 'ready' | 'emitted' | 'archived';

const trayOf = extract<(status: string, ledgerState: string | null, myPendingSeats: number) => Tray>(
  inboxSrc,
  'function trayOf(status: string, ledgerState: string | null, myPendingSeats: number): ProposalTray {',
  'function trayOf(status, ledgerState, myPendingSeats) {',
  'trayOf',
);

const unresolvedSeatMoves = extract<(status: string) => { registerHash: boolean; file: 'proposer' | 'anyone' }>(
  inboxSrc,
  "function unresolvedSeatMoves(status: string): { registerHash: boolean; file: 'proposer' | 'anyone' } {",
  'function unresolvedSeatMoves(status) {',
  'unresolvedSeatMoves',
);

const canFixPosition = extract<(status: string, seatUnresolved: boolean) => boolean>(
  positionsSrc,
  'export function canFixPosition(status: string, seatUnresolved: boolean): boolean {',
  'function canFixPosition(status, seatUnresolved) {',
  'canFixPosition',
);

/**
 * ESTA ERA LA ÚLTIMA GEMELA SIN DELEGAR.
 *
 * La firma cambió a propósito y este extractor lo grita, que es para lo que está:
 * `detail || message` no tenía `detailIsProse` (imprimía la r-address que
 * `POST /:id/positions` devuelve como `detail` de un 403 COMO LA EXPLICACIÓN ENTERA)
 * ni la reserva de códigos (el 409 `POSITION_ALREADY_SET` llega SIN `detail`, justo
 * después de que el cosignatario haya firmado en Xaman). Ahora delega, y el lector
 * real se inyecta: un sitio de llamada que dejase de delegar revienta aquí.
 */
const positionRefusal = extract<(err: unknown, t: (s: string) => string) => ReadableRefusal>(
  positionsSrc,
  'export function positionRefusal(err: unknown, t: (s: string) => string): ReadableRefusal {',
  'function positionRefusal(err, t) {',
  'positionRefusal',
  { describeServerRefusal },
);

const positionErrorTextRaw = extract<(err: unknown, t: (s: string) => string) => string>(
  positionsSrc,
  'export function positionErrorText(err: unknown, t: (s: string) => string): string {',
  'function positionErrorText(err, t) {',
  'positionErrorText',
  { serverRefusalText },
);

/** Identity `t`: las aserciones leen el inglés que se envía. */
const tt = (x: string) => x;
const positionErrorText = (err?: unknown) => positionRefusal(err, tt).text;

describe('trayOf — una fila con el asiento gastado no es trabajo vivo', () => {
  it('a `ready` row whose seat the ledger says is CONSUMED leaves "Ready to emit"', () => {
    // THE REGRESSION: this returned 'ready' — green pill, "0 days left" and a
    // «Combine & broadcast» that can only answer tefPAST_SEQ.
    expect(trayOf('ready', 'consumed', 0)).toBe('unresolved');
  });

  it('a `ready` row whose ledger read FAILED also leaves the tray — "we could not check" is not "it is fine"', () => {
    expect(trayOf('ready', 'unverified', 0)).toBe('unresolved');
  });

  it('a `collecting` row with a consumed seat stops asking for signatures, even with my seat pending', () => {
    // It used to sit in "Waiting for YOUR signature" forever and answer the raw
    // code PROPOSAL_NOT_LIVE to anyone who signed on their phone.
    expect(trayOf('collecting', 'consumed', 1)).toBe('unresolved');
    expect(trayOf('collecting', 'unverified', 0)).toBe('unresolved');
  });

  it('`unused` is the ONE verdict that clears a row: the seat is free, the work is still live', () => {
    // The server archives these as `expired`; if one ever arrives still live,
    // its pinned Sequence was never consumed — it really can be emitted.
    expect(trayOf('ready', 'unused', 0)).toBe('ready');
  });

  it('inside the deadline nothing changed (no ledgerCheck travels at all)', () => {
    expect(trayOf('collecting', null, 2)).toBe('toSign');
    expect(trayOf('collecting', null, 0)).toBe('waiting');
    expect(trayOf('ready', null, 0)).toBe('ready');
    expect(trayOf('submitted', null, 0)).toBe('emitted');
    expect(trayOf('expired', null, 0)).toBe('archived');
    expect(trayOf('withdrawn', null, 0)).toBe('archived');
  });

  it('a terminal row is never dragged into the unresolved tray by a stray verdict', () => {
    expect(trayOf('submitted', 'consumed', 0)).toBe('emitted');
    expect(trayOf('withdrawn', 'unverified', 0)).toBe('archived');
  });
});

/**
 * G1-cadena (round 3, finding 3) — the two doors out of an unresolved seat, and
 * WHO may use each. `consumed` is true after ANY later transaction of the
 * account, so a proposal that never reached its quorum ends up here too; the
 * panel used to label filing "(proposer only)" on that row as well, and a
 * council whose proposer is not around could never compose anything again.
 */
describe('unresolvedSeatMoves — la salida no puede depender de una sola persona', () => {
  it('a `ready` row: the hash door is open (it reached the quorum, so it may have been broadcast)', () => {
    expect(unresolvedSeatMoves('ready')).toEqual({ registerHash: true, file: 'proposer' });
  });

  it('a `collecting` row: no hash to record — and ANY member may file it', () => {
    // THE REGRESSION: `file: 'proposer'` here, with `/submitted` refusing the
    // other door (QUORUM_NOT_MET) → 422 on every compose, for ever.
    expect(unresolvedSeatMoves('collecting')).toEqual({ registerHash: false, file: 'anyone' });
  });

  it('mirrors the server exactly: `neverAssembled` there is "past the deadline AND still collecting"', () => {
    // The browser half and the withdraw route's half must agree; if one moves,
    // this pins the other.
    expect(unresolvedSeatMoves('collecting').file).toBe('anyone');
    expect(unresolvedSeatMoves('ready').file).toBe('proposer');
  });
});

/**
 * G1-cadena (round 3, finding 2) — THE THIRD IMPOSSIBLE ACTION. `FormalPositions`
 * is rendered on every row of the inbox; it decided "can a position still be
 * fixed?" from the STATUS alone, and an unresolved row keeps `collecting` /
 * `ready`. So the amber panel that exists to stop people acting on a spent seat
 * still offered «Fix my position» right underneath it.
 */
describe('canFixPosition — el acta se cierra con el plazo, no con el estado', () => {
  it('an unresolved seat offers NO position, whatever the stored status says', () => {
    expect(canFixPosition('collecting', true)).toBe(false);
    expect(canFixPosition('ready', true)).toBe(false);
  });

  it('a live row is untouched: the acta is exactly as open as it was', () => {
    expect(canFixPosition('collecting', false)).toBe(true);
    expect(canFixPosition('ready', false)).toBe(true);
  });

  it('a terminal row never opens it', () => {
    expect(canFixPosition('submitted', false)).toBe(false);
    expect(canFixPosition('expired', false)).toBe(false);
    expect(canFixPosition('withdrawn', false)).toBe(false);
  });
});

describe('positionErrorText — el código crudo no es una frase', () => {
  it('a server refusal shows its prose, not PROPOSAL_NOT_LIVE', () => {
    const refusal = Object.assign(new Error('PROPOSAL_NOT_LIVE'), {
      body: {
        error: 'PROPOSAL_NOT_LIVE',
        detail: 'The account already used Sequence 7 (it is now at 9). Check the account on an explorer.',
      },
    });
    expect(positionErrorText(refusal)).toContain('Sequence 7');
    expect(positionErrorText(refusal)).not.toBe('PROPOSAL_NOT_LIVE');
  });

  it('zod issue lists arrive as one sentence', () => {
    expect(positionErrorText({ body: { detail: ['not an XRPL account (r…)', 'too long'] } })).toBe(
      'not an XRPL account (r…); too long',
    );
  });

  it('a plain error keeps its message, and nothing ever renders as undefined', () => {
    expect(positionErrorText(new Error('network down'))).toBe('network down');
    // La frase de reserva la pone ahora el lector compartido.
    expect(positionErrorText(undefined)).toBe('Something went wrong.');
    expect(positionErrorText({})).toBe('Something went wrong.');
  });

  /**
   * LAS DOS QUE `detail || message` NO SABÍA DECIR, Y QUE
   * CAEN LAS DOS SOBRE EL COSIGNATARIO REGISTRADO QUE LA REHABILITÓ.
   */
  it('un 403 con la r-address en `detail` deja de ser la explicación entera', () => {
    const seat = 'rNaFfKeGDXFFEUqcCJdcgRfDjXfnq5Aoh6';
    const text = positionErrorText(
      Object.assign(new Error('NOT_A_COUNCIL_MEMBER'), {
        status: 403,
        body: { error: 'NOT_A_COUNCIL_MEMBER', detail: seat },
      }),
    );
    expect(text).not.toBe(seat);
    expect(text).toContain('member of this council');
    // Y la dirección no se pierde: es la prueba que la persona necesita.
    expect(text).toContain(seat);
  });

  it('el 409 sin `detail` que llega DESPUÉS de firmar en Xaman ya no es un slug', () => {
    const refusal = Object.assign(new Error('POSITION_ALREADY_SET'), {
      status: 409,
      body: { error: 'POSITION_ALREADY_SET' },
    });
    const text = positionErrorText(refusal);
    expect(text).not.toBe('POSITION_ALREADY_SET');
    expect(text).toContain('immutable');
    // Nada se perdió y nada se movió — y no se promete un reintento que no existe.
    expect(text).toContain('Nothing was lost and nothing moved');
    expect(text).not.toMatch(/try again/i);
  });

  it('el 403 de esta puerta trae además algo que pulsar', () => {
    const r = positionRefusal(
      Object.assign(new Error('NOT_A_COUNCIL_MEMBER'), {
        status: 403,
        body: { error: 'NOT_A_COUNCIL_MEMBER' },
      }),
      tt,
    );
    expect(r.door?.href).toBe('/app/wallets');
    expect(r.ways.length).toBeGreaterThan(0);
  });

  it('la mitad de cadena dice exactamente lo mismo — un lector, no dos', () => {
    for (const sample of [
      new Error('network down'),
      Object.assign(new Error('POSITION_ALREADY_SET'), { status: 409, body: { error: 'POSITION_ALREADY_SET' } }),
      { body: { detail: ['not an XRPL account (r…)', 'too long'] } },
    ]) {
      expect(positionErrorTextRaw(sample, tt)).toBe(positionRefusal(sample, tt).text);
    }
  });
});

/**
 * The WIRING, which no pure function can hold: which value the inbox hands to
 * `FormalPositions`. That the prop is passed at all is enforced by `tsc` (it is
 * required, not optional — see the prop's own comment); that it carries the
 * TRAY, and not something else, is what this reads. Deliberately the only
 * source-level assertion left in this file.
 */
describe('la bandeja pasa su veredicto al acta', () => {
  it('FormalPositions receives the unresolved tray, not a status guess', () => {
    expect(inboxSrc).toContain("seatUnresolved={tray === 'unresolved'}");
  });
});

/**
 * LA PANTALLA TAPIABA UNA PUERTA QUE EL SERVIDOR ABRE.
 *
 * Apagó «Fix my position» para el cosignatario REGISTRADO (`&& !hidden` en el
 * sitio de llamada), creyendo que «el mismo piso cierra esa puerta». No es verdad:
 * `POST /:id/positions` no tiene piso de lectura — comprueba la SignerList de ESTA
 * propuesta, que el JSON firmado diga lo mismo que los campos, y VERIFICA el blob
 * criptográficamente. Y la redacción para registrados mantiene txjson, signerList,
 * quorum y blobs: el material de firma llega entero.
 *
 * Quitarle la acción no le protegía de nada: le quitaba lo único que podía hacer.
 * `positionsHidden` está en la firma a propósito para que volver a conjugarlo aquí
 * falle en rojo.
 */
const mayFixPosition = extract<(status: string, seatUnresolved: boolean, positionsHidden: boolean) => boolean>(
  positionsSrc,
  'export function mayFixPosition(status: string, seatUnresolved: boolean, positionsHidden: boolean): boolean {',
  'function mayFixPosition(status, seatUnresolved, positionsHidden) {',
  'mayFixPosition',
  { canFixPosition },
);

describe('El cosignatario REGISTRADO puede fijar su posición', () => {
  it('la redacción del acta NO cierra la puerta: el servidor la acepta y la verifica', () => {
    // Éste es el caso que apagaba: acta oculta, asiento sano, propuesta viva.
    expect(mayFixPosition('collecting', false, true)).toBe(true);
    expect(mayFixPosition('ready', false, true)).toBe(true);
  });

  it('ver el acta o no verla NO cambia el veredicto — jamás', () => {
    for (const status of ['collecting', 'ready', 'submitted', 'expired', 'withdrawn']) {
      for (const seatUnresolved of [false, true]) {
        expect(mayFixPosition(status, seatUnresolved, true)).toBe(
          mayFixPosition(status, seatUnresolved, false),
        );
      }
    }
  });

  it('lo que SÍ cierra la puerta sigue cerrándola: el plazo y el asiento sin resolver', () => {
    expect(mayFixPosition('collecting', true, false)).toBe(false);
    expect(mayFixPosition('submitted', false, false)).toBe(false);
    expect(mayFixPosition('expired', false, true)).toBe(false);
  });

  it('el sitio de llamada delega en la decisión, no la vuelve a conjugar', () => {
    expect(positionsSrc).toContain('mayFixPosition(proposal.status, seatUnresolved, hidden)');
    expect(positionsSrc).not.toContain('canFixPosition(proposal.status, seatUnresolved) && !hidden');
  });
});
