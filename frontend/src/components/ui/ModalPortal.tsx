'use client';

/**
 * ModalPortal — the one place every overlay in the app is mounted from.
 *
 * WHY (bug 2026-07-30): almost every modal used to render inline, right where
 * its owner card lived, as a plain `fixed inset-0 z-50` div. That looks correct
 * and is not, for four compounding reasons:
 *
 *   1. `position: fixed` is NOT viewport-relative when an ancestor has a
 *      transform / filter / backdrop-filter — that ancestor becomes the
 *      containing block. `<Card hover>` carries `hover:-translate-y-0.5`, so a
 *      modal opened from a collapsed position card was sized and placed against
 *      the CARD, not the screen. Worse, it oscillated: the overlay covers the
 *      card → :hover stays on → transform on → overlay shrinks to the card →
 *      pointer is now outside the card → :hover off → transform off → overlay
 *      snaps back to fullscreen → repeat. That is the "disappears, comes back,
 *      moves" the founder saw.
 *   2. Cards with `overflow-hidden` (WalletManager) simply CLIPPED the overlay.
 *   3. AppShell wraps all page content in `<div class="relative z-10">`, so a
 *      page modal's z-50 is a z-50 INSIDE a z-10 stacking context. Any sibling
 *      of that wrapper with z-40 (ProductAssistant; formerly the floating
 *      ResumedSettlements, since moved into the sidebar) paints on top of it
 *      and eats the clicks.
 *   4. Every modal re-implemented its own scroll lock, or none at all, so the
 *      page scrolled behind the dialog.
 *
 * Portalling to <body> removes 1–3 by construction (no ancestor left to trap
 * or clip, and every overlay becomes a body-level sibling so z-index means
 * again what it says). 4 is handled here once, with a refcount so nested
 * modals restore the page scroll exactly once.
 *
 * It also publishes an open-count so background pollers can hold still while
 * the user is mid-signature — a refresh that unmounts the owner card takes the
 * open modal with it (see useModalsOpen).
 */

import React, { ReactNode, useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

/* ------------------------------------------------------------------ */
/* Open-modal registry — one counter, many subscribers                  */
/* ------------------------------------------------------------------ */

let openCount = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** How many modals are open right now. Safe to call during render. */
export function modalsOpen(): number {
  return openCount;
}

/**
 * Reactive open-modal count. Pollers use this to skip a refresh while a dialog
 * is up: `if (modalsOpen() > 0) return;` inside the interval, plus an effect on
 * this value to catch up the moment the last modal closes.
 */
export function useModalsOpen(): number {
  return useSyncExternalStore(subscribe, modalsOpen, () => 0);
}

/* ------------------------------------------------------------------ */
/* Body scroll lock — refcounted so nested modals don't fight           */
/* ------------------------------------------------------------------ */

let lockCount = 0;
let prevOverflow = '';
let prevPaddingRight = '';

function lockBodyScroll() {
  if (lockCount === 0) {
    prevOverflow = document.body.style.overflow;
    prevPaddingRight = document.body.style.paddingRight;
    // Compensate the scrollbar we are about to remove, or the whole layout
    // jumps sideways the instant a modal opens (reads as "it moved").
    const gap = window.innerWidth - document.documentElement.clientWidth;
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
}

function unlockBodyScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = prevOverflow;
    document.body.style.paddingRight = prevPaddingRight;
  }
}

/* ------------------------------------------------------------------ */

/**
 * The count + scroll-lock half of ModalPortal, without the portal. For dialogs
 * that must own their own createPortal call — e.g. anything wrapped in
 * <AnimatePresence>, where inserting a non-motion component between the
 * presence boundary and the animated element loses the exit animation.
 */
export function useModalRegistration(opts?: {
  /** false while the dialog is closed — hooks can't be conditional, the count must be. */
  active?: boolean;
  lockScroll?: boolean;
}): void {
  const active = opts?.active ?? true;
  const lockScroll = opts?.lockScroll ?? true;
  useEffect(() => {
    if (!active) return;
    openCount += 1;
    emit();
    if (lockScroll) lockBodyScroll();
    return () => {
      openCount = Math.max(0, openCount - 1);
      emit();
      if (lockScroll) unlockBodyScroll();
    };
  }, [active, lockScroll]);
}

export default function ModalPortal({
  children,
  onEscape,
  lockScroll = true,
}: {
  /** The overlay root — keep its own `fixed inset-0 z-…` classes as they are. */
  children: ReactNode;
  /** Opt-in Escape-to-close. Omit for dialogs that must not be dismissed mid-flight. */
  onEscape?: () => void;
  /** Set false for non-blocking overlays (toasts, popovers) that must not lock the page. */
  lockScroll?: boolean;
}) {
  useModalRegistration({ lockScroll });

  useEffect(() => {
    if (!onEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onEscape]);

  // SSR / pre-hydration: nothing to portal into yet.
  if (typeof document === 'undefined') return null;

  return createPortal(children, document.body);
}

/**
 * ModalOverlay — the overlay root itself, portalled. Drop-in replacement for
 * the `<div className="fixed inset-0 …">` every dialog used to open with: same
 * element, same classes, same handlers, but mounted on <body> instead of inside
 * whatever card happened to own the state.
 *
 * Keep passing the overlay's own classes — the z-layer is deliberate per
 * surface (50 = page dialogs · 60 = Xaman signing · 100 = step-up / ⌘K ·
 * 110 = intents · 120 = tour · 200 = onboarding) and now means what it says,
 * since every overlay is a <body>-level sibling again.
 */
export function ModalOverlay({
  children,
  onEscape,
  lockScroll,
  ...divProps
}: {
  children?: ReactNode;
  onEscape?: () => void;
  lockScroll?: boolean;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>) {
  return (
    <ModalPortal onEscape={onEscape} lockScroll={lockScroll}>
      <div {...divProps}>{children}</div>
    </ModalPortal>
  );
}
