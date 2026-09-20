import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import LandingPage from '@/components/landing/LandingPage';
import { MANDOS_LANDING_OPEN } from '@/lib/nav/mandosLanding';

export const metadata: Metadata = {
  title: 'Agentes — Astryum',
  description: 'Un agente opera; el contrato decide lo que no puede. Quien gobierna una cuenta podrá designar a un agente para un único pote, dentro de límites que firma una vez.',
};

/** Cerrada en producción hasta que un commit la publique: responde 404. */
export default function Page() {
  if (!MANDOS_LANDING_OPEN) notFound();
  return <LandingPage world="agent" />;
}
