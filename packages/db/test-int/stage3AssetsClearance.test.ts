/**
 * Stage 3 integration: assets, clearance gate and full completion
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
import { completeTask, reassignTask } from '../src/services/taskService.ts';
import {
  addAssetRecoveryItem,
  listCaseAssets,
  setAssetDisposition,
} from '../src/services/assetService.ts';
import {
  approveFinalClearance,
  getClearanceView,
  requestClearance,
} from '../src/services/clearanceService.ts';
import { resolveException } from '../src/services/exceptionService.ts';
import { confirmBenefits } from '../src/services/derivedActionService.ts';
import { processOutbox } from '../src/services/outboxService.ts';
import { recordManualEvidence } from '../src/services/ackTokenService.ts';
import { activateTemplate, createDraftTemplate } from '../src/services/templateService.ts';
import {
  approveDocument,
  createLetterDraft,
  refreshDraftFields,
  submitDocument,
} from '../src/services/documentService.ts';
import { setEmployeeAddress } from '../src/services/letterDeliveryService.ts';
import {
  completeActionForm,
  createActionForm,
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

describe('clearance gate and completion (T.18-T.22, T.24, O)', () => {
  let caseId: string;

  beforeAll(async () => {
    caseId = await makeActiveCase({ employeeSourceId: 'EMP-TEST-005' });
    // MANAGER participant is auto-added at activation (Directive 6.1 F).
  });

  it('clearance is blocked while required work is open (T.18-T.20, Directive 6.3 AA)', async () => {
    const view = await getClearanceView(manager.actor, caseId);
    expect(view.readiness?.ok).toBe(false);
    const failing = Object.fromEntries(view.readiness!.items.map((i) => [i.key, i.ok]));
    expect(failing.requiredTasks).toBe(false); // T.18
    // v2 evidence gate: IT completion evidence outstanding (T.19 analogue).
    expect(failing.itEvidence).toBe(false);
    expect(failing.assets).toBe(false); // T.20 (issued assets still EXPECTED)
    await expect(requestClearance(officer.actor, caseId)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    // The refused request is visible as a CLEARANCE_BLOCKED exception (N).
    await prisma.caseException.findFirstOrThrow({
      where: { caseId, exceptionType: 'CLEARANCE_BLOCKED', status: 'OPEN' },
    });
  });

  it('full flow: documents, form, tasks, assets - then HR_MANAGER completes (T.21, T.22)', async () => {
    // Letter: draft -> submit -> approve (renders inline).
    const doc = await createLetterDraft(officer.actor, caseId);
    await setEmployeeAddress(officer.actor, caseId, {
      employeeAddress: '12 Synthetic Avenue, Kingston 5',
    });
    await refreshDraftFields(officer.actor, doc.id);
    await submitDocument(officer.actor, doc.id);
    await approveDocument(manager.actor, doc.id);
    const letter = await prisma.documentInstance.findUniqueOrThrow({ where: { id: doc.id } });
    expect(['RENDERED', 'MANUALLY_ISSUED', 'ISSUED_BY_EMAIL']).toContain(letter.status);

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
      ackDate: new Date(Date.now() - 3 * 86_400_000),
    });
    await submitActionForm(officer.actor, form.id);
    await completeActionForm(officer.actor, form.id);

    // Assets: document every disposition (EMP-TEST-005 has 4 issued assets).
    for (const item of (await listCaseAssets(officer.actor, caseId)).items) {
      await setAssetDisposition(officer.actor, item.id, { status: 'RETURNED', condition: 'Good' });
    }

    // Benefits: HR confirms applicability once; the rules engine handles the
    // rest (Directive 6.3 V).
    await confirmBenefits(officer.actor, caseId, {
      groupHealth: 'NO',
      groupLife: 'NO',
      otherProvider: 'NO',
    });

    // IT + Finance: automated controlled emails with recorded evidence -
    // no logins, no department tasks (Directive 6.3 I/J/U).
    await processOutbox(new Date());
    const itRecord = await prisma.notificationRecord.findFirstOrThrow({
      where: { caseId, notificationType: 'IT_ACCESS_REMOVAL', origin: 'DERIVED' },
    });
    await recordManualEvidence(officer.actor, itRecord.id, {
      kind: 'COMPLETED',
      channel: 'EMAIL',
      note: 'IT confirmed all access removed. Ticket TEST-9.',
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
        // Directive 6.3 I/J: HR records residual legacy department work.
        const actor = t.requiredRole === 'HR_MANAGER' ? manager.actor : officer.actor;
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
    expect(dash.queues.completedCases).toBe(0);
  });
});
