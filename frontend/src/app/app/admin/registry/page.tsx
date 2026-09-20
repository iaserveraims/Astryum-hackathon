'use client';

/**
 * /app/admin/registry — el gobierno del scanner (AstryumRegistry), tapado.
 *
 * Herramienta de FUNDADORES: leer la whitelist y componer las escrituras del
 * governor (proponer/activar/retirar venues). Vive tras <PreviewOnly> —
 * veredicto de servidor `isAdmin`, fail-closed — porque gobierna el registro
 * de Astryum, no el de ningún usuario. La llamada compuesta la firma el
 * GOVERNOR con su wallet; Astryum jamás firma (invariante #1).
 */

import { PageHeader } from '../../../../components/ui/primitives';
import { PreviewOnly } from '../../../../components/ui/PreviewOnly';
import { VenueRegistryCard } from '../../../../components/admin/VenueRegistryCard';
import { useT } from '../../../../i18n/LanguageProvider';

export default function AdminRegistryPage() {
  const { t } = useT();
  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow={t('Admin')}
        title={t('Venue registry')}
        subtitle={t('The on-chain scanner every v2 pote consults. Propose, mature, activate — the governor signs each write.')}
      />
      <PreviewOnly label="Registro de venues (scanner v2)" pending="gobierno del governor — herramienta de fundadores">
        <VenueRegistryCard />
      </PreviewOnly>
    </div>
  );
}
