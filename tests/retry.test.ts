import { describe, expect, it } from 'vitest';
import { isDueForRetry, retryDelayMs } from '../src/offline/sync';

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
