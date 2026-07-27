'use client';

import { Wrench } from 'lucide-react';
import { EmptyState } from '../../../components/ui/primitives';

// Blockchain tools are DISABLED and the old section was RETIRED with the
// template-era component set (2026-07-21 de-AI pass) — it lived on the dead
// shadcn kit (ui/card, badge, Button…) outside the surface/volt/ink system.
// git history keeps it; a future tools section should be rebuilt on primitives.

export default function ToolsPage() {
  return (
    <EmptyState
      icon={<Wrench className="w-8 h-8" strokeWidth={1.5} />}
      title="Blockchain tools are disabled"
      hint="This section is switched off for the current beta. It will return in a later release."
    />
  );
}
