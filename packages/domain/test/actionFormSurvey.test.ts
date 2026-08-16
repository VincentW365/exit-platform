import { describe, expect, it } from 'vitest';
import {
  acknowledgementErrors,
  checklistErrors,
  emptyChecklist,
  formSubmitErrors,
  formTransitionError,
  FINANCE_CHECKLIST_ITEMS,
  FORM_TRANSITIONS,
  HR_CHECKLIST_ITEMS,
} from '../src/actionForm.ts';
import {
  answerErrors,
  completionRate,
  generateSurveyToken,
  hashSurveyToken,
  invitationDueAt,
  isPlausibleToken,
  scheduleFromManualSend,
  surveyEligibility,
  tokenMatchesHash,
} from '../src/survey.ts';

describe('action form rules (section F)', () => {
  it('checklists validate keys and states', () => {
    const empty = emptyChecklist(HR_CHECKLIST_ITEMS);
    expect(Object.values(empty).every((v) => v === 'PENDING')).toBe(true);
    expect(checklistErrors({ caseInfoVerified: 'DONE' }, HR_CHECKLIST_ITEMS)).toEqual([]);
    expect(checklistErrors({ salaryPaid: 'DONE' }, HR_CHECKLIST_ITEMS)).toContainEqual(
      expect.stringContaining('Unknown checklist item'),
    );
    expect(checklistErrors({ caseInfoVerified: 'MAYBE' }, HR_CHECKLIST_ITEMS)).toContainEqual(
      expect.stringContaining('invalid state'),
    );
  });

  it('finance checklist has no amount fields', () => {
    for (const item of FINANCE_CHECKLIST_ITEMS) {
      expect(item.label.toLowerCase()).not.toMatch(/amount|\$|salary|balance/);
    }
  });

  it('acknowledgement: NOT_OBTAINED requires a reason (F.7)', () => {
    expect(
      acknowledgementErrors({
        departureType: 'IMMEDIATE_RESIGNATION',
        status: 'NOT_OBTAINED',
        method: null,
        date: null,
        reason: null,
      }),
    ).toContainEqual(expect.stringContaining('requires a reason'));
    expect(
      acknowledgementErrors({
        departureType: 'IMMEDIATE_RESIGNATION',
        status: 'NOT_OBTAINED',
        method: null,
        date: null,
        reason: 'Employee left without acknowledging.',
      }),
    ).toEqual([]);
  });

  it('NOT_APPLICABLE is reserved for termination (F.8)', () => {
    expect(
      acknowledgementErrors({
        departureType: 'RESIGNATION_WITH_NOTICE',
        status: 'NOT_APPLICABLE',
        method: null,
        date: null,
        reason: null,
      }),
    ).toContainEqual(expect.stringContaining('termination'));
    expect(
      acknowledgementErrors({
        departureType: 'TERMINATION',
        status: 'NOT_APPLICABLE',
        method: null,
        date: null,
        reason: null,
      }),
    ).toEqual([]);
  });

  it('submission requires resolved checklist and acknowledgement', () => {
    const errors = formSubmitErrors({
      departureType: 'RESIGNATION_WITH_NOTICE',
      ackStatus: 'PENDING',
      ackReason: null,
      hrChecklist: emptyChecklist(HR_CHECKLIST_ITEMS),
    });
    expect(errors.some((e) => e.includes('acknowledgement'))).toBe(true);
    expect(errors.some((e) => e.includes('unresolved'))).toBe(true);
  });

  it('transitions: HR-validated flow, reasons on return/void, no manager approval (Directive 6.3 F)', () => {
    expect(formTransitionError('submitToHrReview', 'DRAFT')).toBeNull();
    expect(formTransitionError('complete', 'READY_FOR_HR_REVIEW')).toBeNull();
    expect(formTransitionError('hrReview', 'READY_FOR_HR_REVIEW')).toBeNull();
    expect(formTransitionError('complete', 'HR_REVIEWED')).toBeNull();
    expect(formTransitionError('complete', 'DRAFT')).toContain('not allowed');
    expect(formTransitionError('return', 'READY_FOR_HR_REVIEW', '')).toContain('requires a reason');
    expect(formTransitionError('void', 'COMPLETE', 'x')).toContain('not allowed'); // completed forms supersede
    // AC invariant 1: no manager-approval action exists in the machine.
    expect(Object.keys(FORM_TRANSITIONS)).not.toContain('managerApprove');
    expect(Object.keys(FORM_TRANSITIONS)).not.toContain('submitToManager');
    // Legacy live rows are not dead-ends: they flow into the new model.
    expect(formTransitionError('complete', 'PENDING_MANAGER')).toBeNull();
    expect(formTransitionError('complete', 'PENDING_HR')).toBeNull();
    expect(formTransitionError('submitToHrReview', 'RETURNED')).toBeNull();
  });
});

describe('survey tokens (H)', () => {
  it('generates 256-bit base64url tokens; only hashes are comparable', () => {
    const t = generateSurveyToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isPlausibleToken(t)).toBe(true);
    const h = hashSurveyToken(t);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).not.toContain(t);
    expect(tokenMatchesHash(t, h)).toBe(true);
    expect(tokenMatchesHash(generateSurveyToken(), h)).toBe(false);
  });

  it('tokens are unique across generations', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateSurveyToken()));
    expect(seen.size).toBe(50);
  });
});

describe('survey scheduling (H default timing)', () => {
  it('invitation due 3 calendar days after effective separation (Jamaica)', () => {
    const due = invitationDueAt(new Date('2026-08-14T22:00:00Z'));
    expect(due.toISOString()).toBe('2026-08-17T22:00:00.000Z');
  });

  it('reminders at +3/+7 and expiry at +14 days from manual send', () => {
    const s = scheduleFromManualSend(new Date('2026-08-18T15:00:00Z'));
    expect(s.reminder1DueAt.toISOString()).toBe('2026-08-21T15:00:00.000Z');
    expect(s.reminder2DueAt.toISOString()).toBe('2026-08-25T15:00:00.000Z');
    expect(s.expiresAt.toISOString()).toBe('2026-09-01T15:00:00.000Z');
  });

  it('eligibility: resignations default-on; terminations require override (defaults 19-21)', () => {
    expect(surveyEligibility('RESIGNATION_WITH_NOTICE')).toEqual({
      eligibleByDefault: true,
      requiresOverride: false,
    });
    expect(surveyEligibility('IMMEDIATE_RESIGNATION').eligibleByDefault).toBe(true);
    expect(surveyEligibility('TERMINATION')).toEqual({
      eligibleByDefault: false,
      requiresOverride: true,
    });
  });
});

describe('survey answers and metrics', () => {
  const rating = {
    id: 'q1',
    type: 'RATING_1_5' as const,
    prompt: 'Overall?',
    required: true,
    options: [],
    maxLength: null,
  };
  const choice = {
    id: 'q2',
    type: 'SINGLE_CHOICE' as const,
    prompt: 'Why?',
    required: true,
    options: ['A', 'B'],
    maxLength: null,
  };
  const text = {
    id: 'q5',
    type: 'SHORT_TEXT' as const,
    prompt: 'Valued?',
    required: false,
    options: [],
    maxLength: 10,
  };

  it('required questions must be answered; ratings bounded; options enforced', () => {
    expect(answerErrors(rating, undefined)).toContainEqual(
      expect.stringContaining('requires an answer'),
    );
    expect(
      answerErrors(rating, { questionId: 'q1', choices: [], rating: 7, text: null }),
    ).toContainEqual(expect.stringContaining('1 to 5'));
    expect(answerErrors(rating, { questionId: 'q1', choices: [], rating: 4, text: null })).toEqual(
      [],
    );
    expect(
      answerErrors(choice, { questionId: 'q2', choices: ['Z'], rating: null, text: null }),
    ).toContainEqual(expect.stringContaining('offered options'));
    expect(
      answerErrors(text, { questionId: 'q5', choices: [], rating: null, text: 'x'.repeat(11) }),
    ).toContainEqual(expect.stringContaining('limited to 10'));
    expect(answerErrors(text, undefined)).toEqual([]); // optional
  });

  it('completion rate: (online + verbal) / manually sent, null on zero denominator (K.4)', () => {
    expect(
      completionRate({
        manuallySent: 10,
        completedOnline: 4,
        completedVerbal: 2,
        declined: 1,
        expired: 2,
        invalidContact: 0,
        notEligible: 0,
        notSent: 3,
      }),
    ).toEqual({ numerator: 6, denominator: 10, pct: 60 });
    expect(
      completionRate({
        manuallySent: 0,
        completedOnline: 0,
        completedVerbal: 0,
        declined: 0,
        expired: 0,
        invalidContact: 0,
        notEligible: 0,
        notSent: 0,
      }).pct,
    ).toBeNull();
  });
});
