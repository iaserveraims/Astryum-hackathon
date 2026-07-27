'use client';

/**
 * ProductTour — interactive coachmarks, first run only (founder 2026-07-18;
 * rebuilt 2026-07-19 after the first cut rendered UNDER the Summary cards).
 *
 * Two tours by design, never more: 'summary' walks the sidebar the first time
 * the dashboard opens; 'earn' explains the doors the first time Earn opens.
 * Skippable at any moment; replayable from Settings → Initial setup → Run
 * again (which resets both).
 *
 * Why a portal: the tour mounts inside page trees whose ancestors animate
 * with transforms (RevealItem/Spotlight). A transformed ancestor becomes the
 * containing block for position:fixed AND caps the child's stacking context —
 * which is exactly the "appears behind the boxes" bug. Rendering through
 * createPortal(document.body) puts the overlay outside every page stacking
 * context; z-index then works against the root like it should.
 *
 * Choreography: ONE persistent spotlight element springs between target
 * rects (the giant box-shadow both dims the page and carves the hole, so the
 * dim travels with it), and ONE popover glides to each step while its text
 * crossfades. Nothing remounts between steps — that is what makes the motion
 * read as a guide moving through the ship rather than cards popping in.
 *
 * The dim now also blurs the rest of the page — but a box-shadow can't clip
 * backdrop-filter, so the blur is a four-rect frame (above/below/left/right
 * of the same hole) riding the same spring as the spotlight. The hole itself
 * never gets a blurred layer over it, so the highlighted element stays sharp.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { useOnboardingStore, type TourId } from '../../stores/onboardingStore';

export interface TourStep {
  /** [data-tour] value to anchor to; null = centered welcome card. */
  target: string | null;
  title: string;
  body: string;
}

const PAD = 10; // breathing room between the target and the ring
const POP_W = 330; // popover width (px) — placement math uses it
const POP_EST_H = 220; // conservative popover height estimate for clamping
const GAP = 18; // spotlight ↔ popover gap
const SETTLE_MS = 650; // let the page's entry animations land first

type Box = { left: number; top: number; width: number; height: number };

function elOf(target: string | null): HTMLElement | null {
  if (!target || typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
}

function boxOf(target: string | null): Box | null {
  const el = elOf(target);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** Popover position beside a spotlight box: right → left → below → above. */
function placePopover(box: Box, vw: number, vh: number): { left: number; top: number } {
  const clampTop = (t: number) => Math.min(Math.max(t, 16), Math.max(16, vh - POP_EST_H - 16));
  const clampLeft = (l: number) => Math.min(Math.max(l, 16), Math.max(16, vw - POP_W - 16));
  if (vw - (box.left + box.width) >= POP_W + GAP + 16) {
    return { left: box.left + box.width + PAD + GAP, top: clampTop(box.top - PAD) };
  }
  if (box.left >= POP_W + GAP + 16) {
    return { left: box.left - PAD - GAP - POP_W, top: clampTop(box.top - PAD) };
  }
  if (vh - (box.top + box.height) >= POP_EST_H + GAP) {
    return { left: clampLeft(box.left), top: box.top + box.height + PAD + GAP };
  }
  return { left: clampLeft(box.left), top: clampTop(box.top - PAD - GAP - POP_EST_H) };
}

/** Four rects tiling the viewport minus `hole` — the blur frame around the
 * spotlight. Same hole, every time, so the crisp gap always lines up with
 * the un-blurred target underneath; nothing here ever grows into the hole. */
function frameOf(hole: Box, vw: number, vh: number): Box[] {
  const right = hole.left + hole.width;
  const bottom = hole.top + hole.height;
  return [
    { left: 0, top: 0, width: vw, height: Math.max(0, hole.top) }, // above
    { left: 0, top: bottom, width: vw, height: Math.max(0, vh - bottom) }, // below
    { left: 0, top: hole.top, width: Math.max(0, hole.left), height: hole.height }, // left of the hole
    { left: right, top: hole.top, width: Math.max(0, vw - right), height: hole.height }, // right of the hole
  ];
}

export default function ProductTour({ tour, steps }: { tour: TourId; steps: TourStep[] }) {
  const { t } = useT();
  const reduce = useReducedMotion();
  const completed = useOnboardingStore((s) => s.completed);
  const wizardOpen = useOnboardingStore((s) => s.forceOpen);
  const done = useOnboardingStore((s) => s.toursDone[tour]);
  const markTourDone = useOnboardingStore((s) => s.markTourDone);

  // Only after the first-run wizard is out of the way, and only once.
  const active = completed && !wizardOpen && !done;

  // Give the page its entry beat, THEN measure which targets exist — filtering
  // at mount time would run before the shell settles and drop real steps.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!active) {
      setStarted(false);
      return;
    }
    const timer = setTimeout(() => setStarted(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [active]);

  const [idx, setIdx] = useState(0);
  const visible = useMemo(
    () => (started ? steps.filter((s) => s.target === null || boxOf(s.target) !== null) : []),
    // Steps are a stable literal per page; re-filter only when the tour starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [started],
  );
  const step: TourStep | null = visible[idx] ?? null;

  // Live target box — measured on step change, kept fresh by rAF-throttled
  // scroll/resize listeners plus a ResizeObserver on the target itself.
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    if (!step) return;
    const el = elOf(step.target);
    // Bring an off-screen target into view before spotlighting it.
    el?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });

    let raf = 0;
    const measure = () => {
      raf = 0;
      setBox(boxOf(step.target));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    const ro = el ? new ResizeObserver(schedule) : null;
    if (el && ro) ro.observe(el);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      ro?.disconnect();
    };
  }, [step, reduce]);

  const finish = useCallback(() => markTourDone(tour), [markTourDone, tour]);
  const last = idx === visible.length - 1;
  const next = useCallback(() => {
    if (last) finish();
    else setIdx((i) => i + 1);
  }, [last, finish]);
  const back = useCallback(() => setIdx((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!active || !started) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, started, finish, next, back]);

  if (!active || !started || !step || typeof document === 'undefined') return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const centered = !box || vw < 640;
  const pop = centered
    ? { left: Math.max(16, (vw - POP_W) / 2), top: Math.max(16, vh / 2 - POP_EST_H / 2) }
    : placePopover(box, vw, vh);

  const spring = reduce
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 380, damping: 36, mass: 0.9 };

  // The rounded hole the ring sits in — shared by the spotlight AND the blur
  // frame below so the two never drift apart between spring ticks.
  const hole: Box | null = box && {
    left: box.left - PAD,
    top: box.top - PAD,
    width: box.width + PAD * 2,
    height: box.height + PAD * 2,
  };

  const overlay = (
    <AnimatePresence>
      <motion.div
        key={tour}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="fixed inset-0 z-[120]"
        role="dialog"
        aria-modal
        aria-label={step.title}
      >
        {/* Click-catcher: freezes the page under the tour; a tap anywhere on
            the dim advances (the popover stops propagation). */}
        <div className="absolute inset-0" onClick={next} aria-hidden />

        {/* THE spotlight — one element, springing between targets. Its huge
            box-shadow is the dim, so hole and dim always travel together. */}
        {hole ? (
          <>
            {/* Blur frame — four rects tiling everything OUTSIDE `hole`, each
                blurred + very lightly tinted, springing on the identical
                transition as the ring itself. A box-shadow can't clip
                backdrop-filter, so this is the only way to blur the page
                around the target without ever laying blur over the hole
                (and therefore over the highlighted element). */}
            {frameOf(hole, vw, vh).map((rect, i) => (
              <motion.div
                key={i}
                className="pointer-events-none absolute"
                initial={false}
                animate={rect}
                transition={spring}
                style={{
                  backdropFilter: 'blur(3px)',
                  WebkitBackdropFilter: 'blur(3px)',
                  backgroundColor: 'rgba(4,4,7,0.2)',
                  // Approximate the ring's rounded-2xl corners on the two
                  // strips flanking the hole (left=2, right=3 below) so the
                  // blur's seam doesn't read as a hard square against it —
                  // this only ever shrinks a strip's own corner, never grows
                  // it into the hole.
                  ...(i === 2 && { borderTopRightRadius: 16, borderBottomRightRadius: 16 }),
                  ...(i === 3 && { borderTopLeftRadius: 16, borderBottomLeftRadius: 16 }),
                }}
                aria-hidden
              />
            ))}

            <motion.div
              className="pointer-events-none absolute rounded-2xl"
              initial={false}
              animate={hole}
              transition={spring}
              style={{
                boxShadow:
                  '0 0 0 1.5px hsl(var(--volt) / 0.85), 0 0 0 5px hsl(var(--volt) / 0.14), 0 0 34px hsl(var(--volt) / 0.3), 0 0 0 9999px rgba(4,4,7,0.55)',
              }}
            >
              {/* breathing halo — the ring feels alive without moving layout */}
              {!reduce && (
                <motion.div
                  className="absolute -inset-px rounded-2xl"
                  animate={{ opacity: [0.55, 1, 0.55] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ boxShadow: '0 0 0 1px hsl(var(--volt) / 0.5), inset 0 0 18px hsl(var(--volt) / 0.08)' }}
                  aria-hidden
                />
              )}
            </motion.div>
          </>
        ) : (
          <motion.div
            className="pointer-events-none absolute inset-0 bg-[#040407]/78"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            // No target to protect (welcome step / narrow viewport) — blur
            // the whole flat dim too, same 3px, same scope as the frame above.
            style={{ backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' }}
          />
        )}

        {/* THE popover — glides between placements; its content crossfades. */}
        <motion.div
          initial={false}
          animate={{ left: pop.left, top: pop.top }}
          transition={spring}
          onClick={(e) => e.stopPropagation()}
          className="absolute rounded-2xl border border-ink/12 bg-surface-3/95 backdrop-blur-md shadow-[0_28px_80px_rgba(0,0,0,0.65),0_0_0_1px_rgba(255,255,255,0.03)]"
          style={{ width: POP_W, maxWidth: 'calc(100vw - 32px)' }}
        >
          {/* hairline accent along the top — the guide's voice, in product hue */}
          <div
            className="h-[2px] rounded-t-2xl"
            style={{ background: 'linear-gradient(90deg, hsl(var(--volt)), hsl(var(--volt) / 0))' }}
            aria-hidden
          />
          <div className="p-4">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={idx}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">{step.title}</p>
                  <button
                    onClick={finish}
                    className="shrink-0 rounded-md p-0.5 text-ink/35 transition-colors hover:text-ink/85"
                    aria-label={t('Skip tour')}
                  >
                    <X size={14} />
                  </button>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink/60">{step.body}</p>
              </motion.div>
            </AnimatePresence>

            {/* progress — filled rail up to the current step */}
            <div className="mt-3.5 flex items-center gap-1" aria-hidden>
              {visible.map((_, i) => (
                <motion.span
                  key={i}
                  className="h-1 flex-1 rounded-full"
                  animate={{ backgroundColor: i <= idx ? 'hsl(var(--volt))' : 'hsl(var(--ink) / 0.1)' }}
                  transition={{ duration: 0.2 }}
                />
              ))}
            </div>

            <div className="mt-3.5 flex items-center justify-between">
              <button onClick={finish} className="text-[11px] text-ink/35 transition-colors hover:text-ink/70">
                {t('Skip tour')}
              </button>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] tabular-nums text-ink/30">
                  {idx + 1}/{visible.length}
                </span>
                {idx > 0 && (
                  <button
                    onClick={back}
                    className="inline-flex items-center gap-1 rounded-lg border border-ink/10 px-2.5 py-1.5 text-[12px] text-ink/70 transition-colors hover:bg-ink/5"
                  >
                    <ArrowLeft size={12} /> {t('Back')}
                  </button>
                )}
                <button
                  onClick={next}
                  className="inline-flex items-center gap-1 rounded-lg bg-volt px-3 py-1.5 text-[12px] font-semibold text-volt-ink transition-all hover:brightness-105"
                >
                  {last ? t('Done') : t('Next')} {!last && <ArrowRight size={12} />}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(overlay, document.body);
}
