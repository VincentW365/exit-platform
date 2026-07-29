import { describe, expect, it } from 'vitest';
import { isServable, uploadValidationErrors } from '../src/attachments.ts';

const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const EXE_HEAD = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // MZ

const okPdf = {
  fileName: 'resignation-letter.pdf',
  declaredMime: 'application/pdf',
  sizeBytes: 100_000,
  head: PDF_HEAD,
};

describe('upload validation (REQ-SEC-019/021)', () => {
  it('accepts a well-formed PDF', () => {
    expect(uploadValidationErrors(okPdf, 10)).toEqual([]);
  });

  it('rejects disallowed extensions including executables and Office files', () => {
    for (const name of [
      'run.exe',
      'macro.docm',
      'sheet.xlsx',
      'page.html',
      'archive.zip',
      'noext',
    ]) {
      const errors = uploadValidationErrors({ ...okPdf, fileName: name }, 10);
      expect(
        errors.some((e) => e.includes('not allowed')),
        name,
      ).toBe(true);
    }
  });

  it('rejects a polyglot: pdf extension with executable content', () => {
    const errors = uploadValidationErrors({ ...okPdf, head: EXE_HEAD }, 10);
    expect(errors.some((e) => e.includes('signature check failed'))).toBe(true);
  });

  it('rejects mismatched declared MIME', () => {
    const errors = uploadValidationErrors({ ...okPdf, declaredMime: 'image/png' }, 10);
    expect(errors.some((e) => e.includes('does not match'))).toBe(true);
  });

  it('accepts png with correct signature and rejects path traversal in names', () => {
    expect(
      uploadValidationErrors(
        { fileName: 'scan.png', declaredMime: 'image/png', sizeBytes: 5_000, head: PNG_HEAD },
        10,
      ),
    ).toEqual([]);
    const errors = uploadValidationErrors({ ...okPdf, fileName: '..\\..\\evil.pdf' }, 10);
    expect(errors.some((e) => e.includes('path'))).toBe(true);
  });

  it('enforces the configured size limit and rejects empty files (REQ-NFR-018)', () => {
    expect(
      uploadValidationErrors({ ...okPdf, sizeBytes: 11 * 1024 * 1024 }, 10).some((e) =>
        e.includes('10 MB'),
      ),
    ).toBe(true);
    expect(
      uploadValidationErrors({ ...okPdf, sizeBytes: 0 }, 10).some((e) => e.includes('empty')),
    ).toBe(true);
  });
});

describe('quarantine gate (REQ-SEC-020)', () => {
  it('only CLEAN files are servable', () => {
    expect(isServable('CLEAN')).toBe(true);
    expect(isServable('PENDING')).toBe(false);
    expect(isServable('REJECTED')).toBe(false);
    expect(isServable('SCANNER_UNAVAILABLE')).toBe(false);
  });
});
