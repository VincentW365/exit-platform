/**
 * Rehearsal mode end to end (HR samples directive section 8).
 *
 * The point of the mode is that HR can run the REAL workflow safely, so the
 * assertions are about what does NOT change (records, evidence, attachments)
 * as much as what does (where the message goes).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { createDraft, transitionCase } from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import {
  currentTestMode,
  getTestMode,
  processOutbox,
  setTestMode,
} from '../src/services/outboxService.ts';
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
let admin: Awaited<ReturnType<typeof createUser>>;

const REHEARSAL = 'rehearsal.mailbox@example.test';

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

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  officer = await createUser('Rehearsal Officer', 'HR_OFFICER');
  manager = await createUser('Rehearsal Manager', 'HR_MANAGER');
  lineMgr = await createUser('Rehearsal Line Manager', 'LINE_MANAGER');
  admin = await createUser('Rehearsal Admin', 'SYSTEM_ADMIN');
});

describe('who can change it', () => {
  it('is off until someone turns it on', async () => {
    expect((await currentTestMode()).enabled).toBe(false);
  });

  it('accepts the HR Manager and the administrator, and refuses an officer', async () => {
    await setTestMode(manager.actor, { enabled: false, redirectTo: '' });
    await setTestMode(admin.actor, { enabled: false, redirectTo: '' });
    await expect(
      setTestMode(officer.actor, { enabled: true, redirectTo: REHEARSAL }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a mailbox that could actually deliver in development', async () => {
    await expect(
      setTestMode(manager.actor, { enabled: true, redirectTo: 'someone@bertsautoparts.com' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await currentTestMode()).enabled).toBe(false);
  });

  it('records the change with a mask, never the mailbox', async () => {
    await setTestMode(manager.actor, {
      enabled: true,
      redirectTo: REHEARSAL,
      note: 'August rehearsal.',
    });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'NOTIFICATION_TEST_MODE_CHANGED' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit.metadata).toMatchObject({ enabled: true });
    expect(JSON.stringify(audit.metadata)).not.toContain(REHEARSAL);
    expect((await getTestMode(manager.actor)).redirectTo).toBe(REHEARSAL);
  });
});

describe('what a rehearsal actually sends', () => {
  it('diverts every message to the one mailbox, marked and explained', async () => {
    await setTestMode(manager.actor, {
      enabled: true,
      redirectTo: REHEARSAL,
      note: 'August rehearsal.',
    });
    const caseId = await activeCase();
    await processOutbox(new Date());

    const captures = await prisma.notificationCapture.findMany({
      where: { record: { caseId } },
    });
    expect(captures.length).toBeGreaterThan(0);
    for (const capture of captures) {
      expect(capture.subject.startsWith('[TEST MODE] ')).toBe(true);
      expect(capture.body).toContain('WAS INTERCEPTED AND NOT DELIVERED');
      expect(capture.body).toContain('Note: August rehearsal.');
      // The real recipients survive as masks only.
      expect(capture.body).not.toContain('@example.test\n');
    }

    // The diversion is on the record, in masks on both sides.
    const redirects = await prisma.auditEvent.findMany({
      where: { caseId, eventType: 'NOTIFICATION_REDIRECTED_TEST_MODE' },
    });
    expect(redirects.length).toBe(captures.length);
    const metadata = JSON.stringify(redirects[0]!.metadata);
    expect(metadata).toContain('*');
    expect(metadata).not.toContain(REHEARSAL);
  });

  it('changes nothing else: the same records, evidence and outbox state', async () => {
    await setTestMode(manager.actor, { enabled: true, redirectTo: REHEARSAL });
    const caseId = await activeCase();
    await processOutbox(new Date());

    const records = await prisma.notificationRecord.findMany({ where: { caseId } });
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      // The stored snapshot is the REAL letter - only the outgoing copy is
      // marked, so the evidence of what HR approved stays honest.
      expect(r.subjectSnapshot?.startsWith('[TEST MODE] ')).toBe(false);
      expect(r.bodySnapshot).not.toContain('WAS INTERCEPTED');
      // And the recipient the case recorded is untouched.
      expect(['SENT', 'APPROVED', 'PENDING_APPROVAL', 'DRAFT']).toContain(r.status);
    }
    const outbox = await prisma.notificationOutbox.findMany({
      where: { notificationRecord: { caseId } },
    });
    for (const o of outbox.filter((x) => x.status === 'SUBMITTED')) {
      expect(o.deliveryStatus).toBe('CAPTURED');
      // The queue row still records the INTENDED recipient (masked, or a
      // capture channel), not the rehearsal mailbox: the queue records
      // intent and the audit records the diversion.
      expect(o.destinationMask).not.toContain(REHEARSAL);
      expect(o.destinationMask.length).toBeGreaterThan(0);
    }
  });

  it('goes back to normal the moment it is turned off', async () => {
    await setTestMode(manager.actor, { enabled: false, redirectTo: REHEARSAL });
    const caseId = await activeCase();
    await processOutbox(new Date());
    const captures = await prisma.notificationCapture.findMany({ where: { record: { caseId } } });
    expect(captures.length).toBeGreaterThan(0);
    for (const capture of captures) {
      expect(capture.subject.startsWith('[TEST MODE] ')).toBe(false);
      expect(capture.body).not.toContain('WAS INTERCEPTED');
    }
    expect(
      await prisma.auditEvent.count({
        where: { caseId, eventType: 'NOTIFICATION_REDIRECTED_TEST_MODE' },
      }),
    ).toBe(0);
  });
});
