/**
 * Exit Checklist for Return Items (owner directive, 2026-08-19).
 *
 * The digital form of the HR paper checklist "BERT'S AUTO PARTS LIMITED - Exit
 * Checklist for Return Items". The item list and its order come from that
 * form; the statuses replace its single tick column, because a tick cannot
 * tell "returned" apart from "not applicable" or "lost".
 *
 * Everything here is pure: the service layer owns persistence, the public form
 * owns presentation, and both agree on these rules.
 */

export const RETURN_ITEM_KEYS = [
  'IDENTIFICATION_CARD',
  'HEALTH_CARDS',
  'ACCESS_CARD_DOOR_PASS',
  'UNIFORMS',
  'LAPTOP',
  'EPAY_CARD',
  'EMPLOYEE_HANDBOOK',
  'PHONE',
  'KEYS_DESK',
  'KEYS_DOOR',
] as const;
export type ReturnItemKey = (typeof RETURN_ITEM_KEYS)[number];

/** Labels exactly as the paper form words them, in its order. */
export const RETURN_ITEM_CATALOGUE: ReadonlyArray<{
  key: ReturnItemKey;
  label: string;
  /** Grouped under the form's "KEYS" sub-heading. */
  group?: 'KEYS';
}> = [
  { key: 'IDENTIFICATION_CARD', label: 'Identification Card' },
  { key: 'HEALTH_CARDS', label: 'Health Cards' },
  { key: 'ACCESS_CARD_DOOR_PASS', label: 'Access Card / Door Pass' },
  { key: 'UNIFORMS', label: 'Uniforms' },
  { key: 'LAPTOP', label: 'Laptop' },
  { key: 'EPAY_CARD', label: 'ePay Card' },
  { key: 'EMPLOYEE_HANDBOOK', label: 'Employee Handbook' },
  { key: 'PHONE', label: 'Phone' },
  { key: 'KEYS_DESK', label: 'Desk', group: 'KEYS' },
  { key: 'KEYS_DOOR', label: 'Door', group: 'KEYS' },
];

export const RETURN_ITEM_STATUSES = [
  'OUTSTANDING',
  'RETURNED',
  'NOT_RETURNED',
  'NOT_APPLICABLE',
  'LOST_OR_DAMAGED',
] as const;
export type ReturnItemStatus = (typeof RETURN_ITEM_STATUSES)[number];

export const RETURN_ITEM_STATUS_LABEL: Record<ReturnItemStatus, string> = {
  OUTSTANDING: 'Outstanding',
  RETURNED: 'Returned',
  NOT_RETURNED: 'Not returned',
  NOT_APPLICABLE: 'Not applicable',
  LOST_OR_DAMAGED: 'Lost / damaged',
};

export type ReturnChecklistStatus =
  'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'COMPLETED_WITH_OUTSTANDING';

export const RETURN_CHECKLIST_STATUS_LABEL: Record<ReturnChecklistStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  COMPLETED_WITH_OUTSTANDING: 'Completed with outstanding items',
};

/**
 * An item is SETTLED when someone has made a decision about it. "Outstanding"
 * is the absence of a decision; the other four are decisions - including
 * "not returned" and "lost / damaged", which are settled but unresolved.
 */
export function isSettled(status: ReturnItemStatus): boolean {
  return status !== 'OUTSTANDING';
}

/**
 * An item is UNRESOLVED when the company still does not have its property
 * back. Directive section 12: submitting the form must never make these
 * disappear, so they drive the "completed with outstanding items" state and
 * stay visible on the case afterwards.
 */
export function isUnresolved(status: ReturnItemStatus): boolean {
  return status === 'OUTSTANDING' || status === 'NOT_RETURNED' || status === 'LOST_OR_DAMAGED';
}

/**
 * Overall status, derived from the items and whether the form was submitted -
 * never set by hand.
 *
 *   nothing decided yet ....................... NOT_STARTED
 *   some decided, not submitted ............... IN_PROGRESS
 *   submitted, nothing left unresolved ........ COMPLETED
 *   submitted, something still unresolved ..... COMPLETED_WITH_OUTSTANDING
 *
 * A submitted form with unresolved items is deliberately NOT "completed":
 * the company is still owed property, and the case must keep saying so.
 */
export function deriveChecklistStatus(
  items: ReadonlyArray<{ status: ReturnItemStatus }>,
  submitted: boolean,
): ReturnChecklistStatus {
  if (!submitted) {
    return items.some((i) => isSettled(i.status)) ? 'IN_PROGRESS' : 'NOT_STARTED';
  }
  return items.some((i) => isUnresolved(i.status)) ? 'COMPLETED_WITH_OUTSTANDING' : 'COMPLETED';
}

/** Items the company is still chasing, for the case view and metrics. */
export function unresolvedItems<T extends { status: ReturnItemStatus }>(
  items: ReadonlyArray<T>,
): T[] {
  return items.filter((i) => isUnresolved(i.status));
}

/**
 * Submission rules. The form may be submitted with unresolved items - that is
 * a real outcome, not an error - but every item needs a decision, and anything
 * not returned needs a remark explaining why.
 */
export function checklistSubmissionErrors(
  items: ReadonlyArray<{
    key: ReturnItemKey;
    label: string;
    status: ReturnItemStatus;
    remarks?: string | null;
  }>,
  receivedByName: string,
): string[] {
  const errors: string[] = [];
  if (!receivedByName.trim()) errors.push('Record who received the items.');
  for (const item of items) {
    if (item.status === 'OUTSTANDING') {
      errors.push(`${item.label}: choose a status before submitting.`);
      continue;
    }
    if (
      (item.status === 'NOT_RETURNED' || item.status === 'LOST_OR_DAMAGED') &&
      !item.remarks?.trim()
    ) {
      errors.push(`${item.label}: add a remark explaining why it was not returned.`);
    }
  }
  return errors;
}
