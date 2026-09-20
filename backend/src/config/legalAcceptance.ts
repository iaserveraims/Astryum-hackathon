// The strict reader of `preferences.security.takeoverAt` (services/identity):
// pure, no Prisma client and no network — safe to pull into a config module.
import { readTakeoverFloorStrict } from '../services/identity/credentialsEpoch';

/**
 * Legal acceptance gate — versions and pure logic (founder 2026-07-30).
 *
 * BOTH published legal pages must be presented at the user's FIRST entry into
 * the dashboard, and the acceptance recorded per account with version + date:
 *
 *   · /demo-terms  — the demo conditions. These are ACCEPTED (contract).
 *   · /privacy     — the privacy notice. This is READ, not consented: GDPR
 *     arts. 13-14 require informing, not consent, and asking for consent to a
 *     notice would muddy the real legal bases (doc 12 §3). The record proves
 *     WHEN the user was informed and of WHICH version.
 *
 * Why a login-time gate when registration already has a click-wrap: the
 * register click-wrap only covers the email+password path — wallet-first
 * (SIWE) users never passed it — and a version bump (e.g. the €50 liability
 * cap added 2026-07-30) only binds EXISTING accounts once the new text is
 * presented to them. This gate closes both holes: any session whose recorded
 * versions are stale gets the modal once, and the acceptance rides the same
 * `User.preferences` JSON the register path already uses (no migration).
 *
 * Bump rules: DEMO_TERMS_VERSION lives in routes/auth.ts (single source —
 * bump it when /demo-terms materially changes); PRIVACY_NOTICE_VERSION lives
 * here — bump it when /privacy materially changes. Any bump re-opens the gate
 * for everyone exactly once. That re-opening IS the "material change announced
 * in the app" promise both documents make (§11).
 */

// 2026-08-01: auditoría de exactitud. El aviso declaraba «cero telemetría
// externa» mientras montaba Vercel Analytics + Speed Insights en todas las
// páginas, decía «una sola cookie» habiendo dos, y afirmaba que la única
// petición desde el navegador era CoinGecko. Corregido y ampliado con §4.5
// (todo lo que pide el navegador). Cambios materiales → bump: se re-presenta
// a todo el mundo una vez, que es la promesa del §11.
//
// 2026-08-11: se enciende la analítica de visitas (Vercel Web Analytics,
// cookieless y agregada) para medir las campañas de difusión. Nuevo
// destinatario (§4 Vercel Inc.) + nueva finalidad (§3 métricas 6.1.f) +
// nueva transferencia (§5 EE. UU., DPF+SCC) = cambio material → bump, y el
// gate re-presenta el aviso una vez, que es la promesa del §11. Speed
// Insights sigue apagado y sin declarar (flag propio en app/layout.tsx).
//
// 2026-09-13: el chip de cada wallet de Xaman muestra el avatar público de la
// cuenta, pedido DESDE NUESTRO SERVIDOR (api/xaman/avatar) — Xaman ve la
// dirección y la IP del servidor, no la del usuario. Flujo nuevo hacia un
// destinatario ya declarado (§4 Xaman) = cambio material → bump; el gate
// re-presenta el aviso una vez (§11). La versión directa desde el navegador
// (3a6c6d7a) se retiró en 7c1aeffb precisamente por no estar declarada.
export const PRIVACY_NOTICE_VERSION = '2026-09-13';

/** Shape of the acceptance record inside User.preferences.legal. */
export interface LegalAcceptanceRecord {
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string; // ISO timestamp
}

/**
 * WHY the gate is open (2026-09-13, «que esté mejor hecho todo el proceso»):
 *   · 'first'   — nothing on record: first entry of a wallet-first account.
 *   · 'terms'   — the terms changed since the recorded acceptance; the
 *                 privacy notice on record is still current.
 *   · 'privacy' — the notice changed; the terms on record are still current.
 *   · 'both'    — both changed (or an old partial record).
 * The client uses it to ask ONLY for what changed — re-reading a text you
 * already signed at its current version is friction with no legal value —
 * and to say so in words instead of presenting the same modal as day one.
 */
export type LegalGateReason = 'first' | 'terms' | 'privacy' | 'both';

export interface LegalStatus {
  /** true ⇒ the dashboard must show the acceptance modal before use. */
  required: boolean;
  termsVersion: string;
  privacyVersion: string;
  /** Why it is required; null when it is not. */
  reason: LegalGateReason | null;
  /** What this account has on record — the unified signature, or the
   *  register-time click-wrap as a terms-only partial. null = nothing. */
  accepted: { termsVersion: string | null; privacyVersion: string | null; acceptedAt: string | null } | null;
  /**
   * THE THIRD STATE (productizer it. 25): we could not READ the record.
   *
   * Not «you signed» and not «you did not sign» — a fact about OUR stored row,
   * reported as its own field precisely so no screen has to guess. When this is
   * true, `required` is false, `reason` is null and `accepted` is null: see
   * `unreadableLegalStatus` for why each of those is the honest answer.
   */
  unreadable: boolean;
}

/**
 * «NO PUDE LEER TU FICHA» NO ES UNA CÁRCEL (productizer it. 25).
 *
 * WHAT WENT WRONG. `readTakeoverAtStrict` fails closed on purpose: a takeover
 * mark that does not parse must never let a previous holder's click-wrap pass
 * as the current holder's signature. But «no acceptance counts» was collapsed
 * into `required: true`, and `required: true` mounts a NON-DISMISSABLE modal in
 * front of the whole /app tree. Two shapes of corruption closed the loop:
 *
 *   · the whole `preferences` column is not an object — then POST
 *     /auth/legal-accept ALSO refuses (409 `PREFERENCES_UNREADABLE`, and
 *     rightly: writing an object with no `security` key would tell
 *     `readTakeoverAtStrict` «there was no takeover» and resurrect every
 *     binding the previous holder attached). Gate open, signature impossible;
 *   · the column IS an object but `security` / `takeoverAt` does not parse —
 *     then the write LANDS and the gate re-opens on the next /auth/me, for
 *     ever, because the mark is still unreadable. An infinite signature.
 *
 * Either way the person never reaches the dashboard — and the legal gate sits
 * in front of every capital route, so their EXITS are behind it too. That is a
 * gate on the way out, which this product does not do.
 *
 * WHY `required: false` IS NOT A GRANT. The gate grants the user nothing: it
 * discharges a duty of OURS (put the published texts in front of them and
 * record when). A record we cannot read is our record-keeping failure, and the
 * remedy is repairing the row and presenting the texts once it is readable —
 * never holding a person's money hostage to it. Nothing downstream reads
 * `legal.required` as an authority: it decides one modal. And it cannot be
 * forged into one, because the strict readers that DO decide authority
 * (`provenAddresses`, the cage acknowledgement, `applyPreferencesUpdate`) keep
 * failing closed on exactly the same input.
 *
 * WHY `accepted: null`. We will not show a stored acceptance we cannot
 * attribute to whoever holds the account right now — that is the precise thing
 * the strict read exists to prevent. Saying nothing is honest; presenting
 * someone else's signature as yours is not.
 *
 * The client renders this as a sentence, never as a door: see
 * frontend/src/lib/legal/legalGateMode.ts.
 */
export function unreadableLegalStatus(currentTermsVersion: string): LegalStatus {
  return {
    required: false,
    termsVersion: currentTermsVersion,
    privacyVersion: PRIVACY_NOTICE_VERSION,
    reason: null,
    accepted: null,
    unreadable: true,
  };
}

/**
 * A TAKEOVER MARK AHEAD OF OUR OWN CLOCK IS NOT A USABLE FLOOR (it. 27) — AND
 * NOT ONLY HERE (it. 29).
 *
 * `markIsAheadOfClock` was written in this file for the legal click-wrap and
 * lived here, private. It. 29 found the same future mark closing the two doors
 * that decide MONEY (the bindings floor in `identity/provenAddresses` and the
 * desk ownership check in `demoExchange/takeover`), which had no such rule at
 * all. So the function and the whole argument behind it — why the third state
 * and not `min(takeoverAt, now)`, and why there is no tolerance window — now
 * live next to `readTakeoverAtStrict`, the reader every consumer shares, and
 * this file uses that one. Nothing about the gate's behaviour changed.
 */

/**
 * Compute the gate state from the account's preferences JSON.
 *
 * Terms count as current if EITHER the unified `legal` record OR the
 * register-time `demoTerms` click-wrap carries the current version — a fresh
 * email signup should not be asked twice for the same text. The privacy
 * notice only ever satisfies via the unified record (registration does not
 * present it today).
 *
 * `now` is injectable so the future-mark rule above is testable without moving
 * the machine's clock; every caller in the app uses the default.
 */
export function computeLegalStatus(
  preferences: unknown,
  currentTermsVersion: string,
  now: Date = new Date(),
): LegalStatus {
  const raw = (preferences ?? {}) as {
    legal?: Partial<LegalAcceptanceRecord>;
    demoTerms?: { version?: string; acceptedAt?: string };
  };
  // ACCOUNT TAKEOVER (productizer it. 14, 4.2). The click-wrap is a PERSON's
  // signature. When the verified owner takes an account over from an unverified
  // password holder, the takeover moves those records to the quarantine account
  // — but this is the second lock: an acceptance stamped before `takeoverAt`
  // (or one whose date cannot be read, or a takeover mark that cannot be read)
  // never counts, so the current holder is asked to sign for themselves.
  // A MARK WE COULD NOT USE IS THE THIRD STATE, NOT «you have not signed»
  // (it. 25). Before this line the unreadable case fell through as «nothing on
  // record» ⇒ `required: true` ⇒ a modal in front of the whole app that no
  // click could close. Answer the truth instead and let the client say it.
  //
  // THE OTHER DOOR INTO THE SAME LOOP (it. 27). A mark that parses but is ahead
  // of this server's clock can never be cleared by any signature, so it must
  // not be used as a floor — and it must not raise a door either. Why the third
  // state rather than clamping it to `now`: see `markIsAheadOfClock` in
  // services/identity/credentialsEpoch.
  //
  // it. 31 (4.3): both questions through the ONE shared reader
  // (`readTakeoverFloorStrict`), the same one `provenAddresses`, the demo
  // exchange and the cage acknowledgement use — this file composed the two
  // halves by hand, which is how a rule drifts per reader. Same behaviour.
  const takeover = readTakeoverFloorStrict(preferences, now);
  if (!takeover.readable) return unreadableLegalStatus(currentTermsVersion);
  const takeoverAt = takeover.at;
  const signedByThisHolder = (acceptedAt: unknown): boolean => {
    if (takeoverAt === null) return true;
    const t = typeof acceptedAt === 'string' ? Date.parse(acceptedAt) : NaN;
    return Number.isFinite(t) && t > takeoverAt.getTime();
  };
  const prefs = {
    legal: raw.legal && signedByThisHolder(raw.legal.acceptedAt) ? raw.legal : undefined,
    demoTerms: raw.demoTerms && signedByThisHolder(raw.demoTerms.acceptedAt) ? raw.demoTerms : undefined,
  };
  const termsOk =
    prefs.legal?.termsVersion === currentTermsVersion ||
    prefs.demoTerms?.version === currentTermsVersion;
  const privacyOk = prefs.legal?.privacyVersion === PRIVACY_NOTICE_VERSION;
  const required = !(termsOk && privacyOk);
  // What is on record, for the client to show and to explain the gate. The
  // unified signature wins; the register click-wrap counts as a terms-only
  // partial (its version and date, no privacy half).
  const accepted =
    prefs.legal && (prefs.legal.termsVersion || prefs.legal.privacyVersion)
      ? {
          termsVersion: prefs.legal.termsVersion ?? null,
          privacyVersion: prefs.legal.privacyVersion ?? null,
          acceptedAt: prefs.legal.acceptedAt ?? null,
        }
      : prefs.demoTerms?.version
        ? { termsVersion: prefs.demoTerms.version, privacyVersion: null, acceptedAt: prefs.demoTerms.acceptedAt ?? null }
        : null;
  const reason: LegalGateReason | null = !required
    ? null
    : accepted === null
      ? 'first'
      : termsOk
        ? 'privacy'
        : privacyOk
          ? 'terms'
          : 'both';
  return {
    required,
    termsVersion: currentTermsVersion,
    privacyVersion: PRIVACY_NOTICE_VERSION,
    reason,
    accepted,
    // Reached only when the takeover mark READ cleanly (the early return above
    // owns the other case), so this branch always knows what it is saying.
    unreadable: false,
  };
}

/**
 * Merge a fresh acceptance into the existing preferences JSON without
 * clobbering sibling keys (demoTerms, theme, whatever else rides there).
 */
export function withLegalAcceptance(
  preferences: unknown,
  currentTermsVersion: string,
  now: Date = new Date(),
): Record<string, unknown> {
  const prefs =
    preferences && typeof preferences === 'object' && !Array.isArray(preferences)
      ? (preferences as Record<string, unknown>)
      : {};
  const legal: LegalAcceptanceRecord = {
    termsVersion: currentTermsVersion,
    privacyVersion: PRIVACY_NOTICE_VERSION,
    acceptedAt: now.toISOString(),
  };
  return { ...prefs, legal };
}
