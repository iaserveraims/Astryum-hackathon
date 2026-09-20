'use client';

/**
 * Astryum — access console (/login).
 *
 * The command-deck door. Still hidden: you only reach it through the landing's
 * access gate (logo ×5 or Ctrl+Shift+L → access code → signed httpOnly
 * cookie) — middleware.ts bounces direct visits without the cookie back to
 * the landing BEFORE this page is ever served.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useReducedMotion } from '../../stores/motionStore';
import { useAuthStore } from '../../stores/authStore';
import { EASE, GOLD } from '../../components/landing/interactions';
import TurnstileWidget, { turnstileEnabled } from '../../components/security/TurnstileWidget';
import { LegalSignCeremony } from '../../components/legal/LegalSignCeremony';
import {
  appleOAuthEnabled,
  appleSignIn,
  decodeJwtPayload,
  googleOAuthEnabled,
  renderGoogleButton,
} from '../../lib/oauth';
import {
  beginXrplIdentityLogin,
  fetchXrplIdentityConfig,
  openXrplIdentityPopup,
  runXrplIdentityPopupLogin,
  xrplIdentityRedirectUri,
  type PopupLoginResult,
  type XrplIdentityConfig,
} from '../../lib/xrplIdentity/login';
import { legacyDoorsVisible, xrplIdentityDoorVisible } from '../../lib/authDoors';
// EL RITUAL vive en components/auth/AccessRitual: la puerta
// única sale con un redirect de página completa, así que la ceremonia tuvo que
// mudarse a donde de verdad se verifican las credenciales (la vuelta del
// proveedor). Esta pantalla y esa comparten UNA sola copia — dos ceremonias
// serían dos verdades.
import {
  AsteroidGlyph,
  DeckBackdrop,
  DecodeText,
  DecodingManifest,
  FingerprintIcon,
  GOLD_SOFT,
  SIGN_STROKE,
  T,
  hasSeenLoginShow,
  markLoginShowSeen,
  maskIdentifier,
  signalIdentity,
  useLang,
  utcStamp,
  type DecodePayload,
  type Lang,
} from '../../components/auth/AccessRitual';

const LOGO_MARK = '/astryum-asteroid.png';

const EMAIL_AUTH = process.env.NEXT_PUBLIC_EMAIL_AUTH_ENABLED !== 'false';
const PASSKEY_AUTH = process.env.NEXT_PUBLIC_PASSKEY_ENABLED === 'true';


// Backend answers with machine codes — translate the ones a person can act on.
function errorToCopy(code: string, lang: Lang): string {
  switch (code) {
    case 'invalid_credentials':
      return T('Credenciales inválidas.', 'Invalid credentials.', lang);
    case 'email_taken':
      return T('Ese email ya tiene cuenta — prueba a entrar.', 'That email already has an account — try signing in.', lang);
    case 'rate_limited':
      return T('Demasiados intentos. Espera unos minutos.', 'Too many attempts. Wait a few minutes.', lang);
    case 'captcha_required':
    case 'captcha_failed':
      return T('La verificación anti-bot falló. Prueba de nuevo.', 'The anti-bot check failed. Try again.', lang);
    case 'captcha_unavailable':
      return T('Verificación anti-bot no disponible ahora mismo.', 'Anti-bot check unavailable right now.', lang);
    case 'account_disabled':
      return T('Esta cuenta está deshabilitada.', 'This account is disabled.', lang);
    // Passkey login 401s (R5 1.5): the credential lock refused
    // the session because the account's credentials moved while the passkey was
    // being verified. Said so a person can act on it — never the raw code.
    case 'credentials_changed':
      return T(
        'Los métodos de acceso de tu cuenta acaban de cambiar — vuelve a entrar.',
        "Your account's sign-in methods just changed — sign in again.",
        lang,
      );
    case 'credential_revoked':
      return T(
        'Esta passkey ya no es válida para esta cuenta. Entra de otra forma y registra una passkey nueva.',
        'This passkey is no longer valid for this account. Sign in another way and register a new passkey.',
        lang,
      );
    case 'oauth_email_unverified':
      return T('Ese proveedor no verifica tu email — usa email y contraseña.', 'That provider does not verify your email — use email + password.', lang);
    case 'not_invited':
      return T(
        'Beta cerrada: este email aún no tiene plaza. Pide acceso en astryum.xyz/early-access y te escribiremos cuando tu plaza esté aprobada — crea la cuenta con ese mismo email.',
        "Closed beta: this email doesn't have a seat yet. Request access at astryum.xyz/early-access and we'll email you when your seat is approved — create the account with that same email.",
        lang,
      );
    default:
      return code;
  }
}

/**
 * What a failed passkey entry says (R5 1.5).
 *
 * The card used to answer every passkey failure with «La passkey no se pudo
 * verificar.», so the three 401s that a person can actually ACT on — their
 * credentials changed, the passkey was revoked, the account is disabled — arrived
 * as one dead end. The codes that carry an action are translated; everything else
 * (a cancelled WebAuthn prompt, a 422, a dead channel) keeps the generic sentence.
 * The raw code is never printed.
 */
function passkeyErrorToCopy(err: unknown, lang: Lang): string {
  const code = err instanceof Error ? err.message : '';
  switch (code) {
    case 'credentials_changed':
    case 'credential_revoked':
    case 'account_disabled':
    case 'rate_limited':
      return errorToCopy(code, lang);
    default:
      return T('La passkey no se pudo verificar.', 'The passkey could not be verified.', lang);
  }
}

function GoogleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      <path
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 009 18z"
        fill="#34A853"
      />
      <path d="M3.97 10.72a5.4 5.4 0 010-3.44V4.95H.96a9 9 0 000 8.1l3-2.33z" fill="#FBBC05" />
      <path
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A8.98 8.98 0 009 0 9 9 0 00.96 4.95l3 2.33C4.68 5.16 6.66 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}

function AppleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 384 512" fill="currentColor" aria-hidden>
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

// XRP Identity's mark is a fingerprint. Drawn here as a generic one rather than
// shipping their logo file: a trademark we do not own has no business being
// vendored into our bundle, and the meaning survives the difference — the ridges
// read as identity at 18px, which is the whole job.
// ─── Google button slot — our shell, Google's click ──────────────────────────────────
// The card keeps ITS OWN button, but the element that actually
// receives the click is the REAL Google Identity Services button, rendered
// invisible and stretched across the shell. That keeps the official id_token
// popup flow intact — we restyle the shell, never reimplement the auth. If
// the GIS script can't load, the shell dims and stays inert.
function GoogleButtonSlot({ onCredential }: { onCredential: (idToken: string) => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const credentialRef = useRef(onCredential);
  credentialRef.current = onCredential;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    renderGoogleButton(el, (token) => credentialRef.current(token)).catch(() => setFailed(true));
  }, []);

  return (
    <div
      className={`relative overflow-hidden rounded-xl transition-colors ${failed ? '' : 'hover:bg-white/[0.06]'}`}
      style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}
      title={failed ? 'Google no disponible ahora mismo' : undefined}
    >
      {/* the visible shell — visually identical to the Apple button */}
      <div
        className={`pointer-events-none flex items-center justify-center gap-2.5 py-3 text-[13px] font-semibold ${
          failed ? 'text-white/35' : 'text-white/85'
        }`}
      >
        <GoogleIcon />
        Google
      </div>
      {/* the real GIS button: invisible, scaled up so any click on the shell
          lands on it (the iframe keeps Google's popup + FedCM plumbing).
          brightness(0) renders its content pure black — at 1% opacity over the
          dark card that is truly nothing; opacity alone left the widget's own
          "Continue with Google" ghosting through the shell. Clicks are unaffected: filters are
          paint-only. */}
      {!failed && (
        <div
          ref={overlayRef}
          className="absolute inset-0 z-10 flex items-center justify-center"
          style={{
            opacity: 0.01,
            filter: 'brightness(0)',
            transform: 'scale(2.6)',
            transformOrigin: 'center',
            colorScheme: 'light',
          }}
        />
      )}
    </div>
  );
}

// ─── Manifest readout shown while credentials verify ─────────────────────────────────
// ─── The page ────────────────────────────────────────────────────────────────────────
type Phase = 'form' | 'decode' | 'granted' | 'denied';
type Mode = 'signin' | 'create';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function LoginPage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [lang, setLang] = useLang();
  const { loginWithEmail, registerWithEmail, loginWithPasskey, loginWithOAuth, loginWithXrplIdentity, isAuthenticated, clearError } = useAuthStore();

  // A popup is in flight. Not state: a second click must be swallowed without a
  // re-render, or it would overwrite the PKCE material the first one is waiting
  // on and turn its answer into a state_mismatch.
  const xrplidPending = useRef(false);
  // La huella encendida: el clic de la puerta única no tenía acuse ninguno
  // —el redirect de página completa se lleva la pestaña— así que se quedaba
  // muerto hasta que el navegador se iba. Ahora escanea mientras se hace el
  // trabajo real (pedir configuración, componer el reto PKCE).
  const [xrplScanning, setXrplScanning] = useState(false);

  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState<Mode>('signin');
  const [phase, setPhase] = useState<Phase>('form');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // Create-mode crew manifest: who is boarding (saved on the account for the
  // full launch — deliberately light, no phone/2FA yet).
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [payload, setPayload] = useState<DecodePayload | null>(null);
  const [stubHover, setStubHover] = useState(false);
  const [signing, setSigning] = useState(false);
  // XRP Identity door: hidden until the backend confirms a client id is
  // registered AND that this origin's callback is one it will return to.
  // Starts null so the card never flashes a door that isn't there.
  const [xrplIdConfig, setXrplIdConfig] = useState<XrplIdentityConfig | null>(null);
  const [doorsResolved, setDoorsResolved] = useState(false);
  const xrplIdReady = xrplIdentityDoorVisible({ config: xrplIdConfig, resolved: doorsResolved });
  // Email / Google / Apple / passkey. In production they are hidden behind the
  // single door; on a preview or on localhost — where XRP Identity physically
  // cannot complete — they are the only way in. See lib/authDoors.
  const legacyDoors = legacyDoorsVisible({ config: xrplIdConfig, resolved: doorsResolved });
  // Anti-bot: one Turnstile token per submit (single-use — resetSignal mints
  // a fresh one after every failed attempt).
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  // LA FIRMA DE LOS DOCUMENTOS: crear cuenta ya no es
  // aceptación por conducta bajo una línea de letra pequeña — hay que leer las
  // condiciones y el aviso hasta el final y FIRMAR deslizando, como en Xaman.
  // La ceremonia se abre DESPUÉS de validar el formulario: nadie lee cinco
  // minutos para descubrir luego que la contraseña era corta. El ref es lo que
  // mira el envío (el estado aún no habría llegado en el mismo tick); el
  // estado solo pinta el recibo en la tarjeta.
  const [showLegal, setShowLegal] = useState(false);
  const [legalSigned, setLegalSigned] = useState(false);
  const legalSignedRef = useRef(false);
  // Demo-risk acceptance: NO modal —
  // fear-free signup. The risks live as PUBLIC reviewable documentation
  // (/demo-terms) and the create button carries the standard notice line
  // linking to it; pressing "Crear y firmar" under that notice is the
  // acceptance. The backend still requires and records it (demoTermsAccepted
  // literal + version/timestamp on the user).
  const alive = useRef(true);
  // Whether THIS device has ever seen the full decode cinematic — read once on
  // mount (localStorage is client-only); submit/onPasskey read the ref, never
  // the (possibly stale) render.
  const firstShowRef = useRef(true);

  useEffect(() => {
    alive.current = true;
    firstShowRef.current = !hasSeenLoginShow();
    return () => {
      alive.current = false;
    };
  }, []);

  // Ask the backend whether the XRP Identity door exists yet. It answers 503
  // (→ null) until its client id is registered, and the button stays hidden.
  // The same answer decides whether the old doors show: see lib/authDoors.
  useEffect(() => {
    void fetchXrplIdentityConfig().then((config) => {
      if (!alive.current) return;
      setXrplIdConfig(config);
      setDoorsResolved(true);
    });
  }, []);

  useEffect(() => {
    setHydrated(true);
    // /register redirects here with ?mode=create — open the card on that run.
    try {
      if (new URLSearchParams(window.location.search).get('mode') === 'create') setMode('create');
    } catch {
      /* ignore */
    }
    // Still a hidden door — but the check moved server-side: middleware.ts
    // already bounced anyone without the signed gate cookie before this page
    // was served, so no client-side flag check remains.
    if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true') {
      router.replace('/app');
      return;
    }
    // Don't yank the page away mid-decode; that path performs its own redirect.
    if (isAuthenticated && phase === 'form') router.replace('/app');
  }, [isAuthenticated, router, phase]);

  const beginDecode = (op: string, m: Mode) => {
    setPayload({
      // On a fresh crew card the manifest shows the chosen call-name; sign-in
      // keeps the masked channel id.
      operator: m === 'create' && username.trim() ? username.trim() : op.includes('@') ? maskIdentifier(op) : op,
      callsign: signalIdentity(op.trim().toLowerCase()),
      utc: utcStamp(),
      clearance: m === 'create' ? 'CREW · NEW' : 'CREW · V1 FLARE',
      mode: m,
    });
    setPhase('decode');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await attemptSubmit();
  };

  const attemptSubmit = async () => {
    if (phase !== 'form' || signing) return;
    setFormError('');
    setNotice('');
    clearError();

    const id = identifier.trim();
    if (mode === 'create') {
      if (username.trim().length < 2) {
        setFormError(T('Elige un alias (2+ caracteres).', 'Pick a username (2+ characters).', lang));
        return;
      }
      if (!firstName.trim() || !lastName.trim()) {
        setFormError(T('Dinos tu nombre y apellidos.', 'Tell us your first and last name.', lang));
        return;
      }
      if (password.length < 8) {
        setFormError(T('La contraseña necesita al menos 8 caracteres.', 'Password needs at least 8 characters.', lang));
        return;
      }
      if (password !== confirm) {
        setFormError(T('Las contraseñas no coinciden.', 'Passwords do not match.', lang));
        return;
      }
    }
    if (turnstileEnabled() && !captchaToken) {
      setFormError(T('Completa la verificación anti-bot.', 'Complete the anti-bot check.', lang));
      return;
    }

    // Sin firma no hay cuenta. Se pide aquí, con el formulario ya válido.
    if (mode === 'create' && !legalSignedRef.current) {
      setShowLegal(true);
      return;
    }

    // Ink the signature before the card is submitted — you sign, then it flies.
    // Full cinematic once per device; every login after that keeps the same
    // beats, capped (reduced motion still overrides both tiers).
    const showFull = firstShowRef.current && !reduce;
    if (firstShowRef.current) {
      firstShowRef.current = false;
      markLoginShowSeen();
    }
    setSigning(true);
    await sleep(reduce ? 0 : showFull ? 560 : 200);
    if (!alive.current) return;

    beginDecode(id, mode);
    setSigning(false);
    const minShow = reduce ? sleep(400) : sleep(showFull ? 3000 : 600);

    try {
      // Every entry is a real backend account now — the old in-bundle
      // "judges' credentials" died with the server-side gate.
      if (mode === 'create')
        await Promise.all([
          registerWithEmail(
            id,
            password,
            {
              username: username.trim(),
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              // La firma ya está dada (LegalSignCeremony, arriba): documentos
              // leídos hasta el final y flecha deslizada. Este literal es lo
              // que el backend exige para sellar versión + fecha en la cuenta.
              demoTermsAccepted: true,
              // …y el aviso de privacidad, leído hasta el final en la misma
              // ceremonia: el servidor escribe el registro unificado al nacer
              // la cuenta y la puerta del panel no vuelve a pedir lo mismo.
              privacyRead: true,
            },
            captchaToken,
          ),
          minShow,
        ]);
      else await Promise.all([loginWithEmail(id, password, captchaToken), minShow]);
      if (!alive.current) return;
      setPhase('granted');
      await sleep(reduce ? 250 : showFull ? 1500 : 400);
      if (!alive.current) return;
      router.replace('/app');
    } catch (err) {
      // Let the readout reach the "verifying" beat before rejecting.
      await minShow.catch(() => undefined);
      if (!alive.current) return;
      setPhase('denied');
      await sleep(reduce ? 250 : 950);
      if (!alive.current) return;
      setCaptchaReset((n) => n + 1); // token was consumed — mint a fresh one
      setFormError(
        err instanceof Error && err.message && !err.message.startsWith('http_')
          ? errorToCopy(err.message, lang)
          : T('Credenciales inválidas o canal caído. Prueba de nuevo.', 'Invalid credentials or channel down. Try again.', lang),
      );
      setPhase('form');
    }
  };

  const onOAuthNotConfigured = (provider: 'Google' | 'Apple') => {
    setNotice(
      T(
        `Canal ${provider} aún no operativo — entra con email de momento.`,
        `${provider} channel not open yet — use email for now.`,
        lang,
      ),
    );
  };

  // Shared OAuth landing: the provider popup already happened; exchange the
  // id_token at the backend (which verifies it against the provider's JWKS)
  // and ride the same decode/grant readout as every other door.
  const onOAuthToken = async (
    provider: 'google' | 'apple',
    idToken: string,
    profile?: { firstName?: string; lastName?: string },
  ) => {
    if (phase !== 'form' || signing) return;
    setFormError('');
    setNotice('');
    clearError();
    const claims = decodeJwtPayload(idToken);
    const operator = typeof claims.email === 'string' ? claims.email : provider;
    const showFull = firstShowRef.current && !reduce;
    if (firstShowRef.current) {
      firstShowRef.current = false;
      markLoginShowSeen();
    }
    beginDecode(operator, 'signin');
    const minShow = reduce ? sleep(400) : sleep(showFull ? 2400 : 600);
    try {
      await Promise.all([loginWithOAuth(provider, idToken, profile), minShow]);
      if (!alive.current) return;
      setPhase('granted');
      await sleep(reduce ? 250 : showFull ? 1500 : 400);
      if (!alive.current) return;
      router.replace('/app');
    } catch (err) {
      await minShow.catch(() => undefined);
      if (!alive.current) return;
      setPhase('denied');
      await sleep(reduce ? 250 : 950);
      if (!alive.current) return;
      setFormError(
        err instanceof Error && err.message && !err.message.startsWith('http_')
          ? errorToCopy(err.message, lang)
          : T('El canal no respondió. Prueba de nuevo.', 'The channel did not answer. Try again.', lang),
      );
      setPhase('form');
    }
  };

  // INERT — the landing half of the popup journey, kept whole.
  //
  // Nothing calls it while the door uses the full-page redirect (the callback
  // page does this job there instead). It stays because the popup was built and
  // tested, and reviving it is a matter of replacing ONE thing: the handoff must
  // stop depending on `window.opener`, which privacy modes sever. See the note
  // on onXrplIdentity below.
  const completeXrplIdentity = async (handed: PopupLoginResult) => {
    const showFull = firstShowRef.current && !reduce;
    if (firstShowRef.current) {
      firstShowRef.current = false;
      markLoginShowSeen();
    }
    beginDecode('xrp identity', 'signin');
    const minShow = reduce ? sleep(400) : sleep(showFull ? 2400 : 600);
    try {
      await Promise.all([
        loginWithXrplIdentity(handed.code, handed.codeVerifier, xrplIdentityRedirectUri()),
        minShow,
      ]);
      if (!alive.current) return;
      setPhase('granted');
      await sleep(reduce ? 250 : showFull ? 1500 : 400);
      if (!alive.current) return;
      router.replace(handed.returnTo);
    } catch (err) {
      await minShow.catch(() => undefined);
      if (!alive.current) return;
      setPhase('denied');
      await sleep(reduce ? 250 : 950);
      if (!alive.current) return;
      setFormError(
        err instanceof Error && err.message && !err.message.startsWith('http_')
          ? errorToCopy(err.message, lang)
          : T('El canal no respondió. Prueba de nuevo.', 'The channel did not answer. Try again.', lang),
      );
      setPhase('form');
    }
  };

  // XRP Identity — the ecosystem's own door, and Astryum's main one. No token
  // ever reaches this browser: the popup brings back a one-time code and the
  // backend is the one that redeems it against the provider.
  const onXrplIdentity = async (forceAccountChoice = false) => {
    if (phase !== 'form' || signing || xrplidPending.current) return;
    setFormError('');
    setNotice('');
    clearError();

    xrplidPending.current = true;
    setXrplScanning(true);

    try {
      // `/app/home` SI existe en esta rama (frontend/src/app/app/home/page.tsx),
      // que es lo que main no podia asumir: alli el hub aun no estaba publicado y
      // por eso su comentario apuntaba la puerta unica a `/app` para no aterrizar
      // en un 404 que solo sufriria el camino nuevo. Al liberar la ventana el hub
      // viaja con ella, asi que aqui el destino correcto vuelve a ser el hub.
      // El escaneo corre EN PARALELO con la salida, no delante: el suelo solo
      // garantiza que se llegue a leer si la red contesta antes de tiempo.
      // Bajo prefers-reduced-motion no hay suelo — no hay nada que mirar.
      await Promise.all([
        beginXrplIdentityLogin('/app', { forceAccountChoice }),
        reduce ? Promise.resolve() : sleep(760),
      ]);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setNotice(
        code === 'xrplid_redirect_not_registered'
          ? T(
              'Esta dirección aún no está registrada en XRP Identity.',
              'This origin is not registered with XRP Identity yet.',
              lang,
            )
          : code === 'state_mismatch'
            ? T(
                'La respuesta no coincide con la petición que salió de este navegador. Prueba otra vez.',
                'The answer does not match the request that left this browser. Try again.',
                lang,
              )
            : code === 'access_denied'
              ? T('Entrada cancelada en XRP Identity.', 'Sign-in cancelled at XRP Identity.', lang)
              : T(
                  'Canal XRP Identity aún no operativo — entra con email de momento.',
                  'XRP Identity channel not open yet — use email for now.',
                  lang,
                ),
      );
    } finally {
      xrplidPending.current = false;
      if (alive.current) setXrplScanning(false);
    }
  };

  const onAppleClick = async () => {
    if (!appleOAuthEnabled()) {
      onOAuthNotConfigured('Apple');
      return;
    }
    if (phase !== 'form' || signing) return;
    try {
      const { idToken, profile } = await appleSignIn();
      await onOAuthToken('apple', idToken, profile);
    } catch {
      // Popup dismissed / SDK unavailable — a quiet notice, not a denial.
      setNotice(T('Inicio con Apple cancelado o no disponible.', 'Apple sign-in was cancelled or unavailable.', lang));
    }
  };

  const onPasskey = async () => {
    if (phase !== 'form' || signing) return;
    setFormError('');
    setNotice('');
    clearError();
    const showFull = firstShowRef.current && !reduce;
    if (firstShowRef.current) {
      firstShowRef.current = false;
      markLoginShowSeen();
    }
    beginDecode(identifier.trim() || 'passkey', 'signin');
    const minShow = reduce ? sleep(400) : sleep(showFull ? 2400 : 600);
    try {
      await Promise.all([loginWithPasskey(), minShow]);
      if (!alive.current) return;
      setPhase('granted');
      await sleep(reduce ? 250 : showFull ? 1500 : 400);
      if (!alive.current) return;
      router.replace('/app');
    } catch (err) {
      await minShow.catch(() => undefined);
      if (!alive.current) return;
      setPhase('denied');
      await sleep(reduce ? 250 : 950);
      if (!alive.current) return;
      setFormError(passkeyErrorToCopy(err, lang));
      setPhase('form');
    }
  };

  if (!hydrated) return null;

  const busy = phase !== 'form';
  // Ticket fields: bare mono text over a hairline, like filling a printed card.
  const fieldCls =
    'w-full bg-transparent border-0 border-b border-white/15 rounded-none px-0 py-2 font-mono text-[13.5px] text-white/90 placeholder-white/20 focus:outline-none focus:ring-0 focus:border-[#C9A227] transition-colors';
  const labelCls = 'block font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 mb-1';

  return (
    <div className="relative min-h-screen text-white" style={{ background: '#080808', overflowX: 'clip' }}>
      <DeckBackdrop />

      <div className="relative z-10 min-h-screen flex flex-col px-6">
        {/* top bar */}
        <header className="max-w-6xl mx-auto w-full flex items-center justify-between pt-5">
          <Link href="/" className="flex items-center shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_MARK} alt="Astryum" style={{ height: 46, width: 'auto', display: 'block' }} />
          </Link>
          <div
            className="flex items-center gap-0.5 p-0.5 rounded-full"
            style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
          >
            {(['es', 'en'] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className="px-3 py-1.5 rounded-full text-xs font-medium transition-all uppercase"
                style={{ background: lang === l ? GOLD : 'transparent', color: lang === l ? '#000' : 'rgba(255,255,255,0.4)' }}
              >
                {l}
              </button>
            ))}
          </div>
        </header>

        {/* the access pass */}
        <main className="flex-1 flex items-center justify-center py-10">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="relative w-full max-w-[480px]"
          >
            <div
              className="absolute -inset-px rounded-2xl opacity-60 blur-lg pointer-events-none"
              style={{ background: 'radial-gradient(120% 100% at 50% 0%, rgba(201,162,39,0.28), rgba(201,162,39,0.03) 55%, transparent)' }}
              aria-hidden
            />
            <div
              className="relative rounded-2xl p-7 sm:p-8 overflow-hidden"
              style={{
                border: `1px solid ${phase === 'denied' ? 'rgba(248,113,113,0.5)' : 'rgba(201,162,39,0.32)'}`,
                background: 'rgba(10,10,9,0.72)',
                backdropFilter: 'blur(12px)',
                boxShadow: '0 24px 70px rgba(0,0,0,0.5), 0 0 40px rgba(201,162,39,0.07)',
                transition: 'border-color 0.3s ease',
              }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {busy && payload ? (
                  // El hijo directo de la frontera DEBE ser motion.* o el
                  // intercambio se queda a medias: con `mode="wait"` el que
                  // entra espera a que salga el anterior, y un componente que
                  // no es motion.* no avisa nunca de que terminó — el
                  // formulario no volvía. Ver LegalAcceptGate/ModalPortal.
                  <motion.div key="decoding" exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                    <DecodingManifest lang={lang} payload={payload} granted={phase === 'granted'} denied={phase === 'denied'} />
                  </motion.div>
                ) : (
                  <motion.div
                    key="form"
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                    transition={{ duration: 0.35, ease: EASE }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                        <AsteroidGlyph size={14} />
                        {T('Astryum · Pase de acceso', 'Astryum · Access pass', lang)}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/30">V1 · Flare</span>
                    </div>

                    <h1 className="mt-5 text-[26px] sm:text-3xl font-bold text-white" style={{ letterSpacing: '-0.025em' }}>
                      {T('Firma tu sesión.', 'Sign your session.', lang)}
                    </h1>
                    <p className="mt-2 text-sm text-white/55 leading-relaxed">
                      {T(
                        'Beta privada. Rellena la tarjeta y firma — la cuenta abre la consola; tu wallet se conecta después, dentro.',
                        'Private beta. Fill the card and sign — the account opens the console; your wallet connects later, inside.',
                        lang,
                      )}
                    </p>

                    {/* mode switch — the card's two print runs. It only steers
                        the email form, so behind the single door it would be a
                        pair of tabs governing nothing: it goes with them.
                        Creating an account then happens at XRP Identity. */}
                    {EMAIL_AUTH && legacyDoors && (
                    <div
                      role="tablist"
                      aria-label={T('Modo de acceso', 'Access mode', lang)}
                      className="mt-6 grid grid-cols-2 gap-0.5 p-0.5 rounded-xl"
                      style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
                    >
                      {(
                        [
                          ['signin', T('Entrar', 'Sign in', lang)],
                          ['create', T('Crear cuenta', 'Create account', lang)],
                        ] as [Mode, string][]
                      ).map(([m, txt]) => (
                        <button
                          key={m}
                          role="tab"
                          aria-selected={mode === m}
                          onClick={() => {
                            setMode(m);
                            setFormError('');
                            setNotice('');
                          }}
                          className="py-2 rounded-[10px] font-mono text-[11px] uppercase tracking-[0.14em] font-semibold transition-all"
                          style={{ background: mode === m ? GOLD : 'transparent', color: mode === m ? '#000' : 'rgba(255,255,255,0.45)' }}
                        >
                          {txt}
                        </button>
                      ))}
                    </div>
                    )}

                    {(formError || notice) && (
                      <motion.div
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="mt-4 px-3.5 py-2.5 rounded-lg font-mono text-[11.5px] leading-snug"
                        style={
                          formError
                            ? { border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.08)', color: '#fca5a5' }
                            : { border: '1px solid rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.07)', color: '#fcd34d' }
                        }
                        role="alert"
                      >
                        {formError ? `✗ ${formError}` : `◆ ${notice}`}
                      </motion.div>
                    )}

                    {/* The main door: the XRPL ecosystem's own identity.
                        Astryum runs on XRPL, so the entrance is XRPL's too —
                        one account for the ecosystem, and the wallet you
                        already use to sign. Email stays below as a fallback,
                        not as an equal.
                    { *
                        It only renders once the backend confirms the provider
                        is configured. A gold hero button that answers "channel
                        not open yet" is a dead button, and we have paid for
                        that lesson already (the beta bounce). The
                        day XRPL_IDENTITY_CLIENT_ID lands in Railway, this door
                        appears on its own — no deploy needed. */}
                    {xrplIdReady && (
                      <>
                        <button
                          onClick={() => void onXrplIdentity()}
                          disabled={busy || signing || xrplScanning}
                          className="mt-6 w-full inline-flex items-center justify-center gap-2.5 py-3.5 rounded-xl text-[13.5px] font-semibold transition-colors disabled:opacity-100"
                          style={{
                            border: `1px solid ${GOLD}`,
                            background: xrplScanning ? 'rgba(232,194,90,0.18)' : 'rgba(232,194,90,0.10)',
                            color: GOLD,
                          }}
                        >
                          <FingerprintIcon scanning={xrplScanning} />
                          {/* Untranslated on purpose, like Google's and Apple's:
                              it is the provider's own name for its door, and a
                              user who sees it here must recognise it there.
                              Y NO cambia al pulsar: el
                              rótulo se sustituía por «Abriendo canal…», que es
                              más corto, así que el contenido del botón saltaba
                              — y las letras cifradas de DecodeText, medidas en
                              una tipografía proporcional, se salían de la caja
                              que reservaban. El acuse vive en la línea de
                              abajo, que sí tiene sitio para cambiar. */}
                          Sign in with XRP Identity
                        </button>
                        {/* Alto reservado: esta línea cambia de texto mientras
                            se abre el canal, y sin el suelo lo de abajo daría
                            un salto al pasar de dos líneas a una. */}
                        <p className="mt-2 min-h-[2.4em] text-center font-mono text-[10px] leading-relaxed text-white/35">
                          {xrplScanning ? (
                            <span style={{ color: GOLD_SOFT }}>
                              <DecodeText text={T('Abriendo canal seguro…', 'Opening secure channel…', lang)} duration={520} />
                            </span>
                          ) : (
                            T(
                              'Tu identidad del ecosistema XRPL. Para operar, firmarás con tu wallet.',
                              'Your XRPL ecosystem identity. To operate, you will sign with your wallet.',
                              lang,
                            )
                          )}
                        </p>
                        {/* The escape hatch from someone else's SSO cookie: a
                            shared laptop, or two identities of the same person.
                            Without it the only way out is signing out at
                            account.xrpl.in, which nobody finds. */}
                        <button
                          onClick={() => void onXrplIdentity(true)}
                          disabled={busy || signing}
                          className="mt-2 w-full text-center font-mono text-[10px] underline underline-offset-2 text-white/35 hover:text-white/60 transition-colors disabled:opacity-50"
                        >
                          {T('Entrar con otra cuenta', 'Use a different account', lang)}
                        </button>

                        {EMAIL_AUTH && legacyDoors && (
                          <div className="my-5 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">
                            <span className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                            {T('o con tu email', 'or with your email', lang)}
                            <span className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                          </div>
                        )}
                      </>
                    )}

                    {EMAIL_AUTH && legacyDoors && (
                      <form onSubmit={submit} className="mt-6">
                        {/* the card's fields — filled in like a printed form */}
                        <div className="space-y-5">
                          {mode === 'create' && (
                            <>
                              <div>
                                <label htmlFor="alias" className={labelCls}>
                                  {T('Alias · nombre en cubierta', 'Username · deck name', lang)}
                                </label>
                                <input
                                  id="alias"
                                  type="text"
                                  autoComplete="nickname"
                                  required
                                  maxLength={32}
                                  value={username}
                                  onChange={(e) => setUsername(e.target.value)}
                                  placeholder="stargazer"
                                  className={fieldCls}
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-5">
                                <div>
                                  <label htmlFor="fn" className={labelCls}>
                                    {T('Nombre', 'First name', lang)}
                                  </label>
                                  <input
                                    id="fn"
                                    type="text"
                                    autoComplete="given-name"
                                    required
                                    maxLength={64}
                                    value={firstName}
                                    onChange={(e) => setFirstName(e.target.value)}
                                    placeholder="Ada"
                                    className={fieldCls}
                                  />
                                </div>
                                <div>
                                  <label htmlFor="ln" className={labelCls}>
                                    {T('Apellidos', 'Last name', lang)}
                                  </label>
                                  <input
                                    id="ln"
                                    type="text"
                                    autoComplete="family-name"
                                    required
                                    maxLength={64}
                                    value={lastName}
                                    onChange={(e) => setLastName(e.target.value)}
                                    placeholder="Lovelace"
                                    className={fieldCls}
                                  />
                                </div>
                              </div>
                            </>
                          )}
                          <div>
                            <label htmlFor="op" className={labelCls}>
                              {T('Operador · email', 'Operator · email', lang)}
                            </label>
                            <input
                              id="op"
                              type="text"
                              inputMode="email"
                              autoComplete="username"
                              required
                              value={identifier}
                              onChange={(e) => setIdentifier(e.target.value)}
                              placeholder={T('tu@correo.com', 'you@example.com', lang)}
                              className={fieldCls}
                            />
                          </div>
                          <div className={mode === 'create' ? 'grid grid-cols-2 gap-5' : ''}>
                            <div>
                              <label htmlFor="pw" className={labelCls}>
                                {T('Contraseña', 'Password', lang)}
                              </label>
                              <input
                                id="pw"
                                type="password"
                                autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className={fieldCls}
                              />
                            </div>
                            {mode === 'create' && (
                              <div>
                                <label htmlFor="pw2" className={labelCls}>
                                  {T('Confirmar', 'Confirm', lang)}
                                </label>
                                <input
                                  id="pw2"
                                  type="password"
                                  autoComplete="new-password"
                                  required
                                  value={confirm}
                                  onChange={(e) => setConfirm(e.target.value)}
                                  placeholder="••••••••"
                                  className={fieldCls}
                                />
                              </div>
                            )}
                          </div>
                        </div>

                        {/* the printed terms — the invariants, on the ticket */}
                        <div className="mt-6 grid grid-cols-3 gap-3 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                          {(
                            [
                              [T('Custodia', 'Custody', lang), T('Tuya', 'Yours', lang)],
                              [T('Claves', 'Keys', lang), T('Nunca salen', 'Never leave', lang)],
                              [T('Red', 'Network', lang), 'Flare · V1'],
                            ] as [string, string][]
                          ).map(([k, v]) => (
                            <div key={k}>
                              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/30">{k}</div>
                              <div className="mt-1 text-[12px] font-semibold text-white/85">{v}</div>
                            </div>
                          ))}
                        </div>

                        {/* anti-bot check — renders only when the sitekey is configured */}
                        <TurnstileWidget
                          onToken={setCaptchaToken}
                          resetSignal={captchaReset}
                          theme="dark"
                          className="mt-5"
                        />

                        {/* perforation */}
                        <div className="my-5" style={{ borderTop: '1px dashed rgba(255,255,255,0.18)' }} aria-hidden />

                        {/* the stub — sign here. Hover previews the ink; submitting draws it. */}
                        <button
                          type="submit"
                          disabled={busy || signing}
                          onMouseEnter={() => setStubHover(true)}
                          onMouseLeave={() => setStubHover(false)}
                          className="group w-full flex items-center justify-between gap-4 rounded-xl px-5 py-3 text-left transition-colors disabled:opacity-60"
                          style={{
                            border: '1px dashed rgba(201,162,39,0.5)',
                            background: stubHover || signing ? 'rgba(201,162,39,0.1)' : 'rgba(201,162,39,0.05)',
                          }}
                        >
                          <div className="min-w-0">
                            <div className="font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: GOLD_SOFT }}>
                              {T('Firma aquí', 'Sign here', lang)}
                            </div>
                            <svg viewBox="0 0 104 40" className="mt-0.5 w-[150px]" fill="none" aria-hidden>
                              <motion.path
                                d={SIGN_STROKE}
                                stroke={GOLD_SOFT}
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                initial={false}
                                animate={{ pathLength: reduce ? 1 : signing ? 1 : stubHover ? 0.24 : 0.06 }}
                                transition={{ duration: signing ? 0.5 : 0.35, ease: 'easeInOut' }}
                              />
                              <line x1="4" y1="33" x2="100" y2="33" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
                            </svg>
                          </div>
                          <span
                            className="shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-[12px] font-bold text-black"
                            style={{ background: GOLD, boxShadow: '0 6px 22px rgba(201,162,39,0.25)' }}
                          >
                            {signing
                              ? T('Firmando…', 'Signing…', lang)
                              : mode === 'create'
                                ? T('Crear y firmar', 'Create & sign', lang)
                                : T('Firmar y entrar', 'Sign & enter', lang)}
                            {!signing && (
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="transition-transform duration-300 group-hover:translate-x-0.5">
                                <path d="M3 8H13M13 8L9 4M13 8L9 12" stroke="black" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                        </button>

                        {/* La línea de siempre dice ahora lo que
                            de verdad pasa: los documentos se leen y se
                            FIRMAN en el paso siguiente, no se aceptan por
                            pulsar un botón debajo de una línea. Firmada la
                            ceremonia, la línea se convierte en su recibo. */}
                        {mode === 'create' && legalSigned && (
                          <p className="mt-3 flex items-center justify-center gap-1.5 text-center font-mono text-[10px] leading-relaxed text-emerald-400/80">
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
                              <path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {T(
                              'Condiciones y aviso de privacidad leídos y firmados.',
                              'Terms and privacy notice read and signed.',
                              lang,
                            )}
                          </p>
                        )}
                        {mode === 'create' && !legalSigned && (
                          <p className="mt-3 text-center font-mono text-[10px] leading-relaxed text-white/35">
                            {T('Antes de crear la cuenta tendrás que leer y firmar el ', 'Before the account is created you will read and sign the ', lang)}
                            <a
                              href="/demo-terms"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-2 transition-colors hover:text-white/70"
                              style={{ color: GOLD_SOFT }}
                            >
                              {T('aviso de riesgos de la demo', 'demo risk notice', lang)}
                            </a>
                            {T(' — demo experimental con XRP real, bajo topes — y el ', ' — an experimental demo with real XRP, under caps — and the ', lang)}
                            <a
                              href="/privacy"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-2 transition-colors hover:text-white/70"
                              style={{ color: GOLD_SOFT }}
                            >
                              {T('aviso de privacidad', 'privacy notice', lang)}
                            </a>
                            {T('. También puedes leerlos aquí antes.', '. You can also read them here first.', lang)}
                          </p>
                        )}
                      </form>
                    )}

                    {/* Google / Apple. NOT the same door with another icon:
                        these create Astryum-native accounts on their own rail,
                        so under the single-door decision they are hidden, never
                        re-pointed at XRP Identity — same look, other meaning. */}
                    {legacyDoors && (
                    <>
                    <div className="my-5 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">
                      <span className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                      {T('o continúa con', 'or continue with', lang)}
                      <span className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {googleOAuthEnabled() ? (
                        <GoogleButtonSlot onCredential={(idToken) => void onOAuthToken('google', idToken)} />
                      ) : (
                        <button
                          onClick={() => onOAuthNotConfigured('Google')}
                          className="inline-flex items-center justify-center gap-2.5 py-3 rounded-xl text-[13px] font-semibold text-white/85 transition-colors hover:bg-white/[0.06]"
                          style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}
                        >
                          <GoogleIcon />
                          Google
                        </button>
                      )}
                      <button
                        onClick={() => void onAppleClick()}
                        className="inline-flex items-center justify-center gap-2.5 py-3 rounded-xl text-[13px] font-semibold text-white/85 transition-colors hover:bg-white/[0.06]"
                        style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}
                      >
                        <AppleIcon />
                        Apple
                      </button>
                    </div>

                    {PASSKEY_AUTH && (
                      <button
                        onClick={onPasskey}
                        disabled={busy || signing}
                        className="mt-3 w-full py-3 rounded-xl text-[13px] font-semibold text-white/70 transition-colors hover:bg-white/[0.05] disabled:opacity-50"
                        style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                      >
                        {T('Entrar con passkey', 'Sign in with passkey', lang)}
                      </button>
                    )}
                    </>
                    )}

                    <div className="mt-6 flex items-center justify-between font-mono text-[10.5px] text-white/35">
                      {legacyDoors && EMAIL_AUTH ? (
                        <Link href="/forgot-password" className="hover:text-white/70 transition-colors">
                          {T('¿Contraseña olvidada?', 'Forgot password?', lang)}
                        </Link>
                      ) : (
                        <span />
                      )}
                      <Link href="/" className="hover:text-white/70 transition-colors">
                        ← {T('Volver', 'Back', lang)}
                      </Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </main>

        {/* the invariant, printed on the door */}
        <footer className="max-w-6xl mx-auto w-full pb-6 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/25">
            {T('Cero claves de usuario en nuestros servidores · Tú siempre firmas', 'Zero user keys on our servers · You always sign', lang)}
          </p>
        </footer>
      </div>

      {/* LEER Y FIRMAR. Se abre con el formulario ya válido; al
          deslizar la flecha, la cuenta se crea de verdad. Cerrarla no firma
          nada y deja la tarjeta como estaba: firmar es un acto, cerrar no. */}
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
      {showLegal && (
        <LegalSignCeremony
          lang={lang}
          signLabel={T('Desliza para firmar y crear tu cuenta', 'Slide to sign and create your account', lang)}
          onCancel={() => setShowLegal(false)}
          onSigned={() => {
            legalSignedRef.current = true;
            setLegalSigned(true);
            setShowLegal(false);
            void attemptSubmit();
          }}
        />
      )}
    </div>
  );
}
