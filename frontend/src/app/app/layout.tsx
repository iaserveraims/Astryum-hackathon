'use client';

import AccessGate from '@/components/access/AccessGate';
import AppShell from '@/components/ui/AppShell';
import ProductAssistant from '@/components/assistant/ProductAssistant';
import LegacyComingSoonModal from '@/components/authority/LegacyComingSoonModal';
import ThemeApplier from '@/components/ui/ThemeApplier';
import { LanguageProvider } from '@/i18n/LanguageProvider';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <AccessGate>
        {/* data-theme on <html> while the dashboard lives — portals included */}
        <ThemeApplier />
        <AppShell>{children}</AppShell>
        {/* Floating product guide — public, app-only, never sees user data */}
        <ProductAssistant />
        {/* Demo gate for Legacy (opens via LEGACY_GATE_EVENT) — inert outside the demo */}
        <LegacyComingSoonModal />
      </AccessGate>
    </LanguageProvider>
  );
}
