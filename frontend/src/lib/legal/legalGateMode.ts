/**
 * legalGateMode — LA PUERTA LEGAL TIENE TRES ESTADOS, Y SOLO UNO ES UNA PUERTA.
 *
 * `LegalAcceptGate` mounts a NON-DISMISSABLE ceremony in front of the whole
 * /app tree: no X, no backdrop click, no Escape, and the command palette
 * swallowed in the capture phase. That is correct for the state it was built
 * for — «you have not signed the current texts yet» — and catastrophic for the
 * state it was accidentally handed: «we could not read your record».
 */

/** The subset of GET /auth/me `legal` that decides what is on screen. */
export interface LegalGateFacts {
  required: boolean;
  /** Server could not read the stored record (backend `unreadableLegalStatus`). */
  unreadable?: boolean | null;
}

export type LegalGateMode =
  /** Show the blocking sign-and-accept ceremony. */
  | { kind: 'sign' }
  /** Let the person in; say we could not check. Never blocking. */
  | { kind: 'unreadable' }
  /** Nothing to show. */
  | { kind: 'closed' };

export function legalGateMode(gate: LegalGateFacts | null | undefined): LegalGateMode {
  if (!gate) return { kind: 'closed' };
  if (gate.unreadable === true) return { kind: 'unreadable' };
  return gate.required === true ? { kind: 'sign' } : { kind: 'closed' };
}

/** Convenience for callers that only need «is the app blocked right now». */
export function legalGateBlocks(gate: LegalGateFacts | null | undefined): boolean {
  return legalGateMode(gate).kind === 'sign';
}

/**
 * THE SENTENCE. Four things it must do, and one it must never do.
 *
 *   · say what happened — we could not read the record;
 *   · say whose fault it is — ours, in what we stored;
 *   · say what it costs the person — nothing: the account is untouched and
 *     they are not being asked for anything;
 *   · say what happens next — we look again every time the app opens, and a
 *     human can repair the row if it persists (the backend's own 409 detail
 *     says «waiting will not fix it», so we do not promise a self-heal).
 */
export const LEGAL_RECORD_UNREADABLE_EN =
  'We could not read your acceptance record, so we cannot confirm which versions of the terms and the privacy ' +
  'notice you signed. This is a fault in what we stored, not in anything you did: nothing on your account changed ' +
  'and nothing is being asked of you. We check again every time you open the app — if this keeps showing, write ' +
  'to us and we can repair the record.';

export const LEGAL_RECORD_UNREADABLE_ES =
  'No pudimos leer tu registro de aceptación, así que no podemos confirmar qué versiones de las condiciones y del ' +
  'aviso de privacidad firmaste. Es un fallo de lo que guardamos nosotros, no de nada que hayas hecho tú: no ha ' +
  'cambiado nada en tu cuenta y no te pedimos nada. Lo volvemos a comprobar cada vez que abres la aplicación — si ' +
  'sigue apareciendo, escríbenos y reparamos el registro.';

/** Short title for the notice; same rule — it never accuses the reader. */
export const LEGAL_RECORD_UNREADABLE_TITLE_EN = 'We could not check your acceptance record';
export const LEGAL_RECORD_UNREADABLE_TITLE_ES = 'No pudimos comprobar tu registro de aceptación';
