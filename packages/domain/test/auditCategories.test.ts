/** Directive 6.1 (K/L/N/P): categories, humanization and redaction. */
import { describe, expect, it } from 'vitest';
import { AUDIT_EVENT_TYPES } from '../src/audit.ts';
import {
  AUDIT_CATEGORIES,
  TECHNICAL_CATEGORIES,
  TIMELINE_CHIPS,
  eventCategory,
  timelineChipCategories,
} from '../src/auditCategories.ts';
import {
  RESTRICTED_PLACEHOLDER,
  beforeAfterPairs,
  humanizeAuditEvent,
  redactAuditValue,
} from '../src/auditHumanize.ts';

describe('eventCategory', () => {
  it('is total: every audit event type maps to exactly one of the 20 categories', () => {
    for (const t of AUDIT_EVENT_TYPES) {
      const category = eventCategory(t);
      expect(AUDIT_CATEGORIES, t).toContain(category);
    }
  });

  it('maps the assignment lens correctly (M)', () => {
    for (const t of [
      'TASK_CLAIMED',
      'TASK_ASSIGNED',
      'TASK_REASSIGNED',
      'TASK_RETURNED_TO_QUEUE',
      'CASE_OFFICER_ASSIGNED',
      'CASE_OFFICER_REASSIGNED',
      'CASE_MANAGER_DERIVED',
      'CASE_MANAGER_OVERRIDDEN',
      'CASE_MANAGER_CONFIRMED',
      'HIERARCHY_CHANGE_FLAGGED',
    ] as const) {
      expect(eventCategory(t), t).toBe('ASSIGNMENT');
    }
  });

  it('keeps approvals, security and directory in their own lenses', () => {
    expect(eventCategory('CASE_APPROVED')).toBe('APPROVAL');
    expect(eventCategory('CLEARANCE_APPROVED')).toBe('APPROVAL');
    expect(eventCategory('ACCESS_DENIED')).toBe('SECURITY');
    expect(eventCategory('CASE_VIEWED_RESTRICTED')).toBe('SECURITY');
    expect(eventCategory('SYNC_RUN_COMPLETED')).toBe('DIRECTORY');
    expect(eventCategory('DIRECTORY_PURGED')).toBe('DIRECTORY');
  });

  it('technical categories never include case-content lenses', () => {
    expect(TECHNICAL_CATEGORIES).toEqual(['IDENTITY', 'CONFIG', 'SYSTEM']);
    for (const c of ['CASE', 'ASSIGNMENT', 'DOCUMENT', 'SURVEY', 'TASK'] as const) {
      expect(TECHNICAL_CATEGORIES).not.toContain(c);
    }
  });

  it('every timeline chip expands to known categories', () => {
    for (const chip of TIMELINE_CHIPS) {
      for (const c of timelineChipCategories(chip)) expect(AUDIT_CATEGORIES).toContain(c);
    }
  });
});

describe('humanizeAuditEvent (M: who had it, who has it, why)', () => {
  it('renders the thirteen assignment situations as readable sentences', () => {
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      [
        'CASE_MANAGER_DERIVED',
        { managerName: 'M A', sourceSystem: 'SYNTHETIC' },
        /derived from the SYNTHETIC hierarchy/,
      ],
      [
        'CASE_MANAGER_OVERRIDDEN',
        { originalManagerName: 'M A', replacementManagerName: 'M B', reason: 'Unavailable' },
        /overrode the derived manager \(M A → M B\).*Unavailable/,
      ],
      [
        'CASE_OFFICER_ASSIGNED',
        { newOfficerName: 'Officer A' },
        /assigned Officer A as the operational case owner/,
      ],
      [
        'CASE_OFFICER_REASSIGNED',
        { previousOfficerName: 'Officer A', newOfficerName: 'Officer B', reason: 'Leave' },
        /reassigned the case from Officer A to Officer B.*Leave/,
      ],
      ['TASK_CLAIMED', { taskCode: 'IT_1' }, /claimed the task from the department queue/],
      [
        'TASK_ASSIGNED',
        { newAssigneeName: 'Resp A', reason: 'Load' },
        /assigned the task to Resp A/,
      ],
      [
        'TASK_REASSIGNED',
        { previousAssigneeName: 'Resp A', newAssigneeName: 'Resp B', reason: 'Out sick' },
        /reassigned the task from Resp A to Resp B.*Out sick/,
      ],
      [
        'TASK_RETURNED_TO_QUEUE',
        { reason: 'Wrong specialty' },
        /returned the task to the department queue.*Wrong specialty/,
      ],
      [
        'HIERARCHY_CHANGE_FLAGGED',
        { previousManagerName: 'M A', directoryManagerName: 'M C' },
        /manager after activation.*M A.*M C/,
      ],
      ['CASE_PARTICIPANT_ADDED', { participantRole: 'MANAGER' }, /added a manager participant/],
      ['CASE_PARTICIPANT_REMOVED', { reason: 'Rotation' }, /removed a participant/],
      ['CASE_MANAGER_CONFIRMED', {}, /confirmed the assignment plan/],
      ['WORKFLOW_ACTIVATED', {}, /activated the workflow/],
    ];
    for (const [eventType, metadata, pattern] of cases) {
      const text = humanizeAuditEvent({
        eventType,
        result: 'SUCCESS',
        actorDisplayName: 'Dana Field',
        actorType: 'USER',
        metadata,
      });
      expect(text, eventType).toMatch(pattern);
    }
  });

  it('marks denials and failures explicitly', () => {
    expect(
      humanizeAuditEvent({ eventType: 'ACCESS_DENIED', result: 'DENIED', actorDisplayName: 'X' }),
    ).toMatch(/\(DENIED\)$/);
    expect(
      humanizeAuditEvent({
        eventType: 'DOC_RENDER_FAILED',
        result: 'FAILURE',
        actorType: 'SYSTEM',
      }),
    ).toMatch(/\(FAILED\)$/);
  });
});

describe('redaction (P)', () => {
  it('restricted keys collapse to VALUE CHANGED — RESTRICTED', () => {
    expect(redactAuditValue('rehireEligibility', 'ELIGIBLE')).toBe(RESTRICTED_PLACEHOLDER);
    expect(redactAuditValue('newRehireValue', 'NOT_ELIGIBLE')).toBe(RESTRICTED_PLACEHOLDER);
    expect(redactAuditValue('reason', 'Manager unavailable')).toBe('Manager unavailable');
    expect(redactAuditValue('count', 4)).toBe('4');
    expect(redactAuditValue('emptyish', null)).toBe('-');
  });

  it('extracts before/after pairs from assignment metadata', () => {
    const pairs = beforeAfterPairs({
      previousAssigneeName: 'Resp A',
      newAssigneeName: 'Resp B',
      reason: 'Out sick',
    });
    expect(pairs).toEqual([{ label: 'Assignee', before: 'Resp A', after: 'Resp B' }]);
  });
});
