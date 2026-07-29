/**
 * Digital offboarding Action Form rules (Directive 2 section F).
 * Checklist completion and approval are separate concepts; no checklist event
 * may calculate or alter pay - there are no financial amount fields at all.
 */
export type ActionFormStatus =
  'DRAFT' | 'RETURNED' | 'PENDING_MANAGER' | 'PENDING_HR' | 'APPROVED' | 'SUPERSEDED' | 'VOIDED';

export const FORM_EDITABLE_STATUSES: readonly ActionFormStatus[] = ['DRAFT', 'RETURNED'];

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

/** Finance checklist items (F.5) - all work happens OUTSIDE the application. */
export const FINANCE_CHECKLIST_ITEMS = [
  { key: 'financeNotified', label: 'Finance manually notified' },
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

/** Submission readiness for manager review. */
export function formSubmitErrors(args: {
  departureType: string;
  ackStatus: AcknowledgementStatus;
  ackReason: string | null;
  hrChecklist: ChecklistState;
}): string[] {
  const errors: string[] = [];
  if (args.ackStatus === 'PENDING')
    errors.push(
      'Employee acknowledgement must be recorded (or NOT_OBTAINED / NOT_APPLICABLE) before submission.',
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

export const FORM_TRANSITIONS = {
  submitToManager: { from: ['DRAFT', 'RETURNED'], to: 'PENDING_MANAGER', reasonRequired: false },
  managerApprove: { from: ['PENDING_MANAGER'], to: 'PENDING_HR', reasonRequired: false },
  managerReturn: { from: ['PENDING_MANAGER'], to: 'RETURNED', reasonRequired: true },
  hrApprove: { from: ['PENDING_HR'], to: 'APPROVED', reasonRequired: false },
  hrReturn: { from: ['PENDING_HR'], to: 'RETURNED', reasonRequired: true },
  void: {
    from: ['DRAFT', 'RETURNED', 'PENDING_MANAGER', 'PENDING_HR'],
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
