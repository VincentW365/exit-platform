/**
 * Business-day calendar for America/Jamaica (DEC-027 / IC-S1-007,
 * REQ-WF-005, REQ-NFR-015).
 *
 * Instants are stored in UTC; business rules are evaluated in the configured
 * zone. Jamaica does not observe DST, but nothing here assumes that. The
 * production holiday list is NOT approved yet - callers must supply the
 * configured calendar; tests use deterministic synthetic holidays.
 */
import { DateTime } from 'luxon';

export const APP_ZONE = 'America/Jamaica';

export interface CalendarHoliday {
  /** ISO date, e.g. "2026-08-06". */
  readonly date: string;
  readonly label: string;
}

export interface BusinessCalendar {
  readonly timezone: string;
  readonly holidays: readonly CalendarHoliday[];
}

function toZone(instant: Date, zone: string): DateTime {
  return DateTime.fromJSDate(instant, { zone });
}

function isHoliday(dt: DateTime, calendar: BusinessCalendar): boolean {
  const iso = dt.toISODate();
  return calendar.holidays.some((h) => h.date === iso);
}

export function isBusinessDay(instant: Date, calendar: BusinessCalendar): boolean {
  const dt = toZone(instant, calendar.timezone);
  if (dt.weekday === 6 || dt.weekday === 7) return false; // Sat/Sun
  return !isHoliday(dt, calendar);
}

/**
 * The end (23:59:59.999 local) of the Nth business day AFTER the anchor
 * instant, as a UTC instant. n=1 means "end of the next business day".
 */
export function endOfNthBusinessDayAfter(
  anchor: Date,
  n: number,
  calendar: BusinessCalendar,
): Date {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a positive integer');
  let dt = toZone(anchor, calendar.timezone).startOf('day');
  let remaining = n;
  while (remaining > 0) {
    dt = dt.plus({ days: 1 });
    const probe = dt.toJSDate();
    if (isBusinessDay(probe, calendar)) remaining -= 1;
  }
  return dt.endOf('day').toJSDate();
}

/**
 * Date-only values (confirmed last working day) are stored as midnight UTC.
 * Interpreting that instant in America/Jamaica (UTC-5) would land on the
 * PREVIOUS local day. This helper re-anchors an exact-midnight-UTC value to
 * the same calendar date in the target zone; real instants pass through.
 */
export function interpretDateOnlyInZone(anchor: Date, zone: string): Date {
  if (
    anchor.getUTCHours() === 0 &&
    anchor.getUTCMinutes() === 0 &&
    anchor.getUTCSeconds() === 0 &&
    anchor.getUTCMilliseconds() === 0
  ) {
    return DateTime.fromISO(anchor.toISOString().slice(0, 10), { zone }).toJSDate();
  }
  return anchor;
}

/**
 * The end (23:59:59.999 local) of the Nth business day BEFORE the anchor
 * instant, as a UTC instant. n=1 means "end of the previous business day".
 * n=0 means the end of the anchor's own local day. (Stage 3 section E:
 * "no later than two business days before the final working day".)
 */
export function endOfNthBusinessDayBefore(
  anchor: Date,
  n: number,
  calendar: BusinessCalendar,
): Date {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('n must be a non-negative integer');
  let dt = toZone(anchor, calendar.timezone).startOf('day');
  let remaining = n;
  while (remaining > 0) {
    dt = dt.minus({ days: 1 });
    if (isBusinessDay(dt.toJSDate(), calendar)) remaining -= 1;
  }
  return dt.endOf('day').toJSDate();
}

/** Whole business days between two instants (a before b), zone-aware. */
export function businessDaysBetween(a: Date, b: Date, calendar: BusinessCalendar): number {
  if (b.getTime() <= a.getTime()) return 0;
  let dt = toZone(a, calendar.timezone).startOf('day');
  const end = toZone(b, calendar.timezone).startOf('day');
  let count = 0;
  while (dt < end) {
    dt = dt.plus({ days: 1 });
    if (isBusinessDay(dt.toJSDate(), calendar)) count += 1;
  }
  return count;
}

/**
 * KPI-001 window check: was `createdAt` no later than the end of the first
 * business day after `receivedAt`? (MetricsDictionary KPI-001.)
 */
export function withinCaseCaptureSla(
  receivedAt: Date,
  createdAt: Date,
  calendar: BusinessCalendar,
): boolean {
  return createdAt.getTime() <= endOfNthBusinessDayAfter(receivedAt, 1, calendar).getTime();
}

/** Format an instant for display in the application zone (DesignSystem section 7). */
export function formatInstant(instant: Date, zone: string = APP_ZONE): string {
  return DateTime.fromJSDate(instant, { zone }).toFormat('d LLL yyyy, h:mm a');
}

export function formatDateOnly(instant: Date, zone: string = APP_ZONE): string {
  return DateTime.fromJSDate(instant, { zone }).toFormat('d LLL yyyy');
}

/** Days (calendar) until an instant, in the app zone; negative when past. */
export function daysUntil(instant: Date, now: Date, zone: string = APP_ZONE): number {
  const a = DateTime.fromJSDate(now, { zone }).startOf('day');
  const b = DateTime.fromJSDate(instant, { zone }).startOf('day');
  return Math.round(b.diff(a, 'days').days);
}
