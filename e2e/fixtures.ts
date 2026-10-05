/**
 * One lab, one overdue machine with an SOP, one technician. Small on
 * purpose: every value here appears in at least one assertion.
 */
export const SUPABASE_URL = 'http://supabase.e2e.test';

export const LAB = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Chemistry Lab 2',
  code: 'CHEM2',
};

export const MACHINE = {
  id: '22222222-2222-4222-8222-222222222222',
  qr_token: 'TOKEN1234567',
  lab_id: LAB.id,
  asset_id: 'TEST-CHEM2-0042',
  name: 'Gas chromatograph',
  manufacturer: 'Agilent',
  model: '7890B',
  serial_no: 'CN14323045',
  location: 'Bench 4',
  operating_conditions: 'Helium carrier at 1.2 mL/min.',
  photo_path: null,
  status: 'overdue',
  service_interval_days: 180,
  last_service_at: '2026-03-14',
  next_service_due: '2026-09-10',
  retired_at: null,
  lab: { name: LAB.name, code: LAB.code },
};

export const SOP = {
  id: '33333333-3333-4333-8333-333333333333',
  kind: 'sop',
  title: 'Start-up and shutdown',
  file_path: `${MACHINE.id}/start-up.pdf`,
  created_at: '2026-05-02T09:00:00Z',
};

export const TECHNICIAN = {
  id: '44444444-4444-4444-8444-444444444444',
  email: 'tech.chem@test.local',
  password: 'correct-horse-battery',
  full_name: 'Test Technician',
};

/** What get_public_equipment returns for MACHINE: public columns only. */
export const PUBLIC_PASSPORT = {
  asset_id: MACHINE.asset_id,
  name: MACHINE.name,
  manufacturer: MACHINE.manufacturer,
  model: MACHINE.model,
  serial_no: MACHINE.serial_no,
  location: MACHINE.location,
  operating_conditions: MACHINE.operating_conditions,
  photo_path: null,
  status: MACHINE.status,
  last_service_at: MACHINE.last_service_at,
  next_service_due: MACHINE.next_service_due,
  lab: { name: LAB.name, building: 'Science Block A', room: 'G14' },
  documents: [{ title: SOP.title, kind: SOP.kind, file_path: SOP.file_path }],
  history: [
    { type: 'fault', occurred_at: '2026-09-18T14:02:00Z', severity: 'critical', summary: 'Baseline drift on every run.' },
  ],
};
