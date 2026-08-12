import type { Metadata } from 'next';
import DemoTermsPage from '@/components/landing/DemoTermsPage';

export const metadata: Metadata = {
  title: 'Aviso de riesgos de la demo — Astryum',
  description:
    'Qué es la fase de demo de Astryum, qué riesgos tiene y cómo se construye cada transacción: transacciones sin firmar, simulación previa, topes por operación y comprobantes verificables on-chain.',
};

export default function Page() {
  return <DemoTermsPage />;
}
