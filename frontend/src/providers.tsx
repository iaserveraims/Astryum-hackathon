"use client";

import React, { useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import StepUpModalHost from './components/security/StepUpModalHost';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  // Lazily load Devtools on client only to avoid SSR context issues
  const ReactQueryDevtools = useMemo(
    () => dynamic(() => import('@tanstack/react-query-devtools').then(m => m.ReactQueryDevtools), { ssr: false }),
    []
  );
  return (
    <QueryClientProvider client={queryClient}>
      {/* Keep Devtools directly under QueryClientProvider to ensure context */}
      {process.env.NODE_ENV === 'development' && (
        // Pass client explicitly to avoid context mismatch in monorepos
        <ReactQueryDevtools client={queryClient} initialIsOpen={false} />
      )}
      {children}
      <StepUpModalHost />
    </QueryClientProvider>
  );
}
