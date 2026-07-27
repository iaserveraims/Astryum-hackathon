'use client';

// Settings — configuration hub. Integrations and Blockchain Tools are HIDDEN
// for the hackathon demo (founder 2026-07-18): the pages stay in the tree
// (../integrations/page, ../tools/page) — restore their tabs below to bring
// them back.
import dynamic from 'next/dynamic';
import SectionTabs, { PanelLoading } from '@/components/ui/SectionTabs';

const Settings = dynamic(() => import('./_self'), { ssr: false, loading: PanelLoading });

export default function SettingsSection() {
  return (
    <SectionTabs
      tabs={[
        { key: 'settings', label: 'Settings', Comp: Settings },
      ]}
    />
  );
}
