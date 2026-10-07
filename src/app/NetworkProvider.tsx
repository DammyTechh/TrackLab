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

  useEffect(() => watchNetwork(setState), []);

  // Drain the outbox whenever there is a connection and something waits: on
  // opening the app, on reconnecting, and every 30 s while items remain. It
  // used to run only on a change from offline to online, so an upload that
  // failed while online, or one left queued when the app was closed, was
  // never retried. Failed items back off on their own (sync.ts).
  useEffect(() => {
    if (state === 'offline' || queued === 0) return;
    syncInBackground();
    const timer = setInterval(syncInBackground, 30_000);
    return () => clearInterval(timer);
  }, [state, queued]);

  return <NetworkContext.Provider value={{ state, queued }}>{children}</NetworkContext.Provider>;
}

export const useNetwork = () => useContext(NetworkContext);
