import { describe, expect, it } from 'vitest';
import {
  actionTokenExpiry,
  allowedTokenPurposes,
  autoSendBlockers,
  emailActionDisplayState,
  generateActionToken,
  hashActionToken,
  isPlausibleActionToken,
  itEmailScheduledAt,
  recipientEmailErrors,
  normalizeSendControl,
  resolveSendControl,
  CURRENT_SEND_CONTROL_LEVELS,
  DEFAULT_SEND_CONTROL,
} from '../src/emailActions.ts';

const NOW = new Date('2026-08-10T12:00:00.000Z');

describe('send control levels (Directive 6.3 R/S)', () => {
  it('defaults: internal AUTO_SEND, external HR_REVIEW_THEN_SEND', () => {
    expect(DEFAULT_SEND_CONTROL.IT_ACCESS_REMOVAL).toBe('AUTO_SEND');
    expect(DEFAULT_SEND_CONTROL.FINANCE_OFFBOARDING).toBe('AUTO_SEND');
    expect(DEFAULT_SEND_CONTROL.SAGICOR_GROUP_HEALTH_REMOVAL).toBe('HR_REVIEW_THEN_SEND');
    expect(DEFAULT_SEND_CONTROL.NCB_GROUP_LIFE_REMOVAL).toBe('HR_REVIEW_THEN_SEND');
  });

  it('configuration overrides defaults; junk configuration is ignored', () => {
    expect(
      resolveSendControl({
        notificationType: 'SAGICOR_GROUP_HEALTH_REMOVAL',
        configured: { SAGICOR_GROUP_HEALTH_REMOVAL: 'AUTO_SEND' },
        caseClassification: 'CONFIDENTIAL',
      }),
    ).toBe('AUTO_SEND');
    expect(
      resolveSendControl({
        notificationType: 'IT_ACCESS_REMOVAL',
        configured: { IT_ACCESS_REMOVAL: 'nonsense' },
        caseClassification: 'CONFIDENTIAL',
      }),
    ).toBe('AUTO_SEND');
  });

  it('restricted cases are never sent automatically (S: termination timing controls)', () => {
    expect(
      resolveSendControl({
        notificationType: 'IT_ACCESS_REMOVAL',
        configured: null,
        caseClassification: 'RESTRICTED',
      }),
    ).toBe('HR_REVIEW_THEN_SEND');
    // The override can never WEAKEN a stricter configured level.
    expect(
      resolveSendControl({
        notificationType: 'SAGICOR_GROUP_HEALTH_REMOVAL',
        configured: { SAGICOR_GROUP_HEALTH_REMOVAL: 'HR_REVIEW_THEN_SEND' },
        caseClassification: 'RESTRICTED',
        restrictedOverride: 'AUTO_SEND',
      }),
    ).toBe('HR_REVIEW_THEN_SEND');
  });

  it('a legacy HR_MANAGER_APPROVAL_REQUIRED resolves to HR review under the single authorization gate (DEC-066)', () => {
    // Stored before the change: configuration or a restricted override that
    // still says "manager approval". The case approval is that approval now,
    // so the record waits for the HR person executing the case - nobody else.
    expect(normalizeSendControl('HR_MANAGER_APPROVAL_REQUIRED')).toBe('HR_REVIEW_THEN_SEND');
    expect(normalizeSendControl('AUTO_SEND')).toBe('AUTO_SEND');
    expect(
      resolveSendControl({
        notificationType: 'IT_ACCESS_REMOVAL',
        configured: { IT_ACCESS_REMOVAL: 'HR_MANAGER_APPROVAL_REQUIRED' },
        caseClassification: 'CONFIDENTIAL',
      }),
    ).toBe('HR_REVIEW_THEN_SEND');
    expect(
      resolveSendControl({
        notificationType: 'IT_ACCESS_REMOVAL',
        configured: null,
        caseClassification: 'RESTRICTED',
        restrictedOverride: 'HR_MANAGER_APPROVAL_REQUIRED',
      }),
    ).toBe('HR_REVIEW_THEN_SEND');
    // Nothing new is written with the legacy level.
    expect(DEFAULT_SEND_CONTROL.MANUAL_EXCEPTION_NOTIFICATION).toBe('HR_REVIEW_THEN_SEND');
    expect(CURRENT_SEND_CONTROL_LEVELS).not.toContain('HR_MANAGER_APPROVAL_REQUIRED');
  });
});

describe('automatic sending conditions (Directive 6.3 R)', () => {
  const ready = {
    controlLevel: 'AUTO_SEND' as const,
    recipientResolved: true,
    recipientApprovedAndVerified: true,
    templateActive: true,
    bodyComplete: true,
    applicabilityConfirmed: true,
  };

  it('sends only when every condition is satisfied', () => {
    expect(autoSendBlockers(ready)).toEqual([]);
  });

  it('each missing condition blocks with a named reason (AC invariant 20)', () => {
    expect(autoSendBlockers({ ...ready, recipientResolved: false })).toContainEqual(
      expect.stringContaining('recipient'),
    );
    expect(autoSendBlockers({ ...ready, recipientApprovedAndVerified: false })).toContainEqual(
      expect.stringContaining('approved and verified'),
    );
    expect(autoSendBlockers({ ...ready, templateActive: false })).toContainEqual(
      expect.stringContaining('template'),
    );
    expect(autoSendBlockers({ ...ready, applicabilityConfirmed: false })).toContainEqual(
      expect.stringContaining('Applicability'),
    );
    expect(autoSendBlockers({ ...ready, controlLevel: 'HR_REVIEW_THEN_SEND' })).not.toEqual([]);
  });
});

describe('IT email timing (Directive 6.3 U)', () => {
  it('notice/immediate send now; termination sends one hour before the effective time', () => {
    const eff = new Date('2026-08-20T22:00:00.000Z');
    expect(
      itEmailScheduledAt({
        departureType: 'RESIGNATION_WITH_NOTICE',
        effectiveSeparationAt: eff,
        now: NOW,
      }),
    ).toEqual(NOW);
    expect(
      itEmailScheduledAt({ departureType: 'TERMINATION', effectiveSeparationAt: eff, now: NOW }),
    ).toEqual(new Date('2026-08-20T21:00:00.000Z'));
    expect(
      itEmailScheduledAt({
        departureType: 'TERMINATION',
        effectiveSeparationAt: new Date('2026-08-01T00:00:00.000Z'),
        now: NOW,
      }),
    ).toEqual(NOW);
  });
});

describe('acknowledgement tokens (Directive 6.3 T)', () => {
  it('tokens are CSPRNG, hash-only comparable, plausibility-checkable', () => {
    const t = generateActionToken();
    expect(isPlausibleActionToken(t)).toBe(true);
    expect(hashActionToken(t)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashActionToken(t)).not.toContain(t);
  });

  it('IT tokens expire in 72h; others in 14 days', () => {
    const issued = new Date('2026-08-10T00:00:00.000Z');
    expect(actionTokenExpiry({ notificationType: 'IT_ACCESS_REMOVAL', issuedAt: issued })).toEqual(
      new Date('2026-08-13T00:00:00.000Z'),
    );
    expect(
      actionTokenExpiry({ notificationType: 'FINANCE_OFFBOARDING', issuedAt: issued }),
    ).toEqual(new Date('2026-08-24T00:00:00.000Z'));
  });

  it('completion confirmation is approved for internal departments only', () => {
    expect(allowedTokenPurposes('IT_ACCESS_REMOVAL')).toContain('CONFIRM_COMPLETION');
    expect(allowedTokenPurposes('FINANCE_OFFBOARDING')).toContain('CONFIRM_COMPLETION');
    expect(allowedTokenPurposes('SAGICOR_GROUP_HEALTH_REMOVAL')).toEqual(['ACKNOWLEDGE_RECEIPT']);
    expect(allowedTokenPurposes('SURVEY_INVITATION_REFERENCE')).toEqual([]);
  });
});

describe('recipient entry validation (Directive 6.3 O)', () => {
  it('validates email format, name and organization', () => {
    expect(
      recipientEmailErrors({
        email: 'benefits@example.invalid',
        name: 'Benefits Team',
        organization: 'Sagicor',
      }),
    ).toEqual([]);
    expect(recipientEmailErrors({ email: 'nope', name: 'X', organization: 'Y' })).toContainEqual(
      expect.stringContaining('valid email'),
    );
    expect(recipientEmailErrors({ email: 'a@b.co', name: '', organization: 'Y' })).toContainEqual(
      expect.stringContaining('name'),
    );
    expect(recipientEmailErrors({ email: 'a@b.co', name: 'X', organization: '' })).toContainEqual(
      expect.stringContaining('organization'),
    );
  });
});

describe('business-facing action state (Directive 6.3 U + correction 7)', () => {
  const base = {
    applicable: true,
    status: null,
    recipientResolved: true,
    scheduledSendAt: null,
    ackDeadlineAt: null,
    requiresCompletionEvidence: false,
    now: NOW,
  };

  it('projects the whole journey in business terms', () => {
    expect(emailActionDisplayState({ ...base, applicable: false })).toBe('NOT_APPLICABLE');
    expect(emailActionDisplayState({ ...base, recipientResolved: false })).toBe(
      'RECIPIENT_REQUIRED',
    );
    expect(emailActionDisplayState({ ...base, status: 'PENDING_APPROVAL' })).toBe('NEEDS_REVIEW');
    expect(emailActionDisplayState({ ...base, status: 'APPROVED' })).toBe('SCHEDULED');
    expect(emailActionDisplayState({ ...base, status: 'SENT' })).toBe('SENT');
    expect(emailActionDisplayState({ ...base, status: 'ACKNOWLEDGED' })).toBe('ACKNOWLEDGED');
    expect(emailActionDisplayState({ ...base, status: 'CONFIRMED_COMPLETE' })).toBe('COMPLETED');
    expect(emailActionDisplayState({ ...base, status: 'FAILED' })).toBe('FAILED');
  });

  it('sent-but-unconfirmed past the deadline reads as overdue (delivery is not completion)', () => {
    const past = new Date('2026-08-01T00:00:00.000Z');
    expect(emailActionDisplayState({ ...base, status: 'SENT', ackDeadlineAt: past })).toBe(
      'OVERDUE',
    );
    expect(
      emailActionDisplayState({
        ...base,
        status: 'ACKNOWLEDGED',
        ackDeadlineAt: past,
        requiresCompletionEvidence: true,
      }),
    ).toBe('OVERDUE');
  });
});
