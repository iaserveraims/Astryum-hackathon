import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WALLET_SIGN_IN_HREF,
  describeServerRefusal,
  describeUnreadableRows,
  readServerRefusal,
  refusalMayRetry,
  serverRefusalText,
} from '../serverRefusal';

/**
 * detail-ceremonia — the aviso that prevents a double payment must arrive as
 * prose at the four ceremony surfaces, not as a bare code.
 *
 * These run the reader, not the source: every case builds the SAME rejection
 * `jpost` builds (`Object.assign(new Error(body.error), { status, body })`) and
 * asserts the sentence a council would read.
 */

/** Identity `t`, like `useT()` outside a provider — the assertions are on the
 *  English source strings, which is what ships when the dictionary misses. */
const t = (s: string) => s;
/** A `t` that proves the copy really travels through the dictionary. */
const shout = (s: string) => `ES:${s}`;

/** Exactly what `jpost` throws for a non-ok response. */
function jpostError(status: number, body: unknown): Error {
  const b = body as { error?: string } | null;
  return Object.assign(new Error(b?.error ?? `http_${status}`), { status, body });
}

/** The real 422 body of the seat guard (backend/src/routes/xrplDefi.ts, d533b67). */
const SEAT_GUARD_422 = {
  error: 'PRIOR_SEAT_UNRESOLVED',
  detail:
    'A previous proposal on this account (Monthly payment to the school) is not settled: ' +
    'the account Sequence has moved past the one this proposal pinned, so a transaction from this seat was already applied. ' +
    'Composing another one now is exactly how a council pays twice. Open it in the proposal inbox, ' +
    'check the account on an explorer, and either register the transaction hash it produced (any member can) ' +
    'or file it — then compose.',
  proposalId: 'cprop_123',
  ledgerCheck: { verdict: 'seat_spent', detail: 'Sequence 41 > pinned 40' },
};

describe('serverRefusal — the seat guard reaches the family as prose', () => {
  it('renders the 422 detail, never the slug', () => {
    const text = serverRefusalText(jpostError(422, SEAT_GUARD_422), t);
    expect(text).toBe(SEAT_GUARD_422.detail);
    expect(text).not.toBe('PRIOR_SEAT_UNRESOLVED');
    expect(text).toContain('pays twice');
  });

  it('reproduces the OLD behaviour to prove it was a dead end', () => {
    // What the ceremony did before: `setError((e as Error).message)`.
    const err = jpostError(422, SEAT_GUARD_422);
    expect(err.message).toBe('PRIOR_SEAT_UNRESOLVED');
    expect(describeServerRefusal(err, t).text).not.toBe(err.message);
  });

  it('still says something human when the server sends no detail', () => {
    const text = serverRefusalText(jpostError(422, { error: 'PRIOR_SEAT_UNRESOLVED' }), t);
    expect(text).toContain('pays twice');
    expect(text).toContain('proposal inbox');
    expect(text).not.toContain('PRIOR_SEAT_UNRESOLVED');
  });

  it('sends the reserve sentence through the dictionary', () => {
    const text = serverRefusalText(jpostError(422, { error: 'PRIOR_SEAT_UNRESOLVED' }), shout);
    expect(text.startsWith('ES:')).toBe(true);
  });

  it('keeps the code and the raw message readable for support', () => {
    const r = describeServerRefusal(jpostError(422, SEAT_GUARD_422), t);
    expect(r.code).toBe('PRIOR_SEAT_UNRESOLVED');
    expect(r.raw).toBe('PRIOR_SEAT_UNRESOLVED');
    expect(r.status).toBe(422);
    expect(r.detail).toBe(SEAT_GUARD_422.detail);
  });
});

describe('serverRefusal — the superset of the six twins', () => {
  it('collapses an array detail (zod issues) instead of printing [object Object]', () => {
    const err = jpostError(400, { error: 'INVALID_BODY', detail: ['account: invalid XRPL address', 'xrplTx: required'] });
    expect(serverRefusalText(err, t)).toBe('account: invalid XRPL address; xrplTx: required');
  });

  it('drops non-strings from the array — errText would have printed "undefined"', () => {
    const err = jpostError(400, { error: 'INVALID_BODY', detail: ['account: invalid XRPL address', undefined, 7, ''] });
    expect(serverRefusalText(err, t)).toBe('account: invalid XRPL address');
  });

  it('lets the feature-flag refusal win over any detail (infrastructure first)', () => {
    const err = jpostError(503, { error: 'XRPL_DEFI_DISABLED', detail: 'flag off' });
    expect(serverRefusalText(err, t)).toBe('XRPL composition is not enabled on this deployment yet (feature flag off).');
  });

  it('reads the geofence code even with its reason tail', () => {
    const err = jpostError(451, { error: 'GEOFENCE_BLOCKED: region not allowed' });
    expect(serverRefusalText(err, t)).toContain('not available for your region');
  });

  it('turns the access-list 403 into copy, not into "access check failed"', () => {
    const err = jpostError(403, { error: 'LEGACY_ACCESS_REQUIRED', detail: 'access check failed' });
    expect(serverRefusalText(err, t)).toBe('This account is not on the Legacy access list on the server.');
  });

  it('names an expired session on a 401', () => {
    expect(serverRefusalText(jpostError(401, { error: 'missing_siwe_session' }), t)).toContain('session expired');
  });

  it('prefers the server detail on a 409 NOT_A_COUNCIL, and has a reserve without it', () => {
    expect(serverRefusalText(jpostError(409, { error: 'NOT_A_COUNCIL', detail: 'rXYZ has no signer list' }), t)).toBe(
      'rXYZ has no signer list',
    );
    expect(serverRefusalText(jpostError(409, { error: 'NOT_A_COUNCIL' }), t)).toContain('not a council yet');
  });
});

describe('serverRefusal — never a dead end, never a false verdict', () => {
  it('passes prose through untouched (Xaman 1217 is not an HTTP envelope)', () => {
    const xaman =
      'Xaman does not allow this app to create SignerListSet sign requests. ' +
      'Account-security transaction types are granted per app by Xaman support (in-app).';
    const r = describeServerRefusal(new Error(xaman), t);
    expect(r.text).toBe(xaman);
    expect(r.raw).toBe(xaman);
    expect(r.code).toBe('');
  });

  it('does not show a naked unknown code, but keeps it for support', () => {
    const text = serverRefusalText(jpostError(418, { error: 'SOME_NEW_CODE' }), t);
    expect(text).toBe('The server refused this and did not explain why. (SOME_NEW_CODE)');
  });

  it('treats the `http_<status>` placeholder as a code, not as a sentence', () => {
    const text = serverRefusalText(jpostError(500, null), t);
    expect(text).toBe('The server refused this and did not explain why. (http_500)');
  });

  it('never claims money did not move — it only reports a refusal', () => {
    const samples = [
      jpostError(422, SEAT_GUARD_422),
      jpostError(422, { error: 'PRIOR_SEAT_UNRESOLVED' }),
      jpostError(418, { error: 'SOME_NEW_CODE' }),
      jpostError(500, null),
      new Error('There were 0 transactions to multisign'),
    ];
    for (const s of samples) {
      const text = serverRefusalText(s, t);
      expect(text).not.toMatch(/nothing (was signed|moved)/i);
    }
  });

  it('falls back to the generic only when there is nothing at all', () => {
    expect(serverRefusalText(new Error(''), t)).toBe('Something went wrong.');
    expect(serverRefusalText(undefined, t)).toBe('Something went wrong.');
  });

  it('reads a plain string throw', () => {
    expect(readServerRefusal('boom, the node closed the socket').raw).toBe('boom, the node closed the socket');
    expect(serverRefusalText('boom, the node closed the socket', t)).toBe('boom, the node closed the socket');
  });
});

/**
 * prosa-y-lectores — THE BACKEND FIXED ITS PROSE AND NOTHING CARRIED IT.
 *
 * Three hardcoded copies stood between the server and the family
 * (ProposeToCouncil, GovernedMovements.proposeError and this file's own
 * reserve), and all three still said "emit, withdraw or let it expire" — the
 * wording the backend retired this round because inside its deadline
 * `withdraw` reads no ledger and issues no verdict, and "let it expire" is the
 * seven-day wait that then lands on the unresolved-seat guard. It was making
 * the least-checked exit the busiest one, on a rail whose whole point is that
 * a council must not pay twice.
 */

/** The 409 `POST /council/proposals` really answers now (backend/src/routes/councilProposals.ts). */
const LIVE_PROPOSAL_409 = {
  error: 'LIVE_PROPOSAL_EXISTS',
  detail:
    'This account already has a proposal collecting signatures, and XRPL pins one Sequence at a time. ' +
    'Settle that one in the proposal inbox first: finish collecting its signatures and broadcast it, or ' +
    'register the transaction hash if it has already gone out — any member can do either.',
  proposalId: 'cprop_live',
};

describe('serverRefusal — the retired door is gone from the last copy', () => {
  it('hands the server sentence through untouched on the live-proposal 409', () => {
    const text = serverRefusalText(jpostError(409, LIVE_PROPOSAL_409), t);
    expect(text).toBe(LIVE_PROPOSAL_409.detail);
    expect(text).not.toMatch(/let it expire/i);
  });

  it('no longer points at "let it expire" when the server sends no detail', () => {
    const text = serverRefusalText(jpostError(409, { error: 'LIVE_PROPOSAL_EXISTS' }), t);
    expect(text).not.toMatch(/let it expire/i);
    expect(text).not.toMatch(/withdraw/i);
    // The exits that actually settle the seat, and where they live.
    expect(text).toContain('proposal inbox');
    expect(text).toContain('broadcast');
    expect(text).toContain('transaction hash');
    expect(text).not.toBe('LIVE_PROPOSAL_EXISTS');
  });

  it('sends that reserve through the dictionary too', () => {
    expect(serverRefusalText(jpostError(409, { error: 'LIVE_PROPOSAL_EXISTS' }), shout).startsWith('ES:')).toBe(true);
  });
});

describe('serverRefusal — the new permission floor reaches the family as prose', () => {
  /** The listing 403 of `GET /council/proposals` (round-4 `mayReadProposal`). */
  const LISTING_403 = {
    error: 'NOT_A_COUNCIL_MEMBER',
    detail:
      'These proposals belong to a council you are not a member of. The inbox of a council is readable by its ' +
      'signer list and by whoever composed each proposal.',
  };

  it('prefers the server detail on the listing refusal', () => {
    expect(serverRefusalText(jpostError(403, LISTING_403), t)).toBe(LISTING_403.detail);
  });

  it('has a sentence of its own when the detail is missing — the code existed nowhere in the client', () => {
    const text = serverRefusalText(jpostError(403, { error: 'NOT_A_COUNCIL_MEMBER' }), t);
    expect(text).not.toBe('NOT_A_COUNCIL_MEMBER');
    expect(text).not.toContain('NOT_A_COUNCIL_MEMBER');
    expect(text).toContain('registered');
  });

  it('does NOT print the bare r-address the signature door echoes as `detail`', () => {
    // `POST /:id/signatures` answers `{ error: NOT_A_COUNCIL_MEMBER, detail: signerAccount }`.
    // Letting detail win put `rNaFf…` on screen AS the explanation — the same
    // dead end as the slug, one field over, at the door that completes a quorum.
    const seat = 'rNaFfKeGDXFFEUqcCJdcgRfDjXfnq5Aoh6';
    const text = serverRefusalText(jpostError(403, { error: 'NOT_A_COUNCIL_MEMBER', detail: seat }), t);
    expect(text).not.toBe(seat);
    expect(text).toContain('registered');
    // …and the address is not lost: it is the evidence of WHICH seat was refused.
    expect(text).toContain(seat);
  });

  it('still lets a one-word PROSE-less detail through the same rule on any code', () => {
    const text = serverRefusalText(jpostError(409, { error: 'NOT_A_COUNCIL', detail: 'rXYZ' }), t);
    expect(text).toContain('not a council yet');
    expect(text).toContain('rXYZ');
  });

  it('never reports a refusal as "nothing happened"', () => {
    for (const s of [
      jpostError(403, LISTING_403),
      jpostError(403, { error: 'NOT_A_COUNCIL_MEMBER' }),
      jpostError(409, LIVE_PROPOSAL_409),
    ]) {
      expect(serverRefusalText(s, t)).not.toMatch(/nothing (was signed|moved|happened)/i);
    }
  });
});

/**
 * productizer it. 25 (1) — LA FILA QUE NO PUDIMOS LEER TENÍA QUE LLEGAR A LA PANTALLA.
 *
 * it. 23 dejó de tirarla en el servidor: `GET /council/proposals` contesta 200 con
 * las legibles en `proposals` y las indecidibles NOMBRADAS en `unreadable[]`, con el
 * mismo cuerpo (`error`/`retryable`/`detail`) que llevaría la respuesta entera si no
 * hubiese nada legible. Pero el cliente no declaraba el campo y los consumidores
 * desestructuraban solo `proposals`: la fila volvía a desaparecer. Este es el lector
 * único que la convierte en una frase — y el que prueba que NO desaparece.
 */
describe('it. 25 (1) — describeUnreadableRows: las filas ilegibles se cuentan y se dicen', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'p2',
    account: 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf',
    error: 'PROOF_STORE_UNREADABLE',
    retryable: true,
    detail: 'We could not read your wallet proofs just now. Try again in a moment.',
    ...over,
  });

  it('sin filas no hay aviso — un 200 completo no inventa una advertencia', () => {
    expect(describeUnreadableRows(undefined, t)).toBeNull();
    expect(describeUnreadableRows([], t)).toBeNull();
    expect(describeUnreadableRows(null, t)).toBeNull();
  });

  it('LA FILA SE PINTA: cuenta, frase del servidor y código entre paréntesis', () => {
    const n = describeUnreadableRows([row(), row({ id: 'p3' })], t)!;
    expect(n).not.toBeNull();
    expect(n.count).toBe(2);
    expect(n.ids).toEqual(['p2', 'p3']);
    expect(n.text).toContain('2');
    expect(n.text).toContain('could not be read');
    // La prosa del servidor manda sobre cualquier copia del cliente.
    expect(n.text).toContain('wallet proofs');
    // El código viaja, pero JAMÁS como la frase.
    expect(n.text).toContain('(PROOF_STORE_UNREADABLE)');
    expect(n.text).not.toBe('PROOF_STORE_UNREADABLE');
    expect(n.codes).toEqual(['PROOF_STORE_UNREADABLE']);
    expect(n.retryable).toBe(true);
  });

  it('nunca afirma nada sobre la persona: no es un «no eres miembro»', () => {
    const n = describeUnreadableRows([row()], t)!;
    expect(n.text).toContain('not an empty inbox');
    expect(n.text).not.toMatch(/you are not a member/i);
  });

  it('un código SIN prosa sigue teniendo su frase de reserva', () => {
    const n = describeUnreadableRows([{ id: 'p9', error: 'PRIOR_SEAT_UNRESOLVED' }], t)!;
    expect(n.text).toContain('pays twice');
    expect(n.text).not.toMatch(/^PRIOR_SEAT_UNRESOLVED/);
    // Sin `retryable: true` del servidor, no se promete un reintento.
    expect(n.retryable).toBe(false);
  });

  it('un 409 determinista no se disfraza de reintento', () => {
    const n = describeUnreadableRows(
      [row({ error: 'ACCOUNT_RECORD_MISSING', retryable: false, detail: 'The account record is missing.' })],
      t,
    )!;
    expect(n.retryable).toBe(false);
  });
});

/**
 * productizer it. 25 (3) — «LIQUIDA ESA FILA» ANTES DE MIRAR EL EXPLORADOR.
 *
 * La reserva de `PRIOR_SEAT_UNRESOLVED` —la que habla cuando el `detail` no llega—
 * mandaba a registrar el hash o a archivar la propuesta sin decir el primer paso. La
 * razón por la que esa fila está sin liquidar es, con frecuencia, que NO SABEMOS si
 * llegó a ejecutarse: archivar o re-difundir algo que pudo aterrizar es el pago doble
 * en persona.
 */
describe('it. 25 (3) — el asiento sin resolver manda al explorador ANTES que a la bandeja', () => {
  it('nombra el explorador, y lo nombra primero', () => {
    const text = serverRefusalText(jpostError(422, { error: 'PRIOR_SEAT_UNRESOLVED' }), t);
    expect(text).toContain('explorer');
    expect(text.indexOf('explorer')).toBeLessThan(text.indexOf('proposal inbox'));
    // Y no ha perdido lo que ya decía.
    expect(text).toContain('pays twice');
    expect(text).toContain('register the transaction hash');
  });
});

/**
 * productizer it. 27 (3) — EL LECTOR COMPARTIDO TIRABA `headline`, `ways[]` Y
 * `retryAfterSeconds`.
 *
 * QUÉ SE VEÍA. `backend/src/services/identity/provenAddresses.ts` construye cada
 * rechazo con su titular, sus SALIDAS REALES (una frase por salida, en orden) y —solo
 * en el único que de verdad se cura esperando— sus segundos; las rutas los mandan
 * verbatim. Este lector devolvía UNA CADENA, así que todo eso moría aquí, y la única
 * pantalla con una puerta era `SeatRefusalNotice` (el carril 0xFE). El usuario de
 * email/Google —el ÚNICO perfil que se come estos rechazos, porque van sobre un
 * registro de cuenta y una wallet firmada no necesita ninguno— llegaba a la bandeja
 * del consejo, leía «Sign in with the wallet that controls this address» y no tenía
 * NADA QUE PULSAR. Tres iteraciones seguidas rescatado con prosa a secas.
 */
describe('it. 27 (3) — el sobre entero llega, y con él un camino que se puede pulsar', () => {
  /** El cuerpo exacto de `PROOF_REFUSALS.PROOF_STORE_UNREADABLE` (503, verbatim). */
  const STORE_UNREADABLE = {
    error: 'PROOF_STORE_UNREADABLE',
    detail: 'We could not read the wallet proofs of this account.',
    retryable: true,
    retryAfterSeconds: 3,
    headline: 'We could not read your wallet proofs just now',
    ways: [
      'Try again in a moment — this one really does clear on its own.',
      'If it keeps failing, sign in again with the wallet that controls this account.',
    ],
  };

  it('las salidas y el titular del servidor viajan VERBATIM, y no se cuelan en la frase', () => {
    const r = describeServerRefusal(jpostError(503, STORE_UNREADABLE), t);
    expect(r.headline).toBe(STORE_UNREADABLE.headline);
    expect(r.ways).toEqual(STORE_UNREADABLE.ways);
    expect(r.retryAfterSeconds).toBe(3);
    // La frase sigue siendo la del servidor, sin coletillas: una salida es un
    // botón, no un párrafo más largo.
    expect(r.text).toBe(STORE_UNREADABLE.detail);
  });

  it('el 403 de la bandeja del consejo trae puerta — antes era prosa y nada más', () => {
    const r = describeServerRefusal(jpostError(403, { error: 'NOT_A_COUNCIL_MEMBER' }), t);
    expect(r.door).toEqual({ label: 'Sign in with your wallet', href: WALLET_SIGN_IN_HREF });
    expect(r.ways.length).toBeGreaterThan(0);
    // Y las salidas de reserva nombran las DOS puertas reales, no solo registrar.
    expect(r.ways.join(' ')).toContain('Sign in with the wallet that holds your seat');
    expect(r.ways.join(' ')).toContain('binding challenge');
  });

  it('los dos 409 deterministas también, y JAMÁS ofrecen esperar', () => {
    for (const code of ['ACCOUNT_RECORD_MISSING', 'PROOF_FLOOR_UNREADABLE']) {
      const r = describeServerRefusal(jpostError(409, { error: code }), t);
      expect(r.door?.href).toBe(WALLET_SIGN_IN_HREF);
      expect(r.ways.join(' ')).not.toMatch(/try again|in a moment/i);
      expect(refusalMayRetry(r)).toBe(false);
    }
  });

  it('un rechazo que no se cura con una wallet no inventa una puerta', () => {
    expect(describeServerRefusal(jpostError(409, { error: 'NOT_A_COUNCIL' }), t).door).toBeNull();
    expect(describeServerRefusal(jpostError(422, SEAT_GUARD_422), t).door).toBeNull();
    expect(describeServerRefusal(jpostError(409, { error: 'LIVE_PROPOSAL_EXISTS' }), t).ways).toEqual([]);
  });

  it('la puerta también sale de la prosa del servidor, para un código que este lector no conoce', () => {
    const r = describeServerRefusal(
      jpostError(409, {
        error: 'SOME_NEW_PROOF_CODE',
        detail: 'This will not fix itself by waiting. Sign in with the wallet that controls this address.',
      }),
      t,
    );
    expect(r.door?.href).toBe(WALLET_SIGN_IN_HREF);
  });

  it('`retryable` del servidor manda siempre; sin él, solo un fallo nuestro admite reintento', () => {
    expect(refusalMayRetry(readServerRefusal(jpostError(503, STORE_UNREADABLE)))).toBe(true);
    expect(refusalMayRetry(readServerRefusal(jpostError(403, { error: 'NOT_A_COUNCIL_MEMBER' })))).toBe(false);
    expect(refusalMayRetry(readServerRefusal(jpostError(503, { error: 'PROPOSALS_READ_UNREADABLE' })))).toBe(true);
    // Una llamada que ni llegó a tener status es un fallo nuestro, no un veredicto.
    expect(refusalMayRetry(readServerRefusal(new Error('network down')))).toBe(true);
  });

  it('el 409 de la puerta de posiciones deja de ser un slug — y no promete reintentar', () => {
    const text = serverRefusalText(jpostError(409, { error: 'POSITION_ALREADY_SET' }), t);
    expect(text).not.toBe('POSITION_ALREADY_SET');
    expect(text).toContain('immutable');
    expect(text).toContain('Nothing was lost and nothing moved');
    expect(text).not.toMatch(/try again/i);
  });

  it('la puerta apunta al MISMO sitio que el carril 0xFE — dos constantes no pueden separarse', () => {
    const SEAT_NOTICE = join(__dirname, '..', '..', '..', 'components', 'wallet', 'SeatRefusalNotice.tsx');
    const src = readFileSync(SEAT_NOTICE, 'utf8');
    expect(src).toContain(`export const WALLET_SIGN_IN_HREF = '${WALLET_SIGN_IN_HREF}';`);
  });
});
