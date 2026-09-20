'use client';

/**
 * LegalAcceptGate — the blocking acceptance modal for the published legal
 * pages.
 */

import { useEffect, useState } from 'react';
import { useT } from '../../i18n/LanguageProvider';
import { useAuthStore } from '../../stores/authStore';
import { LegalSignCeremony, type LegalDocId } from '../legal/LegalSignCeremony';
import { T } from '../landing/useLang';
import {
  LEGAL_RECORD_UNREADABLE_EN,
  LEGAL_RECORD_UNREADABLE_ES,
  LEGAL_RECORD_UNREADABLE_TITLE_EN,
  LEGAL_RECORD_UNREADABLE_TITLE_ES,
  legalGateMode,
} from '../../lib/legal/legalGateMode';

/** Cuánto se queda el recibo a la vista antes de retirar la puerta. */
const RECEIPT_MS = 1800;

export default function LegalAcceptGate() {
  const { lang } = useT();
  const legalGate = useAuthStore((s) => s.legalGate);
  const acceptLegal = useAuthStore((s) => s.acceptLegal);
  const [busy, setBusy] = useState(false);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const [error, setError] = useState(false);
  const [refusal, setRefusal] = useState<
    'session_revoked' | 'session_expired' | 'server' | 'network' | 'not_recorded' | 'record_unreadable' | null
  >(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  // 'sign' | 'unreadable' | 'closed' — el porqué de cada uno, en lib/legal.
  const mode = legalGateMode(legalGate);
  const required = mode.kind === 'sign';
  // Firmada, la puerta se queda un instante con el recibo y luego se va.
  const open = required || holdOpen;

  // A modal that paints over the app is not the same as a modal that BLOCKS it.
  // Audit: the gate shipped at z-[97] while four app layers sit
  // above it — the command palette and the step-up modal (z-100), the intents
  // drawer (z-110) and the product tour (z-120, which auto-starts for exactly
  // the first-time user this gate exists for). The overlay now sits above all
  // of them, and the palette's window shortcut is swallowed in the capture
  // phase (AppShell listens on the bubble) — it is the one route in that could
  // not be closed by z-index alone, being keyboard-triggered.
  useEffect(() => {
    if (!open) return;
    const swallowPalette = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', swallowPalette, true);
    return () => window.removeEventListener('keydown', swallowPalette, true);
  }, [open]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(false);
    const ok = await acceptLegal();
    setBusy(false);
    // «check your connection» WAS THE WRONG SENTENCE FOR A REVOKED
    // SESSION. Since the live-session check, /legal-accept refuses a request
    // whose session died (an account takeover, a sign-out elsewhere): telling
    // that person to check their network leaves them clicking a gate that can
    // never close. The store already distinguishes the four cases.
    setRefusal(ok ? null : (useAuthStore.getState().legalAcceptRefusal ?? 'server'));
    // The gate only closes on a CONFIRMED write — an optimistic close would
    // show an acceptance whose record never landed.
    if (ok) {
      setSignedAt(useAuthStore.getState().legalGate?.accepted?.acceptedAt ?? new Date().toISOString());
      setHoldOpen(true);
      window.setTimeout(() => setHoldOpen(false), RECEIPT_MS);
    } else {
      setError(true);
      // SI EL SERVIDOR ACABA DE DECIR «no pude leer tu ficha», ESTA PUERTA SE
      // RETIRA SOLA. El 409 `PREFERENCES_UNREADABLE` no es
      // reintentable: la firma no puede aterrizar nunca sobre esa fila, así que
      // seguir pidiéndola es exigir lo imposible. /auth/me ya contesta
      // `unreadable: true, required: false` para la misma fila, de modo que
      // volver a leerlo convierte el callejón en la nota de más abajo. Un 401
      // (sesión revocada o caducada) no toca nada: refreshMe corta al no ser
      // 200 y el mensaje correcto sigue en pantalla.
      void useAuthStore.getState().refreshMe();
    }
  };

  // Solo se exige releer lo que cambió; sin razón conocida (backend antiguo),
  // los dos, como siempre.
  const reason = legalGate?.reason ?? null;
  const require: LegalDocId[] =
    reason === 'terms' ? ['terms'] : reason === 'privacy' ? ['privacy'] : ['terms', 'privacy'];

  return (
    <>
      {/* SIN <AnimatePresence>.
          Reproducido en navegador: con la ceremonia como hijo DIRECTO de un
          AnimatePresence, la animación de salida corre —el overlay llega a
          opacity 0— pero el nodo NO se desmonta nunca, y ese `fixed inset-0`
          invisible con pointer-events:auto se queda comiéndose todos los
          clics hasta que se recarga. La regla ya estaba escrita en
          ui/ModalPortal.tsx: «insertar un componente que no es motion.* entre
          la frontera de presencia y el elemento animado» rompe la salida. Un
          `key` NO lo arregla (probado); montar y desmontar a secas, sí. Se
          pierde el fundido de salida de 0,2 s. La entrada no cambia: la lleva
          el propio motion.div de la ceremonia. */}
      {open && (
        <LegalSignCeremony
          lang={lang}
          heading={T('Antes de continuar', 'Before you continue', lang)}
          intro={T(
            'Un minuto, una vez — para que sepas exactamente qué estás usando.',
            'One minute, once — so you know exactly what you are using.',
            lang,
          )}
          busy={busy}
          signed={signedAt !== null}
          signedAt={signedAt}
          require={require}
          reason={reason}
          accepted={legalGate?.accepted ?? null}
          currentVersions={legalGate ? { terms: legalGate.termsVersion, privacy: legalGate.privacyVersion } : null}
          error={
            error
              ? refusal === 'session_revoked'
                ? T(
                    'Tu sesión ya no vale — vuelve a entrar y firma entonces. No se registró nada.',
                    'Your session is no longer valid — sign in again and accept then. Nothing was recorded.',
                    lang,
                  )
                : refusal === 'session_expired'
                  ? T(
                      'Tu sesión ha caducado — vuelve a entrar y firma entonces. No se registró nada.',
                      'Your session has expired — sign in again and accept then. Nothing was recorded.',
                      lang,
                    )
                  : refusal === 'not_recorded'
                    ? // EL SERVIDOR ACEPTÓ LA PETICIÓN Y SIGUE DICIENDO
                      // QUE FALTA LA FIRMA. Antes esto no se veía: el store
                      // forzaba `required: false` y la pantalla enseñaba el
                      // recibo, así que el fallo volvía en el siguiente
                      // /auth/me disfrazado de bug intermitente. Se dice lo que
                      // pasa, sin acusar a nadie de no haber firmado, y se
                      // nombra la única vía que puede arreglarlo si insiste.
                      T(
                        'Tu firma se envió y el servidor la aceptó, pero sigue diciendo que hace falta firmar. No es algo que hayas hecho mal, y no se ha movido nada de tu cuenta: inténtalo otra vez y, si vuelve a pasar, escríbenos y lo reparamos.',
                        'Your signature was sent and the server accepted it, but it still reports the signature as missing. This is not something you did, and nothing on your account moved: try once more and, if it happens again, write to us and we will repair it.',
                        lang,
                      )
                    : refusal === 'record_unreadable'
                      ? // EL 409 NO REINTENTABLE YA NO DICE «EN
                        // UN MOMENTO». El store adopta el veredicto del propio 409
                        // (`legal.unreadable`), así que esta puerta se retira en el
                        // mismo render y la nota del tercer estado habla; esta
                        // frase solo se ve si algo la mantiene abierta, y entonces
                        // dice la verdad: esperar no lo arregla, no es culpa tuya,
                        // y la app no te la cierra.
                        T(
                          'No pudimos leer tu ficha para registrar la firma, y esperar no lo arregla. No es algo que hayas hecho mal, no se te pide nada y la aplicación queda abierta; si esto persiste, escríbenos y lo reparamos.',
                          'We could not read your account record to register the signature, and waiting will not fix that. This is not something you did, nothing is being asked of you and the app stays open; if it persists, write to us and we will repair it.',
                          lang,
                        )
                    : refusal === 'server'
                      ? T(
                          'El servidor no pudo registrar tu firma — inténtalo de nuevo en un momento.',
                          'The server could not record your signature — try again in a moment.',
                          lang,
                        )
                      : T(
                          'No se pudo registrar tu firma — revisa la conexión e inténtalo de nuevo.',
                          'Could not record your signature — check your connection and try again.',
                          lang,
                        )
              : null
          }
          onSigned={() => void submit()}
          versionLine={`${T('Versión', 'Version', lang)} ${legalGate?.termsVersion || '—'} · ${T(
            'se registra con la fecha en tu cuenta',
            'recorded with the date on your account',
            lang,
          )}`}
        />
      )}

      {/* LA NOTA DEL TERCER ESTADO. No es un modal: no hay overlay, no hay
          `inset-0`, no come clics (el contenedor de la esquina es el único
          nodo con pointer-events) y lleva su propio botón de cerrar. La
          aplicación entera queda utilizable detrás, que es justamente el
          punto — incluidas las salidas. */}
      {mode.kind === 'unreadable' && !noticeDismissed && (
        <div className="fixed bottom-4 right-4 z-[60] w-[min(92vw,380px)] rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl">
          <div className="flex items-start gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink/90">
                {T(LEGAL_RECORD_UNREADABLE_TITLE_ES, LEGAL_RECORD_UNREADABLE_TITLE_EN, lang)}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink/60">
                {T(LEGAL_RECORD_UNREADABLE_ES, LEGAL_RECORD_UNREADABLE_EN, lang)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setNoticeDismissed(true)}
              className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-ink/45 hover:text-ink/80"
              aria-label={T('Cerrar', 'Dismiss', lang)}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
