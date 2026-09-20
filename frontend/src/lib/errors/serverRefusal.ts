'use client';

/**
 * serverRefusal — the ONE reader for "the server said no" (detail-ceremonia).
 *
 * WHAT FAILED IN SILENCE. `jpost`/`jget` (services/v1Api) build their rejection
 * as `Object.assign(new Error(body.error), { status, body })`: the machine CODE
 * lands in `Error.message` and the honest prose sits unread in `.body.detail`.
 * Every catch block that renders `(e as Error).message` therefore renders the
 * code. The seat guard of d533b67 is the proof of what that costs: composing a
 * second transaction over an unsettled council seat answers 422 with ~380
 * characters explaining that this is *exactly how a council pays twice* — and
 * the same-sitting ceremony (CouncilMultisigFlow, mounted by LegacyPanel,
 * CouncilOrderCard, CouncilVaultEntry and CageBirthCard) painted the bare slug
 * `PRIOR_SEAT_UNRESOLVED`. A dead end at the exact moment the server is
 * stopping a double payment.
 */

export interface ServerRefusal {
  /** HTTP status, when the failure came from an HTTP call. */
  status?: number;
  /** `body.error` when present; otherwise `message` if it looks like a code. */
  code: string;
  /** `body.detail` with arrays collapsed and non-strings dropped; '' if absent. */
  detail: string;
  /** `Error.message` verbatim — what callers still pattern-match on. */
  raw: string;
  /**
   * LOS TRES CAMPOS QUE EL LECTOR COMPARTIDO TIRABA.
   *
   * `provenAddresses.ts` construye cada rechazo con `headline`, `ways[]` y
   * (cuando de verdad se cura esperando) `retryAfterSeconds`, y las rutas los
   * mandan verbatim. Este lector devolvía UNA CADENA, así que la única pantalla
   * que ofrecía una puerta era `SeatRefusalNotice` — la del carril 0xFE. El
   * usuario de email/Google llegaba a la bandeja del consejo, leía «Sign in with
   * the wallet that controls this address» y no tenía nada que pulsar.
   */
  /** `body.headline` — la línea corta de arriba. Ausente si no la mandó. */
  headline?: string;
  /** `body.ways` — las salidas reales, en orden, solo cadenas. */
  ways?: string[];
  /** `body.retryAfterSeconds` / `retryAfter` / `retry_after`, si es positivo. */
  retryAfterSeconds?: number;
  /** `body.retryable` — el servidor diciendo si esto se cura esperando. */
  retryable?: boolean;
}

/**
 * La puerta que este lector sabe abrir: un ENLACE, jamás una llamada. Un lector
 * de rechazos no decide nada — solo deja de ser un callejón sin salida.
 */
export interface RefusalDoor {
  /** Las palabras del botón, ya traducidas. */
  label: string;
  href: string;
}

/**
 * Adónde va de verdad «sign in with the wallet that controls this address».
 *
 * `/app/wallets` es la superficie que inicia sesión con una wallet y ata una por
 * firma (`WalletManager`), que es justo el par de puertas que nombra la frase.
 * GEMELO PINEADO: `components/wallet/SeatRefusalNotice.tsx` declara el mismo
 * literal para el carril 0xFE, y `serverRefusal.test.ts` lee ese fuente para que
 * las dos no puedan separarse.
 */
export const WALLET_SIGN_IN_HREF = '/app/wallets';

export interface ReadableRefusal extends ServerRefusal {
  /** The sentence to put in front of a person, already translated. */
  text: string;
  /** El titular del servidor, o '' — nunca se inventa uno. */
  headline: string;
  /** Las salidas: las del servidor si las mandó, si no las de la reserva. */
  ways: string[];
  /** La puerta accionable, o null. */
  door: RefusalDoor | null;
}

/** Zod issue lists arrive as arrays; ' · ' vs '; ' was the only difference
 *  between the twins, so one separator wins and it is the majority one. */
const DETAIL_SEPARATOR = '; ';

/**
 * Is this string a machine code rather than a sentence? `PRIOR_SEAT_UNRESOLVED`,
 * `http_422` and `missing_siwe_session` are; "Xaman does not allow this app…"
 * and an XRPL revert string are not. Whitespace is the tell.
 */
function looksLikeMachineCode(s: string): boolean {
  if (!s || /\s/.test(s)) return false;
  return /^[A-Z][A-Z0-9_]*$/.test(s) || /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(s);
}

/**
 * prosa-y-lectores — IS THIS `detail` A SENTENCE, OR AN IDENTIFIER THE ROUTE
 * ECHOED BACK?
 */
function detailIsProse(detail: string): boolean {
  return /\s/.test(detail);
}

function collapseDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail.trim();
  if (Array.isArray(detail)) {
    return detail
      .filter((d): d is string => typeof d === 'string' && d.trim() !== '')
      .join(DETAIL_SEPARATOR);
  }
  return '';
}

/**
 * Pull the envelope apart WITHOUT deciding what to say — the half a caller
 * needs when it also has to pattern-match the raw text (the ceremony's Xaman
 * 1217 dead-end guard reads `raw`, never the humanised sentence).
 */
export function readServerRefusal(err: unknown): ServerRefusal {
  const e = (err ?? {}) as {
    status?: unknown;
    message?: unknown;
    body?: Record<string, unknown> | null;
  };
  const raw = typeof err === 'string' ? err : typeof e.message === 'string' ? e.message : '';
  const bodyError = typeof e.body?.error === 'string' ? (e.body.error as string) : '';
  const code = bodyError || (looksLikeMachineCode(raw) ? raw : '');
  // El sobre entero, no solo `detail`. Nada de esto DECIDE — son
  // campos que el servidor mandó y que este lector venía tirando al suelo.
  const headline = typeof e.body?.headline === 'string' ? (e.body.headline as string).trim() : '';
  const ways = collapseWays(e.body?.ways);
  const retryAfterSeconds = positiveSeconds(e.body);
  const retryable = typeof e.body?.retryable === 'boolean' ? (e.body.retryable as boolean) : undefined;
  return {
    status: typeof e.status === 'number' ? e.status : undefined,
    code,
    detail: collapseDetail(e.body?.detail),
    raw,
    ...(headline ? { headline } : {}),
    ...(ways.length > 0 ? { ways } : {}),
    ...(retryAfterSeconds !== null ? { retryAfterSeconds } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
  };
}

/**
 * ¿Puede una pantalla ofrecer «intentar otra vez» sin prometer nada?
 *
 * . El servidor lo dice cuando lo sabe (`retryable`), y esa palabra
 * manda siempre. Cuando no lo dice, solo se ofrece sobre un fallo que PARECE
 * nuestro — 5xx, o una llamada que ni llegó a tener status. Un 4xx sin
 * `retryable` es un veredicto: volver a preguntar contesta lo mismo para
 * siempre, y un botón ahí es una promesa que nadie puede cumplir.
 */
export function refusalMayRetry(r: Pick<ServerRefusal, 'retryable' | 'status'>): boolean {
  if (typeof r.retryable === 'boolean') return r.retryable;
  return r.status === undefined || r.status >= 500;
}

/** `ways` es una lista de FRASES: se quedan las cadenas con contenido, en orden. */
function collapseWays(ways: unknown): string[] {
  if (!Array.isArray(ways)) return [];
  const out: string[] = [];
  for (const w of ways) {
    if (typeof w !== 'string') continue;
    const trimmed = w.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/** `Retry-After` en segundos, del campo que el servidor haya usado. */
function positiveSeconds(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  for (const key of ['retryAfterSeconds', 'retryAfter', 'retry_after']) {
    const v = o[key];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * Infrastructure refusals: the door is shut for a reason that has nothing to do
 * with what was being composed, and the server's `detail` there is machinery
 * ('access check failed'), so the client sentence supersedes it. Copy taken
 * VERBATIM from LegacyPanel.gateMessage / GovernedMovements.proposeError so the
 * existing dictionary entries keep serving it — no new i18n keys, no drift.
 */
function infrastructureText(r: ServerRefusal, t: (s: string) => string): string | null {
  if (r.code === 'XRPL_DEFI_DISABLED' || r.raw.includes('XRPL_DEFI_DISABLED')) {
    return t('XRPL composition is not enabled on this deployment yet (feature flag off).');
  }
  // 451 carries `GEOFENCE_BLOCKED: <reason>` — a code with a tail, not a bare code.
  if (r.status === 451 || r.code.startsWith('GEOFENCE_BLOCKED') || r.raw.includes('GEOFENCE_BLOCKED')) {
    return t('DeFi execution is not available for your region. Set your region in Settings — monitoring stays available.');
  }
  if (r.status === 401) return t('Your session expired — sign in again to continue.');
  if (r.code === 'LEGACY_ACCESS_REQUIRED' || r.raw.includes('LEGACY_ACCESS_REQUIRED')) {
    return t('This account is not on the Legacy access list on the server.');
  }
  return null;
}

/**
 * The reserve: a refusal code whose `detail` never arrived still has to read as
 * a sentence. This is the half nobody had — all six twins fall through to
 * `.message`, which IS the code. The seat guard is why it exists:
 * `PRIOR_SEAT_UNRESOLVED` with no prose must still tell a council why it must
 * not compose again.
 */
function reserveText(code: string, t: (s: string) => string): string | null {
  switch (code) {
    /**
     * MANDABA A LIQUIDAR ANTES DE MIRAR EL EXPLORADOR.
     *
     * «Register the transaction hash it produced, or file it» son las dos únicas
     * salidas reales, sí — pero la razón por la que esa fila está sin liquidar es,
     * con frecuencia, que NO SABEMOS si llegó a ejecutarse (`ledgerCheck` en estado
     * `unverified`, o un asiento que el ledger ya consumió). Archivar o re-difundir
     * algo que pudo aterrizar es el pago doble en persona. Añadió el paso del
     * explorador a la prosa del servidor (`routes/xrplDefi.ts`,
     * `routes/councilProposals.ts`) y esta reserva —la que habla cuando el `detail`
     * no llega— se quedó sin él.
     */
    case 'PRIOR_SEAT_UNRESOLVED':
      return `${t(
        'Look the account up on an explorer BEFORE you touch that proposal: what is unsettled about it may be a payment that already landed, and re-broadcasting it or filing it as withdrawn is the double payment itself.',
      )} ${t(
        'A previous proposal on this account is not settled yet, and composing another one now is how a council pays twice. Open the proposal inbox: register the transaction hash it produced, or file it — then compose again.',
      )}`;
    // prosa-y-lectores — THE SENTENCE THAT SENT PEOPLE THROUGH THE WRONG DOOR.
    // This reserve used to end in "emit, withdraw or let it expire before
    // creating another", and the backend retired exactly that wording this
    // round (routes/councilProposals.ts and routes/xrplDefi.ts): inside its
    // deadline `POST /:id/withdraw` reads no ledger and issues no verdict, so
    // filing writes "this never happened" over a payload that may be minutes
    // from broadcast — and "let it expire" is the seven-day wait that then
    // lands on the unresolved-seat guard. The seat is settled on the proposal
    // itself, in the inbox. Kept verbatim from the server's own `detail` so
    // the reserve and the live sentence cannot drift apart.
    case 'LIVE_PROPOSAL_EXISTS':
      return t(
        'This account already has a proposal collecting signatures, and XRPL pins one Sequence at a time. Settle that one in the proposal inbox first: finish collecting its signatures and broadcast it, or register the transaction hash if it has already gone out — any member can do either.',
      );
    // prosa-y-lectores — the permission floor `mayReadProposal` added this
    // round refuses the whole inbox listing with this code, and NO client had
    // a sentence for it (zero appearances outside tests): the family read the
    // slug `NOT_A_COUNCIL_MEMBER`. The floor is the wallet REGISTRY, not the
    // wallet connected in the tab, so the sentence has to name the cure.
    case 'NOT_A_COUNCIL_MEMBER':
      return t(
        'The server does not recognise you as a member of this council. It reads membership from the wallets registered in your account — not from the one connected in this tab — and none of them is on this signer list. Register the wallet that holds your seat, and this inbox opens.',
      );
    case 'NOT_A_COUNCIL':
      return t(
        'This account is not a council yet (no multisig signer list). Constitute it first — then its movements can be proposed to the quorum.',
      );
    case 'VAULT_STATE_READ_FAILED':
      return t('The vault could not be read from Flare right now. Nothing was composed — try again in a moment.');
    /**
     * THE TWO 409s NOBODY READ.
     *
     * `ACCOUNT_RECORD_MISSING` and `PROOF_FLOOR_UNREADABLE` carry
     * their prose in `detail`, so the branch above normally speaks for them —
     * but a route that drops the detail (or a caller holding only the code) fell
     * through to «The server refused this and did not explain why», which is the
     * dead end this file exists to remove. Waiting does NOT fix either of them,
     * so neither sentence may promise a retry: what works is signing in with the
     * wallet itself, or an administrator repairing the record.
     */
    case 'ACCOUNT_RECORD_MISSING':
      return t(
        'We could not find the account record behind this session, so the wallets linked to it cannot be dated or trusted, and we will not guess. This will not fix itself by waiting, and nothing was composed and nothing moved. Sign in with the wallet that controls this address — a signed-in wallet proves itself and needs no stored record — or write to us: an administrator can restore the account record.',
      );
    case 'PROOF_FLOOR_UNREADABLE':
      return t(
        'This account’s security record cannot be read, so we cannot tell which of your linked wallets were added before the account last changed hands. We will not guess: guessing could hand the account back to a previous holder. Linked wallets stay out until it is repaired, and re-linking one will not help either. This will not fix itself by waiting, and nothing was composed and nothing moved. Sign in with the wallet that controls this address, or write to us: an administrator can repair the security record.',
      );
    /**
     * EL 409 QUE LLEGABA DESPUÉS DE FIRMAR EN XAMAN.
     *
     * `POST /council/proposals/:id/positions` contesta `POSITION_ALREADY_SET`
     * SIN `detail` (backend/src/routes/councilProposals.ts). Al cosignatario
     * REGISTRADO se le sirve `positions: []` a propósito, así que no puede saber
     * que uno de sus asientos ya fijó postura: abre el formulario, firma en
     * Xaman y lo único que lee es el slug. La frase tiene que decir las dos
     * cosas que son verdad — el acta no se edita, y su firma no se perdió.
     */
    case 'POSITION_ALREADY_SET':
      return t(
        'A position for that seat is already recorded on this proposal, and the acta is immutable: a fixed position is never edited or replaced. Nothing was lost and nothing moved — what you just signed simply did not need to be signed. If you cannot see that position on screen, this proposal is being served to you without the council’s deliberation, which is why the door looked open.',
      );
    default:
      return null;
  }
}

/**
 * LAS SALIDAS, CUANDO EL SERVIDOR NO LAS MANDÓ.
 *
 * `provenAddresses.ts` manda `ways[]` en sus cuatro rechazos y las rutas los
 * pasan verbatim; el resto de puertas (la bandeja del consejo, las posiciones)
 * contestan con código y prosa, sin lista. La reserva las nombra para que la
 * pantalla tenga SIEMPRE algo que ofrecer — y nunca promete esperar en un
 * rechazo que no se cura esperando.
 */
const SIGN_IN_WITH_THAT_WALLET_WAY =
  'Sign in with the wallet that controls this address — a signed-in wallet proves itself and needs no stored record.';

function reserveWays(code: string, t: (s: string) => string): string[] {
  switch (code) {
    case 'NOT_A_COUNCIL_MEMBER':
      return [
        t('Sign in with the wallet that holds your seat — the login itself is the signature.'),
        t('Or register it from Wallets by signing the binding challenge, then open this inbox again.'),
      ];
    case 'ADDRESS_NOT_PROVEN':
      return [
        t('Sign in with that wallet — the login itself is the signature.'),
        t('Or link it to this account by signing the binding challenge, then repeat this action.'),
      ];
    case 'ACCOUNT_RECORD_MISSING':
      return [
        t(SIGN_IN_WITH_THAT_WALLET_WAY),
        t('Or write to us: an administrator can see whether this account record was removed and restore it.'),
      ];
    case 'PROOF_FLOOR_UNREADABLE':
      return [
        t(SIGN_IN_WITH_THAT_WALLET_WAY),
        t('Or write to us: an administrator can repair the security record. Re-linking the wallet will not help.'),
      ];
    case 'PROOF_STORE_UNREADABLE':
      return [
        t('Try again in a moment — this one really does clear on its own.'),
        t('If it keeps failing, sign in again with the wallet that controls this account.'),
      ];
    // The mark parsed but is dated ahead of our clock. Waiting works
    // (the clock moves); re-linking provably does not (the new binding is
    // stamped now, still below the mark), so it is never offered here.
    case 'PROOF_FLOOR_AHEAD_OF_CLOCK':
      return [
        t('Try again later — the record is dated ahead of our clock, and time clears this on its own.'),
        t(SIGN_IN_WITH_THAT_WALLET_WAY),
        t('Or write to us: an administrator can check that date. Re-linking the wallet will not help.'),
      ];
    default:
      return [];
  }
}

/**
 * Los rechazos cuya cura ES iniciar sesión con la wallet. No es un reintento y
 * jamás se convierte en uno: nada aquí vuelve a preguntarle al servidor.
 */
const WALLET_CURE_CODES = new Set([
  'ADDRESS_NOT_PROVEN',
  'ACCOUNT_RECORD_MISSING',
  'PROOF_FLOOR_UNREADABLE',
  'PROOF_STORE_UNREADABLE',
  'PROOF_FLOOR_AHEAD_OF_CLOCK',
  'NOT_A_COUNCIL_MEMBER',
]);

/** Y, para los que este lector no conoce, la frase del propio servidor. */
const WALLET_SIGN_IN_PROSE = /\bsign in (again )?with (the|that|your) wallet\b/i;

/**
 * LA RESERVA Y LA PUERTA, COMPARTIDAS.
 *
 * `lib/xaman/seatRefusal` lee los 503 de la tienda de pruebas para el carril
 * 0xFE y no tenía ni las `ways` de reserva ni la regla de la puerta: un
 * `PROOF_FLOOR_AHEAD_OF_CLOCK` reenviado sin `ways` (`/handoff/release`) se
 * quedaba en «try again in a moment». Se exportan las dos piezas para que haya
 * UNA lista de salidas por código y UNA regla de «¿esta frase nombra la wallet?»
 * — no una copia por lector.
 */
export function reserveRefusalWays(code: string, t: (s: string) => string): string[] {
  return reserveWays(code, t);
}

/** ¿Alguna de estas frases nombra «entrar con la wallet»? La regla de la puerta. */
export function namesWalletSignIn(said: ReadonlyArray<string | null | undefined>): boolean {
  return WALLET_SIGN_IN_PROSE.test(said.filter((s): s is string => typeof s === 'string').join(' '));
}

function refusalDoor(code: string, said: string[], t: (s: string) => string): RefusalDoor | null {
  if (!WALLET_CURE_CODES.has(code) && !namesWalletSignIn(said)) return null;
  return { label: t('Sign in with your wallet'), href: WALLET_SIGN_IN_HREF };
}

function refusalText(r: ServerRefusal, t: (s: string) => string): string {
  const infra = infrastructureText(r, t);
  if (infra) return infra;
  // The server's own explanation beats every hardcoded sentence in this file —
  // when it IS an explanation and not an echoed identifier (detailIsProse).
  if (r.detail && detailIsProse(r.detail)) return r.detail;
  const reserve = reserveText(r.code, t);
  // An identifier-shaped detail is not the sentence, but it is still the piece
  // of evidence the person needs ("which of my addresses?"), so it travels.
  if (reserve) return r.detail ? `${reserve} (${r.detail})` : reserve;
  // `raw` is only worth showing when it is prose (a Xaman refusal, an xrpl.js
  // message, a revert string). When it is the code, showing it IS the dead end.
  if (r.raw && !looksLikeMachineCode(r.raw)) return r.raw;
  if (r.code) return `${t('The server refused this and did not explain why.')} (${r.code})`;
  return t('Something went wrong.');
}

/** Read the refusal AND say it, in one parse. */
export function describeServerRefusal(err: unknown, t: (s: string) => string): ReadableRefusal {
  const r = readServerRefusal(err);
  const text = refusalText(r, t);
  // Las del servidor mandan; la reserva solo habla cuando no las
  // mandó. `text` NO las absorbe — hay pantallas y tests que comparan la frase
  // con el `detail` del servidor, y una salida es un botón, no una coletilla.
  const ways = (r.ways ?? []).length > 0 ? (r.ways as string[]) : reserveWays(r.code, t);
  return {
    ...r,
    text,
    headline: r.headline ?? '',
    ways,
    door: refusalDoor(r.code, [...ways, r.detail, text], t),
  };
}

/** The ergonomic half, for callers that only need the sentence. */
export function serverRefusalText(err: unknown, t: (s: string) => string): string {
  return describeServerRefusal(err, t).text;
}

/**
 * LA FILA QUE NO PUDIMOS LEER TENÍA QUE LLEGAR A LA PANTALLA.
 *
 * QUÉ FALLABA EN SILENCIO. Dejó de tirar la fila indecidible: `GET
 * /council/proposals` la manda nombrada en `unreadable[]`, con el MISMO cuerpo que
 * llevaría la respuesta entera si no hubiese nada legible (`error` / `retryable` /
 * `detail`). Pero el tipo del cliente no declaraba el campo y los tres consumidores
 * desestructuraban solo `proposals` — así que la fila seguía sin existir para la
 * persona, que es exactamente el fallo que dijo cerrar. Peor: la bandeja
 * lateral ponía su aviso a null en el `then` del éxito, o sea que un 200 que TRAE
 * filas ilegibles BORRABA la advertencia.
 */
export interface UnreadableRowsNotice {
  /** Cuántas filas no se pudieron leer. Nunca 0: sin filas, esto es `null`. */
  count: number;
  /** La frase para la persona — la del servidor cuando la mandó. */
  text: string;
  /** ¿Vuelve a intentarse solo? Verdadero solo si TODAS lo dijeron. */
  retryable: boolean;
  /** Los códigos que el servidor nombró, deduplicados. Para soporte, jamás como la frase. */
  codes: string[];
  /** Los ids de las filas, para quien quiera abrirlas de una en una. */
  ids: string[];
}

export function describeUnreadableRows(rows: unknown, t: (s: string) => string): UnreadableRowsNotice | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const entries = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
  if (entries.length === 0) return null;
  const codes: string[] = [];
  const ids: string[] = [];
  const sentences: string[] = [];
  let retryable = true;
  for (const e of entries) {
    const code = typeof e.error === 'string' ? e.error : '';
    if (code && !codes.includes(code)) codes.push(code);
    if (typeof e.id === 'string' && e.id) ids.push(e.id);
    if (e.retryable !== true) retryable = false;
    // El mismo lector que un rechazo entero: la prosa del servidor manda, y un
    // código a secas sigue teniendo su frase de reserva.
    const said = refusalText({ code, detail: collapseDetail(e.detail), raw: '' }, t);
    if (said && !sentences.includes(said)) sentences.push(said);
  }
  const head = t(
    '{count} of this council’s proposals could not be read, so they are not on the list below. That is a failure of ours, not an empty inbox — and never a statement about what you may sign.',
  ).replace('{count}', String(entries.length));
  // El código viaja entre paréntesis, nunca como la frase (la lección).
  const tail = codes.length > 0 ? ` (${codes.join(' · ')})` : '';
  return {
    count: entries.length,
    text: `${head} ${sentences.join(' ')}${tail}`.trim(),
    retryable,
    codes,
    ids,
  };
}
