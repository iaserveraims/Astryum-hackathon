'use client';

/**
 * SubpageShell — the frame every standalone marketing page shares (founder
 * 2026-07-25: real /about and /what-we-offer pages linked from the landing
 * header). Same sky as the landing: deep space, the starfield canvas with its
 * falling stars, a slim floating header (logo home, the two page links, the
 * language toggle and the gold door) and the compact footer. Pages drop their
 * content in as children and stay coherent by construction.
 */

import { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import StarfieldCanvas from './StarfieldCanvas';
import { BORDER, GOLD } from './interactions';
import { T, useLang, type Lang } from './useLang';
import { HackathonFooterNote } from './HackathonNotice';

const LOGO_MARK = '/astryum-asteroid.png';
const EARLY_ACCESS_URL = '/early-access';

const PAGES: Array<{ href: string; es: string; en: string }> = [
  { href: '/what-we-offer', es: 'Qué ofrecemos', en: 'What we offer' },
  { href: '/about', es: 'Quiénes somos', en: 'About us' },
];

export default function SubpageShell({
  children,
}: {
  children: (lang: Lang) => ReactNode;
}) {
  const [lang, setLang] = useLang();
  const pathname = usePathname();
  const es = lang === 'es';

  return (
    <div className="relative min-h-screen bg-[#070605] text-white overflow-x-hidden">
      {/* the same sky the landing breathes under */}
      <div className="fixed inset-0 z-0" aria-hidden>
        <StarfieldCanvas />
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(120% 90% at 50% 0%, rgba(201,162,39,0.06), transparent 60%)' }}
        />
      </div>

      {/* slim floating header */}
      <header className="fixed top-0 inset-x-0 z-40">
        <div
          className="mx-auto flex items-center justify-between gap-4"
          style={{
            maxWidth: 1120,
            margin: '12px auto',
            padding: '8px 14px 8px 18px',
            borderRadius: 16,
            background: 'rgba(12,11,9,0.72)',
            border: `1px solid rgba(255,255,255,0.09)`,
            backdropFilter: 'blur(16px)',
            width: 'calc(100% - 32px)',
          }}
        >
          <Link href="/" className="shrink-0 flex items-center" aria-label="Astryum">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_MARK} alt="Astryum" style={{ height: 44, width: 'auto', display: 'block' }} />
          </Link>

          <nav className="hidden md:flex items-center gap-0.5">
            <Link
              href="/"
              className="px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors hover:text-white"
              style={{ color: 'rgba(255,255,255,0.55)' }}
            >
              {T('Inicio', 'Home', lang)}
            </Link>
            {PAGES.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                className="px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors hover:text-white"
                style={{ color: pathname === p.href ? GOLD : 'rgba(255,255,255,0.55)' }}
                aria-current={pathname === p.href ? 'page' : undefined}
              >
                {es ? p.es : p.en}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <div
              className="inline-flex items-center gap-0.5 p-0.5 rounded-full"
              style={{ border: `1px solid ${BORDER}` }}
              role="group"
              aria-label={T('Idioma', 'Language', lang)}
            >
              {(['es', 'en'] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  aria-pressed={lang === l}
                  className="px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase transition-colors"
                  style={lang === l ? { background: GOLD, color: '#000' } : { color: 'rgba(255,255,255,0.45)' }}
                >
                  {l}
                </button>
              ))}
            </div>
            <a
              href={EARLY_ACCESS_URL}
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-semibold text-black"
              style={{ background: GOLD, boxShadow: '0 6px 22px hsl(var(--volt) / 0.22)' }}
            >
              {es ? 'Acceso anticipado' : 'Early access'}
            </a>
          </div>
        </div>
      </header>

      <main className="relative z-10">{children(lang)}</main>

      <footer className="relative z-10 border-t px-6 py-8" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <HackathonFooterNote lang={lang} tone="dark" />
          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <span className="text-xs text-white/35">
              {es ? 'No-custodial · Siempre tú firmas' : 'Non-custodial · You always sign'}
            </span>
            <span className="text-xs text-white/20">Astryum © 2026</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
