'use client';

import WalletRoot from './WalletRoot';
import EnvironmentBanner from '../components/layout/EnvironmentBanner';
import NetworkSwitcher from '../components/wallet/NetworkSwitcher';
import MotionApplier from '../components/ui/MotionApplier';

export default function ClientRoot({ children }: { children: React.ReactNode }) {
  return (
    // El nivel de movimiento del usuario envuelve TODA la web (landing, login
    // y dashboard): un ajuste, todas las pantallas. Ver stores/motionStore.ts.
    <MotionApplier>
      <NetworkSwitcher />
      <EnvironmentBanner />
      <WalletRoot>{children}</WalletRoot>
    </MotionApplier>
  );
}
