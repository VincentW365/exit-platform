import { describe, expect, it } from 'vitest';
import {
  daysUntil,
  endOfNthBusinessDayAfter,
  formatInstant,
  isBusinessDay,
  withinCaseCaptureSla,
  type BusinessCalendar,
} from '../src/calendar.ts';

// Deterministic SYNTHETIC holidays for tests only - the production holiday
// calendar is not approved (DEC-027 remains PROVISIONAL).
const cal: BusinessCalendar = {
  timezone: 'America/Jamaica',
  holidays: [
    { date: '2026-08-06', label: 'TEST Independence Day (synthetic)' },
    { date: '2026-08-03', label: 'TEST Emancipation Day observed (synthetic)' },
  ],
};

describe('business-day calendar (America/Jamaica)', () => {
  it('weekdays are business days; weekends are not', () => {
    // 2026-07-22 is a Wednesday; 2026-07-25 is a Saturday; 2026-07-26 a Sunday.
    expect(isBusinessDay(new Date('2026-07-22T15:00:00Z'), cal)).toBe(true);
    expect(isBusinessDay(new Date('2026-07-25T15:00:00Z'), cal)).toBe(false);
    expect(isBusinessDay(new Date('2026-07-26T15:00:00Z'), cal)).toBe(false);
  });

  it('configured holidays are not business days', () => {
    expect(isBusinessDay(new Date('2026-08-06T15:00:00Z'), cal)).toBe(false); // Thursday holiday
    expect(isBusinessDay(new Date('2026-08-05T15:00:00Z'), cal)).toBe(true);
  });

  it('zone boundary: late-evening UTC is still the same Jamaica day', () => {
    // 2026-07-25 03:00Z is Friday 2026-07-24 22:00 in Jamaica (UTC-5): business day.
    expect(isBusinessDay(new Date('2026-07-25T03:00:00Z'), cal)).toBe(true);
  });

  it('end of Nth business day skips weekends and holidays', () => {
    // Anchor: Friday 2026-07-31 10:00 Jamaica. Next business day is Tuesday
    // 2026-08-04 (Mon 08-03 is a synthetic holiday).
    const anchor = new Date('2026-07-31T15:00:00Z');
    const end1 = endOfNthBusinessDayAfter(anchor, 1, cal);
    expect(formatInstant(end1)).toBe('4 Aug 2026, 11:59 PM');
    // Second business day after: Wednesday 08-05.
    const end2 = endOfNthBusinessDayAfter(anchor, 2, cal);
    expect(formatInstant(end2)).toBe('5 Aug 2026, 11:59 PM');
    // Third: skips Thursday 08-06 (holiday) to Friday 08-07.
    const end3 = endOfNthBusinessDayAfter(anchor, 3, cal);
    expect(formatInstant(end3)).toBe('7 Aug 2026, 11:59 PM');
  });

  it('rejects non-positive n', () => {
    expect(() => endOfNthBusinessDayAfter(new Date(), 0, cal)).toThrow(RangeError);
  });
});

describe('KPI-001 case-capture window', () => {
  const receivedFriday = new Date('2026-07-31T15:00:00Z'); // Fri 10:00 Jamaica

  it('created the same day: within SLA', () => {
    expect(withinCaseCaptureSla(receivedFriday, new Date('2026-07-31T20:00:00Z'), cal)).toBe(true);
  });

  it('created before end of next business day (Tue, after weekend + holiday): within SLA', () => {
    expect(withinCaseCaptureSla(receivedFriday, new Date('2026-08-04T20:00:00Z'), cal)).toBe(true);
  });

  it('created after the window closes: breach', () => {
    // Wed 2026-08-05 08:00 Jamaica is after Tuesday end-of-day.
    expect(withinCaseCaptureSla(receivedFriday, new Date('2026-08-05T13:00:00Z'), cal)).toBe(false);
  });
});

describe('edge cases (Directive 1.1 H.17)', () => {
  it('consecutive holidays are skipped in sequence', () => {
    const consec: BusinessCalendar = {
      timezone: 'America/Jamaica',
      holidays: [
        { date: '2026-08-04', label: 'TEST consecutive A' },
        { date: '2026-08-05', label: 'TEST consecutive B' },
      ],
    };
    // Anchor Monday 2026-08-03: Tue+Wed are holidays -> next business day Thu 08-06.
    const end1 = endOfNthBusinessDayAfter(new Date('2026-08-03T15:00:00Z'), 1, consec);
    expect(formatInstant(end1)).toBe('6 Aug 2026, 11:59 PM');
  });

  it('year boundary: business-day math crosses into the next year', () => {
    const yearEnd: BusinessCalendar = {
      timezone: 'America/Jamaica',
      holidays: [{ date: '2027-01-01', label: 'TEST New Year (synthetic)' }],
    };
    // Anchor Thursday 2026-12-31; Fri 01-01 is a holiday, weekend follows ->
    // first business day after the anchor is Monday 2027-01-04.
    const end = endOfNthBusinessDayAfter(new Date('2026-12-31T15:00:00Z'), 1, yearEnd);
    expect(formatInstant(end)).toBe('4 Jan 2027, 11:59 PM');
  });

  it('Jamaica observes no DST: UTC offset is -05:00 in June and December alike', () => {
    // 17:00 UTC is always 12:00 in Jamaica regardless of season.
    expect(formatInstant(new Date('2026-06-15T17:00:00Z'))).toBe('15 Jun 2026, 12:00 PM');
    expect(formatInstant(new Date('2026-12-15T17:00:00Z'))).toBe('15 Dec 2026, 12:00 PM');
  });
});

describe('display helpers', () => {
  it('formats instants in the app zone with explicit month names', () => {
    expect(formatInstant(new Date('2026-08-14T22:00:00Z'))).toBe('14 Aug 2026, 5:00 PM');
  });

  it('daysUntil counts Jamaica calendar days', () => {
    const now = new Date('2026-07-28T15:00:00Z');
    expect(daysUntil(new Date('2026-08-04T13:00:00Z'), now)).toBe(7);
    expect(daysUntil(new Date('2026-07-27T13:00:00Z'), now)).toBe(-1);
  });
});
