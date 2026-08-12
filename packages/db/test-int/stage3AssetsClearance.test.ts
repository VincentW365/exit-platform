/**
 * Stage 3 integration: assets, handover, clearance gate and full completion
 * (Directive 3 T.12-T.22, T.24).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { LocalStorageAdapter, setStorageForTests } from '../src/storage.ts';
import { createDraft, transitionCase } from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import { completeAccessTask, completeTask, reassignTask } from '../src/services/taskService.ts';
import {
  addAssetRecoveryItem,
  listCaseAssets,
  setAssetDisposition,
} from '../src/services/assetService.ts';
import {
  getHandover,
  transitionHandover,
  updateHandover,
} from '../src/services/handoverService.ts';
import {
  approveFinalClearance,
  getClearanceView,
  requestClearance,
} from '../src/services/clearanceService.ts';
import { resolveException } from '../src/services/exceptionService.ts';
import { activateTemplate, createDraftTemplate } from '../src/services/templateService.ts';
import {
  approveDocument,
  createLetterDraft,
  submitDocument,
} from '../src/services/documentService.ts';
import {
  createActionForm,
  hrApproveForm,
  managerApproveForm,
  submitActionForm,
  updateActionFormHr,
} from '../src/services/actionFormService.ts';
import { stage3Dashboard } from '../src/services/dashboardService.ts';
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
let itUser: Awaited<ReturnType<typeof createUser>>;
let finUser: Awaited<ReturnType<typeof createUser>>;
let lineMgr: Awaited<ReturnType<typeof createUser>>;

const TEST_DRAFT = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  confirmedLastDay: '2026-08-14T00:00:00.000Z',
} as const;

const NOTICE_BODY = `DEVELOPMENT TEMPLATE - REQUIRES HR APPROVAL BEFORE OPERATIONAL USE

Dear [[EMPLOYEE_LEGAL_NAME]],

We acknowledge your resignation of [[RESIGNATION_RECEIVED_DATE]] (case [[CASE_REFERENCE]]).
Your last working day is [[CONFIRMED_LAST_WORKING_DATE]]; employment ends [[EFFECTIVE_SEPARATION_DATE]].

[[HR_APPROVER_NAME]]
[[HR_APPROVER_TITLE]]`;

async function makeActiveCase(overrides: Record<string, unknown> = {}): Promise<string> {
  const created = await createDraft(officer.actor, { ...TEST_DRAFT, ...overrides });
  await transitionCase(officer.actor, created.caseId, 'submit');
  await transitionCase(manager.actor, created.caseId, 'approve');
  await readyAssignment(created.caseId, manager.actor, officer.userId, lineMgr.userId);
  await activateCase(manager.actor, created.caseId);
  return created.caseId;
}

function tasksOf(caseId: string) {
  return prisma.workflowTask.findMany({ where: { caseId }, orderBy: { sortOrder: 'asc' } });
}

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  setStorageForTests(new LocalStorageAdapter(mkdtempSync(path.join(tmpdir(), 'exit-s3-'))));
  officer = await createUser('S3B Officer', 'HR_OFFICER');
  manager = await createUser('S3B Manager', 'HR_MANAGER');
  itUser = await createUser('S3B IT', 'IT_RESPONDER');
  finUser = await createUser('S3B Finance', 'FINANCE_RESPONDER');
  lineMgr = await createUser('S3B Line Manager', 'LINE_MANAGER');

  const draft = await createDraftTemplate(officer.actor, {
    documentType: 'RESIGNATION_ACCEPTANCE_WITH_NOTICE',
    name: 'S3 notice template',
    contentBody: NOTICE_BODY,
  });
  await activateTemplate(manager.actor, draft.id);
});

describe('asset recovery (T.12, T.13, T.14, L)', () => {
  let caseId: string;
  beforeAll(async () => {
    caseId = await makeActiveCase();
  });

  it('activation builds the recovery list from employee-issued assets (T.12)', async () => {
    const view = await listCaseAssets(officer.actor, caseId);
    // EMP-TEST-001 has 3 seeded issued assets.
    expect(view.items.length).toBe(3);
    expect(view.items.map((i) => i.assetType).sort()).toEqual([
      'ACCESS_CARD',
      'EMPLOYEE_ID_CARD',
      'LAPTOP',
    ]);
    expect(view.items.every((i) => i.status === 'EXPECTED')).toBe(true);
  });

  it('every asset receives a valid documented disposition (T.13, L.4)', async () => {
    const view = await listCaseAssets(officer.actor, caseId);
    const [a, b, c] = view.items;
    await setAssetDisposition(officer.actor, a!.id, { status: 'RETURNED', condition: 'Good' });
    // LOST without a reason is refused; with a reason it is documented.
    await expect(
      setAssetDisposition(officer.actor, b!.id, { status: 'LOST' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await setAssetDisposition(officer.actor, b!.id, {
      status: 'LOST',
      reason: 'Employee reports the card was lost in June.',
    });
    // WRITTEN_OFF needs HR_MANAGER authority (L.4).
    await expect(
      setAssetDisposition(officer.actor, c!.id, {
        status: 'WRITTEN_OFF',
        reason: 'Depreciated.',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await setAssetDisposition(manager.actor, c!.id, {
      status: 'WRITTEN_OFF',
      reason: 'Laptop fully depreciated; write-off approved.',
    });

    const after = await listCaseAssets(officer.actor, caseId);
    expect(after.metrics.documentationRatePct).toBe(100);
    // Physical recovery is a DIFFERENT measure: 1 of 3 returned (T.13/L.1).
    expect(after.metrics.physicalRecoveryRatePct).toBe(33.3);
  });

  it('an asset exception never touches pay - review exception only (T.14, L.5-L.7)', async () => {
    const item = await addAssetRecoveryItem(officer.actor, caseId, {
      assetType: 'KEYS',
      label: 'Stock room key',
    });
    await setAssetDisposition(officer.actor, item.id, {
      status: 'UNRESOLVED',
      reason: 'Key not yet located.',
    });
    const exception = await prisma.caseException.findFirstOrThrow({
      where: { caseId, exceptionType: 'ASSET_UNRESOLVED', refId: item.id, status: 'OPEN' },
    });
    expect(exception.detail).toContain('no payroll instruction');
    // The data model itself carries no pay field of any kind (fixed default 18).
    const columns = Object.keys(
      await prisma.assetRecoveryItem.findFirstOrThrow({ where: { id: item.id } }),
    ).join(',');
    expect(columns.toLowerCase()).not.toMatch(/pay|deduct|amount|salary/);
  });
});

describe('handover (T.15, T.16, T.17, M)', () => {
  let caseId: string;
  beforeAll(async () => {
    caseId = await makeActiveCase({ employeeSourceId: 'EMP-TEST-004' });
    // Directive 6.1 (F): activation auto-adds the confirmed manager as the
    // MANAGER participant, so no manual addParticipant is needed here.
  });

  it('credential-like content is rejected (T.17, M.2/M.3)', async () => {
    await expect(
      updateHandover(lineMgr.actor, caseId, {
        keyDocumentLocations: 'Shared drive. Admin password: hunter2',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('the manager records and completes the handover with attestation (T.15)', async () => {
    await updateHandover(lineMgr.actor, caseId, {
      dutiesToReassign: 'Daily service scheduling; parts counter escalations.',
      openWorkDeadlines: 'August stock count preparation (due 20 Aug).',
      replacementOwner: 'Line Manager (interim).',
      keyDocumentLocations: 'Service records in the branch office cabinet B.',
    });
    await transitionHandover(lineMgr.actor, caseId, 'complete');
    const view = await getHandover(officer.actor, caseId);
    expect(view.record.status).toBe('COMPLETED');
    expect(view.record.managerAttestedById).toBe(lineMgr.userId);
    const attestation = await prisma.attestation.findFirstOrThrow({
      where: { caseId, kind: 'MANAGER_HANDOVER_ATTESTATION' },
    });
    expect(attestation.actorId).toBe(lineMgr.userId);
    // The workflow handover tasks completed with it (M.9).
    const tasks = await tasksOf(caseId);
    expect(tasks.find((t) => t.taskCode === 'MGR_HANDOVER_PLAN')!.status).toBe('COMPLETED');
    expect(tasks.find((t) => t.taskCode === 'MGR_HANDOVER_COMPLETE')!.status).toBe('COMPLETED');
  });

  it('HR_MANAGER may waive a handover with a reason (T.16, M.6)', async () => {
    const otherCase = await makeActiveCase({ employeeSourceId: 'EMP-TEST-003' });
    await expect(transitionHandover(manager.actor, otherCase, 'waive')).rejects.toMatchObject({
      code: 'VALIDATION',
    }); // reason required
    await expect(
      transitionHandover(officer.actor, otherCase, 'waive', 'officer tries'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' }); // HR_MANAGER only
    await transitionHandover(
      manager.actor,
      otherCase,
      'waive',
      'Role has no open duties; approved by HR Manager.',
    );
    const view = await getHandover(officer.actor, otherCase);
    expect(view.record.status).toBe('WAIVED');
  });
});

describe('clearance gate and completion (T.18-T.22, T.24, O)', () => {
  let caseId: string;

  beforeAll(async () => {
    caseId = await makeActiveCase({ employeeSourceId: 'EMP-TEST-005' });
    // MANAGER participant is auto-added at activation (Directive 6.1 F).
  });

  it('clearance is blocked while required work is open (T.18-T.20)', async () => {
    const view = await getClearanceView(manager.actor, caseId);
    expect(view.readiness?.ok).toBe(false);
    const failing = Object.fromEntries(view.readiness!.items.map((i) => [i.key, i.ok]));
    expect(failing.requiredTasks).toBe(false); // T.18
    expect(failing.accessRevocation).toBe(false); // T.19
    expect(failing.assets).toBe(false); // T.20 (issued assets still EXPECTED)
    await expect(requestClearance(officer.actor, caseId)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    // The refused request is visible as a CLEARANCE_BLOCKED exception (N).
    await prisma.caseException.findFirstOrThrow({
      where: { caseId, exceptionType: 'CLEARANCE_BLOCKED', status: 'OPEN' },
    });
  });

  it('full flow: documents, form, tasks, assets, handover, access - then HR_MANAGER completes (T.21, T.22)', async () => {
    // Letter: draft -> submit -> approve (renders inline).
    const doc = await createLetterDraft(officer.actor, caseId);
    await submitDocument(officer.actor, doc.id);
    await approveDocument(manager.actor, doc.id);
    const letter = await prisma.documentInstance.findUniqueOrThrow({ where: { id: doc.id } });
    expect(['RENDERED', 'MANUALLY_ISSUED']).toContain(letter.status);

    // Action form: HR section -> manager approval -> HR final approval.
    const form = await createActionForm(officer.actor, caseId);
    await updateActionFormHr(officer.actor, form.id, {
      hrChecklist: {
        caseInfoVerified: 'DONE',
        evidenceRecorded: 'DONE',
        contactVerified: 'DONE',
        benefitsInitiated: 'NOT_APPLICABLE',
        propertyProcessInitiated: 'DONE',
        accessRemovalRecorded: 'DONE',
        surveyEligibilityAssessed: 'DONE',
        hrisUpdate: 'DONE',
      },
      ackStatus: 'ACKNOWLEDGED',
      ackMethod: 'Signed acknowledgement in HR office',
      ackDate: new Date('2026-07-29T14:00:00.000Z'),
    });
    await submitActionForm(officer.actor, form.id);
    await managerApproveForm(lineMgr.actor, form.id);
    await hrApproveForm(manager.actor, form.id);

    // Assets: document every disposition (EMP-TEST-005 has 4 issued assets).
    for (const item of (await listCaseAssets(officer.actor, caseId)).items) {
      await setAssetDisposition(officer.actor, item.id, { status: 'RETURNED', condition: 'Good' });
    }

    // Handover: manager records and completes.
    await updateHandover(lineMgr.actor, caseId, {
      dutiesToReassign: 'IT support tickets and warehouse device maintenance.',
      replacementOwner: 'IT service desk (interim).',
    });
    await transitionHandover(lineMgr.actor, caseId, 'complete');

    // IT: review then exact-time revocation (early, with recorded authority).
    const review = (await tasksOf(caseId)).find((t) => t.taskCode === 'IT_ACCESS_REVIEW')!;
    await completeTask(itUser.actor, review.id, 'Access list confirmed.');
    const access = (await tasksOf(caseId)).find((t) => t.taskCode === 'IT_ACCESS_REVOCATION')!;
    await completeAccessTask(itUser.actor, access.id, {
      systemsCompleted: ['Network account', 'Email', 'Business applications', 'Building access'],
      systemsUnresolved: [],
      note: 'All access removed. Ticket TEST-9.',
      earlyCompletionReason: 'HR Manager approved early removal (employee escorted out).',
    });

    // Complete every remaining open required task by department authority,
    // re-running rounds as dependencies release (D.1). Line-manager tasks are
    // reassigned to the direct manager first (D.4).
    for (let round = 0; round < 8; round++) {
      const open = (await tasksOf(caseId)).filter(
        (t) => t.required && ['READY', 'IN_PROGRESS'].includes(t.status),
      );
      if (open.length === 0) break;
      for (const t of open) {
        if (t.department === 'LINE_MANAGER') {
          if (t.assigneeId !== lineMgr.userId) {
            await reassignTask(
              manager.actor,
              t.id,
              lineMgr.userId,
              'Assigning to the direct manager.',
            );
          }
          await completeTask(lineMgr.actor, t.id, `${t.taskCode} completed by the manager.`);
          continue;
        }
        const actor =
          t.department === 'FINANCE'
            ? finUser.actor
            : t.department === 'IT'
              ? itUser.actor
              : t.requiredRole === 'HR_MANAGER'
                ? manager.actor
                : officer.actor;
        await completeTask(actor, t.id, `${t.taskCode} completed for clearance test.`);
      }
    }

    // Resolve the asset-overdue/blocked leftovers if any (none expected).
    const openExceptions = await prisma.caseException.findMany({
      where: { caseId, status: 'OPEN', severity: 'CRITICAL' },
    });
    for (const e of openExceptions) {
      await resolveException(manager.actor, e.id, 'Resolved for clearance test.', true);
    }

    // T.21: NO survey invitation exists at all - clearance must still pass.
    expect(await prisma.surveyInvitation.count({ where: { caseId } })).toBe(0);

    const view = await getClearanceView(manager.actor, caseId);
    expect(view.readiness?.items.filter((i) => !i.ok)).toEqual([]);

    await requestClearance(officer.actor, caseId);
    // T.22: only HR_MANAGER approves final clearance.
    await expect(approveFinalClearance(officer.actor, caseId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await approveFinalClearance(manager.actor, caseId);

    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(c.status).toBe('COMPLETED');
    expect(c.closedAt).not.toBeNull();
    const instance = await prisma.workflowInstance.findFirstOrThrow({ where: { caseId } });
    expect(instance.status).toBe('COMPLETED');
    const record = await prisma.clearanceRecord.findFirstOrThrow({ where: { caseId } });
    expect(record.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(record.actorId).toBe(manager.userId);

    // The clearance record is immutable at the database level (O).
    await expect(
      prisma.clearanceRecord.update({ where: { id: record.id }, data: { decision: 'CHANGED' } }),
    ).rejects.toThrow(/append-only/);
  });

  it('TRAINING/TEST records stay out of operational reporting (T.24)', async () => {
    const dash = await stage3Dashboard(manager.actor);
    // Every case in this suite is TEST purpose: operational reports stay empty.
    expect(dash.reports.taskSlaCompliance.measured).toBe(0);
    expect(dash.reports.accessRevocationTimeliness.completed).toBe(0);
    expect(dash.reports.assets.requiredCount).toBe(0);
    expect(dash.reports.handoverCompletion.required).toBe(0);
    expect(dash.queues.completedCases).toBe(0);
  });
});
