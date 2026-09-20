/**
 * El cuestionario de alta, EN LA CUENTA.
 *
 * Hasta hoy lo que el popup recogía —idioma, objetivo, y el hecho de haberlo
 * rellenado— vivía SOLO en el localStorage del navegador (zustand persist
 * `astryum:onboarding`). Con lo cual no es que se olvidara: es que nunca lo
 * supo nadie más que ese navegador. Abrir la misma cuenta en otro sitio era,
 * para el producto, una cuenta que no había contestado nunca.
 */

export type OnboardingLang = 'es' | 'en';

export interface OnboardingRecord {
  /** Ya contestó (o lo saltó): el popup no vuelve a salir solo. */
  completed: boolean;
  /** Para qué dijo que usa Astryum. Libre por diseño: el catálogo vive en el
   *  cliente y cambiar una opción no puede invalidar lo ya guardado. */
  goal: string | null;
  lang: OnboardingLang | null;
  /** Los tours ya vistos, por clave de pantalla. */
  toursDone: Record<string, boolean>;
  /** Cuándo se contestó, para poder decirlo en Ajustes. */
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

/** Solo booleanos, y solo claves con forma de nombre de tour. */
function readTours(v: unknown): Record<string, boolean> {
  const o = asObject(v);
  if (!o) return {};
  const out: Record<string, boolean> = {};
  for (const [k, val] of Object.entries(o)) {
    if (val === true && /^[a-z0-9:_-]{1,40}$/i.test(k)) out[k] = true;
  }
  return out;
}

/** Lee el registro de una columna JSON que puede ser null, basura o antigua. */
export function readOnboarding(preferences: unknown): OnboardingRecord {
  const prefs = asObject(preferences);
  const o = prefs ? asObject(prefs.onboarding) : null;
  if (!o) return { ...EMPTY_ONBOARDING };
  return {
    completed: o.completed === true,
    goal: typeof o.goal === 'string' && o.goal.length <= 60 ? o.goal : null,
    lang: isOnboardingLang(o.lang) ? o.lang : null,
    toursDone: readTours(o.toursDone),
    at: typeof o.at === 'string' ? o.at : null,
  };
}

/**
 * Mezcla PARCIAL a propósito (el patrón de /auth/appearance): el cuestionario
 * manda objetivo e idioma juntos, el selector de Ajustes manda solo el idioma
 * y un tour terminado manda solo su marca. Exigir el registro entero obligaría
 * al cliente a reenviar lo que no cambia, y ahí es donde dos pestañas abiertas
 * se pisan.
 */
export function withOnboarding(
  preferences: unknown,
  patch: Partial<OnboardingRecord>,
  now: string,
): Record<string, unknown> {
  const base = asObject(preferences) ?? {};
  const current = readOnboarding(preferences);
  const completed = patch.completed ?? current.completed;
  return {
    ...base,
    onboarding: {
      completed,
      goal: patch.goal !== undefined ? patch.goal : current.goal,
      lang: patch.lang !== undefined ? patch.lang : current.lang,
      toursDone: patch.toursDone ? { ...current.toursDone, ...readTours(patch.toursDone) } : current.toursDone,
      // La fecha marca cuándo se CONTESTÓ, no cuándo se tocó un tour: si ya
      // había una, se respeta.
      at: current.at ?? (completed ? now : null),
    },
  };
}
