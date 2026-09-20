'use client';

/**
 * XRP Identity callback — donde aterriza la puerta del ecosistema, Y DONDE
 * AHORA VIVE EL RITUAL.
 *
 * El proveedor nos devuelve aquí con `code` + `state`. Comprobamos el estado
 * contra el que guardamos (un desajuste es CSRF, no un reintento), entregamos
 * el código y el verificador PKCE a nuestro backend y dejamos que él haga el
 * intercambio. Nada de esto sostiene jamás un token ni un secreto.
 *
 * Por qué la ceremonia está aquí (fundador 2026-08-23: «se ha perdido la magia
 * del ritual de login»): la puerta única sale de Astryum con un redirect de
 * página completa, así que la tarjeta de /login se va del navegador en el
 * instante del clic — el manifiesto no llegaba a jugarse ni un fotograma. Y el
 * momento que ese manifiesto narra —«verificando credenciales»— es justo ESTE:
 * la vuelta, mientras el backend canjea el código. Antes esta pantalla era un
 * fondo negro con «Verificando tu identidad…»; ahora es la ceremonia entera,
 * con su sello al final.
 *
 * En éxito el usuario va adonde iba; en fallo vuelve a /login con un motivo
 * honesto en vez de una pantalla en blanco.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { useReducedMotion } from '../../../../stores/motionStore';
import { useAuthStore } from '../../../../stores/authStore';
import {
  consumeCallback,
  isXrplIdentityPopupCallback,
  postCallbackToOpener,
  stateSaysPopup,
  xrplIdentityRedirectUri,
} from '../../../../lib/xrplIdentity/login';
import {
  AsteroidGlyph,
  DeckBackdrop,
  DecodingManifest,
  GOLD_SOFT,
  T,
  hasSeenLoginShow,
  markLoginShowSeen,
  maskIdentifier,
  signalIdentity,
  useLang,
  utcStamp,
  type DecodePayload,
  type Lang,
} from '../../../../components/auth/AccessRitual';
import { EASE, GOLD } from '../../../../components/landing/interactions';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function reasonCopy(code: string, lang: Lang): string {
  switch (code) {
    case 'state_mismatch':
      return T(
        'La respuesta no coincide con la petición que salió de este navegador. Vuelve a entrar.',
        'The answer does not match the request that left this browser. Sign in again.',
        lang,
      );
    case 'popup_orphaned':
      return T(
        'Esta ventana ya no encuentra la pestaña de Astryum que la abrió. Ciérrala y entra otra vez desde Astryum.',
        'This window can no longer find the Astryum tab that opened it. Close it and sign in again from Astryum.',
        lang,
      );
    case 'not_invited':
      return T(
        'Beta cerrada: ese email aún no tiene plaza. Pide acceso en astryum.xyz/early-access.',
        'Closed beta: that email has no seat yet. Request access at astryum.xyz/early-access.',
        lang,
      );
    case 'oauth_email_unverified':
      return T(
        'XRP Identity no confirma ese email como verificado, y crear cuenta lo exige.',
        'XRP Identity does not confirm that email as verified, and creating an account requires it.',
        lang,
      );
    case 'oauth_email_missing':
      return T(
        'XRP Identity no devolvió email, y crear cuenta lo exige.',
        'XRP Identity returned no email, and creating an account requires it.',
        lang,
      );
    case 'account_disabled':
      return T('Esa cuenta está desactivada.', 'That account is disabled.', lang);
    case 'xrplid_not_configured':
      return T(
        'La puerta de XRP Identity aún no está configurada en el servidor.',
        'The XRP Identity door is not configured on the server yet.',
        lang,
      );
    case 'xrplid_token_unreachable':
      return T(
        'No se ha podido contactar con XRP Identity. Inténtalo en un momento.',
        'XRP Identity could not be reached. Try again in a moment.',
        lang,
      );
    default:
      return T(
        'No se ha podido completar la entrada con XRP Identity.',
        'Sign-in with XRP Identity could not be completed.',
        lang,
      );
  }
}

type Phase = 'decode' | 'granted' | 'denied';

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const reduce = useReducedMotion();
  const [lang] = useLang();
  const loginWithXrplIdentity = useAuthStore((s) => s.loginWithXrplIdentity);
  const [error, setError] = useState<string | null>(null);
  const [courierDone, setCourierDone] = useState(false);
  const [phase, setPhase] = useState<Phase>('decode');
  const [operator, setOperator] = useState<string | null>(null);
  // React 18 StrictMode double-invokes effects in dev; the code is one-shot.
  const ran = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // El manifiesto se arma con lo que SÍ sabemos al aterrizar: el `state` es un
  // secreto de un solo uso de ESTA petición, así que su distintivo identifica
  // el intento sin afirmar nada del usuario que todavía no se ha verificado.
  // Cuando el backend contesta, el operador pasa a ser el suyo de verdad y el
  // campo se vuelve a descodificar solo — la revelación es el dato llegando,
  // no un adorno.
  const stamp = useMemo(() => utcStamp(), []);
  const payload: DecodePayload = useMemo(() => {
    const state = params.get('state') ?? '';
    return {
      operator: operator ?? T('canal xrp identity', 'xrp identity channel', lang),
      callsign: signalIdentity(state || 'xrp-identity'),
      utc: stamp,
      clearance: 'CREW · V1 FLARE',
      mode: 'signin',
    };
  }, [operator, params, lang, stamp]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const providerError = params.get('error');
    const code = params.get('code');
    const state = params.get('state');

    // Popup journey: this window is a courier, not the destination. It carries
    // the code home and closes — the opener (which holds the PKCE verifier and
    // the user's actual page) does the exchange. If close() is refused we say
    // so instead of leaving a blank window on screen.
    //
    // Read from the URL's `state`, never from storage: this window's
    // sessionStorage is a snapshot taken before the attempt even started.
    if (isXrplIdentityPopupCallback(state)) {
      postCallbackToOpener({
        code: code ?? undefined,
        state: state ?? undefined,
        error: providerError ?? undefined,
      });
      setCourierDone(true);
      return;
    }

    // Sent as a popup, but there is no window left to answer. Not CSRF — the
    // tab that asked is gone, and telling the user "CSRF" would be a lie.
    if (stateSaysPopup(state)) {
      setError(reasonCopy('popup_orphaned', lang));
      setPhase('denied');
      return;
    }

    if (providerError) {
      setError(reasonCopy(providerError, lang));
      setPhase('denied');
      return;
    }

    if (!code || !state) {
      setError(reasonCopy('state_mismatch', lang));
      setPhase('denied');
      return;
    }

    const consumed = consumeCallback({ code, state });
    if (!consumed) {
      setError(reasonCopy('state_mismatch', lang));
      setPhase('denied');
      return;
    }

    void (async () => {
      // El teatro tiene tope (misma regla que /login desde 2026-07-21): la
      // ceremonia entera se juega UNA vez por dispositivo; a partir de ahí los
      // mismos compases duran una fracción. El canje corre EN PARALELO, así
      // que el único coste es el mínimo para que el manifiesto se lea.
      //
      // Un fallo del canje TAMBIÉN espera a ese mínimo, a propósito: sin él, el
      // manifiesto aparecería y sería reemplazado en el mismo fotograma, que se
      // lee como un parpadeo roto y no como un rechazo. Los fallos que se ven
      // ANTES de llamar (estado que no cuadra, error del proveedor) no esperan
      // nada — ahí no hay ceremonia empezada que cerrar.
      const showFull = !hasSeenLoginShow() && !reduce;
      markLoginShowSeen();
      const minShow = reduce ? sleep(300) : sleep(showFull ? 2400 : 900);
      try {
        await Promise.all([
          loginWithXrplIdentity(code, consumed.codeVerifier, xrplIdentityRedirectUri()),
          minShow,
        ]);
        if (!alive.current) return;
        // El operador de verdad, ya verificado: el campo se re-descodifica con
        // su nombre. Nunca se inventa — si la sesión no trae ninguno, se queda
        // el del canal.
        const user = useAuthStore.getState().user;
        const real = user?.username || (user?.email ? maskIdentifier(user.email) : null);
        if (real) setOperator(real);
        setPhase('granted');
        await sleep(reduce ? 250 : showFull ? 1600 : 700);
        if (!alive.current) return;
        router.replace(consumed.returnTo);
      } catch (err) {
        await minShow.catch(() => undefined);
        if (!alive.current) return;
        setPhase('denied');
        setError(reasonCopy(err instanceof Error ? err.message : '', lang));
      }
    })();
  }, [params, router, loginWithXrplIdentity, lang, reduce]);

  return (
    <main className="relative min-h-[100dvh] text-white">
      <DeckBackdrop />
      <div className="relative z-10 flex min-h-[100dvh] items-center justify-center p-6">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="relative w-full max-w-[480px]"
        >
          <div
            className="pointer-events-none absolute -inset-px rounded-2xl opacity-60 blur-lg"
            style={{
              background:
                'radial-gradient(120% 100% at 50% 0%, rgba(201,162,39,0.28), rgba(201,162,39,0.03) 55%, transparent)',
            }}
            aria-hidden
          />
          <div
            className="relative overflow-hidden rounded-2xl p-7 sm:p-8"
            style={{
              border: `1px solid ${phase === 'denied' ? 'rgba(248,113,113,0.5)' : 'rgba(201,162,39,0.32)'}`,
              background: 'rgba(10,10,9,0.72)',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 24px 70px rgba(0,0,0,0.5), 0 0 40px rgba(201,162,39,0.07)',
              transition: 'border-color 0.3s ease',
            }}
          >
            {courierDone ? (
              // La ventana mensajera: ya entregó el código y no es el destino.
              // Aquí no hay ceremonia que jugar — hay un encargo cumplido.
              <div className="text-center">
                <span
                  className="inline-flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.2em]"
                  style={{ color: GOLD_SOFT }}
                >
                  <AsteroidGlyph size={14} />
                  XRP Identity
                </span>
                <p className="mt-4 text-[13px] leading-relaxed text-white/70">
                  {T(
                    'Listo. Puedes cerrar esta ventana y volver a Astryum.',
                    'Done. You can close this window and go back to Astryum.',
                    lang,
                  )}
                </p>
              </div>
            ) : (
              <>
                <DecodingManifest
                  lang={lang}
                  payload={payload}
                  granted={phase === 'granted'}
                  denied={phase === 'denied'}
                />
                {/* El motivo, debajo del manifiesto rechazado: la ceremonia dice
                    QUE se cerró el canal, esta línea dice POR QUÉ, y el botón
                    devuelve a la puerta. */}
                {phase === 'denied' && error && (
                  <motion.div
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease: EASE, delay: 0.1 }}
                    className="mt-6 border-t pt-5"
                    style={{ borderColor: 'rgba(255,255,255,0.08)' }}
                  >
                    <p className="text-[12.5px] leading-relaxed text-white/70">{error}</p>
                    <button
                      type="button"
                      onClick={() => router.replace('/login')}
                      className="mt-4 w-full rounded-xl py-3 text-[13px] font-semibold transition-colors"
                      style={{ border: `1px solid ${GOLD}`, background: 'rgba(232,194,90,0.10)', color: GOLD }}
                    >
                      {T('Volver a entrar', 'Sign in again', lang)}
                    </button>
                  </motion.div>
                )}
              </>
            )}
          </div>
        </motion.div>
      </div>
    </main>
  );
}

export default function XrplIdentityCallbackPage() {
  return (
    <Suspense fallback={null}>
      <CallbackInner />
    </Suspense>
  );
}
