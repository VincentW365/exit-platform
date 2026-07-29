import { describe, expect, it } from 'vitest';
import {
  automationPermitted,
  cohortPurposeErrors,
  isOperationalForReporting,
  purposeChangeErrors,
} from '../src/cohort.ts';

describe('measurement cohort vs record purpose (REQ-CASE-013)', () => {
  it('OPERATIONAL requires a measurement cohort', () => {
    expect(
      cohortPurposeErrors({ recordPurpose: 'OPERATIONAL', measurementCohort: null }),
    ).toHaveLength(1);
    expect(
      cohortPurposeErrors({ recordPurpose: 'OPERATIONAL', measurementCohort: 'BASELINE' }),
    ).toEqual([]);
  });

  it('TRAINING and TEST must not carry a business cohort', () => {
    expect(
      cohortPurposeErrors({ recordPurpose: 'TRAINING', measurementCohort: 'BASELINE' }),
    ).toHaveLength(1);
    expect(cohortPurposeErrors({ recordPurpose: 'TEST', measurementCohort: 'PILOT' })).toHaveLength(
      1,
    );
    expect(cohortPurposeErrors({ recordPurpose: 'TRAINING', measurementCohort: null })).toEqual([]);
    expect(cohortPurposeErrors({ recordPurpose: 'TEST', measurementCohort: null })).toEqual([]);
  });
});

describe('record purpose corrections (BR-CASE-014)', () => {
  it('never silent: a reason is mandatory in both directions', () => {
    expect(
      purposeChangeErrors({ from: 'OPERATIONAL', to: 'TEST', caseStatus: 'DRAFT', reason: '' }),
    ).toContainEqual(expect.stringContaining('requires a reason'));
    expect(
      purposeChangeErrors({ from: 'TEST', to: 'OPERATIONAL', caseStatus: 'DRAFT', reason: '  ' }),
    ).toContainEqual(expect.stringContaining('requires a reason'));
  });

  it('forbidden once the record has been used operationally', () => {
    for (const status of ['PENDING_HR_REVIEW', 'APPROVED', 'CANCELLED']) {
      expect(
        purposeChangeErrors({
          from: 'OPERATIONAL',
          to: 'TEST',
          caseStatus: status,
          reason: 'entered as a test by mistake',
        }),
      ).toContainEqual(expect.stringContaining('before the record is used operationally'));
    }
  });

  it('allowed as an audited correction while DRAFT', () => {
    expect(
      purposeChangeErrors({
        from: 'TEST',
        to: 'OPERATIONAL',
        caseStatus: 'DRAFT',
        reason: 'record was real, mis-flagged at creation',
      }),
    ).toEqual([]);
  });
});

describe('reporting and automation guards', () => {
  it('business reporting includes only OPERATIONAL records (REQ-REPORT-014)', () => {
    expect(
      isOperationalForReporting({ recordPurpose: 'OPERATIONAL', measurementCohort: 'BASELINE' }),
    ).toBe(true);
    expect(isOperationalForReporting({ recordPurpose: 'TRAINING', measurementCohort: null })).toBe(
      false,
    );
    expect(isOperationalForReporting({ recordPurpose: 'TEST', measurementCohort: null })).toBe(
      false,
    );
  });

  it('BASELINE cohort disables improvement automation regardless of flags (DEC-007)', () => {
    expect(
      automationPermitted({ recordPurpose: 'OPERATIONAL', measurementCohort: 'BASELINE' }, true),
    ).toBe(false);
    expect(
      automationPermitted({ recordPurpose: 'OPERATIONAL', measurementCohort: 'PILOT' }, true),
    ).toBe(true);
  });

  it('TRAINING/TEST records never trigger automation even with flags on', () => {
    expect(automationPermitted({ recordPurpose: 'TRAINING', measurementCohort: null }, true)).toBe(
      false,
    );
    expect(automationPermitted({ recordPurpose: 'TEST', measurementCohort: null }, true)).toBe(
      false,
    );
  });

  it('flags default off keeps everything off (IC-S1-004)', () => {
    expect(
      automationPermitted({ recordPurpose: 'OPERATIONAL', measurementCohort: 'PILOT' }, false),
    ).toBe(false);
  });
});
