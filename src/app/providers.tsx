import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { AuthProvider } from './AuthProvider';
import { NetworkProvider } from './NetworkProvider';
import { applyBranding } from '@/lib/institution';
import { createIdbPersister } from './persister';

/**
 * Offline-first query defaults: serve from cache immediately, revalidate when
 * a network appears, never throw a screen away because a request failed.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst',
      staleTime: 5 * 60_000,
      gcTime: 7 * 24 * 60 * 60_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
    mutations: { networkMode: 'offlineFirst' },
  },
});

export function Providers({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    applyBranding();
    setReady(true);
  }, []);

  if (!ready) return null;

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister: createIdbPersister() }}>
      <NetworkProvider>
        <AuthProvider>{children}</AuthProvider>
      </NetworkProvider>
    </PersistQueryClientProvider>
  );
}
