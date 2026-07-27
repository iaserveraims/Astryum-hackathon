import type { Metadata } from 'next';
import AboutPage from '@/components/landing/AboutPage';

export const metadata: Metadata = {
  title: 'Quiénes somos — Astryum',
  description:
    'La página de confianza de Astryum: por qué no podemos quedarnos con tu dinero (arquitectura no-custodial), una posición regulatoria estricta por diseño (estructurados para no ser un CASP, partners licenciados bajo MiCA), y el equipo real que lo construye — usuarios de esto, con una sola app en mente.',
};

export default function Page() {
  return <AboutPage />;
}
