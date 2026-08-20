/**
 * Server-side authorization policy (REQ-SEC-005/006/007/008/010,
 * RolesAndPermissions.md, DEC-035 / IC-S1-011).
 *
 * This module is the single policy authority. The service layer must consult
 * it for every read and mutation; UI visibility is never sufficient.
 *
 * Key rules encoded here:
 *  - record-level access considers classification, ownership and explicit
 *    participation, not role name alone;
 *  - RESTRICTED (termination) cases: content AND discovery require explicit HR
 *    participation (DEC-042 removed the oversight roles; there is no longer a
 *    role-based minimized-discovery path);
 *  - SYSTEM_ADMIN has no business-record access by default;
 *  - departmental roles (IT / Finance / line manager) have no case access in
 *    Stage 1 - their queues arrive with the Stage 3 workflow engine.
 */
import type { Actor, Role } from './roles.ts';
import { hasRole } from './roles.ts';

export type CaseClassification = 'CONFIDENTIAL' | 'RESTRICTED';

/** Minimal case facts needed for record-level decisions. */
export interface CaseAccessContext {
  readonly ownerId: string;
  readonly classification: CaseClassification;
  /** User IDs with an active participant row (owner is always a participant). */
  readonly participantUserIds: readonly string[];
}

function isParticipant(actor: Actor, c: CaseAccessContext): boolean {
  return c.ownerId === actor.userId || c.participantUserIds.includes(actor.userId);
}

function isHrParticipant(actor: Actor, c: CaseAccessContext): boolean {
  return isParticipant(actor, c) && hasRole(actor, 'HR_MANAGER', 'HR_OFFICER');
}

/** Full case content visibility. */
export function canViewCase(actor: Actor, c: CaseAccessContext): boolean {
  if (c.classification === 'RESTRICTED') {
    // Explicit assignment only (DEC-035). Roles alone - including HR_MANAGER
    // and SYSTEM_ADMIN - do not grant content access.
    return isHrParticipant(actor, c);
  }
  // CONFIDENTIAL (normal) cases.
  return hasRole(actor, 'HR_MANAGER', 'HR_OFFICER');
}

/**
 * Discovery: may the actor learn the case exists (list row, counts)?
 * DEC-042: with the oversight roles removed, discovery is identical to view -
 * RESTRICTED cases are invisible outside explicit HR participation.
 */
export function canDiscoverCase(actor: Actor, c: CaseAccessContext): boolean {
  return canViewCase(actor, c);
}

/**
 * Access levels. Directive 6.3 D/I/J retired the Stage-2 limited form
 * surfaces: the Action Form is HR-controlled and Finance/IT act by email.
 * The line manager keeps a genuine responsibility - the handover - so an
 * explicitly assigned MANAGER participant retains the scoped MANAGER_FORM
 * level (it no longer unlocks any Action Form action; form.* permissions key
 * on full case view). FINANCE_FORM survives in the type for historical read
 * paths only and is never granted.
 */
export type CaseAccessLevel = 'FULL' | 'FINANCE_FORM' | 'MANAGER_FORM' | 'DISCOVER' | 'NONE';

export function caseAccessLevel(actor: Actor, c: CaseAccessContext): CaseAccessLevel {
  if (canViewCase(actor, c)) return 'FULL';
  if (canDiscoverCase(actor, c)) return 'DISCOVER';
  return 'NONE';
}

/** Case-scoped actions. */
export type CaseAction =
  | 'case.editDraft'
  | 'case.submit'
  | 'case.return'
  | 'case.approve'
  | 'case.cancel'
  | 'case.void'
  | 'case.correct'
  | 'case.changeEffectiveTime'
  | 'case.manageParticipants'
  | 'case.viewRehire'
  | 'case.setRehire'
  | 'case.viewReasonNotes'
  | 'case.addNote'
  | 'case.recordBaselineEvent'
  | 'attachment.upload'
  | 'attachment.download'
  | 'audit.viewCase'
  | 'doc.create'
  | 'doc.edit'
  | 'doc.submit'
  | 'doc.approve'
  | 'doc.return'
  | 'doc.void'
  | 'doc.markIssued'
  | 'doc.supersede'
  | 'doc.download'
  | 'form.edit'
  | 'form.submit'
  | 'form.complete'
  | 'form.hrReview'
  | 'form.return'
  | 'form.void'
  | 'form.view'
  // Directive 6.3: derived actions, benefits and email-action evidence.
  | 'benefits.confirm'
  | 'derivedAction.override'
  | 'notification.recordEvidence'
  | 'notification.enterRecipient'
  | 'survey.manage'
  | 'survey.viewResponses'
  | 'survey.recordVerbal'
  // Stage 3 (Directive 3): workflow, tasks, notifications, assets, handover,
  // exceptions and clearance.
  | 'case.activate'
  | 'case.hold'
  | 'case.resume'
  | 'case.reopen'
  | 'workflow.view'
  | 'workflow.supersede'
  | 'task.hrManage'
  | 'task.correct'
  | 'clearance.request'
  | 'clearance.approve'
  | 'notification.view'
  | 'notification.prepare'
  | 'notification.approveInternal'
  | 'notification.approveExternal'
  | 'notification.recordSend'
  | 'asset.view'
  | 'asset.manage'
  | 'asset.waiveWriteOff'
  | 'handover.review'
  | 'handover.waive'
  | 'exception.view'
  | 'exception.resolve'
  | 'exception.approveSecurity'
  // Directive 6.1: organization-aware assignment (E/F/J).
  | 'case.assignOfficer'
  | 'case.manageManager'
  | 'case.confirmAssignment';

export function canActOnCase(actor: Actor, action: CaseAction, c: CaseAccessContext): boolean {
  // Directive 6.3 D: the Action Form is HR-controlled; no limited
  // Finance/Manager surfaces exist for new work.
  if (action === 'form.view') return canViewCase(actor, c);

  const view = canViewCase(actor, c);
  if (!view) return false;
  const hrManager = hasRole(actor, 'HR_MANAGER');
  const hr = hasRole(actor, 'HR_MANAGER', 'HR_OFFICER');
  const hrOnCase = c.classification === 'RESTRICTED' ? isHrParticipant(actor, c) : hr;

  switch (action) {
    case 'doc.create':
    case 'doc.edit':
    case 'doc.submit':
    // Directive 6.3 corrections 1-2: the assigned HR Officer prepares,
    // reviews, RETURNS-for-correction and COMPLETES ordinary action forms -
    // completion is operational HR work, not a management approval.
    case 'form.edit':
    case 'form.submit':
    case 'form.complete':
    case 'form.return':
    case 'benefits.confirm':
    case 'derivedAction.override':
    case 'notification.recordEvidence':
    case 'notification.enterRecipient':
    case 'survey.manage':
    case 'survey.recordVerbal':
      return hrOnCase;
    case 'doc.approve':
    case 'doc.return':
    case 'doc.void':
    case 'doc.markIssued':
    case 'doc.supersede':
    // Optional configuration-gated oversight review + voiding stay
    // management-grade (Directive 6.3 correction 1).
    case 'form.hrReview':
    case 'form.void':
      return hrManager && (c.classification !== 'RESTRICTED' || isHrParticipant(actor, c));
    case 'doc.download':
      return hrOnCase;
    case 'survey.viewResponses':
      // Identifiable responses: HR on the case (DEC-042 - the separate
      // privacy-oversight audience was removed with the role).
      return hrOnCase;
    case 'case.editDraft':
    case 'case.submit':
    case 'case.addNote':
    case 'case.recordBaselineEvent':
    case 'attachment.upload':
      return hrOnCase;
    // Stage 3: HR case-work actions (officer or manager, on-case for RESTRICTED).
    case 'case.activate':
    case 'clearance.request':
    case 'notification.prepare':
    case 'notification.approveInternal':
    case 'notification.recordSend':
    case 'asset.manage':
    case 'handover.review':
    case 'exception.resolve':
      return hrOnCase;
    // Stage 3: read surfaces - full case viewers (incl. read-only oversight).
    case 'workflow.view':
    case 'notification.view':
    case 'asset.view':
    case 'exception.view':
      return view;
    // Stage 3: HR-Manager-only authority (waivers, overrides, clearance).
    case 'case.hold':
    case 'case.resume':
    case 'case.reopen':
    case 'workflow.supersede':
    case 'task.hrManage':
    case 'task.correct':
    case 'clearance.approve':
    case 'notification.approveExternal':
    case 'asset.waiveWriteOff':
    case 'handover.waive':
    case 'exception.approveSecurity':
      return hrManager && (c.classification !== 'RESTRICTED' || isHrParticipant(actor, c));
    case 'case.return':
    case 'case.approve':
    case 'case.cancel':
    case 'case.void':
    case 'case.correct':
    case 'case.changeEffectiveTime':
    case 'case.manageParticipants':
    case 'case.setRehire':
      return hrManager && (c.classification !== 'RESTRICTED' || isHrParticipant(actor, c));
    case 'case.viewRehire':
      // Restricted HR data (DEC-032 / IC-S1-009): HR Manager only; masked for
      // everyone else including HR officers, oversight and departments.
      return hrManager && (c.classification !== 'RESTRICTED' || isHrParticipant(actor, c));
    case 'case.viewReasonNotes':
      // Restricted HR data (REQ-PRIV-024): HR participants only.
      return hrOnCase;
    case 'attachment.download':
      return hrOnCase;
    case 'audit.viewCase':
      return view;
    // Directive 6.1 (E): officer assignment is HR-Manager authority.
    case 'case.assignOfficer':
      return hrManager && (c.classification !== 'RESTRICTED' || isHrParticipant(actor, c));
    // Directive 6.1 (F/J): manager derivation/refresh and plan confirmation
    // are HR case work; the OVERRIDE path is additionally restricted to the
    // HR Manager in the service.
    case 'case.manageManager':
    case 'case.confirmAssignment':
      return hrOnCase;
    default:
      return false;
  }
}

/** Global (non-case-scoped) actions. */
export type GlobalAction =
  | 'case.create'
  | 'case.list'
  | 'baseline.viewDashboard'
  | 'baseline.export'
  | 'audit.viewGlobal'
  | 'admin.roles'
  | 'admin.flags'
  | 'admin.calendar'
  | 'admin.configLists'
  | 'employeeSource.search'
  | 'template.view'
  | 'template.draft'
  | 'template.activate'
  | 'workflowDef.view'
  | 'workflowDef.draft'
  | 'workflowDef.activate'
  // Directive 6.3 Q: notification template management.
  | 'notifTemplate.view'
  | 'notifTemplate.draft'
  | 'notifTemplate.activate'
  | 'queue.view'
  | 'exceptions.viewFeed'
  // Stage 4 (Directive 4): administration, integrations, pilot, reporting,
  // privacy, continuity, support.
  | 'admin.system'
  | 'admin.integrations'
  | 'recipients.viewBusiness'
  | 'recipients.editBusiness'
  | 'recipients.editTechnical'
  | 'recipients.approveExternal'
  | 'reasons.manage'
  | 'outbox.view'
  | 'notifications.testMode'
  | 'notifications.routing'
  | 'outbox.resolve'
  | 'mailbox.dev'
  | 'identity.admin'
  | 'identity.accessReview'
  | 'sync.run'
  | 'pilot.view'
  | 'pilot.manage'
  | 'pilot.hrApprove'
  | 'pilot.adminApprove'
  | 'reports.view'
  | 'reports.export'
  | 'reports.schedule'
  | 'privacy.view'
  | 'privacy.operate'
  | 'backup.operate'
  | 'continuity.operate'
  | 'support.use'
  | 'support.manage'
  | 'sop.view'
  | 'health.view'
  // Directive 6.1: audit centre + organization administration.
  | 'audit.viewTechnical'
  | 'audit.export'
  | 'org.view'
  | 'admin.organization';

const GLOBAL_MATRIX: Readonly<Record<GlobalAction, readonly Role[]>> = {
  'case.create': ['HR_MANAGER', 'HR_OFFICER'],
  'case.list': ['HR_MANAGER', 'HR_OFFICER'],
  'baseline.viewDashboard': ['HR_MANAGER', 'HR_OFFICER'],
  'baseline.export': ['HR_MANAGER', 'HR_OFFICER'],
  // Directive 6.1 (K) / DEC-042: the Audit Centre serves HR_MANAGER;
  // restricted-case rows are minimized in the service for viewers without
  // case access. SYSTEM_ADMIN has the separate technical feed.
  'audit.viewGlobal': ['HR_MANAGER'],
  'admin.roles': ['SYSTEM_ADMIN'],
  'admin.flags': ['SYSTEM_ADMIN'],
  'admin.calendar': ['HR_MANAGER'],
  'admin.configLists': ['HR_MANAGER'],
  'employeeSource.search': ['HR_MANAGER', 'HR_OFFICER'],
  // Directive 2 B.1/B.2: officers draft, managers activate/supersede/retire.
  'template.view': ['HR_MANAGER', 'HR_OFFICER'],
  'template.draft': ['HR_MANAGER', 'HR_OFFICER'],
  'template.activate': ['HR_MANAGER'],
  // Directive 3 B.1/B.2: same split for workflow definitions.
  'workflowDef.view': ['HR_MANAGER', 'HR_OFFICER'],
  'workflowDef.draft': ['HR_MANAGER', 'HR_OFFICER'],
  'workflowDef.activate': ['HR_MANAGER'],
  // Directive 6.3 Q: officers draft notification templates; activation of
  // outgoing-communication content stays management-grade (correction 2).
  'notifTemplate.view': ['HR_MANAGER', 'HR_OFFICER'],
  'notifTemplate.draft': ['HR_MANAGER', 'HR_OFFICER'],
  'notifTemplate.activate': ['HR_MANAGER'],
  // Directive 3 J / Directive 6.3 I-J: department queues serve HR and line
  // managers (handover). IT/Finance participate by controlled email, not
  // logins - their roles keep only historical read support.
  'queue.view': ['HR_MANAGER', 'HR_OFFICER'],
  'exceptions.viewFeed': ['HR_MANAGER', 'HR_OFFICER'],
  // Directive 4: business administration is HR; technical administration is
  // SYSTEM_ADMIN (never HR case content - I.1-I.3).
  'admin.system': ['SYSTEM_ADMIN'],
  'admin.integrations': ['SYSTEM_ADMIN'],
  'recipients.viewBusiness': ['HR_MANAGER', 'HR_OFFICER', 'SYSTEM_ADMIN'],
  'recipients.editBusiness': ['HR_MANAGER', 'HR_OFFICER'],
  'recipients.editTechnical': ['SYSTEM_ADMIN'],
  'recipients.approveExternal': ['HR_MANAGER'],
  'reasons.manage': ['HR_MANAGER'],
  'outbox.view': ['SYSTEM_ADMIN', 'HR_MANAGER'],
  // Rehearsal mode diverts every outgoing message. HR runs the rehearsal and
  // the administrator owns delivery, so both hold the switch - the same shape
  // as pilot management.
  'notifications.testMode': ['HR_MANAGER', 'SYSTEM_ADMIN'],
  // Who receives which notification is a business decision with a technical
  // consequence, so HR and the administrator hold it together.
  'notifications.routing': ['HR_MANAGER', 'SYSTEM_ADMIN'],
  'outbox.resolve': ['SYSTEM_ADMIN'],
  'mailbox.dev': ['SYSTEM_ADMIN', 'HR_MANAGER', 'HR_OFFICER'],
  'identity.admin': ['SYSTEM_ADMIN'],
  'identity.accessReview': ['SYSTEM_ADMIN'],
  'sync.run': ['SYSTEM_ADMIN', 'HR_MANAGER'],
  'pilot.view': ['HR_MANAGER', 'SYSTEM_ADMIN'],
  'pilot.manage': ['HR_MANAGER', 'SYSTEM_ADMIN'],
  'pilot.hrApprove': ['HR_MANAGER'],
  'pilot.adminApprove': ['SYSTEM_ADMIN'],
  'reports.view': ['HR_MANAGER', 'HR_OFFICER'],
  'reports.export': ['HR_MANAGER', 'HR_OFFICER'],
  'reports.schedule': ['HR_MANAGER'],
  // DEC-042: HR_MANAGER absorbs privacy/retention oversight.
  'privacy.view': ['HR_MANAGER'],
  'privacy.operate': ['HR_MANAGER'],
  'backup.operate': ['SYSTEM_ADMIN'],
  'continuity.operate': ['HR_MANAGER', 'SYSTEM_ADMIN'],
  'support.use': ['HR_MANAGER', 'HR_OFFICER', 'IT_RESPONDER', 'FINANCE_RESPONDER', 'SYSTEM_ADMIN'],
  'support.manage': ['SYSTEM_ADMIN'],
  'sop.view': ['HR_MANAGER', 'HR_OFFICER', 'IT_RESPONDER', 'FINANCE_RESPONDER', 'SYSTEM_ADMIN'],
  'health.view': ['SYSTEM_ADMIN', 'HR_MANAGER'],
  // Directive 6.1 (K): SYSTEM_ADMIN sees technical events only (never HR case
  // content - enforced in the service as technical categories AND no caseId).
  'audit.viewTechnical': ['SYSTEM_ADMIN'],
  'audit.export': ['HR_MANAGER'],
  // Directive 6.1 (C/D): organization health for HR; the administration page
  // is shared HR-business / technical like /admin.
  'org.view': ['HR_MANAGER', 'HR_OFFICER'],
  'admin.organization': ['HR_MANAGER', 'SYSTEM_ADMIN'],
};

export function can(actor: Actor, action: GlobalAction): boolean {
  return GLOBAL_MATRIX[action].some((r) => actor.roles.includes(r));
}

/**
 * Role administration guard (REQ-ADMIN-002): nobody grants or revokes their
 * own privileges, and role administration itself requires admin.roles.
 */
export function roleChangeErrors(actor: Actor, targetUserId: string): string[] {
  const errors: string[] = [];
  if (!can(actor, 'admin.roles')) errors.push('Not authorized to administer roles.');
  if (actor.userId === targetUserId)
    errors.push('Users cannot change their own role assignments (no self-escalation).');
  return errors;
}
