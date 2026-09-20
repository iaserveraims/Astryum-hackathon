'use client';

/**
 * /app/manager — la MESA DEL GESTOR: crear y gobernar
 * tus bóvedas, y tu certificación, en un sitio propio.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users } from 'lucide-react';

import { PageHeader } from '../../../components/ui/primitives';
import { useT } from '../../../i18n/LanguageProvider';
import { useIsManager } from '../../../stores/managerStore';
import { ManagerDesk } from '../../../components/managed/ManagerDesk';
import { ManagerDeclaration } from '../../../components/managed/ManagerDeclaration';
import { VaultCreator } from '../../../components/managed/VaultCreator';
import { PreviewOnly } from '../../../components/ui/PreviewOnly';
import { useAuthStore } from '../../../stores/authStore';
import { MANAGER_DESK_OPEN } from '../../../lib/nav/managerDesk';

function ManagerRoom() {
  const { t } = useT();
  const isManager = useIsManager();

  /**
   * EL TÚNEL.
   * /app/manager?tunnel=1 monta el creador entero SIN flag, SIN wallet y SIN
   * chain — interactivo de punta a punta, con la firma desactivada. Envuelto
   * en <PreviewOnly> (isAdmin de /auth/me, fail-closed): para cualquiera que
   * no sea fundador el parámetro no existe. El param no se consume de la URL
   * a propósito: recargar mientras se itera debe conservar el túnel.
   */
  const [tunnel, setTunnel] = useState(false);
  useEffect(() => {
    try {
      setTunnel(new URLSearchParams(window.location.search).get('tunnel') === '1');
    } catch {
      /* sin URL legible no hay túnel */
    }
  }, []);

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow={t('Professional')}
        title={t('Manager desk')}
        subtitle={t('Create and govern the vaults you run, and the certification that backs you. Clients never see this page — they find your vaults in Earn.')}
        actions={
          <Link
            href="/app/community"
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink/10 px-3 py-1.5 text-xs text-ink/70 transition-colors hover:border-ink/25 hover:text-ink"
          >
            <Users className="h-3.5 w-3.5" strokeWidth={1.8} /> {t('Community')}
          </Link>
        }
      />

      {tunnel && (
        <div className="mb-5">
          <PreviewOnly
            label="Túnel — creador de vaults"
            pending="iterando la experiencia; la firma está desactivada"
          >
            <VaultCreator account={null} />
          </PreviewOnly>
        </div>
      )}

      {!isManager ? (
        <ManagerDeclaration />
      ) : (
        <div className="space-y-5">
          {/* La mesa completa, EN SALAS. La certificación vive ahora
              dentro de su sala «Título», junto a la puerta y la bandeja. */}
          <ManagerDesk />
        </div>
      )}
    </div>
  );
}

/**
 * LA PUERTA DE LA PÁGINA. `MANAGER_DESK_OPEN` solo
 * escondía la FILA del menú: quien tecleaba /app/manager entraba igual, se
 * declaraba gestor con un clic y abría la mesa. Ahora decide también la página,
 * con la misma regla —abierta fuera de producción, cerrada dentro— y, donde
 * está cerrada, solo la ven los fundadores (el túnel del creador sigue vivo para
 * ellos). La nota aparece solo con un «no» explícito del servidor.
 */
export default function ManagerPage() {
  const { t } = useT();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  // `isAdmin` arranca en false mientras /auth/me viaja: sin esta marca la nota
  // parpadearía para un fundador en cada carga.
  const meAnswered = useAuthStore((s) => s.legacyAccessKnown);
  if (MANAGER_DESK_OPEN) return <ManagerRoom />;
  return (
    <>
      <PreviewOnly label="Mesa del gestor" pending="cerrada en este despliegue: se abre con la puerta de credenciales encendida">
        <ManagerRoom />
      </PreviewOnly>
      {meAnswered && !isAdmin ? (
        <div className="p-6">
          <p className="text-sm text-ink/60">{t('This desk is open to the founders only for now.')}</p>
        </div>
      ) : null}
    </>
  );
}
