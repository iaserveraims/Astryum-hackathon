'use client';

import Link from 'next/link';
import { LogIn, AlertTriangle } from 'lucide-react';
import { Card, GhostButton, PrimaryButton } from '../components/ui/primitives';

export function hasAuthToken(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem('auth_token');
}

const AUTH_KEYWORDS = [
  'token',
  'jwt',
  'unauthorized',
  'unauthenticated',
  'no_session',
  'invalid_session',
  'siwe',
  'expired',
];

/**
 * Treat any error message that hints at missing/expired auth as auth-required.
 */
export function isAuthError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { status?: number; message?: string };
  if (e.status === 401 || e.status === 403) return true;
  const msg = (e.message ?? '').toLowerCase();
  return AUTH_KEYWORDS.some((k) => msg.includes(k));
}

/**
 * Inline friendly auth error block — drop into any page that hit a 401.
 */
export function AuthRequired({
  message,
  fullPage = true,
}: {
  message?: string;
  fullPage?: boolean;
}) {
  const content = (
    <Card className="text-center py-12 max-w-md mx-auto">
      <div className="w-12 h-12 rounded-full bg-volt/10 border border-volt/25 flex items-center justify-center mx-auto mb-4">
        <LogIn className="w-5 h-5 text-volt" strokeWidth={1.5} />
      </div>
      <h3 className="text-lg font-semibold tracking-tight mb-1">Session required</h3>
      <p className="text-sm text-ink/60 mb-6 max-w-xs mx-auto">
        {message ?? 'Sign in with your Flare wallet to access this page. Astryum never stores your private keys.'}
      </p>
      <div className="flex justify-center gap-2">
        <Link href="/login">
          <PrimaryButton>
            <span className="inline-flex items-center gap-1.5">
              <LogIn className="w-3.5 h-3.5" strokeWidth={1.5} />
              Sign in
            </span>
          </PrimaryButton>
        </Link>
        <GhostButton onClick={() => window.location.reload()}>Retry</GhostButton>
      </div>
    </Card>
  );
  return fullPage ? <div className="py-8">{content}</div> : content;
}

/**
 * Generic friendly error block for non-auth errors.
 */
export function FriendlyError({ message }: { message: string }) {
  return (
    <Card className="text-center py-12 max-w-md mx-auto border-red-500/30">
      <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
        <AlertTriangle className="w-5 h-5 text-red-300" strokeWidth={1.5} />
      </div>
      <h3 className="text-lg font-semibold tracking-tight mb-1">Something went wrong</h3>
      <p className="text-sm text-ink/60 mb-6 max-w-xs mx-auto break-words">{message}</p>
      <GhostButton onClick={() => window.location.reload()}>Retry</GhostButton>
    </Card>
  );
}
