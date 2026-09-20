import type { Metadata } from 'next';
import DocsPage from '@/components/landing/DocsPage';

export const metadata: Metadata = {
  title: 'Documentación — Astryum',
  description:
    'Todo lo que publicamos sobre Astryum, en un sitio: el pitch deck y los decks de Legacy, Managed vaults y Exchange, legibles diapositiva a diapositiva y descargables en PDF.',
};

export default function Page() {
  return <DocsPage />;
}
