import { describe, expect, it } from 'vitest';
import {
  CASE_STATUSES,
  checkTransition,
  submitReadinessErrors,
  type CaseStatus,
  type CaseTransitionAction,
} from '../src/caseStates.ts';

const ACTIONS: readonly CaseTransitionAction[] = [
  'submit',
  'return',
  'approve',
  'cancel',
  'void',
  'activate',
  'hold',
  'resume',
  'requestClearance',
  'clearanceReturn',
  'complete',
  'reopen',
];

/**
 * The complete allowed matrix: the Stage 1 intake segment plus the Stage 3
 * operational segment (Directive 3 C.4/C.5 widened cancel/void to operational
 * statuses). Everything else must be rejected.
 */
const ALLOWED: ReadonlyArray<[CaseTransitionAction, CaseStatus]> = [
  ['submit', 'DRAFT'],
  ['return', 'PENDING_HR_REVIEW'],
  ['approve', 'PENDING_HR_REVIEW'],
  ['cancel', 'DRAFT'],
  ['cancel', 'PENDING_HR_REVIEW'],
  ['cancel', 'APPROVED'],
  ['cancel', 'ACTIVE'],
  ['cancel', 'ON_HOLD'],
  ['cancel', 'REOPENED'],
  ['void', 'DRAFT'],
  ['void', 'PENDING_HR_REVIEW'],
  ['void', 'APPROVED'],
  ['void', 'ACTIVE'],
  ['void', 'ON_HOLD'],
  ['void', 'REOPENED'],
  ['activate', 'APPROVED'],
  ['hold', 'ACTIVE'],
  ['resume', 'ON_HOLD'],
  ['requestClearance', 'ACTIVE'],
  ['clearanceReturn', 'CLEARANCE_REVIEW'],
  ['complete', 'CLEARANCE_REVIEW'],
  ['reopen', 'COMPLETED'],
];

describe('case state machine (Stage 1 intake + Stage 3 operational segment)', () => {
  it('permits exactly the approved transitions and forbids every other combination', () => {
    for (const action of ACTIONS) {
      for (const status of CASE_STATUSES) {
        const allowed = ALLOWED.some(([a, s]) => a === action && s === status);
        const result = checkTransition(action, status, 'a reason');
        expect(result.ok, `${action} from ${status}`).toBe(allowed);
      }
    }
  });

  it('maps each action to the approved target state (APPROVED, not APPROVED_OR_ACCEPTED)', () => {
    expect(checkTransition('submit', 'DRAFT', undefined).to).toBe('PENDING_HR_REVIEW');
    expect(checkTransition('approve', 'PENDING_HR_REVIEW', undefined).to).toBe('APPROVED');
    expect(checkTransition('return', 'PENDING_HR_REVIEW', 'fix dates').to).toBe('DRAFT');
    expect(checkTransition('cancel', 'DRAFT', 'duplicate').to).toBe('CANCELLED');
    expect(checkTransition('void', 'APPROVED', 'entered in error').to).toBe('VOIDED');
    expect(checkTransition('activate', 'APPROVED', undefined).to).toBe('ACTIVE');
    expect(checkTransition('hold', 'ACTIVE', 'legal query pending').to).toBe('ON_HOLD');
    expect(checkTransition('resume', 'ON_HOLD', 'query resolved').to).toBe('ACTIVE');
    expect(checkTransition('requestClearance', 'ACTIVE', undefined).to).toBe('CLEARANCE_REVIEW');
    expect(checkTransition('complete', 'CLEARANCE_REVIEW', undefined).to).toBe('COMPLETED');
    expect(checkTransition('reopen', 'COMPLETED', 'late evidence').to).toBe('REOPENED');
  });

  it('requires a reason for return, cancel, void, hold, resume and reopen', () => {
    expect(checkTransition('return', 'PENDING_HR_REVIEW', '').ok).toBe(false);
    expect(checkTransition('cancel', 'DRAFT', '   ').ok).toBe(false);
    expect(checkTransition('void', 'DRAFT', undefined).ok).toBe(false);
    expect(checkTransition('hold', 'ACTIVE', '').ok).toBe(false);
    expect(checkTransition('resume', 'ON_HOLD', undefined).ok).toBe(false);
    expect(checkTransition('reopen', 'COMPLETED', '').ok).toBe(false);
    expect(checkTransition('submit', 'DRAFT', undefined).ok).toBe(true);
  });

  it('operational states accept only their own actions (no shortcuts)', () => {
    expect(checkTransition('approve', 'ACTIVE', 'x').ok).toBe(false);
    expect(checkTransition('activate', 'ACTIVE', undefined).ok).toBe(false); // no double activation
    expect(checkTransition('complete', 'ACTIVE', undefined).ok).toBe(false); // clearance gate first
    expect(checkTransition('cancel', 'CLEARANCE_REVIEW', 'x').ok).toBe(false); // return first
    expect(checkTransition('reopen', 'CANCELLED', 'x').ok).toBe(false);
  });
});

describe('submit readiness (BR-CASE-002)', () => {
  const valid = {
    departureType: 'RESIGNATION_WITH_NOTICE' as const,
    receivedAt: new Date('2026-07-20T14:00:00Z'),
    receiptSource: 'Signed letter received by HR',
    effectiveSeparationAt: new Date('2026-08-14T22:00:00Z'),
    ownerId: 'user-1',
    department: 'Sales',
    location: 'Kingston',
    employeeSourceId: 'EMP-TEST-001',
  };

  it('accepts a complete intake', () => {
    expect(submitReadinessErrors(valid)).toEqual([]);
  });

  it('does NOT require a reason category at case creation (IC-S1-008)', () => {
    // The readiness input has no reason field at all - the taxonomy decision
    // DEC-031 is OPEN and must not block intake.
    expect(Object.keys(valid)).not.toContain('reasonCategoryId');
  });

  it('flags every missing required field', () => {
    const errors = submitReadinessErrors({
      departureType: null,
      receivedAt: null,
      receiptSource: null,
      effectiveSeparationAt: null,
      ownerId: null,
      department: null,
      location: null,
      employeeSourceId: null,
    });
    expect(errors.length).toBe(8);
  });

  it('rejects a future receipt timestamp (BaselineDataCapturePlan timestamp integrity)', () => {
    const errors = submitReadinessErrors({
      ...valid,
      receivedAt: new Date(Date.now() + 60 * 60_000),
    });
    expect(errors.some((e) => e.includes('future'))).toBe(true);
  });
});
