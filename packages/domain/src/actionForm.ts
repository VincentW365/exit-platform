/**
 * Digital offboarding Action Form rules.
 *
 * Directive 6.3 (D/E/F, corrections 1-2): the Action Form is an HR-controlled
 * operational record. The assigned HR Officer prepares, reviews and COMPLETES
 * ordinary forms; there is NO line-manager approval and no mandatory
 * HR-Manager sign-off for routine completion. HR-Manager review (HR_REVIEWED)
 * is an optional, configuration-gated oversight step. Checklist completion and
 * approval remain separate concepts; no checklist event may calculate or alter
 * pay - there are no financial amount fields at all.
 *
 * Legacy statuses (PENDING_MANAGER, PENDING_HR, APPROVED, RETURNED) remain
 * representable forever: historical rows keep them and read paths must render
 * them. New rows never enter the manager states.
 */
export type ActionFormStatus =
  // Live statuses under the HR-validated workflow (Directive 6.3 F).
  | 'DRAFT'
  | 'READY_FOR_HR_REVIEW'
  | 'HR_REVIEWED'
  | 'COMPLETE'
  | 'RETURNED_FOR_CORRECTION'
  // Terminal bookkeeping.
  | 'SUPERSEDED'
  | 'VOIDED'
  // Legacy statuses - historical rows only; kept live-editable so no case is
  // trapped in a dead-end state (Directive 6.3 A / AD).
  | 'RETURNED'
  | 'PENDING_MANAGER'
  | 'PENDING_HR'
  | 'APPROVED';

/** Statuses whose HR sections may still be edited. */
export const FORM_EDITABLE_STATUSES: readonly ActionFormStatus[] = [
  'DRAFT',
  'RETURNED_FOR_CORRECTION',
  // Legacy live rows must not dead-end.
  'RETURNED',
];

/**
 * Statuses that count as the one live form per case. Includes the legacy live
 * statuses so pre-redesign rows keep blocking duplicate creation.
 */
export const FORM_LIVE_STATUSES: readonly ActionFormStatus[] = [
  'DRAFT',
  'READY_FOR_HR_REVIEW',
  'HR_REVIEWED',
  'COMPLETE',
  'RETURNED_FOR_CORRECTION',
  'RETURNED',
  'PENDING_MANAGER',
  'PENDING_HR',
  'APPROVED',
];

/** Statuses that satisfy the clearance gate (new COMPLETE or legacy APPROVED). */
export const FORM_DONE_STATUSES: readonly ActionFormStatus[] = ['COMPLETE', 'APPROVED'];

/** HR checklist items (F.4) - completion evidence, never approval authority. */
export const HR_CHECKLIST_ITEMS = [
  { key: 'caseInfoVerified', label: 'Case information verified' },
  { key: 'evidenceRecorded', label: 'Resignation/termination evidence recorded' },
  { key: 'contactVerified', label: 'Personal contact details verified (where applicable)' },
  { key: 'benefitsInitiated', label: 'Benefits activity initiated or not applicable' },
  { key: 'propertyProcessInitiated', label: 'Company-property process initiated' },
  { key: 'accessRemovalRecorded', label: 'Access-removal status recorded' },
  { key: 'surveyEligibilityAssessed', label: 'Exit-survey eligibility assessed' },
  { key: 'hrisUpdate', label: 'HRIS update pending, complete or not applicable' },
] as const;

/**
 * Finance checklist items (F.5) - all work happens OUTSIDE the application.
 * Directive 6.3 I/J: Finance no longer edits these in-app; HR records what the
 * automated Finance notification and any returned evidence establish.
 */
export const FINANCE_CHECKLIST_ITEMS = [
  {
    key: 'financeNotified',
    label: 'Finance notified (automated notification or recorded evidence)',
  },
  {
    key: 'workpaperInitiated',
    label: 'External final-pay workpaper initiated (outside the application)',
  },
  { key: 'workpaperCompleted', label: 'Workpaper completed outside the application' },
  {
    key: 'payrollActioned',
    label: 'Payroll/direct-deposit status action completed outside the application',
  },
  { key: 'otherApprovedAction', label: 'Other approved Finance action' },
] as const;

export type ChecklistState = Record<string, 'PENDING' | 'DONE' | 'NOT_APPLICABLE'>;

export function emptyChecklist(items: readonly { key: string }[]): ChecklistState {
  return Object.fromEntries(items.map((i) => [i.key, 'PENDING']));
}

export function checklistErrors(value: unknown, items: readonly { key: string }[]): string[] {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null) return ['Checklist must be an object.'];
  const allowed = new Set(items.map((i) => i.key));
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.has(k)) errors.push(`Unknown checklist item "${k}".`);
    else if (v !== 'PENDING' && v !== 'DONE' && v !== 'NOT_APPLICABLE')
      errors.push(`Checklist item "${k}" has an invalid state.`);
  }
  return errors;
}

export type AcknowledgementStatus = 'PENDING' | 'ACKNOWLEDGED' | 'NOT_OBTAINED' | 'NOT_APPLICABLE';

/** F.6-F.8: acknowledgement rules by departure type. */
export function acknowledgementErrors(args: {
  departureType: string;
  status: AcknowledgementStatus;
  method: string | null;
  date: Date | null;
  reason: string | null;
}): string[] {
  const errors: string[] = [];
  if (args.status === 'ACKNOWLEDGED') {
    if (!args.method?.trim()) errors.push('Acknowledgement method is required.');
    if (!args.date) errors.push('Acknowledgement date is required.');
    else if (args.date.getTime() > Date.now() + 5 * 60_000)
      errors.push('Acknowledgement date cannot be in the future.');
  }
  if (args.status === 'NOT_OBTAINED' && !args.reason?.trim()) {
    errors.push('NOT_OBTAINED requires a reason.');
  }
  if (args.status === 'NOT_APPLICABLE' && args.departureType !== 'TERMINATION') {
    errors.push('NOT_APPLICABLE is reserved for termination cases in this increment.');
  }
  return errors;
}

/**
 * Directive 6.3 B: for immediate resignations the employee is usually gone
 * before an acknowledgement can be obtained - suggest NOT_OBTAINED with the
 * correct treatment instead of making HR discover the combination manually.
 */
export function suggestedAcknowledgement(departureType: string): {
  status: AcknowledgementStatus;
  reasonSuggestion: string | null;
} {
  if (departureType === 'IMMEDIATE_RESIGNATION') {
    return {
      status: 'NOT_OBTAINED',
      reasonSuggestion:
        'Immediate resignation - the employee departed before an acknowledgement could be obtained.',
    };
  }
  if (departureType === 'TERMINATION') {
    return { status: 'NOT_APPLICABLE', reasonSuggestion: null };
  }
  return { status: 'PENDING', reasonSuggestion: null };
}

/** Readiness gate for finishing preparation (submit for completion/review). */
export function formSubmitErrors(args: {
  departureType: string;
  ackStatus: AcknowledgementStatus;
  ackReason: string | null;
  hrChecklist: ChecklistState;
}): string[] {
  const errors: string[] = [];
  if (args.ackStatus === 'PENDING')
    errors.push(
      'Employee acknowledgement must be recorded (or NOT_OBTAINED / NOT_APPLICABLE) before the form is finished.',
    );
  const pending = Object.entries(args.hrChecklist).filter(([, v]) => v === 'PENDING');
  if (pending.length > 0)
    errors.push(
      `HR checklist has ${pending.length} unresolved item(s) (mark DONE or NOT_APPLICABLE).`,
    );
  return errors;
}

interface FormTransition {
  from: readonly ActionFormStatus[];
  to: ActionFormStatus;
  reasonRequired: boolean;
}

/**
 * Directive 6.3 F + correction 1: DRAFT -> READY_FOR_HR_REVIEW -> COMPLETE,
 * with the optional configuration-gated HR_REVIEWED step. Legacy live states
 * (RETURNED, PENDING_MANAGER, PENDING_HR) may flow forward into the new model
 * so no historical case is stranded; the manager-approval actions no longer
 * exist.
 */
export const FORM_TRANSITIONS = {
  submitToHrReview: {
    from: ['DRAFT', 'RETURNED_FOR_CORRECTION', 'RETURNED'],
    to: 'READY_FOR_HR_REVIEW',
    reasonRequired: false,
  },
  hrReview: { from: ['READY_FOR_HR_REVIEW'], to: 'HR_REVIEWED', reasonRequired: false },
  complete: {
    from: ['READY_FOR_HR_REVIEW', 'HR_REVIEWED', 'PENDING_MANAGER', 'PENDING_HR'],
    to: 'COMPLETE',
    reasonRequired: false,
  },
  return: {
    from: ['READY_FOR_HR_REVIEW', 'HR_REVIEWED', 'PENDING_MANAGER', 'PENDING_HR'],
    to: 'RETURNED_FOR_CORRECTION',
    reasonRequired: true,
  },
  void: {
    from: [
      'DRAFT',
      'READY_FOR_HR_REVIEW',
      'HR_REVIEWED',
      'RETURNED_FOR_CORRECTION',
      'RETURNED',
      'PENDING_MANAGER',
      'PENDING_HR',
    ],
    to: 'VOIDED',
    reasonRequired: true,
  },
} as const satisfies Record<string, FormTransition>;

export type FormAction = keyof typeof FORM_TRANSITIONS;

export function formTransitionError(
  action: FormAction,
  status: ActionFormStatus,
  reason?: string,
): string | null {
  const t = FORM_TRANSITIONS[action] as FormTransition;
  if (!t.from.includes(status)) return `Action "${action}" is not allowed from status ${status}.`;
  if (t.reasonRequired && !reason?.trim()) return `Action "${action}" requires a reason.`;
  return null;
}

/**
 * Business-language status labels (Directive 6.3 correction 7): the UI speaks
 * to HR users, technical state names stay internal.
 */
export const FORM_STATUS_LABELS: Readonly<Record<ActionFormStatus, string>> = {
  DRAFT: 'Draft',
  READY_FOR_HR_REVIEW: 'Ready for review',
  HR_REVIEWED: 'Reviewed',
  COMPLETE: 'Complete',
  RETURNED_FOR_CORRECTION: 'Returned for correction',
  SUPERSEDED: 'Superseded',
  VOIDED: 'Voided',
  RETURNED: 'Returned for correction (legacy)',
  PENDING_MANAGER: 'Awaiting manager approval (legacy)',
  PENDING_HR: 'Awaiting HR approval (legacy)',
  APPROVED: 'Approved (legacy)',
};
