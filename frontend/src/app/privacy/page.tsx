import type { Metadata } from 'next';
import PrivacyPage from '@/components/landing/PrivacyPage';

/**
 * /privacy — the privacy notice as a living page.
 *
 * robots noindex (founder decision 2026-07-30): the page holds the holder's
 * name and tax id — the law requires it VISIBLE to anyone who visits (and it
 * is, linked from the footer of every landing surface, from the sign-up form
 * and from the acceptance gate), not that it feeds search engines. Common,
 * defensible practice for legal pages of natural-person operators.
 *
 * 2026-08-01: the "and from the sign-up form" half of that sentence used to be
 * false — the sign-up notice linked /demo-terms only. Fixed there rather than
 * softened here: the collection point is exactly where art. 13 wants the link.
 */
export const metadata: Metadata = {
  title: 'Aviso de privacidad — Astryum',
  description:
    'Qué datos trata Astryum, con qué base jurídica, quién los recibe, qué hacen imborrable las cadenas públicas y cómo ejercer tus derechos.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <PrivacyPage />;
}
