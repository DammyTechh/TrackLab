import { supabase } from '@/lib/supabase';
import { db } from '@/offline/db';
import type { EquipmentStatus } from '@/lib/status';

/**
 * The rows every report is built from. RLS decides the scope: a technician or
 * HOD gets their own labs, a senior leader gets all of them. When the server
 * cannot be reached, the equipment reports fall back to the device copy so
 * exports still work offline.
 */

export interface MachineRow {
  id: string;
  asset_id: string;
  name: string;
  lab_id: string;
  lab_name: string;
  location: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_no: string | null;
  status: EquipmentStatus;
  operating_conditions: string | null;
  service_interval_days: number | null;
  last_service_at: string | null;
  next_service_due: string | null;
}

export interface EventRowOut {
  id: string;
  type: string;
  occurred_at: string;
  severity: string | null;
  summary: string;
  recorded_by: string;
  asset_id: string;
  equipment_name: string;
  lab_name: string;
}

export async function loadMachines(labId: string | 'all'): Promise<{ rows: MachineRow[]; fromCache: boolean }> {
  let query = supabase
    .from('equipment')
    .select(
      'id, asset_id, name, lab_id, location, manufacturer, model, serial_no, status, operating_conditions, service_interval_days, last_service_at, next_service_due, lab:labs(name)',
    )
    .order('asset_id');
  if (labId !== 'all') query = query.eq('lab_id', labId);
  const { data, error } = await query;

  if (!error && data) {
    return {
      rows: (data as unknown as (Omit<MachineRow, 'lab_name'> & { lab: { name: string } | null })[]).map(
        ({ lab, ...row }) => ({ ...row, lab_name: lab?.name ?? '' }),
      ),
      fromCache: false,
    };
  }

  const cached = await db.equipment.toArray();
  return {
    rows: cached
      .filter((row) => labId === 'all' || row.lab_id === labId)
      .map((row) => ({ ...row, lab_name: '', service_interval_days: null }))
      .sort((a, b) => a.asset_id.localeCompare(b.asset_id)),
    fromCache: true,
  };
}

export async function loadEvents(
  labId: string | 'all',
  from: string,
  to: string,
  opts: { type?: string; equipmentId?: string } = {},
): Promise<EventRowOut[]> {
  let query = supabase
    .from('events')
    .select(
      'id, type, occurred_at, severity, data, recorder:profiles(full_name), equipment:equipment!inner(id, asset_id, name, lab_id, lab:labs(name))',
    )
    .gte('occurred_at', `${from}T00:00:00`)
    .lte('occurred_at', `${to}T23:59:59`)
    .order('occurred_at', { ascending: false })
    .limit(5000);
  if (labId !== 'all') query = query.eq('equipment.lab_id', labId);
  if (opts.type) query = query.eq('type', opts.type);
  if (opts.equipmentId) query = query.eq('equipment_id', opts.equipmentId);

  const { data, error } = await query;
  if (error) throw error;

  type Raw = {
    id: string;
    type: string;
    occurred_at: string;
    severity: string | null;
    data: Record<string, unknown> | null;
    recorder: { full_name: string } | null;
    equipment: { asset_id: string; name: string; lab: { name: string } | null };
  };
  return (data as unknown as Raw[]).map((e) => ({
    id: e.id,
    type: e.type,
    occurred_at: e.occurred_at,
    severity: e.severity,
    summary: String(e.data?.summary ?? e.data?.purpose ?? ''),
    recorded_by: e.recorder?.full_name ?? '',
    asset_id: e.equipment.asset_id,
    equipment_name: e.equipment.name,
    lab_name: e.equipment.lab?.name ?? '',
  }));
}

/** Trigger a browser download of a generated file. */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
