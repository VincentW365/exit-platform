/**
 * Stage 4 integration: transactional outbox, providers and identity
 * (Directive 4 X integration items 1-11).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { ProviderError } from '@exit/domain';
import { getPrisma } from '../src/client.ts';
import { createDraft, transitionCase } from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import {
  prepareNotification,
  transitionNotification,
} from '../src/services/notificationService.ts';
import { processOutbox, resolveDeadLetter, retryOutbox } from '../src/services/outboxService.ts';
import {
  setEmailProviderForTests,
  type EmailProvider,
  type OutboundMessage,
} from '../src/services/emailProviders.ts';
import { disableUser, generateAccessReview } from '../src/services/identityService.ts';
import { getSessionUser } from '../src/services/userService.ts';
import {
  reconciliationReport,
  setBambooFixtureForTests,
  syncEmployees,
} from '../src/services/bamboohrService.ts';
import { getCase } from '../src/services/caseService.ts';
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
let sysAdmin: Awaited<ReturnType<typeof createUser>>;
let victim: Awaited<ReturnType<typeof createUser>>;
let lineMgr: Awaited<ReturnType<typeof createUser>>;

const TEST_DRAFT = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  confirmedLastDay: '2026-08-14T00:00:00.000Z',
} as const;

async function makeActiveCase(overrides: Record<string, unknown> = {}): Promise<string> {
  const created = await createDraft(officer.actor, { ...TEST_DRAFT, ...overrides });
  await transitionCase(officer.actor, created.caseId, 'submit');
  await transitionCase(manager.actor, created.caseId, 'approve');
  await readyAssignment(created.caseId, manager.actor, officer.userId, lineMgr.userId);
  await activateCase(manager.actor, created.caseId);
  return created.caseId;
}

async function approvedNotification(caseId: string) {
  const record = await prepareNotification(officer.actor, caseId, {
    notificationType: 'IT_ACCESS_REMOVAL',
  });
  await transitionNotification(officer.actor, record.id, 'submit');
  await transitionNotification(officer.actor, record.id, 'approve');
  return record;
}

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures(); // includes Stage 4 dev recipients (capture://)
  officer = await createUser('S4 Officer', 'HR_OFFICER');
  manager = await createUser('S4 Manager', 'HR_MANAGER');
  sysAdmin = await createUser('S4 SysAdmin', 'SYSTEM_ADMIN');
  victim = await createUser('S4 Victim', 'IT_RESPONDER');
  lineMgr = await createUser('S4 Line Manager', 'LINE_MANAGER');
});

afterAll(() => {
  setEmailProviderForTests(undefined);
  setBambooFixtureForTests(null);
});

describe('transactional outbox (X.1-X.6)', () => {
  it('approval creates exactly one outbox record transactionally (X.1)', async () => {
    const caseId = await makeActiveCase();
    const record = await approvedNotification(caseId);
    const outbox = await prisma.notificationOutbox.findMany({
      where: { notificationRecordId: record.id },
    });
    expect(outbox.length).toBe(1);
    expect(outbox[0]!.status).toBe('PENDING');
    expect(outbox[0]!.destinationMask).toContain('capture://');
    // The idempotency key is DB-unique (B.7).
    await expect(
      prisma.notificationOutbox.create({
        data: {
          notificationRecordId: record.id,
          provider: 'dev-capture',
          recipientClass: 'IT_OFFBOARDING',
          destinationMask: 'capture://x',
          subjectSnapshot: 'x',
          contentChecksum: 'x',
          templateVersion: 1,
          workflowVersion: 1,
          idempotencyKey: outbox[0]!.idempotencyKey,
          correlationId: 'dup-test',
        },
      }),
    ).rejects.toThrow();
  });

  it('the worker captures the message; duplicates never dispatch twice (X.2/X.3)', async () => {
    setEmailProviderForTests(undefined); // real dev-capture provider
    const caseId = await makeActiveCase({ employeeSourceId: 'EMP-TEST-002' });
    const record = await approvedNotification(caseId);

    const first = await processOutbox(new Date());
    expect(first.submitted).toBeGreaterThanOrEqual(1);
    const row = await prisma.notificationOutbox.findFirstOrThrow({
      where: { notificationRecordId: record.id },
    });
    expect(row.status).toBe('SUBMITTED');
    // CAPTURED - never represented as externally delivered (B.6).
    expect(row.deliveryStatus).toBe('CAPTURED');
    expect(row.providerMessageRef).toMatch(/^capture:/);

    const captures = await prisma.notificationCapture.count({
      where: { recordId: record.id, note: { contains: 'outbox' } },
    });
    expect(captures).toBe(1);

    const second = await processOutbox(new Date());
    expect(second.submitted).toBe(0); // nothing left to claim
    expect(
      await prisma.notificationCapture.count({
        where: { recordId: record.id, note: { contains: 'outbox' } },
      }),
    ).toBe(1);
  });

  it('retryable errors back off and then succeed (X.4)', async () => {
    let calls = 0;
    const flaky: EmailProvider = {
      mode: 'test-flaky',
      validateConfig: () => [],
      health: async () => ({ ok: true, detail: 'test' }),
      send: async (_m: OutboundMessage) => {
        calls += 1;
        if (calls === 1) throw new ProviderError('PROVIDER_THROTTLED', 'test throttle', 1000);
        return { providerMessageRef: 'test-ref-1', deliveryStatus: 'SUBMITTED' as const };
      },
    };
    setEmailProviderForTests(flaky);
    const caseId = await makeActiveCase({ employeeSourceId: 'EMP-TEST-003' });
    const record = await approvedNotification(caseId);

    await processOutbox(new Date());
    let row = await prisma.notificationOutbox.findFirstOrThrow({
      where: { notificationRecordId: record.id },
    });
    expect(row.status).toBe('FAILED_RETRYABLE');
    expect(row.lastErrorCode).toBe('PROVIDER_THROTTLED');
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() - 1000);

    // Second pass after the backoff window: succeeds.
    await processOutbox(new Date(Date.now() + 60_000));
    row = await prisma.notificationOutbox.findFirstOrThrow({
      where: { notificationRecordId: record.id },
    });
    expect(row.status).toBe('SUBMITTED');
    expect(row.attempts).toBe(2);
    setEmailProviderForTests(undefined);
  });

  it('permanent errors fail permanently with an exception; resolution is audited (X.5)', async () => {
    const rejecting: EmailProvider = {
      mode: 'test-reject',
      validateConfig: () => [],
      health: async () => ({ ok: true, detail: 'test' }),
      send: async () => {
        throw new ProviderError('RECIPIENT_REJECTED', 'test reject');
      },
    };
    setEmailProviderForTests(rejecting);
    const caseId = await makeActiveCase({ employeeSourceId: 'EMP-TEST-004' });
    const record = await approvedNotification(caseId);

    await processOutbox(new Date());
    const row = await prisma.notificationOutbox.findFirstOrThrow({
      where: { notificationRecordId: record.id },
    });
    expect(row.status).toBe('FAILED_PERMANENT');
    // B.10: surfaced in the exception feed.
    const exception = await prisma.caseException.findFirstOrThrow({
      where: { caseId, exceptionType: 'NOTIFICATION_FAILED', refId: row.id },
    });
    expect(exception.severity).toBe('HIGH');

    // B.11/B.12: authorized resolution and audited retry.
    await expect(resolveDeadLetter(officer.actor, row.id, 'no')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await resolveDeadLetter(
      sysAdmin.actor,
      row.id,
      'Verified recipient config; superseded manually.',
    );
    const resolved = await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(resolved.resolutionNote).toContain('superseded manually');
    await retryOutbox(sysAdmin.actor, row.id, 'Retrying after recipient fix (test).');
    setEmailProviderForTests(undefined);
  });

  it('exhausted retryable errors dead-letter (X.5)', async () => {
    const alwaysThrottled: EmailProvider = {
      mode: 'test-throttle',
      validateConfig: () => [],
      health: async () => ({ ok: true, detail: 'test' }),
      send: async () => {
        throw new ProviderError('PROVIDER_THROTTLED', 'always', 10);
      },
    };
    setEmailProviderForTests(alwaysThrottled);
    const caseId = await makeActiveCase({ employeeSourceId: 'EMP-TEST-005' });
    const record = await approvedNotification(caseId);
    let now = Date.now();
    for (let i = 0; i < 6; i++) {
      await processOutbox(new Date(now));
      now += 60_000;
    }
    const row = await prisma.notificationOutbox.findFirstOrThrow({
      where: { notificationRecordId: record.id },
    });
    expect(row.status).toBe('DEAD_LETTER');
    expect(row.attempts).toBe(5);
    setEmailProviderForTests(undefined);
  });

  it('manual sending cancels pending automatic dispatch in the same tx (X.6 / B.8)', async () => {
    const caseId = await makeActiveCase({
      employeeSourceId: 'EMP-TEST-001',
      departureType: 'IMMEDIATE_RESIGNATION',
      confirmedLastDay: null,
    });
    const record = await prepareNotification(officer.actor, caseId, {
      notificationType: 'FINANCE_OFFBOARDING',
    });
    await transitionNotification(officer.actor, record.id, 'submit');
    await transitionNotification(officer.actor, record.id, 'approve');
    // Approved -> pending outbox exists; HR then routes it manually instead.
    await transitionNotification(officer.actor, record.id, 'markReady');
    await transitionNotification(officer.actor, record.id, 'recordManualSend', {
      method: 'IN_PERSON',
      destinationRef: 'Finance office (internal)',
    });
    const outbox = await prisma.notificationOutbox.findFirstOrThrow({
      where: { notificationRecordId: record.id },
    });
    expect(outbox.status).toBe('CANCELLED');
    const result = await processOutbox(new Date());
    const stillCancelled = await prisma.notificationOutbox.findUniqueOrThrow({
      where: { id: outbox.id },
    });
    expect(stillCancelled.status).toBe('CANCELLED');
    expect(result.submitted).toBe(0);
  });
});

describe('identity lifecycle (X.8, X.9)', () => {
  it('disabling a user revokes sessions immediately and flags orphaned work (X.8)', async () => {
    // Give the victim an assigned open task first.
    const caseId = await makeActiveCase({ employeeSourceId: 'EMP-TEST-002' });
    const task = await prisma.workflowTask.findFirstOrThrow({
      where: { caseId, department: 'IT', status: { not: 'NOT_READY' } },
    });
    await prisma.workflowTask.update({
      where: { id: task.id },
      data: { assigneeId: victim.userId },
    });

    const before = await getSessionUser(victim.userId, Math.floor(Date.now() / 1000));
    expect(before).not.toBeNull();
    const result = await disableUser(sysAdmin.actor, victim.userId, 'Left the company (test).');
    expect(result.orphanedTasks).toBeGreaterThanOrEqual(1);
    // A session issued BEFORE the disable instant is rejected (E.7).
    const after = await getSessionUser(victim.userId, Math.floor(Date.now() / 1000) - 60);
    expect(after).toBeNull();
    const orphanException = await prisma.caseException.findFirst({
      where: { refId: task.id, exceptionType: 'MISSING_APPROVAL', status: 'OPEN' },
    });
    expect(orphanException).not.toBeNull();
    // The access review surfaces inactive users that still hold roles (E.10/E.11).
    const review = await generateAccessReview(sysAdmin.actor);
    const payload = review.payload as { inactiveWithRoles: string[] };
    expect(payload.inactiveWithRoles).toContain(victim.userId);
  });

  it('SYSTEM_ADMIN cannot access HR case content (X.9)', async () => {
    const caseId = await makeActiveCase({ employeeSourceId: 'EMP-TEST-003' });
    await expect(getCase(sysAdmin.actor, caseId)).rejects.toMatchObject({
      code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/),
    });
  });
});

describe('BambooHR fixture sync and reconciliation (X.10, X.11)', () => {
  it('sync updates SOURCE records but never case snapshots (X.10)', async () => {
    setBambooFixtureForTests(null);
    await syncEmployees(sysAdmin.actor);
    const caseId = await makeActiveCase({ employeeSourceId: 'EMP-TEST-004' });
    const snapshotBefore = await prisma.employeeSnapshot.findUniqueOrThrow({ where: { caseId } });

    // The source changes the employee's department.
    setBambooFixtureForTests([
      {
        sourceId: 'EMP-TEST-004',
        displayName: 'Taylor Singh',
        workEmail: 'taylor.singh@example.test',
        jobTitle: 'Service Advisor',
        department: 'Administration', // changed
        location: 'Kingston',
        active: true,
        managerName: 'Jamie Douglas',
      },
    ]);
    const result = await syncEmployees(sysAdmin.actor);
    expect(result.updated).toBe(1);
    expect(result.diffs[0]!.sourceId).toBe('EMP-TEST-004');

    const source = await prisma.employeeSourceRecord.findUniqueOrThrow({
      where: { sourceSystem_sourceId: { sourceSystem: 'SYNTHETIC', sourceId: 'EMP-TEST-004' } },
    });
    expect(source.department).toBe('Administration');
    // The immutable case snapshot is untouched (F.7).
    const snapshotAfter = await prisma.employeeSnapshot.findUniqueOrThrow({ where: { caseId } });
    expect(snapshotAfter.checksum).toBe(snapshotBefore.checksum);
    expect(snapshotAfter.payload).toEqual(snapshotBefore.payload);
    // Case decision fields unchanged (F.8).
    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(c.departureType).toBe('RESIGNATION_WITH_NOTICE');
  });

  it('reconciliation identifies mismatches (X.11)', async () => {
    setBambooFixtureForTests([
      // EMP-TEST-004 present but department changed vs cache? cache says
      // Administration now; feed says Service -> department mismatch.
      {
        sourceId: 'EMP-TEST-004',
        displayName: 'Taylor Singh',
        workEmail: 'taylor.singh@example.test',
        jobTitle: 'Service Advisor',
        department: 'Service',
        location: 'Kingston',
        active: false, // inactive
        managerName: 'New Manager',
      },
      // EMP-TEST-001 etc missing from the feed entirely.
    ]);
    const report = await reconciliationReport(sysAdmin.actor);
    const kinds = report.findings.map((f) => f.kind);
    expect(kinds).toContain('SOURCE_EMPLOYEE_MISSING');
    expect(kinds).toContain('INACTIVE_SOURCE_EMPLOYEE');
    expect(kinds).toContain('CHANGED_DEPARTMENT_OR_LOCATION');
    expect(kinds).toContain('CHANGED_MANAGER');
    expect(kinds).toContain('UNMATCHED_EMPLOYEE_IDENTIFIER');
    setBambooFixtureForTests(null);
  });
});
