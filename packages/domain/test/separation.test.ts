/**
 * The separation decision matrix (owner directive, 2026-08-26, section 33).
 *
 * One test file for the one file that decides what a separation type means.
 * If a rule is worth relying on downstream it is asserted here, because
 * every other feature is supposed to be reading these answers rather than
 * forming its own.
 */
import { describe, expect, it } from 'vitest';
import { parseInstantInZone } from '../src/calendar.ts';
import {
  DEPARTURE_TYPES,
  defaultDates,
  incompatibleDates,
  isBackdated,
  isVoluntary,
  noticeApplies,
  noticeIsServed,
  operativeDate,
  separationErrors,
  separationProfile,
  separationPrompts,
  separationUrgency,
  wholeDaysBetween,
  type DepartureType,
  type SeparationDates,
} from '../src/separation.ts';

// Dates are built the way the application builds them - parsed in the
// company's own zone - because a date-only value stored as UTC midnight is
// the previous evening in Jamaica, and a fixture that got that wrong would
// have every day count one out.
const day = (iso: string) => parseInstantInZone(iso)!;
const TODAY = parseInstantInZone('2026-08-26T09:00')!;
const dates = (over: Partial<SeparationDates> = {}): SeparationDates => ({
  receivedAt: null,
  confirmedLastDay: null,
  effectiveSeparationAt: null,
  contractEndDate: null,
  ...over,
});

describe('the canonical model covers every way of leaving', () => {
  it('names all seven types and gives each one a complete profile', () => {
    expect(DEPARTURE_TYPES).toHaveLength(7);
    for (const type of DEPARTURE_TYPES) {
      const p = separationProfile(type);
      expect(p.type).toBe(type);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.guidance.length).toBeGreaterThan(0);
      expect(p.receivedDateLabel.length).toBeGreaterThan(0);
      // A type must say where its effective date comes from, or downstream
      // timing has nothing to hang off.
      expect(p.effectiveDateSource).toBeTruthy();
    }
  });

  it('never lets a new type quietly inherit resignation behaviour', () => {
    // The specific failure the directive names: an unspecified type behaving
    // like a resignation because nobody wrote a rule for it.
    const resignation = separationProfile('RESIGNATION_WITH_NOTICE');
    for (const type of ['TERMINATION', 'CONTRACT_EXPIRY'] as const) {
      const p = separationProfile(type);
      expect(p.noticeApplicable).not.toBe(resignation.noticeApplicable);
    }
    // OTHER refuses to guess in either direction.
    expect(separationProfile('OTHER').noticeApplicable).toBeNull();
  });

  it('a required date is never also forbidden', () => {
    for (const type of DEPARTURE_TYPES) {
      const p = separationProfile(type);
      for (const f of p.requiredDates) expect(p.forbiddenDates).not.toContain(f);
      for (const f of p.optionalDates) expect(p.forbiddenDates).not.toContain(f);
    }
  });
});

describe('resignation with notice', () => {
  it('applies notice and serves it', () => {
    expect(noticeApplies('RESIGNATION_WITH_NOTICE', null)).toBe(true);
    expect(noticeIsServed('RESIGNATION_WITH_NOTICE', null)).toBe(true);
    expect(isVoluntary('RESIGNATION_WITH_NOTICE')).toBe(true);
  });

  it('defaults the notice date to today and leaves the last day to HR', () => {
    const d = defaultDates('RESIGNATION_WITH_NOTICE', TODAY);
    expect(d.receivedAt).toEqual(TODAY);
    expect(d.confirmedLastDay).toBeNull();
  });

  it('is planned work even though the last day is weeks away', () => {
    const d = dates({ receivedAt: TODAY, confirmedLastDay: day('2026-09-25') });
    expect(separationUrgency('RESIGNATION_WITH_NOTICE', d, TODAY)).toBe('PLANNED');
  });
});

describe('an immediate resignation is still a resignation', () => {
  it('keeps notice applicable while recording that none is served', () => {
    expect(noticeApplies('IMMEDIATE_RESIGNATION', null)).toBe(true);
    expect(noticeIsServed('IMMEDIATE_RESIGNATION', null)).toBe(false);
    expect(separationProfile('IMMEDIATE_RESIGNATION').noticeArrangement).toMatch(/no notice/i);
  });

  it('defaults both dates to today without asking for a notice period', () => {
    const d = defaultDates('IMMEDIATE_RESIGNATION', TODAY);
    expect(d.receivedAt).toEqual(TODAY);
    expect(d.confirmedLastDay).toEqual(TODAY);
  });

  it('is immediate work', () => {
    const d = defaultDates('IMMEDIATE_RESIGNATION', TODAY);
    expect(separationUrgency('IMMEDIATE_RESIGNATION', d, TODAY)).toBe('IMMEDIATE');
  });

  it('still accepts an authorized correction to either date', () => {
    const d = dates({ receivedAt: day('2026-08-20'), confirmedLastDay: day('2026-08-21') });
    expect(separationErrors({ type: 'IMMEDIATE_RESIGNATION', dates: d })).toEqual([]);
  });
});

describe('a termination is not a resignation without notice', () => {
  it('does not apply employee notice at all', () => {
    expect(noticeApplies('TERMINATION', null)).toBe(false);
    expect(separationProfile('TERMINATION').noticeArrangement).toBeNull();
    expect(isVoluntary('TERMINATION')).toBe(false);
  });

  it('calls the received date what it is, not notice', () => {
    expect(separationProfile('TERMINATION').receivedDateLabel).not.toMatch(/notice/i);
  });

  it('defaults the employment end date to today; the instant is derived, never defaulted (DEC-064)', () => {
    const d = defaultDates('TERMINATION', TODAY);
    expect(d.confirmedLastDay).toEqual(TODAY);
    expect(d.effectiveSeparationAt).toBeNull();
  });

  it('asks for one end date and never for a time (DEC-064)', () => {
    for (const type of DEPARTURE_TYPES) {
      const p = separationProfile(type as DepartureType);
      expect(p.requiredDates, type).not.toContain('effectiveSeparationAt');
      expect(p.optionalDates, type).not.toContain('effectiveSeparationAt');
      expect(p.effectiveDateSource, type).toBe('confirmedLastDay');
    }
    expect(
      separationErrors({ type: 'TERMINATION', dates: dates({ receivedAt: TODAY }) }),
    ).toContainEqual(expect.stringMatching(/employment end date .* is required/i));
  });

  it('asks who authorized it without blocking a record that cannot say', () => {
    // Prompted, not enforced: no approved rule makes the authorizer
    // mandatory, and a historical termination may no longer know it.
    const d = defaultDates('TERMINATION', TODAY);
    expect(separationErrors({ type: 'TERMINATION', dates: d })).toEqual([]);
    expect(separationPrompts({ type: 'TERMINATION', dates: d })).toContainEqual(
      expect.stringMatching(/who authorized/i),
    );
    expect(
      separationPrompts({ type: 'TERMINATION', dates: d, authorizedByName: 'HR Manager' }),
    ).not.toContainEqual(expect.stringMatching(/who authorized/i));
  });

  it('is scheduled, not immediate, when dated in the future', () => {
    const d = dates({ receivedAt: TODAY, effectiveSeparationAt: day('2026-09-30') });
    expect(separationUrgency('TERMINATION', d, TODAY)).toBe('SCHEDULED');
  });

  it('is immediate when effective today', () => {
    const d = dates({ receivedAt: TODAY, effectiveSeparationAt: TODAY });
    expect(separationUrgency('TERMINATION', d, TODAY)).toBe('IMMEDIATE');
  });
});

describe('retirement is its own departure, not a disguised resignation', () => {
  it('uses retirement wording for the notification date', () => {
    const p = separationProfile('RETIREMENT');
    expect(p.receivedDateLabel).toMatch(/retirement/i);
    expect(p.noticeArrangement).toMatch(/retirement/i);
    expect(p.noticeArrangement).not.toMatch(/resign/i);
  });

  it('requires a retirement date - the employment end date', () => {
    const errs = separationErrors({
      type: 'RETIREMENT',
      dates: dates({ receivedAt: TODAY }),
    });
    expect(errs).toContainEqual(expect.stringMatching(/employment end date .* is required/i));
  });
});

describe('a contract expiry is not a resignation', () => {
  it('reuses the contract end date the employee record already holds', () => {
    const contractEnd = day('2026-09-30');
    const d = defaultDates('CONTRACT_EXPIRY', TODAY, { contractEndDate: contractEnd });
    expect(d.contractEndDate).toEqual(contractEnd);
    // HR is not asked to retype a date that already exists.
    expect(d.confirmedLastDay).toEqual(contractEnd);
  });

  it('requires HR to enter one where the record holds none', () => {
    const d = defaultDates('CONTRACT_EXPIRY', TODAY);
    expect(d.contractEndDate).toBeNull();
    expect(
      separationErrors({ type: 'CONTRACT_EXPIRY', dates: { ...d, receivedAt: TODAY } }),
    ).toContainEqual(expect.stringMatching(/contract end date is required/i));
  });

  it('carries no notice concept', () => {
    expect(noticeApplies('CONTRACT_EXPIRY', null)).toBe(false);
  });

  it('takes its operative date from the contract, not from receipt', () => {
    const d = dates({ receivedAt: TODAY, contractEndDate: day('2026-09-30') });
    expect(operativeDate('CONTRACT_EXPIRY', d)).toEqual(day('2026-09-30'));
  });
});

describe('redundancy uses employer wording, not resignation wording', () => {
  it('notifies rather than receives a resignation', () => {
    const p = separationProfile('REDUNDANCY');
    expect(p.receivedDateLabel).not.toMatch(/resign/i);
    expect(p.initiator).toBe('EMPLOYER');
    expect(p.authorizerExpected).toBe(true);
  });
});

describe('"Other" refuses to infer', () => {
  it('will not assume notice either way', () => {
    const d = dates({ receivedAt: TODAY, confirmedLastDay: TODAY });
    const errs = separationErrors({ type: 'OTHER', dates: d, separationTypeDetail: 'Mutual exit' });
    expect(errs).toContainEqual(expect.stringMatching(/whether employee notice applies/i));
  });

  it('requires HR to describe what happened', () => {
    const d = dates({ receivedAt: TODAY, confirmedLastDay: TODAY });
    const errs = separationErrors({ type: 'OTHER', dates: d, noticeApplicableOverride: false });
    expect(errs).toContainEqual(expect.stringMatching(/describe the separation/i));
  });

  it('takes HR at their word once they have answered', () => {
    expect(noticeApplies('OTHER', true)).toBe(true);
    expect(noticeApplies('OTHER', false)).toBe(false);
    expect(noticeIsServed('OTHER', true)).toBe(true);
    const d = dates({ receivedAt: TODAY, confirmedLastDay: TODAY });
    expect(
      separationErrors({
        type: 'OTHER',
        dates: d,
        noticeApplicableOverride: true,
        separationTypeDetail: 'Mutual separation agreement',
      }),
    ).toEqual([]);
  });
});

describe('server-side rules hold whatever the form shows', () => {
  it('rejects a contract end date on a resignation', () => {
    const d = dates({ receivedAt: TODAY, contractEndDate: day('2026-09-30') });
    expect(separationErrors({ type: 'RESIGNATION_WITH_NOTICE', dates: d })).toContainEqual(
      expect.stringMatching(/contract end date does not apply/i),
    );
  });

  it('rejects a contract end date on a termination', () => {
    const d = dates({
      receivedAt: TODAY,
      confirmedLastDay: TODAY,
      contractEndDate: day('2026-09-30'),
    });
    const errs = separationErrors({ type: 'TERMINATION', dates: d, authorizedByName: 'HR' });
    expect(errs).toContainEqual(expect.stringMatching(/does not apply to a termination/i));
  });
});

describe('date relationships are questioned, not blindly blocked', () => {
  it('accepts notice at 1pm and a last working day on that same date', () => {
    // The ordinary shape of an immediate resignation. Comparing a dated last
    // working day against a timestamped receipt made this look backwards.
    const d = dates({
      receivedAt: parseInstantInZone('2026-07-28T13:00')!,
      confirmedLastDay: day('2026-07-28'),
      effectiveSeparationAt: parseInstantInZone('2026-07-28T14:00')!,
    });
    expect(separationErrors({ type: 'IMMEDIATE_RESIGNATION', dates: d })).toEqual([]);
  });

  const backwards = dates({
    receivedAt: day('2026-09-01'),
    confirmedLastDay: day('2026-08-01'),
  });

  it('objects to a last working day before the notice was received', () => {
    expect(separationErrors({ type: 'RESIGNATION_WITH_NOTICE', dates: backwards })).toContainEqual(
      expect.stringMatching(/before the separation was recorded/i),
    );
  });

  it('accepts it with an authorized reason, so historical cases can be recorded', () => {
    expect(
      separationErrors({
        type: 'RESIGNATION_WITH_NOTICE',
        dates: backwards,
        dateOverrideReason: 'Paper record found in the file; entered as it happened.',
      }),
    ).toEqual([]);
  });

  it('allows employment to end at close of business on the last working day', () => {
    const d = dates({
      receivedAt: day('2026-08-01'),
      confirmedLastDay: day('2026-09-25'),
      effectiveSeparationAt: new Date('2026-09-25T17:00:00.000Z'),
    });
    expect(separationErrors({ type: 'RESIGNATION_WITH_NOTICE', dates: d })).toEqual([]);
  });
});

describe('changing the exit type never re-reads one date as another', () => {
  it('names the fields that would lose their meaning', () => {
    const d = dates({ receivedAt: TODAY, contractEndDate: day('2026-09-30') });
    expect(incompatibleDates('CONTRACT_EXPIRY', 'TERMINATION', d)).toEqual(['contractEndDate']);
  });

  it('says nothing when the type has not changed', () => {
    const d = dates({ contractEndDate: day('2026-09-30') });
    expect(incompatibleDates('CONTRACT_EXPIRY', 'CONTRACT_EXPIRY', d)).toEqual([]);
  });

  it('says nothing when the entered data is still meaningful', () => {
    const d = dates({ receivedAt: TODAY, confirmedLastDay: day('2026-09-25') });
    expect(incompatibleDates('RESIGNATION_WITH_NOTICE', 'IMMEDIATE_RESIGNATION', d)).toEqual([]);
  });
});

describe('historical and future records', () => {
  it('flags a case entered after the departure happened', () => {
    const d = dates({ receivedAt: day('2026-07-01'), confirmedLastDay: day('2026-07-15') });
    expect(isBackdated('RESIGNATION_WITH_NOTICE', d, TODAY)).toBe(true);
    expect(separationUrgency('RESIGNATION_WITH_NOTICE', d, TODAY)).toBe('HISTORICAL');
  });

  it('does not flag a departure that has not happened yet', () => {
    const d = dates({ receivedAt: TODAY, confirmedLastDay: day('2026-09-25') });
    expect(isBackdated('RESIGNATION_WITH_NOTICE', d, TODAY)).toBe(false);
  });

  it('counts the days to an exit in either direction', () => {
    expect(wholeDaysBetween(TODAY, day('2026-09-25'))).toBe(30);
    expect(wholeDaysBetween(TODAY, day('2026-08-26'))).toBe(0);
    expect(wholeDaysBetween(TODAY, day('2026-08-01'))).toBe(-25);
  });
});

describe('every type produces a usable operative date', () => {
  const filled = dates({
    receivedAt: TODAY,
    confirmedLastDay: day('2026-09-25'),
    effectiveSeparationAt: day('2026-09-25'),
    contractEndDate: day('2026-09-30'),
  });
  for (const type of DEPARTURE_TYPES) {
    it(`${type} hangs its timing off a real date`, () => {
      expect(operativeDate(type as DepartureType, filled)).toBeInstanceOf(Date);
    });
  }
});
