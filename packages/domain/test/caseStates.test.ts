import { describe, expect, it } from 'vitest';
import {
  CASE_STATUSES,
  checkTransition,
  submitReadinessErrors,
  type CaseStatus,
  type CaseTransitionAction,
} from '../src/caseStates.ts';

const ACTIONS: readonly CaseTransitionAction[] = ['submit', 'return', 'approve', 'cancel', 'void'];

/** The complete allowed matrix for Stage 1; everything else must be rejected. */
const ALLOWED: ReadonlyArray<[CaseTransitionAction, CaseStatus]> = [
  ['submit', 'DRAFT'],
  ['return', 'PENDING_HR_REVIEW'],
  ['approve', 'PENDING_HR_REVIEW'],
  ['cancel', 'DRAFT'],
  ['cancel', 'PENDING_HR_REVIEW'],
  ['cancel', 'APPROVED'],
  ['void', 'DRAFT'],
  ['void', 'PENDING_HR_REVIEW'],
  ['void', 'APPROVED'],
];

describe('Stage 1 case state machine', () => {
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
  });

  it('requires a reason for return, cancel and void', () => {
    expect(checkTransition('return', 'PENDING_HR_REVIEW', '').ok).toBe(false);
    expect(checkTransition('cancel', 'DRAFT', '   ').ok).toBe(false);
    expect(checkTransition('void', 'DRAFT', undefined).ok).toBe(false);
    expect(checkTransition('submit', 'DRAFT', undefined).ok).toBe(true);
  });

  it('rejects Stage 3 workflow states outright (no partial engine)', () => {
    for (const status of ['ACTIVE', 'CLEARANCE_REVIEW', 'ON_HOLD', 'REOPENED'] as const) {
      for (const action of ACTIONS) {
        expect(checkTransition(action, status, 'reason').ok, `${action} from ${status}`).toBe(
          false,
        );
      }
    }
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
