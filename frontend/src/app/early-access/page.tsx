import type { Metadata } from 'next';
import EarlyAccessPage from '@/components/landing/EarlyAccessPage';

export const metadata: Metadata = {
  title: 'Astryum — Early access',
  description:
    'Leave your signal. Astryum opens in waves — join the crew manifest and get the boarding call. Non-custodial: you always sign.',
};

export default function Page() {
  return <EarlyAccessPage />;
}
