/**
 * Attachment validation (REQ-SEC-019/020/021, REQ-NFR-018).
 *
 * Tight allow-list for Stage 1: resignation letters and supporting evidence
 * arrive as PDF or image scans. Extension, declared MIME type and file
 * signature (magic bytes) must all agree; size is bounded by configuration.
 */
export const ATTACHMENT_PURPOSES = ['RESIGNATION_LETTER', 'SUPPORTING_DOCUMENT'] as const;
export type AttachmentPurpose = (typeof ATTACHMENT_PURPOSES)[number];

interface AllowedType {
  readonly extension: string;
  readonly mime: string;
  readonly magic: readonly (readonly number[])[];
}

const ALLOWED_TYPES: readonly AllowedType[] = [
  { extension: 'pdf', mime: 'application/pdf', magic: [[0x25, 0x50, 0x44, 0x46]] }, // %PDF
  { extension: 'png', mime: 'image/png', magic: [[0x89, 0x50, 0x4e, 0x47]] },
  {
    extension: 'jpg',
    mime: 'image/jpeg',
    magic: [[0xff, 0xd8, 0xff]],
  },
  {
    extension: 'jpeg',
    mime: 'image/jpeg',
    magic: [[0xff, 0xd8, 0xff]],
  },
];

// Stage 4 (Directive 4 section H) added QUARANTINED / INFECTED / SCAN_FAILED.
export const SCAN_STATUSES = [
  'PENDING',
  'CLEAN',
  'REJECTED',
  'SCANNER_UNAVAILABLE',
  'QUARANTINED',
  'INFECTED',
  'SCAN_FAILED',
] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export interface UploadCandidate {
  readonly fileName: string;
  readonly declaredMime: string;
  readonly sizeBytes: number;
  /** First bytes of the file content. */
  readonly head: Uint8Array;
}

export function uploadValidationErrors(candidate: UploadCandidate, maxUploadMb: number): string[] {
  const errors: string[] = [];
  const name = candidate.fileName.trim();
  if (!name || name.length > 200) errors.push('File name is missing or too long.');
  if (/[\\/]|\.\./.test(name)) errors.push('File name must not contain path segments.');
  // Control and bidirectional-override characters enable extension spoofing
  // (e.g. RTLO "fdp.exe" tricks) and log/header injection.
  if (/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(name))
    errors.push('File name contains control or bidirectional characters.');

  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const allowed = ALLOWED_TYPES.find((t) => t.extension === ext);
  if (!allowed) {
    errors.push(`File type ".${ext || '?'}" is not allowed. Allowed: pdf, png, jpg, jpeg.`);
    return errors;
  }
  if (candidate.declaredMime.toLowerCase() !== allowed.mime) {
    errors.push(`Declared content type "${candidate.declaredMime}" does not match ".${ext}".`);
  }
  const matchesMagic = allowed.magic.some((sig) => sig.every((b, i) => candidate.head[i] === b));
  if (!matchesMagic) {
    errors.push('File content does not match its declared type (signature check failed).');
  }
  const maxBytes = maxUploadMb * 1024 * 1024;
  if (candidate.sizeBytes <= 0) errors.push('File is empty.');
  else if (candidate.sizeBytes > maxBytes) errors.push(`File exceeds the ${maxUploadMb} MB limit.`);
  return errors;
}

/** Only CLEAN files may be served (Architecture.md section 11). */
export function isServable(status: ScanStatus): boolean {
  return status === 'CLEAN';
}
