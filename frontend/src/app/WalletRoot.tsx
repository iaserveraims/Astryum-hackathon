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
            // Por encima de TODO el sistema de operaciones (overlay flotante
            // z-50, píldoras z-60): el aviso de «ya hay tres» nace justamente
            // con una card abierta delante.
            style={{ zIndex: 2147483000 }}
            toastOptions={{
              duration: 4000,
              style: {
                // Los tokens de la casa son tripletas HSL crudas — a pelo
                // (`var(--background)`) eran CSS inválido y el toast quedaba
                // TRANSPARENTE, fundiéndose con lo que tuviera detrás.
                background: 'hsl(var(--surface-2))',
                color: 'hsl(var(--ink))',
                border: '1px solid hsl(var(--ink) / 0.18)',
                borderRadius: '12px',
                boxShadow: '0 18px 50px -12px rgba(0, 0, 0, 0.55)',
              },
              classNames: {
                title: 'text-[13px] font-semibold',
                description: '!text-ink/65',
              },
            }}
          />
        </WalletProvider>
      </Providers>
    </WagmiAppKitProvider>
  );
}
