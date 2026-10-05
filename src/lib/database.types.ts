/**
 * Replaced wholesale by `npm run gen:types` once the database is up.
 *
 * Until then the schema is declared permissively so a fresh clone type-checks
 * before anyone has run Supabase. The row shapes the app actually relies on
 * are stated below as plain interfaces and used at the call sites, which is
 * where the typing earns its keep.
 */

export type AppRole = 'technician' | 'lab_hod' | 'senior_leader' | 'admin';

export type EquipmentStatusRow =
  'operational' | 'due_soon' | 'overdue' | 'faulty' | 'maintenance' | 'replace' | 'retired';

export type EventTypeRow =
  'use' | 'fault' | 'maintenance' | 'inspection' | 'service_report' | 'status_change';

export interface EquipmentRow {
  id: string;
  lab_id: string;
  asset_id: string;
  qr_token: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serial_no: string | null;
  specs: Record<string, unknown>;
  location: string | null;
  operating_conditions: string | null;
  photo_path: string | null;
  status: EquipmentStatusRow;
  service_interval_days: number;
  last_service_at: string | null;
  next_service_due: string | null;
  retired_at: string | null;
  label_printed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: string;
  equipment_id: string;
  type: EventTypeRow;
  occurred_at: string;
  data: Record<string, unknown>;
  severity: 'minor' | 'major' | 'critical' | null;
  next_due_date: string | null;
  recorded_by: string;
  corrects_event_id: string | null;
  created_at: string;
  synced_at: string;
}

export interface ProfileRow {
  id: string;
  full_name: string;
  phone: string | null;
  role: AppRole;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
}

export type AlertTier = 'upcoming' | 'warning' | 'critical_due' | 'critical_replacement' | 'critical_fault';

export interface NotificationRow {
  id: string;
  profile_id: string;
  equipment_id: string | null;
  tier: AlertTier;
  title: string;
  body: string;
  dedupe_key: string;
  read_at: string | null;
  closed_at: string | null;
  created_at: string;
}

type AnyRow = Record<string, unknown>;

export interface Database {
  public: {
    Tables: {
      [table: string]: { Row: AnyRow; Insert: AnyRow; Update: AnyRow; Relationships: [] };
    };
    Views: {
      [view: string]: { Row: AnyRow; Relationships: [] };
    };
    Functions: {
      [fn: string]: { Args: AnyRow; Returns: unknown };
    };
    Enums: { [name: string]: string };
    CompositeTypes: { [name: string]: AnyRow };
  };
}
