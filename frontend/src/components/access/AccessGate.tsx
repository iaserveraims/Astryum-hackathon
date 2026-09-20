'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useReducedMotion } from '../../stores/motionStore';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../stores/authStore';
import { AstryumLoader } from '../ui/AstryumLoader';
import { setVeilLifted } from '../../lib/motion/veil';
import { PREVIEW_DATA, PREVIEW_ADDRESS } from '../../services/previewData';
import { useT } from '@/i18n/LanguageProvider';

export default function AccessGate({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const reduced = useReducedMotion() ?? false;
  // El retén del velo: el tiempo que tarda el nacimiento del asteroide en
  // completarse (estela + trazo + cráteres + halo ≈ 1.7s) más un latido.
  const [minHold, setMinHold] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setMinHold(false), 1900);
    return () => clearTimeout(id);
  }, []);
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    // Stage 1 (the pre-launch code gate) moved SERVER-SIDE:
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

  // ── El velo del arranque, AL 100% ────────────────────────
  // La verificación es casi instantánea (localStorage), así que sin retén el
  // nacimiento del asteroide quedaba decapitado a medio trazo. El velo se
  // RETIENE hasta que el acto termina (~1.9s) y se retira con un fundido —
  // y la clave que hace esto gratis: el dashboard MONTA DEBAJO del velo en
  // cuanto la verificación pasa, así que las lecturas (portfolio, wallets)
  // arrancan durante la ceremonia. No se pierde ni un ms real: cuando el velo
  // cae, la app ya está más cargada que antes sin él.
  // Reduced motion: sin retén — a quien pidió menos teatro no se le cobra.
  const veiled = !checked || (minHold && !reduced);
  // LA COREOGRAFÍA ESPERA AL VELO (lib/motion/veil.ts): las
  // entradas de página (RevealGroup, Arrive) arrancaban al montar, o sea
  // detrás del velo, y terminaban antes de que cayera — en recarga dura la
  // página aparecía ya colocada. La señal baja mientras se vela y sube en el
  // instante en que el velo empieza a fundirse, para que los bloques entren
  // bajo la cortina que se retira. Al desmontar la puerta, levantado: nada
  // fuera de ella puede quedarse esperando.
  useEffect(() => {
    setVeilLifted(!veiled);
    return () => setVeilLifted(true);
  }, [veiled]);
  return (
    <>
      {checked && children}
      <AnimatePresence>
        {veiled && (
          <motion.div
            key="boot-veil"
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black"
            exit={{ opacity: 0, transition: { duration: 0.45, ease: 'easeOut' } }}
          >
            <AstryumLoader label={t('Verifying access…')} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
