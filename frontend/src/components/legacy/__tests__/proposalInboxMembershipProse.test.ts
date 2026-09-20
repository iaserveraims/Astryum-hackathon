import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from './extractFromSource';

/**
 * «REGÍSTRALA» YA NO ABRE NADA.
 *
 * Hasta la el servidor leía la pertenencia de `prisma.wallet`, así que
 * «link it in Wallets — the inbox opens as soon as it is registered» era verdad.
 * Desde la la pertenencia la decide una dirección PROBADA (la wallet con
 * la que se firmó la sesión, o una que firmó su reto de binding), porque las
 * direcciones del SignerList de un consejo son públicas y cualquiera podría
 * teclear una. La frase vieja manda a una persona real a registrar su wallet,
 * volver, y estrellarse contra el mismo muro sin saber por qué.
 */

const INBOX = join(__dirname, '..', 'ProposalInbox.tsx');
const inboxSrc = readFileSync(INBOX, 'utf8');

type SeatClaim = 'linked' | 'unlinked' | 'none';
type Cause = 'unlinked-wallet' | 'prove-membership' | 'none';

const seatClaimOf = extract<(s: string[], l: Set<string>, m: Set<string>) => SeatClaim>(
  inboxSrc,
  'function seatClaimOf(seats: string[], linkedAddrs: Set<string>, myAddrs: Set<string>): SeatClaim {',
  'function seatClaimOf(seats, linkedAddrs, myAddrs) {',
  'seatClaimOf',
);

const inboxRefusalCause = extract<
  (c: string, s: string[], l: Set<string>, m: Set<string>, read: boolean, explained?: boolean) => Cause
>(
  inboxSrc,
  'function inboxRefusalCause(code: string, seats: string[], linkedAddrs: Set<string>, myAddrs: Set<string>, registryWasRead: boolean, serverExplained = false): RefusalCause {',
  'function inboxRefusalCause(code, seats, linkedAddrs, myAddrs, registryWasRead, serverExplained = false) {',
  'inboxRefusalCause',
  { seatClaimOf },
);

const refusalExplainsProof = extract<(d: string | null | undefined) => boolean>(
  inboxSrc,
  'export function refusalExplainsProof(detail: string | null | undefined): boolean {',
  'function refusalExplainsProof(detail) {',
  'refusalExplainsProof',
);

/** Lo que el backend manda hoy en el `detail` de una pertenencia refusada. */
const PROVE_MEMBERSHIP_HINT =
  'Membership is decided by a PROVEN address: the wallet you signed in with, or one you signed a binding challenge ' +
  "for. An address that was only registered (typed or imported as watch-only) is not a proof — a council's signer " +
  'addresses are public, so anyone could type one in.';

const READ_MEMBERSHIP_HINT =
  'The inbox of a council opens to any address you hold that sits on its signer list (connected, imported or proven) ' +
  'and to whoever composed the proposal.';

const SEAT = 'rNaFfKeGDXFFEUqcCJdcgRfDjXfnq5Aoh6';

describe('la causa que la bandeja añade a un 403 de pertenencia', () => {
  it('una wallet conectada que el servidor no tiene: se nombra la firma, no el registro', () => {
    const cause = inboxRefusalCause(
      'NOT_A_COUNCIL_MEMBER',
      [SEAT],
      new Set<string>(), // registradas: ninguna
      new Set([SEAT]), // mías: la conectada en Xaman
      true,
    );
    expect(cause).toBe('unlinked-wallet');
  });

  it('registrada pero no probada — el caso nuevo — también recibe una salida', () => {
    // Registrada (tiene `id`, luego vino del servidor) y aun así refusada: ya no
    // es «regístrala», es «pruébala». Antes esto devolvía 'none' y la persona se
    // quedaba con la frase de reserva, que sigue diciendo «regístrala».
    const cause = inboxRefusalCause(
      'NOT_A_COUNCIL_MEMBER',
      [SEAT],
      new Set([SEAT]),
      new Set([SEAT]),
      true,
    );
    expect(cause).toBe('prove-membership');
  });

  it('sin haber leído el registro tampoco se calla: la firma es la cura en cualquier caso', () => {
    expect(inboxRefusalCause('NOT_A_COUNCIL_MEMBER', [SEAT], new Set(), new Set(), false)).toBe(
      'prove-membership',
    );
  });

  it('si el servidor ya lo explicó, la pantalla no escribe una segunda versión', () => {
    expect(
      inboxRefusalCause('NOT_A_COUNCIL_MEMBER', [SEAT], new Set(), new Set([SEAT]), true, true),
    ).toBe('none');
  });

  it('un rechazo que no es de pertenencia no recibe ninguna de las dos', () => {
    expect(inboxRefusalCause('NOT_A_COUNCIL', [SEAT], new Set(), new Set([SEAT]), true)).toBe('none');
    expect(inboxRefusalCause('XRPL_DEFI_DISABLED', [], new Set(), new Set(), true)).toBe('none');
  });
});

describe('refusalExplainsProof — reconoce la pista del backend, no una frase cualquiera', () => {
  it('reconoce las dos pistas que el router manda hoy', () => {
    expect(refusalExplainsProof(PROVE_MEMBERSHIP_HINT)).toBe(true);
    expect(refusalExplainsProof(READ_MEMBERSHIP_HINT)).toBe(true);
  });

  it('un detalle vacío, ausente o de otro rechazo no cuenta como explicación', () => {
    expect(refusalExplainsProof('')).toBe(false);
    expect(refusalExplainsProof(null)).toBe(false);
    expect(refusalExplainsProof(undefined)).toBe(false);
    expect(refusalExplainsProof('rCouncil… has no signer list')).toBe(false);
  });
});

describe('la prosa que se envía', () => {
  it('ya no promete que registrar abra la bandeja', () => {
    // La frase vieja, tal y como se pintaba. (El docblock de arriba la CITA para
    // explicar por qué se retiró: lo que no puede volver es la instrucción.)
    expect(inboxSrc).not.toContain('link it in Wallets — the inbox opens as soon as it is registered');
  });

  it('la frase nueva nombra la firma y el binding', () => {
    expect(inboxSrc).toContain('sign in with it, or bind it from Wallets with a signature');
    expect(inboxSrc).toContain('Membership is decided by an address you have PROVEN');
  });
});
