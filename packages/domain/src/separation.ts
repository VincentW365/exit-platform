import { DateTime } from 'luxon';
import { APP_ZONE } from './calendar.ts';

/**
 * The canonical separation model (owner directive, 2026-08-26).
 *
 * ONE authoritative statement of what each way of leaving means. Before this
 * existed, the platform held three departure types and every feature that
 * cared about them re-derived its own opinion: documents asked one question,
 * the survey another, the rules engine a third. Adding a fourth way to leave
 * meant finding all of them.
 *
 * The rule now is: nothing outside this file decides what a separation type
 * implies. Presentation reads the profile to know which fields to show,
 * validation reads it to know which are required, and workflow generation
 * reads it to know how urgent the case is. When they disagree, they are
 * disagreeing with this file, which is the bug.
 *
 * What this file does NOT do is invent policy. There is no statutory notice
 * period here, no entitlement and no payroll consequence: where the rule
 * belongs to HR rather than to software, the profile says the concept
 * APPLIES and leaves the value to configuration (`separation.noticePeriodDays`
 * in SystemConfig, unset until HR sets it). CLAUDE.md rule 4.
 */

/**
 * Every way an employee can leave. The first three are the original values
 * and keep their names, so every existing record and workflow definition
 * stays valid; the rest are the owner's canonical additions.
 */
export const DEPARTURE_TYPES = [
  'RESIGNATION_WITH_NOTICE',
  'IMMEDIATE_RESIGNATION',
  'TERMINATION',
  'RETIREMENT',
  'CONTRACT_EXPIRY',
  'REDUNDANCY',
  'OTHER',
] as const;
export type DepartureType = (typeof DEPARTURE_TYPES)[number];

/** Who ended the employment. Drives wording, survey policy and reporting. */
export type SeparationInitiator = 'EMPLOYEE' | 'EMPLOYER' | 'CONTRACT' | 'UNSPECIFIED';

/**
 * How soon the offboarding has to happen. Derived from the profile and the
 * dates together - a type alone is not urgency, because a termination
 * scheduled for next month is not a same-day offboarding (directive 9).
 */
export type SeparationUrgency = 'IMMEDIATE' | 'PLANNED' | 'SCHEDULED' | 'HISTORICAL';

/**
 * Which date concept a type is actually about. The platform keeps all of
 * them distinct in the data model (directive 5) but only asks for the ones
 * a given separation needs.
 */
export type DateField =
  'receivedAt' | 'confirmedLastDay' | 'effectiveSeparationAt' | 'contractEndDate';

export interface SeparationProfile {
  type: DepartureType;
  /** What HR calls this on screen and in a letter. */
  label: string;
  /**
   * What the stored `receivedAt` instant is CALLED for this type. Every
   * separation records when it reached HR; only some of them call that
   * notice. A termination is recorded, not noticed (directive 4).
   */
  receivedDateLabel: string;
  /** One line explaining when to choose it, shown beside the option. */
  guidance: string;
  initiator: SeparationInitiator;

  // --- notice ---------------------------------------------------------------
  /**
   * Whether the notion of employee notice applies at all. A termination is
   * not "a resignation without notice": the concept does not belong to it,
   * so the fields are absent rather than empty (directive 4).
   *
   * `null` means the platform cannot know - only OTHER, where HR states it.
   */
  noticeApplicable: boolean | null;
  /**
   * Whether a notice period is actually SERVED. An immediate resignation is
   * still a resignation and still has a notice date, but no period is being
   * worked (directive 3) - so this is derived, never asked.
   */
  noticeServed: boolean | null;
  /** The sentence shown in place of a notice-period control. */
  noticeArrangement: string | null;

  // --- dates ----------------------------------------------------------------
  /** Date concepts this separation requires a value for. */
  requiredDates: readonly DateField[];
  /** Date concepts shown but not required. */
  optionalDates: readonly DateField[];
  /** Date concepts that must NOT be set - the server rejects them. */
  forbiddenDates: readonly DateField[];
  /** Which of the dates the effective separation follows. */
  effectiveDateSource: DateField;
  /** Date concepts that default to today when HR has entered nothing. */
  defaultsToToday: readonly DateField[];

  // --- consequences ---------------------------------------------------------
  /** Base urgency before the dates are considered. */
  baseUrgency: Exclude<SeparationUrgency, 'HISTORICAL'>;
  /** Restricted by default: not discoverable without assignment. */
  restrictedByDefault: boolean;
  /** Whether an exit survey is offered by default (BR-SUR-002). */
  surveyEligibleByDefault: boolean;
  /**
   * Whether this type should record who authorized it (directive 4, 12).
   *
   * Prompted, not enforced. The directive lists the authorizer under
   * RECOMMENDED information, and no approved rule makes it mandatory - so
   * requiring it here would be the platform inventing an HR policy
   * (CLAUDE.md rule 4), and would block a legitimate historical record whose
   * authorizer is no longer known. Enforcement is a configuration decision
   * for HR: see DEC-058.
   */
  authorizerExpected: boolean;
  /** Whether HR must describe the separation in their own words (13). */
  requiresDetail: boolean;
}

const PROFILES: Readonly<Record<DepartureType, SeparationProfile>> = {
  RESIGNATION_WITH_NOTICE: {
    type: 'RESIGNATION_WITH_NOTICE',
    receivedDateLabel: 'Notice received',
    label: 'Resignation - with notice',
    guidance: 'The employee resigned and is working a notice period.',
    initiator: 'EMPLOYEE',
    noticeApplicable: true,
    noticeServed: true,
    noticeArrangement: 'Notice period served to the final working day.',
    requiredDates: ['receivedAt'],
    optionalDates: ['confirmedLastDay', 'effectiveSeparationAt'],
    forbiddenDates: ['contractEndDate'],
    effectiveDateSource: 'confirmedLastDay',
    defaultsToToday: ['receivedAt'],
    baseUrgency: 'PLANNED',
    restrictedByDefault: false,
    surveyEligibleByDefault: true,
    authorizerExpected: false,
    requiresDetail: false,
  },

  IMMEDIATE_RESIGNATION: {
    type: 'IMMEDIATE_RESIGNATION',
    receivedDateLabel: 'Notice received',
    label: 'Resignation - immediate',
    guidance: 'The employee resigned and is not working a notice period.',
    initiator: 'EMPLOYEE',
    // Still a resignation: the notice section stays, the period does not.
    noticeApplicable: true,
    noticeServed: false,
    noticeArrangement: 'Immediate resignation - no notice period served.',
    requiredDates: ['receivedAt', 'confirmedLastDay'],
    optionalDates: ['effectiveSeparationAt'],
    forbiddenDates: ['contractEndDate'],
    effectiveDateSource: 'confirmedLastDay',
    defaultsToToday: ['receivedAt', 'confirmedLastDay'],
    baseUrgency: 'IMMEDIATE',
    restrictedByDefault: false,
    surveyEligibleByDefault: true,
    authorizerExpected: false,
    requiresDetail: false,
  },

  TERMINATION: {
    type: 'TERMINATION',
    receivedDateLabel: 'Termination recorded',
    label: 'Termination',
    guidance: 'The company ended the employment.',
    initiator: 'EMPLOYER',
    // Employee notice is not a concept here - the fields are absent, not
    // blank, and the server rejects them (directive 4, 30).
    noticeApplicable: false,
    noticeServed: false,
    noticeArrangement: null,
    requiredDates: ['receivedAt', 'effectiveSeparationAt'],
    optionalDates: ['confirmedLastDay'],
    forbiddenDates: ['contractEndDate'],
    effectiveDateSource: 'effectiveSeparationAt',
    defaultsToToday: ['receivedAt', 'effectiveSeparationAt'],
    baseUrgency: 'IMMEDIATE',
    restrictedByDefault: true,
    surveyEligibleByDefault: false,
    authorizerExpected: true,
    requiresDetail: false,
  },

  RETIREMENT: {
    type: 'RETIREMENT',
    receivedDateLabel: 'Retirement notified',
    label: 'Retirement',
    guidance: 'The employee is retiring.',
    initiator: 'EMPLOYEE',
    // Retirement is notified, not resigned: the concept applies but the
    // wording is its own (directive 10).
    noticeApplicable: true,
    noticeServed: true,
    noticeArrangement: 'Retirement notified in advance of the retirement date.',
    requiredDates: ['receivedAt', 'effectiveSeparationAt'],
    optionalDates: ['confirmedLastDay'],
    forbiddenDates: ['contractEndDate'],
    effectiveDateSource: 'effectiveSeparationAt',
    defaultsToToday: ['receivedAt'],
    baseUrgency: 'PLANNED',
    restrictedByDefault: false,
    surveyEligibleByDefault: true,
    authorizerExpected: false,
    requiresDetail: false,
  },

  CONTRACT_EXPIRY: {
    type: 'CONTRACT_EXPIRY',
    receivedDateLabel: 'Recorded by HR',
    label: 'End of contract',
    guidance: 'A fixed-term contract reached its end date.',
    initiator: 'CONTRACT',
    // Nobody gave notice: the end date was agreed when the contract started.
    noticeApplicable: false,
    noticeServed: false,
    noticeArrangement: 'Contractual end date reached - no notice period applies.',
    requiredDates: ['receivedAt', 'contractEndDate'],
    optionalDates: ['confirmedLastDay', 'effectiveSeparationAt'],
    forbiddenDates: [],
    effectiveDateSource: 'contractEndDate',
    defaultsToToday: ['receivedAt'],
    baseUrgency: 'SCHEDULED',
    restrictedByDefault: false,
    surveyEligibleByDefault: true,
    authorizerExpected: false,
    requiresDetail: false,
  },

  REDUNDANCY: {
    type: 'REDUNDANCY',
    receivedDateLabel: 'Employee notified',
    label: 'Redundancy / position elimination',
    guidance: 'The position was eliminated.',
    initiator: 'EMPLOYER',
    // The employer notifies; the employee does not resign (directive 12).
    noticeApplicable: true,
    noticeServed: true,
    noticeArrangement: 'Redundancy notified by the company.',
    requiredDates: ['receivedAt', 'effectiveSeparationAt'],
    optionalDates: ['confirmedLastDay'],
    forbiddenDates: ['contractEndDate'],
    effectiveDateSource: 'effectiveSeparationAt',
    defaultsToToday: ['receivedAt'],
    baseUrgency: 'PLANNED',
    restrictedByDefault: true,
    surveyEligibleByDefault: true,
    authorizerExpected: true,
    requiresDetail: false,
  },

  OTHER: {
    type: 'OTHER',
    receivedDateLabel: 'Recorded by HR',
    label: 'Other',
    guidance: 'None of the above - HR states what happened.',
    initiator: 'UNSPECIFIED',
    // The one type where the platform must NOT infer. HR says whether notice
    // applies and describes the separation (directive 13).
    noticeApplicable: null,
    noticeServed: null,
    noticeArrangement: null,
    requiredDates: ['receivedAt', 'effectiveSeparationAt'],
    optionalDates: ['confirmedLastDay', 'contractEndDate'],
    forbiddenDates: [],
    effectiveDateSource: 'effectiveSeparationAt',
    defaultsToToday: ['receivedAt'],
    baseUrgency: 'PLANNED',
    restrictedByDefault: false,
    surveyEligibleByDefault: true,
    authorizerExpected: false,
    requiresDetail: true,
  },
};

/** The authoritative profile for a separation type. */
export function separationProfile(type: DepartureType): SeparationProfile {
  return PROFILES[type];
}

export const SEPARATION_PROFILES = PROFILES;

/** Whether a value is one of the canonical types. */
export function isDepartureType(v: unknown): v is DepartureType {
  return typeof v === 'string' && (DEPARTURE_TYPES as readonly string[]).includes(v);
}

export const DEPARTURE_TYPE_LABEL: Readonly<Record<DepartureType, string>> = Object.fromEntries(
  DEPARTURE_TYPES.map((t) => [t, PROFILES[t].label]),
) as Record<DepartureType, string>;

/**
 * Whether employee notice applies to THIS case. Almost always the profile
 * answers; only OTHER defers to what HR recorded.
 */
export function noticeApplies(type: DepartureType, hrOverride: boolean | null): boolean {
  return PROFILES[type].noticeApplicable ?? hrOverride ?? false;
}

/** Whether a notice period is being served on THIS case. */
export function noticeIsServed(type: DepartureType, hrOverride: boolean | null): boolean {
  const profile = PROFILES[type];
  if (profile.noticeServed !== null) return profile.noticeServed;
  return hrOverride ?? false;
}

/** Whether the separation was the employee's own decision. */
export function isVoluntary(type: DepartureType): boolean {
  return PROFILES[type].initiator === 'EMPLOYEE';
}

// --- dates -------------------------------------------------------------------

/** The four distinct date concepts a case can carry (directive 5). */
export interface SeparationDates {
  /** When the employee gave notice, retired or was notified. */
  receivedAt: Date | null;
  /** The final day the employee is expected to perform work. */
  confirmedLastDay: Date | null;
  /** The instant employment formally ends. */
  effectiveSeparationAt: Date | null;
  /** The predetermined contractual completion date. */
  contractEndDate: Date | null;
}

const EMPTY_DATES: SeparationDates = {
  receivedAt: null,
  confirmedLastDay: null,
  effectiveSeparationAt: null,
  contractEndDate: null,
};

/**
 * Which single date this case's operational timing hangs off - the one that
 * IT access removal, asset deadlines and finance notification are measured
 * against. Falls back through the concepts a type can carry, because a
 * half-entered draft still has to render.
 */
export function operativeDate(type: DepartureType, dates: SeparationDates): Date | null {
  const profile = PROFILES[type];
  const order: DateField[] = [
    profile.effectiveDateSource,
    'effectiveSeparationAt',
    'confirmedLastDay',
    'contractEndDate',
  ];
  for (const field of order) {
    const value = dates[field];
    if (value) return value;
  }
  return null;
}

/**
 * How urgent this case is, from the profile AND the dates together.
 *
 * A termination dated next month is not a same-day offboarding, and a
 * planned resignation whose last day has already passed is not still
 * planned - so the type alone never decides this (directive 7, 8, 9).
 */
export function separationUrgency(
  type: DepartureType,
  dates: SeparationDates,
  now: Date,
): SeparationUrgency {
  const operative = operativeDate(type, dates);
  if (!operative) return PROFILES[type].baseUrgency;

  const days = wholeDaysBetween(now, operative);
  // Already gone. Whatever the type says, the work is either overdue or this
  // is a record of something that already happened.
  if (days < 0) return 'HISTORICAL';
  // Today, or an inherently immediate type that has not been pushed out.
  if (days === 0) return 'IMMEDIATE';
  if (PROFILES[type].baseUrgency === 'IMMEDIATE') {
    // A termination or immediate resignation dated ahead is scheduled work,
    // not same-day work - the actions belong on the effective date.
    return days <= 1 ? 'IMMEDIATE' : 'SCHEDULED';
  }
  return PROFILES[type].baseUrgency;
}

/**
 * Calendar days from `from` to `to`, negative when `to` is in the past.
 *
 * Counted in the company's own timezone, not the server's and not UTC. Every
 * date in this platform is a Jamaican working date: an instant stored as
 * midnight UTC is the previous evening locally, and counting it with the
 * host's calendar produced answers a day out - which is the difference
 * between "leaves today" and "left yesterday".
 */
export function wholeDaysBetween(from: Date, to: Date): number {
  const a = DateTime.fromJSDate(from, { zone: APP_ZONE }).startOf('day');
  const b = DateTime.fromJSDate(to, { zone: APP_ZONE }).startOf('day');
  return Math.round(b.diff(a, 'days').days);
}

/**
 * Whether this record is being entered after the event (directive 26).
 * Backdating is legitimate and supported; it is flagged, never blocked.
 */
export function isBackdated(
  type: DepartureType,
  dates: SeparationDates,
  recordedAt: Date,
): boolean {
  const operative = operativeDate(type, dates);
  return operative !== null && wholeDaysBetween(recordedAt, operative) < 0;
}

/**
 * The dates a fresh case of this type should open with. Only what the system
 * can honestly know: today, and the employee's contract end date where the
 * directory holds one (directive 6, 11).
 */
export function defaultDates(
  type: DepartureType,
  today: Date,
  known: { contractEndDate?: Date | null } = {},
): SeparationDates {
  const profile = PROFILES[type];
  const dates: SeparationDates = { ...EMPTY_DATES };
  for (const field of profile.defaultsToToday) dates[field] = today;

  // A contract end date already exists in reliable employee data - HR should
  // not be asked to re-enter it, and the last working day follows it.
  if (type === 'CONTRACT_EXPIRY' && known.contractEndDate) {
    dates.contractEndDate = known.contractEndDate;
    dates.confirmedLastDay = known.contractEndDate;
  }
  // A termination's last working day follows the effective date until HR
  // says otherwise.
  if (type === 'TERMINATION' && dates.effectiveSeparationAt && !dates.confirmedLastDay) {
    dates.confirmedLastDay = dates.effectiveSeparationAt;
  }
  return dates;
}

// --- validation --------------------------------------------------------------

export interface SeparationValidationInput {
  type: DepartureType;
  dates: SeparationDates;
  /** HR's answer for OTHER; ignored for every other type. */
  noticeApplicableOverride?: boolean | null;
  /** HR's description of the separation, required for OTHER. */
  separationTypeDetail?: string | null;
  /** Who authorized it, required where the profile says so. */
  authorizedByName?: string | null;
  /** An authorized reason for an otherwise-rejected date relationship. */
  dateOverrideReason?: string | null;
}

/** "a termination", "an End of contract" - the label is HR's, not ours. */
const article = (label: string) => `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label.toLowerCase()}`;

const DATE_LABEL: Readonly<Record<DateField, string>> = {
  receivedAt: 'Notice received date',
  confirmedLastDay: 'Last working day',
  effectiveSeparationAt: 'Separation effective date',
  contractEndDate: 'Contract end date',
};

/**
 * Server-side separation rules (directive 25, 30).
 *
 * The UI hides fields a type does not use; this rejects them. A direct API
 * call must not be able to attach resignation notice to a termination just
 * because the form normally would not offer it.
 */
export function separationErrors(input: SeparationValidationInput): string[] {
  const profile = PROFILES[input.type];
  const errors: string[] = [];
  const d = input.dates;

  for (const field of profile.requiredDates) {
    if (!d[field]) errors.push(`${DATE_LABEL[field]} is required for ${article(profile.label)}.`);
  }
  for (const field of profile.forbiddenDates) {
    if (d[field]) {
      errors.push(
        `${DATE_LABEL[field]} does not apply to ${article(profile.label)} and cannot be recorded on one.`,
      );
    }
  }

  if (profile.requiresDetail && !input.separationTypeDetail?.trim()) {
    errors.push('Describe the separation: "Other" cannot be interpreted by the platform.');
  }
  if (profile.noticeApplicable === null && input.noticeApplicableOverride == null) {
    errors.push('State whether employee notice applies - the platform cannot infer it.');
  }
  // The authorizer is prompted, never required - see `separationPrompts`.

  // Date relationships. An unusual combination is allowed with an authorized
  // reason rather than blocked outright - a historical case is legitimate
  // and the platform must be able to record what actually happened.
  //
  // Compared by WHOLE DAY, never by instant. A last working day is a date; a
  // notice receipt is a timestamped moment. Comparing them directly made a
  // same-day resignation - notice at 1pm, last day that same date, which is
  // the ordinary shape of an immediate resignation - look like the employee
  // had stopped work before they resigned.
  const relationship: string[] = [];
  if (
    d.receivedAt &&
    d.confirmedLastDay &&
    wholeDaysBetween(d.receivedAt, d.confirmedLastDay) < 0
  ) {
    relationship.push('The last working day is before the separation was recorded.');
  }
  if (
    d.receivedAt &&
    d.effectiveSeparationAt &&
    wholeDaysBetween(d.receivedAt, d.effectiveSeparationAt) < 0
  ) {
    relationship.push('Employment ends before the separation was recorded.');
  }
  // Employment can end at close of business ON the last working day, so only
  // a date strictly before it is contradictory.
  if (
    d.confirmedLastDay &&
    d.effectiveSeparationAt &&
    wholeDaysBetween(d.confirmedLastDay, d.effectiveSeparationAt) < 0
  ) {
    relationship.push('Employment ends before the last working day.');
  }
  if (relationship.length > 0 && !input.dateOverrideReason?.trim()) {
    errors.push(
      ...relationship.map(
        (r) => `${r} Record a reason if this is correct - it is kept in the audit trail.`,
      ),
    );
  }

  return errors;
}

/**
 * What HR should be asked for but is not blocked on. Kept apart from
 * `separationErrors` precisely because the two are different: an error stops
 * the record being wrong, a prompt stops it being thin.
 */
export function separationPrompts(input: SeparationValidationInput): string[] {
  const profile = PROFILES[input.type];
  const prompts: string[] = [];
  if (profile.authorizerExpected && !input.authorizedByName?.trim()) {
    prompts.push(`Record who authorized this ${profile.label.toLowerCase()} where it is known.`);
  }
  if (!input.dates.confirmedLastDay && profile.optionalDates.includes('confirmedLastDay')) {
    prompts.push('A last working day makes every downstream deadline exact.');
  }
  return prompts;
}

/**
 * The fields that would lose their meaning if the case changed to this type
 * (directive 16). A notice date is not a termination date, so changing the
 * type never silently re-reads one as the other.
 */
export function incompatibleDates(
  from: DepartureType,
  to: DepartureType,
  dates: SeparationDates,
): DateField[] {
  if (from === to) return [];
  return PROFILES[to].forbiddenDates.filter((field) => dates[field] != null);
}
