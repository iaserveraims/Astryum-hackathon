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
 * prosa-y-lectores — «el backend corrigió su prosa y no llegaba a pantalla».
 *
 * Three hardcoded copies stood between the server and the family, and every one
 * of them still carried the wording the backend RETIRED this round:
 */

const PROPOSE = join(__dirname, '..', 'ProposeToCouncil.tsx');
const MOVEMENTS = join(__dirname, '..', 'GovernedMovements.tsx');
const INBOX = join(__dirname, '..', 'ProposalInbox.tsx');
const proposeSrc = readFileSync(PROPOSE, 'utf8');
const movementsSrc = readFileSync(MOVEMENTS, 'utf8');
const inboxSrc = readFileSync(INBOX, 'utf8');

/** Identity `t` — the assertions read the English source strings, which is what
 *  ships when the dictionary misses. */
const t = (s: string) => s;

/** Exactly what `jpost` / `jget` throw for a non-ok response. */
function httpError(status: number, body: unknown): Error {
  const b = body as { error?: string } | null;
  return Object.assign(new Error(b?.error ?? `http_${status}`), { status, body });
}

type Reader = (e: unknown, t: (s: string) => string) => string | ReadableRefusal;

/**
 * LOS DOS QUE AHORA DEVUELVEN EL RECHAZO ENTERO.
 *
 * `serverRefusalText` devolvía UNA CADENA, así que `headline`, `ways[]` y
 * `retryAfterSeconds` —los tres campos que `services/identity/provenAddresses.ts`
 * construye y las rutas mandan verbatim— se perdían entre el servidor y la
 * pantalla. Las dos puertas de composición leen el rechazo entero; la frase se
 * sigue comparando aquí, que es lo que este bloque protege.
 */
function said(read: Reader, e: unknown, t: (s: string) => string): string {
  const r = read(e, t);
  return typeof r === 'string' ? r : r.text;
}

const proposalError = extract<Reader>(
  proposeSrc,
  'function proposalError(e: unknown, t: (s: string) => string): ReadableRefusal {',
  'function proposalError(e, t) {',
  'proposalError',
  { describeServerRefusal },
);

const proposeError = extract<Reader>(
  movementsSrc,
  'function proposeError(err: unknown, t: (s: string) => string): ReadableRefusal {',
  'function proposeError(err, t) {',
  'proposeError',
  { describeServerRefusal },
);

const errText = extract<Reader>(
  inboxSrc,
  'function errText(e: unknown, t: (s: string) => string): string {',
  'function errText(e, t) {',
  'errText',
  { serverRefusalText },
);

/** The 409 `POST /council/proposals` answers today (councilProposals.ts). */
const LIVE_409 = {
  error: 'LIVE_PROPOSAL_EXISTS',
  detail:
    'This account already has a proposal collecting signatures, and XRPL pins one Sequence at a time. ' +
    'Settle that one in the proposal inbox first: finish collecting its signatures and broadcast it, or ' +
    'register the transaction hash if it has already gone out — any member can do either.',
  proposalId: 'cprop_live',
};

/** The 422 `POST /xrpl-defi/council/prepare` answers on a live proposal. */
const LIVE_422_DETAIL =
  'A proposal on this account (School fees) is already collecting signatures in the inbox, and it holds ' +
  "the account's only Sequence. Settle THAT proposal in the inbox.";

describe('prosa-y-lectores — the three copies now read the same source', () => {
  it('ProposeToCouncil shows the server sentence instead of its own (it discarded body.detail)', () => {
    const err = httpError(409, LIVE_409);
    // What the old code keyed on, and what it printed instead.
    expect(err.message).toBe('LIVE_PROPOSAL_EXISTS');
    expect(said(proposalError, err, t)).toBe(LIVE_409.detail);
    expect(said(proposalError, err, t)).not.toMatch(/let it expire/i);
  });

  it('GovernedMovements no longer collapses a NOT_A_COUNCIL 409 into "let it expire"', () => {
    // This is the exact refusal xrplDefi.ts hands back when the account has no
    // signer list — and the exact case the old `status === 409` branch
    // answered with the live-proposal copy: "let a proposal expire" on an
    // account that has no proposals and no council.
    const err = httpError(409, { error: 'NOT_A_COUNCIL', detail: 'rCouncil… has no signer list' });
    const text = said(proposeError, err, t);
    expect(text).toBe('rCouncil… has no signer list');
    expect(text).not.toMatch(/let it expire/i);
  });

  it('GovernedMovements carries the 422 seat prose, which its 409 branch used to hide', () => {
    const text = said(proposeError, httpError(422, { error: 'LIVE_PROPOSAL_EXISTS', detail: LIVE_422_DETAIL }), t);
    expect(text).toBe(LIVE_422_DETAIL);
  });

  it('all three agree on every refusal — one source, not three copies', () => {
    const samples: unknown[] = [
      httpError(409, LIVE_409),
      httpError(422, { error: 'PRIOR_SEAT_UNRESOLVED', detail: 'the seat was already used' }),
      httpError(409, { error: 'NOT_A_COUNCIL' }),
      httpError(403, { error: 'NOT_A_COUNCIL_MEMBER' }),
      httpError(503, { error: 'XRPL_DEFI_DISABLED' }),
      httpError(451, { error: 'GEOFENCE_BLOCKED: region not allowed' }),
      new Error('Xaman does not allow this app to create SignerListSet sign requests.'),
    ];
    for (const s of samples) {
      const a = said(proposalError, s, t);
      expect(said(proposeError, s, t)).toBe(a);
      expect(said(errText, s, t)).toBe(a);
      // …and none of them is a bare machine code.
      expect(a).not.toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it('ProposalInbox.errText no longer prints the r-address the signature door echoes', () => {
    const seat = 'rNaFfKeGDXFFEUqcCJdcgRfDjXfnq5Aoh6';
    const text = said(errText, httpError(403, { error: 'NOT_A_COUNCIL_MEMBER', detail: seat }), t);
    expect(text).not.toBe(seat);
    expect(text).toContain('registered');
    expect(text).toContain(seat);
  });

  it('a refusal is never reported as "nothing moved"', () => {
    for (const s of [httpError(409, LIVE_409), httpError(422, { error: 'PRIOR_SEAT_UNRESOLVED' })]) {
      for (const read of [proposalError, proposeError, errText]) {
        expect(said(read, s, t)).not.toMatch(/nothing (was signed|moved|happened)/i);
      }
    }
  });
});

/**
 * prosa-y-lectores — WHERE THE SEAT-CLAIM WARNING MAY SPEAK.
 *
 * It used to render on the unresolved row. It could not be TRUE there (the
 * listing floor `mayReadProposal` is the same predicate as the doors it warns
 * about, so a visible row is a row whose doors are open), and it could still
 * FIRE there, because `fetchMyWallets` swallows every error and returns `[]`
 * with `loading:false` — emptying `linkedAddrs` while the connected Xaman keeps
 * `myAddrs` populated. A warning derived from a list nobody read, at the exit
 * of a payment that may already have moved.
 */
type SeatClaim = 'linked' | 'unlinked' | 'none';
type RefusalCause = 'unlinked-wallet' | 'prove-membership' | 'none';

const seatClaimOf = extract<(s: string[], l: Set<string>, m: Set<string>) => SeatClaim>(
  inboxSrc,
  'function seatClaimOf(seats: string[], linkedAddrs: Set<string>, myAddrs: Set<string>): SeatClaim {',
  'function seatClaimOf(seats, linkedAddrs, myAddrs) {',
  'seatClaimOf',
);

const inboxRefusalCause = extract<
  (code: string, seats: string[], l: Set<string>, m: Set<string>, read: boolean, explained?: boolean) => RefusalCause
>(
  inboxSrc,
  'function inboxRefusalCause(code: string, seats: string[], linkedAddrs: Set<string>, myAddrs: Set<string>, registryWasRead: boolean, serverExplained = false): RefusalCause {',
  'function inboxRefusalCause(code, seats, linkedAddrs, myAddrs, registryWasRead, serverExplained = false) {',
  'inboxRefusalCause',
  { seatClaimOf },
);

const SEAT = 'rNaFfKeGDXFFEUqcCJdcgRfDjXfnq5Aoh6';

/**
 * LA DISTINCIÓN QUE ESTE BLOQUE PROTEGE, ACTUALIZADA.
 *
 * Lo que no puede pasar sigue siendo lo mismo: afirmar algo SOBRE LAS WALLETS DE
 * LA PERSONA a partir de una lista que nadie consiguió leer («la que tienes
 * conectada no está registrada» cuando `fetchMyWallets` se tragó el error y
 * devolvió `[]`). Eso sigue exigiendo evidencia positiva.
 *
 * Lo que sí cambió: cuando no hay esa evidencia, callar ya no es lo correcto —
 * desde la la pertenencia la decide una dirección PROBADA, y quedarse sin
 * decirlo deja a la persona con la frase de reserva, que todavía manda a
 * REGISTRAR. `prove-membership` no afirma nada sobre sus wallets: explica la
 * regla. Decir la regla no es emitir un veredicto sobre lo que no se ha leído.
 */
describe('prosa-y-lectores — no verdict over a list nobody read', () => {
  it('no afirma nada sobre el registro cuando la lectura no produjo evidencia', () => {
    // The `fetchMyWallets` swallow: `[]`, `loading:false`. `linkedAddrs` is
    // empty, the connected Xaman is still in `myAddrs` — the exact shape that
    // made the old warning fire, and the shape that proves nothing.
    expect(seatClaimOf([SEAT], new Set(), new Set([SEAT]))).toBe('unlinked');
    // Ya no es 'unlinked-wallet' (una afirmación sobre su registro) — es la
    // regla, que es verdad se haya leído lo que se haya leído.
    expect(inboxRefusalCause('NOT_A_COUNCIL_MEMBER', [SEAT], new Set(), new Set([SEAT]), false)).toBe(
      'prove-membership',
    );
  });

  it('names the cause only on the refusal it explains, and only with evidence', () => {
    expect(inboxRefusalCause('NOT_A_COUNCIL_MEMBER', [SEAT], new Set(), new Set([SEAT]), true)).toBe(
      'unlinked-wallet',
    );
    // Any other refusal keeps the server's own sentence alone.
    expect(inboxRefusalCause('LEGACY_ACCESS_REQUIRED', [SEAT], new Set(), new Set([SEAT]), true)).toBe('none');
    expect(inboxRefusalCause('', [SEAT], new Set(), new Set([SEAT]), true)).toBe('none');
  });

  it('con la wallet REGISTRADA el 403 ya no es de registro: es de prueba, y se dice', () => {
    expect(inboxRefusalCause('NOT_A_COUNCIL_MEMBER', [SEAT], new Set([SEAT]), new Set([SEAT]), true)).toBe(
      'prove-membership',
    );
  });

  it('sin nada conectado tampoco se calla — la regla es la misma', () => {
    expect(inboxRefusalCause('NOT_A_COUNCIL_MEMBER', [], new Set(), new Set(), true)).toBe('prove-membership');
  });

  it('y si el servidor ya lo explicó, la pantalla no lo repite con otras palabras', () => {
    expect(
      inboxRefusalCause('NOT_A_COUNCIL_MEMBER', [SEAT], new Set(), new Set([SEAT]), true, true),
    ).toBe('none');
  });
});

/**
 * LOS TRES CONSUMIDORES TIRABAN `unreadable[]`.
 *
 * Hizo que la fila indecidible viajase NOMBRADA en el 200 con su código y su
 * frase, «para que la pantalla diga: estas N no las pude leer». Ninguna pantalla lo
 * decía: los tres sitios que leen `GET /council/proposals` desestructuraban solo
 * `proposals`. El cableado es lo único que ninguna función pura puede sujetar, así
 * que se lee del fuente que se envía — igual que `seatUnresolved={tray === …}`.
 */
describe('`unreadable[]` llega a las tres pantallas', () => {
  const FEED = join(__dirname, '..', 'LegacyActivityFeed.tsx');
  const TRAY = join(__dirname, '..', '..', 'intents', 'SidebarIntents.tsx');
  const feedSrc = readFileSync(FEED, 'utf8');
  const traySrc = readFileSync(TRAY, 'utf8');

  it('la bandeja del consejo lo lee y lo dice', () => {
    expect(inboxSrc).toContain('const { proposals: list, unreadable } = await councilProposalsApi.list([account]);');
    expect(inboxSrc).toContain('setUnreadableRows(describeUnreadableRows(unreadable, tRef.current));');
    expect(inboxSrc).toContain('{unreadableRows.text}');
  });

  it('el historial lo lee y lo dice', () => {
    expect(feedSrc).toContain('setUnreadableRows(describeUnreadableRows(r.unreadable, tRef.current));');
    expect(feedSrc).toContain('{unreadableRows.text}');
  });

  it('la tarjeta lateral lo lee y — sobre todo — ya no lo borra', () => {
    expect(traySrc).toContain('setUnreadable(councilTrayUnreadable(r, tRef.current));');
    // La línea que apagaba el aviso en el `then` del éxito ya no existe.
    expect(traySrc).not.toContain('setRows(r.proposals ?? []);\n          setUnreadable(null);');
  });
});

/**
 * EL HISTORIAL SE TRAGABA EL RECHAZO ENTERO.
 *
 * `LegacyActivityFeed` leía las propuestas con `.catch(() => [])`: un 403
 * `NOT_A_COUNCIL_MEMBER`, o el 503 `PROPOSALS_READ_UNREADABLE` que la acaba de
 * crear, se iban sin una palabra. El comentario de al lado decía que «un rechazo
 * entero deja el aviso anterior EN PIE» — y es cierto salvo en el caso normal: en la
 * PRIMERA carga no hay aviso anterior, hay silencio. La familia abría el historial de
 * su Legacy, veía sus reglas y sus compromisos y ninguna propuesta, y leía un registro
 * completo de una lectura que no ocurrió.
 */
describe('Un rechazo entero se dice, también en la primera carga', () => {
  const FEED = join(__dirname, '..', 'LegacyActivityFeed.tsx');
  const feedSrc = readFileSync(FEED, 'utf8');

  it('el `catch` ya no devuelve una lista vacía a secas: la nombra', () => {
    expect(feedSrc).not.toContain('.catch(() => [] as CouncilProposalRecord[])');
    expect(feedSrc).toContain('setProposalsRefusal(describeServerRefusal(e, tRef.current));');
    // Y solo una lectura que SÍ ocurrió puede apagarlo.
    expect(feedSrc).toContain('setProposalsRefusal(null);');
  });

  it('el aviso llega a pantalla con las salidas del servidor y su puerta', () => {
    expect(feedSrc).toContain('<ServerRefusalBody refusal={proposalsRefusal} t={t} />');
    // El reintento no se ofrece sobre un veredicto: lo decide el lector compartido.
    expect(feedSrc).toContain('refusalMayRetry(proposalsRefusal)');
  });

  it('y «Nothing here yet» no puede emitirse sobre una lectura rechazada', () => {
    // Un veredicto sobre el historial completo, encima de una lista a la que le
    // falta justo la mitad que no se pudo leer.
    expect(feedSrc).toContain('proposalsRefusal ? null : (');
  });

  it('los dos rechazos reales producen una frase, no un slug — y la del 403 lleva salida', () => {
    const listing403 = said(errText, httpError(403, { error: 'NOT_A_COUNCIL_MEMBER' }), t);
    expect(listing403).not.toBe('NOT_A_COUNCIL_MEMBER');
    expect(listing403).toContain('member of this council');
    const read503 = describeServerRefusal(
      httpError(503, {
        error: 'PROPOSALS_READ_UNREADABLE',
        retryable: true,
        detail: 'We could not read this council’s proposals. Nothing was decided about them.',
      }),
      t,
    );
    expect(read503.text).toContain('could not read');
    // «No pude leer» no es permiso, ni castigo: se reintenta porque el servidor lo dijo.
    expect(read503.retryable).toBe(true);
    // Y el 403 de la misma lectura ofrece la puerta que el usuario de email necesita.
    expect(describeServerRefusal(httpError(403, { error: 'NOT_A_COUNCIL_MEMBER' }), t).door?.href).toBe(
      '/app/wallets',
    );
  });
});

/**
 * LA PROSA LLEGABA Y EL BOTÓN NO.
 *
 * El arreglo va en el lector compartido, no en ocho pantallas: `serverRefusal` trae
 * ahora `headline`, `ways[]`, `retryAfterSeconds` y la puerta, y `ServerRefusalBody`
 * es la única pieza que los pinta. Lo que ningún test puro puede sujetar es que las
 * pantallas la MONTEN — así que se lee del fuente que se envía.
 */
describe('Las pantallas ofrecen el camino que el servidor nombró', () => {
  const POSITIONS = join(__dirname, '..', 'FormalPositions.tsx');
  const surfaces: Array<[string, string]> = [
    ['ProposeToCouncil', proposeSrc],
    ['GovernedMovements', movementsSrc],
    ['ProposalInbox', inboxSrc],
    ['FormalPositions', readFileSync(POSITIONS, 'utf8')],
  ];

  it.each(surfaces)('%s monta el lector compartido', (_name, src) => {
    expect(src).toContain("import { ServerRefusalBody } from '../ui/ServerRefusalBody';");
    expect(src).toContain('<ServerRefusalBody refusal=');
  });

  it('la puerta de posiciones deja de imprimir el código crudo y la r-address', () => {
    const positionsSrc = readFileSync(POSITIONS, 'utf8');
    // La gemela que quedaba sin delegar: `detail || message`.
    expect(positionsSrc).not.toContain("return d || err?.message || 'Unexpected error';");
    expect(positionsSrc).toContain('return describeServerRefusal(err, t);');
  });
});
