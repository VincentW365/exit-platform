/**
 * Editable emails, immutable sent records, email PDFs and recipient
 * overrides on top of hierarchy auto-assignment (owner directive
 * 2026-09-23, DEC-069). Synthetic data only.
 *
 * What these tests protect:
 *
 *  - a generated email can be edited before it is handed to the outbox, and
 *    never afterwards; a correction is a separate message, and both stay;
 *  - the reporting manager resolved from the directory is the default, a
 *    per-message override never rewrites that relationship, the original is
 *    kept visibly, and Restore Auto-Assignment brings it back;
 *  - changing only the address keeps the person and touches no directory;
 *  - every override is audited with original and new, masked, no secrets;
 *  - the email PDF shows the recipient the message actually went to.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SEND_CONTROL, maskDestination } from '@exit/domain';
import { getPrisma } from '../src/client.ts';
import { LocalStorageAdapter, setStorageForTests } from '../src/storage.ts';
import { decryptValue } from '../src/secretBox.ts';
import { createDraft, transitionCase } from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import {
  getNotificationPreview,
  listCaseNotifications,
  notificationRecordPdf,
  overrideRecipient,
  overrideRecipientAddress,
  prepareCorrectedNotification,
  restoreAutoRecipient,
  searchRecipientChoices,
  transitionNotification,
  updateNotificationContent,
} from '../src/services/notificationService.ts';
import { processOutbox } from '../src/services/outboxService.ts';
import { listRevisions } from '../src/services/revisionService.ts';
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
let otherOfficer: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;

const DRAFT = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  confirmedLastDay: FIXTURE_CONFIRMED_LAST_DAY,
} as const;

async function activeCase(employeeSourceId: string) {
  const { caseId } = await createDraft(officer.actor, { ...DRAFT, employeeSourceId });
  await transitionCase(officer.actor, caseId, 'submit');
  await transitionCase(manager.actor, caseId, 'approve');
  await readyAssignment(caseId, manager.actor, officer.userId);
  await activateCase(manager.actor, caseId);
  return caseId;
}

/** The line manager notice: addressed to the directory manager by the hierarchy. */
async function managerNotice(caseId: string) {
  const record = await prisma.notificationRecord.findFirstOrThrow({
    where: { caseId, notificationType: 'LINE_MANAGER_HANDOVER' },
  });
  return record;
}

const auditOf = (caseId: string, eventType: string) =>
  prisma.auditEvent.findMany({ where: { caseId, eventType }, orderBy: { occurredAt: 'asc' } });

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  setStorageForTests(new LocalStorageAdapter(mkdtempSync(path.join(tmpdir(), 'exit-mail-'))));
  officer = await createUser('Mail Officer', 'HR_OFFICER');
  otherOfficer = await createUser('Mail Other Officer', 'HR_OFFICER');
  manager = await createUser('Mail Manager', 'HR_MANAGER');
  // The manager notice sends automatically by default. These tests need it
  // to wait in review, which is the audited configuration an HR Manager can
  // set under Administration - so the suite sets exactly that.
  await prisma.systemConfig.upsert({
    where: { key: 'notifications.sendControl' },
    create: {
      key: 'notifications.sendControl',
      value: { ...DEFAULT_SEND_CONTROL, LINE_MANAGER_HANDOVER: 'HR_REVIEW_THEN_SEND' },
      reason: 'Integration test: hold the manager notice for review.',
    },
    update: {
      value: { ...DEFAULT_SEND_CONTROL, LINE_MANAGER_HANDOVER: 'HR_REVIEW_THEN_SEND' },
    },
  });
});

describe('auto-assignment from the hierarchy', () => {
  it('addresses the manager notice to the directory manager and records why', async () => {
    const caseId = await activeCase('EMP-TEST-001');
    const record = await managerNotice(caseId);
    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    const directoryManager = await prisma.employeeSourceRecord.findUniqueOrThrow({
      where: {
        sourceSystem_sourceId: {
          sourceSystem: c.employeeSourceSystem,
          sourceId: c.managerSourceId!,
        },
      },
    });
    expect(record.autoDestinationKey).toBe('dynamic:EMPLOYEE_MANAGER');
    expect(record.autoRecipientName).toBe(directoryManager.displayName);
    expect(record.recipientOverride).toBeNull();
    expect(decryptValue(record.caseRecipientCiphertext!)).toBe(directoryManager.workEmail);

    const resolved = await auditOf(caseId, 'NOTIFICATION_RECIPIENT_RESOLVED');
    expect(resolved.length).toBeGreaterThan(0);
    expect(JSON.stringify(resolved)).not.toContain(directoryManager.workEmail);

    const view = await listCaseNotifications(officer.actor, caseId);
    const card = view.records.find((r) => r.id === record.id)!;
    expect(card.recipient.headline).toContain('reporting manager');
    expect(card.recipient.overrideKind).toBeNull();
  });
});

describe('recipient override', () => {
  it('sends one message to Manager B, keeps Manager A as the directory manager, and restores', async () => {
    const caseId = await activeCase('EMP-TEST-002');
    const record = await managerNotice(caseId);
    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    const managerA = c.managerSourceId!;
    const employee = await prisma.employeeSourceRecord.findUniqueOrThrow({
      where: {
        sourceSystem_sourceId: {
          sourceSystem: c.employeeSourceSystem,
          sourceId: c.employeeSourceId,
        },
      },
    });
    // Manager B: another directory person with an address.
    const managerB = await prisma.employeeSourceRecord.findFirstOrThrow({
      where: {
        sourceSystem: c.employeeSourceSystem,
        active: true,
        NOT: [{ sourceId: managerA }, { sourceId: c.employeeSourceId }, { workEmail: null }],
      },
      orderBy: { sourceId: 'asc' },
    });

    // The picker finds Manager B by name.
    const choices = await searchRecipientChoices(
      officer.actor,
      caseId,
      managerB.displayName.slice(0, 5),
    );
    expect(choices.some((ch) => ch.kind === 'DIRECTORY' && ch.id === managerB.sourceId)).toBe(true);
    expect(JSON.stringify(choices)).not.toContain(managerB.workEmail!);

    await overrideRecipient(officer.actor, record.id, {
      kind: 'DIRECTORY',
      id: managerB.sourceId,
      reason: 'Manager A is on leave.',
    });

    const after = await prisma.notificationRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(after.recipientOverride).toBe('RECIPIENT');
    expect(after.recipientName).toBe(managerB.displayName);
    expect(decryptValue(after.caseRecipientCiphertext!)).toBe(managerB.workEmail);
    // The original stays on the record...
    expect(after.autoRecipientName).toBe(record.autoRecipientName);
    expect(after.autoDestinationKey).toBe('dynamic:EMPLOYEE_MANAGER');
    // ...and the directory hierarchy is untouched.
    const employeeAfter = await prisma.employeeSourceRecord.findUniqueOrThrow({
      where: {
        sourceSystem_sourceId: {
          sourceSystem: c.employeeSourceSystem,
          sourceId: c.employeeSourceId,
        },
      },
    });
    expect(employeeAfter.managerSourceId).toBe(employee.managerSourceId);
    const caseAfter = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(caseAfter.managerSourceId).toBe(managerA);

    const overridden = await auditOf(caseId, 'NOTIFICATION_RECIPIENT_OVERRIDDEN');
    expect(overridden).toHaveLength(1);
    const meta = overridden[0]!.metadata as Record<string, unknown>;
    expect(meta['originalName']).toBe(record.autoRecipientName);
    expect(meta['newName']).toBe(managerB.displayName);
    expect(String(meta['newMask'])).toMatch(/\*/);
    expect(JSON.stringify(meta)).not.toContain(managerB.workEmail!);

    const view = await listCaseNotifications(officer.actor, caseId);
    const card = view.records.find((r) => r.id === record.id)!;
    expect(card.recipient.overrideKind).toBe('RECIPIENT');
    expect(card.recipient.headline).toContain('Recipient overridden');
    expect(card.recipient.auto?.name).toBe(record.autoRecipientName);

    // Restore brings back the hierarchy's answer without HR rediscovering it.
    await restoreAutoRecipient(officer.actor, record.id);
    const restored = await prisma.notificationRecord.findUniqueOrThrow({
      where: { id: record.id },
    });
    expect(restored.recipientOverride).toBeNull();
    expect(restored.recipientName).toBe(record.autoRecipientName);
    expect(decryptValue(restored.caseRecipientCiphertext!)).toBe(
      decryptValue(record.caseRecipientCiphertext!),
    );
    expect(await auditOf(caseId, 'NOTIFICATION_RECIPIENT_RESTORED')).toHaveLength(1);
  });

  it('changes only the address, keeps the person, and never writes the directory', async () => {
    const caseId = await activeCase('EMP-TEST-003');
    const record = await managerNotice(caseId);
    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    const directoryManager = await prisma.employeeSourceRecord.findUniqueOrThrow({
      where: {
        sourceSystem_sourceId: {
          sourceSystem: c.employeeSourceSystem,
          sourceId: c.managerSourceId!,
        },
      },
    });

    await overrideRecipientAddress(officer.actor, record.id, {
      email: 'alternate.mailbox@example.test',
      reason: 'Alternate mailbox requested.',
    });
    const after = await prisma.notificationRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(after.recipientOverride).toBe('ADDRESS');
    expect(after.recipientName).toBe(directoryManager.displayName);
    expect(decryptValue(after.caseRecipientCiphertext!)).toBe('alternate.mailbox@example.test');
    const directoryAfter = await prisma.employeeSourceRecord.findUniqueOrThrow({
      where: {
        sourceSystem_sourceId: {
          sourceSystem: c.employeeSourceSystem,
          sourceId: c.managerSourceId!,
        },
      },
    });
    expect(directoryAfter.workEmail).toBe(directoryManager.workEmail);
    const events = await auditOf(caseId, 'NOTIFICATION_RECIPIENT_ADDRESS_OVERRIDDEN');
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]!.metadata)).not.toContain('alternate.mailbox@example.test');

    // Release it: the outbox goes to the final address, and the record PDF says so.
    await transitionNotification(officer.actor, record.id, 'approve');
    await processOutbox(new Date());
    const outbox = await prisma.notificationOutbox.findFirstOrThrow({
      where: { notificationRecordId: record.id },
    });
    expect(outbox.destinationMask).toBe(maskDestination('alternate.mailbox@example.test'));
    expect(outbox.recipientConfigId).toBeNull();
    const pdf = await notificationRecordPdf(officer.actor, record.id);
    expect(pdf.bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.fileName).toContain('record');
  });

  it('accepts a manual recipient and lets a non-owning officer read but not change', async () => {
    const caseId = await activeCase('EMP-TEST-004');
    const record = await managerNotice(caseId);
    await expect(
      overrideRecipient(otherOfficer.actor, record.id, {
        kind: 'MANUAL',
        name: 'X',
        email: 'x@example.test',
      }),
    ).rejects.toThrow();
    await expect(restoreAutoRecipient(otherOfficer.actor, record.id)).rejects.toThrow();
    const view = await listCaseNotifications(otherOfficer.actor, caseId);
    expect(view.records.find((r) => r.id === record.id)!.recipientEditable).toBe(false);

    await overrideRecipient(officer.actor, record.id, {
      kind: 'MANUAL',
      name: 'Casey Manager',
      email: 'casey.manager@example.test',
    });
    expect(await auditOf(caseId, 'NOTIFICATION_RECIPIENT_MANUAL_ENTERED')).toHaveLength(1);
    await expect(
      overrideRecipient(officer.actor, record.id, {
        kind: 'MANUAL',
        name: 'Bad',
        email: 'not-an-address',
      }),
    ).rejects.toMatchObject({
      details: expect.arrayContaining([expect.stringMatching(/valid email/)]),
    });
  });
});

describe('editing an email', () => {
  it('lets HR change the subject and body before sending, keeping each save as a version', async () => {
    const caseId = await activeCase('EMP-TEST-005');
    const record = await managerNotice(caseId);
    expect(await listRevisions('EMAIL', record.id)).toMatchObject([{ kind: 'GENERATED' }]);

    const outcome = await updateNotificationContent(officer.actor, record.id, {
      subject: `${record.subjectSnapshot} - updated`,
      body: `${record.bodySnapshot}\n\nPlease also return the desk keys to reception.`,
      hrNote: 'Handover meeting booked for Thursday.',
    });
    expect(outcome).toMatchObject({ changed: true, revision: 2 });
    const after = await prisma.notificationRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(after.subjectSnapshot).toContain('updated');
    expect(after.bodySnapshot).toContain('desk keys');
    expect(after.hrNote).toContain('Thursday');
    expect(after.contentChecksum).not.toBe(record.contentChecksum);
    expect(await auditOf(caseId, 'NOTIFICATION_EDITED')).toHaveLength(1);

    const preview = await getNotificationPreview(officer.actor, record.id);
    expect(preview.html).toContain('desk keys');
    expect(preview.html).toContain('Thursday');
    expect(preview.to.address).toMatch(/@/);
    const pdf = await notificationRecordPdf(officer.actor, record.id);
    expect(pdf.fileName).toContain('preview');

    await expect(
      updateNotificationContent(officer.actor, record.id, { subject: '', body: '<b>x</b>' }),
    ).rejects.toMatchObject({
      details: expect.arrayContaining([expect.stringMatching(/subject cannot be empty/)]),
    });
  });

  it('makes a sent message immutable and puts a correction in a separate message', async () => {
    const caseId = await activeCase('EMP-TEST-006');
    const record = await managerNotice(caseId);
    await transitionNotification(officer.actor, record.id, 'approve');
    await expect(
      updateNotificationContent(officer.actor, record.id, { subject: 'late', body: 'late' }),
    ).rejects.toThrow(/already been queued or sent/i);
    await processOutbox(new Date());
    const sent = await prisma.notificationRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(sent.status).toBe('SENT');

    const copy = await prepareCorrectedNotification(
      officer.actor,
      record.id,
      'Wrong last day given.',
    );
    const corrected = await prisma.notificationRecord.findUniqueOrThrow({ where: { id: copy.id } });
    expect(corrected.correctsRecordId).toBe(record.id);
    expect(corrected.status).toBe('PENDING_APPROVAL');
    expect(corrected.controlLevel).toBe('HR_REVIEW_THEN_SEND');
    expect(corrected.bodySnapshot).toBe(sent.bodySnapshot);
    // The original is exactly as sent.
    const original = await prisma.notificationRecord.findUniqueOrThrow({
      where: { id: record.id },
    });
    expect(original.contentChecksum).toBe(sent.contentChecksum);
    expect(original.status).toBe('SENT');
    expect(await auditOf(caseId, 'NOTIFICATION_CORRECTION_PREPARED')).toHaveLength(1);
    expect(await listRevisions('EMAIL', copy.id)).toMatchObject([{ kind: 'CORRECTED' }]);

    // The corrected copy is editable and the sent one has a record PDF.
    await updateNotificationContent(officer.actor, copy.id, {
      subject: corrected.subjectSnapshot!,
      body: `${corrected.bodySnapshot}\n\nCorrection: the last day is Friday.`,
    });
    expect((await notificationRecordPdf(officer.actor, record.id)).fileName).toContain('record');
  });
});
