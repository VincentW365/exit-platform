/**
 * What each separation type is expected to do. Most of it is READ from the
 * platform's own separation profile (the single source of truth, DEC-058)
 * so the suite cannot drift from the product; the rest is the directive's
 * wording rules and the scenario's own choices (which benefits apply, which
 * assets to tick), kept here so a reader can see every assumption in one
 * place.
 */
import type { ProfileCatalogue } from './db';

export type Applicability = 'YES' | 'NO' | 'UNKNOWN';

export interface TypeExpectation {
  type: string;
  label: string;
  receivedDateLabel: string;
  initiator: string;
  employeeInitiated: boolean;
  employerInitiated: boolean;
  noticeApplicable: boolean | null;
  noticeServed: boolean | null;
  requiredDates: string[];
  optionalDates: string[];
  forbiddenDates: string[];
  defaultsToToday: string[];
  baseUrgency: string;
  restricted: boolean;
  surveyExpected: boolean;
  aboutStep: 'none' | 'authorizer' | 'detail';
  letterType: string | null;
  /** Words that must never describe this separation. */
  forbiddenWording: RegExp;
  /** Words that should describe it (a hint for the human-review rows). */
  expectedWording: RegExp;
  /** Scenario choices. */
  benefits: { health: Applicability; life: Applicability };
  tickAssets: Array<{ type: string; identifier: string }>;
  /** Employer-initiated: internal notices are held until the effective instant. */
  internalEmailsHeldUntilEffective: boolean;
}

const WORDS: Record<string, { forbidden: RegExp; expected: RegExp }> = {
  RESIGNATION_WITH_NOTICE: { forbidden: /terminat|redundan|retire/i, expected: /resign/i },
  IMMEDIATE_RESIGNATION: { forbidden: /terminat|redundan|retire/i, expected: /resign/i },
  TERMINATION: { forbidden: /resign|retire|redundan/i, expected: /terminat/i },
  RETIREMENT: { forbidden: /resign|terminat|redundan/i, expected: /retire/i },
  CONTRACT_EXPIRY: { forbidden: /resign|terminat|redundan|retire/i, expected: /contract/i },
  REDUNDANCY: { forbidden: /resign|terminat|retire/i, expected: /redundan|position/i },
  OTHER: { forbidden: /resign|terminat|redundan|retire/i, expected: /other|separation/i },
};

const BENEFITS: Record<string, { health: Applicability; life: Applicability }> = {
  RESIGNATION_WITH_NOTICE: { health: 'YES', life: 'YES' },
  IMMEDIATE_RESIGNATION: { health: 'NO', life: 'NO' },
  TERMINATION: { health: 'YES', life: 'NO' },
  RETIREMENT: { health: 'YES', life: 'YES' },
  CONTRACT_EXPIRY: { health: 'NO', life: 'YES' },
  REDUNDANCY: { health: 'YES', life: 'YES' },
  OTHER: { health: 'NO', life: 'NO' },
};

/**
 * Assets are HR-entered on the case ("Which company assets does this
 * employee hold?") - the product's own path for an employee whose issued
 * assets are not in the register. Only two scenarios tick any, so the
 * no-asset path is exercised by the others.
 */
const ASSETS: Record<string, Array<{ type: string; identifier: string }>> = {
  RESIGNATION_WITH_NOTICE: [
    { type: 'LAPTOP', identifier: 'REGRESSION-LAPTOP-01' },
    { type: 'ACCESS_CARD', identifier: 'REGRESSION-CARD-01' },
  ],
  TERMINATION: [
    { type: 'LAPTOP', identifier: 'REGRESSION-LAPTOP-03' },
    { type: 'MOBILE_PHONE', identifier: 'REGRESSION-PHONE-03' },
  ],
};

export function expectationsFrom(catalogue: ProfileCatalogue): TypeExpectation[] {
  return catalogue.types.map(({ type, profile, letterType }) => {
    const words = WORDS[type] ?? { forbidden: /(?!)/, expected: /./ };
    return {
      type,
      label: profile.label,
      receivedDateLabel: profile.receivedDateLabel,
      initiator: profile.initiator,
      employeeInitiated: profile.initiator === 'EMPLOYEE',
      employerInitiated: profile.initiator === 'EMPLOYER',
      noticeApplicable: profile.noticeApplicable,
      noticeServed: profile.noticeServed,
      requiredDates: profile.requiredDates,
      optionalDates: profile.optionalDates,
      forbiddenDates: profile.forbiddenDates,
      defaultsToToday: profile.defaultsToToday,
      baseUrgency: profile.baseUrgency,
      restricted: profile.restrictedByDefault,
      surveyExpected: profile.surveyEligibleByDefault,
      aboutStep: profile.requiresDetail
        ? 'detail'
        : profile.authorizerExpected
          ? 'authorizer'
          : 'none',
      letterType,
      forbiddenWording: words.forbidden,
      expectedWording: words.expected,
      benefits: BENEFITS[type] ?? { health: 'UNKNOWN', life: 'UNKNOWN' },
      tickAssets: ASSETS[type] ?? [],
      internalEmailsHeldUntilEffective: profile.initiator === 'EMPLOYER',
    };
  });
}

/** Business labels for notification types (mirrors the case UI). */
export const EMAIL_LABELS: Record<string, string> = {
  IT_ACCESS_REMOVAL: 'IT access removal',
  FINANCE_OFFBOARDING: 'Finance / payroll offboarding notice',
  LINE_MANAGER_HANDOVER: 'Line manager departure notice',
  RETURN_ITEMS_CHECKLIST: 'Exit checklist for return items (employee-facing link)',
  RESIGNATION_ACCEPTANCE_LETTER: 'Resignation acceptance letter (cover email + PDF)',
  SAGICOR_GROUP_HEALTH_REMOVAL: 'Sagicor group health removal',
  NCB_GROUP_LIFE_REMOVAL: 'NCB group life removal',
  SURVEY_INVITATION_REFERENCE: 'Exit survey invitation reference',
  MANUAL_EXCEPTION_NOTIFICATION: 'Manual exception notification',
  PAYROLL_OR_BANK_NOTIFICATION: 'Payroll / bank notification',
  OTHER_EXTERNAL_OFFBOARDING_NOTIFICATION: 'Other approved provider notice',
};

/** Which emails a scenario expects to exist as records after activation. */
export function expectedEmailTypes(x: TypeExpectation): string[] {
  const types = [
    'IT_ACCESS_REMOVAL',
    'RETURN_ITEMS_CHECKLIST',
    'LINE_MANAGER_HANDOVER',
    'FINANCE_OFFBOARDING',
  ];
  if (x.benefits.health === 'YES') types.push('SAGICOR_GROUP_HEALTH_REMOVAL');
  if (x.benefits.life === 'YES') types.push('NCB_GROUP_LIFE_REMOVAL');
  if (x.letterType) types.push('RESIGNATION_ACCEPTANCE_LETTER');
  return types;
}
