import type { Metadata } from 'next';
import EarlyAccessPage from '@/components/landing/EarlyAccessPage';

export const metadata: Metadata = {
  title: 'Acceso anticipado — Astryum',
  description:
    'Deja tu señal. Astryum abre por oleadas — entra en el manifiesto y recibe el aviso de embarque. No-custodial: tú siempre firmas.',
};

export default function Page() {
  return <EarlyAccessPage />;
}
