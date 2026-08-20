/**
 * Exit Checklist for Return Items (owner directive, 2026-08-19) end to end:
 * created at activation, requested by email with a secure link that opens the
 * form directly, completed without a login, and never able to report itself
 * clean while property is still owed.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { createDraft, transitionCase } from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import { processOutbox } from '../src/services/outboxService.ts';
import { runReport } from '../src/services/reportingService.ts';
import { getActionByToken, redeemActionToken } from '../src/services/ackTokenService.ts';
import { computeClearanceFacts } from '../src/services/clearanceService.ts';
import { evaluateClearance } from '@exit/domain';
import {
  getReturnItemsChecklist,
  recordReturnItemsChecklist,
  submitReturnItemsChecklist,
} from '../src/services/returnItemsService.ts';
import { RETURN_ITEM_CATALOGUE } from '@exit/domain';
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

/** The link in the captured email must open the FORM, not the ack page. */
function checklistTokenFromBody(body: string): string | undefined {
  return [...body.matchAll(/\/checklist\/([A-Za-z0-9_-]{43})/g)].map((m) => m[1]!)[0];
}

/** Every item answered, so only the named exceptions stay unresolved. */
function allItems(overrides: Record<string, { status: string; remarks?: string }> = {}) {
  return RETURN_ITEM_CATALOGUE.map((i) => ({
    itemKey: i.key,
    status: overrides[i.key]?.status ?? 'RETURNED',
    remarks: overrides[i.key]?.remarks,
  }));
}

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  officer = await createUser('Checklist Officer', 'HR_OFFICER');
  manager = await createUser('Checklist Manager', 'HR_MANAGER');
  lineMgr = await createUser('Checklist Line Manager', 'LINE_MANAGER');
});

describe('the checklist is created and requested automatically', () => {
  it('exists with the ten paper-form items as soon as the case activates', async () => {
    const caseId = await activeCase();
    const checklist = await getReturnItemsChecklist(officer.actor, caseId);
    expect(checklist).not.toBeNull();
    expect(checklist!.items).toHaveLength(RETURN_ITEM_CATALOGUE.length);
    expect(checklist!.items.map((i) => i.label)).toEqual(RETURN_ITEM_CATALOGUE.map((i) => i.label));
    expect(checklist!.status).toBe('NOT_STARTED');

    const action = await prisma.caseRequiredAction.findFirst({
      where: { caseId, actionKey: 'EMAIL:RETURN_ITEMS_CHECKLIST' },
    });
    expect(action?.ruleKey).toBe('RULE_RETURN_ITEMS_CHECKLIST_V1');
  });

  it('emails a link that opens this employee’s checklist directly, with no sign-in', async () => {
    const caseId = await activeCase();
    await processOutbox(new Date());

    const record = await prisma.notificationRecord.findFirst({
      where: { caseId, notificationType: 'RETURN_ITEMS_CHECKLIST' },
    });
    expect(record?.status).toBe('SENT');

    const capture = await prisma.notificationCapture.findFirst({
      where: { recordId: record!.id },
      orderBy: { capturedAt: 'desc' },
    });
    const token = checklistTokenFromBody(capture?.body ?? '');
    expect(token).toBeTruthy();

    // The link resolves to THIS case - the recipient never searches for it.
    const opened = await getActionByToken(token!);
    expect(opened?.purpose).toBe('COMPLETE_RETURN_CHECKLIST');
    expect(opened?.caseId).toBe(caseId);

    // Sending is recorded on the checklist itself, for the case view, and in
    // the audit trail with the recipient MASK rather than the address.
    const checklist = await getReturnItemsChecklist(officer.actor, caseId);
    expect(checklist!.sentAt).not.toBeNull();
    const sentAudit = await prisma.auditEvent.findFirst({
      where: { caseId, eventType: 'RETURN_CHECKLIST_SENT' },
    });
    expect(sentAudit).not.toBeNull();
    expect(JSON.stringify(sentAudit!.metadata)).not.toContain('@');

    // The stored body keeps the marker; only the outgoing copy has the token.
    expect(record!.bodySnapshot).not.toContain(token!);
  });
});

describe('completing the checklist through the secure link', () => {
  it('records every item, then spends the link', async () => {
    const caseId = await activeCase();
    await processOutbox(new Date());
    const record = await prisma.notificationRecord.findFirstOrThrow({
      where: { caseId, notificationType: 'RETURN_ITEMS_CHECKLIST' },
    });
    const capture = await prisma.notificationCapture.findFirstOrThrow({
      where: { recordId: record.id },
      orderBy: { capturedAt: 'desc' },
    });
    const token = checklistTokenFromBody(capture.body)!;

    const outcome = await submitReturnItemsChecklist(
      caseId,
      {
        items: allItems({ PHONE: { status: 'NOT_APPLICABLE' } }),
        receivedByName: 'Avery Brown',
        submittedByName: 'Avery Brown',
        employeeAcknowledgedBy: 'Jordan Clarke',
      },
      { via: 'TOKEN' },
    );
    expect(outcome.status).toBe('COMPLETED');
    expect(outcome.unresolvedCount).toBe(0);

    const checklist = await getReturnItemsChecklist(officer.actor, caseId);
    expect(checklist!.submittedAt).not.toBeNull();
    expect(checklist!.employeeAcknowledgedBy).toBe('Jordan Clarke');
    expect(checklist!.items.find((i) => i.itemKey === 'PHONE')!.status).toBe('NOT_APPLICABLE');

    // The link is single use.
    expect(await redeemActionToken(token)).not.toBeNull();
    expect(await getActionByToken(token)).toBeNull();
    expect(await redeemActionToken(token)).toBeNull();
  });

  it('keeps outstanding property visible after submission', async () => {
    const caseId = await activeCase();
    const outcome = await submitReturnItemsChecklist(
      caseId,
      {
        items: allItems({
          LAPTOP: { status: 'NOT_RETURNED', remarks: 'Employee will return it on Friday.' },
        }),
        receivedByName: 'Avery Brown',
        submittedByName: 'Avery Brown',
      },
      { via: 'TOKEN' },
    );
    expect(outcome.status).toBe('COMPLETED_WITH_OUTSTANDING');
    expect(outcome.unresolvedCount).toBe(1);

    const checklist = await getReturnItemsChecklist(officer.actor, caseId);
    expect(checklist!.status).not.toBe('COMPLETED');
    expect(checklist!.unresolved.map((i) => i.label)).toEqual(['Laptop']);

    // Outstanding property blocks clearance and names itself on the screen.
    const computed = await computeClearanceFacts(caseId);
    const blocking = evaluateClearance(computed!.facts).items.filter((i) => !i.ok);
    const item = blocking.find((i) => i.key === 'returnChecklist');
    expect(item?.detail).toContain('Laptop');
  });

  it('does not block clearance before the checklist comes back', async () => {
    const caseId = await activeCase();
    const computed = await computeClearanceFacts(caseId);
    const blocking = evaluateClearance(computed!.facts).items.filter((i) => !i.ok);
    // The asset recovery items already cover un-returned property; an
    // un-returned FORM must not double-gate the case.
    expect(blocking.map((i) => i.key)).not.toContain('returnChecklist');
  });

  it('refuses an incomplete form but keeps the work already entered', async () => {
    const caseId = await activeCase();
    const partial = allItems();
    partial[0]!.status = 'OUTSTANDING';

    await expect(
      submitReturnItemsChecklist(
        caseId,
        { items: partial, receivedByName: 'Avery Brown', submittedByName: 'Avery Brown' },
        { via: 'TOKEN' },
      ),
    ).rejects.toThrow();

    const checklist = await getReturnItemsChecklist(officer.actor, caseId);
    expect(checklist!.submittedAt).toBeNull();
    expect(checklist!.status).toBe('IN_PROGRESS');
    // The nine answered items survived the rejected submission.
    expect(checklist!.items.filter((i) => i.status === 'RETURNED')).toHaveLength(
      RETURN_ITEM_CATALOGUE.length - 1,
    );
  });

  it('requires a remark for anything not returned', async () => {
    const caseId = await activeCase();
    await expect(
      submitReturnItemsChecklist(
        caseId,
        {
          items: allItems({ UNIFORMS: { status: 'LOST_OR_DAMAGED' } }),
          receivedByName: 'Avery Brown',
          submittedByName: 'Avery Brown',
        },
        { via: 'TOKEN' },
      ),
    ).rejects.toThrow();
  });
});

describe('the checklist reports on itself', () => {
  it('measures what was requested, what came back, and what is still owed', async () => {
    const caseId = await activeCase();
    await processOutbox(new Date());
    await submitReturnItemsChecklist(
      caseId,
      {
        items: allItems({ PHONE: { status: 'NOT_RETURNED', remarks: 'Employee still has it.' } }),
        receivedByName: 'Avery Brown',
        submittedByName: 'Avery Brown',
      },
      { via: 'TOKEN' },
    );

    const report = await runReport(officer.actor, 'returnChecklist', { recordPurpose: 'TEST' });
    const value = (label: string) => report.rows.find((r) => r[0] === label)?.[1];
    expect(Number(value('Checklists created'))).toBeGreaterThan(0);
    expect(Number(value('Requested by email'))).toBeGreaterThan(0);
    expect(Number(value('Completed'))).toBeGreaterThan(0);
    expect(String(value('Return rate (of those requested)'))).toMatch(/%$/);
    expect(Number(value('Items still owed (not returned or lost/damaged)'))).toBeGreaterThan(0);
    // A checklist with property still owed never counts as plain COMPLETED.
    expect(value('Status: COMPLETED_WITH_OUTSTANDING')).toBeDefined();
  });
});

describe('HR can record and correct the checklist', () => {
  it('records it against the officer and audits a correction as a correction', async () => {
    const caseId = await activeCase();
    await recordReturnItemsChecklist(officer.actor, caseId, {
      items: allItems(),
      receivedByName: 'Avery Brown',
      submittedByName: 'Checklist Officer',
    });
    let audits = await prisma.auditEvent.findMany({
      where: { caseId, eventType: 'RETURN_CHECKLIST_SUBMITTED' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(officer.userId);

    await recordReturnItemsChecklist(officer.actor, caseId, {
      items: allItems({ DESK: { status: 'RETURNED' } }),
      receivedByName: 'Avery Brown',
      submittedByName: 'Checklist Officer',
    });
    audits = await prisma.auditEvent.findMany({
      where: { caseId, eventType: 'RETURN_CHECKLIST_CORRECTED' },
    });
    expect(audits).toHaveLength(1);
  });

  it('refuses anyone without asset management rights', async () => {
    const caseId = await activeCase();
    const other = await createUser('Checklist Line Manager 2', 'LINE_MANAGER');
    await expect(
      recordReturnItemsChecklist(other.actor, caseId, {
        items: allItems(),
        receivedByName: 'Avery Brown',
        submittedByName: 'Checklist Line Manager 2',
      }),
    ).rejects.toThrow();
  });
});
