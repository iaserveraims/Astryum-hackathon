'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../stores/authStore';
import { PREVIEW_DATA, PREVIEW_ADDRESS } from '../../services/previewData';
import { useT } from '@/i18n/LanguageProvider';

export default function AccessGate({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    // Stage 1 (the pre-launch code gate) moved SERVER-SIDE (2026-07-23):
    // middleware.ts verifies the signed httpOnly cookie before this page is
    // ever served, so a client-side flag check here would be theater.
    //
    // Dev bypass: developers preview without a wallet. Backend still rejects
    // any mutating call without a real JWT — this only opens the UI shell.
    // NODE_ENV-guarded so a stray env var can never open a production build.
    const devBypass =
      process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true';
    if (devBypass) {
      if (typeof window !== 'undefined' && !localStorage.getItem('auth_token')) {
        localStorage.setItem('auth_token', 'dev-bypass-no-jwt');
      }
      // Local design preview: inject a sample wallet so data-rich views render.
      if (PREVIEW_DATA) {
        setUser({ id: 'preview', address: PREVIEW_ADDRESS, username: 'Preview' });
      }
      setChecked(true);
      return;
    }
    // Stage 2: account token in localStorage (set by email / passkey / SIWE
    // login). A wallet is NOT required to enter — the account is the gate;
    // wallet linking happens later for balances + signing.
    // Set NEXT_PUBLIC_REQUIRE_SIWE=false to disable while iterating locally.
    const requireSiwe = process.env.NEXT_PUBLIC_REQUIRE_SIWE !== 'false';
    if (requireSiwe) {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      if (!token) {
        router.replace('/login');
        return;
      }
    }
    // Hydrate the account's aggregated linked wallets (non-blocking).
    refreshMe();
    setChecked(true);
  }, [router, refreshMe]);

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-white/40 text-sm tracking-widest uppercase">{t('Verifying access…')}</div>
      </div>
    );
  }

  return <>{children}</>;
}
