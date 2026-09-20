'use client';

/**
 * LegacyAccessGuard — la puerta de acceso a la superficie de Legacy.
 * Headless, montado una vez en AppShell.
 *
 * Antes vigilaba un ESTADO ("la sesión quedó aparcada en el producto índigo
 * sin tener acceso"). Desde 2026-08-22 ese estado ya no existe: Legacy no es
 * un producto en el que uno se queda, es una PANTALLA — así que lo que hay que
 * vigilar es simplemente estar en ella. Si el perfil no tiene acceso, se sale
 * al Summary y el sincronizador de ruta de AppShell devuelve el tema dorado
 * solo, sin que nadie tenga que tocar el modo a mano.
 *
 * Espera a `legacyAccessKnown`: `legacyAccess` arranca en false mientras
 * /auth/me está en vuelo, y echar a alguien por ese valor por defecto sacaría
 * de su propia gobernanza a un fundador con acceso en cada recarga.
 */

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '../../stores/authStore';

export default function LegacyAccessGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const legacyAccess = useAuthStore((s) => s.legacyAccess);
  const legacyAccessKnown = useAuthStore((s) => s.legacyAccessKnown);
  const onLegacySurface = !!pathname?.startsWith('/app/legacy');

  useEffect(() => {
    if (!legacyAccessKnown || legacyAccess || !onLegacySurface) return;
    router.push('/app');
  }, [legacyAccessKnown, legacyAccess, onLegacySurface, router]);

  return null;
}
