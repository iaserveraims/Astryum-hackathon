'use client';

/**
 * LegacyAccessGuard — la puerta de acceso a la superficie de Legacy.
 * Headless, montado una vez en AppShell.
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
