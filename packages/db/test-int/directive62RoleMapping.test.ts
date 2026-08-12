/**
 * Directive 6.2 (E) - directory role mapping: account creation from the
 * synchronized directory, role grants, enable/disable lifecycle, and manager
 * auto-resolution succeeding for a directory-mapped manager account.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import {
  createUserFromDirectory,
  enableUser,
  listDirectoryAccounts,
  listDirectoryPeopleForMapping,
} from '../src/services/userService.ts';
import { disableUser } from '../src/services/identityService.ts';
import { syncEmployees } from '../src/services/bamboohrService.ts';
import { createDraft } from '../src/services/caseService.ts';
import { createUser, resetDb, VALID_DRAFT } from './helpers.ts';

const prisma = getPrisma();

let admin: Awaited<ReturnType<typeof createUser>>;
let hrManager: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  await resetDb();
  admin = await createUser('D62 Admin', 'SYSTEM_ADMIN');
  hrManager = await createUser('D62 Manager', 'HR_MANAGER');
  // Populate the directory (fixture graph incl. EMP-TEST-006 Warehouse Manager).
  await syncEmployees(hrManager.actor);
});

describe('createUserFromDirectory', () => {
  it('creates a sign-in-able account with roles, department and provenance', async () => {
    const created = await createUserFromDirectory(admin.actor, {
      sourceSystem: 'SYNTHETIC',
      sourceId: 'EMP-TEST-006',
      roles: ['LINE_MANAGER'],
      reason: 'Map the warehouse manager for live UAT.',
    });
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: created.userId },
      include: { roleAssignments: { where: { revokedAt: null } } },
    });
    expect(row.identitySubject).toBe('bamboo|EMP-TEST-006');
    expect(row.identitySource).toBe('directory');
    expect(row.department).toBe('Warehouse');
    expect(row.roleAssignments.map((r) => r.role)).toEqual(['LINE_MANAGER']);
    const audit = await prisma.auditEvent.findFirst({
      where: { eventType: 'IDENTITY_USER_CREATED', objectId: created.userId },
    });
    expect(audit).not.toBeNull();
    const accounts = await listDirectoryAccounts(hrManager.actor);
    expect(accounts.some((a) => a.sourceId === 'EMP-TEST-006')).toBe(true);
  });

  it('is SYSTEM_ADMIN-only and refuses duplicates, unknown roles and missing people', async () => {
    await expect(
      createUserFromDirectory(hrManager.actor, {
        sourceSystem: 'SYNTHETIC',
        sourceId: 'EMP-TEST-007',
        roles: ['LINE_MANAGER'],
        reason: 'x',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      createUserFromDirectory(admin.actor, {
        sourceSystem: 'SYNTHETIC',
        sourceId: 'EMP-TEST-006',
        roles: ['LINE_MANAGER'],
        reason: 'duplicate',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      createUserFromDirectory(admin.actor, {
        sourceSystem: 'SYNTHETIC',
        sourceId: 'EMP-TEST-007',
        roles: ['AUDITOR'],
        reason: 'retired role',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createUserFromDirectory(admin.actor, {
        sourceSystem: 'SYNTHETIC',
        sourceId: 'NO-SUCH-PERSON',
        roles: ['LINE_MANAGER'],
        reason: 'missing',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('the mapping list excludes already-mapped people', async () => {
    const people = await listDirectoryPeopleForMapping(admin.actor);
    expect(people.some((p) => p.sourceId === 'EMP-TEST-006')).toBe(false);
    expect(people.some((p) => p.sourceId === 'EMP-TEST-007')).toBe(true);
    await expect(listDirectoryPeopleForMapping(hrManager.actor)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('manager auto-resolution now resolves to the mapped account', async () => {
    // EMP-TEST-002 reports to EMP-TEST-006 (Warehouse Manager), whose account
    // was just created from the directory with the directory work email.
    const created = await createDraft(hrManager.actor, {
      ...VALID_DRAFT,
      employeeSourceId: 'EMP-TEST-002',
      recordPurpose: 'TEST',
      measurementCohort: null,
    });
    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: created.caseId } });
    const mapped = await prisma.user.findUniqueOrThrow({
      where: { identitySubject: 'bamboo|EMP-TEST-006' },
    });
    expect(c.managerUserId).toBe(mapped.id);
    expect(c.managerSource).toBe('DIRECTORY');
  });
});

describe('enable/disable lifecycle', () => {
  it('disable revokes sessions; enable restores sign-in with audit', async () => {
    const mapped = await prisma.user.findUniqueOrThrow({
      where: { identitySubject: 'bamboo|EMP-TEST-006' },
    });
    await disableUser(admin.actor, mapped.id, 'UAT personnel-change drill.');
    let row = await prisma.user.findUniqueOrThrow({ where: { id: mapped.id } });
    expect(row.isActive).toBe(false);

    await expect(enableUser(hrManager.actor, mapped.id, 'x')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await enableUser(admin.actor, mapped.id, 'Drill complete; restore access.');
    row = await prisma.user.findUniqueOrThrow({ where: { id: mapped.id } });
    expect(row.isActive).toBe(true);
    expect(row.provisioningStatus).toBe('ACTIVE');
    const audit = await prisma.auditEvent.findFirst({
      where: { eventType: 'IDENTITY_USER_ENABLED', objectId: mapped.id },
    });
    expect(audit).not.toBeNull();
  });
});
