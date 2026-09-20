'use client';

/**
 * PreviewOnly — build the new thing WHERE IT WILL LIVE, show it only to the
 * founders, and ship it by deleting one wrapper.
 */

import React from 'react';

import { useAuthStore } from '../../stores/authStore';

export interface PreviewOnlyProps {
  /** What this is, for the badge and for the grep. Keep it human. */
  label: string;
  /**
   * Why it is not public yet — shown to the founder in the badge. Write the
   * blocker, not the feature: "waiting on the E2E rehearsal", not "vaults".
   */
  pending?: string;
  children: React.ReactNode;
}

/**
 * Renders `children` only for a founder, with a marker so a preview is never
 * mistaken for the live product. Renders nothing for everyone else.
 */
export function PreviewOnly({ label, pending, children }: PreviewOnlyProps) {
  const isAdmin = useAuthStore((s) => s.isAdmin);

  // Fail-closed: anything other than a confirmed `true` renders nothing.
  if (isAdmin !== true) return null;

  return (
    <div data-preview-only={label} className="relative">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-tone-warning/40 bg-tone-warning/10 px-2.5 py-1 text-[11px] font-medium text-tone-warning">
          Preview · solo fundadores
        </span>
        <span className="text-[11px] text-ink/50">{label}</span>
        {pending ? <span className="text-[11px] text-ink/40">— {pending}</span> : null}
      </div>
      {children}
    </div>
  );
}

export default PreviewOnly;
