/**
 * ecosystem — ONE color identity per crypto ecosystem (founder 2026-07-30):
 * the color IS the arrow. Anywhere the user picks a direction for their
 * capital, XRPL reads BLUE (Xaman / XRP) and Flare reads ROSE (Flare's
 * brand coral), so the destination is understood before a single word is
 * read. Presentation only — never routing logic.
 */

export type Ecosystem = 'xrpl' | 'flare';

const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;

export function ecosystemOf(address: string): Ecosystem | null {
  const a = String(address ?? '').trim();
  if (XRPL_RE.test(a)) return 'xrpl';
  if (EVM_RE.test(a)) return 'flare';
  return null;
}

export interface EcosystemAccent {
  /** Row/toggle border+bg when SELECTED. */
  selected: string;
  /** Row/toggle border when idle (subtle tint so the identity reads at rest). */
  idle: string;
  /** The small identity dot. */
  dot: string;
  /** Accent text (labels/hints that should carry the identity). */
  text: string;
}

export const ECOSYSTEM_ACCENT: Record<Ecosystem, EcosystemAccent> = {
  xrpl: {
    selected: 'border-sky-400/60 bg-sky-400/10',
    idle: 'border-sky-400/20 bg-ink/5 hover:bg-sky-400/5',
    dot: 'bg-sky-400',
    text: 'text-sky-300',
  },
  flare: {
    selected: 'border-rose-400/60 bg-rose-400/10',
    idle: 'border-rose-400/20 bg-ink/5 hover:bg-rose-400/5',
    dot: 'bg-rose-400',
    text: 'text-rose-300',
  },
};
