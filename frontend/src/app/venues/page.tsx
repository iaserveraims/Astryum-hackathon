import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import LandingPage from '@/components/landing/LandingPage';
import { MANDOS_LANDING_OPEN } from '@/lib/nav/mandosLanding';

export const metadata: Metadata = {
  title: 'Venues — Astryum',
  description: 'Tu protocolo como destino: cómo se entra en el catálogo, qué se mide, qué no puedes tocar, y cómo pedir la verificación.',
};

/** Cerrada en producción hasta que un commit la publique: responde 404. */
export default function Page() {
  if (!MANDOS_LANDING_OPEN) notFound();
  return <LandingPage world="venue" />;
}
