/**
 * Case lifecycle states and the Stage 1 transition rules.
 *
 * The full authoritative state set comes from StateMachines.md (APPROVED is
 * the single post-review state - Directive 0.1 section D). Stage 1 implements
 * only the intake/approval segment plus cancel/void; ACTIVE and later
 * operational states belong to the Stage 3 workflow engine and are rejected
 * here rather than partially implemented.
 */
export const CASE_STATUSES = [
  'DRAFT',
  'PENDING_HR_REVIEW',
  'APPROVED',
  'ACTIVE',
  'CLEARANCE_REVIEW',
  'COMPLETED',
  'ON_HOLD',
  'CANCELLED',
  'VOIDED',
  'REOPENED',
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

// The canonical separation model lives in separation.ts - one authoritative
// statement of what each way of leaving means. These re-exports keep every
// existing import working (owner directive, 2026-08-26).
export { DEPARTURE_TYPES, type DepartureType } from './separation.ts';
import type { DepartureType } from './separation.ts';

export type CaseTransitionAction =
  | 'submit'
  | 'return'
  | 'approve'
  | 'cancel'
  | 'void'
  | 'activate'
  | 'hold'
  | 'resume'
  | 'requestClearance'
  | 'clearanceReturn'
  | 'complete'
  | 'reopen';

interface TransitionRule {
  readonly from: readonly CaseStatus[];
  readonly to: CaseStatus;
  /** Human-entered reason required for the audit/history record. */
  readonly requiresReason: boolean;
}

/**
 * Case transitions. Stage 1 defined the intake segment; Stage 3 (Directive 3)
 * adds the operational segment: activate -> hold/resume -> clearance ->
 * complete -> reopen, and widens cancel/void to operational statuses (C.4/C.5).
 * Everything not listed is forbidden.
 */
export const STAGE1_TRANSITIONS: Readonly<Record<CaseTransitionAction, TransitionRule>> = {
  submit: { from: ['DRAFT'], to: 'PENDING_HR_REVIEW', requiresReason: false },
  return: { from: ['PENDING_HR_REVIEW'], to: 'DRAFT', requiresReason: true },
  approve: { from: ['PENDING_HR_REVIEW'], to: 'APPROVED', requiresReason: false },
  cancel: {
    from: ['DRAFT', 'PENDING_HR_REVIEW', 'APPROVED', 'ACTIVE', 'ON_HOLD', 'REOPENED'],
    to: 'CANCELLED',
    requiresReason: true,
  },
  void: {
    from: ['DRAFT', 'PENDING_HR_REVIEW', 'APPROVED', 'ACTIVE', 'ON_HOLD', 'REOPENED'],
    to: 'VOIDED',
    requiresReason: true,
  },
  // Stage 3 operational segment (Directive 3 sections C, E, O).
  activate: { from: ['APPROVED'], to: 'ACTIVE', requiresReason: false },
  hold: { from: ['ACTIVE'], to: 'ON_HOLD', requiresReason: true },
  resume: { from: ['ON_HOLD'], to: 'ACTIVE', requiresReason: true },
  requestClearance: { from: ['ACTIVE'], to: 'CLEARANCE_REVIEW', requiresReason: false },
  clearanceReturn: { from: ['CLEARANCE_REVIEW'], to: 'ACTIVE', requiresReason: true },
  complete: { from: ['CLEARANCE_REVIEW'], to: 'COMPLETED', requiresReason: false },
  reopen: { from: ['COMPLETED'], to: 'REOPENED', requiresReason: true },
};

export interface TransitionCheck {
  readonly ok: boolean;
  readonly to?: CaseStatus;
  readonly error?: string;
}

export function checkTransition(
  action: CaseTransitionAction,
  current: CaseStatus,
  reason: string | undefined,
): TransitionCheck {
  const rule = STAGE1_TRANSITIONS[action];
  if (!rule.from.includes(current)) {
    return {
      ok: false,
      error: `Action "${action}" is not allowed from status ${current}.`,
    };
  }
  if (rule.requiresReason && !reason?.trim()) {
    return { ok: false, error: `Action "${action}" requires a reason.` };
  }
  return { ok: true, to: rule.to };
}

/** Statuses a case can be edited in (draft data corrections). */
export const EDITABLE_STATUSES: readonly CaseStatus[] = ['DRAFT'];

/** Terminal statuses for Stage 1 purposes. */
export const TERMINAL_STATUSES: readonly CaseStatus[] = ['CANCELLED', 'VOIDED', 'COMPLETED'];

/**
 * Fields that must be valid before a case may leave DRAFT (BR-CASE-002).
 * Reason category is intentionally NOT required at creation (IC-S1-008):
 * DEC-031 is OPEN, so `reasonCaptureStatus` tracks the outcome instead.
 */
export interface SubmitReadinessInput {
  readonly departureType: DepartureType | null;
  readonly receivedAt: Date | null;
  readonly receiptSource: string | null;
  readonly effectiveSeparationAt: Date | null;
  readonly ownerId: string | null;
  readonly department: string | null;
  readonly location: string | null;
  readonly employeeSourceId: string | null;
}

export function submitReadinessErrors(input: SubmitReadinessInput): string[] {
  const errors: string[] = [];
  if (!input.employeeSourceId) errors.push('An employee must be selected.');
  if (!input.departureType) errors.push('Departure type is required.');
  if (!input.receivedAt) errors.push('Receipt date and time are required.');
  else if (input.receivedAt.getTime() > Date.now() + 5 * 60_000)
    errors.push('Receipt time cannot be in the future.');
  if (!input.receiptSource?.trim()) errors.push('The source of the receipt timestamp is required.');
  if (!input.effectiveSeparationAt)
    errors.push('The effective separation date and exact time are required.');
  if (!input.ownerId) errors.push('An accountable HR case owner is required.');
  if (!input.department?.trim()) errors.push('Department is required.');
  if (!input.location?.trim()) errors.push('Location is required.');
  return errors;
}
