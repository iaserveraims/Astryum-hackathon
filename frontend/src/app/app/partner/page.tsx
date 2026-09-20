'use client';

/**
 * /app/partner — la mesa de la EMPRESA AUDITORA de KYC. SOLO POR URL:
 * sin entrada en ningún menú, sin paso de tour, fuera
 * de ⌘K. La relación con una auditora es B2B y negociada — Astryum le da el
 * enlace; no es auto-servicio y no debe descubrirse paseando por la app.
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
