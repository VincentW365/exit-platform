/**
 * CSV cell encoding with spreadsheet-formula-injection protection
 * (Directive 1.1 section F).
 *
 * A text cell whose first meaningful character is one of = + - @ or a
 * tab/CR/LF is treated as potentially executable spreadsheet content and
 * neutralized by prefixing a single quote (the documented, widely supported
 * spreadsheet convention). CSV quoting alone is NOT sufficient: spreadsheet
 * applications evaluate formulas after unquoting.
 *
 * Numeric and ISO-date values must be emitted via csvNumber/csvIso so real
 * data (including negative numbers) is never corrupted by text sanitation.
 */

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r', '\n']);

function quoteIfNeeded(v: string): string {
  return /[",\r\n\t]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Encode an untrusted TEXT cell: formula-neutralize, then CSV-quote. */
export function csvCell(value: string): string {
  if (value.length === 0) return '';
  const first = value[0]!;
  const neutralized = FORMULA_TRIGGERS.has(first) ? `'${value}` : value;
  return quoteIfNeeded(neutralized);
}

/** Encode a genuine numeric value as a typed cell (never neutralized). */
export function csvNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  return String(value);
}

/** Encode a Date as ISO-8601 (starts with a digit; inherently formula-safe). */
export function csvIso(value: Date | null | undefined): string {
  return value ? value.toISOString() : '';
}
