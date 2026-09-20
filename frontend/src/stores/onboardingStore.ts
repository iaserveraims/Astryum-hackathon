import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getApiBase } from '../lib/env';
import { hasAnswer, readOnboarding, type OnboardingLang, type OnboardingRecord as ServerOnboarding } from '../lib/onboarding/record';

/**
 * EL CUESTIONARIO VIAJA A LA CUENTA (fundador 2026-09-14: «una vez rellenado
 * ese popup, que se guarde y no vuelva a saltar; inicio sesión desde
 * navegadores distintos y me vuelve a pedir lo mismo»).
 *
 * Este store sigue siendo el que contesta en el acto —antes de que /me hable,
 * y sin red— pero ya no es el dueño del dato: cada escritura se manda a
 * POST /auth/onboarding, y cuando /me responde, MANDA LA CUENTA
 * (adoptServerOnboarding). Fallar al mandarlo no rompe nada: el popup no
 * vuelve a salir en este navegador y el próximo /me lo reconcilia.
 */
/**
 * POR QUÉ NO SE GUARDÓ — Y POR QUÉ ANTES NO LO SABÍA NADIE (productizer it. 27).
 *
 * `un rechazo con cuerpo RESUELVE`: un 409 no lanza, así que el `.catch()` que
 * había aquí no lo veía nunca. Con la columna `preferences` ilegible, el backend
 * contesta 409 `PREFERENCES_UNREADABLE` (no reintentable), `completed` no llega
 * jamás a la cuenta, y el asistente se vuelve a abrir en cada navegador nuevo.
 * No es una cárcel — hay «Omitir» y lo local sostiene ESTA sesión — pero es
 * fricción permanente que nadie podía diagnosticar: ni una traza en consola, ni
 * una frase para la persona.
 *
 *   · 'unreadable' — 409: esperar NO lo arregla, hay que reparar la fila;
 *   · 'server'     — cualquier otro rechazo del servidor;
 *   · 'network'    — la petición no llegó a ninguna parte.
 */
export type OnboardingPersistRefusal = 'unreadable' | 'server' | 'network';

/** La frase, con la misma regla que la nota legal: dice qué pasó, de quién es
 *  el fallo, qué cuesta y qué viene después — y jamás acusa a quien lee. */
export const ONBOARDING_NOT_SAVED_EN =
  'We could not save your answers to your account, so this may ask you again on another browser. Nothing else ' +
  'changed and nothing is being asked of you — your answers are in use on this device.';
export const ONBOARDING_NOT_SAVED_ES =
  'No pudimos guardar tus respuestas en tu cuenta, así que puede que te lo vuelva a preguntar en otro navegador. ' +
  'No ha cambiado nada más y no te pedimos nada — tus respuestas están en uso en este dispositivo.';

function reportPersistRefusal(kind: OnboardingPersistRefusal | null, detail?: string): void {
  if (kind) console.warn(`[onboarding] no se guardó en la cuenta (${kind})${detail ? `: ${detail}` : ''}`);
  // El store existe cuando esto se ejecuta (solo se llama desde sus acciones).
  useOnboardingStore.setState({ persistRefusal: kind });
}

function persistToAccount(patch: { completed?: boolean; goal?: string | null; lang?: OnboardingLang; toursDone?: Record<string, boolean> }): void {
  if (typeof window === 'undefined') return;
  const token = window.localStorage.getItem('auth_token');
  if (!token || token === 'dev-bypass-no-jwt') return;
  void fetch(`${getApiBase()}/auth/onboarding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(patch),
  })
    .then(async (res) => {
      if (res.ok) {
        reportPersistRefusal(null);
        return;
      }
      // UN RECHAZO NO ES UNA EXCEPCIÓN: sin este bloque, el 409 se descartaba
      // en silencio y la persona veía el asistente otra vez sin saber por qué.
      const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      reportPersistRefusal(
        body?.error === 'PREFERENCES_UNREADABLE' ? 'unreadable' : 'server',
        `${res.status} ${body?.error ?? ''} ${body?.detail ?? ''}`.trim(),
      );
    })
    .catch((e) => {
      /* sin red, lo local sostiene la sesión y el próximo /me reconcilia */
      reportPersistRefusal('network', (e as Error)?.message);
    });
}

// The four goals mirror the landing "paths" so the story is continuous from marketing
// into the product.
export type OnboardingGoal = 'protect' | 'control' | 'generate' | 'manage';

const GOALS: readonly OnboardingGoal[] = ['protect', 'control', 'generate', 'manage'];
function isGoal(v: unknown): v is OnboardingGoal {
  return typeof v === 'string' && (GOALS as readonly string[]).includes(v);
}

/** The interactive coachmark tours (ProductTour). Kept deliberately few:
 *  Home is the first-run walk (fleet + sidebar doors — moved there from the
 *  Summary on 2026-08-16, when the Home hub became the meeting point); Earn
 *  explains its doors. 'summary' stays in the union so persisted toursDone
 *  entries from older sessions keep typing. Anything more would be
 *  overwhelming (founder 2026-07-18). */
export type TourId = 'home' | 'summary' | 'earn';

/** What first-run remembers, PER ACCOUNT (2026-09-13) — y desde el 2026-09-14,
 *  también EN LA CUENTA (ver la cabecera de persistToAccount). */
interface OnboardingRecord {
  completed: boolean;
  goal: OnboardingGoal | null;
  toursDone: Partial<Record<TourId, boolean>>;
  /** El idioma que eligió en el cuestionario. Lo pinta LanguageProvider; aquí
   *  vive solo para poder llevarlo a la cuenta con el resto de la respuesta. */
  lang: OnboardingLang | null;
}

interface OnboardingState extends OnboardingRecord {
  /** Transient — re-opened on demand from Settings even after completion. */
  forceOpen: boolean;
  /**
   * Por qué la última escritura no llegó a la cuenta, o null si llegó. NO se
   * persiste: es el estado de la última petición, no del navegador. Ver
   * `persistToAccount` y `ONBOARDING_NOT_SAVED_EN`.
   */
  persistRefusal: OnboardingPersistRefusal | null;
  /**
   * ── POR CUENTA, NO POR NAVEGADOR (fundador 2026-09-13) ──────────────────
   * «Acabo de crear esta cuenta y no me ha saltado el mini tour inicial ni la
   * configuración básica». El asistente y los tours se guardaban una vez por
   * navegador: la segunda cuenta creada en el mismo Chrome nunca los veía.
   * Ahora cada cuenta tiene su registro; los campos de arriba son la VISTA de
   * la cuenta activa (`accountKey`), así ningún consumidor cambia. authStore
   * llama a `activateAccount` al entrar, al crear cuenta y al restaurar la
   * sesión. El registro sin cuenta (antes de que exista clave) migra al
   * primer usuario que activa — nadie que ya lo completó lo vuelve a ver.
   */
  accountKey: string | null;
  byAccount: Record<string, OnboardingRecord>;
  activateAccount: (key: string) => void;

  finish: (goal: OnboardingGoal | null) => void;
  skip: () => void;
  reopen: () => void;
  close: () => void;
  markTourDone: (tour: TourId) => void;
  /** Settings "Run again": replays the wizard AND both tours. */
  resetTours: () => void;
  /** El idioma elegido — se recuerda aquí para que viaje a la cuenta. */
  rememberLang: (lang: OnboardingLang) => void;
  /** Lo que dice /me. La cuenta manda sobre lo local; un registro vacío no
   *  pisa nada (readOnboarding/hasAnswer). */
  adoptServerOnboarding: (raw: unknown, key: string | null) => void;
}

const FRESH: OnboardingRecord = { completed: false, goal: null, toursDone: {}, lang: null };

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => {
      /** Write the active account's view into its record too. */
      const remember = (patch: Partial<OnboardingRecord> & { forceOpen?: boolean }) =>
        set((s) => {
          const next = { ...patch };
          const key = s.accountKey;
          const rec: OnboardingRecord = {
            completed: next.completed ?? s.completed,
            goal: next.goal !== undefined ? next.goal : s.goal,
            toursDone: next.toursDone ?? s.toursDone,
            lang: next.lang !== undefined ? next.lang : s.lang,
          };
          return { ...next, byAccount: key ? { ...s.byAccount, [key]: rec } : s.byAccount };
        });
      return {
        completed: false,
        goal: null,
        lang: null,
        forceOpen: false,
        persistRefusal: null,
        toursDone: {},
        accountKey: null,
        byAccount: {},
        activateAccount: (key) => {
          const s = get();
          if (s.accountKey === key) return;
          const known = s.byAccount[key];
          // First activation ever on this browser: the device-level record
          // that existed before accounts were told apart belongs to whoever
          // is signed in now. Later accounts start fresh.
          const legacy = s.accountKey === null && Object.keys(s.byAccount).length === 0;
          const rec: OnboardingRecord =
            known ?? (legacy ? { completed: s.completed, goal: s.goal, toursDone: s.toursDone, lang: s.lang } : FRESH);
          set({
            accountKey: key,
            completed: rec.completed,
            goal: rec.goal,
            toursDone: rec.toursDone,
            lang: rec.lang,
            forceOpen: false,
            byAccount: { ...s.byAccount, [key]: rec },
          });
        },
        finish: (goal) => {
          remember({ completed: true, goal, forceOpen: false });
          persistToAccount({ completed: true, goal });
        },
        skip: () => {
          // Saltarlo TAMBIÉN cuenta como contestado: quien lo saltó no quiere
          // que le vuelva a salir, y menos en otro navegador.
          remember({ completed: true, forceOpen: false });
          persistToAccount({ completed: true });
        },
        reopen: () => set({ forceOpen: true }),
        close: () => set({ forceOpen: false }),
        markTourDone: (tour) => {
          remember({ toursDone: { ...get().toursDone, [tour]: true } });
          persistToAccount({ toursDone: { [tour]: true } });
        },
        // Volver a verlos es una petición LOCAL: el servidor mezcla marcas
        // (nunca las borra), así que reabrirlos aquí no se manda — si se
        // mandara, no habría forma de repetir un tour sin perderlo en todos
        // los navegadores. Ver withOnboarding en el backend.
        resetTours: () => remember({ toursDone: {} }),
        rememberLang: (lang) => {
          remember({ lang });
          persistToAccount({ lang });
        },
        adoptServerOnboarding: (raw, key) => {
          const rec = readOnboarding(raw);
          // Un registro VACÍO no pisa lo local: un backend que todavía no
          // guarda nada borraría la respuesta recién dada en este navegador.
          if (!hasAnswer(rec)) return;
          set((s) => {
            const merged: OnboardingRecord = {
              completed: rec.completed || s.completed,
              // El objetivo del servidor es una cadena libre (el catálogo vive
              // aquí): se valida antes de adoptarlo, o una opción retirada
              // entraría como si existiera.
              goal: isGoal(rec.goal) ? rec.goal : s.goal,
              // Las marcas se SUMAN: haber visto un tour en otro navegador
              // cuenta, y no haberlo visto allí no lo desmarca aquí.
              toursDone: { ...s.toursDone, ...rec.toursDone },
              lang: rec.lang ?? s.lang,
            };
            return {
              ...merged,
              accountKey: key ?? s.accountKey,
              byAccount: key ? { ...s.byAccount, [key]: merged } : s.byAccount,
            };
          });
        },
      };
    },
    {
      name: 'astryum:onboarding',
      partialize: (s) => ({ completed: s.completed, goal: s.goal, lang: s.lang, toursDone: s.toursDone, accountKey: s.accountKey, byAccount: s.byAccount }),
    },
  ),
);
