'use client';

/**
 * /app/partner — la mesa de la EMPRESA AUDITORA de KYC. SOLO POR URL
 * (fundador 2026-08-29): sin entrada en ningún menú, sin paso de tour, fuera
 * de ⌘K. La relación con una auditora es B2B y negociada — Astryum le da el
 * enlace; no es auto-servicio y no debe descubrirse paseando por la app.
 *
 * SOLO FUNDADORES, de momento (fundador 2026-09-20: «parece una herramienta de
 * administrador para validar el KYC de un cliente; deja un acceso desde admin
 * y ya está»). No es un paso del alta del gestor (su Título va por la
 * atestación de Coinbase y el notario) ni de la del exchange (sus estaciones
 * de registro se descartaron): es la mesa de quien administra un registro
 * KYC y aprueba clientes. Va tras <PreviewOnly> —veredicto de servidor,
 * fail-closed— y se abre desde Admin → Herramientas. Su ruta de backend
 * (`/institutional/kyc/register/prepare`) lleva requireAdmin, como toda ruta
 * que sirve a una sección tapada.
 *
 * La mesa en sí (PartnerDesk) es la misma pieza que vivía como tercera lente
 * en la puerta Managed vaults de Earn — de allí se retiró para que Earn quede
 * solo con el catálogo del cliente.
 */

import { PageHeader } from '../../../components/ui/primitives';
import { PreviewOnly } from '../../../components/ui/PreviewOnly';
import { useT } from '../../../i18n/LanguageProvider';
import { PartnerDesk } from '../../../components/managed/PartnerDesk';

export default function PartnerPage() {
  const { t } = useT();

  return (
    <div className="max-w-3xl">
      <PreviewOnly label="Mesa del partner de KYC" pending="herramienta de fundadores — se abre desde Admin">
        <PageHeader
          eyebrow={t('Professional')}
          title={t('KYC partner desk')}
          subtitle={t('Your on-chain registry and your clients. Astryum composes the calls; the admin of the registry — you — signs every one.')}
        />
        <PartnerDesk />
      </PreviewOnly>
    </div>
  );
}
