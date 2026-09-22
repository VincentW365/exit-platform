import { isDepartureType, type DepartureType } from './separation.ts';
/**
 * Controlled document domain rules (Directive 2 sections B-D).
 *
 * Templates are plain structured text with [[PLACEHOLDER]] tokens from an
 * explicit allow-list. No HTML, no scripting, no arbitrary styling ever enters
 * a template; rendering is pure substitution and every value is escaped at the
 * output boundary.
 */
import { createHash } from 'node:crypto';
import { formatDateOnly, formatInstant } from './calendar.ts';

export const DOCUMENT_TYPES = [
  'RESIGNATION_ACCEPTANCE_WITH_NOTICE',
  'IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT',
  'OFFBOARDING_ACTION_FORM',
  'MANUAL_EXCEPTION_DOCUMENT',
  'TERMINATION_DOCUMENT_PLACEHOLDER',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Letter types rendered from templates. */
export const RENDERABLE_LETTER_TYPES: readonly DocumentType[] = [
  'RESIGNATION_ACCEPTANCE_WITH_NOTICE',
  'IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT',
];

/** Fixed default 17: the termination placeholder is permanently disabled here. */
export function isTypePermanentlyDisabled(type: DocumentType): boolean {
  return type === 'TERMINATION_DOCUMENT_PLACEHOLDER';
}

/**
 * The employee-facing letter a separation produces, if any.
 *
 * Keyed on the separation type so a terminated employee can never receive a
 * resignation acknowledgement (BR-DOC-006, directive 19). A type with no
 * approved letter template returns null rather than borrowing another
 * separation's wording - the platform issues nothing rather than the wrong
 * thing, and HR raises a manual exception document where one is needed.
 */
export function letterTypeForDeparture(departureType: string): DocumentType | null {
  switch (departureType) {
    case 'RESIGNATION_WITH_NOTICE':
      return 'RESIGNATION_ACCEPTANCE_WITH_NOTICE';
    case 'IMMEDIATE_RESIGNATION':
      return 'IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT';
    // Terminations have no operational letter (fixed defaults 17/18). The
    // remaining types have no approved template yet: retirement,
    // contract expiry, redundancy and "other" each need HR's own wording,
    // which the platform must not invent (CLAUDE.md rule 4, DEC-058).
    default:
      return null;
  }
}

// --- placeholder registry (section C field list) -----------------------------

export const DOCUMENT_PLACEHOLDERS = [
  'CASE_REFERENCE',
  'DOCUMENT_DATE',
  'EMPLOYEE_LEGAL_NAME',
  'EMPLOYEE_DISPLAY_NAME',
  'EMPLOYEE_FIRST_NAME',
  'EMPLOYEE_ADDRESS',
  'EMPLOYEE_ID',
  'POSITION',
  'DEPARTMENT',
  'LOCATION',
  'MANAGER_NAME',
  'DEPARTURE_TYPE',
  'RESIGNATION_RECEIVED_DATE',
  'PROPOSED_LAST_WORKING_DATE',
  'CONFIRMED_LAST_WORKING_DATE',
  'EFFECTIVE_SEPARATION_DATE',
  'EFFECTIVE_SEPARATION_TIME',
  'PROPERTY_RETURN_DEADLINE',
  'HR_APPROVER_NAME',
  'HR_APPROVER_TITLE',
  'TEMPLATE_VERSION',
  'DOCUMENT_VERSION',
] as const;
export type DocumentPlaceholder = (typeof DOCUMENT_PLACEHOLDERS)[number];

/** Placeholders resolvable only at approval time. */
const APPROVAL_TIME_PLACEHOLDERS: readonly DocumentPlaceholder[] = [
  'HR_APPROVER_NAME',
  'HR_APPROVER_TITLE',
];

/** Required placeholders for a letter to be submittable. */
export const REQUIRED_LETTER_PLACEHOLDERS: Readonly<
  Partial<Record<DocumentType, readonly DocumentPlaceholder[]>>
> = {
  RESIGNATION_ACCEPTANCE_WITH_NOTICE: [
    'CASE_REFERENCE',
    'DOCUMENT_DATE',
    'EMPLOYEE_LEGAL_NAME',
    'EMPLOYEE_ADDRESS',
    'RESIGNATION_RECEIVED_DATE',
    'CONFIRMED_LAST_WORKING_DATE',
    'EFFECTIVE_SEPARATION_DATE',
    'PROPERTY_RETURN_DEADLINE',
  ],
  IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT: [
    'CASE_REFERENCE',
    'DOCUMENT_DATE',
    'EMPLOYEE_LEGAL_NAME',
    'RESIGNATION_RECEIVED_DATE',
    'EFFECTIVE_SEPARATION_DATE',
    'EFFECTIVE_SEPARATION_TIME',
  ],
};

/**
 * The Company's resignation acceptance letter (DEC-054), transcribed from the
 * HR sample with every value the sample spelled out replaced by a
 * placeholder. The final-payment paragraph is HR's own approved wording: the
 * platform states it and calculates nothing.
 */
export const RESIGNATION_ACCEPTANCE_LETTER_BODY = `[[DOCUMENT_DATE]]

[[EMPLOYEE_LEGAL_NAME]]
[[EMPLOYEE_ADDRESS]]

Dear [[EMPLOYEE_FIRST_NAME]],

Re: Acknowledgement of Resignation

We acknowledge receipt and acceptance of your resignation.

Your final salary payment, inclusive of notice pay and vacation leave earned up to your final day of employment (where applicable), will be processed accordingly. Please note that any outstanding amounts owed to the Company, including lunch or other deductions, will be deducted from your final payment.

Kindly ensure that all Company property in your possession - including your employee ID, health and lunch cards, and uniforms - is returned to the HR Department no later than [[PROPERTY_RETURN_DEADLINE]].

We thank you for your contributions during your tenure and wish you every success in your future endeavors.

Sincerely,
BERT'S AUTO PARTS LIMITED

[[HR_APPROVER_NAME]]
[[HR_APPROVER_TITLE]]

Case reference: [[CASE_REFERENCE]] | Resignation received [[RESIGNATION_RECEIVED_DATE]] | Last working day [[CONFIRMED_LAST_WORKING_DATE]] | Employment ends [[EFFECTIVE_SEPARATION_DATE]]`;
const PLACEHOLDER_RE = /\[\[([A-Z0-9_]+)\]\]/g;

/** Validate template body content (section B rule 6/7). */
export function templateContentErrors(body: string, allowed: readonly string[]): string[] {
  const errors: string[] = [];
  if (!body.trim()) errors.push('Template body is required.');
  if (body.length > 20_000) errors.push('Template body exceeds 20,000 characters.');
  // Plain text only: no markup, no scripting, no style, no template-engine syntax.
  if (/[<>]/.test(body)) errors.push('Template body must be plain text (no HTML markup).');
  if (/\{\{|\}\}|<%|%>|\$\{/.test(body))
    errors.push('Template body must not contain template-engine syntax.');
  for (const m of body.matchAll(PLACEHOLDER_RE)) {
    const name = m[1]!;
    if (!(DOCUMENT_PLACEHOLDERS as readonly string[]).includes(name)) {
      errors.push(`Unsupported placeholder [[${name}]].`);
    } else if (!allowed.includes(name)) {
      errors.push(`Placeholder [[${name}]] is not in this template's allow-list.`);
    }
  }
  // Unbalanced/broken placeholder brackets.
  const stripped = body.replace(PLACEHOLDER_RE, '');
  if (/\[\[|\]\]/.test(stripped)) errors.push('Malformed placeholder brackets found.');
  return errors;
}

export function extractPlaceholders(body: string): string[] {
  return [...new Set([...body.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!))];
}

export function contentChecksum(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// --- field snapshot ----------------------------------------------------------

/** The exact values captured for one document version (section C.2). */
export type DocumentFieldSnapshot = Partial<Record<DocumentPlaceholder, string>>;

export interface CaseFieldsForDocument {
  caseNumber: string;
  departureType: string;
  employeeDisplayName: string;
  employeeLegalName: string;
  /** BambooHR's internal record id - provenance only, never shown as a number. */
  employeeSourceId: string;
  /** The employer's Employee #, where BambooHR holds one. */
  employeeNumber: string | null;
  jobTitle: string | null;
  department: string;
  location: string;
  managerName: string | null;
  /** HR-typed from the resignation letter scan; the letter is addressed. */
  employeeAddress: string | null;
  receivedAt: Date;
  proposedLastDay: Date | null;
  confirmedLastDay: Date | null;
  effectiveSeparationAt: Date | null;
}

/** "Avery Brown" -> "Avery". The letter greets the employee by first name. */
export function firstNameOf(fullName: string): string {
  // Split on WHITESPACE. An earlier form of this line had lost its backslash
  // and split on the letter "s", so a Brown was addressed as "Bro" (found by
  // the offboarding regression suite, 2026-09-09).
  return fullName.trim().split(/\s+/)[0] ?? '';
}

/**
 * The date company property is due back. This is NOT a new HR rule: it is the
 * last working date already confirmed on the case, restated in the letter's
 * own words. Where no last working date exists yet, the effective separation
 * date stands in; where neither does, the placeholder stays empty and the
 * letter cannot be submitted.
 */
export function propertyReturnDeadline(c: {
  confirmedLastDay: Date | null;
  effectiveSeparationAt: Date | null;
}): string {
  const due = c.confirmedLastDay ?? c.effectiveSeparationAt;
  return due ? formatDateOnly(due) : '';
}

/**
 * How a separation is NAMED in a document or a message (directive 19, 20).
 *
 * Finance must never read "the employee has resigned" about a termination,
 * and a retiring employee is not resigning. The phrase comes from the
 * separation profile so a new way of leaving cannot silently borrow another
 * one's wording - the exact failure this map exists to prevent.
 */
const DEPARTURE_PHRASE: Record<DepartureType, string> = {
  RESIGNATION_WITH_NOTICE: 'resignation with notice',
  IMMEDIATE_RESIGNATION: 'immediate resignation',
  TERMINATION: 'termination',
  RETIREMENT: 'retirement',
  CONTRACT_EXPIRY: 'end of contract',
  REDUNDANCY: 'redundancy',
  OTHER: 'separation',
};

/** The phrase for a case, refusing to guess for an unknown value. */
export function departurePhrase(departureType: string): string {
  return isDepartureType(departureType) ? DEPARTURE_PHRASE[departureType] : 'separation';
}

export function buildFieldSnapshot(
  c: CaseFieldsForDocument,
  documentDate: Date,
  documentVersion: number,
  templateVersion: number,
): DocumentFieldSnapshot {
  return {
    CASE_REFERENCE: c.caseNumber,
    DOCUMENT_DATE: formatDateOnly(documentDate),
    EMPLOYEE_LEGAL_NAME: c.employeeLegalName,
    EMPLOYEE_DISPLAY_NAME: c.employeeDisplayName,
    EMPLOYEE_FIRST_NAME: firstNameOf(c.employeeLegalName || c.employeeDisplayName),
    EMPLOYEE_ADDRESS: c.employeeAddress ?? '',
    // The Employee # HR recognizes. Empty rather than wrong where BambooHR
    // holds no number: a letter must never quote an id the employer does not
    // use as an employee number.
    EMPLOYEE_ID: c.employeeNumber ?? 'Not recorded in BambooHR',
    POSITION: c.jobTitle ?? '',
    DEPARTMENT: c.department,
    LOCATION: c.location,
    MANAGER_NAME: c.managerName ?? '',
    DEPARTURE_TYPE: departurePhrase(c.departureType),
    RESIGNATION_RECEIVED_DATE: formatDateOnly(c.receivedAt),
    PROPOSED_LAST_WORKING_DATE: c.proposedLastDay ? formatDateOnly(c.proposedLastDay) : '',
    CONFIRMED_LAST_WORKING_DATE: c.confirmedLastDay ? formatDateOnly(c.confirmedLastDay) : '',
    EFFECTIVE_SEPARATION_DATE: c.effectiveSeparationAt
      ? formatDateOnly(c.effectiveSeparationAt)
      : '',
    EFFECTIVE_SEPARATION_TIME: c.effectiveSeparationAt
      ? (formatInstant(c.effectiveSeparationAt).split(', ')[1] ?? '')
      : '',
    PROPERTY_RETURN_DEADLINE: propertyReturnDeadline(c),
    TEMPLATE_VERSION: `v${templateVersion}`,
    DOCUMENT_VERSION: `v${documentVersion}`,
  };
}

/** Validation before submission (section C.5). */
export function documentValidationErrors(
  type: DocumentType,
  body: string,
  snapshot: DocumentFieldSnapshot,
): string[] {
  const errors: string[] = [];
  const required = REQUIRED_LETTER_PLACEHOLDERS[type] ?? [];
  for (const p of required) {
    if (!snapshot[p]?.trim()) errors.push(`Required field ${p} is missing or empty.`);
  }
  for (const used of extractPlaceholders(body)) {
    if (APPROVAL_TIME_PLACEHOLDERS.includes(used as DocumentPlaceholder)) continue;
    const v = snapshot[used as DocumentPlaceholder];
    if (v === undefined) errors.push(`Placeholder [[${used}]] has no captured value.`);
  }
  // Date-order sanity from the snapshot's ORIGINating case values is checked
  // in the service (it has the raw dates); string-level check here guards the
  // obvious: received date must exist when referenced.
  return errors;
}

/**
 * Substitute placeholders into the template body. Missing values become an
 * explicit visible marker (never silently blank) - validation should have
 * caught them; the marker is a defence in depth and blocks approval.
 */
export function substitute(body: string, snapshot: DocumentFieldSnapshot): string {
  return body.replace(PLACEHOLDER_RE, (_m, name: string) => {
    const v = snapshot[name as DocumentPlaceholder];
    return v && v.trim() ? v : `[MISSING:${name}]`;
  });
}

export function hasMissingMarkers(rendered: string): boolean {
  return /\[MISSING:[A-Z0-9_]+\]/.test(rendered);
}

/** HTML-escape a value for preview output (section C.8). */
export function escapeHtml(v: string): string {
  return v
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// --- template lifecycle ------------------------------------------------------

export type TemplateStatus = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'RETIRED';

export function templateTransitionError(
  action: 'edit' | 'activate' | 'supersede' | 'retire',
  status: TemplateStatus,
  type: DocumentType,
): string | null {
  if (isTypePermanentlyDisabled(type) && action !== 'edit') {
    return 'The termination placeholder is permanently disabled and cannot be activated.';
  }
  switch (action) {
    case 'edit':
      return status === 'DRAFT'
        ? null
        : 'Only DRAFT templates can be edited (active versions are immutable).';
    case 'activate':
      return status === 'DRAFT' ? null : 'Only DRAFT templates can be activated.';
    case 'supersede':
      return status === 'ACTIVE' ? null : 'Only ACTIVE templates can be superseded.';
    case 'retire':
      return status === 'ACTIVE' ? null : 'Only ACTIVE templates can be retired.';
  }
}

// --- document instance lifecycle (section D) --------------------------------

export type DocumentStatus =
  | 'DRAFT'
  | 'VALIDATION_FAILED'
  | 'PENDING_APPROVAL'
  | 'RETURNED'
  | 'APPROVED'
  | 'RENDERING'
  | 'RENDERED'
  | 'MANUALLY_ISSUED'
  | 'ISSUED_BY_EMAIL'
  | 'SUPERSEDED'
  | 'VOIDED'
  | 'RENDER_FAILED';

/**
 * Statuses a document can still be edited (fields refreshed) in. PENDING_APPROVAL
 * and RETURNED are LEGACY statuses from the retired maker-checker model
 * (DEC-066): no new document enters them, but a historical row left in one is
 * still editable and finalizable so nothing is stranded.
 */
export const EDITABLE_DOC_STATUSES: readonly DocumentStatus[] = [
  'DRAFT',
  'RETURNED',
  'VALIDATION_FAILED',
  'PENDING_APPROVAL',
];

interface DocTransition {
  from: readonly DocumentStatus[];
  to: DocumentStatus;
  reasonRequired: boolean;
}

/**
 * Single authorization gate (owner directive 2026-09-22, DEC-066): the HR
 * Manager approves the CASE once; the HR person executing it validates and
 * FINALIZES a document in one attested step, which renders the final PDF.
 * There is no second, per-document HR Manager approval. The submit, return
 * and approve transitions of the retired maker-checker model are gone; a
 * legacy row still sitting in PENDING_APPROVAL or RETURNED finalizes like a
 * draft.
 */
export const DOC_TRANSITIONS = {
  finalize: {
    from: ['DRAFT', 'RETURNED', 'VALIDATION_FAILED', 'PENDING_APPROVAL'],
    to: 'APPROVED',
    reasonRequired: false,
  },
  failValidation: {
    from: ['DRAFT', 'RETURNED', 'VALIDATION_FAILED', 'PENDING_APPROVAL'],
    to: 'VALIDATION_FAILED',
    reasonRequired: false,
  },
  startRender: { from: ['APPROVED', 'RENDER_FAILED'], to: 'RENDERING', reasonRequired: false },
  renderOk: { from: ['RENDERING'], to: 'RENDERED', reasonRequired: false },
  renderFail: { from: ['RENDERING'], to: 'RENDER_FAILED', reasonRequired: false },
  markIssued: { from: ['RENDERED'], to: 'MANUALLY_ISSUED', reasonRequired: false },
  issueByEmail: { from: ['RENDERED'], to: 'ISSUED_BY_EMAIL', reasonRequired: false },
  supersede: {
    from: ['RENDERED', 'MANUALLY_ISSUED', 'ISSUED_BY_EMAIL'],
    to: 'SUPERSEDED',
    reasonRequired: true,
  },
  void: {
    from: [
      'DRAFT',
      'VALIDATION_FAILED',
      'PENDING_APPROVAL',
      'RETURNED',
      'APPROVED',
      'RENDER_FAILED',
      'RENDERED',
    ],
    to: 'VOIDED',
    reasonRequired: true,
  },
} as const satisfies Record<string, DocTransition>;

export type DocAction = keyof typeof DOC_TRANSITIONS;

export function docTransitionError(
  action: DocAction,
  status: DocumentStatus,
  reason?: string,
): string | null {
  const t = DOC_TRANSITIONS[action] as DocTransition;
  if (!t.from.includes(status)) return `Action "${action}" is not allowed from status ${status}.`;
  if (t.reasonRequired && !reason?.trim()) return `Action "${action}" requires a reason.`;
  return null;
}

/** Statuses in which a document may be downloaded as final PDF. */
export const DOWNLOADABLE_DOC_STATUSES: readonly DocumentStatus[] = [
  'RENDERED',
  'MANUALLY_ISSUED',
  'ISSUED_BY_EMAIL',
  'SUPERSEDED',
];

/** Live (blocking a new version chain) statuses - mirrors the DB partial index. */
export const LIVE_DOC_STATUSES: readonly DocumentStatus[] = [
  'DRAFT',
  'VALIDATION_FAILED',
  'PENDING_APPROVAL',
  'RETURNED',
  'APPROVED',
  'RENDERING',
  'RENDERED',
  'MANUALLY_ISSUED',
  'ISSUED_BY_EMAIL',
  'RENDER_FAILED',
];
