/**
 * Directive 5.1 K.18/K.19: PDF rendering succeeds WITH the approved logo and
 * falls back to the company name (never fails) when the asset is unavailable.
 * Synthetic content only.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '@exit/config';
import { LocalStorageAdapter, setStorageForTests } from '../src/storage.ts';
import {
  readVerifiedPdf,
  renderLetterPdf,
  resetBrandLogoCacheForTests,
} from '../src/services/renderService.ts';

const LETTER_INPUT = {
  title: 'Resignation Acknowledgement (synthetic)',
  confidentiality: 'Confidential - HR controlled',
  caseReference: 'OFF-2099-0001',
  documentReference: 'DOC-TEST-1',
  templateVersion: 'v1',
  documentVersion: 'v1',
  bodyText: 'Synthetic branding verification letter for Avery Brown (EMP-TEST-001).',
  approverName: 'Dana Field',
  approverTitle: 'HR Manager',
  approvedAt: new Date('2026-07-30T12:00:00.000Z'),
  attestationNote: 'Synthetic attestation.',
};

beforeAll(() => {
  setStorageForTests(new LocalStorageAdapter(mkdtempSync(path.join(tmpdir(), 'exit-brand-'))));
});

afterAll(() => {
  delete process.env['BRAND_LOGO_PATH'];
  resetConfigForTests();
  resetBrandLogoCacheForTests();
});

describe('branded PDF rendering (I)', () => {
  it('renders with the approved logo asset available', async () => {
    delete process.env['BRAND_LOGO_PATH'];
    resetConfigForTests();
    resetBrandLogoCacheForTests();
    const out = await renderLetterPdf(LETTER_INPUT);
    expect(out.checksum).toMatch(/^[a-f0-9]{64}$/);
    const bytes = await readVerifiedPdf(out.objectKey, out.checksum);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // The embedded PNG makes the branded document substantially larger than
    // a text-only render; assert both structure and image presence.
    expect(bytes.byteLength).toBeGreaterThan(100_000);
  });

  it('falls back to the company name when the logo is unreadable (I.5)', async () => {
    process.env['BRAND_LOGO_PATH'] = path.join(tmpdir(), 'missing-brand-asset.png');
    resetConfigForTests();
    resetBrandLogoCacheForTests();
    const out = await renderLetterPdf({ ...LETTER_INPUT, documentVersion: 'v2' });
    const bytes = await readVerifiedPdf(out.objectKey, out.checksum);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.byteLength).toBeLessThan(100_000); // text-only fallback
  });
});
