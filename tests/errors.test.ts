import { describe, expect, it } from 'vitest';
import { describeError, rawErrorMessage } from '../src/lib/errors';

describe('error messages people can act on', () => {
  it('explains the stale schema cache, with the command that fixes it', () => {
    // Exactly what Supabase returned when the column was added in the SQL editor.
    const err = {
      code: 'PGRST204',
      details: null,
      hint: null,
      message: "Could not find the 'public_base_url' column of 'institution' in the schema cache",
    };
    const text = describeError(err, 'Not saved.');
    expect(text).toContain("notify pgrst, 'reload schema';");
    expect(text).not.toBe('Not saved.');
  });

  it("shows Supabase's own message rather than a vague fallback", () => {
    expect(describeError({ code: 'P0001', message: 'this document has already been withdrawn' }, 'Not saved.')).toBe(
      'this document has already been withdrawn',
    );
  });

  it('puts permission and network failures in plain words', () => {
    expect(describeError({ code: '42501', message: 'permission denied for table institution' }, 'x')).toMatch(
      /do not have permission/,
    );
    expect(describeError(new TypeError('Failed to fetch'), 'x')).toMatch(/Could not reach the server/);
  });

  it('falls back only when there is nothing to say', () => {
    expect(describeError(undefined, 'Not saved.')).toBe('Not saved.');
    expect(describeError({}, 'Not saved.')).toBe('Not saved.');
  });

  it('never logs a sync failure as "[object Object]"', () => {
    expect(rawErrorMessage({ code: '23505', message: 'duplicate key value' })).toBe('duplicate key value');
    expect(String({ message: 'x' })).toBe('[object Object]'); // what the old code recorded
  });
});
