/**
 * Case ownership (owner directive 2026-09-22, DEC-065).
 *
 * The assigned HR Officer is the mutable operational owner: creation by an
 * officer assigns that officer automatically, My Work is "cases assigned to
 * me", every officer reads every case in the register, and only the assigned
 * officer (or the HR Manager) edits one. `createdById` stays an audit fact.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import {
  assignOfficer,
  createDraft,
  getCase,
  listCases,
  transitionCase,
  updateDraft,
} from '../src/index.ts';
import { createUser, resetDb, seedStage3Fixtures, VALID_DRAFT } from './helpers.ts';

const prisma = getPrisma();

let officerA: Awaited<ReturnType<typeof createUser>>;
let officerB: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;

const DRAFT = { ...VALID_DRAFT, recordPurpose: 'TEST', measurementCohort: null } as const;

/** My Work membership: the cases assigned to this actor. */
async function myWork(actor: { userId: string; roles: readonly string[] }) {
  const rows = await listCases(actor as never, { officer: actor.userId });
  return rows.map((r) => r.id);
}

async function register(actor: { userId: string; roles: readonly string[] }) {
  const rows = await listCases(actor as never, {});
  return rows.map((r) => r.id);
}

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  officerA = await createUser('Owner Officer A', 'HR_OFFICER');
  officerB = await createUser('Owner Officer B', 'HR_OFFICER');
  manager = await createUser('Owner Manager', 'HR_MANAGER');
});

describe('creation by an HR Officer', () => {
  it('assigns the creating officer automatically, puts the draft in their My Work and lets them edit it', async () => {
    const { caseId } = await createDraft(officerA.actor, DRAFT);
    const row = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.createdById).toBe(officerA.userId);
    expect(row.assignedOfficerId).toBe(officerA.userId);
    expect(row.status).toBe('DRAFT');

    expect(await myWork(officerA.actor)).toContain(caseId);
    const view = await getCase(officerA.actor, caseId);
    expect(view.capabilities.canEdit).toBe(true);
    expect(view.capabilities.canEditDraft).toBe(true);
    await expect(
      updateDraft(officerA.actor, caseId, { receiptSource: 'Email (owner edit)' }),
    ).resolves.toBeUndefined();

    // The automatic assignment is audited exactly like a manual one.
    const audit = await prisma.auditEvent.findFirst({
      where: { caseId, eventType: 'CASE_OFFICER_ASSIGNED' },
    });
    expect(audit).not.toBeNull();
    const meta = audit!.metadata as Record<string, unknown>;
    expect(meta['newOfficerId']).toBe(officerA.userId);
    expect(meta['previousOfficerId']).toBeNull();
    expect(meta['automatic']).toBe(true);
    expect(audit!.actorId).toBe(officerA.userId);
  });

  it('another officer sees the case in the register but not in My Work, and cannot edit it', async () => {
    const { caseId } = await createDraft(officerA.actor, {
      ...DRAFT,
      employeeSourceId: 'EMP-TEST-002',
    });
    expect(await register(officerB.actor)).toContain(caseId);
    expect(await myWork(officerB.actor)).not.toContain(caseId);

    // Reading is fine - the register is organisation-wide.
    const view = await getCase(officerB.actor, caseId);
    expect(view.case.employeeDisplayName).toBeTruthy();
    expect(view.capabilities.canEdit).toBe(false);
    expect(view.capabilities.canEditDraft).toBe(false);
    expect(view.capabilities.canSubmit).toBe(false);
    expect(view.capabilities.canUpload).toBe(false);
    expect(view.capabilities.canAddNote).toBe(false);
    // Server-side enforcement, not just hidden buttons.
    await expect(
      updateDraft(officerB.actor, caseId, { receiptSource: 'Email (not mine)' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(transitionCase(officerB.actor, caseId, 'submit')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // The register row says so too.
    const row = (await listCases(officerB.actor, {})).find((r) => r.id === caseId)!;
    expect(row.editable).toBe(false);
    expect(row.assignedOfficerId).toBe(officerA.userId);
    const own = (await listCases(officerA.actor, {})).find((r) => r.id === caseId)!;
    expect(own.editable).toBe(true);
  });

  it('an officer cannot assign or reassign', async () => {
    const { caseId } = await createDraft(officerA.actor, {
      ...DRAFT,
      employeeSourceId: 'EMP-TEST-004',
    });
    await expect(
      assignOfficer(officerA.actor, caseId, officerB.userId, 'not my authority'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('creation by the HR Manager', () => {
  it('starts unassigned: the manager edits, no officer can, and nobody has it in My Work', async () => {
    const { caseId } = await createDraft(manager.actor, {
      ...DRAFT,
      employeeSourceId: 'EMP-TEST-005',
    });
    const row = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.createdById).toBe(manager.userId);
    expect(row.assignedOfficerId).toBeNull();

    expect((await getCase(manager.actor, caseId)).capabilities.canEdit).toBe(true);
    await expect(
      updateDraft(manager.actor, caseId, { receiptSource: 'Email (manager edit)' }),
    ).resolves.toBeUndefined();
    expect(await myWork(officerA.actor)).not.toContain(caseId);
    expect(await myWork(officerB.actor)).not.toContain(caseId);
    expect(await register(officerA.actor)).toContain(caseId);
    expect((await getCase(officerA.actor, caseId)).capabilities.canEdit).toBe(false);
    await expect(
      updateDraft(officerA.actor, caseId, { receiptSource: 'Email (unassigned)' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(
      (await listCases(officerA.actor, {})).find((r) => r.id === caseId)!.assignedOfficerId,
    ).toBeNull();
  });

  it('assigning an officer puts the case in their My Work and gives them edit rights; the creator is unchanged', async () => {
    const { caseId } = await createDraft(manager.actor, {
      ...DRAFT,
      employeeSourceId: 'EMP-TEST-006',
    });
    const result = await assignOfficer(manager.actor, caseId, officerA.userId, 'Manager assigns.');
    expect(result.changed).toBe(true);
    const row = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.createdById).toBe(manager.userId);
    expect(row.assignedOfficerId).toBe(officerA.userId);
    expect(await myWork(officerA.actor)).toContain(caseId);
    expect((await getCase(officerA.actor, caseId)).capabilities.canEdit).toBe(true);
    await expect(
      updateDraft(officerA.actor, caseId, { receiptSource: 'Email (assigned officer)' }),
    ).resolves.toBeUndefined();
    expect((await getCase(manager.actor, caseId)).capabilities.canEdit).toBe(true);

    const audit = await prisma.auditEvent.findFirst({
      where: { caseId, eventType: 'CASE_OFFICER_ASSIGNED' },
    });
    const meta = audit!.metadata as Record<string, unknown>;
    expect(meta['previousOfficerId']).toBeNull();
    expect(meta['newOfficerId']).toBe(officerA.userId);
    expect(audit!.actorId).toBe(manager.userId);
    expect(meta['automatic']).toBeUndefined();
  });
});

describe('reassignment by the HR Manager', () => {
  it('moves My Work membership and edit authority from A to B; the creator and history stay', async () => {
    const { caseId } = await createDraft(officerA.actor, {
      ...DRAFT,
      employeeSourceId: 'EMP-TEST-007',
    });
    // Before.
    expect(await myWork(officerA.actor)).toContain(caseId);
    expect(await myWork(officerB.actor)).not.toContain(caseId);
    expect((await getCase(officerA.actor, caseId)).capabilities.canEdit).toBe(true);
    expect((await getCase(officerB.actor, caseId)).capabilities.canEdit).toBe(false);
    expect((await getCase(manager.actor, caseId)).capabilities.canEdit).toBe(true);

    const result = await assignOfficer(manager.actor, caseId, officerB.userId, 'Workload balance.');
    expect(result.changed).toBe(true);

    // After.
    expect(await myWork(officerA.actor)).not.toContain(caseId);
    expect(await myWork(officerB.actor)).toContain(caseId);
    expect(await register(officerA.actor)).toContain(caseId);
    expect((await getCase(officerA.actor, caseId)).capabilities.canEdit).toBe(false);
    await expect(
      updateDraft(officerA.actor, caseId, { receiptSource: 'Email (former owner)' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await getCase(officerB.actor, caseId)).capabilities.canEdit).toBe(true);
    await expect(
      updateDraft(officerB.actor, caseId, { receiptSource: 'Email (new owner)' }),
    ).resolves.toBeUndefined();
    expect((await getCase(manager.actor, caseId)).capabilities.canEdit).toBe(true);

    const row = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.createdById).toBe(officerA.userId);
    expect(row.assignedOfficerId).toBe(officerB.userId);

    // Audit: the automatic initial assignment AND the reassignment, in order.
    const events = await prisma.auditEvent.findMany({
      where: { caseId, eventType: { in: ['CASE_OFFICER_ASSIGNED', 'CASE_OFFICER_REASSIGNED'] } },
      orderBy: { occurredAt: 'asc' },
    });
    expect(events.map((e) => e.eventType)).toEqual([
      'CASE_OFFICER_ASSIGNED',
      'CASE_OFFICER_REASSIGNED',
    ]);
    const re = events[1]!.metadata as Record<string, unknown>;
    expect(re['previousOfficerId']).toBe(officerA.userId);
    expect(re['newOfficerId']).toBe(officerB.userId);
    expect(events[1]!.actorId).toBe(manager.userId);
    expect(events[1]!.occurredAt).toBeInstanceOf(Date);

    // Re-assigning the current owner is a no-op that records nothing.
    const again = await assignOfficer(manager.actor, caseId, officerB.userId, 'same again');
    expect(again.changed).toBe(false);
    expect(
      await prisma.auditEvent.count({
        where: { caseId, eventType: { in: ['CASE_OFFICER_ASSIGNED', 'CASE_OFFICER_REASSIGNED'] } },
      }),
    ).toBe(2);
  });
});
