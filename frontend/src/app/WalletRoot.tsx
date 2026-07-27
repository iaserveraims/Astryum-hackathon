'use client';

import { WalletProvider } from '@/components/providers/WalletProvider';
import { WagmiAppKitProvider } from '@/lib/wallet/WagmiAppKitProvider';
import { Providers } from '../providers';
import { Toaster } from 'sonner';

export default function WalletRoot({ children }: { children: React.ReactNode }) {
  // WagmiAppKitProvider wraps everything: wallet partner state must be available
  // to all downstream providers, including the legacy WalletProvider during
  // migration. Cookie-based SSR hydration is read via cookieToInitialState inside.
  return (
    <WagmiAppKitProvider>
      <Providers>
        <WalletProvider>
          <main className="min-h-screen bg-background">
            {children}
          </main>
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: 'var(--background)',
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
              },
            }}
          />
        </WalletProvider>
      </Providers>
    </WagmiAppKitProvider>
  );
}
