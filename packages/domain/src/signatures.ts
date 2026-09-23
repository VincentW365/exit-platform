/**
 * Electronic initials and signatures (owner directives 2026-09-23, DEC-068).
 *
 * The Employee Action Form becomes a signable company record: the signer
 * draws initials and a signature with a finger, stylus, trackpad or mouse,
 * and the drawn image is stored privately and rendered onto the final PDF.
 *
 * Two things this module keeps separate, because the business does:
 *
 *  - a DECISION (approve / acknowledge) is recorded as data;
 *  - a SIGNATURE is an image plus the metadata proving who applied it.
 *
 * A signature image never implies a decision (directive 1 section 9), and no
 * signature block here introduces an approval the form does not already have
 * (section 36: case approval remains the one HR Manager gate).
 *
 * Pure rules only: image inspection, which blocks the form requires, link
 * lifetime arithmetic and wording. No storage, no network, no clock policy
 * beyond what is passed in.
 */
import {
  generateSurveyToken,
  hashSurveyToken,
  isPlausibleToken,
  tokenMatchesHash,
} from './survey.ts';

// --- token primitives ---------------------------------------------------------

/**
 * The same CSPRNG/hash discipline the acknowledgement and survey links use
 * (in-repo precedent): 256-bit value, sha256 stored, raw value never logged.
 * Reused rather than reinvented (directive 1 section 40).
 */
export const generateSignatureToken = generateSurveyToken;
export const hashSignatureToken = hashSurveyToken;
export const signatureTokenMatchesHash = tokenMatchesHash;
export const isPlausibleSignatureToken = isPlausibleToken;

// --- link lifetime ------------------------------------------------------------

/** Directive 2 section 26: configurable, generous, never hard-coded short. */
export const SIGNATURE_LINK_DEFAULT_DAYS = 30;
export const SIGNATURE_LINK_MAX_DAYS = 90;
/** A signing window shorter than this is a configuration mistake, not a policy. */
export const SIGNATURE_LINK_MIN_DAYS = 1;

/** Extension choices offered in the interface (directive 2 section 3). */
export const SIGNATURE_EXTEND_CHOICES = [7, 14, 30] as const;

export function clampSignatureLinkDays(days: number, maxDays: number): number {
  if (!Number.isFinite(days)) return SIGNATURE_LINK_DEFAULT_DAYS;
  const ceiling = Number.isFinite(maxDays) ? maxDays : SIGNATURE_LINK_MAX_DAYS;
  return Math.min(Math.max(Math.round(days), SIGNATURE_LINK_MIN_DAYS), Math.round(ceiling));
}

/** When a link issued now should stop working, given the configured window. */
export function signatureLinkExpiry(args: {
  issuedAt: Date;
  validDays: number;
  maxDays: number;
}): Date {
  const days = clampSignatureLinkDays(args.validDays, args.maxDays);
  return new Date(args.issuedAt.getTime() + days * 24 * 60 * 60_000);
}

/**
 * A new expiry for an extension, measured from NOW, never beyond the maximum
 * window measured from when the request was first issued. A long-lived link
 * is deliberate; a permanently valid bearer token is not (directive 2
 * section 4).
 */
export function extendedSignatureExpiry(args: {
  issuedAt: Date;
  currentExpiry: Date;
  addDays: number;
  now: Date;
  maxDays: number;
}): { expiresAt: Date; cappedByMaximum: boolean } {
  const ceiling = new Date(
    args.issuedAt.getTime() + clampSignatureLinkDays(args.maxDays, args.maxDays) * 24 * 60 * 60_000,
  );
  const from = args.currentExpiry.getTime() > args.now.getTime() ? args.currentExpiry : args.now;
  const wanted = new Date(
    from.getTime() + Math.max(1, Math.round(args.addDays)) * 24 * 60 * 60_000,
  );
  return wanted.getTime() > ceiling.getTime()
    ? { expiresAt: ceiling, cappedByMaximum: true }
    : { expiresAt: wanted, cappedByMaximum: false };
}

export function extendedSignatureExpiryErrors(args: {
  issuedAt: Date;
  currentExpiry: Date;
  requested: Date;
  now: Date;
  maxDays: number;
}): string[] {
  const errors: string[] = [];
  if (Number.isNaN(args.requested.getTime())) return ['Choose a valid date.'];
  if (args.requested.getTime() <= args.now.getTime())
    errors.push('The new expiry must be in the future.');
  const ceiling =
    args.issuedAt.getTime() + clampSignatureLinkDays(args.maxDays, args.maxDays) * 24 * 60 * 60_000;
  if (args.requested.getTime() > ceiling)
    errors.push(
      `A signing link cannot run more than ${Math.round(args.maxDays)} days from when it was created. Issue a new link instead.`,
    );
  return errors;
}

// --- request status -----------------------------------------------------------

export const SIGNATURE_REQUEST_STATUSES = ['PENDING', 'SIGNED', 'REVOKED', 'EXPIRED'] as const;
export type SignatureRequestStatus = (typeof SIGNATURE_REQUEST_STATUSES)[number];

export const SIGNATURE_REQUEST_STATUS_LABELS: Readonly<Record<SignatureRequestStatus, string>> = {
  PENDING: 'Awaiting signature',
  SIGNED: 'Signed',
  REVOKED: 'Revoked',
  EXPIRED: 'Expired',
};

/**
 * What the case screen shows. A stored PENDING request whose expiry has
 * passed reads as Expired immediately, without waiting for the sweep.
 */
export function effectiveRequestStatus(args: {
  status: SignatureRequestStatus;
  expiresAt: Date;
  now: Date;
}): SignatureRequestStatus {
  if (args.status !== 'PENDING') return args.status;
  return args.expiresAt.getTime() < args.now.getTime() ? 'EXPIRED' : 'PENDING';
}

/** Whether a signer may still act on this request. */
export function requestAcceptsSignature(args: {
  status: SignatureRequestStatus;
  expiresAt: Date;
  now: Date;
}): boolean {
  return effectiveRequestStatus(args) === 'PENDING';
}

/** Neutral wording for the public page - never a reason, never case data. */
export const SIGNING_PAGE_MESSAGES = {
  completed: 'This signing request has already been completed.',
  expired: 'This signing link has expired. Please contact HR for a new or extended link.',
  invalid: 'This signing request is no longer valid.',
} as const;

// --- signers and blocks --------------------------------------------------------

export const SIGNER_ROLES = ['EMPLOYEE', 'HR_OFFICER', 'HR_MANAGER', 'OTHER'] as const;
export type SignerRole = (typeof SIGNER_ROLES)[number];

export const SIGNER_ROLE_LABELS: Readonly<Record<SignerRole, string>> = {
  EMPLOYEE: 'Employee',
  HR_OFFICER: 'HR Officer',
  HR_MANAGER: 'HR Manager',
  OTHER: 'Other signer',
};

export const SIGNATURE_TYPES = ['INITIALS', 'SIGNATURE'] as const;
export type SignatureType = (typeof SIGNATURE_TYPES)[number];

/** How the mark was produced - audited, and shown apart from a drawn mark. */
export const SIGNATURE_PROVENANCES = ['DRAWN', 'TYPED'] as const;
export type SignatureProvenance = (typeof SIGNATURE_PROVENANCES)[number];

export interface SignatureBlock {
  key: string;
  /** What the signer is initialling or signing, in the form's own words. */
  label: string;
  type: SignatureType;
  signer: SignerRole;
}

/**
 * The Employee Action Form's signable blocks.
 *
 * The labels name sections the printed form ALREADY carries; initialling a
 * section carries its ordinary meaning - "I have reviewed this" - and adds no
 * new HR rule (CLAUDE.md rule 4, directive 1 section 39). The employee's full
 * signature applies the acknowledgement the form already records; the HR
 * block is the completion the assigned officer already attests. No manager
 * signature exists here, because this form has no manager approval
 * (DEC-044, DEC-066).
 */
export const ACTION_FORM_SIGNATURE_BLOCKS: readonly SignatureBlock[] = [
  {
    key: 'employeeDetails',
    label: 'Employee and case details',
    type: 'INITIALS',
    signer: 'EMPLOYEE',
  },
  {
    key: 'separationDetails',
    label: 'Separation details and dates',
    type: 'INITIALS',
    signer: 'EMPLOYEE',
  },
  {
    key: 'employmentStatus',
    label: 'Employment status change',
    type: 'INITIALS',
    signer: 'EMPLOYEE',
  },
  {
    key: 'acknowledgement',
    label: 'Employee acknowledgement',
    type: 'SIGNATURE',
    signer: 'EMPLOYEE',
  },
  {
    key: 'hrCompletion',
    label: 'Human Resources',
    type: 'SIGNATURE',
    signer: 'HR_OFFICER',
  },
];

export function blocksForSigner(signer: SignerRole): readonly SignatureBlock[] {
  return ACTION_FORM_SIGNATURE_BLOCKS.filter((b) => b.signer === signer);
}

export function signatureBlock(key: string): SignatureBlock | null {
  return ACTION_FORM_SIGNATURE_BLOCKS.find((b) => b.key === key) ?? null;
}

/**
 * Which blocks are still missing for a signer. Used to decide whether a
 * submission is complete and whether the form may be marked signed.
 */
export function missingBlocks(
  signer: SignerRole,
  applied: readonly string[],
): readonly SignatureBlock[] {
  const done = new Set(applied);
  return blocksForSigner(signer).filter((b) => !done.has(b.key));
}

// --- consent ------------------------------------------------------------------

/**
 * Directive 1 section 16: plain confirmation of intent, stored with the
 * record. Not legal drafting - the business supplies approved wording if it
 * wants different words.
 */
export const SIGNATURE_CONSENT_TEXT =
  'I confirm that the signature and initials I have provided are mine and that I intend to apply them to this form.';

export const SIGNATURE_REVIEW_TEXT = 'I confirm that I have reviewed the information shown above.';

// --- image inspection ----------------------------------------------------------

/** A drawn mark, not a photograph: 1 MB is ample for a trimmed PNG. */
export const SIGNATURE_IMAGE_MAX_BYTES = 1024 * 1024;
export const SIGNATURE_IMAGE_MAX_WIDTH = 4000;
export const SIGNATURE_IMAGE_MAX_HEIGHT = 2000;
/** Below this a "signature" is a stray dot, not a mark anyone made on purpose. */
export const SIGNATURE_IMAGE_MIN_WIDTH = 16;
export const SIGNATURE_IMAGE_MIN_HEIGHT = 8;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && PNG_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Width and height from the PNG IHDR chunk, which is always first: an
 * 8-byte signature, a 4-byte length, the "IHDR" tag, then the dimensions.
 * No decoding, so a large file costs nothing.
 */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isPng(bytes) || bytes.length < 24) return null;
  const tag = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (tag !== 'IHDR') return null;
  const read32 = (at: number) =>
    ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
  const width = read32(16);
  const height = read32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

export interface SignatureImageCandidate {
  bytes: Uint8Array;
  type: SignatureType;
}

/** What a submitted signature image must satisfy. Empty means acceptable. */
export function signatureImageErrors(candidate: SignatureImageCandidate): string[] {
  const noun = candidate.type === 'INITIALS' ? 'initials' : 'signature';
  const errors: string[] = [];
  if (candidate.bytes.byteLength === 0) return [`Draw your ${noun} before confirming.`];
  if (!isPng(candidate.bytes)) return [`The ${noun} image was not captured correctly.`];
  if (candidate.bytes.byteLength > SIGNATURE_IMAGE_MAX_BYTES)
    errors.push(`The ${noun} image is too large.`);
  const dims = pngDimensions(candidate.bytes);
  if (!dims) errors.push(`The ${noun} image could not be read.`);
  else {
    if (dims.width > SIGNATURE_IMAGE_MAX_WIDTH || dims.height > SIGNATURE_IMAGE_MAX_HEIGHT)
      errors.push(`The ${noun} image is larger than the platform accepts.`);
    if (dims.width < SIGNATURE_IMAGE_MIN_WIDTH || dims.height < SIGNATURE_IMAGE_MIN_HEIGHT)
      errors.push(`That ${noun} looks empty. Draw it again.`);
  }
  return errors;
}

/**
 * Decode the `data:image/png;base64,...` payload the signing pad posts.
 * Rejects any other media type outright rather than trusting the prefix.
 */
export function decodeSignatureDataUrl(dataUrl: string): Uint8Array | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match?.[1]) return null;
  try {
    const binary = Buffer.from(match[1], 'base64');
    return binary.byteLength > 0 ? new Uint8Array(binary) : null;
  } catch {
    return null;
  }
}

/**
 * How large the mark prints. The stored image keeps its own aspect ratio; the
 * renderer fits it inside the box without stretching (directive 1 section 6).
 */
export function signatureBoxSize(type: SignatureType): { width: number; height: number } {
  return type === 'INITIALS' ? { width: 90, height: 38 } : { width: 200, height: 56 };
}

/**
 * How an expiry reads in an email or on a card: a date, in the company's
 * words, without a time nobody needs.
 */
export function signatureLinkLabel(expiresAt: Date): string {
  return expiresAt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Jamaica',
  });
}
