'use client';

/**
 * /app/partner — la mesa de la EMPRESA AUDITORA de KYC. SOLO POR URL
 * (fundador 2026-08-29): sin entrada en ningún menú, sin paso de tour, fuera
 * de ⌘K. La relación con una auditora es B2B y negociada — Astryum le da el
 * enlace; no es auto-servicio y no debe descubrirse paseando por la app.
 *
 * La mesa en sí (PartnerDesk) es la misma pieza que vivía como tercera lente
 * en la puerta Managed vaults de Earn — de allí se retiró para que Earn quede
 * solo con el catálogo del cliente.
 */

import { PageHeader } from '../../../components/ui/primitives';
import { useT } from '../../../i18n/LanguageProvider';
import { PartnerDesk } from '../../../components/managed/PartnerDesk';

export default function PartnerPage() {
  const { t } = useT();

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow={t('Professional')}
        title={t('KYC partner desk')}
        subtitle={t('Your on-chain registry and your clients. Astryum composes the calls; the admin of the registry — you — signs every one.')}
      />
      <PartnerDesk />
    </div>
  );
}
