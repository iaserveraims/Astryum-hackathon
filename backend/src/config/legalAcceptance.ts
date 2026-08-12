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
export const PRIVACY_NOTICE_VERSION = '2026-08-11';

/** Shape of the acceptance record inside User.preferences.legal. */
export interface LegalAcceptanceRecord {
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string; // ISO timestamp
}

export interface LegalStatus {
  /** true ⇒ the dashboard must show the acceptance modal before use. */
  required: boolean;
  termsVersion: string;
  privacyVersion: string;
}

/**
 * Compute the gate state from the account's preferences JSON.
 *
 * Terms count as current if EITHER the unified `legal` record OR the
 * register-time `demoTerms` click-wrap carries the current version — a fresh
 * email signup should not be asked twice for the same text. The privacy
 * notice only ever satisfies via the unified record (registration does not
 * present it today).
 */
export function computeLegalStatus(preferences: unknown, currentTermsVersion: string): LegalStatus {
  const prefs = (preferences ?? {}) as {
    legal?: Partial<LegalAcceptanceRecord>;
    demoTerms?: { version?: string };
  };
  const termsOk =
    prefs.legal?.termsVersion === currentTermsVersion ||
    prefs.demoTerms?.version === currentTermsVersion;
  const privacyOk = prefs.legal?.privacyVersion === PRIVACY_NOTICE_VERSION;
  return {
    required: !(termsOk && privacyOk),
    termsVersion: currentTermsVersion,
    privacyVersion: PRIVACY_NOTICE_VERSION,
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
