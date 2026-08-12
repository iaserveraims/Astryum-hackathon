'use client';

/**
 * Hidden-door access modal — stage 0 of the access flow.
 *
 * The 5-click / Ctrl+Shift+L door opens THIS first. It asks for the shared
 * ACCESS CODE and settles it against /api/access-gate (server-side compare +
 * captcha + per-IP throttle) — nothing secret ships in this bundle anymore
 * (2026-07-23; the old hardcoded user/password pair was readable in the
 * public JS and bots walked in). On success the server sets the signed
 * httpOnly gate cookie the middleware demands, and we forward to /login.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { submitGateCode } from './accessConfig';
import TurnstileWidget, { turnstileEnabled } from '../security/TurnstileWidget';
import { getStoredLang } from '@/i18n/LanguageProvider';

function errorCopy(error: string | undefined): string {
  switch (error) {
    case 'invalid_code':
      return 'Código incorrecto';
    case 'rate_limited':
      return 'Demasiados intentos. Espera unos minutos.';
    case 'captcha_missing':
    case 'captcha_failed':
      return 'Completa la verificación anti-bot.';
    case 'captcha_unavailable':
      return 'Verificación anti-bot no disponible. Prueba en unos minutos.';
    case 'gate_unconfigured':
      return 'Acceso cerrado temporalmente.';
    default:
      return 'No se pudo verificar. Prueba de nuevo.';
  }
}

export default function LoginModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Mounted on the landing, OUTSIDE LanguageProvider — resolve the stored language directly.
  const es = getStoredLang() === 'es';
  const router = useRouter();
  const codeRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  useEffect(() => {
    if (open) {
      setError('');
      setCode('');
      setTimeout(() => codeRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (turnstileEnabled() && !captchaToken) {
      setError('Completa la verificación anti-bot.');
      return;
    }
    setLoading(true);
    setError('');

    const result = await submitGateCode(code, captchaToken);
    if (result.ok) {
      setTimeout(() => {
        router.push('/login');
      }, 400);
      return;
    }
    // Tokens are single-use — mint a fresh one for the retry.
    setCaptchaReset((n) => n + 1);
    setError(errorCopy(result.error));
    setLoading(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md mx-4 my-auto"
          >
            <div className="absolute -inset-px rounded-2xl opacity-70 blur-md" style={{ background: 'radial-gradient(120% 120% at 50% 0%, rgba(201,162,39,0.45), rgba(201,162,39,0.05) 60%, transparent)' }} />
            <div className="relative bg-zinc-950 border border-white/10 rounded-2xl p-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-white tracking-tight">{es ? 'Acceso restringido' : 'Restricted access'}</h2>
                <button
                  onClick={onClose}
                  className="text-white/40 hover:text-white/80 transition-colors text-sm"
                  aria-label={es ? 'Cerrar' : 'Close'}
                >
                  ESC
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs text-white/50 mb-2">
                    {es ? 'Código de acceso' : 'Access code'}
                  </label>
                  <input
                    ref={codeRef}
                    type="password"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="off"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-[#C9A227]/60 focus:bg-white/10 transition-all"
                    disabled={loading}
                  />
                </div>

                <TurnstileWidget onToken={setCaptchaToken} resetSignal={captchaReset} theme="dark" />

                {error && (
                  <motion.div
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2"
                  >
                    {error}
                  </motion.div>
                )}

                <button
                  type="submit"
                  disabled={loading || !code}
                  className="w-full text-black font-semibold py-3 rounded-lg hover:opacity-90 disabled:opacity-40 transition-all"
                  style={{ background: '#C9A227' }}
                >
                  {loading ? 'Verificando...' : 'Entrar'}
                </button>
              </form>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
