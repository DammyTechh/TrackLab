import Dexie, { type Table } from 'dexie';
import type { EquipmentStatus } from '@/lib/status';

/**
 * The on-device copy. Two jobs:
 *   1. let a technician read their lab with no network at all
 *   2. hold writes until a network returns
 *
 * Note the honest limit: this only helps a device that has opened the app
 * before. A visitor scanning a label for the first time still needs the
 * server to be reachable.
 */

export interface CachedEquipment {
  id: string;
  qr_token: string;
  lab_id: string;
  asset_id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serial_no: string | null;
  location: string | null;
  operating_conditions: string | null;
  photo_path: string | null;
  status: EquipmentStatus;
  last_service_at: string | null;
  next_service_due: string | null;
  cached_at: number;
}

export interface CachedEvent {
  id: string;
  equipment_id: string;
  type: string;
  occurred_at: string;
  data: Record<string, unknown>;
  severity: string | null;
  /** Maintenance and service reports may set the next due date explicitly. */
  next_due_date?: string;
  recorded_by: string;
  /** false until the server has acknowledged it. Drives the pending glyph. */
  synced: boolean;
}

export type OutboxKind = 'event' | 'service_report' | 'attachment' | 'equipment_photo' | 'document';

export interface OutboxItem {
  /** Same uuid as the row it will become, so a retry can never double-insert. */
  id: string;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  /** Photos ride along as blobs; they are compressed before they get here. */
  files?: { field: string; bucket: string; path: string; blob: Blob }[];
  created_at: number;
  attempts: number;
  last_error?: string;
}

class EvidenceTagDb extends Dexie {
  equipment!: Table<CachedEquipment, string>;
  events!: Table<CachedEvent, string>;
  outbox!: Table<OutboxItem, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super(`evidencetag-${import.meta.env.VITE_INSTITUTION_CODE}`);
    this.version(1).stores({
      equipment: 'id, qr_token, lab_id, status, next_service_due',
      events: 'id, equipment_id, occurred_at, synced',
      outbox: 'id, kind, created_at',
      meta: 'key',
    });
  }
}

export const db = new EvidenceTagDb();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
