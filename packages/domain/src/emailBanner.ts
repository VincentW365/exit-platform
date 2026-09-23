/**
 * Email banner / signature image (owner directive 2026-09-23, DEC-067).
 *
 * The banner is a SUPPLIED graphic asset - normally a JPG - inserted near
 * the bottom of every outgoing email as a normal email-compatible `<img>`.
 * The platform never recreates it from text, CSS, logos or typed contact
 * details, never uses it as a CSS background, and never lets a missing
 * banner stop an email: the banner is presentation, not a transactional
 * dependency.
 *
 * This module holds the pure rules: JPEG validation and dimension reading,
 * which banner applies to which sender, and the deterministic HTML that
 * carries the text body plus the image. No network, no storage.
 */
import { escapeHtml } from './documents.ts';
import { NOTIFICATION_PLACEHOLDERS, type NotificationType } from './notifications.ts';

/** The Content-ID the HTML references when the image travels inline. */
export const EMAIL_BANNER_CID = 'email-banner';

/** A signature graphic, not a poster: 2 MB is generous for a JPG banner. */
export const EMAIL_BANNER_MAX_BYTES = 2 * 1024 * 1024;
/** Widest banner accepted; the email displays it no wider than its own pixels. */
export const EMAIL_BANNER_MAX_WIDTH = 4000;
export const EMAIL_BANNER_MAX_HEIGHT = 2000;

/** Concise alt text for the generic company/department banner (section 11). */
export const EMAIL_BANNER_DEFAULT_ALT = "Bert's Auto Parts email signature";

/** Alt text for a personal signature: the sender, not every word in the image. */
export function personalBannerAlt(displayName: string): string {
  const name = displayName.trim() || 'HR';
  return `${name} email signature`;
}

// --- JPEG inspection --------------------------------------------------------

const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && JPEG_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Read the pixel size from a JPEG's Start-Of-Frame segment. Walks the
 * marker chain (no decoding), so a multi-megabyte file costs nothing.
 * Returns null for anything that is not a well-formed JPEG.
 */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isJpeg(bytes)) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    // Padding bytes between segments are legal.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Stand-alone markers carry no length (RSTn, SOI, EOI, TEM).
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xd8) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS before any SOF
    if (offset + 3 >= bytes.length) return null;
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2) return null;
    // SOF0..SOF15 except the DHT/JPG/DAC markers that share the range.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 8 >= bytes.length) return null;
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

export interface BannerUploadCandidate {
  fileName: string;
  declaredMime: string;
  bytes: Uint8Array;
}

/** What a banner upload must satisfy. Empty means acceptable. */
export function emailBannerUploadErrors(candidate: BannerUploadCandidate): string[] {
  const errors: string[] = [];
  const ext = candidate.fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext !== 'jpg' && ext !== 'jpeg') errors.push('The email banner must be a .jpg file.');
  if (candidate.declaredMime && candidate.declaredMime !== 'image/jpeg')
    errors.push('The email banner must be a JPEG image.');
  if (candidate.bytes.byteLength === 0) errors.push('The file is empty.');
  else if (candidate.bytes.byteLength > EMAIL_BANNER_MAX_BYTES)
    errors.push(
      `The email banner is limited to ${Math.round(EMAIL_BANNER_MAX_BYTES / 1024 / 1024)} MB.`,
    );
  if (candidate.bytes.byteLength > 0 && !isJpeg(candidate.bytes))
    errors.push('The file content is not a JPEG image.');
  const dims = jpegDimensions(candidate.bytes);
  if (candidate.bytes.byteLength > 0 && isJpeg(candidate.bytes) && !dims)
    errors.push('The JPEG dimensions could not be read.');
  if (dims && (dims.width > EMAIL_BANNER_MAX_WIDTH || dims.height > EMAIL_BANNER_MAX_HEIGHT))
    errors.push(
      `The email banner is limited to ${EMAIL_BANNER_MAX_WIDTH} x ${EMAIL_BANNER_MAX_HEIGHT} pixels.`,
    );
  return errors;
}

// --- which banner ------------------------------------------------------------

/** A stored banner asset, as the sender or the department configured it. */
export interface EmailBannerRef {
  objectKey: string;
  checksum: string;
  mimeType: string;
  width: number;
  height: number;
  altText: string;
  fileName: string;
}

export type EmailBannerKind = 'PERSONAL' | 'DEPARTMENT';

/**
 * Which banner an email carries (section 9).
 *
 * A personal signature belongs only to an email that is signed by that
 * person - one whose template carries the HR sender block. Everything else
 * (automated departmental notices, generic templates) carries the
 * department/company banner. A personal banner is never applied to an
 * unrelated sender, and no banner at all is a valid outcome.
 */
export function chooseEmailBanner(args: {
  personal: EmailBannerRef | null;
  department: EmailBannerRef | null;
  departmentEnabled: boolean;
  signedBySender: boolean;
}): { kind: EmailBannerKind; banner: EmailBannerRef } | null {
  if (args.signedBySender && args.personal) return { kind: 'PERSONAL', banner: args.personal };
  if (args.departmentEnabled && args.department)
    return { kind: 'DEPARTMENT', banner: args.department };
  return null;
}

/** True when this notification type is written as coming from a named HR sender. */
export function notificationCarriesSenderSignature(notificationType: string): boolean {
  const placeholders = NOTIFICATION_PLACEHOLDERS[notificationType as NotificationType];
  return Array.isArray(placeholders) && placeholders.includes('HR_SENDER_NAME');
}

// --- HTML composition ---------------------------------------------------------

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

/**
 * Escape a line of the text body and turn its URLs into links, so a reader
 * whose client blocks images can still use every link (section 13).
 */
export function linkifyLine(line: string): string {
  let out = '';
  let last = 0;
  for (const match of line.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    // Trailing punctuation belongs to the sentence, not the address.
    let url = match[0];
    let trailing = '';
    while (/[.,;:)!?]$/.test(url)) {
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }
    out += escapeHtml(line.slice(last, start));
    out += `<a href="${escapeHtml(url)}" style="color:#1d4ed8;">${escapeHtml(url)}</a>${escapeHtml(trailing)}`;
    last = start + match[0].length;
  }
  out += escapeHtml(line.slice(last));
  return out;
}

export interface EmailBannerImage {
  /** `cid:...` for an inline part, or an https URL the client fetches. */
  src: string;
  alt: string;
  width: number;
  height: number;
}

/**
 * The banner as a normal email-compatible image element (sections 3-4):
 * block-level, scales down with the column, never wider than its own pixels,
 * height follows automatically, never a CSS background.
 */
export function emailBannerImageTag(image: EmailBannerImage): string {
  const maxWidth = Math.max(1, Math.round(image.width));
  return (
    `<img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" ` +
    `width="${maxWidth}" ` +
    `style="display:block;width:100%;max-width:${maxWidth}px;height:auto;border:0;outline:none;text-decoration:none;" />`
  );
}

/**
 * Deterministic HTML for an outgoing email: the plain-text body, paragraph
 * by paragraph with its links usable, then spacing, then the banner (section
 * 1 and 10). The text part travels alongside unchanged, so a text-only client
 * loses nothing that matters.
 */
export function renderEmailHtml(args: {
  bodyText: string;
  banner: EmailBannerImage | null;
}): string {
  const paragraphs = args.bodyText
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 1em;">${p
          .split('\n')
          .map((line) => linkifyLine(line))
          .join('<br />')}</p>`,
    )
    .join('\n');
  const banner = args.banner
    ? `\n<div style="margin-top:28px;">${emailBannerImageTag(args.banner)}</div>`
    : '';
  return (
    '<!DOCTYPE html>\n<html><head><meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" /></head>' +
    // Long links (secure single-use URLs) must wrap on a phone rather than
    // widen the message: no horizontal scrolling at any width (section 3).
    '<body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111827;overflow-wrap:anywhere;word-break:break-word;">' +
    `<div style="max-width:720px;overflow-wrap:anywhere;word-break:break-word;">${paragraphs}${banner}</div>` +
    '</body></html>'
  );
}
