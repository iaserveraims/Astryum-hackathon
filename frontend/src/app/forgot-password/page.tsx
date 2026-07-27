'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { getApiBase } from '../../lib/env';
import TurnstileWidget, { turnstileEnabled } from '../../components/security/TurnstileWidget';

const API_BASE = getApiBase();
const EMAIL_AUTH = process.env.NEXT_PUBLIC_EMAIL_AUTH_ENABLED !== 'false';

type Step = 'form' | 'sent' | 'reset' | 'done';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  useEffect(() => {
    setHydrated(true);
    const devBypass =
      process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true';
    if (devBypass || !EMAIL_AUTH) {
      router.replace('/app');
    }
  }, [router]);

  const onRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (turnstileEnabled() && !captchaToken) {
      setError('Complete the anti-bot check first.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, captchaToken: captchaToken ?? undefined }),
      });
      if (!res.ok) {
        setCaptchaReset((n) => n + 1); // token consumed — mint a fresh one
        const j = await res.json().catch(() => ({}));
        setError(j?.error === 'rate_limited' ? 'Too many attempts. Wait a few minutes.' : 'Request failed. Please try again.');
        return;
      }
      const j = await res.json();
      // Dev: backend returns resetToken in body for easy testing
      if (j.resetToken) setToken(j.resetToken);
      setStep('sent');
    } catch {
      setCaptchaReset((n) => n + 1);
      setError('Request failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const onResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) { setError('Passwords do not match'); return; }
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `http_${res.status}`);
      }
      setStep('done');
    } catch (err: any) {
      setError(err.message ?? 'Reset failed. Token may have expired.');
    } finally {
      setLoading(false);
    }
  };

  if (!hydrated) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white">
      <div className="w-full max-w-md p-8 border border-white/10 rounded-lg bg-white/5">
        <div className="mb-6">
          <div className="text-xs uppercase tracking-widest text-white/40">Astryum</div>
          <h1 className="text-2xl font-semibold mt-2">Reset password</h1>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded bg-red-900/40 border border-red-500/40 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Step 1: request email */}
        {step === 'form' && (
          <form onSubmit={onRequestReset} className="space-y-4">
            <div>
              <label className="block text-xs text-white/50 mb-1.5 uppercase tracking-widest">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white/90 placeholder-white/20 focus:outline-none focus:border-white/30"
              />
            </div>
            <TurnstileWidget onToken={setCaptchaToken} resetSignal={captchaReset} theme="dark" />
            <button
              type="submit"
              disabled={loading || (turnstileEnabled() && !captchaToken)}
              className="w-full py-3 rounded bg-white text-black font-medium hover:bg-white/90 disabled:opacity-50 transition"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        {/* Step 2: check email */}
        {step === 'sent' && (
          <div className="space-y-4">
            <p className="text-sm text-white/60">
              If that email is registered, a reset link has been sent. Check your inbox.
            </p>
            {/* DEV only: token shown inline for testing */}
            {token && (
              <div className="bg-white/5 rounded-lg p-3">
                <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Dev — reset token</p>
                <p className="text-xs font-mono text-white/70 break-all">{token}</p>
                <button
                  onClick={() => setStep('reset')}
                  className="mt-2 text-xs text-indigo-400 hover:text-indigo-300 transition"
                >
                  Use this token →
                </button>
              </div>
            )}
            <a href="/login" className="block text-xs text-white/40 hover:text-white/70 transition">
              Back to sign in
            </a>
          </div>
        )}

        {/* Step 3: enter new password */}
        {step === 'reset' && (
          <form onSubmit={onResetPassword} className="space-y-4">
            <div>
              <label className="block text-xs text-white/50 mb-1.5 uppercase tracking-widest">Reset token</label>
              <input
                type="text"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste from email"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-xs font-mono text-white/90 placeholder-white/20 focus:outline-none focus:border-white/30"
              />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1.5 uppercase tracking-widest">New password</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white/90 placeholder-white/20 focus:outline-none focus:border-white/30"
              />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1.5 uppercase tracking-widest">Confirm</label>
              <input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat password"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white/90 placeholder-white/20 focus:outline-none focus:border-white/30"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded bg-white text-black font-medium hover:bg-white/90 disabled:opacity-50 transition"
            >
              {loading ? 'Resetting…' : 'Set new password'}
            </button>
          </form>
        )}

        {/* Step 4: done */}
        {step === 'done' && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-white/70">Password updated. You can now sign in.</p>
            <a
              href="/login"
              className="block w-full py-3 rounded bg-white text-black font-medium hover:bg-white/90 transition text-center"
            >
              Sign in
            </a>
          </div>
        )}

        {step === 'form' && (
          <p className="mt-5 text-xs text-white/40 text-center">
            Remember it?{' '}
            <a href="/login" className="text-white/70 hover:text-white transition">Sign in</a>
          </p>
        )}
      </div>
    </div>
  );
}
