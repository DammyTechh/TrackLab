import { describe, expect, it } from 'vitest';
import { planInitialHistory, type InitialHistoryInput } from '../src/features/equipment/initialHistory';

const base: InitialHistoryInput = {
  lastServiced: '',
  nextDue: '',
  intervalDays: 180,
  today: '2026-10-02',
  nowIso: '2026-10-02T09:00:00.000Z',
  timezone: 'Africa/Lagos',
};

describe('initial service history at registration', () => {
  it('records the last service as a maintenance event and counts the interval from it', () => {
    const plan = planInitialHistory({ ...base, lastServiced: '2026-05-01' });
    expect(plan).toMatchObject({ ok: true, firstDue: '2026-10-28' });
    if (!plan.ok) throw new Error();
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]).toMatchObject({ type: 'maintenance', data: { initial: true } });
    expect(plan.events[0]!.next_due_date).toBeUndefined();
  });

  it('dates the event at midday Lagos time, so it stays on the right calendar day', () => {
    const plan = planInitialHistory({ ...base, lastServiced: '2026-05-01' });
    if (!plan.ok) throw new Error();
    expect(plan.events[0]!.occurred_at).toBe('2026-05-01T11:00:00.000Z');
  });

  it("uses the engineer's date when one was given", () => {
    const plan = planInitialHistory({ ...base, lastServiced: '2026-05-01', nextDue: '2026-08-01' });
    expect(plan).toMatchObject({ ok: true, firstDue: '2026-08-01' });
    if (!plan.ok) throw new Error();
    expect(plan.events[0]!.next_due_date).toBe('2026-08-01');
  });

  it('does not invent a service when only the due date is known', () => {
    const plan = planInitialHistory({ ...base, nextDue: '2027-01-15' });
    if (!plan.ok) throw new Error();
    expect(plan.events).toEqual([
      expect.objectContaining({ type: 'status_change', next_due_date: '2027-01-15' }),
    ]);
  });

  it('records nothing when nothing is known, and says there is no due date', () => {
    expect(planInitialHistory(base)).toEqual({ ok: true, events: [], firstDue: null });
  });

  it('refuses a service date in the future', () => {
    expect(planInitialHistory({ ...base, lastServiced: '2026-12-01' })).toMatchObject({ ok: false });
  });

  it('refuses a next due date that is not after the last service', () => {
    expect(planInitialHistory({ ...base, lastServiced: '2026-05-01', nextDue: '2026-05-01' })).toMatchObject({
      ok: false,
    });
  });
});
