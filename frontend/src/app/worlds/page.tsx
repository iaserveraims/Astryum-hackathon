import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import LandingPage from '@/components/landing/LandingPage';
import { MANDOS_LANDING_OPEN } from '@/lib/nav/mandosLanding';

export const metadata: Metadata = {
  title: 'Los tres mundos — Astryum',
  description: 'La portada de los tres mundos (Personal · Legacy · Institucional), con su conmutador.',
};

/**
 * LOS TRES MUNDOS, para seguir puliéndolos. La portada del preview pasó a ser
 * la de «a los mandos» (fundador 2026-09-19); el conmutador Personal · Legacy ·
 * Institucional y sus viajes no se borran: viven aquí, fuera de producción,
 * hasta que se decida qué se queda y qué no.
 */
export default function Page() {
  if (!MANDOS_LANDING_OPEN) notFound();
  return <LandingPage world="home" />;
}
