import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import LandingPage from '@/components/landing/LandingPage';
import { MANDOS_LANDING_OPEN } from '@/lib/nav/mandosLanding';

export const metadata: Metadata = {
  title: 'Autocustodia — Astryum',
  description: 'Tu capital, tu control, tu firma. Un solo puesto de mando para tu XRP en XRPL y Flare, y dentro de tu wallet, las cuentas que necesites.',
};

/** Cerrada en producción hasta que un commit la publique: responde 404. */
export default function Page() {
  if (!MANDOS_LANDING_OPEN) notFound();
  return <LandingPage world="self" />;
}
