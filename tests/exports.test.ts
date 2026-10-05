import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/institution', () => ({
  institution: { name: 'Test University', productName: 'Test Product', timezone: 'Africa/Lagos', code: 'TEST' },
}));

import { exportFaults, exportHistory, exportRegister, exportSchedule } from '@/features/reports/exportExcel';
import { wordEquipmentReport, wordLabSummary } from '@/features/reports/exportWord';
import type { EventRowOut, MachineRow } from '@/features/reports/data';

const machine: MachineRow = {
  id: 'm1',
  asset_id: 'TEST-CHEM1-0001',
  name: 'UV-Vis Spectrophotometer',
  lab_id: 'l1',
  lab_name: 'Chemistry Lab 1',
  location: 'Bench 3',
  manufacturer: 'Shimadzu',
  model: 'UV-1900i',
  serial_no: 'A123',
  status: 'overdue',
  operating_conditions: 'Warm up 30 minutes.',
  service_interval_days: 180,
  last_service_at: '2026-01-10',
  next_service_due: '2026-07-10',
};

const fault: EventRowOut = {
  id: 'e1',
  type: 'fault',
  occurred_at: '2026-09-01T10:00:00Z',
  severity: 'critical',
  summary: 'Lamp failed',
  recorded_by: 'Test Technician',
  asset_id: machine.asset_id,
  equipment_name: machine.name,
  lab_name: machine.lab_name,
};

/** An .xlsx and a .docx are both zip files: they start with "PK". */
async function isZip(blob: Blob) {
  // jsdom's Blob has no arrayBuffer(); FileReader works in both.
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  const bytes = new Uint8Array(buffer);
  return bytes.length > 1000 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

describe('report exports', () => {
  it('builds every Excel report', async () => {
    for (const blob of [
      await exportRegister([machine], 'Chemistry Lab 1'),
      await exportSchedule([machine], 'Chemistry Lab 1'),
      await exportFaults([fault], 'Chemistry Lab 1'),
      await exportHistory([fault], 'Chemistry Lab 1'),
    ]) {
      expect(await isZip(blob)).toBe(true);
    }
  });

  it('builds both Word reports', async () => {
    expect(await isZip(await wordEquipmentReport(machine, [fault]))).toBe(true);
    expect(await isZip(await wordLabSummary('Chemistry Lab 1', [machine], [fault]))).toBe(true);
    expect(await isZip(await wordLabSummary('Empty lab', [], []))).toBe(true);
  });
});
