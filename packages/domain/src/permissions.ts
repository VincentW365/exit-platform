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
 *  - only HR_MANAGER and HR_OFFICER exist as logins (DEC-063); IT, Finance,
 *    the reporting manager and the former System Administrator hold no
 *    account and therefore no access of any kind.
 */
import type { Actor, Role } from './roles.ts';
import { hasRole } from './roles.ts';

export type CaseClassification = 'CONFIDENTIAL' | 'RESTRICTED';

/** Minimal case facts needed for record-level decisions. */
export interface CaseAccessContext {
  /** The accountable owner recorded at creation (audit fact, never edit authority). */
  readonly ownerId: string;
  readonly classification: CaseClassification;
  /** User IDs with an active participant row (owner is always a participant). */
  readonly participantUserIds: readonly string[];
  /**
   * The assigned HR Officer: the current operational owner (owner directive
   * 2026-09-22, DEC-065). Null while the case is unassigned. This - never the
   * creator - decides whether an HR Officer may edit the case.
   */
  readonly assignedOfficerId: string | null;
}

function isParticipant(actor: Actor, c: CaseAccessContext): boolean {
  return c.ownerId === actor.userId || c.participantUserIds.includes(actor.userId);
}

function isHrParticipant(actor: Actor, c: CaseAccessContext): boolean {
  return isParticipant(actor, c) && hasRole(actor, 'HR_MANAGER', 'HR_OFFICER');
}

/**
 * Case edit authority (DEC-065). The HR Manager edits every case they can
 * view; an HR Officer edits only the case currently assigned to them. Any
 * other viewer is read-only. Workflow-state rules (draft-only edits, closed
 * cases, restricted participation) are layered on top by the callers - this
 * answers ownership alone.
 */
export function canEditCase(actor: Actor, c: CaseAccessContext): boolean {
  if (!canViewCase(actor, c)) return false;
  if (hasRole(actor, 'HR_MANAGER')) return true;
  return hasRole(actor, 'HR_OFFICER') && c.assignedOfficerId === actor.userId;
}

/** Full case content visibility. */
export function canViewCase(actor: Actor, c: CaseAccessContext): boolean {
  if (c.classification === 'RESTRICTED') {
    // Explicit assignment only (DEC-035). Roles alone - the HR_MANAGER
    // included - do not grant content access.
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
 * Access levels. Only HR roles sign in (DEC-063), so case content is either
 * fully visible (FULL), discoverable without content (DISCOVER) or hidden
 * (NONE). The former FINANCE_FORM and MANAGER_FORM levels are gone with the
 * responder and line-manager logins: Finance, IT and the reporting manager
 * act through controlled email and secure links, never through a case view.
 */
export type CaseAccessLevel = 'FULL' | 'DISCOVER' | 'NONE';

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
  // DEC-065: operational EDITS additionally require ownership for an HR
  // Officer - the assigned officer works the case, everyone else reads it.
  // Views keep `hrOnCase`; mutations use `hrEdit`.
  const hrEdit = hrOnCase && canEditCase(actor, c);

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
      return hrEdit;
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
      return hrEdit;
    // Stage 3: HR case-work actions (the assigned officer or the manager,
    // on-case for RESTRICTED).
    case 'case.activate':
    case 'clearance.request':
    case 'notification.prepare':
    case 'notification.approveInternal':
    case 'notification.recordSend':
    case 'asset.manage':
    case 'handover.review':
    case 'exception.resolve':
      return hrEdit;
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
      return hrEdit;
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
  // Stage 4 (Directive 4): administration, pilot, reporting, privacy,
  // continuity, support. DEC-063 removed the technical-only actions
  // (admin.integrations, backup.operate, audit.viewTechnical,
  // pilot.adminApprove): no business role holds them, so they are not
  // application permissions at all.
  | 'admin.system'
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
  | 'directory.viewSync'
  | 'pilot.view'
  | 'pilot.manage'
  | 'pilot.hrApprove'
  | 'reports.view'
  | 'reports.export'
  | 'reports.schedule'
  | 'privacy.view'
  | 'privacy.operate'
  | 'continuity.operate'
  | 'support.use'
  | 'support.manage'
  | 'sop.view'
  | 'health.view'
  // Directive 6.1: audit centre + organization administration.
  | 'audit.export'
  | 'org.view'
  | 'admin.organization';

const GLOBAL_MATRIX: Readonly<Record<GlobalAction, readonly Role[]>> = {
  'case.create': ['HR_MANAGER', 'HR_OFFICER'],
  'case.list': ['HR_MANAGER', 'HR_OFFICER'],
  'baseline.viewDashboard': ['HR_MANAGER', 'HR_OFFICER'],
  'baseline.export': ['HR_MANAGER', 'HR_OFFICER'],
  // Two-role model (DEC-063, 2026-09-22). HR_MANAGER is the highest business
  // authority and owns every HR-operational administration the platform
  // needs; HR_OFFICER processes cases. Every former SYSTEM_ADMIN permission
  // was classified before it moved: genuinely HR-operational ones came to
  // HR_MANAGER, technical-only ones (integrations, backups, the technical
  // audit feed, the second pilot approver) left the application entirely.
  // Directive 6.1 (K): the Audit Centre serves HR_MANAGER; restricted-case
  // rows are minimized in the service for viewers without case access.
  'audit.viewGlobal': ['HR_MANAGER'],
  // Current application-role administration (grant/revoke HR roles, map a
  // directory person to an account). roleChangeErrors still forbids
  // self-grant.
  'admin.roles': ['HR_MANAGER'],
  // Automation flags gate offboarding automation - business settings.
  'admin.flags': ['HR_MANAGER'],
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
  // Directive 3 J / Directive 6.3 I-J: the work queue serves HR. IT, Finance
  // and the reporting manager participate by controlled email, not logins.
  'queue.view': ['HR_MANAGER', 'HR_OFFICER'],
  'exceptions.viewFeed': ['HR_MANAGER', 'HR_OFFICER'],
  // System settings that HR operates: directory synchronization and the
  // business-facing configuration keys. The technical sections that page
  // used to host (backups, restore verification) are gone with DEC-063.
  'admin.system': ['HR_MANAGER'],
  // Recipients: officers may see the directory of destinations and enter a
  // recipient for ONE case (a case action); configuring global recipients is
  // oversight work (owner directive 2026-09-22, section 4).
  'recipients.viewBusiness': ['HR_MANAGER', 'HR_OFFICER'],
  'recipients.editBusiness': ['HR_MANAGER'],
  'recipients.editTechnical': ['HR_MANAGER'],
  'recipients.approveExternal': ['HR_MANAGER'],
  'reasons.manage': ['HR_MANAGER'],
  // Notification/outbox oversight and the resolution of operational
  // dispatch failures are HR Manager responsibilities.
  'outbox.view': ['HR_MANAGER'],
  'notifications.testMode': ['HR_MANAGER'],
  'notifications.routing': ['HR_MANAGER'],
  'outbox.resolve': ['HR_MANAGER'],
  // The development/UAT capture mailbox: both HR roles inspect what would
  // have been sent (nothing leaves the application in those environments).
  'mailbox.dev': ['HR_MANAGER', 'HR_OFFICER'],
  // Access administration: disabling an account and the periodic snapshot of
  // who holds which application role are HR's own administration domain -
  // they list accounts and roles, never infrastructure.
  'identity.admin': ['HR_MANAGER'],
  'identity.accessReview': ['HR_MANAGER'],
  // Employee directory synchronization: Refresh Directory Now, status,
  // history (2026-09-15; HR Manager owns it since DEC-063).
  'sync.run': ['HR_MANAGER'],
  'directory.viewSync': ['HR_MANAGER'],
  // Pilot activation requires one HR Manager approval (DEC-063).
  'pilot.view': ['HR_MANAGER'],
  'pilot.manage': ['HR_MANAGER'],
  'pilot.hrApprove': ['HR_MANAGER'],
  'reports.view': ['HR_MANAGER', 'HR_OFFICER'],
  'reports.export': ['HR_MANAGER', 'HR_OFFICER'],
  'reports.schedule': ['HR_MANAGER'],
  // DEC-042: HR_MANAGER absorbs privacy/retention oversight.
  'privacy.view': ['HR_MANAGER'],
  'privacy.operate': ['HR_MANAGER'],
  'continuity.operate': ['HR_MANAGER'],
  // Support: both HR roles raise tickets and pull diagnostics; triage is
  // oversight. SOPs serve both.
  'support.use': ['HR_MANAGER', 'HR_OFFICER'],
  'support.manage': ['HR_MANAGER'],
  'sop.view': ['HR_MANAGER', 'HR_OFFICER'],
  // Operational health: database, storage, worker heartbeat, directory
  // freshness - what HR needs to know dispatch is working.
  'health.view': ['HR_MANAGER'],
  'audit.export': ['HR_MANAGER'],
  // Directive 6.1 (C/D): organization health for HR.
  'org.view': ['HR_MANAGER', 'HR_OFFICER'],
  'admin.organization': ['HR_MANAGER'],
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
