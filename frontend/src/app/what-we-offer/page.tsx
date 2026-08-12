import type { Metadata } from 'next';
import WhatWeOfferPage from '@/components/landing/WhatWeOfferPage';

export const metadata: Metadata = {
  title: 'Qué ofrecemos — Astryum',
  description:
    'El puesto de mando de Astryum en detalle: mapa de capital multichain, acciones preparadas sin firmar, protecciones deterministas, Earn con datos de protocolo, Legacy con consejo y la frontera de seguridad.',
};

export default function Page() {
  return <WhatWeOfferPage />;
}
