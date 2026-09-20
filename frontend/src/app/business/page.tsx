import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import LandingPage from '@/components/landing/LandingPage';
import { MANDOS_LANDING_OPEN } from '@/lib/nav/mandosLanding';

export const metadata: Metadata = {
  title: 'Empresas — Astryum',
  description: 'Un plano de control para el capital de una entidad: posición, liquidez y exposición en una sola lectura. Las llaves siguen siendo de la entidad.',
};

/** Cerrada en producción hasta que un commit la publique: responde 404. */
export default function Page() {
  if (!MANDOS_LANDING_OPEN) notFound();
  return <LandingPage world="business" />;
}
