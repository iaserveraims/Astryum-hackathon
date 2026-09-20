'use client';

/**
 * /app/admin/demo-exchange — the Demo Exchange v2 (BuildSpec): the
 * complete demo UI built BESIDE /app/admin/institutional, importing its pieces
 * and touching none of them.
 */

import { PreviewOnly } from '../../../../components/ui/PreviewOnly';
import { DemoExchangeShell } from '../../../../components/demo-exchange/DemoExchangeShell';
import { useT } from '../../../../i18n/LanguageProvider';

const ENABLED = process.env.NEXT_PUBLIC_INSTITUTIONAL_ENABLED === 'true';

export default function DemoExchangePage() {
  const { t } = useT();
  if (!ENABLED) {
    return (
      <div className="p-6">
        <p className="text-sm text-ink/60">{t('The institutional module is not enabled on this environment.')}</p>
      </div>
    );
  }
  return (
    <PreviewOnly label="Demo Exchange v2" pending="rodaje 21-sep">
      <DemoExchangeShell />
    </PreviewOnly>
  );
}
