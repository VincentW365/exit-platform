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

export function letterTypeForDeparture(departureType: string): DocumentType | null {
  if (departureType === 'RESIGNATION_WITH_NOTICE') return 'RESIGNATION_ACCEPTANCE_WITH_NOTICE';
  if (departureType === 'IMMEDIATE_RESIGNATION') return 'IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT';
  return null; // terminations have no operational letter (defaults 17/18)
}

// --- placeholder registry (section C field list) -----------------------------

export const DOCUMENT_PLACEHOLDERS = [
  'CASE_REFERENCE',
  'DOCUMENT_DATE',
  'EMPLOYEE_LEGAL_NAME',
  'EMPLOYEE_DISPLAY_NAME',
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
    'RESIGNATION_RECEIVED_DATE',
    'CONFIRMED_LAST_WORKING_DATE',
    'EFFECTIVE_SEPARATION_DATE',
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
  employeeSourceId: string;
  jobTitle: string | null;
  department: string;
  location: string;
  managerName: string | null;
  receivedAt: Date;
  proposedLastDay: Date | null;
  confirmedLastDay: Date | null;
  effectiveSeparationAt: Date | null;
}

const DEPARTURE_PHRASE: Record<string, string> = {
  RESIGNATION_WITH_NOTICE: 'resignation with notice',
  IMMEDIATE_RESIGNATION: 'immediate resignation',
  TERMINATION: 'termination',
};

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
    EMPLOYEE_ID: c.employeeSourceId,
    POSITION: c.jobTitle ?? '',
    DEPARTMENT: c.department,
    LOCATION: c.location,
    MANAGER_NAME: c.managerName ?? '',
    DEPARTURE_TYPE: DEPARTURE_PHRASE[c.departureType] ?? c.departureType,
    RESIGNATION_RECEIVED_DATE: formatDateOnly(c.receivedAt),
    PROPOSED_LAST_WORKING_DATE: c.proposedLastDay ? formatDateOnly(c.proposedLastDay) : '',
    CONFIRMED_LAST_WORKING_DATE: c.confirmedLastDay ? formatDateOnly(c.confirmedLastDay) : '',
    EFFECTIVE_SEPARATION_DATE: c.effectiveSeparationAt
      ? formatDateOnly(c.effectiveSeparationAt)
      : '',
    EFFECTIVE_SEPARATION_TIME: c.effectiveSeparationAt
      ? formatInstant(c.effectiveSeparationAt).split(', ')[1] + ' (America/Jamaica)'
      : '',
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
  | 'SUPERSEDED'
  | 'VOIDED'
  | 'RENDER_FAILED';

export const EDITABLE_DOC_STATUSES: readonly DocumentStatus[] = [
  'DRAFT',
  'RETURNED',
  'VALIDATION_FAILED',
];

interface DocTransition {
  from: readonly DocumentStatus[];
  to: DocumentStatus;
  reasonRequired: boolean;
}

export const DOC_TRANSITIONS = {
  submit: {
    from: ['DRAFT', 'RETURNED', 'VALIDATION_FAILED'],
    to: 'PENDING_APPROVAL',
    reasonRequired: false,
  },
  failValidation: {
    from: ['DRAFT', 'RETURNED', 'VALIDATION_FAILED'],
    to: 'VALIDATION_FAILED',
    reasonRequired: false,
  },
  return: { from: ['PENDING_APPROVAL'], to: 'RETURNED', reasonRequired: true },
  approve: { from: ['PENDING_APPROVAL'], to: 'APPROVED', reasonRequired: false },
  startRender: { from: ['APPROVED', 'RENDER_FAILED'], to: 'RENDERING', reasonRequired: false },
  renderOk: { from: ['RENDERING'], to: 'RENDERED', reasonRequired: false },
  renderFail: { from: ['RENDERING'], to: 'RENDER_FAILED', reasonRequired: false },
  markIssued: { from: ['RENDERED'], to: 'MANUALLY_ISSUED', reasonRequired: false },
  supersede: { from: ['RENDERED', 'MANUALLY_ISSUED'], to: 'SUPERSEDED', reasonRequired: true },
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
  'RENDER_FAILED',
];
