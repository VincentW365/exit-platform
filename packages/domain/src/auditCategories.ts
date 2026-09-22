/**
 * Audit event categorization (Directive 6.1 sections K/L/N).
 *
 * Every audit event maps to exactly one business category so the Audit
 * Centre and case timelines can group, filter and summarize without new
 * database columns. Classification is rule-based with an explicit override
 * map; the unit suite asserts totality over AUDIT_EVENT_TYPES.
 */
import type { AuditEventType } from './audit.ts';

export const AUDIT_CATEGORIES = [
  'CASE',
  'ASSIGNMENT',
  'APPROVAL',
  'TASK',
  'WORKFLOW',
  'DOCUMENT',
  'FORM',
  'SURVEY',
  'COMMUNICATION',
  'ASSET',
  'HANDOVER',
  'SECURITY',
  'CLEARANCE',
  'EXCEPTION',
  'DIRECTORY',
  'IDENTITY',
  'CONFIG',
  'PRIVACY',
  'REPORTING',
  'SYSTEM',
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/** Exact-name overrides that the prefix rules below would misfile. */
const OVERRIDES: Partial<Record<AuditEventType, AuditCategory>> = {
  // Approvals are their own investigative lens (M/N).
  CASE_APPROVED: 'APPROVAL',
  DOC_APPROVED: 'APPROVAL',
  DOC_FINALIZED: 'DOCUMENT',
  DOC_APPROVAL_INVALIDATED: 'APPROVAL',
  FORM_MANAGER_APPROVED: 'APPROVAL',
  FORM_HR_APPROVED: 'APPROVAL',
  FORM_APPROVAL_INVALIDATED: 'APPROVAL',
  // Directive 6.3: completion carries the attestation; auto-approval is a
  // system control decision - both belong in the approvals lens.
  FORM_COMPLETED: 'APPROVAL',
  NOTIFICATION_AUTO_APPROVED: 'APPROVAL',
  NOTIFICATION_APPROVED: 'APPROVAL',
  CLEARANCE_APPROVED: 'APPROVAL',
  SECURITY_EXCEPTION_APPROVED: 'APPROVAL',
  RECIPIENT_APPROVED: 'APPROVAL',
  CALENDAR_APPROVED: 'APPROVAL',
  PILOT_ACTIVATION_APPROVED: 'APPROVAL',
  // Assignment lens (M): who has the work.
  TASK_CLAIMED: 'ASSIGNMENT',
  TASK_ASSIGNED: 'ASSIGNMENT',
  TASK_REASSIGNED: 'ASSIGNMENT',
  TASK_RETURNED_TO_QUEUE: 'ASSIGNMENT',
  CASE_OFFICER_ASSIGNED: 'ASSIGNMENT',
  CASE_OFFICER_REASSIGNED: 'ASSIGNMENT',
  CASE_MANAGER_DERIVED: 'ASSIGNMENT',
  CASE_MANAGER_OVERRIDDEN: 'ASSIGNMENT',
  CASE_MANAGER_CONFIRMED: 'ASSIGNMENT',
  HIERARCHY_CHANGE_FLAGGED: 'ASSIGNMENT',
  CASE_OWNER_CHANGED: 'ASSIGNMENT',
  CASE_PARTICIPANT_ADDED: 'ASSIGNMENT',
  CASE_PARTICIPANT_REMOVED: 'ASSIGNMENT',
  // Security lens: denials, restricted access, sensitive views, revocation.
  ACCESS_DENIED: 'SECURITY',
  AUTH_LOGIN_FAILURE: 'SECURITY',
  CASE_VIEWED_RESTRICTED: 'SECURITY',
  CASE_REHIRE_ELIGIBILITY_VIEWED: 'SECURITY',
  ACCESS_SYSTEMS_UPDATED: 'SECURITY',
  ACCESS_REVOCATION_COMPLETED: 'SECURITY',
  ACCESS_REVOCATION_PARTIAL: 'SECURITY',
  ACCESS_TASK_ESCALATED: 'SECURITY',
  SURVEY_RESPONSE_VIEWED: 'SECURITY',
  // Workflow lifecycle vs task work.
  WORKFLOW_ACTIVATED: 'WORKFLOW',
  WORKFLOW_CANCELLED_WITH_CASE: 'WORKFLOW',
  WORKFLOW_SUPERSEDED_TYPE_CHANGE: 'WORKFLOW',
  TASK_DUE_DATES_RECALCULATED: 'WORKFLOW',
  // Files ride with documents.
  FILE_UPLOADED: 'DOCUMENT',
  FILE_DOWNLOADED: 'DOCUMENT',
  FILE_SCAN_STATUS_CHANGED: 'DOCUMENT',
  // Communications: notifications + outbox + recipients.
  RECIPIENT_CHANGED: 'COMMUNICATION',
  RECIPIENT_VERIFIED: 'COMMUNICATION',
  // Privacy operations.
  CASE_ANONYMIZED: 'PRIVACY',
  DSR_UPDATED: 'PRIVACY',
  DISCLOSURE_RECORDED: 'PRIVACY',
  // Directory (BambooHR) lens.
  EMPLOYEE_DIRECTORY_SEARCHED: 'DIRECTORY',
  DIRECTORY_CONNECTION_TESTED: 'DIRECTORY',
  DIRECTORY_PURGED: 'DIRECTORY',
  MANUAL_EMPLOYEE_SOURCE_CREATED: 'DIRECTORY',
  SYNC_RUN_COMPLETED: 'DIRECTORY',
  DIRECTORY_SYNC_REQUESTED: 'DIRECTORY',
  DIRECTORY_SYNC_COMPLETED: 'DIRECTORY',
  DIRECTORY_SYNC_FAILED: 'DIRECTORY',
  DIRECTORY_WEBHOOK_RECEIVED: 'DIRECTORY',
  DIRECTORY_WEBHOOK_REJECTED: 'DIRECTORY',
  // Reporting/audit-centre usage.
  AUDIT_SEARCHED: 'REPORTING',
  AUDIT_EXPORTED: 'REPORTING',
  CASE_EXPORTED: 'REPORTING',
  // Baseline facts are case evidence.
  BASELINE_EVENT_RECORDED: 'CASE',
  BASELINE_EVENT_SUPERSEDED: 'CASE',
  // Config-ish that reads better under SYSTEM.
  ROLE_EXPIRED_REVOKED: 'IDENTITY',
};

const PREFIX_RULES: ReadonlyArray<readonly [RegExp, AuditCategory]> = [
  [/^AUTH_/, 'IDENTITY'],
  [/^IDENTITY_/, 'IDENTITY'],
  // Directive 6.3: acknowledgement tokens and derived-action provenance.
  [/^ACK_/, 'COMMUNICATION'],
  [/^DERIVED_/, 'WORKFLOW'],
  [/^BENEFITS_/, 'CASE'],
  [/^CASE_/, 'CASE'],
  [/^TASK_/, 'TASK'],
  [/^WORKFLOW_DEF_/, 'CONFIG'],
  [/^WORKFLOW_/, 'WORKFLOW'],
  [/^TEMPLATE_/, 'CONFIG'],
  [/^DOC_/, 'DOCUMENT'],
  [/^FORM_/, 'FORM'],
  [/^SURVEY_/, 'SURVEY'],
  [/^NOTIFICATION_/, 'COMMUNICATION'],
  [/^OUTBOX_/, 'COMMUNICATION'],
  [/^ASSET_/, 'ASSET'],
  // The exit checklist records the return of company property.
  [/^RETURN_CHECKLIST_/, 'ASSET'],
  [/^HANDOVER_/, 'HANDOVER'],
  [/^EXCEPTION_/, 'EXCEPTION'],
  [/^CLEARANCE_/, 'CLEARANCE'],
  [/^CONFIG_/, 'CONFIG'],
  [/^REASON_/, 'CONFIG'],
  [/^CALENDAR_/, 'CONFIG'],
  [/^PILOT_/, 'CONFIG'],
  [/^REPORT_/, 'REPORTING'],
  [/^RETENTION_/, 'PRIVACY'],
  [/^BACKUP_/, 'SYSTEM'],
  [/^OUTAGE_/, 'SYSTEM'],
  [/^FALLBACK_/, 'SYSTEM'],
  [/^SUPPORT_/, 'SYSTEM'],
  [/^TRAINING_/, 'SYSTEM'],
];

export function eventCategory(eventType: AuditEventType): AuditCategory {
  const override = OVERRIDES[eventType];
  if (override) return override;
  for (const [pattern, category] of PREFIX_RULES) {
    if (pattern.test(eventType)) return category;
  }
  return 'SYSTEM';
}

/**
 * Technical categories (identity, configuration, system). The separate
 * technical-only feed they once defined for the System Administrator is
 * retired (DEC-063); they remain the classification the single HR Manager
 * feed and the tests use to tell technical events from case events.
 */
export const TECHNICAL_CATEGORIES: readonly AuditCategory[] = ['IDENTITY', 'CONFIG', 'SYSTEM'];

/** Case-timeline filter chips (Directive 6.1 N). */
export const TIMELINE_CHIPS = [
  'ALL',
  'CASE',
  'ASSIGNMENTS',
  'APPROVALS',
  'TASKS',
  'DOCUMENTS',
  'COMMUNICATIONS',
  'ASSETS',
  'SECURITY',
  'CLEARANCE',
] as const;

export type TimelineChip = (typeof TIMELINE_CHIPS)[number];

const CHIP_CATEGORIES: Record<Exclude<TimelineChip, 'ALL'>, readonly AuditCategory[]> = {
  CASE: ['CASE'],
  ASSIGNMENTS: ['ASSIGNMENT'],
  APPROVALS: ['APPROVAL'],
  TASKS: ['TASK', 'WORKFLOW'],
  DOCUMENTS: ['DOCUMENT', 'FORM'],
  COMMUNICATIONS: ['COMMUNICATION', 'SURVEY'],
  ASSETS: ['ASSET', 'HANDOVER'],
  SECURITY: ['SECURITY'],
  CLEARANCE: ['CLEARANCE', 'EXCEPTION'],
};

export function timelineChipCategories(chip: TimelineChip): readonly AuditCategory[] {
  if (chip === 'ALL') return AUDIT_CATEGORIES;
  return CHIP_CATEGORIES[chip];
}

/**
 * Low-value noise hidden from the case timeline by default (Directive 6.1 N:
 * "do not overwhelm ordinary users with low-level system noise").
 */
export const TIMELINE_NOISE_EVENTS: readonly AuditEventType[] = [
  'CASE_REHIRE_ELIGIBILITY_VIEWED',
  'SURVEY_RESPONSE_VIEWED',
  'CASE_VIEWED_RESTRICTED',
  'TASK_DUE_DATES_RECALCULATED',
  'AUDIT_SEARCHED',
];
