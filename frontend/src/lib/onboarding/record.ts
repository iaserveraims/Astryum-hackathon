/**
 * El cuestionario de alta, como DATO — el espejo de
 * backend/src/config/onboarding.ts (la razón entera está allí).
 *
 * Puro y sin React a propósito: lo leen el store del cliente y el adoptador de
 * /me, y así una preferencia corrupta no puede colar un idioma inventado en
 * ninguno de los dos lados.
 */

export type OnboardingLang = 'es' | 'en';

export interface OnboardingRecord {
  completed: boolean;
  goal: string | null;
  lang: OnboardingLang | null;
  toursDone: Record<string, boolean>;
  at: string | null;
}

export const EMPTY_ONBOARDING: OnboardingRecord = {
  completed: false,
  goal: null,
  lang: null,
  toursDone: {},
  at: null,
};

const LANGS: readonly OnboardingLang[] = ['es', 'en'];
export function isOnboardingLang(v: unknown): v is OnboardingLang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function readTours(v: unknown): Record<string, boolean> {
  const o = asObject(v);
  if (!o) return {};
  const out: Record<string, boolean> = {};
  for (const [k, val] of Object.entries(o)) {
    if (val === true && /^[a-z0-9:_-]{1,40}$/i.test(k)) out[k] = true;
  }
  return out;
}

/** Lee lo que /me trae — un backend viejo (sin el campo) da el registro vacío,
 *  y entonces manda lo local, que es el comportamiento de siempre. */
export function readOnboarding(raw: unknown): OnboardingRecord {
  const o = asObject(raw);
  if (!o) return { ...EMPTY_ONBOARDING };
  return {
    completed: o.completed === true,
    goal: typeof o.goal === 'string' && o.goal.length <= 60 ? o.goal : null,
    lang: isOnboardingLang(o.lang) ? o.lang : null,
    toursDone: readTours(o.toursDone),
    at: typeof o.at === 'string' ? o.at : null,
  };
}

/** ¿Trae la cuenta algo que decir? Un registro vacío NO pisa lo local: sin
 *  esto, un backend que aún no guarda nada borraría la respuesta que esta
 *  persona acaba de dar en este navegador. */
export function hasAnswer(rec: OnboardingRecord): boolean {
  return rec.completed || rec.goal !== null || rec.lang !== null || Object.keys(rec.toursDone).length > 0;
}
