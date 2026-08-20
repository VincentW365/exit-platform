/**
 * Deterministic derived-action rules engine (Directive 6.3 B/C).
 *
 * Given the facts the platform already holds, derive every required
 * offboarding action instead of asking HR to pick values from dropdowns.
 * Pure and deterministic: same facts -> same actions; injectable clock; no
 * generative AI, no randomness. The service layer persists the results as
 * CaseRequiredAction rows with full provenance (rule, source fields, result,
 * override, audit).
 */
import { itEmailScheduledAt } from './emailActions.ts';
import { surveyEligibility } from './survey.ts';
import type { NotificationType } from './notifications.ts';

/** Version stamp recorded on every derivation (Directive C: config version). */
export const DERIVATION_RULES_VERSION = 'hr-validated-workflow-v2';

export const BENEFITS_APPLICABILITY = ['YES', 'NO', 'UNKNOWN'] as const;
export type BenefitsApplicability = (typeof BENEFITS_APPLICABILITY)[number];

export const REQUIRED_ACTION_GROUPS = [
  'HR',
  'DOCUMENTS',
  'MANAGER_HANDOVER',
  'IT',
  'FINANCE',
  'BENEFITS',
  'ASSETS',
  'SURVEY',
  'CLEARANCE',
] as const;
export type RequiredActionGroup = (typeof REQUIRED_ACTION_GROUPS)[number];

export const REQUIRED_ACTION_KINDS = [
  'EMAIL_ACTION',
  'ASSET_RECOVERY',
  'SURVEY_INVITATION',
  'BENEFITS_CONFIRMATION',
] as const;
export type RequiredActionKind = (typeof REQUIRED_ACTION_KINDS)[number];

/**
 * First-class determinations (Directive B): DERIVED = the rule decided from
 * source data; DEFAULTED = a safe default applied; REQUIRES_REVIEW = HR must
 * confirm something first; EXCEPTION = blocked and needs attention;
 * NOT_APPLICABLE = the rule decided no action is needed.
 */
export const DETERMINATIONS = [
  'DERIVED',
  'DEFAULTED',
  'REQUIRES_REVIEW',
  'EXCEPTION',
  'NOT_APPLICABLE',
] as const;
export type Determination = (typeof DETERMINATIONS)[number];

/** The facts a derivation consumes - everything the platform already knows. */
export interface DerivationFacts {
  departureType: 'RESIGNATION_WITH_NOTICE' | 'IMMEDIATE_RESIGNATION' | 'TERMINATION';
  classification: 'CONFIDENTIAL' | 'RESTRICTED';
  effectiveSeparationAt: Date;
  groupHealthApplicability: BenefitsApplicability;
  groupLifeApplicability: BenefitsApplicability;
  otherProviderApplicability: BenefitsApplicability;
  surveyEligibilityOverridden: boolean;
  issuedAssets: ReadonlyArray<{
    id: string;
    assetType: string;
    label: string;
  }>;
}

export interface DerivedActionSpec {
  /** Stable idempotency key within the case, e.g. `EMAIL:IT_ACCESS_REMOVAL`. */
  actionKey: string;
  group: RequiredActionGroup;
  kind: RequiredActionKind;
  /** Business-language title (correction 7). */
  title: string;
  applicable: boolean;
  determination: Determination;
  /** Deterministic rule identifier for audit provenance. */
  ruleKey: string;
  /** The exact inputs the rule consumed. */
  sourceFields: Record<string, string | boolean | number | null>;
  /** The rule output beyond applicability (schedule, linked type, ...). */
  result: Record<string, string | boolean | number | null>;
  /** For EMAIL_ACTION rows: which notification type this action produces. */
  notificationType: NotificationType | null;
  /** For EMAIL_ACTION rows: when the email should go out (null = not yet). */
  scheduledSendAt: Date | null;
}

function benefitsRule(args: {
  key: string;
  group: RequiredActionGroup;
  title: string;
  applicability: BenefitsApplicability;
  notificationType: NotificationType;
  ruleKey: string;
  sourceField: string;
  now: Date;
}): DerivedActionSpec {
  const { applicability } = args;
  return {
    actionKey: args.key,
    group: args.group,
    kind: 'EMAIL_ACTION',
    title: args.title,
    applicable: applicability === 'YES',
    determination:
      applicability === 'YES'
        ? 'DERIVED'
        : applicability === 'NO'
          ? 'NOT_APPLICABLE'
          : 'REQUIRES_REVIEW',
    ruleKey: args.ruleKey,
    sourceFields: { [args.sourceField]: applicability },
    result: {
      applicability,
      reason:
        applicability === 'YES'
          ? 'HR confirmed the benefit applies; the provider notification is prepared.'
          : applicability === 'NO'
            ? 'HR confirmed the benefit does not apply; no notification is created.'
            : 'Applicability is unknown; confirm it under Benefits & providers.',
    },
    notificationType: applicability === 'YES' ? args.notificationType : null,
    scheduledSendAt: applicability === 'YES' ? args.now : null,
  };
}

/**
 * The rules engine. Derives the full required-action set for one case at one
 * instant. Deterministic and total: every action the platform can know about
 * is present with an explicit determination - nothing silently missing.
 */
export function deriveRequiredActions(facts: DerivationFacts, now: Date): DerivedActionSpec[] {
  const specs: DerivedActionSpec[] = [];

  // --- IT access removal (always required for an active employee; U) --------
  const itSendAt = itEmailScheduledAt({
    departureType: facts.departureType,
    effectiveSeparationAt: facts.effectiveSeparationAt,
    now,
  });
  specs.push({
    actionKey: 'EMAIL:IT_ACCESS_REMOVAL',
    group: 'IT',
    kind: 'EMAIL_ACTION',
    title: 'IT access-removal notification',
    applicable: true,
    determination: 'DERIVED',
    ruleKey: 'RULE_IT_ACCESS_EMAIL_V1',
    sourceFields: {
      departureType: facts.departureType,
      classification: facts.classification,
      effectiveSeparationAt: facts.effectiveSeparationAt.toISOString(),
    },
    result: {
      schedule:
        facts.departureType === 'TERMINATION'
          ? 'Confidential timing: released one hour before the effective separation time.'
          : 'Sent when the offboarding process starts, stating the exact effective time.',
      exactEffectiveTime: facts.effectiveSeparationAt.toISOString(),
    },
    notificationType: 'IT_ACCESS_REMOVAL',
    scheduledSendAt: itSendAt,
  });

  // --- Exit checklist for return items (owner directive, 2026-08-19) --------
  // Sent when the case activates, carrying a secure link to this employee's
  // checklist. Sending is a REQUEST: completion is the submitted form.
  specs.push({
    actionKey: 'EMAIL:RETURN_ITEMS_CHECKLIST',
    group: 'ASSETS',
    kind: 'EMAIL_ACTION',
    title: 'Exit checklist for return items',
    applicable: true,
    determination: 'DERIVED',
    ruleKey: 'RULE_RETURN_ITEMS_CHECKLIST_V1',
    sourceFields: { departureType: facts.departureType },
    result: {
      schedule: 'Sent when the offboarding process starts, with a secure form link.',
    },
    notificationType: 'RETURN_ITEMS_CHECKLIST',
    scheduledSendAt: now,
  });

  // --- Line manager departure notice (owner decision, 2026-08-19) -----------
  // The manager has no login and no task in the platform. They receive one
  // controlled email telling them who is leaving, when, and what to do; the
  // work itself happens in their own team, outside this system.
  specs.push({
    actionKey: 'EMAIL:MANAGER_DEPARTURE_NOTICE',
    group: 'MANAGER_HANDOVER',
    kind: 'EMAIL_ACTION',
    title: 'Line manager departure notice',
    applicable: true,
    determination: 'DERIVED',
    ruleKey: 'RULE_MANAGER_DEPARTURE_EMAIL_V1',
    sourceFields: {
      departureType: facts.departureType,
      classification: facts.classification,
    },
    result: {
      schedule:
        facts.departureType === 'TERMINATION'
          ? 'Confidential timing: released at the effective separation time.'
          : 'Sent when the offboarding process starts.',
    },
    notificationType: 'LINE_MANAGER_HANDOVER',
    scheduledSendAt:
      facts.departureType === 'TERMINATION'
        ? facts.effectiveSeparationAt.getTime() > now.getTime()
          ? facts.effectiveSeparationAt
          : now
        : now,
  });

  // --- Finance notification (always required) --------------------------------
  specs.push({
    actionKey: 'EMAIL:FINANCE_OFFBOARDING',
    group: 'FINANCE',
    kind: 'EMAIL_ACTION',
    title: 'Finance offboarding notification',
    applicable: true,
    determination: 'DERIVED',
    ruleKey: 'RULE_FINANCE_EMAIL_V1',
    sourceFields: { departureType: facts.departureType },
    result: {
      schedule:
        facts.departureType === 'TERMINATION'
          ? 'Confidential timing: released at the effective separation time.'
          : 'Sent when the offboarding process starts.',
    },
    notificationType: 'FINANCE_OFFBOARDING',
    scheduledSendAt:
      facts.departureType === 'TERMINATION'
        ? facts.effectiveSeparationAt.getTime() > now.getTime()
          ? facts.effectiveSeparationAt
          : now
        : now,
  });

  // --- Benefits / external providers (V) -------------------------------------
  specs.push(
    benefitsRule({
      key: 'EMAIL:GROUP_HEALTH_REMOVAL',
      group: 'BENEFITS',
      title: 'Group-health removal notification',
      applicability: facts.groupHealthApplicability,
      notificationType: 'SAGICOR_GROUP_HEALTH_REMOVAL',
      ruleKey: 'RULE_GROUP_HEALTH_V1',
      sourceField: 'groupHealthApplicability',
      now,
    }),
    benefitsRule({
      key: 'EMAIL:GROUP_LIFE_REMOVAL',
      group: 'BENEFITS',
      title: 'Group-life removal notification',
      applicability: facts.groupLifeApplicability,
      notificationType: 'NCB_GROUP_LIFE_REMOVAL',
      ruleKey: 'RULE_GROUP_LIFE_V1',
      sourceField: 'groupLifeApplicability',
      now,
    }),
  );

  // Other providers: the platform cannot know WHICH other institution applies,
  // so YES surfaces a review action instead of fabricating a recipient (B: no
  // invented rules). NO/UNKNOWN behave like the other benefits rules.
  const other = facts.otherProviderApplicability;
  specs.push({
    actionKey: 'EMAIL:OTHER_PROVIDER',
    group: 'BENEFITS',
    kind: 'EMAIL_ACTION',
    title: 'Other provider notification',
    applicable: other === 'YES',
    determination: other === 'YES' ? 'REQUIRES_REVIEW' : 'NOT_APPLICABLE',
    ruleKey: 'RULE_OTHER_PROVIDER_V1',
    sourceFields: { otherProviderApplicability: other },
    result: {
      applicability: other,
      reason:
        other === 'YES'
          ? 'HR indicated another provider applies - prepare the specific notification(s).'
          : 'No other provider applies; nothing to prepare.',
    },
    notificationType: other === 'YES' ? 'OTHER_EXTERNAL_OFFBOARDING_NOTIFICATION' : null,
    scheduledSendAt: null,
  });

  // Benefits confirmation itself (when anything is still UNKNOWN).
  const unknowns = [
    ['Group health', facts.groupHealthApplicability],
    ['Group life', facts.groupLifeApplicability],
    ['Other provider', facts.otherProviderApplicability],
  ].filter(([, v]) => v === 'UNKNOWN');
  specs.push({
    actionKey: 'BENEFITS:CONFIRMATION',
    group: 'BENEFITS',
    kind: 'BENEFITS_CONFIRMATION',
    title: 'Confirm benefits applicability',
    applicable: unknowns.length > 0,
    determination: unknowns.length > 0 ? 'REQUIRES_REVIEW' : 'DERIVED',
    ruleKey: 'RULE_BENEFITS_CONFIRM_V1',
    sourceFields: {
      groupHealthApplicability: facts.groupHealthApplicability,
      groupLifeApplicability: facts.groupLifeApplicability,
      otherProviderApplicability: facts.otherProviderApplicability,
    },
    result: {
      unresolved: unknowns.map(([label]) => label).join(', ') || 'none',
    },
    notificationType: null,
    scheduledSendAt: null,
  });

  // --- Asset recovery: strictly from issued assets (G) ------------------------
  if (facts.issuedAssets.length === 0) {
    specs.push({
      actionKey: 'ASSET:NONE',
      group: 'ASSETS',
      kind: 'ASSET_RECOVERY',
      title: 'Company assets',
      applicable: false,
      determination: 'NOT_APPLICABLE',
      ruleKey: 'RULE_ASSETS_FROM_ISSUED_V1',
      sourceFields: { issuedAssetCount: 0 },
      result: { reason: 'No company assets are recorded as issued to this employee.' },
      notificationType: null,
      scheduledSendAt: null,
    });
  }
  for (const asset of facts.issuedAssets) {
    specs.push({
      actionKey: `ASSET:${asset.id}`,
      group: 'ASSETS',
      kind: 'ASSET_RECOVERY',
      title: `Recover: ${asset.label}`,
      applicable: true,
      determination: 'DERIVED',
      ruleKey: 'RULE_ASSETS_FROM_ISSUED_V1',
      sourceFields: { issuedAssetId: asset.id, assetType: asset.assetType },
      result: { requirement: 'RETURN_REQUIRED' },
      notificationType: null,
      scheduledSendAt: null,
    });
  }

  // --- Exit survey (automatic scheduling per configured rule) -----------------
  const eligibility = surveyEligibility(facts.departureType);
  const surveyApplicable = eligibility.eligibleByDefault || facts.surveyEligibilityOverridden;
  specs.push({
    actionKey: 'SURVEY:INVITATION',
    group: 'SURVEY',
    kind: 'SURVEY_INVITATION',
    title: 'Exit survey invitation',
    applicable: surveyApplicable,
    determination: surveyApplicable
      ? 'DERIVED'
      : eligibility.requiresOverride
        ? 'NOT_APPLICABLE'
        : 'DEFAULTED',
    ruleKey: 'RULE_SURVEY_ELIGIBILITY_V1',
    sourceFields: {
      departureType: facts.departureType,
      overridden: facts.surveyEligibilityOverridden,
    },
    result: {
      reason: surveyApplicable
        ? 'Eligible - the invitation is scheduled after the effective separation.'
        : 'Termination cases require an explicit HR-Manager override for the survey.',
    },
    notificationType: null,
    scheduledSendAt: null,
  });

  return specs;
}
