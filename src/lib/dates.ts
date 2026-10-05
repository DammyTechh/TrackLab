import { format, differenceInCalendarDays, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { institution } from './institution';

/**
 * Every date in the interface goes through here, pinned to the institution's
 * timezone. A maintenance record read in another timezone must still name the
 * same calendar day.
 */

export function formatDate(iso: string): string {
  return format(toZonedTime(parseISO(iso), institution.timezone), 'd MMM yyyy');
}

export function formatDateTime(iso: string): string {
  return format(toZonedTime(parseISO(iso), institution.timezone), 'd MMM yyyy HH:mm');
}

function today(): Date {
  return toZonedTime(new Date(), institution.timezone);
}

/** Negative means it has passed. */
export function daysUntil(isoDate: string): number {
  return differenceInCalendarDays(toZonedTime(parseISO(isoDate), institution.timezone), today());
}

