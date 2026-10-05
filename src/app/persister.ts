import { get, set, del } from 'idb-keyval';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

const KEY = `evidencetag-query-${import.meta.env.VITE_INSTITUTION_CODE}`;

/** Query cache survives a reload, so a cold start with no network still shows the lab. */
export function createIdbPersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => set(KEY, client),
    restoreClient: async () => get<PersistedClient>(KEY),
    removeClient: async () => del(KEY),
  };
}
