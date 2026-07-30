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
  // Stage 3: workflow definitions and instances (Directive 3 B/C)
  'WORKFLOW_DEF_DRAFTED',
  'WORKFLOW_DEF_UPDATED',
  'WORKFLOW_DEF_ACTIVATED',
  'WORKFLOW_DEF_RETIRED',
  'WORKFLOW_ACTIVATED',
  'WORKFLOW_CANCELLED_WITH_CASE',
  'WORKFLOW_SUPERSEDED_TYPE_CHANGE',
  'CASE_PLACED_ON_HOLD',
  'CASE_RESUMED_FROM_HOLD',
  'CASE_REOPENED',
  // Stage 3: task engine (Directive 3 D/E/I)
  'TASK_STARTED',
  'TASK_COMPLETED',
  'TASK_BLOCKED',
  'TASK_UNBLOCKED',
  'TASK_WAIVED',
  'TASK_REASSIGNED',
  'TASK_CANCELLED',
  'TASK_CORRECTED',
  'TASK_DUE_DATES_RECALCULATED',
  'ACCESS_SYSTEMS_UPDATED',
  'ACCESS_REVOCATION_COMPLETED',
  'ACCESS_REVOCATION_PARTIAL',
  'ACCESS_TASK_ESCALATED',
  // Stage 3: notifications (Directive 3 K)
  'NOTIFICATION_PREPARED',
  'NOTIFICATION_SUBMITTED',
  'NOTIFICATION_APPROVED',
  'NOTIFICATION_RETURNED',
  'NOTIFICATION_READY',
  'NOTIFICATION_MANUALLY_SENT',
  'NOTIFICATION_CANCELLED',
  'NOTIFICATION_FAILED',
  'NOTIFICATION_SUPERSEDED',
  'NOTIFICATION_DEV_CAPTURED',
  // Stage 3: assets and handover (Directive 3 L/M)
  'ASSET_ITEM_ADDED',
  'ASSET_STATUS_UPDATED',
  'ASSET_DISPOSITION_RECORDED',
  'HANDOVER_UPDATED',
  'HANDOVER_COMPLETED',
  'HANDOVER_MARKED_NOT_APPLICABLE',
  'HANDOVER_WAIVED',
  'HANDOVER_REOPENED',
  'HANDOVER_HR_REVIEWED',
  // Stage 3: exceptions and clearance (Directive 3 N/O)
  'EXCEPTION_OPENED',
  'EXCEPTION_ESCALATED',
  'EXCEPTION_RESOLVED',
  'SECURITY_EXCEPTION_APPROVED',
  'CLEARANCE_REQUESTED',
  'CLEARANCE_RETURNED',
  'CLEARANCE_APPROVED',
  // Stage 4: outbox and providers (Directive 4 B-D)
  'OUTBOX_ENQUEUED',
  'OUTBOX_SUBMITTED',
  'OUTBOX_FAILED',
  'OUTBOX_CANCELLED',
  'OUTBOX_RETRIED',
  'OUTBOX_DEAD_LETTER_RESOLVED',
  'RECIPIENT_CHANGED',
  'RECIPIENT_APPROVED',
  'RECIPIENT_VERIFIED',
  'CONFIG_SYSTEM_CHANGED',
  // Stage 4: identity and sync (E-F)
  'IDENTITY_USER_SYNCED',
  'IDENTITY_USER_DISABLED',
  'IDENTITY_ACCESS_REVIEW',
  'ROLE_EXPIRED_REVOKED',
  'SYNC_RUN_COMPLETED',
  // Stage 4: taxonomy, calendar, pilot (J-M)
  'REASON_CATEGORY_CHANGED',
  'CALENDAR_APPROVED',
  'PILOT_ACTIVATION_CREATED',
  'PILOT_ACTIVATION_APPROVED',
  'PILOT_STATE_CHANGED',
  'PILOT_SUSPENDED',
  // Stage 4: reporting (N-O)
  'REPORT_EXPORTED',
  'REPORT_SCHEDULE_CHANGED',
  'REPORT_RUN_COMPLETED',
  // Stage 4: privacy, backup, continuity, support (P-T)
  'RETENTION_POLICY_CHANGED',
  'RETENTION_HOLD_PLACED',
  'RETENTION_HOLD_RELEASED',
  'RETENTION_RUN_COMPLETED',
  'CASE_ANONYMIZED',
  'DSR_UPDATED',
  'DISCLOSURE_RECORDED',
  'BACKUP_CREATED',
  'BACKUP_VERIFIED',
  'OUTAGE_DECLARED',
  'OUTAGE_CLOSED',
  'FALLBACK_RECORDED',
  'FALLBACK_RECONCILED',
  'SUPPORT_TICKET_CHANGED',
  'TRAINING_RECORDED',
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
