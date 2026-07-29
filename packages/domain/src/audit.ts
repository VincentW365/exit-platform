/**
 * Audit event vocabulary and PII-safe metadata handling
 * (AuditEventCatalogue.md, REQ-SEC-023/024/025).
 *
 * Audit events are business evidence, not verbose logs. Metadata passed to
 * the audit writer is sanitized defensively: keys that commonly carry
 * personal or secret content are dropped, values are truncated, and nested
 * structures are flattened conservatively.
 */

/** Stage 1 event types - names follow AuditEventCatalogue.md. */
export const AUDIT_EVENT_TYPES = [
  'AUTH_LOGIN_SUCCESS',
  'AUTH_LOGIN_FAILURE',
  'AUTH_LOGOUT',
  'AUTH_ROLE_GRANTED',
  'AUTH_ROLE_REVOKED',
  'CASE_CREATED',
  'CASE_UPDATED',
  'CASE_SUBMITTED',
  'CASE_RETURNED_TO_DRAFT',
  'CASE_APPROVED',
  'CASE_CANCELLED',
  'CASE_VOIDED',
  'CASE_CORRECTED',
  'CASE_EFFECTIVE_TIME_CHANGED',
  'CASE_OWNER_CHANGED',
  'CASE_CLASSIFICATION_CHANGED',
  'CASE_PARTICIPANT_ADDED',
  'CASE_PARTICIPANT_REMOVED',
  'CASE_REHIRE_ELIGIBILITY_SET',
  'CASE_REHIRE_ELIGIBILITY_VIEWED',
  'CASE_NOTE_ADDED',
  'CASE_VIEWED_RESTRICTED',
  'CASE_PURPOSE_CORRECTED',
  'CASE_COHORT_CORRECTED',
  'CASE_EXPORTED',
  'BASELINE_EVENT_RECORDED',
  'BASELINE_EVENT_SUPERSEDED',
  'FILE_UPLOADED',
  'FILE_DOWNLOADED',
  'FILE_SCAN_STATUS_CHANGED',
  'CONFIG_FLAG_CHANGED',
  'CONFIG_CALENDAR_CHANGED',
  'CONFIG_LIST_CHANGED',
  'ACCESS_DENIED',
  // Stage 2: controlled documents
  'TEMPLATE_CREATED',
  'TEMPLATE_UPDATED',
  'TEMPLATE_ACTIVATED',
  'TEMPLATE_SUPERSEDED',
  'TEMPLATE_RETIRED',
  'DOC_CREATED',
  'DOC_UPDATED',
  'DOC_VALIDATION_FAILED',
  'DOC_SUBMITTED',
  'DOC_RETURNED',
  'DOC_APPROVED',
  'DOC_APPROVAL_INVALIDATED',
  'DOC_RENDERED',
  'DOC_RENDER_FAILED',
  'DOC_DOWNLOADED',
  'DOC_MANUALLY_ISSUED',
  'DOC_SUPERSEDED',
  'DOC_VOIDED',
  // Stage 2: action form
  'FORM_CREATED',
  'FORM_UPDATED',
  'FORM_SUBMITTED',
  'FORM_MANAGER_APPROVED',
  'FORM_HR_APPROVED',
  'FORM_RETURNED',
  'FORM_VOIDED',
  'FORM_SUPERSEDED',
  'FORM_APPROVAL_INVALIDATED',
  // Stage 2: exit survey
  'SURVEY_INVITATION_CREATED',
  'SURVEY_ELIGIBILITY_OVERRIDDEN',
  'SURVEY_TOKEN_GENERATED',
  'SURVEY_TOKEN_REGENERATED',
  'SURVEY_MARKED_SENT',
  'SURVEY_REMINDER_RECORDED',
  'SURVEY_CANCELLED',
  'SURVEY_INVALID_CONTACT',
  'SURVEY_MARKED_NOT_ELIGIBLE',
  'SURVEY_DECLINED',
  'SURVEY_EXPIRED',
  'SURVEY_COMPLETED_ONLINE',
  'SURVEY_VERBAL_DEBRIEF_RECORDED',
  'SURVEY_RESPONSE_VIEWED',
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export type AuditResult = 'SUCCESS' | 'DENIED' | 'FAILURE';

/**
 * Metadata keys that must never reach audit metadata or operational logs.
 * Matching is case-insensitive on key substrings.
 */
const FORBIDDEN_KEY_FRAGMENTS = [
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'personalemail',
  'personal_email',
  'homeaddress',
  'home_address',
  'address',
  'phone',
  'signature',
  'ssn',
  'trn',
  'nis',
  'bankaccount',
  'bank_account',
  'salary',
  'reasonnotes',
  'reason_notes',
  'notebody',
  'note_body',
  'body',
  'surveyanswer',
  'answer',
];

const MAX_STRING = 300;
const MAX_KEYS = 30;

export type SafeMetadata = Record<string, string | number | boolean | null>;

/**
 * Sanitize arbitrary metadata into a flat, size-bounded, PII-safe record.
 * Unknown object/array values are summarized, never serialized in full.
 */
export function sanitizeMetadata(input: Record<string, unknown> | undefined): SafeMetadata {
  const out: SafeMetadata = {};
  if (!input) return out;
  let count = 0;
  for (const [rawKey, value] of Object.entries(input)) {
    if (count >= MAX_KEYS) break;
    const keyLower = rawKey.toLowerCase();
    if (FORBIDDEN_KEY_FRAGMENTS.some((f) => keyLower.includes(f))) continue;
    let safe: string | number | boolean | null;
    if (value === null || value === undefined) safe = null;
    else if (typeof value === 'string') safe = value.slice(0, MAX_STRING);
    else if (typeof value === 'number' || typeof value === 'boolean') safe = value;
    else if (value instanceof Date) safe = value.toISOString();
    else if (Array.isArray(value)) safe = `[array:${value.length}]`;
    else safe = '[object]';
    out[rawKey] = safe;
    count += 1;
  }
  return out;
}

export interface AuditDraft {
  readonly eventType: AuditEventType;
  readonly actorType: 'USER' | 'SYSTEM';
  readonly actorId?: string | null;
  readonly effectiveRoles?: readonly string[];
  readonly objectType: string;
  readonly objectId: string;
  readonly caseId?: string | null;
  readonly result: AuditResult;
  readonly correlationId: string;
  readonly metadata?: Record<string, unknown>;
}
