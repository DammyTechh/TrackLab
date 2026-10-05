import { formatDate, formatDateTime, daysUntil } from '@/lib/dates';
import { institution } from '@/lib/institution';
import { EVENT_LABEL, STATUS, type EquipmentStatus } from '@/lib/status';
import type { EventRowOut, MachineRow } from './data';

/**
 * Generated in the browser, so exports work offline from cached data.
 * Status and event types are written as their human labels, never as enum
 * keys — these files end up in committee papers. ExcelJS is loaded on demand.
 */

interface Column<T> {
  header: string;
  width: number;
  value: (row: T) => string | number;
}

async function sheet<T>(title: string, subtitle: string, columns: Column<T>[], rows: T[]): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = institution.productName;
  workbook.created = new Date();

  const ws = workbook.addWorksheet(title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.columns = columns.map((c) => ({ width: c.width }));

  ws.getCell('A1').value = `${institution.name} · ${institution.productName}`;
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A2').value = `${title} — ${subtitle}`;
  ws.getCell('A2').font = { size: 11 };

  const header = ws.getRow(4);
  columns.forEach((c, i) => (header.getCell(i + 1).value = c.header));
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9ECE6' } };

  for (const row of rows) ws.addRow(columns.map((c) => c.value(row)));
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const d = (v: string | null) => (v ? formatDate(v) : '');
const statusLabel = (s: EquipmentStatus) => STATUS[s]?.label ?? s;
const eventLabel = (t: string) => EVENT_LABEL[t as keyof typeof EVENT_LABEL] ?? t;

export function exportRegister(rows: MachineRow[], scope: string): Promise<Blob> {
  return sheet('Equipment register', scope, [
    { header: 'Asset ID', width: 20, value: (r) => r.asset_id },
    { header: 'Equipment', width: 34, value: (r) => r.name },
    { header: 'Laboratory', width: 22, value: (r) => r.lab_name },
    { header: 'Location', width: 18, value: (r) => r.location ?? '' },
    { header: 'Manufacturer', width: 18, value: (r) => r.manufacturer ?? '' },
    { header: 'Model', width: 16, value: (r) => r.model ?? '' },
    { header: 'Serial number', width: 20, value: (r) => r.serial_no ?? '' },
    { header: 'Status', width: 26, value: (r) => statusLabel(r.status) },
    { header: 'Last serviced', width: 16, value: (r) => d(r.last_service_at) },
    { header: 'Next service due', width: 18, value: (r) => d(r.next_service_due) },
  ], rows);
}

export function exportSchedule(rows: MachineRow[], scope: string): Promise<Blob> {
  const due = rows
    .filter((r) => r.next_service_due && r.status !== 'retired')
    .sort((a, b) => (a.next_service_due ?? '').localeCompare(b.next_service_due ?? ''));
  return sheet('Service schedule', scope, [
    { header: 'Next service due', width: 18, value: (r) => d(r.next_service_due) },
    {
      header: 'Days',
      width: 10,
      value: (r) => (r.next_service_due ? daysUntil(r.next_service_due) : ''),
    },
    { header: 'Asset ID', width: 20, value: (r) => r.asset_id },
    { header: 'Equipment', width: 34, value: (r) => r.name },
    { header: 'Laboratory', width: 22, value: (r) => r.lab_name },
    { header: 'Status', width: 26, value: (r) => statusLabel(r.status) },
    { header: 'Last serviced', width: 16, value: (r) => d(r.last_service_at) },
    { header: 'Interval (days)', width: 14, value: (r) => r.service_interval_days ?? '' },
  ], due);
}

export function exportFaults(rows: EventRowOut[], scope: string): Promise<Blob> {
  return sheet('Fault log', scope, [
    { header: 'Date', width: 18, value: (r) => formatDateTime(r.occurred_at) },
    { header: 'Asset ID', width: 20, value: (r) => r.asset_id },
    { header: 'Equipment', width: 30, value: (r) => r.equipment_name },
    { header: 'Laboratory', width: 22, value: (r) => r.lab_name },
    { header: 'Severity', width: 12, value: (r) => (r.severity ? r.severity[0].toUpperCase() + r.severity.slice(1) : '') },
    { header: 'Description', width: 60, value: (r) => r.summary },
    { header: 'Reported by', width: 22, value: (r) => r.recorded_by },
  ], rows);
}

export function exportHistory(rows: EventRowOut[], scope: string): Promise<Blob> {
  return sheet('Event history', scope, [
    { header: 'Date', width: 18, value: (r) => formatDateTime(r.occurred_at) },
    { header: 'Event', width: 24, value: (r) => eventLabel(r.type) },
    { header: 'Asset ID', width: 20, value: (r) => r.asset_id },
    { header: 'Equipment', width: 30, value: (r) => r.equipment_name },
    { header: 'Laboratory', width: 22, value: (r) => r.lab_name },
    { header: 'Severity', width: 12, value: (r) => r.severity ?? '' },
    { header: 'Summary', width: 60, value: (r) => r.summary },
    { header: 'Recorded by', width: 22, value: (r) => r.recorded_by },
  ], rows);
}
