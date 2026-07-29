import { describe, expect, it } from 'vitest';
import { sanitizeMetadata } from '../src/audit.ts';

describe('audit metadata sanitizer (REQ-SEC-023)', () => {
  it('drops keys that carry personal or secret content', () => {
    const out = sanitizeMetadata({
      caseNumber: 'OFF-2026-0001',
      personalEmail: 'someone@real-domain.com',
      home_address: '1 Real Street',
      phoneNumber: '876-555-0000',
      surveyAnswerText: 'free text',
      sessionToken: 'abc123',
      authorization: 'Bearer x',
      password: 'hunter2',
      reasonNotes: 'sensitive HR narrative',
      noteBody: 'internal note content',
      signatureImage: 'base64...',
      bankAccount: '12345678',
    });
    expect(out).toEqual({ caseNumber: 'OFF-2026-0001' });
  });

  it('keeps safe scalars, ISO-encodes dates, and summarizes structures', () => {
    const out = sanitizeMetadata({
      count: 3,
      approved: true,
      when: new Date('2026-07-28T12:00:00Z'),
      list: [1, 2, 3],
      nested: { a: 1 },
      empty: null,
    });
    expect(out).toEqual({
      count: 3,
      approved: true,
      when: '2026-07-28T12:00:00.000Z',
      list: '[array:3]',
      nested: '[object]',
      empty: null,
    });
  });

  it('bounds string length and key count', () => {
    const big: Record<string, unknown> = { long: 'x'.repeat(5000) };
    for (let i = 0; i < 50; i++) big[`k${i}`] = i;
    const out = sanitizeMetadata(big);
    expect((out['long'] as string).length).toBe(300);
    expect(Object.keys(out).length).toBeLessThanOrEqual(30);
  });

  it('tolerates undefined input', () => {
    expect(sanitizeMetadata(undefined)).toEqual({});
  });
});
