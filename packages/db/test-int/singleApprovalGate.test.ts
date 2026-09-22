/**
 * Single authorization gate (owner directive 2026-09-22, DEC-066).
 *
 * The HR Manager approves the offboarding case ONCE. That approval - taken
 * on a summary that shows the benefits selected at intake, who will be
 * contacted, and which documents and forms the case will produce -
 * authorizes the assigned HR Officer to execute the whole downstream
 * workflow: finalize and send documents, complete forms, release provider
 * and employee-facing notifications. No second manager approval exists; a
 * non-owning officer can read the case but never execute it; the manager
 * keeps every intervention. Synthetic data only.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { RESIGNATION_ACCEPTANCE_LETTER_BODY } from '@exit/domain';
import { getPrisma } from '../src/client.ts';
import { LocalStorageAdapter, setStorageForTests } from '../src/storage.ts';
import { activateTemplate, createDraftTemplate } from '../src/services/templateService.ts';
import {
  changeEffectiveTime,
  createDraft,
  getCase,
  transitionCase,
  updateDraft,
} from '../src/services/caseService.ts';
import { getCaseApprovalSummary } from '../src/services/caseApprovalService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import { confirmBenefits } from '../src/services/derivedActionService.ts';
import {
  createLetterDraft,
  finalizeDocument,
  refreshDraftFields,
  supersedeAndRecreate,
  voidDocument,
} from '../src/services/documentService.ts';
import { issueDocumentByEmail, setEmployeeAddress } from '../src/services/letterDeliveryService.ts';
import {
  listCaseNotifications,
  transitionNotification,
} from '../src/services/notificationService.ts';
import {
  completeActionForm,
  createActionForm,
  submitActionForm,
  updateActionFormHr,
} from '../src/services/actionFormService.ts';
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
let lineMgr: Awaited<ReturnType<typeof createUser>>;

const DAY = 86_400_000;
const DRAFT = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  confirmedLastDay: FIXTURE_CONFIRMED_LAST_DAY,
} as const;
/** Dates in the past so employer-initiated notifications are due at once. */
const HISTORICAL = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  receivedAt: new Date(Date.now() - 26 * DAY).toISOString(),
  confirmedLastDay: new Date(Date.now() - 15 * DAY).toISOString(),
  effectiveSeparationAt: new Date(Date.now() - 14 * DAY).toISOString(),
} as const;
const HR_CHECKLIST = {
  caseInfoVerified: 'DONE',
  evidenceRecorded: 'DONE',
  contactVerified: 'DONE',
  benefitsInitiated: 'DONE',
  propertyProcessInitiated: 'DONE',
  accessRemovalRecorded: 'DONE',
  surveyEligibilityAssessed: 'DONE',
  hrisUpdate: 'DONE',
} as const;

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  setStorageForTests(new LocalStorageAdapter(mkdtempSync(path.join(tmpdir(), 'exit-gate-'))));
  officer = await createUser('Gate Officer', 'HR_OFFICER');
  otherOfficer = await createUser('Gate Other Officer', 'HR_OFFICER');
  manager = await createUser('Gate Manager', 'HR_MANAGER');
  lineMgr = await createUser('Gate Line Manager');
  for (const documentType of [
    'RESIGNATION_ACCEPTANCE_WITH_NOTICE',
    'IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT',
  ] as const) {
    const t = await createDraftTemplate(officer.actor, {
      documentType,
      name: `Gate template ${documentType}`,
      contentBody: RESIGNATION_ACCEPTANCE_LETTER_BODY,
    });
    await activateTemplate(manager.actor, t.id);
  }
});

const auditOf = (caseId: string, eventType: string) =>
  prisma.auditEvent.findMany({ where: { caseId, eventType }, orderBy: { occurredAt: 'asc' } });

describe('draft: benefits are selected at intake and correctable while drafting', () => {
  it('persists the intake selection on the draft, audited, and the officer or manager can correct it', async () => {
    const { caseId } = await createDraft(officer.actor, {
      ...DRAFT,
      employeeSourceId: 'EMP-TEST-001',
      groupHealth: 'YES',
      groupLife: 'NO',
    });
    const row = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.groupHealthApplicability).toBe('YES');
    expect(row.groupLifeApplicability).toBe('NO');
    expect(row.benefitsSource).toBe('INTAKE');
    expect(row.benefitsConfirmedById).toBe(officer.userId);
    const set = await auditOf(caseId, 'BENEFITS_APPLICABILITY_SET');
    expect(set).toHaveLength(1);
    expect((set[0]!.metadata as Record<string, unknown>)['source']).toBe('INTAKE');

    // Draft correction from the edit experience: the owning officer...
    await updateDraft(officer.actor, caseId, { groupLife: 'YES' });
    // ...and the HR Manager, who edits every draft.
    await updateDraft(manager.actor, caseId, { groupHealth: 'NO' });
    const after = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(after.groupHealthApplicability).toBe('NO');
    expect(after.groupLifeApplicability).toBe('YES');
    expect(await auditOf(caseId, 'BENEFITS_APPLICABILITY_SET')).toHaveLength(3);
    // Another officer cannot touch the draft at all (DEC-065).
    await expect(
      updateDraft(otherOfficer.actor, caseId, { groupLife: 'NO' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a case created without the intake step keeps the historical UNKNOWN default', async () => {
    const { caseId } = await createDraft(officer.actor, {
      ...DRAFT,
      employeeSourceId: 'EMP-TEST-002',
    });
    const row = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.groupHealthApplicability).toBe('UNKNOWN');
    expect(row.benefitsSource).toBeNull();
  });

  it('the HR Manager may name the executing officer at creation; an officer may not', async () => {
    const { caseId } = await createDraft(manager.actor, {
      ...DRAFT,
      employeeSourceId: 'EMP-TEST-004',
      assignedOfficerId: officer.userId,
    });
    const row = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.assignedOfficerId).toBe(officer.userId);
    expect(row.createdById).toBe(manager.userId);
    const assigned = await auditOf(caseId, 'CASE_OFFICER_ASSIGNED');
    expect(assigned).toHaveLength(1);
    expect((assigned[0]!.metadata as Record<string, unknown>)['automatic']).toBe(false);
    expect(await prisma.caseParticipant.count({ where: { caseId, userId: officer.userId } })).toBe(
      1,
    );
    await expect(
      createDraft(officer.actor, {
        ...DRAFT,
        employeeSourceId: 'EMP-TEST-005',
        assignedOfficerId: otherOfficer.userId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('pending approval: one HR Manager decision, taken on a complete summary', () => {
  let caseId: string;

  it('the officer submits and cannot approve; the selection becomes an approved fact', async () => {
    const created = await createDraft(officer.actor, {
      ...DRAFT,
      employeeSourceId: 'EMP-TEST-001',
      groupHealth: 'YES',
      groupLife: 'NO',
    });
    caseId = created.caseId;
    await transitionCase(officer.actor, caseId, 'submit');
    await expect(transitionCase(officer.actor, caseId, 'approve')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // Submitted: the officer can no longer re-plan the benefits.
    await expect(
      confirmBenefits(officer.actor, caseId, {
        groupHealth: 'NO',
        groupLife: 'NO',
        otherProvider: 'NO',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const submitted = await auditOf(caseId, 'CASE_SUBMITTED');
    const meta = submitted[0]!.metadata as Record<string, unknown>;
    expect(meta['groupHealth']).toBe('YES');
    expect(meta['assignedOfficerId']).toBe(officer.userId);
    expect(meta['caseVersion']).toBeTypeOf('number');
  });

  it('the summary names every audience with its resolved destination and readiness (section 16-19, 38)', async () => {
    const s = await getCaseApprovalSummary(manager.actor, caseId);
    expect(s.status).toBe('PENDING_HR_REVIEW');
    expect(s.capabilities.canApprove).toBe(true);
    expect(s.capabilities.seesFullAddresses).toBe(true);
    expect(s.ownership.assignedOfficerName).toBe('Gate Officer');
    expect(s.ownership.createdByName).toBe('Gate Officer');
    expect(s.ownership.submittedByName).toBe('Gate Officer');
    expect(s.benefits.groupHealth).toBe('YES');
    expect(s.benefits.source).toBe('INTAKE');

    const byAudience = Object.fromEntries(s.communications.groups.map((g) => [g.audience, g]));
    // Employee: the letter and the survey invitation, addressed to the case email.
    const employee = byAudience['EMPLOYEE']!;
    expect(employee.readiness).toBe('READY');
    const letter = employee.items.find((i) => i.key === 'LETTER:ACCEPTANCE')!;
    expect(letter.applicable).toBe(true);
    expect(letter.to?.address).toBe('avery.brown@example.test');
    expect(letter.to?.source).toBe('CASE');
    // Reporting manager: from the directory.
    const mgr = byAudience['MANAGER']!;
    expect(mgr.items.some((i) => i.notificationType === 'LINE_MANAGER_HANDOVER')).toBe(true);
    expect(mgr.readiness).toBe('READY');
    expect(mgr.items[0]!.to?.source).toBe('DIRECTORY');
    // IT and Finance: configured department mailboxes.
    expect(byAudience['IT']!.readiness).toBe('READY');
    expect(byAudience['IT']!.items[0]!.to?.source).toBe('CONFIGURATION');
    expect(byAudience['FINANCE']!.readiness).toBe('READY');
    // HR receives the return-items checklist.
    expect(
      byAudience['HR']!.items.some((i) => i.notificationType === 'RETURN_ITEMS_CHECKLIST'),
    ).toBe(true);
    // Providers: exactly what was selected - group health included, group life not required.
    const providers = byAudience['PROVIDERS']!;
    const health = providers.items.find(
      (i) => i.notificationType === 'SAGICOR_GROUP_HEALTH_REMOVAL',
    )!;
    const life = providers.items.find((i) => i.notificationType === 'NCB_GROUP_LIFE_REMOVAL')!;
    expect(health.applicable).toBe(true);
    expect(health.readiness).toBe('READY');
    expect(life.applicable).toBe(false);
    expect(life.readiness).toBe('NOT_REQUIRED');
    expect(s.communications.missingRecipients).toBe(0);

    // Documents and forms: the plan the approval covers.
    const artifacts = Object.fromEntries(s.artifacts.map((a) => [a.key, a.applicable]));
    expect(artifacts['LETTER']).toBe(true);
    expect(artifacts['ACTION_FORM']).toBe(true);
    expect(artifacts['RETURN_ITEMS']).toBe(true);
    expect(artifacts['GROUP_HEALTH']).toBe(true);
    expect(artifacts['GROUP_LIFE']).toBe(false);
    // The workflow that will run carries no duplicate manager-approval task.
    expect(s.workflow.definitionVersion).toBeGreaterThanOrEqual(3);
    expect(s.workflow.hrTaskCount).toBeGreaterThan(0);
  });

  it('the officer reads the same summary with masked addresses and no decision (section 38)', async () => {
    const s = await getCaseApprovalSummary(officer.actor, caseId);
    expect(s.capabilities.seesFullAddresses).toBe(false);
    expect(s.capabilities.canApprove).toBe(false);
    const letter = s.communications.groups
      .flatMap((g) => g.items)
      .find((i) => i.key === 'LETTER:ACCEPTANCE')!;
    expect(letter.to?.address).not.toBe('avery.brown@example.test');
    expect(letter.to?.address).toContain('*');
    // A non-owning officer reads it too - view-only is still a view.
    const other = await getCaseApprovalSummary(otherOfficer.actor, caseId);
    expect(other.capabilities.canApprove).toBe(false);
  });

  it('a missing department recipient is an understandable readiness state, never a silent gap', async () => {
    await prisma.recipientConfig.updateMany({
      where: { recipientClass: 'IT_OFFBOARDING' },
      data: { active: false },
    });
    try {
      const s = await getCaseApprovalSummary(manager.actor, caseId);
      const it_ = s.communications.groups.find((g) => g.audience === 'IT')!;
      expect(it_.readiness).toBe('MISSING_RECIPIENT');
      expect(it_.items[0]!.to).toBeNull();
      expect(it_.items[0]!.unresolved.length).toBeGreaterThan(0);
      expect(s.communications.missingRecipients).toBeGreaterThanOrEqual(1);
      // Approval is not blocked by it (existing rule: exceptions at activation).
      expect(s.capabilities.canApprove).toBe(true);
    } finally {
      await prisma.recipientConfig.updateMany({
        where: { recipientClass: 'IT_OFFBOARDING' },
        data: { active: true },
      });
    }
  });

  it('the HR Manager may amend the approved benefits selection - audited as a post-approval amendment', async () => {
    await confirmBenefits(manager.actor, caseId, {
      groupHealth: 'YES',
      groupLife: 'YES',
      otherProvider: 'NO',
    });
    const events = await auditOf(caseId, 'BENEFITS_APPLICABILITY_SET');
    const last = events[events.length - 1]!.metadata as Record<string, unknown>;
    expect(last['postApprovalAmendment']).toBe(true);
    expect(last['previousGroupLife']).toBe('NO');
    expect(last['groupLife']).toBe('YES');
    expect(events[events.length - 1]!.actorId).toBe(manager.userId);
  });

  it('return to draft carries the reason to the officer; nothing finalizes while returned', async () => {
    const created = await createDraft(officer.actor, {
      ...DRAFT,
      employeeSourceId: 'EMP-TEST-002',
      groupHealth: 'NO',
      groupLife: 'NO',
    });
    await transitionCase(officer.actor, created.caseId, 'submit');
    await transitionCase(manager.actor, created.caseId, 'return', 'Check the last working day.');
    const view = await getCase(officer.actor, created.caseId);
    expect(view.case.status).toBe('DRAFT');
    expect(view.lastReturn?.reason).toBe('Check the last working day.');
    expect(view.lastReturn?.returnedById).toBe(manager.userId);
    await setEmployeeAddress(officer.actor, created.caseId, {
      employeeAddress: '12 Synthetic Avenue, Kingston 5',
    });
    const draft = await createLetterDraft(officer.actor, created.caseId);
    await expect(finalizeDocument(officer.actor, draft.id)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const returned = await auditOf(created.caseId, 'CASE_RETURNED_TO_DRAFT');
    expect((returned[0]!.metadata as Record<string, unknown>)['reason']).toBe(
      'Check the last working day.',
    );
  });

  it('approval is audited with the approved version and snapshot; the case becomes executable', async () => {
    await transitionCase(manager.actor, caseId, 'approve');
    const approved = await auditOf(caseId, 'CASE_APPROVED');
    const meta = approved[0]!.metadata as Record<string, unknown>;
    expect(meta['snapshotChecksum']).toMatch(/^[a-f0-9]{64}$/);
    expect(meta['groupHealth']).toBe('YES');
    expect(meta['groupLife']).toBe('YES');
    expect(meta['assignedOfficerId']).toBe(officer.userId);
    const view = await getCase(officer.actor, caseId);
    expect(view.case.status).toBe('APPROVED');
    expect(view.lastReturn).toBeNull();
  });

  describe('after approval: the assigned officer executes the whole plan; nobody else does', () => {
    it('resignation with notice: letter finalized and sent, form completed, provider notice released - no manager step', async () => {
      await readyAssignment(caseId, manager.actor, officer.userId, lineMgr.userId);
      // Activation is the officer's own work (case.activate is edit authority).
      await activateCase(officer.actor, caseId);

      // Letter: draft -> finalize -> issue by email, all by the officer.
      await setEmployeeAddress(officer.actor, caseId, {
        employeeAddress: '12 Synthetic Avenue, Kingston 5',
      });
      const doc = await createLetterDraft(officer.actor, caseId);
      await refreshDraftFields(officer.actor, doc.id);
      await finalizeDocument(officer.actor, doc.id);
      const rendered = await prisma.documentInstance.findUniqueOrThrow({ where: { id: doc.id } });
      expect(rendered.status).toBe('RENDERED');
      const outcome = await issueDocumentByEmail(officer.actor, doc.id, { ccIds: [] });
      expect(outcome.destinationMask).toContain('*');
      const issued = await prisma.documentInstance.findUniqueOrThrow({ where: { id: doc.id } });
      expect(issued.status).toBe('ISSUED_BY_EMAIL');
      expect(issued.issuedById).toBe(officer.userId);
      expect(await auditOf(caseId, 'DOC_APPROVED')).toHaveLength(0);
      expect(await auditOf(caseId, 'DOC_FINALIZED')).toHaveLength(1);
      expect(await auditOf(caseId, 'DOC_ISSUED_BY_EMAIL')).toHaveLength(1);

      // Form: prepared, finished and completed by the officer.
      const form = await createActionForm(officer.actor, caseId);
      await updateActionFormHr(officer.actor, form.id, {
        hrChecklist: HR_CHECKLIST,
        ackStatus: 'NOT_OBTAINED',
        ackReason: 'Acknowledgement not obtainable in this synthetic scenario.',
      });
      await submitActionForm(officer.actor, form.id);
      await completeActionForm(officer.actor, form.id);

      // Provider communication: the officer releases it under the case approval.
      const list = await listCaseNotifications(officer.actor, caseId);
      expect(list.canApproveInternal).toBe(true);
      const health = list.records.find(
        (r) => r.notificationType === 'SAGICOR_GROUP_HEALTH_REMOVAL',
      );
      expect(health).toBeDefined();
      expect(health!.status).toBe('PENDING_APPROVAL');
      await transitionNotification(officer.actor, health!.id, 'approve');
      const released = await prisma.notificationRecord.findUniqueOrThrow({
        where: { id: health!.id },
      });
      expect(released.status).toBe('APPROVED');
      expect(released.approvedById).toBe(officer.userId);
    });

    it('another HR Officer can view the approved case but cannot execute it', async () => {
      const view = await getCase(otherOfficer.actor, caseId);
      expect(view.capabilities.canEdit).toBe(false);
      const list = await listCaseNotifications(otherOfficer.actor, caseId);
      expect(list.canApproveInternal).toBe(false);
      const life = list.records.find((r) => r.notificationType === 'NCB_GROUP_LIFE_REMOVAL')!;
      await expect(
        transitionNotification(otherOfficer.actor, life.id, 'approve'),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(createLetterDraft(otherOfficer.actor, caseId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('the HR Manager still intervenes: corrects the case, supersedes and voids documents', async () => {
      // A material correction supersedes the finalized-but-unissued work and
      // invalidates its attestation; issued documents are never touched.
      const issuedBefore = await prisma.documentInstance.findFirstOrThrow({
        where: { caseId, status: 'ISSUED_BY_EMAIL' },
      });
      await changeEffectiveTime(
        manager.actor,
        caseId,
        new Date(Date.now() + 6 * DAY),
        'Employee agreed a later date.',
      );
      const issuedAfter = await prisma.documentInstance.findUniqueOrThrow({
        where: { id: issuedBefore.id },
      });
      expect(issuedAfter.status).toBe('ISSUED_BY_EMAIL');
      // The manager opens a corrected version and can finalize it themselves.
      const replacement = await supersedeAndRecreate(
        manager.actor,
        issuedBefore.id,
        'Corrected letter after the date change.',
      );
      await refreshDraftFields(manager.actor, replacement.id);
      await finalizeDocument(manager.actor, replacement.id);
      const done = await prisma.documentInstance.findUniqueOrThrow({
        where: { id: replacement.id },
      });
      expect(done.status).toBe('RENDERED');
      await voidDocument(manager.actor, replacement.id, 'Intervention: not needed after all.');
      expect(
        (await prisma.documentInstance.findUniqueOrThrow({ where: { id: replacement.id } })).status,
      ).toBe('VOIDED');
    });
  });
});

describe('the same rule on every separation path (section 37)', () => {
  it('immediate resignation: officer finalizes the acknowledgement under the case approval', async () => {
    const { caseId } = await createDraft(officer.actor, {
      ...DRAFT,
      employeeSourceId: 'EMP-TEST-005',
      departureType: 'IMMEDIATE_RESIGNATION',
      confirmedLastDay: DRAFT.effectiveSeparationAt,
      groupHealth: 'NO',
      groupLife: 'NO',
    });
    await transitionCase(officer.actor, caseId, 'submit');
    const s = await getCaseApprovalSummary(manager.actor, caseId);
    expect(s.artifacts.find((a) => a.key === 'LETTER')?.title).toContain('Immediate');
    expect(s.artifacts.find((a) => a.key === 'GROUP_HEALTH')?.applicable).toBe(false);
    await transitionCase(manager.actor, caseId, 'approve');
    await readyAssignment(caseId, manager.actor, officer.userId, lineMgr.userId);
    await activateCase(officer.actor, caseId);
    await setEmployeeAddress(officer.actor, caseId, {
      employeeAddress: '12 Synthetic Avenue, Kingston 5',
    });
    const doc = await createLetterDraft(officer.actor, caseId);
    await refreshDraftFields(officer.actor, doc.id);
    await finalizeDocument(officer.actor, doc.id);
    expect(
      (await prisma.documentInstance.findUniqueOrThrow({ where: { id: doc.id } })).status,
    ).toBe('RENDERED');
    expect(await auditOf(caseId, 'DOC_APPROVED')).toHaveLength(0);
  });

  it('termination (restricted): no letter, no duplicate authorization task, and the assigned officer releases the held IT notice', async () => {
    const { caseId } = await createDraft(manager.actor, {
      ...HISTORICAL,
      employeeSourceId: 'EMP-TEST-003',
      departureType: 'TERMINATION',
      confirmedLastDay: HISTORICAL.effectiveSeparationAt,
      groupHealth: 'YES',
      groupLife: 'NO',
      assignedOfficerId: officer.userId,
    });
    await transitionCase(manager.actor, caseId, 'submit');
    const s = await getCaseApprovalSummary(manager.actor, caseId);
    expect(s.artifacts.find((a) => a.key === 'LETTER')?.applicable).toBe(false);
    expect(s.workflow.definitionVersion).toBe(4);
    await transitionCase(manager.actor, caseId, 'approve');
    await readyAssignment(caseId, manager.actor, officer.userId, lineMgr.userId);
    await activateCase(officer.actor, caseId);

    const tasks = await prisma.workflowTask.findMany({ where: { caseId } });
    expect(tasks.some((t) => t.taskCode === 'HRM_AUTHORIZATION')).toBe(false);
    expect(tasks.some((t) => t.taskCode === 'HR_RESTRICTED_PREP')).toBe(true);

    // Restricted timing control: the IT notice waits for a human release -
    // and since DEC-066 that human is the assigned officer, not the manager.
    const list = await listCaseNotifications(officer.actor, caseId);
    const it_ = list.records.find((r) => r.notificationType === 'IT_ACCESS_REMOVAL')!;
    expect(it_.status).toBe('PENDING_APPROVAL');
    expect(it_.controlLevel).toBe('HR_REVIEW_THEN_SEND');
    await transitionNotification(officer.actor, it_.id, 'approve');
    expect(
      (await prisma.notificationRecord.findUniqueOrThrow({ where: { id: it_.id } })).status,
    ).toBe('APPROVED');
    // The provider notice selected at intake is released the same way.
    const health = list.records.find((r) => r.notificationType === 'SAGICOR_GROUP_HEALTH_REMOVAL')!;
    await transitionNotification(officer.actor, health.id, 'approve');
    // A non-participant officer cannot even see the restricted case.
    await expect(getCase(otherOfficer.actor, caseId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
