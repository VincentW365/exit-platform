/**
 * Case numbering (owner quality request, 2026-08-17).
 *
 * Format: OFF-YYYY-NNNN-C
 *   - YYYY  the business year in the company timezone (America/Jamaica) -
 *           a case opened on New Year's Eve at 7 pm belongs to THAT year,
 *           not to the UTC year that already rolled over;
 *   - NNNN  a gapless per-year sequence (width 4, growing naturally to 5+;
 *           allocation happens inside the case-creation transaction, so a
 *           rolled-back creation never burns a number);
 *   - C     a Damm check digit over the digits of YYYY and NNNN.
 *
 * Why a check digit: case numbers travel by phone, email and hand-written
 * notes. Without one, a single mistyped digit silently lands on a DIFFERENT
 * valid case. The Damm algorithm (a totally anti-symmetric quasigroup)
 * detects ALL single-digit substitutions and ALL adjacent transpositions -
 * the two error classes that dominate human transcription - with one digit
 * and no length-dependent weighting.
 *
 * Deliberately NOT encoded: department, location, departure type. Numbers
 * outlive org structures; meaning belongs in the record, not the identifier
 * (records-management practice).
 *
 * Legacy numbers (OFF-YYYY-NNNN, no check digit) remain valid forever -
 * existing records are never renumbered.
 */
import { DateTime } from 'luxon';
import { APP_ZONE } from './calendar.ts';

export const CASE_NUMBER_PREFIX = 'OFF';

/** Damm operation table (Wikipedia's standard totally anti-symmetric quasigroup). */
const DAMM_TABLE: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
];

/** Damm check digit for a digit string (interim starts at 0; result 0-9). */
export function dammCheckDigit(digits: string): number {
  if (!/^\d+$/.test(digits)) {
    throw new Error('The check digit is computed over digits only.');
  }
  let interim = 0;
  for (const ch of digits) {
    interim = DAMM_TABLE[interim]![ch.charCodeAt(0) - 48]!;
  }
  return interim;
}

/** The business year a case opened at `now` belongs to (company timezone). */
export function caseNumberYearFor(now: Date): number {
  return DateTime.fromJSDate(now, { zone: APP_ZONE }).year;
}

/** Canonical modern case number for a year + sequence. */
export function formatCaseNumber(year: number, seq: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error('Case-number year out of range.');
  }
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error('Case-number sequence must be a positive integer.');
  }
  const seqText = String(seq).padStart(4, '0');
  const check = dammCheckDigit(`${year}${seqText}`);
  return `${CASE_NUMBER_PREFIX}-${year}-${seqText}-${check}`;
}

export interface ParsedCaseNumber {
  /** 'modern' carries a verified check digit; 'legacy' predates them. */
  kind: 'modern' | 'legacy';
  year: number;
  seq: number;
  /** Canonical form for storage/lookup (legacy keeps its original shape). */
  caseNumber: string;
}

export type CaseNumberParseError = 'NOT_A_CASE_NUMBER' | 'CHECK_DIGIT_MISMATCH';

export type CaseNumberParseResult =
  ({ ok: true } & ParsedCaseNumber) | { ok: false; error: CaseNumberParseError };

/**
 * Parse a typed case number tolerantly: any dash/space/dot mix, any casing,
 * or no separators at all. Digit runs disambiguate the dashless form: eight
 * digits is a legacy number (legacy sequences never exceeded four digits);
 * nine or more means the final digit is the check digit.
 */
export function parseCaseNumber(raw: string): CaseNumberParseResult {
  const cleaned = raw.trim().toUpperCase();
  const match = /^OFF[\s.\-_/]*((?:\d[\s.\-_/]*)+)$/.exec(cleaned);
  if (!match) return { ok: false, error: 'NOT_A_CASE_NUMBER' };
  const digits = match[1]!.replace(/[^\d]/g, '');
  if (digits.length < 8) return { ok: false, error: 'NOT_A_CASE_NUMBER' };

  // Separator-aware fast path: OFF-YYYY-NNNN (legacy) keeps its exact shape.
  const year = Number(digits.slice(0, 4));
  if (year < 2000 || year > 9999) return { ok: false, error: 'NOT_A_CASE_NUMBER' };

  if (digits.length === 8) {
    const seq = Number(digits.slice(4));
    if (seq < 1) return { ok: false, error: 'NOT_A_CASE_NUMBER' };
    return {
      ok: true,
      kind: 'legacy',
      year,
      seq,
      caseNumber: `${CASE_NUMBER_PREFIX}-${year}-${digits.slice(4)}`,
    };
  }

  const payload = digits.slice(0, -1);
  const check = Number(digits.slice(-1));
  const seq = Number(payload.slice(4));
  if (seq < 1) return { ok: false, error: 'NOT_A_CASE_NUMBER' };
  if (dammCheckDigit(payload) !== check) return { ok: false, error: 'CHECK_DIGIT_MISMATCH' };
  return {
    ok: true,
    kind: 'modern',
    year,
    seq,
    caseNumber: `${CASE_NUMBER_PREFIX}-${year}-${payload.slice(4)}-${check}`,
  };
}

/** Structural validity (legacy) or verified check digit (modern). */
export function isValidCaseNumber(raw: string): boolean {
  return parseCaseNumber(raw).ok;
}

/**
 * Search normalization: what should a case-number-looking query match?
 * - a valid modern number -> its exact canonical form;
 * - a legacy-shaped number -> a prefix that ALSO matches the modern number
 *   for the same year/sequence (people omit the check digit when reading a
 *   number off a letter);
 * - a mistyped check digit or a non-number -> null (the caller falls back to
 *   plain substring search so lookups never dead-end).
 */
export function caseNumberSearchTerm(
  raw: string,
): { match: 'exact' | 'prefix'; value: string } | null {
  const parsed = parseCaseNumber(raw);
  if (!parsed.ok) return null;
  if (parsed.kind === 'modern') return { match: 'exact', value: parsed.caseNumber };
  return { match: 'prefix', value: parsed.caseNumber };
}
