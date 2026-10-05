import { describe, expect, it } from 'vitest';
import { STATUS, STATUSES, statusClasses } from '../src/lib/status';

/**
 * These tests guard the three claims the design rests on. If one fails, a
 * screen somewhere has quietly stopped being readable.
 */
describe('the status system', () => {
  it('uses one closed set of seven, each with its own glyph', () => {
    expect(STATUSES).toHaveLength(7);
    const icons = STATUSES.map((s) => STATUS[s].icon);
    expect(new Set(icons).size).toBe(7);
  });

  it('spends solid fill only on the three states that demand action today', () => {
    const solid = STATUSES.filter((s) => STATUS[s].solid);
    expect(solid.sort()).toEqual(['faulty', 'overdue', 'replace']);
  });

  it('gives the three urgent states one hue, told apart by glyph', () => {
    const urgent = STATUSES.filter((s) => STATUS[s].signal === 'urgent');
    expect(urgent.sort()).toEqual(['faulty', 'overdue', 'replace']);
    expect(new Set(urgent.map((s) => statusClasses(s))).size).toBe(1);
    expect(new Set(urgent.map((s) => STATUS[s].icon)).size).toBe(3);
  });

  it('never uses more than four signals', () => {
    expect(new Set(STATUSES.map((s) => STATUS[s].signal)).size).toBeLessThanOrEqual(4);
  });

  it('ranks retired above faulty, so a retired machine is never shown overdue', () => {
    expect(STATUS.retired.rank).toBeGreaterThan(STATUS.faulty.rank);
    expect(STATUS.faulty.rank).toBeGreaterThan(STATUS.overdue.rank);
    expect(STATUS.overdue.rank).toBeGreaterThan(STATUS.due_soon.rank);
  });
});
