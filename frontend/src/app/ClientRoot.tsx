'use client';

import WalletRoot from './WalletRoot';
import EnvironmentBanner from '../components/layout/EnvironmentBanner';
import NetworkSwitcher from '../components/wallet/NetworkSwitcher';

export default function ClientRoot({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NetworkSwitcher />
      <EnvironmentBanner />
      <WalletRoot>{children}</WalletRoot>
    </>
  );
}
