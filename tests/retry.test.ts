import { describe, expect, it } from 'vitest';
import { isAlreadyUploaded, isDueForRetry, retryDelayMs } from '../src/offline/sync';

describe('retrying queued uploads', () => {
  it('backs off from 15 seconds, doubling, to at most 10 minutes', () => {
    expect([0, 1, 2, 3, 4].map(retryDelayMs)).toEqual([0, 15_000, 30_000, 60_000, 120_000]);
    expect(retryDelayMs(20)).toBe(600_000);
  });

  it('sends a new item at once, and a failed one only after its delay', () => {
    const now = 1_000_000;
    expect(isDueForRetry({ attempts: 0 }, now)).toBe(true);
    expect(isDueForRetry({ attempts: 1, last_attempt_at: now - 10_000 }, now)).toBe(false);
    expect(isDueForRetry({ attempts: 1, last_attempt_at: now - 15_000 }, now)).toBe(true);
  });
});


describe('a file that is already uploaded', () => {
  it('counts as uploaded, in every form storage reports it', () => {
    expect(
      isAlreadyUploaded({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }),
    ).toBe(true);
    expect(isAlreadyUploaded({ status: 409, message: 'x' })).toBe(true);
    expect(isAlreadyUploaded({ message: 'duplicate key value' })).toBe(true);
  });
  it('does not hide a real failure', () => {
    expect(
      isAlreadyUploaded({
        statusCode: '500',
        error: 'DatabaseError',
        message: 'database error, code: 42P10',
      }),
    ).toBe(false);
    expect(
      isAlreadyUploaded({ statusCode: '403', message: 'new row violates row-level security policy' }),
    ).toBe(false);
  });
});
