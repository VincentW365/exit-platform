/**
 * Authorization under the two-role model (DEC-063, 2026-09-22).
 *
 * Only HR_MANAGER and HR_OFFICER can sign in or satisfy a permission. Every
 * other kind of person the platform knows - employees, reporting managers,
 * IT, Finance, providers - is a directory record, a workflow participant, a
 * recipient or a token-link holder, never a login. The retired roles remain
 * in the database enum for history only; these tests prove the domain never
 * honours them: an actor whose stored assignments are all deprecated has no
 * active role at all and is refused everywhere.
 */
import { describe, expect, it } from 'vitest';
import {
  can,
  canActOnCase,
  canDiscoverCase,
  canEditCase,
  canViewCase,
  roleChangeErrors,
  type CaseAccessContext,
  type GlobalAction,
} from '../src/permissions.ts';
import { HR_ROLES, ROLES, isRole, type Actor, type Role } from '../src/roles.ts';

function actor(userId: string, ...roles: Role[]): Actor {
  return { userId, roles };
}
/** A signed-in user whose only stored assignments are deprecated values. */
const noActiveRole: Actor = { userId: 'legacy-1', roles: [] };

const normalCase: CaseAccessContext = {
  ownerId: 'hr-officer-1',
  classification: 'CONFIDENTIAL',
  participantUserIds: ['hr-officer-1'],
  assignedOfficerId: 'hr-officer-1',
};
const restrictedCase: CaseAccessContext = {
  ownerId: 'hr-manager-1',
  classification: 'RESTRICTED',
  participantUserIds: ['hr-manager-1', 'hr-officer-2'],
  assignedOfficerId: 'hr-officer-2',
};
/** A case an HR Manager created and has not assigned yet. */
const unassignedCase: CaseAccessContext = {
  ownerId: 'hr-manager-1',
  classification: 'CONFIDENTIAL',
  participantUserIds: ['hr-manager-1'],
  assignedOfficerId: null,
};

describe('active role union (DEC-063)', () => {
  it('has exactly HR_MANAGER and HR_OFFICER', () => {
    expect([...ROLES]).toEqual(['HR_MANAGER', 'HR_OFFICER']);
    expect([...HR_ROLES]).toEqual(['HR_MANAGER', 'HR_OFFICER']);
  });

  it('refuses every deprecated value as a role, so none can be newly assigned', () => {
    for (const deprecated of [
      'SYSTEM_ADMIN',
      'IT_RESPONDER',
      'FINANCE_RESPONDER',
      'LINE_MANAGER',
      'AUDITOR',
      'PRIVACY_OFFICER',
      'EMPLOYEE',
      'MANAGER',
      'ADMIN',
    ]) {
      expect(isRole(deprecated), deprecated).toBe(false);
    }
    expect(isRole('HR_MANAGER')).toBe(true);
    expect(isRole('HR_OFFICER')).toBe(true);
  });
});

describe('record-level visibility (REQ-SEC-007/008)', () => {
  it('normal cases: HR roles can view; a user with no active role cannot', () => {
    expect(canViewCase(actor('x', 'HR_MANAGER'), normalCase)).toBe(true);
    expect(canViewCase(actor('x', 'HR_OFFICER'), normalCase)).toBe(true);
    expect(canViewCase(noActiveRole, normalCase)).toBe(false);
  });

  it('RESTRICTED termination cases: content requires explicit HR participation (DEC-035)', () => {
    expect(canViewCase(actor('hr-manager-1', 'HR_MANAGER'), restrictedCase)).toBe(true);
    expect(canViewCase(actor('hr-officer-2', 'HR_OFFICER'), restrictedCase)).toBe(true);
    expect(canViewCase(actor('hr-manager-9', 'HR_MANAGER'), restrictedCase)).toBe(false);
    expect(canViewCase(actor('hr-officer-9', 'HR_OFFICER'), restrictedCase)).toBe(false);
    // Being listed as a participant without an HR role grants nothing.
    const withLegacyParticipant: CaseAccessContext = {
      ...restrictedCase,
      participantUserIds: [...restrictedCase.participantUserIds, 'legacy-1'],
    };
    expect(canViewCase(noActiveRole, withLegacyParticipant)).toBe(false);
  });

  it('discovery of RESTRICTED cases is participant-only (DEC-042)', () => {
    expect(canDiscoverCase(actor('hr-manager-1', 'HR_MANAGER'), restrictedCase)).toBe(true);
    expect(canDiscoverCase(actor('hr-manager-9', 'HR_MANAGER'), restrictedCase)).toBe(false);
    expect(canDiscoverCase(actor('hr-officer-9', 'HR_OFFICER'), restrictedCase)).toBe(false);
    expect(canDiscoverCase(noActiveRole, restrictedCase)).toBe(false);
  });
});

describe('case action authorization', () => {
  it('approval-level actions require HR_MANAGER', () => {
    for (const action of [
      'case.return',
      'case.approve',
      'case.cancel',
      'case.void',
      'case.correct',
      'case.changeEffectiveTime',
      'case.manageParticipants',
      'case.assignOfficer',
    ] as const) {
      expect(canActOnCase(actor('m', 'HR_MANAGER'), action, normalCase), action).toBe(true);
      expect(canActOnCase(actor('o', 'HR_OFFICER'), action, normalCase), action).toBe(false);
      expect(canActOnCase(noActiveRole, action, normalCase), action).toBe(false);
    }
  });

  it('working actions belong to the HR Manager and the ASSIGNED officer only (DEC-065)', () => {
    for (const action of [
      'case.editDraft',
      'case.submit',
      'case.addNote',
      'case.recordBaselineEvent',
      'attachment.upload',
      'doc.create',
      'form.complete',
      'asset.manage',
      'case.activate',
    ] as const) {
      expect(canActOnCase(actor('m', 'HR_MANAGER'), action, normalCase), action).toBe(true);
      expect(canActOnCase(actor('hr-officer-1', 'HR_OFFICER'), action, normalCase), action).toBe(
        true,
      );
      // Another officer can read the case (below) but not work it.
      expect(canActOnCase(actor('hr-officer-9', 'HR_OFFICER'), action, normalCase), action).toBe(
        false,
      );
      expect(
        canActOnCase(actor('hr-officer-9', 'HR_OFFICER'), action, unassignedCase),
        action,
      ).toBe(false);
      expect(canActOnCase(noActiveRole, action, normalCase), action).toBe(false);
    }
  });

  it('read surfaces stay open to every HR viewer regardless of ownership', () => {
    for (const action of [
      'workflow.view',
      'notification.view',
      'asset.view',
      'audit.viewCase',
      'attachment.download',
      'case.viewReasonNotes',
      'form.view',
    ] as const) {
      expect(canActOnCase(actor('hr-officer-9', 'HR_OFFICER'), action, normalCase), action).toBe(
        true,
      );
    }
  });

  it('on RESTRICTED cases even HR_MANAGER actions require participation', () => {
    expect(canActOnCase(actor('hr-manager-1', 'HR_MANAGER'), 'case.approve', restrictedCase)).toBe(
      true,
    );
    expect(canActOnCase(actor('hr-manager-9', 'HR_MANAGER'), 'case.approve', restrictedCase)).toBe(
      false,
    );
  });

  it('rehire eligibility is HR Manager only (DEC-032 / REQ-CASE-026)', () => {
    expect(canActOnCase(actor('m', 'HR_MANAGER'), 'case.viewRehire', normalCase)).toBe(true);
    expect(canActOnCase(actor('hr-officer-1', 'HR_OFFICER'), 'case.viewRehire', normalCase)).toBe(
      false,
    );
  });

  it('reason notes are restricted to HR participants (REQ-PRIV-024)', () => {
    expect(canActOnCase(actor('o', 'HR_OFFICER'), 'case.viewReasonNotes', normalCase)).toBe(true);
    expect(canActOnCase(noActiveRole, 'case.viewReasonNotes', normalCase)).toBe(false);
  });
});

describe('case ownership and edit authority (DEC-065)', () => {
  it('the HR Manager edits every case they can view, whoever created or owns it', () => {
    expect(canEditCase(actor('hr-manager-1', 'HR_MANAGER'), normalCase)).toBe(true);
    expect(canEditCase(actor('hr-manager-9', 'HR_MANAGER'), normalCase)).toBe(true);
    expect(canEditCase(actor('hr-manager-9', 'HR_MANAGER'), unassignedCase)).toBe(true);
    // Restricted cases still demand participation - ownership never bypasses DEC-035.
    expect(canEditCase(actor('hr-manager-1', 'HR_MANAGER'), restrictedCase)).toBe(true);
    expect(canEditCase(actor('hr-manager-9', 'HR_MANAGER'), restrictedCase)).toBe(false);
  });

  it('an HR Officer edits only the case assigned to them', () => {
    expect(canEditCase(actor('hr-officer-1', 'HR_OFFICER'), normalCase)).toBe(true);
    expect(canEditCase(actor('hr-officer-9', 'HR_OFFICER'), normalCase)).toBe(false);
    expect(canEditCase(actor('hr-officer-9', 'HR_OFFICER'), unassignedCase)).toBe(false);
    expect(canEditCase(actor('hr-officer-2', 'HR_OFFICER'), restrictedCase)).toBe(true);
    expect(canEditCase(noActiveRole, normalCase)).toBe(false);
  });

  it('ownership follows the assigned officer, never the creator', () => {
    // hr-officer-1 created the case (ownerId) but it was reassigned to hr-officer-2.
    const reassigned: CaseAccessContext = { ...normalCase, assignedOfficerId: 'hr-officer-2' };
    expect(canEditCase(actor('hr-officer-1', 'HR_OFFICER'), reassigned)).toBe(false);
    expect(canEditCase(actor('hr-officer-2', 'HR_OFFICER'), reassigned)).toBe(true);
    expect(canViewCase(actor('hr-officer-1', 'HR_OFFICER'), reassigned)).toBe(true);
  });

  it('assignment itself stays an HR Manager authority', () => {
    expect(
      canActOnCase(actor('hr-officer-1', 'HR_OFFICER'), 'case.assignOfficer', normalCase),
    ).toBe(false);
    expect(canActOnCase(actor('m', 'HR_MANAGER'), 'case.assignOfficer', normalCase)).toBe(true);
  });
});

describe('global actions - the two-role matrix (DEC-063)', () => {
  const both = (a: GlobalAction) => {
    expect(can(actor('m', 'HR_MANAGER'), a), a).toBe(true);
    expect(can(actor('o', 'HR_OFFICER'), a), a).toBe(true);
    expect(can(noActiveRole, a), a).toBe(false);
  };
  const managerOnly = (a: GlobalAction) => {
    expect(can(actor('m', 'HR_MANAGER'), a), a).toBe(true);
    expect(can(actor('o', 'HR_OFFICER'), a), a).toBe(false);
    expect(can(noActiveRole, a), a).toBe(false);
  };

  it('operational processing is shared by both HR roles', () => {
    for (const a of [
      'case.create',
      'case.list',
      'employeeSource.search',
      'queue.view',
      'exceptions.viewFeed',
      'template.view',
      'template.draft',
      'workflowDef.view',
      'workflowDef.draft',
      'notifTemplate.view',
      'notifTemplate.draft',
      'reports.view',
      'reports.export',
      'baseline.viewDashboard',
      'baseline.export',
      'recipients.viewBusiness',
      'mailbox.dev',
      'support.use',
      'sop.view',
      'org.view',
    ] as const)
      both(a);
  });

  it('oversight and HR administration belong to the HR Manager alone', () => {
    for (const a of [
      'template.activate',
      'workflowDef.activate',
      'notifTemplate.activate',
      'reports.schedule',
      'audit.viewGlobal',
      'audit.export',
      'admin.calendar',
      'admin.configLists',
      'reasons.manage',
      'privacy.view',
      'privacy.operate',
      'continuity.operate',
      'support.manage',
    ] as const)
      managerOnly(a);
  });

  it('transferred from the former System Administrator: only genuinely HR-operational functions', () => {
    for (const a of [
      'sync.run',
      'directory.viewSync',
      'admin.system',
      'admin.roles',
      'admin.flags',
      'admin.organization',
      'recipients.editBusiness',
      'recipients.editTechnical',
      'recipients.approveExternal',
      'outbox.view',
      'outbox.resolve',
      'notifications.testMode',
      'notifications.routing',
      'health.view',
      'identity.admin',
      'identity.accessReview',
      'pilot.view',
      'pilot.manage',
      'pilot.hrApprove',
    ] as const)
      managerOnly(a);
  });

  it('Refresh Directory Now (sync.run) is an HR Manager capability, not an officer one', () => {
    expect(can(actor('m', 'HR_MANAGER'), 'sync.run')).toBe(true);
    expect(can(actor('o', 'HR_OFFICER'), 'sync.run')).toBe(false);
  });

  it('officers may enter a recipient for one case but not configure global recipients', () => {
    // Per-case recipient entry is case work, so it follows ownership (DEC-065).
    expect(
      canActOnCase(actor('hr-officer-1', 'HR_OFFICER'), 'notification.enterRecipient', normalCase),
    ).toBe(true);
    expect(
      canActOnCase(actor('hr-officer-9', 'HR_OFFICER'), 'notification.enterRecipient', normalCase),
    ).toBe(false);
    expect(can(actor('o', 'HR_OFFICER'), 'recipients.editBusiness')).toBe(false);
  });
});

describe('role administration (REQ-ADMIN-002)', () => {
  it('the HR Manager administers roles but can never grant to themself', () => {
    expect(roleChangeErrors(actor('hr-manager-1', 'HR_MANAGER'), 'someone-else')).toEqual([]);
    expect(roleChangeErrors(actor('hr-manager-1', 'HR_MANAGER'), 'hr-manager-1')).toContainEqual(
      expect.stringContaining('own role'),
    );
  });

  it('forbids role administration for HR Officers and for users with no active role', () => {
    expect(roleChangeErrors(actor('o', 'HR_OFFICER'), 'someone')).toContainEqual(
      expect.stringContaining('Not authorized'),
    );
    expect(roleChangeErrors(noActiveRole, 'someone')).toContainEqual(
      expect.stringContaining('Not authorized'),
    );
  });
});
