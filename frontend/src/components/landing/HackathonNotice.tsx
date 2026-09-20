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
    // SECOND PLACE, 2026-08-24. A result, not a claim: it is the kind of fact
    // GLOSSARY.md allows on this page — verifiable at the program link right
    // next to it, and it says nothing about what the product will do for
    // anyone. Kept as data on the one source of truth so the badge appears
    // everywhere the hackathon does and nowhere it does not.
    result: { es: '2.º puesto', en: '2nd place' },
  },
  {
    id: 'xrpl-commons',
    label: 'XRPL Commons · Make Waves',
    short: 'XRPL Commons',
    url: 'https://hackathons.xrpl-commons.org/hackathons/make-waves-041f8ce6',
    logo: '/partners/xrpl-commons-mark.svg', // white variant → dark fields
    logoInk: '/partners/xrpl-commons-mark-ink.svg', // ink variant → cream field
    result: null, // still running
  },
] as const;

function HackathonLink({
  h,
  tone,
  lang,
  size = 14,
  shortBelowMd = false,
}: {
  h: (typeof HACKATHONS)[number];
  tone: 'dark' | 'ink';
  lang: Lang;
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
      {h.result && (
        // Hidden below md when the link is already running in short mode: the
        // banner is a fixed-height strip and every extra nowrap element there
        // is width the smallest phones do not have.
        <span
          className={`${shortBelowMd ? 'hidden md:inline-block' : 'inline-block'} rounded-full px-1.5 py-px font-mono text-[9px] font-semibold uppercase leading-[1.6] tracking-[0.1em]`}
          style={{
            color: tone === 'ink' ? 'hsl(var(--volt-deep))' : 'hsl(var(--volt))',
            border: `1px solid ${tone === 'ink' ? 'rgba(20,18,14,0.25)' : 'hsl(var(--volt) / 0.45)'}`,
          }}
        >
          {T(h.result.es, h.result.en, lang)}
        </span>
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
        <HackathonLink h={HACKATHONS[0]} tone="dark" lang={lang} shortBelowMd />
        <span className="text-white/25" aria-hidden>
          ·
        </span>
        <HackathonLink h={HACKATHONS[1]} tone="dark" lang={lang} shortBelowMd />
      </span>
    </div>
  );
}

// ─── The footer COLUMN (SiteFooter) ───────────────────────────────────────────
// Same disclosure, same two links, stacked — the landing's dark footer files
// them under their own heading (founder 2026-08-22: "lo de los hackathones irá
// abajo del todo"). One source of truth: HACKATHONS above.
export function HackathonFooterList({ lang, tone = 'dark' }: { lang: Lang; tone?: 'dark' | 'ink' }) {
  return (
    <div className="flex flex-col items-start gap-2.5 text-[13px]">
      {HACKATHONS.map((h) => (
        <HackathonLink key={h.id} h={h} tone={tone} lang={lang} size={15} />
      ))}
      <span className="text-[11px]" style={{ color: tone === 'ink' ? 'rgba(20,18,14,0.42)' : 'rgba(255,255,255,0.28)' }}>
        {T('Beta abierta, en concurso', 'Open beta, competing', lang)}
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
      <HackathonLink h={HACKATHONS[0]} tone={tone} lang={lang} size={13} />
      <span style={{ color: labelColor }} aria-hidden>
        ·
      </span>
      <HackathonLink h={HACKATHONS[1]} tone={tone} lang={lang} size={13} />
    </div>
  );
}
