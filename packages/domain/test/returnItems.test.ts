/**
 * Exit Checklist for Return Items: the rules the directive is explicit about.
 * The overall status is always derived, and an outstanding item never
 * disappears because someone pressed submit.
 */
import { describe, expect, it } from 'vitest';
import {
  checklistSubmissionErrors,
  deriveChecklistStatus,
  RETURN_ITEM_CATALOGUE,
  unresolvedItems,
  type ReturnItemStatus,
} from '../src/returnItems.ts';

const items = (...statuses: ReturnItemStatus[]) => statuses.map((status) => ({ status }));

describe('the checklist matches the HR paper form', () => {
  it('carries the ten items in the order HR prints them', () => {
    expect(RETURN_ITEM_CATALOGUE.map((i) => i.label)).toEqual([
      'Identification Card',
      'Health Cards',
      'Access Card / Door Pass',
      'Uniforms',
      'Laptop',
      'ePay Card',
      'Employee Handbook',
      'Phone',
      'Desk',
      'Door',
    ]);
    // The last two sit under the form's "KEYS" sub-heading.
    expect(RETURN_ITEM_CATALOGUE.filter((i) => i.group === 'KEYS')).toHaveLength(2);
  });
});

describe('overall status is derived, never set', () => {
  it('is NOT_STARTED until someone decides something', () => {
    expect(deriveChecklistStatus(items('OUTSTANDING', 'OUTSTANDING'), false)).toBe('NOT_STARTED');
  });

  it('is IN_PROGRESS once any item has a decision but the form is unsent', () => {
    expect(deriveChecklistStatus(items('RETURNED', 'OUTSTANDING'), false)).toBe('IN_PROGRESS');
  });

  it('is COMPLETED when submitted with everything resolved', () => {
    expect(deriveChecklistStatus(items('RETURNED', 'NOT_APPLICABLE'), true)).toBe('COMPLETED');
  });

  it('is COMPLETED_WITH_OUTSTANDING when property is still owed', () => {
    expect(deriveChecklistStatus(items('RETURNED', 'NOT_RETURNED'), true)).toBe(
      'COMPLETED_WITH_OUTSTANDING',
    );
    expect(deriveChecklistStatus(items('RETURNED', 'LOST_OR_DAMAGED'), true)).toBe(
      'COMPLETED_WITH_OUTSTANDING',
    );
  });

  it('never reports plain COMPLETED while an item is unresolved (directive 12)', () => {
    const submitted = deriveChecklistStatus(items('RETURNED', 'NOT_RETURNED'), true);
    expect(submitted).not.toBe('COMPLETED');
    expect(unresolvedItems(items('RETURNED', 'NOT_RETURNED', 'LOST_OR_DAMAGED'))).toHaveLength(2);
  });

  it('treats "not applicable" as settled, not as returned', () => {
    expect(unresolvedItems(items('NOT_APPLICABLE'))).toHaveLength(0);
    expect(deriveChecklistStatus(items('NOT_APPLICABLE'), true)).toBe('COMPLETED');
  });
});

describe('submission rules', () => {
  const item = (label: string, status: ReturnItemStatus, remarks?: string) => ({
    key: 'LAPTOP' as const,
    label,
    status,
    remarks,
  });

  it('requires a decision on every item', () => {
    const errors = checklistSubmissionErrors([item('Laptop', 'OUTSTANDING')], 'A. Receiver');
    expect(errors).toEqual(['Laptop: choose a status before submitting.']);
  });

  it('requires a remark explaining anything not returned', () => {
    expect(checklistSubmissionErrors([item('Laptop', 'NOT_RETURNED')], 'A. Receiver')).toEqual([
      'Laptop: add a remark explaining why it was not returned.',
    ]);
    expect(checklistSubmissionErrors([item('Phone', 'LOST_OR_DAMAGED')], 'A. Receiver')).toEqual([
      'Phone: add a remark explaining why it was not returned.',
    ]);
    expect(
      checklistSubmissionErrors(
        [item('Laptop', 'NOT_RETURNED', 'Employee kept it')],
        'A. Receiver',
      ),
    ).toEqual([]);
  });

  it('requires the receiver name', () => {
    expect(checklistSubmissionErrors([item('Laptop', 'RETURNED')], '  ')).toContain(
      'Record who received the items.',
    );
  });

  it('allows submission WITH outstanding property once it is explained', () => {
    expect(
      checklistSubmissionErrors(
        [item('Laptop', 'RETURNED'), item('Phone', 'NOT_RETURNED', 'Employee will post it')],
        'A. Receiver',
      ),
    ).toEqual([]);
  });
});
