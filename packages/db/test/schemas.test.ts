/**
 * Input-schema hardening (Directive 1.1 section H.5/H.6): dates must never
 * silently coerce null/empty/invalid input into the Unix epoch.
 */
import { describe, expect, it } from 'vitest';
import { createDraftSchema, updateDraftSchema } from '../src/services/caseService.ts';

const base = {
  employeeSourceId: 'EMP-TEST-001',
  departureType: 'RESIGNATION_WITH_NOTICE',
  receivedAt: '2026-07-20T14:00:00.000Z',
  receiptSource: 'Signed letter',
};

describe('date coercion guards', () => {
  it('null optional dates stay null - never the 1970 epoch', () => {
    const parsed = createDraftSchema.parse({ ...base, effectiveSeparationAt: null });
    expect(parsed.effectiveSeparationAt).toBeNull();
  });

  it('empty-string optional dates become null', () => {
    const parsed = createDraftSchema.parse({ ...base, effectiveSeparationAt: '' });
    expect(parsed.effectiveSeparationAt).toBeNull();
  });

  it('a required date REJECTS null instead of coercing', () => {
    expect(createDraftSchema.safeParse({ ...base, receivedAt: null }).success).toBe(false);
    expect(createDraftSchema.safeParse({ ...base, receivedAt: '' }).success).toBe(false);
  });

  it('invalid date strings are rejected', () => {
    expect(createDraftSchema.safeParse({ ...base, receivedAt: 'not-a-date' }).success).toBe(false);
    expect(createDraftSchema.safeParse({ ...base, effectiveSeparationAt: 'garbage' }).success).toBe(
      false,
    );
  });

  it('valid ISO instants parse with correct value and no epoch appears anywhere', () => {
    const parsed = createDraftSchema.parse({
      ...base,
      effectiveSeparationAt: '2026-08-14T22:00:00.000Z',
    });
    expect(parsed.receivedAt.toISOString()).toBe('2026-07-20T14:00:00.000Z');
    expect(parsed.effectiveSeparationAt?.toISOString()).toBe('2026-08-14T22:00:00.000Z');
    expect(parsed.receivedAt.getTime()).not.toBe(0);
  });

  it('update schema applies the same guards', () => {
    const parsed = updateDraftSchema.parse({ effectiveSeparationAt: null });
    expect(parsed.effectiveSeparationAt).toBeNull();
    expect(updateDraftSchema.safeParse({ receivedAt: null }).success).toBe(false);
  });
});
