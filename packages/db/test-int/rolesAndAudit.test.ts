/**
 * Role administration and audit access (REQ-ADMIN-001/002, REQ-SEC-032).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getSessionUser, grantRole, revokeRole } from '../src/services/userService.ts';
import { listCaseAudit, listGlobalAudit } from '../src/services/auditService.ts';
import { createDraft } from '../src/services/caseService.ts';
import { createUser, resetDb, VALID_DRAFT } from './helpers.ts';

let admin: Awaited<ReturnType<typeof createUser>>;
let officer: Awaited<ReturnType<typeof createUser>>;
let auditor: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  await resetDb();
  admin = await createUser('Marley Admin', 'SYSTEM_ADMIN');
  officer = await createUser('Riley Officer', 'HR_OFFICER');
  auditor = await createUser('Quinn Auditor', 'AUDITOR');
});

describe('role administration', () => {
  it('grants and revokes with reasons, reflected in session hydration', async () => {
    await grantRole(admin.actor, officer.userId, 'LINE_MANAGER', 'Covering a vacancy (synthetic).');
    let session = await getSessionUser(officer.userId);
    expect(session!.roles).toContain('LINE_MANAGER');

    await revokeRole(admin.actor, officer.userId, 'LINE_MANAGER', 'Coverage ended.');
    session = await getSessionUser(officer.userId);
    expect(session!.roles).not.toContain('LINE_MANAGER');
  });

  it('refuses self-grant even for SYSTEM_ADMIN (REQ-ADMIN-002)', async () => {
    await expect(
      grantRole(admin.actor, admin.userId, 'HR_MANAGER', 'attempting self-escalation'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses grants from non-admin roles', async () => {
    await expect(
      grantRole(officer.actor, auditor.userId, 'HR_OFFICER', 'not allowed'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('audit access', () => {
  it('case audit follows case visibility; global feed is oversight-only', async () => {
    const { caseId } = await createDraft(officer.actor, VALID_DRAFT);
    const events = await listCaseAudit(officer.actor, caseId);
    expect(events.map((e) => e.eventType)).toContain('CASE_CREATED');

    await expect(listCaseAudit(admin.actor, caseId)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const feed = await listGlobalAudit(auditor.actor, {});
    expect(feed.length).toBeGreaterThan(0);
    await expect(listGlobalAudit(officer.actor, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('role-change denials are themselves audited (ACCESS_DENIED)', async () => {
    const feed = await listGlobalAudit(auditor.actor, { eventType: 'ACCESS_DENIED' });
    expect(feed.length).toBeGreaterThan(0);
  });
});
