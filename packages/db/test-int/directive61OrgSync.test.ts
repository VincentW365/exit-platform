/**
 * Directive 6.1 integration - organization sync, graph validation and
 * hierarchy-change safety (sections A/B/C/F, AM tests 1,3,4,11,19,36).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { setBambooFixtureForTests, syncEmployees } from '../src/services/bamboohrService.ts';
import { createDraft, transitionCase } from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import { refreshManagerFromDirectory } from '../src/services/caseAssignmentService.ts';
import { orgValidation, managerChainOf, directReportsOf } from '../src/services/orgService.ts';
import {
  prepareNotification,
  transitionNotification,
} from '../src/services/notificationService.ts';
import {
  createUser,
  readyAssignment,
  resetDb,
  seedStage3Fixtures,
  VALID_DRAFT,
} from './helpers.ts';

const prisma = getPrisma();

let officer: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;
let lineMgr: Awaited<ReturnType<typeof createUser>>;

const TEST_DRAFT = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  confirmedLastDay: '2026-08-14T00:00:00.000Z',
} as const;

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  officer = await createUser('D61 Officer', 'HR_OFFICER');
  manager = await createUser('D61 Manager', 'HR_MANAGER');
  lineMgr = await createUser('D61 Line Manager', 'LINE_MANAGER');
  setBambooFixtureForTests(null);
});

describe('sync persists the approved organization columns (AM 1, 4)', () => {
  it('fixture sync writes manager/division/employeeNumber/active/lastSyncedAt', async () => {
    const result = await syncEmployees(manager.actor);
    expect(result.retrieved).toBeGreaterThanOrEqual(11);
    const rec = await prisma.employeeSourceRecord.findUniqueOrThrow({
      where: { sourceSystem_sourceId: { sourceSystem: 'SYNTHETIC', sourceId: 'EMP-TEST-001' } },
    });
    expect(rec.managerName).toBe('Samira Cole');
    expect(rec.managerSourceId).toBe('EMP-TEST-007');
    expect(rec.division).toBe('Retail');
    expect(rec.employeeNumber).toBe('1001');
    expect(rec.active).toBe(true);
    expect(rec.lastSyncedAt).not.toBeNull();
    // The inactive synthetic manager keeps active=false.
    const inactive = await prisma.employeeSourceRecord.findUniqueOrThrow({
      where: { sourceSystem_sourceId: { sourceSystem: 'SYNTHETIC', sourceId: 'EMP-TEST-011' } },
    });
    expect(inactive.active).toBe(false);
  });

  it('resolves name-only manager references when unique; ambiguity stays null', async () => {
    setBambooFixtureForTests([
      {
        sourceId: 'NAME-1',
        displayName: 'Unique Person',
        workEmail: 'u1@example.test',
        jobTitle: 'T',
        department: 'Sales',
        location: 'Kingston',
        active: true,
        managerName: 'Named Manager',
      },
      {
        sourceId: 'NAME-2',
        displayName: 'Named Manager',
        workEmail: 'nm@example.test',
        jobTitle: 'Mgr',
        department: 'Sales',
        location: 'Kingston',
        active: true,
        managerName: null,
      },
      {
        sourceId: 'AMB-1',
        displayName: 'Ambiguous Report',
        workEmail: 'a1@example.test',
        jobTitle: 'T',
        department: 'Sales',
        location: 'Kingston',
        active: true,
        managerName: 'Twin Name',
      },
      {
        sourceId: 'AMB-2',
        displayName: 'Twin Name',
        workEmail: 't1@example.test',
        jobTitle: 'M',
        department: 'Sales',
        location: 'Kingston',
        active: true,
        managerName: null,
      },
      {
        sourceId: 'AMB-3',
        displayName: 'Twin Name',
        workEmail: 't2@example.test',
        jobTitle: 'M',
        department: 'Warehouse',
        location: 'Kingston',
        active: true,
        managerName: null,
      },
    ]);
    await syncEmployees(manager.actor);
    setBambooFixtureForTests(null);
    const resolved = await prisma.employeeSourceRecord.findUniqueOrThrow({
      where: { sourceSystem_sourceId: { sourceSystem: 'SYNTHETIC', sourceId: 'NAME-1' } },
    });
    expect(resolved.managerSourceId).toBe('NAME-2');
    const ambiguous = await prisma.employeeSourceRecord.findUniqueOrThrow({
      where: { sourceSystem_sourceId: { sourceSystem: 'SYNTHETIC', sourceId: 'AMB-1' } },
    });
    expect(ambiguous.managerSourceId).toBeNull();
  });
});

describe('createDraft preserves manager provenance (AM 3, 12)', () => {
  it('derives the manager at draft creation and never destroys sync columns', async () => {
    const created = await createDraft(officer.actor, TEST_DRAFT);
    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(c.managerName).toBe('Samira Cole');
    expect(c.managerSourceId).toBe('EMP-TEST-007');
    expect(c.managerSource).toBe('DIRECTORY');
    // No LINE_MANAGER app account matches in this DB -> unresolved.
    expect(c.managerUserId).toBeNull();
    // The source record keeps its organization columns (merge fix).
    const rec = await prisma.employeeSourceRecord.findUniqueOrThrow({
      where: { sourceSystem_sourceId: { sourceSystem: 'SYNTHETIC', sourceId: 'EMP-TEST-001' } },
    });
    expect(rec.managerName).toBe('Samira Cole');
    expect((rec.payload as { managerName?: string }).managerName).toBe('Samira Cole');
    const derived = await prisma.auditEvent.findFirst({
      where: { caseId: created.caseId, eventType: 'CASE_MANAGER_DERIVED' },
    });
    expect(derived).not.toBeNull();
    expect((derived!.metadata as { managerName?: string }).managerName).toBe('Samira Cole');
  });

  it('resolves managerUserId when a LINE_MANAGER account matches by email', async () => {
    const samira = await prisma.user.create({
      data: {
        identitySubject: 'test|samira-manager',
        displayName: 'Samira Cole',
        workEmail: 'samira.cole@example.test',
        roleAssignments: { create: [{ role: 'LINE_MANAGER', reason: 'test fixture' }] },
      },
    });
    const created = await createDraft(officer.actor, {
      ...TEST_DRAFT,
      employeeSourceId: 'EMP-TEST-003',
    });
    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(c.managerUserId).toBe(samira.id);
    expect(c.managerSource).toBe('DIRECTORY');
  });
});

describe('organization validation service (AM 11)', () => {
  it('computes stats, findings and the manager graph over synced records', async () => {
    const report = await orgValidation(manager.actor);
    expect(report.stats.employees).toBeGreaterThanOrEqual(11);
    const ids = report.findings.map((f) => f.checkId);
    // EMP-TEST-009 has no manager; EMP-TEST-011 is an inactive manager.
    expect(ids).toContain('MISSING_MANAGER');
    expect(ids).toContain('INACTIVE_MANAGER');
    const chain = await managerChainOf(manager.actor, 'EMP-TEST-001');
    expect(chain.manager?.sourceId).toBe('EMP-TEST-007');
    const reports = await directReportsOf(manager.actor, 'EMP-TEST-006');
    expect(reports.map((r) => r.sourceId)).toContain('EMP-TEST-002');
    await expect(orgValidation(officer.actor)).resolves.toBeTruthy();
  });
});

describe('post-activation hierarchy change is flagged, never auto-applied (AM 19)', () => {
  it('flags once, keeps assignments, clears on re-derive', async () => {
    const created = await createDraft(officer.actor, {
      ...TEST_DRAFT,
      employeeSourceId: 'EMP-TEST-004',
    });
    await transitionCase(officer.actor, created.caseId, 'submit');
    await transitionCase(manager.actor, created.caseId, 'approve');
    await readyAssignment(created.caseId, manager.actor, officer.userId, lineMgr.userId);
    await activateCase(manager.actor, created.caseId);
    const before = await prisma.workflowTask.findMany({
      where: { caseId: created.caseId, department: 'LINE_MANAGER' },
    });
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((t) => t.assigneeId === lineMgr.userId)).toBe(true);

    // The directory now reports a different manager for EMP-TEST-004.
    setBambooFixtureForTests([
      {
        sourceId: 'EMP-TEST-004',
        displayName: 'Taylor Singh',
        workEmail: 'taylor.singh@example.test',
        jobTitle: 'Service Advisor',
        department: 'Service',
        location: 'Kingston',
        active: true,
        managerName: 'A Different Manager',
      },
    ]);
    await syncEmployees(manager.actor);
    let c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(c.managerChangeFlaggedAt).not.toBeNull();
    const flags = await prisma.auditEvent.count({
      where: { caseId: created.caseId, eventType: 'HIERARCHY_CHANGE_FLAGGED' },
    });
    expect(flags).toBe(1);
    // Assignments did NOT move.
    const after = await prisma.workflowTask.findMany({
      where: { caseId: created.caseId, department: 'LINE_MANAGER' },
    });
    expect(after.every((t) => t.assigneeId === lineMgr.userId)).toBe(true);
    // A second sync does not double-flag.
    await syncEmployees(manager.actor);
    expect(
      await prisma.auditEvent.count({
        where: { caseId: created.caseId, eventType: 'HIERARCHY_CHANGE_FLAGGED' },
      }),
    ).toBe(1);
    setBambooFixtureForTests(null);
    // HR review: re-derivation clears the flag.
    await refreshManagerFromDirectory(manager.actor, created.caseId);
    c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: created.caseId } });
    expect(c.managerChangeFlaggedAt).toBeNull();
  });
});

describe('record-purpose safety on the new paths (AM 36 / AL)', () => {
  it('TEST cases dispatch to capture only; OPERATIONAL+BASELINE never enqueue', async () => {
    // TEST case: approval enqueues to the outbox (capture provider, non-prod).
    const testCase = await createDraft(officer.actor, {
      ...TEST_DRAFT,
      employeeSourceId: 'EMP-TEST-002',
    });
    await transitionCase(officer.actor, testCase.caseId, 'submit');
    await transitionCase(manager.actor, testCase.caseId, 'approve');
    await readyAssignment(testCase.caseId, manager.actor, officer.userId, lineMgr.userId);
    await activateCase(manager.actor, testCase.caseId);
    const n1 = await prepareNotification(officer.actor, testCase.caseId, {
      notificationType: 'IT_ACCESS_REMOVAL',
    });
    await transitionNotification(officer.actor, n1.id, 'submit');
    await transitionNotification(officer.actor, n1.id, 'approve');
    expect(await prisma.notificationOutbox.count({ where: { notificationRecordId: n1.id } })).toBe(
      1,
    );

    // OPERATIONAL + BASELINE: automation may not fire (activation refused
    // while the engine flag is off - the notification path never opens).
    const baseline = await createDraft(officer.actor, {
      ...VALID_DRAFT,
      employeeSourceId: 'EMP-TEST-005',
      confirmedLastDay: '2026-08-14T00:00:00.000Z',
    });
    await transitionCase(officer.actor, baseline.caseId, 'submit');
    await transitionCase(manager.actor, baseline.caseId, 'approve');
    await readyAssignment(baseline.caseId, manager.actor, officer.userId, lineMgr.userId);
    await expect(activateCase(manager.actor, baseline.caseId)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});
