import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { watchNetwork, type NetworkState } from '@/offline/network';
import { syncInBackground } from '@/offline/sync';
import { db } from '@/offline/db';

interface NetworkContextValue {
  state: NetworkState;
  queued: number;
}

const NetworkContext = createContext<NetworkContextValue>({ state: 'online', queued: 0 });

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NetworkState>('online');
  const queued = useLiveQuery(() => db.outbox.count(), [], 0) ?? 0;

  useEffect(
    () =>
      watchNetwork((next) => {
        setState((previous) => {
          // Coming back from nothing is the moment to drain the outbox.
          if (previous === 'offline' && next !== 'offline') syncInBackground();
          return next;
        });
      }),
    [],
  );

  return <NetworkContext.Provider value={{ state, queued }}>{children}</NetworkContext.Provider>;
}

export const useNetwork = () => useContext(NetworkContext);
