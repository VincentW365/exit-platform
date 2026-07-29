/**
 * Measurement cohort and record purpose - two separate dimensions
 * (REQ-CASE-013, BR-CASE-013/014, Directive 0.1 section C).
 *
 * TRAINING and TEST are record purposes, never business cohorts.
 */
export const MEASUREMENT_COHORTS = ['BASELINE', 'PILOT', 'POST_ROLLOUT'] as const;
export type MeasurementCohort = (typeof MEASUREMENT_COHORTS)[number];

export const RECORD_PURPOSES = ['OPERATIONAL', 'TRAINING', 'TEST'] as const;
export type RecordPurpose = (typeof RECORD_PURPOSES)[number];

export interface CohortPurpose {
  readonly measurementCohort: MeasurementCohort | null;
  readonly recordPurpose: RecordPurpose;
}

/** Structural validity: OPERATIONAL requires a cohort; TRAINING/TEST forbid one. */
export function cohortPurposeErrors(v: CohortPurpose): string[] {
  const errors: string[] = [];
  if (v.recordPurpose === 'OPERATIONAL' && v.measurementCohort === null) {
    errors.push(
      'An OPERATIONAL record requires a measurement cohort (BASELINE, PILOT or POST_ROLLOUT).',
    );
  }
  if (v.recordPurpose !== 'OPERATIONAL' && v.measurementCohort !== null) {
    errors.push(`A ${v.recordPurpose} record must not carry a business measurement cohort.`);
  }
  return errors;
}

/**
 * Record-purpose changes are allowed only through an authorized, reasoned,
 * audited correction and only before the record has been used operationally
 * (BR-CASE-014). "Used operationally" for Stage 1 means the case has left
 * DRAFT. Silent conversion in either direction is forbidden - the caller must
 * supply a reason, and the service layer must write the audit event.
 */
export function purposeChangeErrors(args: {
  readonly from: RecordPurpose;
  readonly to: RecordPurpose;
  readonly caseStatus: string;
  readonly reason: string | undefined;
}): string[] {
  const errors: string[] = [];
  if (args.from === args.to) {
    errors.push('The record purpose is unchanged.');
    return errors;
  }
  if (!args.reason?.trim()) {
    errors.push('Changing the record purpose requires a reason (audited correction).');
  }
  if (args.caseStatus !== 'DRAFT') {
    errors.push(
      'The record purpose can only be corrected before the record is used operationally (while DRAFT).',
    );
  }
  return errors;
}

/**
 * Reporting predicate: operational business reporting must include only
 * OPERATIONAL records (REQ-REPORT-014). TRAINING and TEST are excluded from
 * every business report and KPI.
 */
export function isOperationalForReporting(v: CohortPurpose): boolean {
  return v.recordPurpose === 'OPERATIONAL' && v.measurementCohort !== null;
}

/**
 * Baseline automation guard (DEC-007 / IC-S1-004): improvement automation is
 * disabled for BASELINE-cohort records, and TRAINING/TEST records must never
 * trigger live side effects. In Stage 1 every automation is disabled anyway;
 * this predicate is the single place later stages must consult.
 */
export function automationPermitted(v: CohortPurpose, featureFlagEnabled: boolean): boolean {
  if (!featureFlagEnabled) return false;
  if (v.recordPurpose !== 'OPERATIONAL') return false;
  if (v.measurementCohort === 'BASELINE') return false;
  return true;
}
