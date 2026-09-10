/**
 * Findings of the offboarding regression suite (2026-09-09), each kept as a
 * test so the defect cannot return unnoticed.
 */
import { describe, expect, it } from 'vitest';
import { evaluateClearance, LETTER_SATISFIES_CLEARANCE } from '../src/clearance.ts';
import { firstNameOf } from '../src/documents.ts';

describe('the letter greets the employee by first name', () => {
  it('splits on whitespace, never on a letter', () => {
    // The helper had lost its backslash and split on the letter "s": a
    // Brown was addressed as "Bro".
    expect(firstNameOf('Morgan Wilson')).toBe('Morgan');
    expect(firstNameOf('Avery Brown')).toBe('Avery');
    expect(firstNameOf('  Sasha   Winter ')).toBe('Sasha');
    expect(firstNameOf('Jess')).toBe('Jess');
    expect(firstNameOf('')).toBe('');
  });
});

describe('clearance accepts a letter the platform sent by email', () => {
  const facts = {
    departureType: 'RESIGNATION_WITH_NOTICE',
    tasks: [],
    letterStatus: 'ISSUED_BY_EMAIL',
    letterRequired: true,
    actionFormStatus: 'COMPLETE',
    assets: [],
    approvedUnresolvedAssetIds: [],
    openCriticalExceptionCount: 0,
    accessSecurityExceptionApproved: false,
    emailActions: [],
    benefitsUnresolvedCount: 0,
    returnChecklist: null,
  };

  it('ISSUED_BY_EMAIL satisfies the documents condition like RENDERED and MANUALLY_ISSUED', () => {
    for (const status of LETTER_SATISFIES_CLEARANCE) {
      const item = evaluateClearance({ ...facts, letterStatus: status }).items.find(
        (i) => i.key === 'documents',
      );
      expect(item?.ok, status).toBe(true);
    }
    expect(LETTER_SATISFIES_CLEARANCE).toContain('ISSUED_BY_EMAIL');
  });

  it('still blocks while the letter is only approved or absent', () => {
    for (const status of ['APPROVED', 'DRAFT', null]) {
      const item = evaluateClearance({ ...facts, letterStatus: status }).items.find(
        (i) => i.key === 'documents',
      );
      expect(item?.ok, String(status)).toBe(false);
      expect(item?.detail).toContain('ISSUED_BY_EMAIL');
    }
  });
});
