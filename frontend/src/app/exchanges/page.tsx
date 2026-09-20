import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import LandingPage from '@/components/landing/LandingPage';
import { MANDOS_LANDING_OPEN } from '@/lib/nav/mandosLanding';

export const metadata: Metadata = {
  title: 'Exchanges — Astryum',
  description: 'Da a tus clientes acceso a DeFi en Flare con tu llave: Astryum prepara, tu exchange firma desde su propio ómnibus, y los límites los impone un contrato.',
};

/** Cerrada en producción hasta que un commit la publique: responde 404. */
export default function Page() {
  if (!MANDOS_LANDING_OPEN) notFound();
  return <LandingPage world="exchange" />;
}
