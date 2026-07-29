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
 *  - RESTRICTED (termination) cases: content requires explicit HR
 *    participation; AUDITOR / PRIVACY_OFFICER may discover their existence as
 *    expressly authorized oversight roles but see minimized rows only;
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
    if (isHrParticipant(actor, c)) return true;
    // Oversight roles get content only when explicitly added as participants.
    if (isParticipant(actor, c) && hasRole(actor, 'AUDITOR', 'PRIVACY_OFFICER')) return true;
    return false;
  }
  // CONFIDENTIAL (normal) cases.
  if (hasRole(actor, 'HR_MANAGER', 'HR_OFFICER')) return true;
  if (hasRole(actor, 'AUDITOR', 'PRIVACY_OFFICER')) return true; // read-only oversight
  return false;
}

/**
 * Discovery: may the actor learn the case exists (list row, counts)?
 * For RESTRICTED cases, discovery rows must be minimized (no employee name)
 * unless the actor also passes canViewCase.
 */
export function canDiscoverCase(actor: Actor, c: CaseAccessContext): boolean {
  if (canViewCase(actor, c)) return true;
  if (c.classification === 'RESTRICTED') {
    return hasRole(actor, 'AUDITOR', 'PRIVACY_OFFICER'); // expressly authorized oversight
  }
  return false;
}

/**
 * Stage 2 limited access levels: FINANCE_RESPONDER and LINE_MANAGER gain
 * access ONLY to their action-form surfaces when explicitly assigned as
 * participants - never to the full case (Directive 2 section F role rules).
 */
export type CaseAccessLevel = 'FULL' | 'FINANCE_FORM' | 'MANAGER_FORM' | 'DISCOVER' | 'NONE';

export function caseAccessLevel(actor: Actor, c: CaseAccessContext): CaseAccessLevel {
  if (canViewCase(actor, c)) return 'FULL';
  if (isParticipant(actor, c) && hasRole(actor, 'FINANCE_RESPONDER')) return 'FINANCE_FORM';
  if (isParticipant(actor, c) && hasRole(actor, 'LINE_MANAGER')) return 'MANAGER_FORM';
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
  | 'form.financeEdit'
  | 'form.managerApprove'
  | 'form.hrApprove'
  | 'form.return'
  | 'form.void'
  | 'form.view'
  | 'survey.manage'
  | 'survey.viewResponses'
  | 'survey.recordVerbal';

export function canActOnCase(actor: Actor, action: CaseAction, c: CaseAccessContext): boolean {
  // Limited participant surfaces (no full case view required).
  const level = caseAccessLevel(actor, c);
  if (action === 'form.financeEdit') return level === 'FINANCE_FORM' || false;
  if (action === 'form.managerApprove') return level === 'MANAGER_FORM' || false;
  if (action === 'form.view')
    return level === 'FULL' || level === 'FINANCE_FORM' || level === 'MANAGER_FORM';

  const view = canViewCase(actor, c);
  if (!view) return false;
  const hrManager = hasRole(actor, 'HR_MANAGER');
  const hr = hasRole(actor, 'HR_MANAGER', 'HR_OFFICER');
  const hrOnCase = c.classification === 'RESTRICTED' ? isHrParticipant(actor, c) : hr;

  switch (action) {
    case 'doc.create':
    case 'doc.edit':
    case 'doc.submit':
    case 'form.edit':
    case 'form.submit':
    case 'survey.manage':
    case 'survey.recordVerbal':
      return hrOnCase;
    case 'doc.approve':
    case 'doc.return':
    case 'doc.void':
    case 'doc.markIssued':
    case 'doc.supersede':
    case 'form.hrApprove':
    case 'form.return':
    case 'form.void':
      return hrManager && (c.classification !== 'RESTRICTED' || isHrParticipant(actor, c));
    case 'doc.download':
      return hrOnCase || (view && hasRole(actor, 'AUDITOR', 'PRIVACY_OFFICER'));
    case 'survey.viewResponses':
      // Identifiable responses: HR on the case + privacy oversight (read-only).
      // AUDITOR gets metadata only - enforced by the service masking layer.
      return hrOnCase || (view && hasRole(actor, 'PRIVACY_OFFICER'));
    case 'case.editDraft':
    case 'case.submit':
    case 'case.addNote':
    case 'case.recordBaselineEvent':
    case 'attachment.upload':
      return hrOnCase;
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
      // Restricted HR data (REQ-PRIV-024): HR participants only; masked for oversight.
      return hrOnCase;
    case 'attachment.download':
      return hrOnCase || (view && hasRole(actor, 'AUDITOR', 'PRIVACY_OFFICER'));
    case 'audit.viewCase':
      return view;
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
  | 'template.activate';

const GLOBAL_MATRIX: Readonly<Record<GlobalAction, readonly Role[]>> = {
  'case.create': ['HR_MANAGER', 'HR_OFFICER'],
  'case.list': ['HR_MANAGER', 'HR_OFFICER', 'AUDITOR', 'PRIVACY_OFFICER'],
  'baseline.viewDashboard': ['HR_MANAGER', 'HR_OFFICER'],
  'baseline.export': ['HR_MANAGER', 'HR_OFFICER'],
  'audit.viewGlobal': ['AUDITOR', 'PRIVACY_OFFICER'],
  'admin.roles': ['SYSTEM_ADMIN'],
  'admin.flags': ['SYSTEM_ADMIN'],
  'admin.calendar': ['HR_MANAGER'],
  'admin.configLists': ['HR_MANAGER'],
  'employeeSource.search': ['HR_MANAGER', 'HR_OFFICER'],
  // Directive 2 B.1/B.2: officers draft, managers activate/supersede/retire.
  'template.view': ['HR_MANAGER', 'HR_OFFICER', 'AUDITOR', 'PRIVACY_OFFICER'],
  'template.draft': ['HR_MANAGER', 'HR_OFFICER'],
  'template.activate': ['HR_MANAGER'],
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
