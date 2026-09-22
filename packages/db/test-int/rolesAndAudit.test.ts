/**
 * Role administration and audit access (REQ-ADMIN-001/002, REQ-SEC-032)
 * under the two-role model (DEC-063): the HR Manager administers roles,
 * only HR_MANAGER and HR_OFFICER can ever be granted, and stored retired
 * assignments are ignored when a session is hydrated.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { getSessionUser, grantRole, revokeRole } from '../src/services/userService.ts';
import { listCaseAudit, listGlobalAudit } from '../src/services/auditService.ts';
import { createDraft } from '../src/services/caseService.ts';
import { createUser, resetDb, VALID_DRAFT } from './helpers.ts';

let admin: Awaited<ReturnType<typeof createUser>>;
let officer: Awaited<ReturnType<typeof createUser>>;
let hrManager: Awaited<ReturnType<typeof createUser>>;
let legacy: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  await resetDb();
  admin = await createUser('Role Admin HRM', 'HR_MANAGER');
  officer = await createUser('Riley Officer', 'HR_OFFICER');
  hrManager = await createUser('Matrix HR Manager', 'HR_MANAGER');
  // An account whose only stored assignment is a retired value.
  legacy = await createUser('Legacy Admin');
  await getPrisma().roleAssignment.create({
    data: { userId: legacy.userId, role: 'SYSTEM_ADMIN', reason: 'historical fixture' },
  });
});

describe('role administration', () => {
  it('grants and revokes with reasons, reflected in session hydration', async () => {
    await grantRole(admin.actor, officer.userId, 'HR_MANAGER', 'Covering a vacancy (synthetic).');
    let session = await getSessionUser(officer.userId);
    expect(session!.roles).toContain('HR_MANAGER');

    await revokeRole(admin.actor, officer.userId, 'HR_MANAGER', 'Coverage ended.');
    session = await getSessionUser(officer.userId);
    expect(session!.roles).not.toContain('HR_MANAGER');
  });

  it('refuses self-grant even for the HR Manager (REQ-ADMIN-002)', async () => {
    await expect(
      grantRole(admin.actor, admin.userId, 'HR_MANAGER', 'attempting self-escalation'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses grants from the HR Officer and from accounts with no active role', async () => {
    await expect(
      grantRole(officer.actor, hrManager.userId, 'HR_OFFICER', 'not allowed'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      grantRole(legacy.actor, officer.userId, 'HR_MANAGER', 'not allowed'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('never grants a retired role value (DEC-063)', async () => {
    for (const retired of ['SYSTEM_ADMIN', 'LINE_MANAGER', 'IT_RESPONDER', 'AUDITOR']) {
      await expect(
        grantRole(admin.actor, officer.userId, retired, 'retired role'),
        retired,
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    }
  });

  it('session hydration ignores stored retired assignments (DEC-063)', async () => {
    const session = await getSessionUser(legacy.userId);
    expect(session).not.toBeNull();
    expect(session!.roles).toEqual([]);
  });
});

describe('audit access', () => {
  it('case audit follows case visibility; global feed is HR-Manager-only (DEC-042)', async () => {
    const { caseId } = await createDraft(officer.actor, VALID_DRAFT);
    const events = await listCaseAudit(officer.actor, caseId);
    expect(events.map((e) => e.eventType)).toContain('CASE_CREATED');

    // A stored SYSTEM_ADMIN assignment buys nothing: no case is discoverable.
    await expect(listCaseAudit(legacy.actor, caseId)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const feed = await listGlobalAudit(hrManager.actor, {});
    expect(feed.rows.length).toBeGreaterThan(0);
    // HR OFFICERS stay excluded from the global feed.
    await expect(listGlobalAudit(officer.actor, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(listGlobalAudit(legacy.actor, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('role-change denials are themselves audited (ACCESS_DENIED)', async () => {
    const feed = await listGlobalAudit(hrManager.actor, { eventType: 'ACCESS_DENIED' });
    expect(feed.rows.length).toBeGreaterThan(0);
  });
});
