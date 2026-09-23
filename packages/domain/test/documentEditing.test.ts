import { describe, expect, it } from 'vitest';
import { RESIGNATION_ACCEPTANCE_LETTER_BODY, DOCUMENT_PLACEHOLDERS } from '../src/documents.ts';
import {
  autoAssignmentSource,
  editedEmailErrors,
  editedLetterBodyErrors,
  emailContentEditable,
  emailDisplayStatus,
  formDisplayStatus,
  joinSegments,
  manualRecipientErrors,
  normaliseBody,
  presentRecipient,
  protectedPlaceholders,
  receiptDisplayStatus,
  segmentBody,
} from '../src/documentEditing.ts';

/** DEC-069: the pure rules of editable documents and recipient overrides. */

const TYPE = 'RESIGNATION_ACCEPTANCE_WITH_NOTICE' as const;
const ALLOWED = [...DOCUMENT_PLACEHOLDERS];

describe('letter editing', () => {
  it('keeps the case facts the letter requires and lets everything else change', () => {
    const protectedFacts = protectedPlaceholders(TYPE, RESIGNATION_ACCEPTANCE_LETTER_BODY);
    expect(protectedFacts).toContain('EMPLOYEE_LEGAL_NAME');
    expect(protectedFacts).toContain('EFFECTIVE_SEPARATION_DATE');
    expect(protectedFacts).not.toContain('POSITION');

    // Adding a sentence is fine.
    const added = `${RESIGNATION_ACCEPTANCE_LETTER_BODY}\n\nWe wish you well in your next role.`;
    expect(
      editedLetterBodyErrors({
        type: TYPE,
        body: added,
        templateBody: RESIGNATION_ACCEPTANCE_LETTER_BODY,
        allowedPlaceholders: ALLOWED,
      }),
    ).toEqual([]);

    // Removing the employee's name is not: the case owns that fact.
    const removed = RESIGNATION_ACCEPTANCE_LETTER_BODY.replace('[[EMPLOYEE_LEGAL_NAME]]', 'you');
    expect(
      editedLetterBodyErrors({
        type: TYPE,
        body: removed,
        templateBody: RESIGNATION_ACCEPTANCE_LETTER_BODY,
        allowedPlaceholders: ALLOWED,
      }).join(' '),
    ).toContain('Employee legal name is a case fact');
  });

  it('refuses markup and unknown placeholders in an edit, like a template', () => {
    const errors = editedLetterBodyErrors({
      type: TYPE,
      body: `${RESIGNATION_ACCEPTANCE_LETTER_BODY}\n\n<b>bold</b> [[SALARY]]`,
      templateBody: RESIGNATION_ACCEPTANCE_LETTER_BODY,
      allowedPlaceholders: ALLOWED,
    });
    expect(errors.join(' ')).toContain('plain text');
    expect(errors.join(' ')).toContain('Unsupported placeholder');
  });

  it('splits a body into paragraphs of narrative and locked facts, and joins it back', () => {
    const body =
      'Dear [[EMPLOYEE_FIRST_NAME]],\n\nYour last day is [[CONFIRMED_LAST_WORKING_DATE]].\nThank you.';
    const paragraphs = segmentBody(body);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]!.map((s) => s.kind)).toEqual(['text', 'fact', 'text']);
    expect(paragraphs[0]![1]).toMatchObject({
      placeholder: 'EMPLOYEE_FIRST_NAME',
      label: 'Employee first name',
    });
    expect(joinSegments(paragraphs)).toBe(body);
  });

  it('normalises an editor submission without changing its words', () => {
    expect(normaliseBody('Dear Avery,  \r\n\r\n\r\n\r\nThank you.\t\n')).toBe(
      'Dear Avery,\n\nThank you.',
    );
  });
});

describe('display statuses', () => {
  it('derives the five form states from the stored status and the signatures', () => {
    expect(
      formDisplayStatus({ status: 'DRAFT', openSignatureRequests: 0, signedSignatureRequests: 0 }),
    ).toBe('DRAFT');
    expect(
      formDisplayStatus({
        status: 'READY_FOR_HR_REVIEW',
        openSignatureRequests: 0,
        signedSignatureRequests: 0,
      }),
    ).toBe('READY');
    expect(
      formDisplayStatus({ status: 'DRAFT', openSignatureRequests: 1, signedSignatureRequests: 0 }),
    ).toBe('AWAITING_SIGNATURE');
    expect(
      formDisplayStatus({ status: 'DRAFT', openSignatureRequests: 0, signedSignatureRequests: 1 }),
    ).toBe('SIGNED');
    expect(
      formDisplayStatus({
        status: 'COMPLETE',
        openSignatureRequests: 0,
        signedSignatureRequests: 1,
      }),
    ).toBe('FINAL');
    expect(
      formDisplayStatus({
        status: 'SUPERSEDED',
        openSignatureRequests: 0,
        signedSignatureRequests: 0,
      }),
    ).toBeNull();
    expect(
      receiptDisplayStatus({
        lifecycle: 'READY',
        openSignatureRequests: 0,
        signedSignatureRequests: 0,
      }),
    ).toBe('READY');
    expect(
      receiptDisplayStatus({
        lifecycle: 'FINAL',
        openSignatureRequests: 0,
        signedSignatureRequests: 0,
      }),
    ).toBe('FINAL');
  });

  it("maps email statuses to the owner's words and knows when the words can still change", () => {
    expect(emailDisplayStatus({ status: 'PENDING_APPROVAL', queued: false })).toBe('DRAFT');
    expect(emailDisplayStatus({ status: 'APPROVED', queued: true })).toBe('QUEUED');
    expect(emailDisplayStatus({ status: 'APPROVED', queued: false })).toBe('READY_TO_SEND');
    expect(emailDisplayStatus({ status: 'SENT', queued: false })).toBe('SENT');
    expect(emailDisplayStatus({ status: 'FAILED', queued: false })).toBe('FAILED');
    expect(emailContentEditable('DRAFT')).toBe(true);
    expect(emailContentEditable('PENDING_APPROVAL')).toBe(true);
    expect(emailContentEditable('APPROVED')).toBe(false);
    expect(emailContentEditable('SENT')).toBe(false);
  });
});

describe('email editing', () => {
  it('accepts plain-text changes and refuses markup, emptiness and unresolved markers', () => {
    expect(
      editedEmailErrors({
        subject: 'Departure notice',
        body: 'Dear Riley,\n\nAvery leaves on Friday.',
        externalProvider: false,
      }),
    ).toEqual([]);
    const bad = editedEmailErrors({
      subject: '',
      body: '<p>hi</p> [MISSING:NAME]',
      externalProvider: false,
    });
    expect(bad.join(' ')).toContain('subject cannot be empty');
    expect(bad.join(' ')).toContain('markup');
    expect(bad.join(' ')).toContain('unresolved field marker');
  });

  it('applies the minimum-data rule to words HR types for an external provider', () => {
    expect(
      editedEmailErrors({
        subject: 'Cover removal',
        body: 'Please remove cover. Reason: resignation.',
        externalProvider: true,
      }).join(' '),
    ).toContain('must not mention');
    expect(
      editedEmailErrors({
        subject: 'Cover removal',
        body: 'Please remove cover from the date shown.',
        externalProvider: true,
      }),
    ).toEqual([]);
  });
});

describe('recipient overrides', () => {
  it("says why a recipient was chosen, in HR's words", () => {
    expect(autoAssignmentSource('dynamic:EMPLOYEE_MANAGER')).toContain('reporting manager');
    expect(autoAssignmentSource('dynamic:ASSIGNED_HR_OFFICER')).toContain('case HR ownership');
    expect(autoAssignmentSource('static:FINANCE')).toContain('Finance recipient configuration');
    expect(autoAssignmentSource('static:GROUP_HEALTH_PROVIDER')).toContain('selected provider');
    expect(autoAssignmentSource(null)).toBe('Not auto-assigned');
  });

  it('presents the auto-assignment beside an override, and flags an unresolved recipient', () => {
    const overridden = presentRecipient({
      effectiveName: 'Casey Manager',
      effectiveMask: 'c***@example.test',
      autoName: 'Riley Supervisor',
      autoMask: 'r***@example.test',
      autoSourceKey: 'dynamic:EMPLOYEE_MANAGER',
      overrideKind: 'RECIPIENT',
    });
    expect(overridden.headline).toContain('Recipient overridden');
    expect(overridden.headline).toContain('Riley Supervisor');
    expect(overridden.auto?.source).toContain('reporting manager');
    expect(overridden.unresolved).toBe(false);

    const unresolved = presentRecipient({
      effectiveName: null,
      effectiveMask: null,
      autoName: null,
      autoMask: null,
      autoSourceKey: 'dynamic:EMPLOYEE_MANAGER',
      overrideKind: null,
    });
    expect(unresolved.unresolved).toBe(true);
    expect(unresolved.headline).toBe('Recipient not resolved');
  });

  it('validates a manual recipient before it can be used', () => {
    expect(
      manualRecipientErrors({ name: 'Casey Manager', email: 'casey.manager@example.test' }),
    ).toEqual([]);
    expect(manualRecipientErrors({ name: '', email: 'not-an-email' }).length).toBe(2);
  });
});
