'use client';

/**
 * XRP Identity callback — where the ecosystem's front door lands.
 *
 * The provider redirects here with `code` + `state`. We check the state against
 * the one we stored (a mismatch is CSRF, not a retry), hand the code and the
 * PKCE verifier to our backend, and let it do the token exchange. Nothing here
 * ever holds a token or a secret.
 *
 * On success the user goes wherever they were heading; on failure they go back
 * to /login with an honest reason rather than a blank screen.
 */

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '../../../../stores/authStore';
import { consumeCallback, xrplIdentityRedirectUri } from '../../../../lib/xrplIdentity/login';

const GOLD = '#E8C25A';

function reasonCopy(code: string): string {
  switch (code) {
    case 'state_mismatch':
      return 'La respuesta no coincide con la petición que salió de este navegador. Vuelve a entrar.';
    case 'not_invited':
      return 'Beta cerrada: ese email aún no tiene plaza. Pide acceso en astryum.xyz/early-access.';
    case 'oauth_email_unverified':
      return 'XRP Identity no confirma ese email como verificado, y crear cuenta lo exige.';
    case 'oauth_email_missing':
      return 'XRP Identity no devolvió email, y crear cuenta lo exige.';
    case 'account_disabled':
      return 'Esa cuenta está desactivada.';
    case 'xrplid_not_configured':
      return 'La puerta de XRP Identity aún no está configurada en el servidor.';
    case 'xrplid_token_unreachable':
      return 'No se ha podido contactar con XRP Identity. Inténtalo en un momento.';
    default:
      return 'No se ha podido completar la entrada con XRP Identity.';
  }
}

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const loginWithXrplIdentity = useAuthStore((s) => s.loginWithXrplIdentity);
  const [error, setError] = useState<string | null>(null);
  // React 18 StrictMode double-invokes effects in dev; the code is one-shot.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const providerError = params.get('error');
    if (providerError) {
      setError(reasonCopy(providerError));
      return;
    }

    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) {
      setError(reasonCopy('state_mismatch'));
      return;
    }

    const consumed = consumeCallback({ code, state });
    if (!consumed) {
      setError(reasonCopy('state_mismatch'));
      return;
    }

    void (async () => {
      try {
        await loginWithXrplIdentity(code, consumed.codeVerifier, xrplIdentityRedirectUri());
        router.replace(consumed.returnTo);
      } catch (err) {
        setError(reasonCopy(err instanceof Error ? err.message : ''));
      }
    })();
  }, [params, router, loginWithXrplIdentity]);

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
        background: '#05060A',
        color: '#E7E9EE',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 460 }}>
        <div style={{ color: GOLD, letterSpacing: '0.18em', fontSize: 12, textTransform: 'uppercase' }}>
          XRP Identity
        </div>
        {error ? (
          <>
            <p style={{ marginTop: 16, lineHeight: 1.6 }}>{error}</p>
            <button
              type="button"
              onClick={() => router.replace('/login')}
              style={{
                marginTop: 20,
                padding: '0.7rem 1.4rem',
                borderRadius: 10,
                border: `1px solid ${GOLD}`,
                background: 'transparent',
                color: GOLD,
                cursor: 'pointer',
              }}
            >
              Volver a entrar
            </button>
          </>
        ) : (
          <p style={{ marginTop: 16, lineHeight: 1.6, opacity: 0.85 }}>Verificando tu identidad…</p>
        )}
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
