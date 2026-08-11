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

describe('record-level visibility (REQ-SEC-007/008)', () => {
  it('normal cases: HR and oversight roles can view; departments and admin cannot', () => {
    expect(canViewCase(actor('x', 'HR_MANAGER'), normalCase)).toBe(true);
    expect(canViewCase(actor('x', 'HR_OFFICER'), normalCase)).toBe(true);
    expect(canViewCase(actor('x', 'AUDITOR'), normalCase)).toBe(true);
    expect(canViewCase(actor('x', 'PRIVACY_OFFICER'), normalCase)).toBe(true);
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
    // Oversight roles see content only when explicitly added as participants.
    expect(canViewCase(actor('auditor-1', 'AUDITOR'), restrictedCase)).toBe(false);
    // SYSTEM_ADMIN never gains business access by role (REQ-SEC-010).
    expect(canViewCase(actor('admin-1', 'SYSTEM_ADMIN'), restrictedCase)).toBe(false);
    // A participant row without an HR/oversight role still gets nothing.
    const withItParticipant: CaseAccessContext = {
      ...restrictedCase,
      participantUserIds: [...restrictedCase.participantUserIds, 'it-1'],
    };
    expect(canViewCase(actor('it-1', 'IT_RESPONDER'), withItParticipant)).toBe(false);
  });

  it('discovery of RESTRICTED cases is limited to participants and oversight roles', () => {
    expect(canDiscoverCase(actor('hr-manager-1', 'HR_MANAGER'), restrictedCase)).toBe(true);
    expect(canDiscoverCase(actor('auditor-1', 'AUDITOR'), restrictedCase)).toBe(true);
    expect(canDiscoverCase(actor('privacy-1', 'PRIVACY_OFFICER'), restrictedCase)).toBe(true);
    // Non-participant HR must not learn the case exists through lists/counts.
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
      expect(canActOnCase(actor('a', 'AUDITOR'), action, normalCase), action).toBe(false);
    }
  });

  it('working actions are available to HR roles but never to oversight', () => {
    for (const action of [
      'case.editDraft',
      'case.submit',
      'case.addNote',
      'case.recordBaselineEvent',
      'attachment.upload',
    ] as const) {
      expect(canActOnCase(actor('o', 'HR_OFFICER'), action, normalCase), action).toBe(true);
      expect(canActOnCase(actor('a', 'AUDITOR'), action, normalCase), action).toBe(false);
      expect(canActOnCase(actor('p', 'PRIVACY_OFFICER'), action, normalCase), action).toBe(false);
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
    expect(canActOnCase(actor('a', 'AUDITOR'), 'case.viewRehire', normalCase)).toBe(false);
    expect(canActOnCase(actor('p', 'PRIVACY_OFFICER'), 'case.viewRehire', normalCase)).toBe(false);
  });

  it('reason notes are restricted to HR participants (REQ-PRIV-024)', () => {
    expect(canActOnCase(actor('o', 'HR_OFFICER'), 'case.viewReasonNotes', normalCase)).toBe(true);
    expect(canActOnCase(actor('a', 'AUDITOR'), 'case.viewReasonNotes', normalCase)).toBe(false);
  });
});

describe('global actions', () => {
  it('case creation is HR-led only (DEC-002 / REQ-CASE-002)', () => {
    const allowed: Role[] = ['HR_MANAGER', 'HR_OFFICER'];
    for (const role of ROLES) {
      expect(can(actor('u', role), 'case.create'), role).toBe(allowed.includes(role));
    }
  });

  it('audit centre audiences (Directive 6.1 K); admin console is SYSTEM_ADMIN-only', () => {
    for (const role of ROLES) {
      // HR_MANAGER joined the global audit audience in Directive 6.1; the
      // service minimizes restricted-case rows they cannot view.
      expect(can(actor('u', role), 'audit.viewGlobal'), role).toBe(
        role === 'AUDITOR' || role === 'PRIVACY_OFFICER' || role === 'HR_MANAGER',
      );
      expect(can(actor('u', role), 'audit.viewTechnical'), role).toBe(role === 'SYSTEM_ADMIN');
      expect(can(actor('u', role), 'audit.export'), role).toBe(
        role === 'AUDITOR' || role === 'PRIVACY_OFFICER' || role === 'HR_MANAGER',
      );
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

  it('PRIVACY_OFFICER has oversight but no ordinary HR processing (Directive 0.1 B)', () => {
    const p = actor('p', 'PRIVACY_OFFICER');
    expect(can(p, 'audit.viewGlobal')).toBe(true);
    expect(can(p, 'case.list')).toBe(true);
    expect(can(p, 'case.create')).toBe(false);
    expect(canActOnCase(p, 'case.approve', normalCase)).toBe(false);
    expect(canActOnCase(p, 'case.editDraft', normalCase)).toBe(false);
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
