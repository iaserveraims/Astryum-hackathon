'use client';

import { useState, type ComponentType } from 'react';
import { useT } from '@/i18n/LanguageProvider';

export type SectionTab = { key: string; label: string; Comp: ComponentType };

// A thin segmented control that fuses sibling pages into one section. Only the
// active panel mounts, so each sub-page fetches/subscribes exactly as it would
// when visited on its own route — no double work.
export default function SectionTabs({ tabs, initial = 0 }: { tabs: SectionTab[]; initial?: number }) {
  const { t } = useT();
  const [i, setI] = useState(initial);
  const Active = tabs[i]?.Comp ?? null;
  return (
    <div>
      <div className="mb-2 inline-flex flex-wrap items-center gap-1 rounded-xl border border-ink/10 bg-ink/[0.03] p-1">
        {tabs.map((tb, idx) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setI(idx)}
            aria-pressed={idx === i}
            className={`px-3.5 py-1.5 rounded-lg text-sm transition-colors ${
              idx === i ? 'bg-volt text-volt-ink font-semibold' : 'text-ink/55 hover:text-ink'
            }`}
          >
            {t(tb.label)}
          </button>
        ))}
      </div>
      {Active ? <Active /> : null}
    </div>
  );
}

export function PanelLoading() {
  return <div className="py-20 text-center text-sm text-ink/40">…</div>;
}
