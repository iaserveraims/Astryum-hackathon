import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { markLiveWalletSession } from '../lib/demoMode';
import { legalGateBlocks } from '../lib/legal/legalGateMode';
import { getApiBase } from '../lib/env';
import { saveProfile, withStoredProfile } from '../lib/profileStore';
import { requestAccountChoiceOnNextLogin } from '../lib/xrplIdentity/login';

interface User {
  id: string;
  address?: string;
  email?: string;
  username?: string;
  avatar?: string;
  preferences?: {
    theme?: 'light' | 'dark';
    notifications?: boolean;
    expertMode?: boolean;
  };
}

export interface LinkedWallet {
  id: string;
  address: string;
  chainType: string;
  label?: string | null;
  mode?: string;
  linkedAt?: string;
}

// A short-lived step-up grant, keyed by `${feature}:${action}`. Held in memory
// only — never persisted (a stolen localStorage must not carry elevation).
export interface StepUpGrant {
  token: string;
  expiresAt: number; // epoch ms
}

/**
 * The legal gate as /auth/me reports it (2026-09-13: with the WHY and the
 * record). `reason` and `accepted` are optional — an older backend without
 * them still opens the gate for both documents.
 */
export interface LegalGateState {
  required: boolean;
  termsVersion: string;
  privacyVersion: string;
  reason?: 'first' | 'terms' | 'privacy' | 'both' | null;
  accepted?: { termsVersion: string | null; privacyVersion: string | null; acceptedAt: string | null } | null;
  /**
   * it. 25 — el tercer estado: el servidor NO PUDO LEER la ficha de esta
   * cuenta. Llega con `required: false` a propósito (una lectura ilegible no
   * encierra a nadie fuera de su aplicación) y la puerta lo pinta como una
   * frase, no como una puerta. Ausente en un backend viejo ⇒ undefined ⇒ se
   * comporta exactamente como antes. Ver lib/legal/legalGateMode.
   */
  unreadable?: boolean;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  linkedWallets: LinkedWallet[];
  stepUpGrants: Record<string, StepUpGrant>;
  /**
   * Founder account (ADMIN_EMAILS allowlist, hydrated from GET /auth/me).
   * Visibility only — it decides whether the sidebar shows the Admin entry;
   * every panel read is re-gated server-side, so nothing opens by forging it.
   * In-memory only (never persisted): refreshMe re-derives it each mount.
   */
  isAdmin: boolean;
  /**
   * Legacy product access (LEGACY_ENABLED switch + LEGACY_ACCESS_EMAILS
   * exception list, hydrated from GET /auth/me). FAIL-CLOSED — defaults FALSE
   * and only the server's explicit `true` lets the toggle actually switch
   * (founder 2026-07-26: Legacy off for everyone but the listed accounts;
   * revised same week: the toggle stays VISIBLE and a gated flip opens the
   * in-development popup instead of hiding the product). The public demo never
   * reaches /auth/me and keeps its showcase gate via isDemoMode(). Client
   * gating only (governed APIs re-gate server-side); never persisted.
   */
  legacyAccess: boolean;
  /**
   * True once /auth/me has answered this session. legacyAccess starts FALSE
   * while the round-trip is in flight, so anything that walks a parked Legacy
   * session back to Personal must wait for this flag — otherwise an
   * allowlisted founder gets kicked out of Legacy on every reload.
   */
  legacyAccessKnown: boolean;
  /**
   * Legal acceptance gate (founder 2026-07-30): hydrated from GET /auth/me
   * `legal`. `required: true` ⇒ the dashboard shows the blocking modal for the
   * current /demo-terms + /privacy versions and records the acceptance via
   * POST /auth/legal-accept. Starts null (unknown) so nothing flashes before
   * the server answers; never persisted — re-derived every mount, which is
   * exactly how a version bump re-opens the gate once.
   */
  legalGate: LegalGateState | null;
  /**
   * WHY THE LAST `acceptLegal` DID NOT LAND (productizer it. 17, R5 5.6).
   *
   * `acceptLegal` answered a bare `false` for everything, so the gate said «check
   * your connection» to a 401 `session_revoked` — which is not a network
   * problem at all: the account was taken over (or this session predates that),
   * the signature was NOT recorded, and the way forward is signing in again.
   * Four distinguishable reasons, so the gate can say the right one:
   *
   *   'session_revoked' → this session no longer controls the account
   *   'session_expired' → a plain 401
   *   'server'          → the server answered and refused
   *   'network'         → the request never got an answer
   *   'not_recorded'    → (it. 27) the POST answered 200 and the server's OWN
   *                       verdict still says the signature is needed. The screen
   *                       says that, instead of pretending the gate closed.
   *   'record_unreadable' → (it. 34, agent D) 409 `PREFERENCES_UNREADABLE`,
   *                       `retryable: false`, WITH the `legal` status the server
   *                       reports for that row (`unreadable: true`, `required:
   *                       false`). Not «try again in a moment»: the row cannot
   *                       take the signature, the gate retires on that very
   *                       answer, and the third-state note explains.
   *
   * null = nothing to report (never attempted, or the last attempt worked).
   */
  legalAcceptRefusal:
    | 'session_revoked'
    | 'session_expired'
    | 'server'
    | 'network'
    | 'not_recorded'
    | 'record_unreadable'
    | null;

  // Actions
  login: (credentials?: any) => Promise<void>;
  loginWithEmail: (email: string, password: string, captchaToken?: string | null) => Promise<void>;
  registerWithEmail: (
    email: string,
    password: string,
    profile?: { username?: string; firstName?: string; lastName?: string; demoTermsAccepted?: true; privacyRead?: true },
    captchaToken?: string | null,
  ) => Promise<void>;
  loginWithOAuth: (
    provider: 'google' | 'apple',
    idToken: string,
    profile?: { firstName?: string; lastName?: string },
  ) => Promise<void>;
  /**
   * XRP Identity (account.xrpl.in). Unlike Google/Apple the browser never sees
   * a token: it forwards the one-time code + PKCE verifier and the backend does
   * the exchange, so display data comes from refreshMe(), not from a peek.
   */
  loginWithXrplIdentity: (
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ) => Promise<void>;
  loginWithPasskey: () => Promise<void>;
  registerPasskey: (deviceLabel?: string) => Promise<void>;
  logout: () => void;
  setUser: (user: User) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  setExpertMode: (expertMode: boolean) => void;
  /**
   * Update display name / avatar. Local stores update instantly; resolves
   * `true` only when the account copy (PATCH /auth/profile) was confirmed —
   * `false` means the edit lives on this device only (no session token,
   * bypass session, server rejection or network failure).
   */
  updateProfile: (patch: { username?: string; avatar?: string }) => Promise<boolean>;

  // Wallet aggregation
  refreshMe: () => Promise<void>;
  hasLinkedWallet: () => boolean;

  /** Record acceptance of the current legal versions (POST /auth/legal-accept). */
  acceptLegal: () => Promise<boolean>;

  // Step-up grant cache (in-memory)
  getValidGrant: (feature: string, action: string) => string | null;
  setStepUpGrant: (feature: string, action: string, grant: StepUpGrant) => void;
  clearStepUpGrants: () => void;
}

const API_BASE = getApiBase();

/**
 * The passkey login 401s, in words (productizer it. 14, R5 1.5).
 *
 * `/auth/passkey/auth/verify` answers 401 with a machine code when the credential
 * lock refused to issue a session — the account's credentials moved while the
 * WebAuthn verification ran (`credentials_changed`), the passkey is no longer this
 * account's (`credential_revoked`), or the account is disabled. The store's `error`
 * is rendered as-is by other surfaces (WalletManager), so it carries a sentence; the
 * thrown Error keeps the code, which is what /login maps into the reader's language.
 */
function passkeyLoginErrorText(code: string): string {
  switch (code) {
    case 'credentials_changed':
      return "Your account's sign-in methods just changed — sign in again.";
    case 'credential_revoked':
      return 'This passkey is no longer valid for this account. Sign in another way and register a new passkey.';
    case 'account_disabled':
      return 'This account is disabled.';
    case 'rate_limited':
      return 'Too many attempts. Wait a few minutes.';
    default:
      return 'The passkey could not be verified.';
  }
}

/**
 * Real SIWE round-trip.
 *  1. Connect wallet (window.ethereum) → address
 *  2. POST /api/auth/nonce { address } → { nonce, message, expiresAt }
 *  3. wallet.personal_sign(message) → signature
 *  4. POST /api/auth/verify { address, nonce, signature, message }
 *     → { token, sessionId, walletAddress, expiresAt }
 *  5. localStorage.setItem('auth_token', token)  (consumed by services/api.ts)
 *  6. Set zustand state.
 */
async function siweLogin(): Promise<User> {
  const eth = (typeof window !== 'undefined' && (window as any).ethereum) || null;
  if (!eth) {
    const isMobile =
      typeof navigator !== 'undefined' &&
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    throw new Error(
      isMobile
        ? 'No wallet detected in this browser. Open this site from inside the MetaMask or Bifrost mobile app browser (use the buttons below).'
        : 'No EVM wallet detected. Install MetaMask or Bifrost browser extension.'
    );
  }

  // 1. Connect
  const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' });
  const address = (accounts[0] || '').toLowerCase();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error('Invalid wallet address from provider');

  // 1b. NO network switch here (founder 2026-08-22: "un popup que me pide
  // cambiar la network a Flare" al entrar desde un navegador nuevo). Signing in
  // is a `personal_sign` over a message the SERVER builds, and the server is
  // explicit that identity does not care where the wallet stands:
  // SiweAuth.issueNonce — "any EVM chain is valid for identity" — and the
  // frontend never even sends a chainId, so the message reads "Chain ID: 1"
  // whatever the wallet is on. The old forced switch protected nothing and
  // met a first-time visitor (a fresh MetaMask sits on Ethereum) with a
  // network dialog before they had signed in.
  //
  // Flare is still demanded where it is REALLY needed, in context:
  //   · linking an EVM wallet  → useWalletLinking.connectMetaMaskFlare
  //   · signing an operation   → useWalletPartner.sendIntentCalls (switchChainAsync)
  // and the NetworkSwitcher banner still covers a connected wallet parked on
  // an unusable chain INSIDE the app.

  // 2. Get nonce + canonical message
  const nonceRes = await fetch(`${API_BASE}/auth/nonce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  if (!nonceRes.ok) {
    const j = await nonceRes.json().catch(() => ({}));
    throw new Error(`auth nonce failed: ${j.error ?? nonceRes.status}`);
  }
  const { nonce, message } = (await nonceRes.json()) as { nonce: string; message: string };

  // 3. Sign with wallet
  const signature: string = await eth.request({
    method: 'personal_sign',
    params: [message, address],
  });

  // 4. Verify on backend
  const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, nonce, signature, message }),
  });
  if (!verifyRes.ok) {
    const j = await verifyRes.json().catch(() => ({}));
    throw new Error(`auth verify failed: ${j.error ?? verifyRes.status}`);
  }
  const { token, sessionId, walletAddress } = (await verifyRes.json()) as {
    token: string;
    sessionId: string;
    walletAddress: string;
  };

  // 5. Persist token (services/api.ts reads this key)
  if (typeof window !== 'undefined') {
    localStorage.setItem('auth_token', token);
  }

  // 6. Build user — rehydrating any profile (name/avatar) this identity saved
  // on this device before, so a fresh login doesn't reset presentation.
  const base: User = {
    id: sessionId,
    address: walletAddress,
    username: `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`,
    preferences: { theme: 'dark', notifications: true, expertMode: false },
  };
  return withStoredProfile(base);
}

async function backendLogout(): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  if (!token) return;
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* network failure is non-fatal */
  }
}

/**
 * Release any persisted wagmi/AppKit wallet session. wagmi uses cookieStorage,
 * so a connected wallet survives reloads AND account switches — without this, a
 * brand-new email/passkey account would inherit (and the Wallets tab would
 * auto-adopt) whatever wallet was connected before. Account-based logins start
 * wallet-clean; the user reconnects explicitly inside the app.
 */
async function disconnectWalletSession(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const [{ disconnect }, { wagmiConfig }] = await Promise.all([
      import('@wagmi/core'),
      import('../lib/wallet/config'),
    ]);
    await disconnect(wagmiConfig);
  } catch {
    /* no active wallet session — ignore */
  }
}

/** The key the account-scoped device state belongs to: the account (email),
 *  or the wallet for wallet-first logins. Mirrors profileStore.profileIdentity. */
function accountKeyOf(u: { email?: string; address?: string } | null | undefined): string | null {
  if (!u) return null;
  if (u.email) return `email:${u.email.toLowerCase()}`;
  if (u.address) return `addr:${u.address.toLowerCase()}`;
  return null;
}

const LAST_ACCOUNT_KEY = 'astryum:last-account';

/**
 * ── UNA SESIÓN LIMPIA ANTES DE CADA ENTRADA (fundador 2026-09-13) ─────────
 * «Acabo de crear esta cuenta y me ha auto-añadido wallets que tienen dinero
 * dentro.» Salir limpiaba las cachés por cuenta (lista de wallets, registro
 * de Legacies); entrar y crear cuenta solo soltaban MetaMask. Como el alta
 * navega dentro de la misma app sin recargar, la cuenta nueva arrancaba
 * viendo las wallets y el Legacy de la anterior. Ahora cada puerta empieza
 * igual que salir: sin sesión de wallet y sin cachés de la cuenta anterior.
 * Imports dinámicos: esos módulos importan este store, y un import estático
 * de vuelta sería un ciclo.
 */
async function startFreshSession(): Promise<void> {
  await disconnectWalletSession();
  await Promise.allSettled([
    import('../hooks/useMyWallets').then((m) => m.invalidateWalletCache()),
    import('../hooks/useAuthorities').then((m) => m.invalidateAuthorityCache()),
    // Las posiciones gestionadas leídas eran de la cuenta anterior (17-sep).
    import('../lib/institutional/useMyManagedPositions').then((m) => m.resetManagedReads()),
  ]);
}

/**
 * ADOPT the account that just signed in (or was restored): the device state
 * that belongs to ONE account — the active authority, the pinned operation
 * windows, the agent chats, the Xaman connection and the first-run wizard —
 * is wiped when the account CHANGES and left alone when it is the same
 * person coming back. The first time this runs on a browser (no key stored
 * yet) nothing is wiped: what exists belongs to whoever is signed in now.
 * The wizard/tours record is per account from today (onboardingStore).
 */
function adoptAccount(u: { email?: string; address?: string } | null | undefined): void {
  if (typeof window === 'undefined') return;
  const key = accountKeyOf(u);
  if (!key) return;
  let prev: string | null = null;
  try { prev = localStorage.getItem(LAST_ACCOUNT_KEY); } catch { /* private mode */ }
  if (prev && prev !== key) {
    void Promise.allSettled([
      import('./authorityStore').then((m) => m.useAuthorityStore.getState().resetAuthority()),
      import('./operationStore').then((m) => m.clearPersistedOperations()),
      import('../lib/agent/chatHistory').then((m) => m.clearAgentChats()),
      import('./walletStore').then((m) => m.useWalletStore.getState().clearAll()),
      import('../services/wallets/WalletServiceFactory').then((m) =>
        (m.WalletServiceFactory.getWalletService('xaman') as { disconnect?: () => Promise<void> }).disconnect?.(),
      ),
    ]);
  }
  void import('./onboardingStore').then((m) => m.useOnboardingStore.getState().activateAccount(key));
  // La APARIENCIA también es por cuenta (2026-09-13): sin esto, el segundo
  // correo que entrase en este navegador heredaría el tema del primero — la
  // misma familia de bug que las wallets y el asistente de primera vez. El
  // servidor tiene la última palabra y llega en refreshMe; esto es lo que
  // pinta bien el primer frame mientras esa respuesta viaja.
  void import('./themeStore').then((m) => m.useThemeStore.getState().activateAccount(key));
  try { localStorage.setItem(LAST_ACCOUNT_KEY, key); } catch { /* private mode */ }
}

/** Only a well-formed server answer opens or closes the gate; anything else
 *  leaves it null (no gate flash, no lockout — the register ceremony still
 *  covers email signups). `reason`/`accepted` are optional extras. */
function parseLegalGate(raw: unknown): LegalGateState | null {
  const l = raw as {
    required?: unknown;
    termsVersion?: unknown;
    privacyVersion?: unknown;
    reason?: unknown;
    unreadable?: unknown;
    accepted?: { termsVersion?: unknown; privacyVersion?: unknown; acceptedAt?: unknown } | null;
  } | null;
  if (!l || typeof l.required !== 'boolean') return null;
  const reason = l.reason === 'first' || l.reason === 'terms' || l.reason === 'privacy' || l.reason === 'both' ? l.reason : null;
  // Solo un `true` literal declara «no pude leer» (it. 25): un backend viejo sin
  // el campo deja `false` y la puerta se comporta como siempre.
  const unreadable = l.unreadable === true;
  const acc = l.accepted && typeof l.accepted === 'object' ? l.accepted : null;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    required: l.required,
    termsVersion: String(l.termsVersion ?? ''),
    privacyVersion: String(l.privacyVersion ?? ''),
    reason,
    unreadable,
    accepted: acc ? { termsVersion: str(acc.termsVersion), privacyVersion: str(acc.privacyVersion), acceptedAt: str(acc.acceptedAt) } : null,
  };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      linkedWallets: [],
      stepUpGrants: {},
      isAdmin: false,
      legacyAccess: false,
      legacyAccessKnown: false,
      legalGate: null,
      legalAcceptRefusal: null,

      login: async (_credentials?: any) => {
        try {
          set({ isLoading: true, error: null });
          const user = await siweLogin();
          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
          get().refreshMe();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Error de autenticación';
          set({
            error: errorMessage,
            isLoading: false,
            isAuthenticated: false,
            user: null,
          });
          throw error;
        }
      },

      loginWithEmail: async (email: string, password: string, captchaToken?: string | null) => {
        try {
          set({ isLoading: true, error: null });
          // Start wallet-clean so this account never inherits a prior connection.
          await startFreshSession();
          const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // captchaToken: settled server-side (Turnstile) when configured.
            body: JSON.stringify({ email, password, captchaToken: captchaToken ?? undefined }),
          });
          const j = await res.json();
          if (!res.ok) throw new Error(j?.error ?? `http_${res.status}`);
          const { accessToken, sessionId } = j as { accessToken: string; sessionId: string };
          if (typeof window !== 'undefined') localStorage.setItem('auth_token', accessToken);
          const user: User = withStoredProfile({
            id: sessionId,
            email,
            username: email.split('@')[0],
            preferences: { theme: 'dark', notifications: true, expertMode: false },
          });
          set({ user, isAuthenticated: true, isLoading: false, error: null });
          adoptAccount(user);
          get().refreshMe();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Login failed';
          set({ error: msg, isLoading: false, isAuthenticated: false, user: null });
          throw err;
        }
      },

      registerWithEmail: async (
        email: string,
        password: string,
        profile?: { username?: string; firstName?: string; lastName?: string; demoTermsAccepted?: true; privacyRead?: true },
        captchaToken?: string | null,
      ) => {
        try {
          set({ isLoading: true, error: null });
          // A brand-new account must start with zero data — drop any wallet session.
          await startFreshSession();
          const res = await fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, ...profile, captchaToken: captchaToken ?? undefined }),
          });
          const j = await res.json();
          if (!res.ok) throw new Error(j?.error ?? `http_${res.status}`);
          const { accessToken, sessionId } = j as { accessToken: string; sessionId: string };
          if (typeof window !== 'undefined') localStorage.setItem('auth_token', accessToken);
          const user: User = withStoredProfile({
            id: sessionId,
            email,
            username: profile?.username?.trim() || email.split('@')[0],
            preferences: { theme: 'dark', notifications: true, expertMode: false },
          });
          set({ user, isAuthenticated: true, isLoading: false, error: null });
          adoptAccount(user);
          get().refreshMe();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Registration failed';
          set({ error: msg, isLoading: false, isAuthenticated: false, user: null });
          throw err;
        }
      },

      // OAuth (Google/Apple) login — the id_token from the provider popup is
      // exchanged at the backend, which verifies it against the provider's
      // JWKS and answers with the same session shape as email login.
      loginWithOAuth: async (
        provider: 'google' | 'apple',
        idToken: string,
        profile?: { firstName?: string; lastName?: string },
      ) => {
        try {
          set({ isLoading: true, error: null });
          // Start wallet-clean so this account never inherits a prior connection.
          await startFreshSession();
          const res = await fetch(`${API_BASE}/auth/oauth/${provider}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken, profile }),
          });
          const j = await res.json();
          if (!res.ok) throw new Error(j?.error ?? `http_${res.status}`);
          const { accessToken, sessionId } = j as { accessToken: string; sessionId: string };
          if (typeof window !== 'undefined') localStorage.setItem('auth_token', accessToken);
          // Display-only peek at the token for email/name — the backend
          // already verified it cryptographically before answering.
          let email: string | undefined;
          let name: string | undefined;
          try {
            const payload = JSON.parse(atob((idToken.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')));
            if (typeof payload.email === 'string') email = payload.email;
            if (typeof payload.name === 'string') name = payload.name;
          } catch {
            /* display fallback below */
          }
          const user: User = withStoredProfile({
            id: sessionId,
            email,
            username: name || email?.split('@')[0] || `${provider} account`,
            preferences: { theme: 'dark', notifications: true, expertMode: false },
          });
          set({ user, isAuthenticated: true, isLoading: false, error: null });
          adoptAccount(user);
          get().refreshMe();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'OAuth sign-in failed';
          set({ error: msg, isLoading: false, isAuthenticated: false, user: null });
          throw err;
        }
      },

      // XRP Identity — the XRPL ecosystem's own OIDC provider, and Astryum's
      // main door. The code is redeemed server-side, so nothing here inspects a
      // token: the session lands and refreshMe() fills in the profile.
      loginWithXrplIdentity: async (code: string, codeVerifier: string, redirectUri: string) => {
        try {
          set({ isLoading: true, error: null });
          // Start wallet-clean so this account never inherits a prior connection.
          await startFreshSession();
          const res = await fetch(`${API_BASE}/auth/oauth/xrplid/exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, codeVerifier, redirectUri }),
          });
          const j = await res.json();
          if (!res.ok) throw new Error(j?.error ?? `http_${res.status}`);
          const { accessToken, sessionId } = j as { accessToken: string; sessionId: string };
          if (typeof window !== 'undefined') localStorage.setItem('auth_token', accessToken);
          const user: User = withStoredProfile({
            id: sessionId,
            username: 'XRP Identity',
            preferences: { theme: 'dark', notifications: true, expertMode: false },
          });
          set({ user, isAuthenticated: true, isLoading: false, error: null });
          adoptAccount(user);
          get().refreshMe();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'XRP Identity sign-in failed';
          set({ error: msg, isLoading: false, isAuthenticated: false, user: null });
          throw err;
        }
      },

      // Passkey (WebAuthn) login — works for accounts that registered a passkey.
      loginWithPasskey: async () => {
        try {
          set({ isLoading: true, error: null });
          // Start wallet-clean so this account never inherits a prior connection.
          await startFreshSession();
          const optRes = await fetch(`${API_BASE}/auth/passkey/auth/options`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          const optJson = await optRes.json();
          if (!optRes.ok) throw new Error(optJson?.error ?? `http_${optRes.status}`);
          const { options, challengeId } = optJson as { options: any; challengeId: string };

          const { startAuthentication } = await import('@simplewebauthn/browser');
          const assertion = await startAuthentication(options);

          const verifyRes = await fetch(`${API_BASE}/auth/passkey/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ challengeId, response: assertion }),
          });
          const j = await verifyRes.json();
          if (!verifyRes.ok) throw new Error(j?.error ?? `http_${verifyRes.status}`);
          const { token, sessionId, walletAddress } = j as {
            token: string; sessionId: string; walletAddress: string;
          };
          if (typeof window !== 'undefined') localStorage.setItem('auth_token', token);
          const user: User = withStoredProfile({
            id: sessionId,
            address: walletAddress || undefined,
            username: walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'Passkey account',
            preferences: { theme: 'dark', notifications: true, expertMode: false },
          });
          set({ user, isAuthenticated: true, isLoading: false, error: null });
          adoptAccount(user);
          get().refreshMe();
        } catch (err) {
          // The store's `error` is rendered as-is elsewhere (WalletManager): it
          // carries words, never the backend's machine code. The thrown Error
          // keeps the code, so /login can say it in the reader's language.
          const msg = passkeyLoginErrorText(err instanceof Error ? err.message : '');
          set({ error: msg, isLoading: false, isAuthenticated: false, user: null });
          throw err;
        }
      },

      // Add a passkey to the current (already signed-in) account.
      registerPasskey: async (deviceLabel?: string) => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
        if (!token) throw new Error('Sign in first to add a passkey.');
        const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
        const optRes = await fetch(`${API_BASE}/auth/passkey/register/options`, {
          method: 'POST',
          headers: authHeaders,
        });
        const options = await optRes.json();
        if (!optRes.ok) throw new Error(options?.error ?? `http_${optRes.status}`);

        const { startRegistration } = await import('@simplewebauthn/browser');
        const attestation = await startRegistration(options);

        const verifyRes = await fetch(`${API_BASE}/auth/passkey/register/verify`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ response: attestation, deviceLabel }),
        });
        const j = await verifyRes.json();
        if (!verifyRes.ok) throw new Error(j?.error ?? `http_${verifyRes.status}`);
      },

      logout: () => {
        // Leaving means "not this account, or not now". XRP Identity keeps its
        // own SSO cookie, so without this the next login sails straight back
        // into the same account with nothing asked. Written synchronously (not
        // in the .finally below): the user usually navigates away the instant
        // logout is clicked, and a lost flag is a silent re-login.
        requestAccountChoiceOnNextLogin();
        // Best-effort backend session revocation + wallet disconnect, then local
        // cleanup, so the next account that logs in starts wallet-clean.
        void disconnectWalletSession();
        backendLogout().finally(() => {
          // Module caches are per-account: the next login must not inherit the
          // previous account's wallet list or governed-authority pointers.
          void import('../hooks/useMyWallets').then((m) => m.invalidateWalletCache());
          void import('../hooks/useAuthorities').then((m) => m.invalidateAuthorityCache());
          void import('../lib/institutional/useMyManagedPositions').then((m) => m.resetManagedReads());
          // Las conversaciones con el agente llevan información financiera:
          // salir de la app las borra de este navegador (todas las cuentas).
          void import('../lib/agent/chatHistory').then((m) => m.clearAgentChats());
          // Las ventanas de operación persistidas son de ESTA cuenta.
          void import('./operationStore').then((m) => m.clearPersistedOperations());
          void import('./authorityStore').then((m) => m.useAuthorityStore.getState().resetAuthority());
          if (typeof window !== 'undefined') {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('astryum-auth-storage');
          }
          set({
            user: null,
            isAuthenticated: false,
            error: null,
            isLoading: false,
            linkedWallets: [],
            stepUpGrants: {},
            isAdmin: false,
            legacyAccess: false,
            legacyAccessKnown: false,
            legalGate: null,
            legalAcceptRefusal: null,
          });
        });
      },

      setUser: (user: User) => {
        set({ user, isAuthenticated: true });
      },

      setLoading: (loading: boolean) => {
        set({ isLoading: loading });
      },

      setError: (error: string | null) => {
        set({ error });
      },

      clearError: () => {
        set({ error: null });
      },

      setExpertMode: (expertMode: boolean) => {
        const currentUser = get().user;
        if (currentUser) {
          set({
            user: {
              ...currentUser,
              preferences: {
                ...currentUser.preferences,
                expertMode
              }
            }
          });
        }
      },

      // Update profile fields (display name, avatar).
      //
      // Founder 2026-07-19 — "name/photo must survive logout→login": the
      // ACCOUNT is now the source of truth, so the patch is written through to
      // the backend (PATCH /auth/profile) and refreshMe hydrates it back on
      // every login. The device-local profile store stays as an instant
      // pre-paint + offline fallback — saved under BOTH identities (addr: and
      // email:) because the old single-identity save was the original bug: a
      // profile saved under addr: after a wallet link was never found again by
      // an email login looking under email:.
      updateProfile: async (patch: { username?: string; avatar?: string }) => {
        const current = get().user;
        if (!current) return false;
        const next = { ...current };
        if (patch.username !== undefined) next.username = patch.username.trim() || undefined;
        if (patch.avatar !== undefined) next.avatar = patch.avatar || undefined;
        set({ user: next });
        const stored = { username: next.username, avatar: next.avatar };
        if (next.address) saveProfile(`addr:${next.address.toLowerCase()}`, stored);
        if (next.email) saveProfile(`email:${next.email.toLowerCase()}`, stored);
        // Server write-through so the profile follows the account across
        // devices. The local stores above already hold the edit, so a failure
        // is non-fatal — but it is REPORTED (return false), never swallowed:
        // the silent `void fetch` here is why "saved" avatars used to
        // evaporate when switching browsers.
        const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
        if (!token || token === 'dev-bypass-no-jwt') return false;
        try {
          const res = await fetch(`${API_BASE}/auth/profile`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              ...(patch.username !== undefined ? { username: next.username ?? '' } : {}),
              ...(patch.avatar !== undefined ? { avatar: next.avatar ?? '' } : {}),
            }),
          });
          return res.ok;
        } catch {
          /* offline — the local stores above keep the edit */
          return false;
        }
      },

      // Hydrate the account's aggregated linked wallets from the backend.
      // GET /api/auth/me already returns linkedWallets. Non-fatal on failure.
      refreshMe: async () => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
        if (!token || token === 'dev-bypass-no-jwt') return;
        try {
          const res = await fetch(`${API_BASE}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) return;
          const j = await res.json();
          // A LATE ANSWER FROM A SESSION THAT IS GONE (2026-09-13): creating or
          // entering another account while this request was in flight would
          // let the previous account's wallets land in the new one's store —
          // and, from there, get linked to it for real by the Wallets page.
          // If the token changed under us, this answer is nobody's.
          if (typeof window !== 'undefined' && localStorage.getItem('auth_token') !== token) return;
          const linkedWallets: LinkedWallet[] = Array.isArray(j?.linkedWallets)
            ? j.linkedWallets
            : [];
          // legacyAccess: FAIL-CLOSED — only the server's explicit `true`
          // opens the product (an older backend without the field gates it).
          set({
            linkedWallets,
            isAdmin: j?.isAdmin === true,
            legacyAccess: j?.legacyAccess === true,
            legacyAccessKnown: true,
            // Legal gate state — only trust a well-formed server answer; an
            // older backend without the field leaves it null (no gate flash,
            // no lockout: the register click-wrap still covers email signups).
            legalGate: parseLegalGate(j?.legal),
          });

          // Manager mode (founder 2026-08-30): the vault-manager declaration
          // follows the ACCOUNT — /me carries the server verdict and the
          // per-user local cache adopts it (server wins; the cache only
          // bridges boot and offline). Dynamic import: managerStore already
          // imports this store statically, a static edge back would cycle.
          if (typeof j?.managerMode === 'boolean') {
            const serverManager = j.managerMode as boolean;
            const meEmail = typeof j?.profile?.email === 'string' ? (j.profile.email as string) : null;
            void import('./managerStore').then((m) => m.adoptServerManagerFlag(serverManager, meEmail));
          }

          // Apariencia (tema + luz, 2026-09-13): mismo raíl que managerMode —
          // la cuenta manda y /me la trae, para que el mismo correo se vea
          // igual en el navegador de la oficina y en el móvil. Un backend
          // viejo sin el campo no toca nada y lo local sigue mandando, que es
          // el comportamiento de siempre. El parseo vive en el módulo puro:
          // una preferencia corrupta no puede colar un tema inventado.
          if (j?.appearance != null) {
            void Promise.all([
              import('./themeStore'),
              import('../lib/theme/appearance'),
            ]).then(([store, pure]) => {
              const key = accountKeyOf(get().user);
              store.useThemeStore.getState().adoptServerAppearance(pure.readAppearance(j.appearance), key);
            });
          }

          // El cuestionario de alta (2026-09-14): idioma, objetivo y el hecho
          // de haberlo contestado siguen a la CUENTA. Sin esto, abrir el mismo
          // correo en otro navegador era, para el producto, una cuenta que no
          // había contestado nunca — y el popup volvía a salir. Mismo raíl que
          // managerMode y appearance: la cuenta manda, lo local sostiene el
          // arranque y el modo sin red. Un registro vacío NO pisa lo local.
          if (j?.onboarding != null) {
            void import('./onboardingStore').then((m) => {
              const key = accountKeyOf(get().user);
              m.useOnboardingStore.getState().adoptServerOnboarding(j.onboarding, key);
            });
          }

          // R2 HARD CUT (§1.2): a hydrated linked wallet is a REAL wallet in this session.
          // This is the SECOND funnel — the session-restore path that never calls
          // connectWallet() (refreshMe runs on every mount, AccessGate). Marking live here
          // covers reload / cross-device: demo + a restored wallet must not serve fixtures.
          if (linkedWallets.length > 0) markLiveWalletSession();

          // Hydrate the ACCOUNT profile (name/photo saved server-side, founder
          // 2026-07-19) — the server value wins over the derived default and
          // is synced down into the device-local store under both identities.
          const profile = j?.profile as { username?: string | null; avatar?: string | null } | null;
          if (profile && (profile.username || profile.avatar)) {
            const withProfile = get().user;
            if (withProfile) {
              const merged = {
                ...withProfile,
                username: profile.username || withProfile.username,
                avatar: profile.avatar || withProfile.avatar,
              };
              set({ user: merged });
              const stored = { username: merged.username, avatar: merged.avatar };
              if (merged.address) saveProfile(`addr:${merged.address.toLowerCase()}`, stored);
              if (merged.email) saveProfile(`email:${merged.email.toLowerCase()}`, stored);
            }
          }

          // Reflect a linked wallet as the account address so every screen that reads
          // user.address recognises the connection — not just SIWE logins. Without this,
          // a wallet linked from the Wallets tab stays invisible to the rest of the app
          // and those screens keep showing "Connect wallet". Prefer an EVM (0x) wallet
          // since user.address is consumed as an EVM address across the dashboard. Never
          // override an address already set by SIWE.
          const current = get().user;
          if (current && !current.address && linkedWallets.length > 0) {
            const isEvm = (a?: string) => !!a && /^0x[0-9a-fA-F]{40}$/.test(a);
            const primary = linkedWallets.find((w) => isEvm(w.address)) ?? linkedWallets[0];
            if (primary?.address) {
              set({
                user: {
                  ...current,
                  address: primary.address,
                  username:
                    current.username ||
                    `${primary.address.slice(0, 6)}…${primary.address.slice(-4)}`,
                },
              });
            }
          }
          // A restored session (reload, new tab) never passes a login door:
          // the account-scoped device state is adopted here, idempotently.
          adoptAccount(get().user);
        } catch {
          /* network failure is non-fatal */
        }
      },

      hasLinkedWallet: () => get().linkedWallets.length > 0,

      // Record acceptance of the current /demo-terms + /privacy versions.
      // Only flips the local gate off when the SERVER confirmed the write —
      // an optimistic flip would show a "closed" gate whose record never
      // landed (the unearned-success family).
      acceptLegal: async () => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
        if (!token || token === 'dev-bypass-no-jwt') return false;
        set({ legalAcceptRefusal: null });
        try {
          const res = await fetch(`${API_BASE}/auth/legal-accept`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ terms: true, privacyRead: true }),
          });
          if (!res.ok) {
            // NO ES «REVISA LA CONEXIÓN» (productizer it. 17, R5 5.6). Un 401
            // `session_revoked` significa que la sesión que firmó ya no manda en
            // esta cuenta (hubo toma de posesión): la firma NO se registró y hay
            // que volver a entrar. Colapsarlo en un fallo de red manda a la
            // persona a mirar su wifi por un problema de autoridad.
            const body = (await res.json().catch(() => ({}))) as { error?: string; legal?: unknown; retryable?: unknown };
            // EL 409 QUE TRAE SU PROPIO VEREDICTO (productizer it. 34, agente D).
            //
            // /auth/legal-accept contesta 409 `PREFERENCES_UNREADABLE` con
            // `retryable: false` Y con `legal: { unreadable: true, required:
            // false }` — el MISMO estado que /auth/me reporta para esa fila, y
            // que es la instrucción de retirar el modal y enseñar la nota (it.
            // 25). Este bloque lo tiraba: guardaba `'server'`, la puerta pintaba
            // «try again in a moment» sobre un rechazo que el servidor acababa
            // de declarar NO reintentable, y solo un segundo viaje (`refreshMe`)
            // retiraba el modal. Se adopta el veredicto en el mismo viaje —
            // `legalGateMode` decide con él, igual que con el de /auth/me — y la
            // razón dice lo que es. Un cuerpo sin `legal` bien formado sigue
            // siendo `'server'`: aquí no se inventa ningún estado.
            const refusedWithVerdict = res.status === 409 ? parseLegalGate(body?.legal) : null;
            if (refusedWithVerdict && refusedWithVerdict.unreadable) {
              set({ legalGate: refusedWithVerdict, legalAcceptRefusal: 'record_unreadable' });
              return false;
            }
            set({
              legalAcceptRefusal:
                res.status === 401 && body?.error === 'session_revoked'
                  ? 'session_revoked'
                  : res.status === 401
                    ? 'session_expired'
                    : 'server',
            });
            return false;
          }
          const j = await res.json();
          if (j?.ok !== true) {
            set({ legalAcceptRefusal: 'server' });
            return false;
          }
          // EL CLIENTE NO DESMIENTE AL SERVIDOR (productizer it. 27).
          //
          // Esto tomaba la respuesta del servidor y le sobrescribía `required`
          // a false, INCONDICIONALMENTE. El servidor contesta con el estado que
          // él mismo acaba de computar sobre la fila escrita
          // (`computeLegalStatus(merged, …)` en routes/auth.ts), y si ese
          // veredicto decía `required: true`, la pantalla lo tapaba y enseñaba
          // «firmado». Familia «éxito no ganado», ya catalogada en este repo: la
          // firma no había quedado registrada de forma utilizable y la puerta
          // volvía en el siguiente /auth/me — con el disfraz de «bug
          // intermitente» puesto encima, porque el recibo se había visto.
          //
          // Regla: si el servidor manda un veredicto bien formado, se adopta TAL
          // CUAL. Solo cuando no manda ninguno (backend viejo, respuesta sin el
          // campo) se cierra la puerta en local, y ahí `ok: true` es lo único
          // que tenemos y nada lo contradice.
          const prev = get().legalGate;
          const fromServer = parseLegalGate(j?.legal);
          if (fromServer) {
            set({ legalGate: fromServer });
            // EL MISMO DECISOR QUE PINTA LA PANTALLA DECIDE SI LA FIRMA CONTÓ.
            // `legalGateBlocks` es true solo en el estado 'sign' — «la ficha se
            // leyó y dice que faltan textos por firmar». El tercer estado («no
            // pude leer») NO es un fallo de la firma: la escritura aterrizó, la
            // app no se bloquea y la nota lo explica, así que la ceremonia se
            // cierra igual. Ver lib/legal/legalGateMode.
            if (legalGateBlocks(fromServer)) {
              set({ legalAcceptRefusal: 'not_recorded' });
              return false;
            }
          } else {
            set({
              legalGate: prev
                ? { ...prev, required: false }
                : { required: false, termsVersion: '', privacyVersion: '' },
            });
          }
          set({ legalAcceptRefusal: null });
          return true;
        } catch {
          // Aquí sí: la petición no llegó a ninguna parte.
          set({ legalAcceptRefusal: 'network' });
          return false;
        }
      },

      getValidGrant: (feature: string, action: string) => {
        const key = `${feature}:${action}`;
        const grant = get().stepUpGrants[key];
        if (grant && grant.expiresAt > Date.now() + 2000) return grant.token;
        return null;
      },

      setStepUpGrant: (feature: string, action: string, grant: StepUpGrant) => {
        const key = `${feature}:${action}`;
        set({ stepUpGrants: { ...get().stepUpGrants, [key]: grant } });
      },

      clearStepUpGrants: () => set({ stepUpGrants: {} }),
    }),
    {
      name: 'astryum-auth-storage',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated
      })
    }
  )
);