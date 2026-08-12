'use client';

/**
 * Cloudflare Turnstile widget — the anti-bot check on every credential form
 * (gate modal, login/create, waitlist, forgot-password, admin panel).
 *
 * Feature-flagged by NEXT_PUBLIC_TURNSTILE_SITE_KEY (public by design — the
 * SECRET lives server-side only). Unset → renders nothing and every parent
 * treats the token as not required, so local dev works with zero setup.
 *
 * Tokens are ONE-TIME: after a failed submit the parent bumps `resetSignal`
 * so the widget mints a fresh token for the retry.
 */
import { useEffect, useRef, useState } from 'react';
import { getStoredLang } from '@/i18n/LanguageProvider';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? '';
const SCRIPT_ID = 'cf-turnstile-api';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function turnstileEnabled(): boolean {
  return SITE_KEY.length > 0;
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (typeof window === 'undefined') return new Promise(() => undefined);
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
      const existing = document.getElementById(SCRIPT_ID);
      const poll = () => {
        if (window.turnstile) resolve(window.turnstile);
        else setTimeout(poll, 50);
      };
      if (existing) {
        poll();
        return;
      }
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = poll;
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error('turnstile_script_failed'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export default function TurnstileWidget({
  onToken,
  resetSignal = 0,
  theme = 'dark',
  className,
}: {
  /** Called with a fresh token, or null when it expires/errors/resets. */
  onToken: (token: string | null) => void;
  /** Bump to force a fresh token (tokens are single-use). */
  resetSignal?: number;
  theme?: 'dark' | 'light' | 'auto';
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!SITE_KEY || !containerRef.current) return undefined;
    let disposed = false;
    loadTurnstile()
      .then((api) => {
        if (disposed || !containerRef.current || widgetIdRef.current) return;
        widgetIdRef.current = api.render(containerRef.current, {
          sitekey: SITE_KEY,
          theme,
          size: 'flexible',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => setFailed(true));
    return () => {
      disposed = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* already gone */
        }
        widgetIdRef.current = null;
      }
    };
  }, [theme]);

  useEffect(() => {
    if (resetSignal > 0 && widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
        onTokenRef.current(null);
      } catch {
        /* widget vanished — the next render recreates it */
      }
    }
  }, [resetSignal]);

  if (!SITE_KEY) return null;
  if (failed) {
    return (
      <p className={`text-[11px] text-red-400/80 ${className ?? ''}`}>
        {getStoredLang() === 'es'
          ? 'No se pudo cargar la verificación anti-bot. Recarga la página.'
          : 'The anti-bot check could not load. Reload the page.'}
      </p>
    );
  }
  return <div ref={containerRef} className={className} />;
}
