/**
 * Email banner rules (DEC-067): JPEG inspection, which banner applies to
 * which sender, and the deterministic HTML that carries the image.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chooseEmailBanner,
  emailBannerImageTag,
  emailBannerUploadErrors,
  jpegDimensions,
  linkifyLine,
  notificationCarriesSenderSignature,
  personalBannerAlt,
  renderEmailHtml,
  EMAIL_BANNER_MAX_BYTES,
  type EmailBannerRef,
} from '../src/emailBanner.ts';

const FIXTURE = path.resolve(import.meta.dirname, '../../../e2e/fixtures/email-banner.jpg');

/** A minimal marker chain: SOI, APP0, SOF0 (height 320, width 1500). */
function syntheticJpegHeader(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00, // APP0, length 4
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08, // SOF0, length 17, precision 8
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ]);
}

const REF = (over: Partial<EmailBannerRef> = {}): EmailBannerRef => ({
  objectKey: 'branding/' + 'a'.repeat(48),
  checksum: 'b'.repeat(64),
  mimeType: 'image/jpeg',
  width: 1500,
  height: 320,
  altText: "Bert's Auto Parts email signature",
  fileName: 'email-banner.jpg',
  ...over,
});

describe('JPEG inspection', () => {
  it('reads the pixel size from the Start-Of-Frame segment', () => {
    expect(jpegDimensions(syntheticJpegHeader(1500, 320))).toEqual({ width: 1500, height: 320 });
    expect(jpegDimensions(syntheticJpegHeader(600, 150))).toEqual({ width: 600, height: 150 });
  });

  it('reads the real synthetic fixture the browser suite uploads', () => {
    const bytes = readFileSync(FIXTURE);
    expect(jpegDimensions(bytes)).toEqual({ width: 1500, height: 320 });
  });

  it('rejects anything that is not a JPEG', () => {
    expect(jpegDimensions(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // PNG
    expect(jpegDimensions(new Uint8Array(0))).toBeNull();
    expect(jpegDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull(); // SOI then EOI
  });

  it('validates an upload: extension, declared type, content, size and dimensions', () => {
    const ok = { fileName: 'banner.jpg', declaredMime: 'image/jpeg', bytes: readFileSync(FIXTURE) };
    expect(emailBannerUploadErrors(ok)).toEqual([]);
    expect(emailBannerUploadErrors({ ...ok, fileName: 'banner.png' })).toContain(
      'The email banner must be a .jpg file.',
    );
    expect(emailBannerUploadErrors({ ...ok, declaredMime: 'image/png' })).toContain(
      'The email banner must be a JPEG image.',
    );
    expect(
      emailBannerUploadErrors({ ...ok, bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0]) }),
    ).toContain('The file content is not a JPEG image.');
    expect(emailBannerUploadErrors({ ...ok, bytes: new Uint8Array(0) })).toContain(
      'The file is empty.',
    );
    expect(
      emailBannerUploadErrors({ ...ok, bytes: new Uint8Array(EMAIL_BANNER_MAX_BYTES + 1) }),
    ).toContain('The email banner is limited to 2 MB.');
    expect(
      emailBannerUploadErrors({ ...ok, bytes: syntheticJpegHeader(6000, 100) }).some((e) =>
        e.includes('limited to 4000 x 2000 pixels'),
      ),
    ).toBe(true);
  });
});

describe('which banner an email carries (section 9)', () => {
  const personal = REF({ altText: 'Avery Officer email signature' });
  const department = REF();

  it('a personal signature only where the email is written as coming from that person', () => {
    expect(
      chooseEmailBanner({ personal, department, departmentEnabled: true, signedBySender: true }),
    ).toEqual({ kind: 'PERSONAL', banner: personal });
    expect(
      chooseEmailBanner({ personal, department, departmentEnabled: true, signedBySender: false }),
    ).toEqual({ kind: 'DEPARTMENT', banner: department });
  });

  it('falls back to the department banner, and to none', () => {
    expect(
      chooseEmailBanner({
        personal: null,
        department,
        departmentEnabled: true,
        signedBySender: true,
      }),
    ).toEqual({ kind: 'DEPARTMENT', banner: department });
    expect(
      chooseEmailBanner({
        personal: null,
        department,
        departmentEnabled: false,
        signedBySender: true,
      }),
    ).toBeNull();
    expect(
      chooseEmailBanner({
        personal: null,
        department: null,
        departmentEnabled: true,
        signedBySender: false,
      }),
    ).toBeNull();
  });

  it('knows which notification types carry the HR sender block', () => {
    expect(notificationCarriesSenderSignature('IT_ACCESS_REMOVAL')).toBe(true);
    expect(notificationCarriesSenderSignature('RESIGNATION_ACCEPTANCE_LETTER')).toBe(true);
    expect(notificationCarriesSenderSignature('SAGICOR_GROUP_HEALTH_REMOVAL')).toBe(true);
    expect(notificationCarriesSenderSignature('LINE_MANAGER_HANDOVER')).toBe(false);
    expect(notificationCarriesSenderSignature('FINANCE_OFFBOARDING')).toBe(false);
    expect(notificationCarriesSenderSignature('SURVEY_INVITATION_REFERENCE')).toBe(false);
    expect(notificationCarriesSenderSignature('NOT_A_TYPE')).toBe(false);
  });

  it('personal alt text names the sender, not every word in the graphic', () => {
    expect(personalBannerAlt('Avery Officer')).toBe('Avery Officer email signature');
    expect(personalBannerAlt('  ')).toBe('HR email signature');
  });
});

describe('HTML part (sections 1, 3, 4, 10, 13)', () => {
  const image = {
    src: 'cid:email-banner',
    alt: "Bert's Auto Parts email signature",
    width: 1500,
    height: 320,
  };
  const body =
    'Hello Avery,\n\nYour access is removed at 5:00 PM.\nConfirm here: https://uat.example.test/ack/abc123.\n\nRegards,\nHR Officer\nHuman Resources';

  it('keeps the text, links its URLs and appends one responsive image after the sign-off', () => {
    const html = renderEmailHtml({ bodyText: body, banner: image });
    expect(html).toContain('Hello Avery,');
    expect(html).toContain('<a href="https://uat.example.test/ack/abc123"');
    expect(html.indexOf('Human Resources')).toBeLessThan(html.indexOf('<img '));
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain('src="cid:email-banner"');
    expect(html).toContain('alt="Bert&#39;s Auto Parts email signature"');
    expect(html).toContain('width:100%;max-width:1500px;height:auto;');
    expect(html).not.toContain('background-image');
    expect(html).not.toContain('background:url');
    // A long secure link wraps instead of widening the message on a phone.
    expect(html).toContain('overflow-wrap:anywhere;word-break:break-word;');
  });

  it('escapes user-carried text and survives with no banner at all (section 12)', () => {
    const html = renderEmailHtml({ bodyText: 'Name: <b>Avery</b> & co', banner: null });
    expect(html).toContain('Name: &lt;b&gt;Avery&lt;/b&gt; &amp; co');
    expect(html).not.toContain('<img ');
  });

  it('link detection leaves sentence punctuation outside the address', () => {
    const line = linkifyLine('Open https://x.test/a). Then https://x.test/b, thanks');
    expect(line).toContain('href="https://x.test/a"');
    expect(line).toContain('</a>).');
    expect(line).toContain('href="https://x.test/b"');
    expect(line).toContain('</a>, thanks');
  });

  it('the image tag is a plain email-compatible element with its own maximum width', () => {
    const tag = emailBannerImageTag({ ...image, src: 'https://cdn.example.test/banner.jpg' });
    expect(tag.startsWith('<img ')).toBe(true);
    expect(tag).toContain('width="1500"');
    expect(tag).toContain('display:block;width:100%;max-width:1500px;height:auto;');
    expect(tag).toContain('src="https://cdn.example.test/banner.jpg"');
  });
});
