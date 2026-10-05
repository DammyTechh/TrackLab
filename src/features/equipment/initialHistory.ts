import { addDays, format, parseISO } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';

/**
 * Most machines are registered long after they were installed, and already
 * have a service sticker or a logbook entry. Without that date the system has
 * nothing to count from: next_service_due stays empty, the daily check skips
 * the machine, and it never alerts — silently. (Spec 4.3: "initial
 * maintenance history ... and next service due date".)
 *
 * The history is recorded as ordinary events, not as fields on the machine,
 * so the same trigger that handles every later service works out status and
 * the due date. Nothing in the database is special-cased for registration.
 *
 *   last serviced given   -> a maintenance event on that date (due date follows
 *                            from the interval, or from the explicit date)
 *   only a next due date  -> a status_change event carrying that date, so the
 *                            machine is not falsely shown as recently serviced
 *   neither               -> no events; the form warns that it will not alert
 */

export interface InitialHistoryInput {
  /** yyyy-MM-dd, or '' if not known. */
  lastServiced: string;
  /** yyyy-MM-dd, or '' to work it out from the interval. */
  nextDue: string;
  intervalDays: number;
  /** yyyy-MM-dd in the institution's timezone. */
  today: string;
  /** ISO timestamp for "now", for an event that has no date of its own. */
  nowIso: string;
  timezone: string;
}

export interface PlannedEvent {
  type: 'maintenance' | 'status_change';
  occurred_at: string;
  next_due_date?: string;
  data: Record<string, unknown>;
}

export type InitialHistoryPlan =
  { ok: false; error: string } | { ok: true; events: PlannedEvent[]; firstDue: string | null };

/** Midday, so no timezone conversion can move the event onto a neighbouring day. */
function midday(date: string, timezone: string): string {
  return fromZonedTime(`${date}T12:00:00`, timezone).toISOString();
}

export function planInitialHistory(input: InitialHistoryInput): InitialHistoryPlan {
  const last = input.lastServiced || null;
  const next = input.nextDue || null;

  if (last && last > input.today) {
    return { ok: false, error: 'The last service date is in the future. Check the date on the sticker.' };
  }
  if (last && next && next <= last) {
    return { ok: false, error: 'The next service must come after the last one.' };
  }

  if (last) {
    return {
      ok: true,
      firstDue: next ?? format(addDays(parseISO(last), input.intervalDays), 'yyyy-MM-dd'),
      events: [
        {
          type: 'maintenance',
          occurred_at: midday(last, input.timezone),
          ...(next ? { next_due_date: next } : {}),
          data: {
            summary: 'Serviced before registration (from the service sticker or logbook).',
            outcome: 'resolved',
            initial: true,
          },
        },
      ],
    };
  }

  if (next) {
    return {
      ok: true,
      firstDue: next,
      events: [
        {
          type: 'status_change',
          occurred_at: input.nowIso,
          next_due_date: next,
          data: { summary: 'Next service date set at registration.', initial: true },
        },
      ],
    };
  }

  return { ok: true, events: [], firstDue: null };
}
