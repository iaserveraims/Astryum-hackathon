'use client';

/**
 * WagmiAppKitProvider
 *
 * Root provider that wires wagmi v2 + AppKit into the React tree.
 *
 * Layer order:
 *   <WagmiProvider>            ← chain + connector state via wagmi
 *     <QueryClientProvider>    ← TanStack Query for wagmi internal queries
 *       {AppKit modal init}    ← wallet partner UI singleton
 *       {children}             ← app
 *
 * IMPORTANT: AppKit is initialized inside this provider so the modal singleton
 * is bound to the same wagmi config the hooks read from.
 */

import { ReactNode, useEffect, useMemo } from 'react';
import { WagmiProvider, cookieToInitialState } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from './config';
import { getAppKitModal } from './appkit';

interface WagmiAppKitProviderProps {
  children: ReactNode;
  /**
   * Optional SSR cookie passed from the server layout so wallet state can
   * hydrate without a flash. In the App Router, read `headers().get('cookie')`
   * in a server component and forward it here.
   */
  cookie?: string | null;
}

export function WagmiAppKitProvider({ children, cookie }: WagmiAppKitProviderProps) {
  // wagmi has its own query client requirement (separate from the app-wide one)
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
    [],
  );

  const initialState = cookieToInitialState(wagmiConfig, cookie ?? null);

  // Initialize AppKit modal once on the client.
  // getAppKitModal is idempotent, so re-renders are a no-op.
  useEffect(() => {
    getAppKitModal();
  }, []);

  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
