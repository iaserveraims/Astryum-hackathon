'use client';

/**
 * /app/admin/institutional/exchange — the EXCHANGE's operator console.
 *
 * A product surface, not a set: the exchange operates here and nowhere else.
 * Sections: Profile (council · omnibus · pote · registry) · Operate (clients,
 * omnibus watcher, put capital to work, direct it by council order, the DENIED,
 * payouts, the backend key) · Audit (every step as a receipt read from the
 * chain, exportable). Clients never see this page; their surface is
 * ../client. Built BESIDE /app/admin/institutional (untouched), same gate.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Building2, ClipboardList, Settings2, ShieldCheck } from 'lucide-react';
import { useT } from '../../../../../i18n/LanguageProvider';
import { PreviewOnly } from '../../../../../components/ui/PreviewOnly';
import { useDemoRun } from '../../../../../lib/demo-exchange/useDemoRun';
import { ExchangeSetupPanel } from '../../../../../components/demo-exchange/ExchangeSetupPanel';
import { ExchangeDesk } from '../../../../../components/demo-exchange/ExchangeDesk';
import { EvidencePanel } from '../../../../../components/demo-exchange/EvidencePanel';

const ENABLED = process.env.NEXT_PUBLIC_INSTITUTIONAL_ENABLED === 'true';
type Section = 'profile' | 'operate' | 'audit';

function Console() {
  const { t } = useT();
  // Página de admin: todos los exchanges del despliegue, no solo los propios.
  const demo = useDemoRun({ allRuns: true });
  const [section, setSection] = useState<Section>(demo.run ? 'operate' : 'profile');
  const run = demo.run;

  const nav: Array<[Section, string, typeof Building2]> = [
    ['profile', t('Profile'), Settings2],
    ['operate', t('Operate'), Building2],
    ['audit', t('Audit'), ClipboardList],
  ];

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <header className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold text-ink">{run ? run.label : t('Exchange console')}</h1>
          <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-ink/50"><ShieldCheck className="w-3 h-3" /> {t('operator console')}</span>
        </div>
        <p className="text-xs text-ink/60 max-w-3xl">
          {t('Your controls, running on the ledger: who can deposit, who can order, what the capital may do, and what the client owns. Every action leaves a receipt you can read from the chain.')}
        </p>
        <p className="text-[11px] text-ink/40">
          <Link href="/app/admin/institutional/client" className="underline hover:text-ink">{t('Client surface →')}</Link>
          {' · '}
          <Link href="/app/admin/institutional" className="underline hover:text-ink">{t('Guided demo')}</Link>
        </p>
        {demo.error ? <p className="text-xs text-danger">{demo.error}</p> : null}
      </header>

      <nav className="flex flex-wrap gap-2">
        {nav.map(([key, label, Icon]) => (
          <button key={key} onClick={() => setSection(key)} className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold border ${section === key ? 'border-volt text-volt' : 'border-ink/10 text-ink/60'}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </nav>

      {section === 'profile' ? <ExchangeSetupPanel demo={demo} /> : null}
      {section === 'operate' ? (run ? <ExchangeDesk demo={demo} /> : <p className="text-xs text-ink/50">{t('Create or select an exchange profile first.')}</p>) : null}
      {section === 'audit' ? <EvidencePanel demo={demo} /> : null}
    </div>
  );
}

export default function ExchangeConsolePage() {
  const { t } = useT();
  if (!ENABLED) {
    return (
      <div className="p-6">
        <p className="text-sm text-ink/60">{t('The institutional module is not enabled on this environment.')}</p>
      </div>
    );
  }
  return (
    <PreviewOnly label="Exchange console" pending="rodaje 21-sep">
      <Console />
    </PreviewOnly>
  );
}
