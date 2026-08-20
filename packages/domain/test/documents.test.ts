import { describe, expect, it } from 'vitest';
import {
  buildFieldSnapshot,
  contentChecksum,
  docTransitionError,
  documentValidationErrors,
  escapeHtml,
  extractPlaceholders,
  hasMissingMarkers,
  isTypePermanentlyDisabled,
  letterTypeForDeparture,
  substitute,
  templateContentErrors,
  templateTransitionError,
  DOCUMENT_PLACEHOLDERS,
} from '../src/documents.ts';

const ALLOWED = [...DOCUMENT_PLACEHOLDERS];

describe('template content validation (B.6/B.7)', () => {
  it('accepts plain text with allow-listed placeholders', () => {
    expect(
      templateContentErrors('Dear [[EMPLOYEE_LEGAL_NAME]], case [[CASE_REFERENCE]].', ALLOWED),
    ).toEqual([]);
  });

  it('rejects unsupported placeholders', () => {
    expect(templateContentErrors('Hello [[SALARY_AMOUNT]]', ALLOWED)).toContainEqual(
      expect.stringContaining('Unsupported placeholder'),
    );
  });

  it('rejects HTML, scripting and template-engine syntax', () => {
    expect(templateContentErrors('<script>alert(1)</script>', ALLOWED).length).toBeGreaterThan(0);
    expect(templateContentErrors('Hello {{name}}', ALLOWED).length).toBeGreaterThan(0);
    expect(templateContentErrors('Hello ${process.env.SECRET}', ALLOWED).length).toBeGreaterThan(0);
    expect(templateContentErrors('Hello <%= x %>', ALLOWED).length).toBeGreaterThan(0);
  });

  it('rejects malformed placeholder brackets', () => {
    expect(templateContentErrors('Broken [[EMPLOYEE_LEGAL_NAME', ALLOWED)).toContainEqual(
      expect.stringContaining('Malformed'),
    );
  });

  it('extracts unique placeholders', () => {
    expect(extractPlaceholders('[[A_B]] text [[A_B]] [[CASE_REFERENCE]]')).toEqual([
      'A_B',
      'CASE_REFERENCE',
    ]);
  });
});

describe('field snapshot and substitution (section C)', () => {
  const snapshot = buildFieldSnapshot(
    {
      caseNumber: 'OFF-2026-0001',
      departureType: 'RESIGNATION_WITH_NOTICE',
      employeeDisplayName: 'Avery Brown',
      employeeLegalName: 'Avery Brown',
      employeeSourceId: 'EMP-TEST-001',
      jobTitle: 'Parts Sales Associate',
      department: 'Sales',
      location: 'Kingston',
      managerName: 'Line Manager',
      employeeAddress: '14 Fictional Way,\nSt. Andrew',
      receivedAt: new Date('2026-07-20T14:00:00Z'),
      proposedLastDay: null,
      confirmedLastDay: new Date('2026-08-14T00:00:00Z'),
      effectiveSeparationAt: new Date('2026-08-14T22:00:00Z'),
    },
    new Date('2026-07-29T12:00:00Z'),
    1,
    1,
  );

  it('captures Jamaica-formatted dates and distinct date/time concepts', () => {
    expect(snapshot.RESIGNATION_RECEIVED_DATE).toBe('20 Jul 2026');
    expect(snapshot.EFFECTIVE_SEPARATION_DATE).toBe('14 Aug 2026');
    // One country, one timezone: the instant carries no zone label.
    expect(snapshot.EFFECTIVE_SEPARATION_TIME).toBe('5:00 PM');
  });

  it('substitutes values and flags missing ones visibly', () => {
    const out = substitute(
      'To [[EMPLOYEE_LEGAL_NAME]] re [[PROPOSED_LAST_WORKING_DATE]]',
      snapshot,
    );
    expect(out).toContain('Avery Brown');
    expect(out).toContain('[MISSING:PROPOSED_LAST_WORKING_DATE]');
    expect(hasMissingMarkers(out)).toBe(true);
  });

  it('validation requires the per-type required fields', () => {
    const errors = documentValidationErrors(
      'IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT',
      'body [[EFFECTIVE_SEPARATION_TIME]]',
      { ...snapshot, EFFECTIVE_SEPARATION_TIME: '' },
    );
    expect(errors).toContainEqual(expect.stringContaining('EFFECTIVE_SEPARATION_TIME'));
  });

  it('escapes HTML-dangerous values for previews', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;',
    );
  });

  it('checksum is deterministic and content-sensitive (approval binding)', () => {
    expect(contentChecksum('abc')).toBe(contentChecksum('abc'));
    expect(contentChecksum('abc')).not.toBe(contentChecksum('abd'));
  });
});

describe('lifecycles', () => {
  it('letter routing by departure type; no termination letter (defaults 16/17)', () => {
    expect(letterTypeForDeparture('RESIGNATION_WITH_NOTICE')).toBe(
      'RESIGNATION_ACCEPTANCE_WITH_NOTICE',
    );
    expect(letterTypeForDeparture('IMMEDIATE_RESIGNATION')).toBe(
      'IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT',
    );
    expect(letterTypeForDeparture('TERMINATION')).toBeNull();
  });

  it('the termination placeholder is permanently disabled (default 18)', () => {
    expect(isTypePermanentlyDisabled('TERMINATION_DOCUMENT_PLACEHOLDER')).toBe(true);
    expect(
      templateTransitionError('activate', 'DRAFT', 'TERMINATION_DOCUMENT_PLACEHOLDER'),
    ).toContain('permanently disabled');
  });

  it('active templates are immutable; only drafts activate', () => {
    expect(
      templateTransitionError('edit', 'ACTIVE', 'RESIGNATION_ACCEPTANCE_WITH_NOTICE'),
    ).toContain('immutable');
    expect(
      templateTransitionError('activate', 'ACTIVE', 'RESIGNATION_ACCEPTANCE_WITH_NOTICE'),
    ).toBeTruthy();
    expect(
      templateTransitionError('activate', 'DRAFT', 'RESIGNATION_ACCEPTANCE_WITH_NOTICE'),
    ).toBeNull();
  });

  it('document transitions enforce state and reasons', () => {
    expect(docTransitionError('approve', 'PENDING_APPROVAL')).toBeNull();
    expect(docTransitionError('approve', 'DRAFT')).toContain('not allowed');
    expect(docTransitionError('return', 'PENDING_APPROVAL', '')).toContain('requires a reason');
    expect(docTransitionError('markIssued', 'RENDERED')).toBeNull();
    expect(docTransitionError('markIssued', 'APPROVED')).toContain('not allowed');
    expect(docTransitionError('void', 'MANUALLY_ISSUED', 'x')).toContain('not allowed'); // issued docs supersede, never void
  });
});
