/**
 * Editable generated documents, version history and communication overrides
 * (owner directive 2026-09-23, DEC-069).
 *
 * The operating model this module states in rules:
 *
 *  - a generated document is a starting point HR may edit, not a fixed text;
 *  - structured case facts stay case data, editable narrative is free text,
 *    and the two are never allowed to contradict each other invisibly;
 *  - every save is a recorded revision - the only copy is never overwritten;
 *  - a signed or sent record is history, and a change means a new version;
 *  - auto-assignment from the business hierarchy is the default recipient,
 *    an override is a visible exception on one communication, and restoring
 *    the default is always one action away.
 *
 * Pure rules only. Persistence, rendering and delivery belong elsewhere.
 */
import {
  DOCUMENT_PLACEHOLDERS,
  REQUIRED_LETTER_PLACEHOLDERS,
  extractPlaceholders,
  templateContentErrors,
  type DocumentPlaceholder,
  type DocumentType,
} from './documents.ts';
import type { ActionFormStatus } from './actionForm.ts';
import type { NotificationStatus } from './notifications.ts';
import { DESTINATION_LABELS, type DestinationKey } from './outbox.ts';

// --- revisions -----------------------------------------------------------------

/** Which kind of record a revision belongs to. */
export const DOCUMENT_KINDS = ['LETTER', 'ACTION_FORM', 'ASSET_RECEIPT', 'EMAIL'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Readonly<Record<DocumentKind, string>> = {
  LETTER: 'Letter',
  ACTION_FORM: 'Employee Action Form',
  ASSET_RECEIPT: 'Exit Checklist for Return Items',
  EMAIL: 'Email',
};

/** Why a revision was written. Shown to HR in the version history. */
export const REVISION_KINDS = [
  'GENERATED',
  'EDITED',
  'FIELDS_REFRESHED',
  'FINALIZED',
  'SUPERSEDED',
  'CORRECTED',
] as const;
export type RevisionKind = (typeof REVISION_KINDS)[number];

export const REVISION_KIND_LABELS: Readonly<Record<RevisionKind, string>> = {
  GENERATED: 'Generated automatically',
  EDITED: 'Edited',
  FIELDS_REFRESHED: 'Fields refreshed from the case',
  FINALIZED: 'Finalized',
  SUPERSEDED: 'Superseded by a new version',
  CORRECTED: 'Replaced by a corrected copy',
};

// --- letters: protected facts and editable narrative ---------------------------

/** Readable names for the facts a letter carries, for the locked chips. */
export const PLACEHOLDER_LABELS: Readonly<Record<DocumentPlaceholder, string>> = {
  CASE_REFERENCE: 'Case reference',
  DOCUMENT_DATE: 'Document date',
  EMPLOYEE_LEGAL_NAME: 'Employee legal name',
  EMPLOYEE_DISPLAY_NAME: 'Employee name',
  EMPLOYEE_FIRST_NAME: 'Employee first name',
  EMPLOYEE_ADDRESS: 'Employee address',
  EMPLOYEE_ID: 'Employee number',
  POSITION: 'Position',
  DEPARTMENT: 'Department',
  LOCATION: 'Location',
  MANAGER_NAME: 'Manager',
  DEPARTURE_TYPE: 'Separation type',
  RESIGNATION_RECEIVED_DATE: 'Date resignation received',
  PROPOSED_LAST_WORKING_DATE: 'Proposed last working day',
  CONFIRMED_LAST_WORKING_DATE: 'Confirmed last working day',
  EFFECTIVE_SEPARATION_DATE: 'Effective separation date',
  EFFECTIVE_SEPARATION_TIME: 'Effective separation time',
  PROPERTY_RETURN_DEADLINE: 'Property return deadline',
  HR_APPROVER_NAME: 'Signatory name',
  HR_APPROVER_TITLE: 'Signatory title',
  TEMPLATE_VERSION: 'Template version',
  DOCUMENT_VERSION: 'Document version',
};

/**
 * The facts an editor must keep in a letter: every placeholder the type
 * requires that the template actually used, plus the signatory lines, which
 * are completed at finalization and are not narrative.
 */
export function protectedPlaceholders(
  type: DocumentType,
  templateBody: string,
): readonly DocumentPlaceholder[] {
  const used = new Set(extractPlaceholders(templateBody));
  const required = REQUIRED_LETTER_PLACEHOLDERS[type] ?? [];
  const protectedSet = new Set<DocumentPlaceholder>([
    ...required.filter((p) => used.has(p)),
    ...(['HR_APPROVER_NAME', 'HR_APPROVER_TITLE'] as const).filter((p) => used.has(p)),
  ]);
  return [...protectedSet];
}

/**
 * Rules for an HR-edited letter body (directive sections 1 to 3).
 *
 * The edited body is held in the template's own format - plain text with the
 * placeholders retained - so the facts keep coming from the case at
 * finalization. HR may add, remove and reword narrative freely; the checks
 * here are the ones that keep the document honest:
 *
 *  - same plain-text discipline as a template (no markup, no engine syntax);
 *  - only placeholders the template's allow-list permits;
 *  - a protected fact may not be removed - if it is wrong, the case is
 *    corrected, not the letter.
 */
export function editedLetterBodyErrors(args: {
  type: DocumentType;
  body: string;
  templateBody: string;
  allowedPlaceholders: readonly string[];
}): string[] {
  const errors = templateContentErrors(args.body, args.allowedPlaceholders);
  const present = new Set(extractPlaceholders(args.body));
  for (const p of protectedPlaceholders(args.type, args.templateBody)) {
    if (!present.has(p))
      errors.push(
        `${PLACEHOLDER_LABELS[p]} is a case fact this letter must keep. Correct it on the case instead of removing it.`,
      );
  }
  return errors;
}

/** One piece of a paragraph: narrative text, or a locked fact. */
export type BodySegment =
  | { kind: 'text'; value: string }
  | { kind: 'fact'; placeholder: DocumentPlaceholder; label: string };

/**
 * Split a body into paragraphs of segments, so an editor can show facts as
 * locked chips and narrative as editable text. Paragraphs are separated by
 * blank lines; single newlines inside a paragraph are line breaks and are
 * kept inside the text segments.
 */
export function segmentBody(body: string): BodySegment[][] {
  const paragraphs = body.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const re = /\[\[([A-Z0-9_]+)\]\]/g;
  return paragraphs.map((para) => {
    const segments: BodySegment[] = [];
    let last = 0;
    for (const m of para.matchAll(re)) {
      const start = m.index ?? 0;
      if (start > last) segments.push({ kind: 'text', value: para.slice(last, start) });
      const name = m[1] as DocumentPlaceholder;
      if ((DOCUMENT_PLACEHOLDERS as readonly string[]).includes(name))
        segments.push({ kind: 'fact', placeholder: name, label: PLACEHOLDER_LABELS[name] });
      else segments.push({ kind: 'text', value: m[0] });
      last = start + m[0].length;
    }
    if (last < para.length) segments.push({ kind: 'text', value: para.slice(last) });
    return segments;
  });
}

/** Rejoin paragraphs of segments into the stored body format. */
export function joinSegments(paragraphs: readonly (readonly BodySegment[])[]): string {
  return paragraphs
    .map((segments) =>
      segments.map((s) => (s.kind === 'fact' ? `[[${s.placeholder}]]` : s.value)).join(''),
    )
    .map((p) =>
      p
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    )
    .filter((p) => p.length > 0)
    .join('\n\n');
}

/** Normalise an editor submission: consistent newlines, no trailing space. */
export function normaliseBody(body: string): string {
  return body
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- narrative fields on structured forms ---------------------------------------

/** Free-text limits the Employee Action Form already enforces, stated once. */
export const FORM_NARRATIVE_LIMITS = {
  hrRemarks: 2000,
  financeNotes: 1000,
  ackReason: 300,
} as const;

// --- display statuses (directive section 36) --------------------------------------

/** The five states a form workspace shows, in the owner's words. */
export const FORM_DISPLAY_STATUSES = [
  'DRAFT',
  'READY',
  'AWAITING_SIGNATURE',
  'SIGNED',
  'FINAL',
] as const;
export type FormDisplayStatus = (typeof FORM_DISPLAY_STATUSES)[number];

export const FORM_DISPLAY_LABELS: Readonly<Record<FormDisplayStatus, string>> = {
  DRAFT: 'Draft',
  READY: 'Ready',
  AWAITING_SIGNATURE: 'Awaiting signature',
  SIGNED: 'Signed',
  FINAL: 'Final',
};

/**
 * Derived, never stored: the stored form status and the signature requests
 * already say everything. Terminal bookkeeping (superseded, voided) keeps its
 * own label and returns null here.
 */
export function formDisplayStatus(args: {
  status: ActionFormStatus;
  openSignatureRequests: number;
  signedSignatureRequests: number;
}): FormDisplayStatus | null {
  if (args.status === 'COMPLETE' || args.status === 'APPROVED') return 'FINAL';
  if (args.status === 'SUPERSEDED' || args.status === 'VOIDED') return null;
  if (args.openSignatureRequests > 0) return 'AWAITING_SIGNATURE';
  if (args.signedSignatureRequests > 0) return 'SIGNED';
  if (args.status === 'READY_FOR_HR_REVIEW' || args.status === 'HR_REVIEWED') return 'READY';
  return 'DRAFT';
}

/** The same five words for the asset receipt's own lifecycle. */
export type ReceiptLifecycle = 'DRAFT' | 'READY' | 'FINAL' | 'SUPERSEDED' | 'VOIDED';

export function receiptDisplayStatus(args: {
  lifecycle: ReceiptLifecycle;
  openSignatureRequests: number;
  signedSignatureRequests: number;
}): FormDisplayStatus | null {
  if (args.lifecycle === 'FINAL') return 'FINAL';
  if (args.lifecycle === 'SUPERSEDED' || args.lifecycle === 'VOIDED') return null;
  if (args.openSignatureRequests > 0) return 'AWAITING_SIGNATURE';
  if (args.signedSignatureRequests > 0) return 'SIGNED';
  return args.lifecycle === 'READY' ? 'READY' : 'DRAFT';
}

/** Email states in the owner's words, mapped from the existing statuses. */
export const EMAIL_DISPLAY_STATUSES = [
  'DRAFT',
  'READY_TO_SEND',
  'QUEUED',
  'SENT',
  'FAILED',
  'CANCELLED',
  'SUPERSEDED',
] as const;
export type EmailDisplayStatus = (typeof EMAIL_DISPLAY_STATUSES)[number];

export const EMAIL_DISPLAY_LABELS: Readonly<Record<EmailDisplayStatus, string>> = {
  DRAFT: 'Draft',
  READY_TO_SEND: 'Ready to send',
  QUEUED: 'Queued',
  SENT: 'Sent',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  SUPERSEDED: 'Superseded',
};

export function emailDisplayStatus(args: {
  status: NotificationStatus;
  /** An outbox row exists and has not been cancelled. */
  queued: boolean;
  /** The development capture holds it, so it "arrived". */
  captured?: boolean;
}): EmailDisplayStatus {
  switch (args.status) {
    case 'DRAFT':
    case 'PENDING_APPROVAL':
      return 'DRAFT';
    case 'READY_FOR_MANUAL_SEND':
      return 'READY_TO_SEND';
    case 'APPROVED':
      return args.queued ? 'QUEUED' : 'READY_TO_SEND';
    case 'SENT':
    case 'MANUALLY_SENT':
    case 'ACKNOWLEDGED':
    case 'CONFIRMED_COMPLETE':
      return 'SENT';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'SUPERSEDED':
      return 'SUPERSEDED';
  }
}

/**
 * Directive section 12: content may change until the message is handed to
 * the outbox; after that it is a historical record. APPROVED means enqueued,
 * so the editable window is exactly the statuses before it.
 */
export const EMAIL_EDITABLE_STATUSES: readonly NotificationStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'READY_FOR_MANUAL_SEND',
];

export function emailContentEditable(status: NotificationStatus): boolean {
  return EMAIL_EDITABLE_STATUSES.includes(status);
}

/** Recipients may change until the message is enqueued or sent. */
export function emailRecipientEditable(status: NotificationStatus): boolean {
  return EMAIL_EDITABLE_STATUSES.includes(status);
}

/** Rules for an edited email, applied to the substituted text HR sees. */
export function editedEmailErrors(args: {
  subject: string;
  body: string;
  externalProvider: boolean;
}): string[] {
  const errors: string[] = [];
  const subject = args.subject.trim();
  const body = normaliseBody(args.body);
  if (!subject) errors.push('The subject cannot be empty.');
  if (subject.length > 300) errors.push('The subject is limited to 300 characters.');
  if (!body) errors.push('The message cannot be empty.');
  if (body.length > 20_000) errors.push('The message is limited to 20,000 characters.');
  if (/[<>]/.test(subject) || /[<>]/.test(body))
    errors.push('The message is plain text; markup is not allowed.');
  if (/\[MISSING:[A-Z0-9_]+\]/.test(body) || /\[MISSING:[A-Z0-9_]+\]/.test(subject))
    errors.push('The message still contains an unresolved field marker.');
  if (args.externalProvider) {
    // The minimum-data rule for external providers applies to the words HR
    // types just as it applies to the template.
    for (const banned of ['reason', 'termination', 'resignation', 'dismiss']) {
      if (body.toLowerCase().includes(banned) || subject.toLowerCase().includes(banned))
        errors.push(
          `A message to an external provider must not mention "${banned}" (minimum data).`,
        );
    }
  }
  return errors;
}

// --- recipient overrides (directive sections 15 to 30) ------------------------------

/** How the recipient on one communication differs from the auto-assignment. */
export const RECIPIENT_OVERRIDE_KINDS = ['RECIPIENT', 'ADDRESS', 'MANUAL'] as const;
export type RecipientOverrideKind = (typeof RECIPIENT_OVERRIDE_KINDS)[number];

export const RECIPIENT_OVERRIDE_LABELS: Readonly<Record<RecipientOverrideKind, string>> = {
  RECIPIENT: 'Recipient changed',
  ADDRESS: 'Email address changed',
  MANUAL: 'Manual recipient',
};

/**
 * "Auto-assigned from ..." in HR's words (section 29). The destination key
 * is the route the hierarchy resolved; the label names the relationship.
 */
export function autoAssignmentSource(key: DestinationKey | string | null | undefined): string {
  if (!key) return 'Not auto-assigned';
  const [kind, name] = key.split(':');
  switch (name) {
    case 'EMPLOYEE_MANAGER':
      return "Auto-assigned from the employee's reporting manager";
    case 'ASSIGNED_HR_OFFICER':
      return 'Auto-assigned from case HR ownership';
    case 'CASE_OWNER':
      return 'Auto-assigned from the case owner';
    case 'EMPLOYEE':
      return 'Auto-assigned from the employee record on the case';
    case 'GROUP_HEALTH_PROVIDER':
    case 'GROUP_LIFE_PROVIDER':
    case 'PAYROLL_BANK':
    case 'PENSION_PROVIDER':
    case 'OTHER_APPROVED_EXTERNAL':
      return `Auto-assigned from the selected provider (${DESTINATION_LABELS[name as keyof typeof DESTINATION_LABELS]})`;
    default:
      return kind === 'static' && name && name in DESTINATION_LABELS
        ? `Auto-assigned from ${DESTINATION_LABELS[name as keyof typeof DESTINATION_LABELS]} recipient configuration`
        : 'Auto-assigned';
  }
}

/** What the reader is told about where a communication will go. */
export interface RecipientPresentation {
  /** Who it is going to now. */
  to: { name: string | null; address: string | null; mask: string | null };
  /** Where the hierarchy would send it. */
  auto: { name: string | null; mask: string | null; source: string } | null;
  overrideKind: RecipientOverrideKind | null;
  /** True when the hierarchy could not resolve anyone and nobody chose. */
  unresolved: boolean;
  /** The one-line status the card shows. */
  headline: string;
}

export function presentRecipient(args: {
  effectiveName: string | null;
  effectiveMask: string | null;
  effectiveAddress?: string | null;
  autoName: string | null;
  autoMask: string | null;
  autoSourceKey: string | null;
  overrideKind: RecipientOverrideKind | null;
}): RecipientPresentation {
  const unresolved = !args.effectiveMask;
  const auto = args.autoSourceKey
    ? {
        name: args.autoName,
        mask: args.autoMask,
        source: autoAssignmentSource(args.autoSourceKey),
      }
    : null;
  let headline: string;
  if (unresolved) headline = 'Recipient not resolved';
  else if (args.overrideKind === 'RECIPIENT')
    headline = `Recipient overridden - original: ${args.autoName ?? args.autoMask ?? 'auto-assigned'}`;
  else if (args.overrideKind === 'ADDRESS')
    headline = `Email address changed for this message - directory address: ${args.autoMask ?? 'unknown'}`;
  else if (args.overrideKind === 'MANUAL') headline = 'Manual recipient entered by HR';
  else headline = auto ? auto.source : 'Recipient entered by HR';
  return {
    to: {
      name: args.effectiveName,
      address: args.effectiveAddress ?? null,
      mask: args.effectiveMask,
    },
    auto,
    overrideKind: args.overrideKind,
    unresolved,
    headline,
  };
}

/** A manual recipient must be a plausible business address with a name. */
export function manualRecipientErrors(input: { name: string; email: string }): string[] {
  const errors: string[] = [];
  if (!input.name.trim()) errors.push('Enter the recipient name.');
  if (input.name.length > 120) errors.push('The recipient name is limited to 120 characters.');
  const email = input.email.trim();
  if (!email) errors.push('Enter the email address.');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    errors.push('Enter a valid email address.');
  return errors;
}
