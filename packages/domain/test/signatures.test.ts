import { describe, expect, it } from 'vitest';
import {
  ACTION_FORM_SIGNATURE_BLOCKS,
  SIGNATURE_IMAGE_MAX_BYTES,
  SIGNATURE_LINK_DEFAULT_DAYS,
  SIGNATURE_LINK_MAX_DAYS,
  SIGNING_PAGE_MESSAGES,
  blocksForSigner,
  clampSignatureLinkDays,
  decodeSignatureDataUrl,
  effectiveRequestStatus,
  extendedSignatureExpiry,
  extendedSignatureExpiryErrors,
  generateSignatureToken,
  hashSignatureToken,
  isPlausibleSignatureToken,
  isPng,
  missingBlocks,
  pngDimensions,
  requestAcceptsSignature,
  signatureBlock,
  signatureImageErrors,
  signatureLinkExpiry,
  signatureTokenMatchesHash,
} from '../src/signatures.ts';

/** DEC-068: the pure signing rules - links, blocks and image inspection. */

const DAY = 24 * 60 * 60_000;
const issuedAt = new Date('2026-09-01T09:00:00.000Z');

/** A real 1x1 transparent PNG, so the inspector is tested against a file. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('signing tokens', () => {
  it('produces unguessable values and matches only its own hash', () => {
    const a = generateSignatureToken();
    const b = generateSignatureToken();
    expect(a).not.toEqual(b);
    expect(isPlausibleSignatureToken(a)).toBe(true);
    expect(signatureTokenMatchesHash(a, hashSignatureToken(a))).toBe(true);
    expect(signatureTokenMatchesHash(b, hashSignatureToken(a))).toBe(false);
  });

  it('rejects a value that is not shaped like a token before any lookup', () => {
    expect(isPlausibleSignatureToken('')).toBe(false);
    expect(isPlausibleSignatureToken('short')).toBe(false);
    expect(isPlausibleSignatureToken(`${generateSignatureToken()}x`)).toBe(false);
  });

  it('never exposes the raw value through its hash', () => {
    const token = generateSignatureToken();
    expect(hashSignatureToken(token)).not.toContain(token);
    expect(hashSignatureToken(token)).toHaveLength(64);
  });
});

describe('link lifetime', () => {
  it('defaults to a generous window rather than hours', () => {
    expect(SIGNATURE_LINK_DEFAULT_DAYS).toBe(30);
    expect(SIGNATURE_LINK_MAX_DAYS).toBe(90);
    const expiry = signatureLinkExpiry({
      issuedAt,
      validDays: SIGNATURE_LINK_DEFAULT_DAYS,
      maxDays: SIGNATURE_LINK_MAX_DAYS,
    });
    expect(expiry.getTime() - issuedAt.getTime()).toBe(30 * DAY);
  });

  it('caps a configured window at the configured maximum', () => {
    const expiry = signatureLinkExpiry({ issuedAt, validDays: 365, maxDays: 90 });
    expect(expiry.getTime() - issuedAt.getTime()).toBe(90 * DAY);
    expect(clampSignatureLinkDays(365, 90)).toBe(90);
    expect(clampSignatureLinkDays(0, 90)).toBe(1);
    expect(clampSignatureLinkDays(Number.NaN, 90)).toBe(SIGNATURE_LINK_DEFAULT_DAYS);
  });

  it('extends from the current expiry when the link is still live', () => {
    const currentExpiry = new Date(issuedAt.getTime() + 30 * DAY);
    const now = new Date(issuedAt.getTime() + 10 * DAY);
    const out = extendedSignatureExpiry({ issuedAt, currentExpiry, addDays: 14, now, maxDays: 90 });
    expect(out.expiresAt.getTime()).toBe(currentExpiry.getTime() + 14 * DAY);
    expect(out.cappedByMaximum).toBe(false);
  });

  it('extends from now when the link has already lapsed', () => {
    const currentExpiry = new Date(issuedAt.getTime() + 30 * DAY);
    const now = new Date(issuedAt.getTime() + 40 * DAY);
    const out = extendedSignatureExpiry({ issuedAt, currentExpiry, addDays: 7, now, maxDays: 90 });
    expect(out.expiresAt.getTime()).toBe(now.getTime() + 7 * DAY);
  });

  it('never extends past the maximum measured from issue, so no link is permanent', () => {
    const currentExpiry = new Date(issuedAt.getTime() + 85 * DAY);
    const now = new Date(issuedAt.getTime() + 80 * DAY);
    const out = extendedSignatureExpiry({ issuedAt, currentExpiry, addDays: 30, now, maxDays: 90 });
    expect(out.expiresAt.getTime()).toBe(issuedAt.getTime() + 90 * DAY);
    expect(out.cappedByMaximum).toBe(true);
  });

  it('refuses an explicit date in the past or beyond the maximum', () => {
    const now = new Date(issuedAt.getTime() + 10 * DAY);
    const currentExpiry = new Date(issuedAt.getTime() + 30 * DAY);
    expect(
      extendedSignatureExpiryErrors({
        issuedAt,
        currentExpiry,
        requested: new Date(issuedAt.getTime() + 5 * DAY),
        now,
        maxDays: 90,
      }),
    ).toContain('The new expiry must be in the future.');
    const tooFar = extendedSignatureExpiryErrors({
      issuedAt,
      currentExpiry,
      requested: new Date(issuedAt.getTime() + 200 * DAY),
      now,
      maxDays: 90,
    });
    expect(tooFar.join(' ')).toContain('more than 90 days');
  });
});

describe('request status', () => {
  const expiresAt = new Date(issuedAt.getTime() + 30 * DAY);

  it('reads an overdue open request as expired without waiting for a sweep', () => {
    const now = new Date(expiresAt.getTime() + 1);
    expect(effectiveRequestStatus({ status: 'PENDING', expiresAt, now })).toBe('EXPIRED');
    expect(requestAcceptsSignature({ status: 'PENDING', expiresAt, now })).toBe(false);
  });

  it('keeps a live request open', () => {
    const now = new Date(issuedAt.getTime() + DAY);
    expect(effectiveRequestStatus({ status: 'PENDING', expiresAt, now })).toBe('PENDING');
    expect(requestAcceptsSignature({ status: 'PENDING', expiresAt, now })).toBe(true);
  });

  it('never reopens a signed or revoked request', () => {
    const now = new Date(issuedAt.getTime() + DAY);
    for (const status of ['SIGNED', 'REVOKED', 'EXPIRED'] as const) {
      expect(effectiveRequestStatus({ status, expiresAt, now })).toBe(status);
      expect(requestAcceptsSignature({ status, expiresAt, now })).toBe(false);
    }
  });

  it('states the owner-specified wording for every unusable link', () => {
    expect(SIGNING_PAGE_MESSAGES.completed).toBe(
      'This signing request has already been completed.',
    );
    expect(SIGNING_PAGE_MESSAGES.expired).toBe(
      'This signing link has expired. Please contact HR for a new or extended link.',
    );
    expect(SIGNING_PAGE_MESSAGES.invalid).toBe('This signing request is no longer valid.');
  });
});

describe('form signature blocks', () => {
  it('asks the employee for initials on each section and one full signature', () => {
    const employee = blocksForSigner('EMPLOYEE');
    expect(employee.filter((b) => b.type === 'INITIALS')).toHaveLength(3);
    expect(employee.filter((b) => b.type === 'SIGNATURE')).toHaveLength(1);
  });

  it('adds no HR Manager signature, because this form has no manager approval', () => {
    expect(ACTION_FORM_SIGNATURE_BLOCKS.some((b) => b.signer === 'HR_MANAGER')).toBe(false);
    expect(blocksForSigner('HR_MANAGER')).toHaveLength(0);
  });

  it('names the missing blocks for a partial submission', () => {
    const missing = missingBlocks('EMPLOYEE', ['employeeDetails']);
    expect(missing.map((b) => b.key)).toEqual([
      'separationDetails',
      'employmentStatus',
      'acknowledgement',
    ]);
    expect(
      missingBlocks(
        'EMPLOYEE',
        blocksForSigner('EMPLOYEE').map((b) => b.key),
      ),
    ).toHaveLength(0);
  });

  it('does not recognise a block that is not on the form', () => {
    expect(signatureBlock('payrollAuthorisation')).toBeNull();
    expect(signatureBlock('acknowledgement')?.signer).toBe('EMPLOYEE');
  });
});

describe('signature image inspection', () => {
  it('accepts a real PNG and reads its dimensions from the header', () => {
    expect(isPng(PNG_1x1)).toBe(true);
    expect(pngDimensions(PNG_1x1)).toEqual({ width: 1, height: 1 });
  });

  it('rejects anything that is not a PNG', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(isPng(jpeg)).toBe(false);
    expect(signatureImageErrors({ bytes: jpeg, type: 'SIGNATURE' }).join(' ')).toContain(
      'was not captured correctly',
    );
  });

  it('rejects a mark too small to be a signature and one too large to store', () => {
    expect(signatureImageErrors({ bytes: PNG_1x1, type: 'SIGNATURE' }).length).toBeGreaterThan(0);
    const huge = Buffer.concat([PNG_1x1, Buffer.alloc(SIGNATURE_IMAGE_MAX_BYTES)]);
    expect(signatureImageErrors({ bytes: huge, type: 'SIGNATURE' }).join(' ')).toContain(
      'too large',
    );
  });

  it('decodes only a PNG data URL, never another scheme or media type', () => {
    const dataUrl = `data:image/png;base64,${PNG_1x1.toString('base64')}`;
    expect(decodeSignatureDataUrl(dataUrl)).not.toBeNull();
    expect(decodeSignatureDataUrl('data:image/svg+xml;base64,PHN2Zy8+')).toBeNull();
    expect(decodeSignatureDataUrl('javascript:alert(1)')).toBeNull();
    expect(decodeSignatureDataUrl('data:text/html;base64,PGgxPmhp')).toBeNull();
  });
});
