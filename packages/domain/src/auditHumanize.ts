/**
 * Human-readable audit rendering (Directive 6.1 sections K/N/P).
 *
 * Turns structured audit rows into plain business sentences for the Audit
 * Centre and case timelines, and redacts restricted values in before/after
 * displays. Pure presentation logic - no authorization decisions here; the
 * caller decides which rows the viewer may see at all.
 */
import type { AuditEventType, AuditResult, SafeMetadata } from './audit.ts';
import { formatInstant } from './calendar.ts';

export interface HumanizableEvent {
  readonly eventType: AuditEventType | string;
  readonly result: AuditResult | string;
  readonly actorDisplayName?: string | null;
  readonly actorType?: 'USER' | 'SYSTEM' | string;
  readonly metadata?: SafeMetadata | Record<string, unknown> | null;
}

/** Enum-shaped metadata read as words: AUTO_SEND -> "automatic sending". */
const words = (value: string | null): string | null => {
  if (!value) return null;
  const lower = value.replaceAll('_', ' ').trim().toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

/** A stored instant rendered the way the rest of the product renders time. */
const when = (value: string | null): string | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : formatInstant(d);
};

const plural = (count: string | null, noun: string): string => {
  const n = Number(count ?? '0');
  return `${Number.isNaN(n) ? (count ?? '0') : n} ${n === 1 ? noun : `${noun}s`}`;
};

const str = (m: Record<string, unknown> | null | undefined, key: string): string | null => {
  const v = m?.[key];
  if (v === null || v === undefined) return null;
  return String(v);
};

/**
 * Metadata keys whose values must never be shown even to authorized audit
 * viewers (values may concern restricted HR data recorded act-only).
 */
const RESTRICTED_VALUE_KEYS = ['rehire', 'reasoncategory', 'classification_detail', 'restricted'];

export const RESTRICTED_PLACEHOLDER = 'VALUE CHANGED — RESTRICTED';

export function redactAuditValue(key: string, value: unknown): string {
  const k = key.toLowerCase();
  if (RESTRICTED_VALUE_KEYS.some((fragment) => k.includes(fragment))) {
    return RESTRICTED_PLACEHOLDER;
  }
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

/** Sentence templates for the highest-value event families. */
function sentence(e: HumanizableEvent): string {
  const m = (e.metadata ?? {}) as Record<string, unknown>;
  const who = e.actorDisplayName ?? (e.actorType === 'SYSTEM' ? 'the system' : 'a user');
  const reason = str(m, 'reason');
  const withReason = reason ? ` — reason: ${reason}` : '';
  const task = str(m, 'taskCode') ? ` (task ${str(m, 'taskCode')})` : '';

  switch (e.eventType) {
    // Assignment lens (Directive 6.1 M): who had it, who has it, why.
    case 'TASK_CLAIMED':
      return `${who} claimed the task from the department queue${task}`;
    case 'TASK_ASSIGNED':
      return `${who} assigned the task to ${str(m, 'newAssigneeName') ?? 'a responder'}${task}${withReason}`;
    case 'TASK_REASSIGNED':
      return `${who} reassigned the task from ${str(m, 'previousAssigneeName') ?? str(m, 'previousAssigneeId') ?? 'unassigned'} to ${str(m, 'newAssigneeName') ?? str(m, 'assigneeId') ?? 'a responder'}${task}${withReason}`;
    case 'TASK_RETURNED_TO_QUEUE':
      return `${who} returned the task to the department queue${task}${withReason}`;
    case 'CASE_OFFICER_ASSIGNED':
      return `${who} assigned ${str(m, 'newOfficerName') ?? 'an HR officer'} as the operational case owner`;
    case 'CASE_OFFICER_REASSIGNED':
      return `${who} reassigned the case from ${str(m, 'previousOfficerName') ?? 'the previous officer'} to ${str(m, 'newOfficerName') ?? 'a new officer'}${withReason}`;
    case 'CASE_MANAGER_DERIVED':
      return `The reporting manager ${str(m, 'managerName') ?? ''} was derived from the ${str(m, 'sourceSystem') ?? 'directory'} hierarchy`.trim();
    case 'CASE_MANAGER_OVERRIDDEN':
      return `${who} overrode the derived manager (${str(m, 'originalManagerName') ?? 'unknown'} → ${str(m, 'replacementManagerName') ?? 'replacement'})${withReason}`;
    case 'CASE_MANAGER_CONFIRMED':
      return `${who} confirmed the assignment plan (manager routing and department queues)`;
    case 'HIERARCHY_CHANGE_FLAGGED':
      return `A directory sync changed this employee's manager after activation — HR review required (${str(m, 'previousManagerName') ?? '-'} → ${str(m, 'directoryManagerName') ?? '-'})`;
    case 'CASE_PARTICIPANT_ADDED':
      return `${who} added a ${(str(m, 'participantRole') ?? 'participant').toLowerCase()} participant${withReason}`;
    case 'CASE_PARTICIPANT_REMOVED':
      return `${who} removed a participant${withReason}`;
    // Case lifecycle.
    case 'CASE_CREATED':
      return `${who} created the case`;
    case 'CASE_SUBMITTED':
      return `${who} submitted the case for HR review`;
    case 'CASE_APPROVED':
      return `${who} approved the case and captured the immutable snapshot`;
    case 'CASE_RETURNED_TO_DRAFT':
      return `${who} returned the case to draft${withReason}`;
    case 'CASE_EFFECTIVE_TIME_CHANGED':
      return `${who} changed the effective separation time (audited correction)${withReason}`;
    case 'WORKFLOW_ACTIVATED':
      return `${who} activated the workflow and created its tasks`;
    case 'TASK_STARTED':
      return `${who} started the task${task}`;
    case 'TASK_COMPLETED':
      return `${who} completed the task with evidence${task}`;
    case 'TASK_BLOCKED':
      return `${who} marked the task blocked${task}${withReason}`;
    case 'TASK_WAIVED':
      return `${who} waived the task${task}${withReason}`;
    case 'DOC_CREATED':
      return `${who} created a document draft`;
    case 'DOC_APPROVED':
      return `${who} approved the exact document version (attested)`;
    case 'DOC_APPROVAL_INVALIDATED':
      return `A material case change invalidated the document approval`;
    case 'NOTIFICATION_APPROVED':
      return `${who} approved the notification and bound it to its content checksum`;
    // Directive 6.3 AB/correction 11: automated actions read as sentences.
    case 'DERIVED_ACTIONS_COMPUTED':
      return `The system determined the required actions for this case — ${plural(str(m, 'derivedCount'), 'action')}, ${str(m, 'notApplicableCount') ?? '0'} not applicable (rule set ${str(m, 'rulesVersion') ?? '-'})`;
    case 'DERIVED_ACTION_OVERRIDDEN':
      return `${who} overrode the automatic determination for "${str(m, 'title') ?? str(m, 'actionKey') ?? 'an action'}"${withReason}`;
    case 'BENEFITS_APPLICABILITY_SET':
      return `${who} confirmed benefits applicability (group health: ${str(m, 'groupHealth') ?? '-'}, group life: ${str(m, 'groupLife') ?? '-'})`;
    case 'NOTIFICATION_AUTO_PREPARED':
      return `The system prepared the ${str(m, 'notificationType')?.replaceAll('_', ' ').toLowerCase() ?? ''} notification — rule: ${str(m, 'ruleKey') ?? 'derived requirement'}`;
    case 'NOTIFICATION_AUTO_APPROVED':
      return `The system released the notification for sending${str(m, 'scheduledSendAt') ? ` — scheduled for ${when(str(m, 'scheduledSendAt'))}` : ''}`;
    case 'NOTIFICATION_SENT':
      return `The notification was submitted through the configured provider`;
    case 'NOTIFICATION_ACKNOWLEDGED':
      return str(m, 'via') === 'HR_RECORDED'
        ? `${who} recorded receipt confirmation (${str(m, 'channel') ?? 'evidence'})`
        : `Receipt was acknowledged through the secure confirmation link`;
    case 'NOTIFICATION_COMPLETION_CONFIRMED':
      return str(m, 'via') === 'HR_RECORDED'
        ? `${who} recorded completion evidence (${str(m, 'channel') ?? 'evidence'})${withReason}`
        : `Completion was confirmed through the secure confirmation link`;
    case 'NOTIFICATION_RECIPIENT_SET':
      return `${who} entered the notification recipient (${str(m, 'scope') === 'CASE_ONLY' ? 'this case only' : 'saved for future cases'})`;
    case 'ACK_TOKEN_ISSUED':
      return `A secure confirmation link was issued (expires ${str(m, 'expiresAt') ?? '-'})`;
    case 'ACK_TOKEN_USED':
      return `The secure confirmation link was used (${str(m, 'purpose')?.replaceAll('_', ' ').toLowerCase() ?? 'acknowledgement'})`;
    case 'ACK_TOKEN_EXPIRED':
      return `The secure confirmation link expired without being used`;
    case 'ACK_TOKEN_REVOKED':
      return `${who} revoked the secure confirmation link${withReason}`;
    case 'FORM_SENT_FOR_HR_REVIEW':
      return `${who} finished preparing the action form (ready for review)`;
    case 'FORM_HR_REVIEWED':
      return `${who} reviewed the action form (management oversight)`;
    case 'FORM_COMPLETED':
      return `${who} completed the action form (attested)`;
    // Centralized routing (email routing directive).
    case 'NOTIFICATION_ROUTING_CHANGED':
      return `${who} changed where "${words(str(m, 'notificationType')) ?? 'a notification'}" is sent (${str(m, 'previousTo') ?? '-'} to ${str(m, 'newTo') ?? '-'})`;
    // Rehearsal mode (directive section 8).
    case 'NOTIFICATION_TEST_MODE_CHANGED':
      return m.enabled === true
        ? `${who} turned rehearsal mode ON - outgoing messages are diverted to one mailbox and marked as tests`
        : `${who} turned rehearsal mode off - messages go to their real recipients again`;
    case 'NOTIFICATION_REDIRECTED_TEST_MODE': {
      const intended = Array.isArray(m.intendedRecipients)
        ? (m.intendedRecipients as unknown[]).length
        : 0;
      return `Rehearsal mode intercepted the message before it reached ${plural(String(intended), 'recipient')}`;
    }
    // The exit checklist for return items (DEC-053).
    case 'RETURN_CHECKLIST_SENT':
      return `The exit checklist was sent to ${str(m, 'recipientName') ?? 'the recipient'} with a secure link`;
    case 'RETURN_CHECKLIST_SAVED':
      return `An incomplete exit checklist was saved — the entries were kept so nothing was lost`;
    case 'RETURN_CHECKLIST_SUBMITTED':
    case 'RETURN_CHECKLIST_CORRECTED': {
      const corrected = e.eventType === 'RETURN_CHECKLIST_CORRECTED';
      const outstanding = Number(str(m, 'unresolvedCount') ?? '0');
      const items = str(m, 'unresolvedItems');
      const tail = outstanding
        ? ` — still outstanding: ${items || plural(String(outstanding), 'item')}`
        : ' — everything accounted for';
      const opener = corrected
        ? `${who} corrected the exit checklist`
        : str(m, 'submittedVia') === 'TOKEN'
          ? 'The exit checklist was completed through the secure link'
          : `${who} recorded the exit checklist`;
      return `${opener}${tail}`;
    }
    // The resignation acceptance letter (DEC-054).
    case 'CASE_EMPLOYEE_ADDRESS_RECORDED':
      return str(m, 'nowRecorded') === 'true' || m.nowRecorded === true
        ? `${who} recorded the address the letter is written to`
        : `${who} cleared the address the letter is written to`;
    case 'DOC_ISSUED_BY_EMAIL': {
      const copies = Array.isArray(m.copiedTo) ? (m.copiedTo as unknown[]).length : 0;
      const copied = copies ? `, copying ${plural(String(copies), 'colleague')}` : '';
      return `${who} issued the letter to the employee by email (${str(m, 'destinationMask') ?? 'recorded address'})${copied}`;
    }
    case 'CLEARANCE_APPROVED':
      return `${who} approved final clearance`;
    case 'ACCESS_REVOCATION_COMPLETED':
      return `${who} recorded completed access revocation`;
    case 'EXCEPTION_OPENED':
      return `An exception was opened: ${words(str(m, 'exceptionType')) ?? 'unspecified'} (${(words(str(m, 'severity')) ?? '-').toLowerCase()})`;
    case 'EXCEPTION_RESOLVED':
      return `The exception was resolved: ${words(str(m, 'exceptionType')) ?? 'unspecified'}`;
    case 'DIRECTORY_SYNC_REQUESTED':
      return `${who} requested a ${words(str(m, 'kind')) ?? 'directory'} synchronization of the employee directory.`;
    case 'DIRECTORY_SYNC_COMPLETED':
      return `${who} synchronized the employee directory (${words(str(m, 'kind')) ?? 'sync'}): ${String(m['checked'] ?? 0)} checked, ${String(m['added'] ?? 0)} added, ${String(m['updated'] ?? 0)} updated, ${String(m['archived'] ?? 0)} archived, ${String(m['failed'] ?? 0)} failed.`;
    case 'DIRECTORY_SYNC_FAILED':
      return `${who} could not synchronize the employee directory (${words(str(m, 'kind')) ?? 'sync'}): ${str(m, 'errorCode') ?? 'error'}. Cached data stays in use.`;
    case 'DIRECTORY_WEBHOOK_RECEIVED':
      return `BambooHR reported ${String(m['employees'] ?? 0)} employee change(s); the affected records were refreshed from BambooHR.`;
    case 'DIRECTORY_WEBHOOK_REJECTED':
      return `A request claiming to be a BambooHR webhook was refused (${str(m, 'reason') ?? 'invalid'}).`;
    case 'SYNC_RUN_COMPLETED':
      return `${who} completed a directory synchronization (${str(m, 'created') ?? '0'} created, ${str(m, 'updated') ?? '0'} updated)`;
    case 'AUDIT_EXPORTED':
      return `${who} exported audit evidence (${str(m, 'rowCount') ?? '?'} rows)`;
    case 'AUDIT_SEARCHED':
      return `${who} searched the audit trail`;
    case 'ACCESS_DENIED':
      return `${who} was denied access`;
    default: {
      const words = String(e.eventType).replaceAll('_', ' ').toLowerCase();
      return e.actorType === 'SYSTEM' ? `System: ${words}` : `${who}: ${words}`;
    }
  }
}

export function humanizeAuditEvent(e: HumanizableEvent): string {
  const base = sentence(e);
  if (e.result === 'DENIED') return `${base} (DENIED)`;
  if (e.result === 'FAILURE') return `${base} (FAILED)`;
  return base;
}

/**
 * Extract before/after pairs from sanitized metadata for the detail drawer
 * (Directive 6.1 P). Recognizes the previous-/new-, original-/replacement-
 * and old-/new- key naming conventions used by the assignment audit events.
 */
export function beforeAfterPairs(
  metadata: Record<string, unknown> | null | undefined,
): ReadonlyArray<{ label: string; before: string; after: string }> {
  const m = metadata ?? {};
  const pairs: Array<{ label: string; before: string; after: string }> = [];
  const conventions: ReadonlyArray<readonly [string, string, string]> = [
    ['previousAssigneeName', 'newAssigneeName', 'Assignee'],
    ['previousAssigneeId', 'newAssigneeId', 'Assignee id'],
    ['previousOfficerName', 'newOfficerName', 'HR officer'],
    ['originalManagerName', 'replacementManagerName', 'Manager'],
    ['previousManagerName', 'directoryManagerName', 'Manager (directory)'],
    ['oldSeverity', 'newSeverity', 'Severity'],
    ['fromStatus', 'toStatus', 'Status'],
  ];
  for (const [beforeKey, afterKey, label] of conventions) {
    if (beforeKey in m || afterKey in m) {
      pairs.push({
        label,
        before: redactAuditValue(beforeKey, m[beforeKey]),
        after: redactAuditValue(afterKey, m[afterKey]),
      });
    }
  }
  return pairs;
}
