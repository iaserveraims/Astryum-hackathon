import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { markLiveWalletSession } from '../lib/demoMode';
import { getApiBase } from '../lib/env';
import { saveProfile, withStoredProfile } from '../lib/profileStore';
import { ensureFlareNetwork } from '../lib/wallet/flareChain';

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
  legalGate: { required: boolean; termsVersion: string; privacyVersion: string } | null;

  // Actions
  login: (credentials?: any) => Promise<void>;
  loginWithEmail: (email: string, password: string, captchaToken?: string | null) => Promise<void>;
  registerWithEmail: (
    email: string,
    password: string,
    profile?: { username?: string; firstName?: string; lastName?: string; demoTermsAccepted?: true },
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
  updateProfile: (patch: { username?: string; avatar?: string }) => void;

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

// The switch/add engine itself lives in lib/wallet/flareChain (one source of
// truth for every EIP-3085/3326 surface); SIWE keeps its own prose because it
// pins Chain ID 14 inside the signed message — login can't proceed elsewhere.
const SIWE_FLARE_MESSAGES = {
  declined:
    'Signing in needs the Flare network and the switch was declined in your wallet. Try again whenever you like.',
  failed: (detail: string) => `Could not switch wallet to Flare Mainnet: ${detail}`,
};

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

  // 1b. Force Flare Mainnet before signing — otherwise SIWE message says
  // "Chain ID: 14" but user is on a different chain, and post-login the
  // app will block them with the NetworkSwitcher banner.
  await ensureFlareNetwork(eth, SIWE_FLARE_MESSAGES);

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
          await disconnectWalletSession();
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
        profile?: { username?: string; firstName?: string; lastName?: string; demoTermsAccepted?: true },
        captchaToken?: string | null,
      ) => {
        try {
          set({ isLoading: true, error: null });
          // A brand-new account must start with zero data — drop any wallet session.
          await disconnectWalletSession();
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
          await disconnectWalletSession();
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
          await disconnectWalletSession();
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
          await disconnectWalletSession();
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
          get().refreshMe();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Passkey sign-in failed';
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
        // Best-effort backend session revocation + wallet disconnect, then local
        // cleanup, so the next account that logs in starts wallet-clean.
        void disconnectWalletSession();
        backendLogout().finally(() => {
          // Module caches are per-account: the next login must not inherit the
          // previous account's wallet list or governed-authority pointers.
          void import('../hooks/useMyWallets').then((m) => m.invalidateWalletCache());
          void import('../hooks/useAuthorities').then((m) => m.invalidateAuthorityCache());
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
      updateProfile: (patch: { username?: string; avatar?: string }) => {
        const current = get().user;
        if (!current) return;
        const next = { ...current };
        if (patch.username !== undefined) next.username = patch.username.trim() || undefined;
        if (patch.avatar !== undefined) next.avatar = patch.avatar || undefined;
        set({ user: next });
        const stored = { username: next.username, avatar: next.avatar };
        if (next.address) saveProfile(`addr:${next.address.toLowerCase()}`, stored);
        if (next.email) saveProfile(`email:${next.email.toLowerCase()}`, stored);
        // Server write-through — best-effort: presentation must never block on
        // the network, and refreshMe reconciles on the next login anyway.
        const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
        if (token && token !== 'dev-bypass-no-jwt') {
          void fetch(`${API_BASE}/auth/profile`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              ...(patch.username !== undefined ? { username: next.username ?? '' } : {}),
              ...(patch.avatar !== undefined ? { avatar: next.avatar ?? '' } : {}),
            }),
          }).catch(() => {
            /* offline — the local stores above keep the edit */
          });
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
            legalGate:
              j?.legal && typeof j.legal.required === 'boolean'
                ? {
                    required: j.legal.required,
                    termsVersion: String(j.legal.termsVersion ?? ''),
                    privacyVersion: String(j.legal.privacyVersion ?? ''),
                  }
                : null,
          });

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
        try {
          const res = await fetch(`${API_BASE}/auth/legal-accept`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ terms: true, privacyRead: true }),
          });
          if (!res.ok) return false;
          const j = await res.json();
          if (j?.ok !== true) return false;
          const prev = get().legalGate;
          set({
            legalGate: prev
              ? { ...prev, required: false }
              : { required: false, termsVersion: '', privacyVersion: '' },
          });
          return true;
        } catch {
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