'use client';

/**
 * PreviewOnly — build the new thing WHERE IT WILL LIVE, show it only to the
 * founders, and ship it by deleting one wrapper.
 *
 * WHY THIS EXISTS (founder decision, 2026-08-20). The alternative we were
 * living with was a long-lived branch: 164 commits diverging from main, a
 * preview that could not do wallets (Xaman and XRP Identity register callbacks
 * per domain, so every preview URL breaks login by construction), no backend
 * of its own, and a merge that grew scarier every day — which is exactly what
 * made it grow. Fear of deploying is what produces the branch, and the branch
 * is what justifies the fear.
 *
 * The other tempting alternative was "build it under /app/admin, then move it
 * when it is ready". Same isolation, but the move is the dangerous part: a
 * component changes route, layout, providers and props all at once, and that
 * is precisely where bugs live. You would test one thing and ship another.
 * The lesson this codebase keeps re-learning is that testing the pieces does
 * not prove the chain exists.
 *
 * So: mount it at its FINAL address, inside its real layout, with its real
 * providers and real data, and gate the SECTION. Releasing is then deleting
 * the wrapper — not a migration.
 *
 * WHAT IT DOES NOT DO, and this matters more than what it does:
 *
 *  - It hides a surface. It does NOT gate the backend. A user does not need
 *    your UI to reach an endpoint — `curl` is enough. Any new route that
 *    backs a PreviewOnly section must carry `requireAdmin` (backend/src/
 *    routes/adminPanel.ts), which answers 404 to everyone else and does not
 *    even admit the endpoint exists.
 *  - It does NOT protect shared code. Changing `lib/rules/runHealth.ts`,
 *    `lib/errors/serverRefusal.ts`, `lib/wallet/signOutcome.ts`, the
 *    automation engine, a migration or anything that boots on its own reaches
 *    every user the moment it deploys, whatever this wrapper says. For those
 *    there is no positioning trick — only tests and review.
 *
 * `isAdmin` comes from `GET /auth/me` (`isAdminEmail` against `ADMIN_EMAILS`),
 * so it is a server verdict, not a client claim. Default is HIDDEN: while the
 * store is still loading, or if the read failed, nothing renders. A surface
 * that is not ready must never appear because a fetch was slow.
 *
 * To find everything currently in flight: `grep -rn "PreviewOnly" frontend/src`.
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
