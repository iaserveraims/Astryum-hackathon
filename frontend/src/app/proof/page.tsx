import type { Metadata } from 'next';
import ProofPage from '@/components/landing/ProofPage';

export const metadata: Metadata = {
  title: 'La prueba — Astryum',
  description:
    'No te pedimos confianza: la da el código. El candado criptográfico de cada orden, las direcciones vivas del camino, las operaciones reales y una verificación que corre en tu propio navegador.',
};

export default function Page() {
  return <ProofPage />;
}
