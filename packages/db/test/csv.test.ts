import { describe, expect, it } from 'vitest';
import { csvCell, csvIso, csvNumber } from '../src/csv.ts';

describe('CSV formula-injection neutralization (Directive 1.1 F)', () => {
  it('neutralizes the required malicious payloads', () => {
    expect(csvCell('=HYPERLINK("https://example.invalid","x")')).toBe(
      `"'=HYPERLINK(""https://example.invalid"",""x"")"`,
    );
    expect(csvCell('+CMD')).toBe(`'+CMD`);
    expect(csvCell('-1+2')).toBe(`'-1+2`);
    expect(csvCell('@SUM(1,1)')).toBe(`"'@SUM(1,1)"`);
    expect(csvCell('\t=1+1')).toBe(`"'\t=1+1"`);
  });

  it('neutralizes leading CR/LF triggers', () => {
    expect(csvCell('\r\n=cmd')).toBe(`"'\r\n=cmd"`);
  });

  it('leaves ordinary text untouched and quotes only when needed', () => {
    expect(csvCell('OFF-2026-0001')).toBe('OFF-2026-0001');
    expect(csvCell('RESIGNATION_WITH_NOTICE')).toBe('RESIGNATION_WITH_NOTICE');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('')).toBe('');
  });

  it('keeps genuine numeric values typed - negatives are NOT corrupted', () => {
    expect(csvNumber(-42)).toBe('-42');
    expect(csvNumber(0)).toBe('0');
    expect(csvNumber(3.5)).toBe('3.5');
    expect(csvNumber(Number.NaN)).toBe('');
  });

  it('ISO dates are inherently formula-safe and pass through', () => {
    expect(csvIso(new Date('2026-07-29T12:00:00.000Z'))).toBe('2026-07-29T12:00:00.000Z');
    expect(csvIso(null)).toBe('');
  });
});
