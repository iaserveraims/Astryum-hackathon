'use client';

/**
 * HackathonNotice — the public disclosure that Astryum is a hackathon build
 * (founder 2026-07-26: "es muy importante avisar a los visitors").
 *
 * Two pieces, one source of truth (HACKATHONS):
 *  - HackathonBanner: a slim PERSISTENT strip fixed above the landing header.
 *    Not dismissible on purpose — it is a disclosure, not a promo. The fixed
 *    headers below it shift down by BANNER_H.
 *  - HackathonFooterNote: the same disclosure + logos for every landing footer.
 *    tone='dark' for star-field footers, tone='ink' for the Home's cream close.
 *
 * Logos live in /public/partners/ (official marks: Flare pink reads on both
 * tones; the XRPL Commons mark ships in white + ink variants). Links go to the
 * official program pages. Copy follows frontend/copy/GLOSSARY.md: sober, no
 * claims — it states a verifiable fact, the same one /about already makes
 * ("se construye a la vista").
 */

import { T, type Lang } from './useLang';

export const BANNER_H = 36;

const HACKATHONS = [
  {
    id: 'flare',
    label: 'Flare Summer Signal',
    // The banner is a fixed-height strip: below md the full labels' min-content
    // (~420px, everything is nowrap) exceeds every phone width and the excess
    // was CLIPPED on both sides with no way to scroll to it. The short label
    // keeps the disclosure legible at 320px; the program page has the rest.
    short: 'Flare',
    url: 'https://dorahacks.io/hackathon/flaresummersignal/detail',
    logo: '/partners/flare.svg', // pink mark — reads on dark and on cream
    logoInk: '/partners/flare.svg',
  },
  {
    id: 'xrpl-commons',
    label: 'XRPL Commons · Make Waves',
    short: 'XRPL Commons',
    url: 'https://hackathons.xrpl-commons.org/hackathons/make-waves-041f8ce6',
    logo: '/partners/xrpl-commons-mark.svg', // white variant → dark fields
    logoInk: '/partners/xrpl-commons-mark-ink.svg', // ink variant → cream field
  },
] as const;

function HackathonLink({
  h,
  tone,
  size = 14,
  shortBelowMd = false,
}: {
  h: (typeof HACKATHONS)[number];
  tone: 'dark' | 'ink';
  size?: number;
  shortBelowMd?: boolean;
}) {
  const color = tone === 'ink' ? 'rgba(20,18,14,0.78)' : 'rgba(255,255,255,0.78)';
  return (
    <a
      href={h.url}
      target="_blank"
      rel="noopener noreferrer"
      // py-1 -my-1 grows the tap target without growing the strip
      className="inline-flex items-center gap-1.5 py-1 -my-1 whitespace-nowrap transition-opacity hover:opacity-70"
      style={{ color }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={tone === 'ink' ? h.logoInk : h.logo}
        alt={h.id === 'flare' ? 'Flare' : 'XRPL Commons'}
        style={{ height: size, width: 'auto', display: 'block' }}
      />
      {shortBelowMd ? (
        <>
          <span className="md:hidden font-semibold">{h.short}</span>
          <span className="hidden md:inline font-semibold">{h.label}</span>
        </>
      ) : (
        <span className="font-semibold">{h.label}</span>
      )}
    </a>
  );
}

// ─── The strip above the header (Home) ────────────────────────────────────────
export function HackathonBanner({ lang }: { lang: Lang }) {
  return (
    <div
      className="fixed top-0 inset-x-0 z-50 flex items-center justify-center gap-x-3 gap-y-0 px-3"
      style={{
        height: BANNER_H,
        background: 'rgba(8,8,8,0.88)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <span className="hidden md:inline font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">
        {/* "Beta abierta", not "proyecto" — founder 2026-07-29, same voice as
            the footer note below. */}
        {T('Beta abierta para los hackathons · en concurso:', 'Open hackathon beta · competing in:', lang)}
      </span>
      <span className="md:hidden font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">
        {T('Hackathon:', 'Hackathon:', lang)}
      </span>
      <span className="flex items-center gap-2 md:gap-3 text-[11px] md:text-[12px]">
        <HackathonLink h={HACKATHONS[0]} tone="dark" shortBelowMd />
        <span className="text-white/25" aria-hidden>
          ·
        </span>
        <HackathonLink h={HACKATHONS[1]} tone="dark" shortBelowMd />
      </span>
    </div>
  );
}

// ─── The footer line (every landing footer) ───────────────────────────────────
export function HackathonFooterNote({ lang, tone = 'dark' }: { lang: Lang; tone?: 'dark' | 'ink' }) {
  const labelColor = tone === 'ink' ? 'rgba(20,18,14,0.5)' : 'rgba(255,255,255,0.35)';
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[11px]">
      <span style={{ color: labelColor }}>
        {/* "Beta abierta", not "producto creado" — founder 2026-07-29: the build
            is live and usable, not a one-off hackathon artifact. */}
        {T('Beta abierta para los hackathons:', 'Open beta for the hackathons:', lang)}
      </span>
      <HackathonLink h={HACKATHONS[0]} tone={tone} size={13} />
      <span style={{ color: labelColor }} aria-hidden>
        ·
      </span>
      <HackathonLink h={HACKATHONS[1]} tone={tone} size={13} />
    </div>
  );
}
