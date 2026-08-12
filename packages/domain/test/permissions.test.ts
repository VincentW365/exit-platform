import { describe, expect, it } from 'vitest';
import {
  can,
  canActOnCase,
  canDiscoverCase,
  canViewCase,
  roleChangeErrors,
  type CaseAccessContext,
} from '../src/permissions.ts';
import { ROLES, type Actor, type Role } from '../src/roles.ts';

function actor(userId: string, ...roles: Role[]): Actor {
  return { userId, roles };
}

const normalCase: CaseAccessContext = {
  ownerId: 'hr-officer-1',
  classification: 'CONFIDENTIAL',
  participantUserIds: ['hr-officer-1'],
};

const restrictedCase: CaseAccessContext = {
  ownerId: 'hr-manager-1',
  classification: 'RESTRICTED',
  participantUserIds: ['hr-manager-1', 'hr-officer-2'],
};

describe('record-level visibility (REQ-SEC-007/008, DEC-042 six-role model)', () => {
  it('normal cases: HR roles can view; departments and admin cannot', () => {
    expect(canViewCase(actor('x', 'HR_MANAGER'), normalCase)).toBe(true);
    expect(canViewCase(actor('x', 'HR_OFFICER'), normalCase)).toBe(true);
    expect(canViewCase(actor('x', 'IT_RESPONDER'), normalCase)).toBe(false);
    expect(canViewCase(actor('x', 'FINANCE_RESPONDER'), normalCase)).toBe(false);
    expect(canViewCase(actor('x', 'LINE_MANAGER'), normalCase)).toBe(false);
    expect(canViewCase(actor('x', 'SYSTEM_ADMIN'), normalCase)).toBe(false);
  });

  it('RESTRICTED termination cases: content requires explicit HR participation (DEC-035)', () => {
    // Participants with HR roles: yes.
    expect(canViewCase(actor('hr-manager-1', 'HR_MANAGER'), restrictedCase)).toBe(true);
    expect(canViewCase(actor('hr-officer-2', 'HR_OFFICER'), restrictedCase)).toBe(true);
    // An HR MANAGER who is NOT a participant is denied - role alone is not enough.
    expect(canViewCase(actor('hr-manager-9', 'HR_MANAGER'), restrictedCase)).toBe(false);
    expect(canViewCase(actor('hr-officer-9', 'HR_OFFICER'), restrictedCase)).toBe(false);
    // SYSTEM_ADMIN never gains business access by role (REQ-SEC-010).
    expect(canViewCase(actor('admin-1', 'SYSTEM_ADMIN'), restrictedCase)).toBe(false);
    // A participant row without an HR role still gets nothing.
    const withItParticipant: CaseAccessContext = {
      ...restrictedCase,
      participantUserIds: [...restrictedCase.participantUserIds, 'it-1'],
    };
    expect(canViewCase(actor('it-1', 'IT_RESPONDER'), withItParticipant)).toBe(false);
  });

  it('discovery of RESTRICTED cases is participant-only (DEC-042)', () => {
    expect(canDiscoverCase(actor('hr-manager-1', 'HR_MANAGER'), restrictedCase)).toBe(true);
    // Non-participants must not learn the case exists through lists/counts -
    // there is no longer any role-based discovery path.
    expect(canDiscoverCase(actor('hr-manager-9', 'HR_MANAGER'), restrictedCase)).toBe(false);
    expect(canDiscoverCase(actor('hr-officer-9', 'HR_OFFICER'), restrictedCase)).toBe(false);
    expect(canDiscoverCase(actor('admin-1', 'SYSTEM_ADMIN'), restrictedCase)).toBe(false);
    expect(canDiscoverCase(actor('it-1', 'IT_RESPONDER'), restrictedCase)).toBe(false);
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
    ] as const) {
      expect(canActOnCase(actor('m', 'HR_MANAGER'), action, normalCase), action).toBe(true);
      expect(canActOnCase(actor('o', 'HR_OFFICER'), action, normalCase), action).toBe(false);
      expect(canActOnCase(actor('a', 'SYSTEM_ADMIN'), action, normalCase), action).toBe(false);
    }
  });

  it('working actions are available to HR roles only', () => {
    for (const action of [
      'case.editDraft',
      'case.submit',
      'case.addNote',
      'case.recordBaselineEvent',
      'attachment.upload',
    ] as const) {
      expect(canActOnCase(actor('o', 'HR_OFFICER'), action, normalCase), action).toBe(true);
      expect(canActOnCase(actor('a', 'SYSTEM_ADMIN'), action, normalCase), action).toBe(false);
      expect(canActOnCase(actor('l', 'LINE_MANAGER'), action, normalCase), action).toBe(false);
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
    expect(canActOnCase(actor('a', 'SYSTEM_ADMIN'), 'case.viewRehire', normalCase)).toBe(false);
  });

  it('reason notes are restricted to HR participants (REQ-PRIV-024)', () => {
    expect(canActOnCase(actor('o', 'HR_OFFICER'), 'case.viewReasonNotes', normalCase)).toBe(true);
    expect(canActOnCase(actor('a', 'SYSTEM_ADMIN'), 'case.viewReasonNotes', normalCase)).toBe(
      false,
    );
  });
});

describe('global actions', () => {
  it('case creation is HR-led only (DEC-002 / REQ-CASE-002)', () => {
    const allowed: Role[] = ['HR_MANAGER', 'HR_OFFICER'];
    for (const role of ROLES) {
      expect(can(actor('u', role), 'case.create'), role).toBe(allowed.includes(role));
    }
  });

  it('audit centre audiences (DEC-042); admin console is SYSTEM_ADMIN-only', () => {
    for (const role of ROLES) {
      // HR_MANAGER is the business audit audience; the service minimizes
      // restricted-case rows they cannot view (DEC-039).
      expect(can(actor('u', role), 'audit.viewGlobal'), role).toBe(role === 'HR_MANAGER');
      expect(can(actor('u', role), 'audit.viewTechnical'), role).toBe(role === 'SYSTEM_ADMIN');
      expect(can(actor('u', role), 'audit.export'), role).toBe(role === 'HR_MANAGER');
      expect(can(actor('u', role), 'admin.roles'), role).toBe(role === 'SYSTEM_ADMIN');
      expect(can(actor('u', role), 'admin.flags'), role).toBe(role === 'SYSTEM_ADMIN');
    }
  });

  it('business calendar and org lists are HR Manager configuration (DEC-027)', () => {
    for (const role of ROLES) {
      expect(can(actor('u', role), 'admin.calendar'), role).toBe(role === 'HR_MANAGER');
      expect(can(actor('u', role), 'admin.configLists'), role).toBe(role === 'HR_MANAGER');
    }
  });

  it('privacy/retention operations belong to HR_MANAGER (DEC-042)', () => {
    for (const role of ROLES) {
      expect(can(actor('u', role), 'privacy.view'), role).toBe(role === 'HR_MANAGER');
      expect(can(actor('u', role), 'privacy.operate'), role).toBe(role === 'HR_MANAGER');
    }
    // SYSTEM_ADMIN keeps technical administration but never case content.
    expect(can(actor('u', 'SYSTEM_ADMIN'), 'identity.accessReview')).toBe(true);
    expect(can(actor('u', 'HR_MANAGER'), 'identity.accessReview')).toBe(false);
  });
});

describe('role administration (REQ-ADMIN-002)', () => {
  it('forbids self-grant even for SYSTEM_ADMIN', () => {
    expect(roleChangeErrors(actor('admin-1', 'SYSTEM_ADMIN'), 'someone-else')).toEqual([]);
    expect(roleChangeErrors(actor('admin-1', 'SYSTEM_ADMIN'), 'admin-1')).toContainEqual(
      expect.stringContaining('own role'),
    );
  });

  it('forbids role administration for non-admins', () => {
    expect(roleChangeErrors(actor('m', 'HR_MANAGER'), 'someone')).toContainEqual(
      expect.stringContaining('Not authorized'),
    );
  });
});
