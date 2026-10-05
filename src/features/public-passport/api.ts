import { supabase } from '@/lib/supabase';
import { db } from '@/offline/db';
import type { EquipmentStatus } from '@/lib/status';

export interface PublicPassport {
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
  lab: { name: string; building: string | null; room: string | null };
  documents: { title: string; kind: string; file_path: string }[];
  history: { type: string; occurred_at: string; severity: string | null; summary: string | null }[];
  /** True when this came from the device cache rather than the server. */
  fromCache: boolean;
}

/**
 * The anon key cannot read a table. Both public reads go through a
 * SECURITY DEFINER function that returns public columns only.
 *
 * If the server is unreachable we fall back to whatever this device already
 * cached. That covers a technician in a basement; it does NOT cover a visitor
 * scanning for the first time, who has nothing cached and will see the
 * offline state.
 */
export async function fetchPassport(qrToken: string): Promise<PublicPassport> {
  const { data, error } = await supabase.rpc('get_public_equipment', { p_qr_token: qrToken });

  if (!error && data) return { ...(data as PublicPassport), fromCache: false };

  const cached = await db.equipment.where('qr_token').equals(qrToken).first();
  if (!cached) throw error ?? new Error('not-found');

  const events = await db.events.where('equipment_id').equals(cached.id).reverse().sortBy('occurred_at');

  return {
    asset_id: cached.asset_id,
    name: cached.name,
    manufacturer: cached.manufacturer,
    model: cached.model,
    serial_no: cached.serial_no,
    location: cached.location,
    operating_conditions: cached.operating_conditions,
    photo_path: cached.photo_path,
    status: cached.status,
    last_service_at: cached.last_service_at,
    next_service_due: cached.next_service_due,
    lab: { name: '', building: null, room: null },
    documents: [],
    history: events.map((e) => ({
      type: e.type,
      occurred_at: e.occurred_at,
      severity: e.severity,
      summary: (e.data.summary as string) ?? null,
    })),
    fromCache: true,
  };
}
