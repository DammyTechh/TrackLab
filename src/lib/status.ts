/**
 * The single source of truth for how a status is named, drawn and ranked.
 *
 * Four colours only. `signal` says how urgent; `icon` and `label` say which
 * kind. That is what lets Overdue, Faulty and Replacement recommended share
 * one rust without ever being confused for each other, and what keeps the
 * whole set legible in greyscale and for red-green colour blindness.
 *
 * The keys match the `equipment_status` enum in 0001_schema.sql and the
 * `.status-*` classes. Adding a status means changing three places on
 * purpose.
 */

export const STATUSES = [
  'operational',
  'due_soon',
  'overdue',
  'faulty',
  'maintenance',
  'replace',
  'retired',
] as const;

export type EquipmentStatus = (typeof STATUSES)[number];

export type Signal = 'brand' | 'calm' | 'attention' | 'urgent';

export interface StatusMeta {
  label: string;
  icon: string;
  signal: Signal;
  /** Solid fill means somebody must act today. Tint means it is information. */
  solid: boolean;
  /** Higher wins when several could apply. */
  rank: number;
}

export const STATUS: Record<EquipmentStatus, StatusMeta> = {
  retired: { label: 'Retired', icon: 'inventory_2', signal: 'calm', solid: false, rank: 70 },
  faulty: { label: 'Faulty', icon: 'error', signal: 'urgent', solid: true, rank: 60 },
  replace: { label: 'Replacement recommended', icon: 'swap_horiz', signal: 'urgent', solid: true, rank: 50 },
  maintenance: { label: 'Under maintenance', icon: 'build', signal: 'calm', solid: false, rank: 40 },
  overdue: { label: 'Overdue', icon: 'event_busy', signal: 'urgent', solid: true, rank: 30 },
  due_soon: { label: 'Due soon', icon: 'schedule', signal: 'attention', solid: false, rank: 20 },
  operational: { label: 'Operational', icon: 'check_circle', signal: 'brand', solid: false, rank: 10 },
};

const TINT: Record<Signal, string> = {
  brand: 'bg-brand-surface text-brand',
  calm: 'bg-calm-tint text-calm-ink',
  attention: 'bg-attention-tint text-attention-ink',
  urgent: 'bg-urgent-tint text-urgent-ink',
};

const SOLID: Record<Signal, string> = {
  brand: 'bg-brand text-ink-ondark',
  calm: 'bg-calm-ink text-ink-ondark',
  attention: 'bg-attention-ink text-ink-ondark',
  urgent: 'bg-urgent-ink text-ink-ondark',
};

export function statusClasses(status: EquipmentStatus): string {
  const meta = STATUS[status];
  return meta.solid ? SOLID[meta.signal] : TINT[meta.signal];
}

/** What the line under the sticker says. Never relative-only: a record needs the date. */
export function serviceLine(
  status: EquipmentStatus,
  nextDue: string | null,
  lastService: string | null,
  formatDate: (d: string) => string,
): string {
  const parts: string[] = [];
  if (lastService) parts.push(`Serviced ${formatDate(lastService)}`);
  if (nextDue) {
    parts.push(status === 'overdue' ? `was due ${formatDate(nextDue)}` : `due ${formatDate(nextDue)}`);
  }
  return parts.join(' · ');
}

export const EVENT_ICON = {
  use: 'play_circle',
  fault: 'report',
  maintenance: 'build',
  inspection: 'fact_check',
  service_report: 'engineering',
  status_change: 'sync_alt',
} as const;

export const EVENT_LABEL = {
  use: 'Use logged',
  fault: 'Fault reported',
  maintenance: 'Maintenance recorded',
  inspection: 'Inspection recorded',
  service_report: 'External service report',
  status_change: 'Status changed',
} as const;
