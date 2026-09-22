/**
 * Deterministic test dates, derived from the execution date rather than
 * hard-coded (directive section 4). Every offset is a whole number of days
 * from "today" in the business zone, so a run made in a year's time asks
 * the platform the same questions.
 *
 * The business zone is America/Jamaica (UTC-5, no daylight saving), which is
 * why a fixed offset is enough here; the application itself uses Luxon.
 */

const JAMAICA_OFFSET_MS = -5 * 60 * 60 * 1000;

/** Today's calendar date in the business zone, as YYYY-MM-DD. */
export function businessDate(now: Date = new Date(), plusDays = 0): string {
  const shifted = new Date(now.getTime() + JAMAICA_OFFSET_MS + plusDays * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

/** A datetime-local value (YYYY-MM-DDTHH:mm) on a business date. */
export function businessDateTime(date: string, time = '17:00'): string {
  return `${date}T${time}`;
}

/** The business-zone wall clock a few minutes from now, split for the form. */
export function businessTimePlus(now: Date, minutes: number): { date: string; time: string } {
  const shifted = new Date(now.getTime() + JAMAICA_OFFSET_MS + minutes * 60_000);
  const iso = shifted.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export interface DatePlan {
  /** The date the run executed on, in the business zone. */
  executionDate: string;
  /** Values the scenario types into the intake; absent = keep the default. */
  receivedAt?: string;
  confirmedLastDay?: string;
  effectiveSeparationAt?: string;
  contractEndDate?: string;
  /** Fields the profile says default to today - verified, not typed. */
  expectDefaultToday: string[];
  /** A one-line description for the result file. */
  narrative: string;
}

/**
 * One plan per separation type. Offsets are chosen so that each type's own
 * timing rule is exercised: same-day for the immediate kinds, comfortably
 * future for the planned kinds, and past nothing - a historical record is
 * a different test.
 */
export function datePlanFor(type: string, now: Date = new Date()): DatePlan {
  const today = businessDate(now);
  const at = (days: number, time?: string) => businessDateTime(businessDate(now, days), time);
  switch (type) {
    case 'RESIGNATION_WITH_NOTICE':
      return {
        executionDate: today,
        // A few minutes ago, never a fixed clock time: a run that starts early
        // in the day must not type a receipt time that is still in the future.
        receivedAt: businessDateTime(
          businessTimePlus(now, -5).date,
          businessTimePlus(now, -5).time,
        ),
        confirmedLastDay: businessDate(now, 14),
        expectDefaultToday: ['receivedAt'],
        narrative:
          'Notice received today (a few minutes before the run); last working day in 14 days.',
      };
    case 'IMMEDIATE_RESIGNATION':
      return {
        executionDate: today,
        expectDefaultToday: ['receivedAt', 'confirmedLastDay'],
        narrative: 'Defaults kept: notice received and last working day both today.',
      };
    case 'TERMINATION':
      // One end date (DEC-064): the end date defaults to today and the
      // effective instant is derived at close of business on it - nothing is
      // typed. The same-day rules (IT one hour before, manager and finance at
      // the instant) fall due at close of business.
      return {
        executionDate: today,
        effectiveSeparationAt: at(0, '17:00'),
        expectDefaultToday: ['receivedAt', 'confirmedLastDay'],
        narrative:
          'Recorded today; employment ends today at close of business (derived, never typed).',
      };
    case 'RETIREMENT':
      return {
        executionDate: today,
        effectiveSeparationAt: at(30, '17:00'),
        confirmedLastDay: businessDate(now, 30),
        expectDefaultToday: ['receivedAt'],
        narrative: 'Retirement notified today; retires in 30 days.',
      };
    case 'CONTRACT_EXPIRY':
      return {
        executionDate: today,
        contractEndDate: businessDate(now, 21),
        confirmedLastDay: businessDate(now, 21),
        expectDefaultToday: ['receivedAt'],
        narrative: 'Recorded today; contract ends in 21 days (typed - see directory note).',
      };
    case 'REDUNDANCY':
      return {
        executionDate: today,
        effectiveSeparationAt: at(14, '17:00'),
        confirmedLastDay: businessDate(now, 14),
        expectDefaultToday: ['receivedAt'],
        narrative: 'Employee notified today; position ends in 14 days.',
      };
    case 'OTHER':
      return {
        executionDate: today,
        effectiveSeparationAt: at(7, '17:00'),
        confirmedLastDay: businessDate(now, 7),
        expectDefaultToday: ['receivedAt'],
        narrative: 'Recorded today; ends in 7 days; HR states what the separation is.',
      };
    default:
      // A separation type this plan has never heard of still gets a sane,
      // future-dated plan rather than being silently skipped (section 3).
      return {
        executionDate: today,
        effectiveSeparationAt: at(10, '17:00'),
        confirmedLastDay: businessDate(now, 10),
        expectDefaultToday: ['receivedAt'],
        narrative: `No specific plan for ${type}; generic future-dated plan used.`,
      };
  }
}

/** Format an instant for the result files: business-zone wall clock. */
export function wallClock(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  const shifted = new Date(date.getTime() + JAMAICA_OFFSET_MS);
  return shifted.toISOString().replace('T', ' ').slice(0, 16) + ' (Jamaica)';
}

/** The business-zone calendar date of an instant, for date-only comparisons. */
export function dateOf(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  return businessDate(date);
}
