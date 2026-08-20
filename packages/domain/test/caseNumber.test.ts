/**
 * Case numbering (OFF-YYYY-NNNN-C): Damm check-digit properties proven
 * exhaustively, tolerant parsing, canonical formatting, business-timezone
 * year, and search normalization.
 */
import { describe, expect, it } from 'vitest';
import {
  caseNumberSearchTerm,
  caseNumberYearFor,
  dammCheckDigit,
  formatCaseNumber,
  isValidCaseNumber,
  parseCaseNumber,
} from '../src/caseNumber.ts';

const CORPUS = [
  '20260001',
  '20260042',
  '20269999',
  '202612345', // five-digit sequence (post-9999 growth)
  '20270815',
  '21001234',
];

describe('Damm check digit', () => {
  it('is stable and single-digit', () => {
    for (const payload of CORPUS) {
      const check = dammCheckDigit(payload);
      expect(check).toBeGreaterThanOrEqual(0);
      expect(check).toBeLessThanOrEqual(9);
      expect(dammCheckDigit(payload)).toBe(check);
    }
  });

  it('a full number verifies to interim 0 (Damm invariant)', () => {
    for (const payload of CORPUS) {
      expect(dammCheckDigit(`${payload}${dammCheckDigit(payload)}`)).toBe(0);
    }
  });

  it('detects EVERY single-digit substitution (exhaustive)', () => {
    for (const payload of CORPUS) {
      const full = `${payload}${dammCheckDigit(payload)}`;
      for (let i = 0; i < full.length; i++) {
        for (let d = 0; d <= 9; d++) {
          const mutated = full.slice(0, i) + String(d) + full.slice(i + 1);
          if (mutated === full) continue;
          expect(
            dammCheckDigit(mutated),
            `undetected substitution: ${full} -> ${mutated}`,
          ).not.toBe(0);
        }
      }
    }
  });

  it('detects EVERY adjacent transposition (exhaustive)', () => {
    for (const payload of CORPUS) {
      const full = `${payload}${dammCheckDigit(payload)}`;
      for (let i = 0; i < full.length - 1; i++) {
        if (full[i] === full[i + 1]) continue;
        const swapped = full.slice(0, i) + full[i + 1]! + full[i]! + full.slice(i + 2);
        expect(dammCheckDigit(swapped), `undetected transposition: ${full} -> ${swapped}`).not.toBe(
          0,
        );
      }
    }
  });

  it('refuses non-digit input', () => {
    expect(() => dammCheckDigit('20A6')).toThrow();
  });
});

describe('formatting', () => {
  it('produces the canonical OFF-YYYY-NNNN-C shape', () => {
    expect(formatCaseNumber(2026, 1)).toMatch(/^OFF-2026-0001-\d$/);
    expect(formatCaseNumber(2026, 42)).toMatch(/^OFF-2026-0042-\d$/);
  });

  it('grows past four digits without breaking', () => {
    expect(formatCaseNumber(2026, 12345)).toMatch(/^OFF-2026-12345-\d$/);
  });

  it('rejects nonsense', () => {
    expect(() => formatCaseNumber(2026, 0)).toThrow();
    expect(() => formatCaseNumber(1999, 1)).toThrow();
    expect(() => formatCaseNumber(2026, 1.5)).toThrow();
  });
});

describe('parsing and normalization', () => {
  it('round-trips its own output', () => {
    for (const seq of [1, 42, 9999, 12345]) {
      const n = formatCaseNumber(2026, seq);
      const parsed = parseCaseNumber(n);
      expect(parsed).toMatchObject({ ok: true, kind: 'modern', year: 2026, seq, caseNumber: n });
    }
  });

  it('accepts every reasonable typed form', () => {
    const canonical = formatCaseNumber(2026, 42);
    const check = canonical.slice(-1);
    for (const raw of [
      canonical.toLowerCase(),
      `  ${canonical}  `,
      `off 2026 0042 ${check}`,
      `OFF.2026.0042.${check}`,
      `off20260042${check}`,
      `OFF-2026-0042 - ${check}`,
    ]) {
      const parsed = parseCaseNumber(raw);
      expect(parsed, `rejected: ${raw}`).toMatchObject({ ok: true, caseNumber: canonical });
    }
  });

  it('accepts legacy numbers forever (no check digit)', () => {
    expect(parseCaseNumber('OFF-2026-0015')).toMatchObject({
      ok: true,
      kind: 'legacy',
      year: 2026,
      seq: 15,
      caseNumber: 'OFF-2026-0015',
    });
    expect(parseCaseNumber('off20260015')).toMatchObject({ ok: true, kind: 'legacy' });
  });

  it('a mistyped check digit is named, not silently misrouted', () => {
    const canonical = formatCaseNumber(2026, 42);
    const wrong = `${canonical.slice(0, -1)}${(Number(canonical.slice(-1)) + 1) % 10}`;
    expect(parseCaseNumber(wrong)).toEqual({ ok: false, error: 'CHECK_DIGIT_MISMATCH' });
    expect(isValidCaseNumber(wrong)).toBe(false);
  });

  it('rejects non-case-number input', () => {
    for (const raw of ['', 'OFF', 'OFF-2026', 'OFF-2026-00', 'CASE-2026-0001', 'OFF-1999-0001']) {
      expect(parseCaseNumber(raw).ok, `accepted: ${raw}`).toBe(false);
    }
  });
});

describe('business-timezone year', () => {
  it('a late New Year’s Eve in Jamaica still belongs to the old year', () => {
    // 2026-12-31 19:05 in Jamaica (UTC-5) = 2027-01-01 00:05 UTC.
    expect(caseNumberYearFor(new Date('2027-01-01T00:05:00.000Z'))).toBe(2026);
    // Midnight in Jamaica starts the new year.
    expect(caseNumberYearFor(new Date('2027-01-01T05:00:00.000Z'))).toBe(2027);
  });
});

describe('search normalization', () => {
  it('a valid modern number searches exactly', () => {
    const n = formatCaseNumber(2026, 42);
    expect(caseNumberSearchTerm(` ${n.toLowerCase()} `)).toEqual({ match: 'exact', value: n });
  });

  it('a legacy-shaped number searches by prefix so the modern twin matches too', () => {
    expect(caseNumberSearchTerm('OFF-2026-0042')).toEqual({
      match: 'prefix',
      value: 'OFF-2026-0042',
    });
  });

  it('typos and free text fall back to substring search', () => {
    const canonical = formatCaseNumber(2026, 42);
    const wrong = `${canonical.slice(0, -1)}${(Number(canonical.slice(-1)) + 1) % 10}`;
    expect(caseNumberSearchTerm(wrong)).toBeNull();
    expect(caseNumberSearchTerm('Avery Brown')).toBeNull();
    expect(caseNumberSearchTerm('OFF-2026')).toBeNull();
  });
});
