import { describe, expect, it } from 'vitest';
import { mergeEdit, type EditableValues } from '../src/features/equipment/editMerge';

const base: EditableValues = {
  name: 'Gas chromatograph',
  manufacturer: 'Agilent',
  model: '7890B',
  serial_no: 'CN1432',
  location: 'Bench 4',
  operating_conditions: 'Helium carrier',
  service_interval_days: 180,
};

describe('editing a machine', () => {
  it('sends only what this person changed', () => {
    const { changes, conflicts } = mergeEdit(base, { ...base, location: 'Bench 9' }, base);
    expect(changes).toEqual({ location: 'Bench 9' });
    expect(conflicts).toEqual([]);
  });

  it('is not fooled by a colleague editing a different field', () => {
    const theirs = { ...base, model: '8890' };
    const { changes, conflicts } = mergeEdit(base, { ...base, location: 'Bench 9' }, theirs);
    expect(changes).toEqual({ location: 'Bench 9' });
    expect(conflicts).toEqual([]);
  });

  it('flags the same field changed by two people to different values', () => {
    const { conflicts } = mergeEdit(
      base,
      { ...base, location: 'Bench 9' },
      { ...base, location: 'Store room' },
    );
    expect(conflicts).toEqual([
      { field: 'location', base: 'Bench 4', theirs: 'Store room', mine: 'Bench 9' },
    ]);
  });

  it('does not flag two people making the same change', () => {
    const { conflicts } = mergeEdit(base, { ...base, location: 'Bench 9' }, { ...base, location: 'Bench 9' });
    expect(conflicts).toEqual([]);
  });

  it('treats a cleared field and an empty one as the same', () => {
    const { changes } = mergeEdit({ ...base, model: null }, { ...base, model: '' }, { ...base, model: null });
    expect(changes).toEqual({});
  });

  it('sends nothing when nothing changed', () => {
    expect(mergeEdit(base, { ...base }, { ...base, name: 'Changed elsewhere' }).changes).toEqual({});
  });
});
