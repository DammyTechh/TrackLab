import { supabase } from '@/lib/supabase';
import { db, getMeta, setMeta, type CachedEquipment } from './db';
import { markFailed, markSent, pending } from './outbox';
import { probe } from './network';

/**
 * Push first, then pull. Events are append-only and carry device-generated
 * uuids, so two technicians working offline in the same lab merge without a
 * conflict and a retry can never insert twice.
 *
 * Status and next_service_due are NOT sent. The server recomputes them after
 * each event lands; whatever the device thought is discarded.
 */

const LAST_PULL = 'last_pull_at';

export interface SyncResult {
  pushed: number;
  failed: number;
  pulled: number;
}

export async function sync(): Promise<SyncResult> {
  const state = await probe();
  if (state === 'offline') return { pushed: 0, failed: 0, pulled: 0 };

  const result: SyncResult = { pushed: 0, failed: 0, pulled: 0 };

  for (const item of await pending()) {
    try {
      // Files go up first; a row that references a missing object is worse
      // than a file with no row, which the next sweep cleans up.
      for (const file of item.files ?? []) {
        const { error } = await supabase.storage
          .from(file.bucket)
          .upload(file.path, file.blob, { upsert: true, contentType: file.blob.type });
        if (error && !error.message.includes('already exists')) throw error;
      }

      switch (item.kind) {
        case 'event': {
          // `synced` is a device-only flag; it is not a column.
          const { synced: _synced, ...row } = item.payload as Record<string, unknown> & { synced?: boolean };
          const { error } = await supabase
            .from('events')
            .upsert(row, { onConflict: 'id', ignoreDuplicates: true });
          if (error) throw error;

          // The photos were uploaded above but nothing recorded them, so they
          // were invisible to every screen. The attachment id is the file's own
          // uuid, which keeps a retry from inserting the same row twice.
          const photos = (item.files ?? []).filter((file) => file.field === 'photo');
          if (photos.length > 0) {
            const { error: attachError } = await supabase.from('event_attachments').upsert(
              photos.map((file) => ({
                id: fileUuid(file.path),
                event_id: item.id,
                file_path: file.path,
                mime: file.blob.type || 'image/jpeg',
              })),
              { onConflict: 'id', ignoreDuplicates: true },
            );
            if (attachError) throw attachError;
          }
          break;
        }
        case 'service_report': {
          const { error } = await supabase
            .from('service_reports')
            .upsert(item.payload, { onConflict: 'event_id' });
          if (error) throw error;
          break;
        }
        case 'attachment': {
          const { error } = await supabase
            .from('event_attachments')
            .upsert(item.payload, { onConflict: 'id' });
          if (error) throw error;
          break;
        }
        case 'document': {
          // Insert once. The id is the device's own uuid, so a retry after a
          // dropped response finds the row already there and moves on. A
          // document is never updated from here; only withdrawn, online.
          const { error } = await supabase
            .from('equipment_documents')
            .upsert(item.payload, { onConflict: 'id', ignoreDuplicates: true });
          if (error) throw error;
          break;
        }
        case 'equipment_photo': {
          // An UPDATE of one column, never an upsert: an upsert would try to
          // insert a half-empty equipment row first and fail on NOT NULL.
          const { equipment_id, photo_path } = item.payload as { equipment_id: string; photo_path: string };
          const { data, error } = await supabase
            .from('equipment')
            .update({ photo_path })
            .eq('id', equipment_id)
            .select('id');
          if (error) throw error;
          // RLS filters a forbidden update to zero rows rather than raising.
          if (!data || data.length === 0) throw new Error('Not allowed to update this equipment.');
          break;
        }
      }

      await markSent(item.id);
      result.pushed += 1;
    } catch (err) {
      await markFailed(item.id, err instanceof Error ? err.message : String(err));
      result.failed += 1;
    }
  }

  result.pulled = await pull();
  return result;
}

/** Pull everything in the user's labs that changed since the last successful pull. */
async function pull(): Promise<number> {
  const since = (await getMeta<string>(LAST_PULL)) ?? '1970-01-01T00:00:00Z';

  const { data, error } = await supabase
    .from('equipment')
    .select(
      'id, qr_token, lab_id, asset_id, name, manufacturer, model, serial_no, location,' +
        'operating_conditions, photo_path, status, last_service_at, next_service_due, updated_at',
    )
    .gt('updated_at', since)
    .order('updated_at', { ascending: true })
    .limit(1000);

  if (error || !data) return 0;

  const rows: CachedEquipment[] = (data as unknown as (CachedEquipment & { updated_at: string })[]).map(
    (row) => ({ ...row, cached_at: Date.now() }),
  );
  await db.equipment.bulkPut(rows);

  const lastRow = (data as unknown as { updated_at: string }[]).at(-1);
  if (lastRow) await setMeta(LAST_PULL, lastRow.updated_at);
  return rows.length;
}

/** `{equipment}/{event}/{uuid}.jpg` -> `{uuid}` */
function fileUuid(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '');
}

/** Fire-and-forget: called when the network comes back and after each save. */
export function syncInBackground(): void {
  void sync().catch(() => {
    /* the next sweep will try again */
  });
}
