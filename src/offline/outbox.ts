import { db, type OutboxItem, type OutboxKind, type CachedEvent } from './db';

/**
 * Queue a write. The caller gets back immediately and the interface shows the
 * entry as saved, because on the device it is. Nothing here blocks on a
 * network, and nothing is ever shown as a spinner over a record.
 */
export async function enqueue(
  kind: OutboxKind,
  id: string,
  payload: Record<string, unknown>,
  files?: OutboxItem['files'],
): Promise<void> {
  await db.outbox.put({ id, kind, payload, files, created_at: Date.now(), attempts: 0 });
}

/** An event goes into the outbox AND straight into the local history, unsynced. */
export async function enqueueEvent(event: CachedEvent, files?: OutboxItem['files']): Promise<void> {
  await db.transaction('rw', db.outbox, db.events, async () => {
    await db.events.put({ ...event, synced: false });
    await enqueue('event', event.id, event as unknown as Record<string, unknown>, files);
  });
}

export async function pending(): Promise<OutboxItem[]> {
  return db.outbox.orderBy('created_at').toArray();
}


export async function markSent(id: string): Promise<void> {
  await db.transaction('rw', db.outbox, db.events, async () => {
    await db.outbox.delete(id);
    const existing = await db.events.get(id);
    if (existing) await db.events.put({ ...existing, synced: true });
  });
}

export async function markFailed(id: string, error: string): Promise<void> {
  const item = await db.outbox.get(id);
  if (!item) return;
  await db.outbox.put({ ...item, attempts: item.attempts + 1, last_error: error });
}
