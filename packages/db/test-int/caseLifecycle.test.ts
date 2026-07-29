/**
 * Case lifecycle integration: create -> submit -> approve with immutable
 * snapshot, history and audit in one transaction; corrections; void/cancel;
 * optimistic concurrency (Architecture.md section 8).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import {
  changeEffectiveTime,
  correctRecordPurpose,
  createDraft,
  getCase,
  transitionCase,
  updateDraft,
} from '../src/services/caseService.ts';
import type { ServiceError } from '../src/errors.ts';
import { createUser, resetDb, VALID_DRAFT } from './helpers.ts';

const prisma = getPrisma();

let officer: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  await resetDb();
  officer = await createUser('Riley Officer', 'HR_OFFICER');
  manager = await createUser('Dana Manager', 'HR_MANAGER');
});

describe('happy path: create -> submit -> approve', () => {
  let caseId: string;

  it('creates a DRAFT with owner participation, history and audit', async () => {
    const created = await createDraft(officer.actor, VALID_DRAFT);
    caseId = created.caseId;
    expect(created.caseNumber).toMatch(/^OFF-\d{4}-\d{4}$/);

    const participants = await prisma.caseParticipant.findMany({ where: { caseId } });
    expect(participants).toHaveLength(1);
    expect(participants[0]!.participantRole).toBe('OWNER');

    const history = await prisma.caseStatusHistory.findMany({ where: { caseId } });
    expect(history.map((h) => h.toStatus)).toEqual(['DRAFT']);

    const audit = await prisma.auditEvent.findMany({ where: { caseId } });
    expect(audit.map((a) => a.eventType)).toContain('CASE_CREATED');
  });

  it('submit requires readiness and moves to PENDING_HR_REVIEW', async () => {
    await transitionCase(officer.actor, caseId, 'submit');
    const { case: c } = await getCase(officer.actor, caseId);
    expect(c.status).toBe('PENDING_HR_REVIEW');
  });

  it('officer cannot approve; manager approval captures the snapshot exactly once', async () => {
    await expect(transitionCase(officer.actor, caseId, 'approve')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    await transitionCase(manager.actor, caseId, 'approve');
    const { case: c } = await getCase(manager.actor, caseId);
    expect(c.status).toBe('APPROVED');

    const snapshot = await prisma.employeeSnapshot.findUnique({ where: { caseId } });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot!.sourceId).toBe('EMP-TEST-001');

    const history = await prisma.caseStatusHistory.findMany({
      where: { caseId },
      orderBy: { occurredAt: 'asc' },
    });
    expect(history.map((h) => h.toStatus)).toEqual(['DRAFT', 'PENDING_HR_REVIEW', 'APPROVED']);
  });

  it('editing is refused after DRAFT; corrections are audited instead', async () => {
    await expect(
      updateDraft(officer.actor, caseId, { department: 'Warehouse' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const newTime = new Date('2026-08-21T22:00:00.000Z');
    await changeEffectiveTime(manager.actor, caseId, newTime, 'Employee agreed a later last day.');
    const { case: c } = await getCase(manager.actor, caseId);
    expect(c.effectiveSeparationAt?.toISOString()).toBe(newTime.toISOString());

    const audit = await prisma.auditEvent.findFirst({
      where: { caseId, eventType: 'CASE_EFFECTIVE_TIME_CHANGED' },
    });
    expect(audit).not.toBeNull();
    const meta = audit!.metadata as Record<string, unknown>;
    expect(meta['oldValue']).toBe('2026-08-14T22:00:00.000Z');
    expect(meta['newValue']).toBe(newTime.toISOString());
  });
});

describe('validation and state guards', () => {
  it('submit is blocked when required intake fields are missing', async () => {
    const { caseId } = await createDraft(officer.actor, {
      ...VALID_DRAFT,
      employeeSourceId: 'EMP-TEST-002',
      effectiveSeparationAt: null,
    });
    await expect(transitionCase(officer.actor, caseId, 'submit')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('void requires a reason and closes the case', async () => {
    const { caseId } = await createDraft(officer.actor, {
      ...VALID_DRAFT,
      employeeSourceId: 'EMP-TEST-004',
    });
    await expect(transitionCase(manager.actor, caseId, 'void')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await transitionCase(manager.actor, caseId, 'void', 'Duplicate entry.');
    const { case: c } = await getCase(manager.actor, caseId);
    expect(c.status).toBe('VOIDED');
    expect(c.closeReason).toBe('Duplicate entry.');
  });

  it('record purpose corrections: allowed in DRAFT with reason, refused after', async () => {
    const { caseId } = await createDraft(officer.actor, {
      ...VALID_DRAFT,
      employeeSourceId: 'EMP-TEST-005',
      measurementCohort: null,
      recordPurpose: 'TEST',
    });
    await correctRecordPurpose(manager.actor, caseId, 'OPERATIONAL', 'Was a real case.');
    const { case: c } = await getCase(manager.actor, caseId);
    expect(c.recordPurpose).toBe('OPERATIONAL');
    expect(c.measurementCohort).toBe('BASELINE');

    await transitionCase(officer.actor, caseId, 'submit');
    await expect(
      correctRecordPurpose(manager.actor, caseId, 'TEST', 'trying to hide it'),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('optimistic concurrency: one of two racing approvals loses cleanly', async () => {
    const { caseId } = await createDraft(officer.actor, {
      ...VALID_DRAFT,
      employeeSourceId: 'EMP-TEST-002',
    });
    await transitionCase(officer.actor, caseId, 'submit');
    const results = await Promise.allSettled([
      transitionCase(manager.actor, caseId, 'approve'),
      transitionCase(manager.actor, caseId, 'approve'),
    ]);
    const failed = results.filter((r) => r.status === 'rejected');
    expect(failed.length).toBe(1);
    const err = (failed[0] as PromiseRejectedResult).reason as ServiceError;
    expect(['CONFLICT', 'VALIDATION']).toContain(err.code);
    // Exactly one snapshot regardless of the race.
    expect(await prisma.employeeSnapshot.count({ where: { caseId } })).toBe(1);
  });
});
