/**
 * The fields a technician may change after registration. Everything else on
 * a machine is either fixed at registration (asset ID, lab, QR token — they
 * are printed on the label) or derived by the server from events, and the
 * database refuses a direct write to those (0009).
 */
export const EDITABLE_FIELDS = [
  'name',
  'manufacturer',
  'model',
  'serial_no',
  'location',
  'operating_conditions',
  'service_interval_days',
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];
export type EditableValues = {
  [K in EditableField]: K extends 'service_interval_days' ? number : string | null;
};

export interface Conflict {
  field: EditableField;
  base: EditableValues[EditableField];
  theirs: EditableValues[EditableField];
  mine: EditableValues[EditableField];
}

/**
 * A three-way merge, per field.
 *
 *   base    what the form loaded
 *   mine    what the person typed
 *   theirs  what the server holds now
 *
 * Comparing the whole row's updated_at is the obvious approach and the wrong
 * one here: every recorded event recomputes status and bumps updated_at, so a
 * colleague logging a use would make every open edit look stale. Only a field
 * that BOTH people changed, to different values, is a real conflict.
 */
export function mergeEdit(base: EditableValues, mine: EditableValues, theirs: EditableValues) {
  const changes: Partial<EditableValues> = {};
  const conflicts: Conflict[] = [];

  for (const field of EDITABLE_FIELDS) {
    if (same(mine[field], base[field])) continue; // not touched here
    if (!same(theirs[field], base[field]) && !same(theirs[field], mine[field])) {
      conflicts.push({ field, base: base[field], theirs: theirs[field], mine: mine[field] });
    }
    (changes as Record<string, unknown>)[field] = mine[field];
  }

  return { changes, conflicts };
}

/** Empty and missing are the same thing to a person reading the form. */
function same(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === '' || v === undefined ? null : v);
  return norm(a) === norm(b);
}

export const FIELD_LABEL: Record<EditableField, string> = {
  name: 'Name',
  manufacturer: 'Manufacturer',
  model: 'Model',
  serial_no: 'Serial number',
  location: 'Location in the lab',
  operating_conditions: 'Safe operating conditions',
  service_interval_days: 'Service interval',
};
