'use client';

/**
 * SceneDoor — the Earn surface's beloved "door" pattern, made shareable so every
 * dashboard page speaks the same visual language: a themed panel with the copy
 * breathing on the left and a LIVING SCENE occupying the right, brightening (and
 * often drawing itself) under attention. Not an icon in a box — a little world.
 *
 * Faithful generalization of `EarnDoor` in components/earn/FlareDemoEarn.tsx:
 * same Card(hover+spotlight), same eyebrow/title/desc/CTA rhythm, same absolutely
 * positioned scene. The Earn page keeps its own local copy untouched (zero
 * regression risk); new surfaces use this one.
 *
 * Give it a `scene` from components/ui/scenes.tsx (or components/earn/icons.tsx).
 * All scene motion is CSS (globals.css), constant-speed, off under reduced motion.
 */

import { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Card, MicroLabel } from './primitives';

export type DoorTone = 'gold' | 'sky' | 'emerald' | 'amber' | 'violet' | 'rose';

// Full literal class strings so Tailwind's content scanner emits every variant.
const TONE: Record<DoorTone, { border: string; cta: string }> = {
  gold: { border: 'border-volt/15 hover:border-volt/35', cta: 'text-volt' },
  sky: { border: 'border-sky-400/15 hover:border-sky-400/35', cta: 'text-sky-300' },
  emerald: { border: 'border-emerald-400/15 hover:border-emerald-400/35', cta: 'text-emerald-300' },
  amber: { border: 'border-amber-400/15 hover:border-amber-400/35', cta: 'text-amber-300' },
  violet: { border: 'border-violet-400/15 hover:border-violet-400/35', cta: 'text-violet-300' },
  rose: { border: 'border-rose-400/15 hover:border-rose-400/35', cta: 'text-rose-300' },
};

export function SceneDoor({
  scene,
  eyebrow,
  title,
  desc,
  cta,
  tone = 'gold',
  href,
  onClick,
  badge,
  minH = 196,
  className = '',
}: {
  scene: ReactNode;
  eyebrow: string;
  title: string;
  desc: string;
  /** CTA label; omit to hide the action row (a static, non-clickable door). */
  cta?: string;
  tone?: DoorTone;
  /** Navigate on click. Mutually exclusive with onClick; href wins if both given. */
  href?: string;
  onClick?: () => void;
  /** Small chip pinned top-right (e.g. a count or "Live"). */
  badge?: ReactNode;
  minH?: number;
  className?: string;
}) {
  const tint = TONE[tone];
  const inner = (
    <>
      {badge ? <div className="absolute right-4 top-4 z-[3]">{badge}</div> : null}
      <MicroLabel>{eyebrow}</MicroLabel>
      <h3 className="text-lg font-semibold tracking-tight text-ink mt-2.5">{title}</h3>
      <p className="text-sm text-ink/50 leading-relaxed mt-2 mb-5 max-w-[36ch]">{desc}</p>
      {cta ? (
        <span className={`mt-auto inline-flex items-center gap-1.5 text-sm font-medium ${tint.cta}`}>
          {cta}
          <ArrowRight className="w-4 h-4 -translate-x-1 opacity-60 group-hover:translate-x-0 group-hover:opacity-100 transition-all" />
        </span>
      ) : (
        <span className="mt-auto" aria-hidden />
      )}
    </>
  );

  const bodyClass = 'relative z-[2] w-full h-full text-left p-6 md:p-7 sm:pr-40 md:pr-48 flex flex-col';

  return (
    <Card hover spotlight padded={false} className={`group relative overflow-hidden h-full ${tint.border} ${className}`}>
      {href ? (
        <Link href={href} onClick={onClick} className={bodyClass} style={{ minHeight: minH }}>
          {inner}
        </Link>
      ) : (
        <button onClick={onClick} className={bodyClass} style={{ minHeight: minH }}>
          {inner}
        </button>
      )}
      {/* the scene — lives IN the panel, brightening under attention */}
      <div className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 hidden sm:block opacity-70 group-hover:opacity-100 transition-opacity duration-500">
        {scene}
      </div>
    </Card>
  );
}
