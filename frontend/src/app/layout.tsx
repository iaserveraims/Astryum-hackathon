export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import ClientRoot from './ClientRoot';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Analytics } from '@vercel/analytics/react';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  // Canonical PUBLIC domain for social cards. Hardcoded on purpose: NEXT_PUBLIC_APP_URL
  // points at the SSO-protected internal domain (defibro.xyz), so og:image must NOT use
  // it — a crawler would fetch the image from there and hit Vercel's login page instead
  // of the PNG. astryum.xyz is the public domain the landing is shared from.
  metadataBase: new URL('https://astryum.xyz'),
  title: 'Astryum — Financial Control. Total Clarity.',
  description:
    'Tu capital. Tu control. Tu firma. Astryum es tu sistema de navegación para todo tu capital cripto — multichain, no-custodial, nadie firma por ti. Construido sobre Flare y XRPL. / Your capital. Your control. Your signature. Astryum is your navigation system for all your crypto capital — multichain, non-custodial, no one signs but you. Built on Flare and XRPL.',
  keywords:
    'Astryum, Flare, FXRP, FLR, XRPL, FAssets, financial control, non-custodial finance, DeFi portfolio, vaults, stablecoin yield, self-custody, capital map, risk radar',
  authors: [{ name: 'Astryum' }],
  creator: 'Astryum',
  // Favicon/apple icon come from the app/icon.png + app/apple-icon.png file
  // convention (square crops of the real glowing-asteroid mark) — Next injects
  // the <link> tags; no explicit icons entry needed here.
  openGraph: {
    url: 'https://astryum.xyz',
    siteName: 'Astryum',
    title: 'Astryum — Your capital. Your control. Your signature.',
    description:
      'Your navigation system for all your crypto capital. Multichain, non-custodial, no one signs but you. Built on Flare and XRPL — FXRP & FLR strategies on mainnet, conditions in plain sight.',
    images: [
      {
        // ?v=2 busts crawler-side image caches (Discord/WhatsApp key on the image
        // URL) left over from when the card pointed at the white logo asset.
        url: '/astryum-og.png?v=2',
        width: 1200,
        height: 630,
        alt: 'Astryum — Financial Control. Total Clarity.',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Astryum — Financial Control. Total Clarity.',
    description:
      'Your capital. Your control. Your signature. Multichain, non-custodial — no one signs but you. Built on Flare and XRPL.',
    images: ['/astryum-og.png?v=2'],
  },
};

export const viewport = {
  // Match the page field, not the accent: mobile Safari/Chrome tint the
  // browser chrome with this, and a saturated gold bar over the near-black
  // landing read as a glitch on phones.
  themeColor: '#080808',
};

/**
 * Vercel telemetry — two SEPARATE switches, each honest with /privacy.
 *
 * 2026-08-01 (audit): both were mounted unconditionally while the notice
 * promised "sin telemetría externa" — a false statement on a legal surface.
 * Gated off behind one flag; visits data stopped that day.
 *
 * 2026-08-11 (founder: "necesitamos saber si el trabajo en X funciona"):
 * Web Analytics is DECLARED and may be switched on — notice v2026-08-11
 * rewrote §2 (visit metrics), §3 (basis 6.1.f), §4 (Vercel Inc. recipient),
 * §5 (US transfer, DPF + SCC) and §10 (the "cero analítica" claim), and
 * PRIVACY_NOTICE_VERSION was bumped so the gate re-presents the notice (the
 * §11 "announced in the app" promise). Cookieless, aggregated, daily-rotating
 * hash — no consent banner needed, but honesty in the notice is mandatory.
 *
 * SpeedInsights stays UNDECLARED: its flag exists but the notice does not
 * cover it. Setting NEXT_PUBLIC_ENABLE_SPEED_INSIGHTS without amending
 * /privacy (§4, §5, §10) in the same commit makes the notice lie again — the
 * exact 2026-08-01 failure. Do not.
 */
const ANALYTICS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === 'true';
const SPEED_INSIGHTS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_SPEED_INSIGHTS === 'true';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head />
      <body className={`${inter.variable} ${jetbrainsMono.variable} ${inter.className} antialiased`}>
        <ClientRoot>{children}</ClientRoot>
        {ANALYTICS_ENABLED && <Analytics />}
        {SPEED_INSIGHTS_ENABLED && <SpeedInsights />}
      </body>
    </html>
  );
}
