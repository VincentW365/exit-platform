/**
 * Centralized email routing and the email log (email routing directive).
 *
 * The promise is that moving a department to a different mailbox, or copying
 * Security on access removals, is a configuration change - so these tests
 * change configuration and check the outcome, never the code.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { createDraft, transitionCase } from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import { listEmailLog, processOutbox, setTestMode } from '../src/services/outboxService.ts';
import {
  DEFAULT_ROUTES,
  listRoutes,
  resolveRoute,
  routeFor,
  setRoute,
} from '../src/services/routingService.ts';
import {
  createUser,
  readyAssignment,
  resetDb,
  seedStage3Fixtures,
  VALID_DRAFT,
  FIXTURE_CONFIRMED_LAST_DAY,
} from './helpers.ts';

const prisma = getPrisma();

let officer: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;
let lineMgr: Awaited<ReturnType<typeof createUser>>;

const TEST_DRAFT = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  confirmedLastDay: FIXTURE_CONFIRMED_LAST_DAY,
} as const;

async function activeCase(): Promise<string> {
  const created = await createDraft(officer.actor, {
    ...TEST_DRAFT,
    employeeSourceId: 'EMP-TEST-001',
  });
  await transitionCase(officer.actor, created.caseId, 'submit');
  await transitionCase(manager.actor, created.caseId, 'approve');
  await readyAssignment(created.caseId, manager.actor, officer.userId, lineMgr.userId);
  await activateCase(manager.actor, created.caseId);
  return created.caseId;
}

async function caseFacts(caseId: string) {
  const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
  return {
    caseId: c.id,
    employeeSourceSystem: c.employeeSourceSystem,
    employeeWorkEmail: c.employeeWorkEmail,
    employeeDisplayName: c.employeeDisplayName,
    managerSourceId: c.managerSourceId,
    assignedOfficerId: c.assignedOfficerId,
    ownerId: c.ownerId,
  };
}

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  officer = await createUser('Routing Officer', 'HR_OFFICER');
  manager = await createUser('Routing Manager', 'HR_MANAGER');
  lineMgr = await createUser('Routing Line Manager', 'LINE_MANAGER');
});

describe('the routing table', () => {
  it('ships a route for every notification type', async () => {
    const routes = await listRoutes(manager.actor);
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(r.to).toMatch(/^(static|dynamic):/);
    }
  });

  it('addresses the departure notice to a person, not a shared mailbox', async () => {
    expect(DEFAULT_ROUTES.LINE_MANAGER_HANDOVER!.to).toBe('dynamic:EMPLOYEE_MANAGER');
    expect((await routeFor('LINE_MANAGER_HANDOVER')).to).toBe('dynamic:EMPLOYEE_MANAGER');
  });

  it('refuses an unknown destination and a duplicated one', async () => {
    await expect(
      setRoute(manager.actor, {
        notificationType: 'IT_ACCESS_REMOVAL',
        to: 'static:NOWHERE',
        cc: [],
        bcc: [],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      setRoute(manager.actor, {
        notificationType: 'IT_ACCESS_REMOVAL',
        to: 'static:IT',
        cc: ['static:IT'],
        bcc: [],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('refuses an officer, and records a change with destinations rather than addresses', async () => {
    await expect(
      setRoute(officer.actor, {
        notificationType: 'IT_ACCESS_REMOVAL',
        to: 'static:IT',
        cc: [],
        bcc: [],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await setRoute(manager.actor, {
      notificationType: 'IT_ACCESS_REMOVAL',
      to: 'static:IT',
      cc: ['static:SECURITY'],
      bcc: [],
      note: 'Security keeps oversight of access removals.',
    });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'NOTIFICATION_ROUTING_CHANGED' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit.metadata).toMatchObject({ newTo: 'static:IT' });
    expect(JSON.stringify(audit.metadata)).not.toContain('@');
  });
});

describe('resolving a route for a case', () => {
  it('turns destinations into addresses, static from the directory and dynamic from the case', async () => {
    const caseId = await activeCase();
    const facts = await caseFacts(caseId);

    const it = await resolveRoute('IT_ACCESS_REMOVAL', facts);
    expect(it.to?.email).toBeTruthy();
    expect(it.to?.recipientConfigId).toBeTruthy(); // a directory mailbox
    // The copy configured above resolves too.
    expect(it.cc.map((c) => c.destination)).toContain('static:SECURITY');

    // Dynamic destinations resolve to a PERSON on this case, so they carry no
    // directory configuration id.
    const letter = await resolveRoute('RESIGNATION_ACCEPTANCE_LETTER', facts);
    expect(letter.unresolved).toEqual([]);
    expect(letter.to?.destination).toBe('dynamic:EMPLOYEE');
    expect(letter.to?.recipientConfigId).toBeNull();
    expect(letter.to?.email).toBe(facts.employeeWorkEmail);

    await setRoute(manager.actor, {
      notificationType: 'MANUAL_EXCEPTION_NOTIFICATION',
      to: 'dynamic:ASSIGNED_HR_OFFICER',
      cc: [],
      bcc: [],
    });
    const toOfficer = await resolveRoute('MANUAL_EXCEPTION_NOTIFICATION', facts);
    expect(toOfficer.to?.recipientConfigId).toBeNull();
    expect(toOfficer.to?.displayName).toBe('Routing Officer');
  });

  it('reports what it could not resolve instead of dropping it', async () => {
    const caseId = await activeCase();
    const facts = { ...(await caseFacts(caseId)), managerSourceId: null };
    const notice = await resolveRoute('LINE_MANAGER_HANDOVER', facts);
    expect(notice.to).toBeNull();
    expect(notice.unresolved.join(' ')).toContain('manager');
  });

  it('never copies a destination that is already the primary recipient', async () => {
    await setRoute(manager.actor, {
      notificationType: 'FINANCE_OFFBOARDING',
      to: 'static:FINANCE',
      cc: ['static:FINANCE'],
      bcc: [],
    }).catch(() => undefined); // duplicate rejected by validation
    const caseId = await activeCase();
    const resolved = await resolveRoute('FINANCE_OFFBOARDING', await caseFacts(caseId));
    expect(resolved.cc.map((c) => c.email)).not.toContain(resolved.to?.email);
  });
});

describe('a configuration change reroutes real notifications', () => {
  it('sends the Finance notice to whichever mailbox the table names', async () => {
    // Route Finance's notice to Payroll instead - a configuration change only.
    await setRoute(manager.actor, {
      notificationType: 'FINANCE_OFFBOARDING',
      to: 'static:PAYROLL',
      cc: [],
      bcc: [],
      note: 'Rerouted for this test.',
    });
    const caseId = await activeCase();
    const record = await prisma.notificationRecord.findFirstOrThrow({
      where: { caseId, notificationType: 'FINANCE_OFFBOARDING' },
    });
    const payroll = await prisma.recipientConfig.findFirstOrThrow({
      where: { recipientClass: 'PAYROLL' },
    });
    expect(record.recipientConfigId).toBe(payroll.id);

    // And put it back, so the rest of the suite sees the shipped behaviour.
    await setRoute(manager.actor, {
      notificationType: 'FINANCE_OFFBOARDING',
      to: 'static:FINANCE',
      cc: [],
      bcc: [],
    });
  });

  it('carries configured copies onto the record, encrypted with readable masks', async () => {
    const caseId = await activeCase();
    const record = await prisma.notificationRecord.findFirstOrThrow({
      where: { caseId, notificationType: 'IT_ACCESS_REMOVAL' },
    });
    expect(record.ccNames.length).toBeGreaterThan(0);
    expect(record.ccCiphertext).toBeTruthy();
    expect(record.ccCiphertext).not.toContain('@');
    expect(record.ccMasks.length).toBe(record.ccNames.length);
  });
});

describe('the email log', () => {
  it('records what was intended, what happened, and whether it was a test', async () => {
    await setTestMode(manager.actor, {
      enabled: true,
      redirectTo: 'uat.mailbox@example.test',
      note: 'Routing verification.',
    });
    await activeCase();
    await processOutbox(new Date());

    const log = await listEmailLog(manager.actor, { caseNumber: '' });
    const rows = log.filter((r) => r.caseNumber);
    expect(rows.length).toBeGreaterThan(0);

    const sent = rows.filter((r) => r.status === 'SUBMITTED');
    expect(sent.length).toBeGreaterThan(0);
    for (const row of sent) {
      // Every column the directive asks for is populated.
      expect(row.generatedAt).toBeInstanceOf(Date);
      expect(row.caseNumber).toMatch(/^OFF-/);
      expect(row.employee).toBeTruthy();
      expect(row.notificationType).toBeTruthy();
      expect(row.subject).toBeTruthy();
      expect(row.intendedToMask).toBeTruthy();
      expect(row.actualToMask).toBeTruthy();
      expect(row.wasTestMode).toBe(true);
      // Intended and actual differ precisely because it was redirected.
      expect(row.actualToMask).not.toBe(row.intendedToMask);
      // Masked on both sides: the log is not a directory of addresses.
      expect(row.intendedToMask).not.toContain('uat.mailbox@example.test');
    }

    // The test filter finds them.
    const testOnly = await listEmailLog(manager.actor, { testOnly: true });
    expect(testOnly.length).toBeGreaterThan(0);
    expect(testOnly.every((r) => r.wasTestMode)).toBe(true);

    await setTestMode(manager.actor, { enabled: false, redirectTo: '' });
  });

  it('shows a live send as itself, with intended and actual agreeing', async () => {
    await activeCase();
    await processOutbox(new Date());
    const log = await listEmailLog(manager.actor, {});
    const row = log.find((r) => r.status === 'SUBMITTED' && !r.wasTestMode);
    expect(row).toBeDefined();
    expect(row!.actualToMask).toBe(row!.intendedToMask);
  });

  it('is refused to an HR officer', async () => {
    await expect(listEmailLog(officer.actor, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
