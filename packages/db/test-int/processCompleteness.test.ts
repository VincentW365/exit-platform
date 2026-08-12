/**
 * Process-completeness gap-proofing (owner request): every seeded workflow
 * type must be walkable from draft to COMPLETED using only the application's
 * own services - no direct database shortcuts. A workflow that cannot finish
 * (a missing form, an uncompletable task, a dead-end dependency) fails here
 * with the exact list of stuck tasks.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { LocalStorageAdapter, setStorageForTests } from '../src/storage.ts';
import { createDraft, transitionCase } from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import { runStage3Sweep } from '../src/services/workflowSweepService.ts';
import { completeAccessTask, completeTask, reassignTask } from '../src/services/taskService.ts';
import { listCaseAssets, setAssetDisposition } from '../src/services/assetService.ts';
import { transitionHandover, updateHandover } from '../src/services/handoverService.ts';
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

// Effective separation in the recent past so every release gate has fired.
const BASE = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  receivedAt: '2026-07-20T14:00:00.000Z',
  confirmedLastDay: '2026-08-01T00:00:00.000Z',
  effectiveSeparationAt: '2026-08-01T22:00:00.000Z',
} as const;

const TEMPLATE_BODY = `DEVELOPMENT TEMPLATE - REQUIRES HR APPROVAL BEFORE OPERATIONAL USE

Dear [[EMPLOYEE_LEGAL_NAME]],

Case [[CASE_REFERENCE]]: employment ends [[EFFECTIVE_SEPARATION_DATE]].

[[HR_APPROVER_NAME]]
[[HR_APPROVER_TITLE]]`;

const HR_CHECKLIST = {
  caseInfoVerified: 'DONE',
  evidenceRecorded: 'DONE',
  contactVerified: 'DONE',
  benefitsInitiated: 'NOT_APPLICABLE',
  propertyProcessInitiated: 'DONE',
  accessRemovalRecorded: 'DONE',
  surveyEligibilityAssessed: 'DONE',
  hrisUpdate: 'DONE',
} as const;

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  setStorageForTests(new LocalStorageAdapter(mkdtempSync(path.join(tmpdir(), 'exit-gap-'))));
  officer = await createUser('Gap Officer', 'HR_OFFICER');
  manager = await createUser('Gap Manager', 'HR_MANAGER');
  itUser = await createUser('Gap IT', 'IT_RESPONDER');
  finUser = await createUser('Gap Finance', 'FINANCE_RESPONDER');
  lineMgr = await createUser('Gap Line Manager', 'LINE_MANAGER');
  for (const documentType of [
    'RESIGNATION_ACCEPTANCE_WITH_NOTICE',
    'IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT',
  ] as const) {
    const draft = await createDraftTemplate(officer.actor, {
      documentType,
      name: `Gap template ${documentType}`,
      contentBody: TEMPLATE_BODY,
    });
    await activateTemplate(manager.actor, draft.id);
  }
});

function tasksOf(caseId: string) {
  return prisma.workflowTask.findMany({ where: { caseId }, orderBy: { sortOrder: 'asc' } });
}

/** Drive every remaining required task to completion; fail loudly if stuck. */
async function completeAllRequired(caseId: string, hrActor: typeof officer): Promise<void> {
  for (let round = 0; round < 12; round++) {
    // Sweeping with a future clock releases anything still schedule-gated.
    await runStage3Sweep(new Date('2026-09-01T00:00:00.000Z'));
    const open = (await tasksOf(caseId)).filter(
      (t) => t.required && ['READY', 'IN_PROGRESS', 'NOT_READY', 'BLOCKED'].includes(t.status),
    );
    if (open.length === 0) return;
    let progressed = false;
    for (const t of open) {
      if (t.status === 'NOT_READY') continue; // dependency/release-gated; next round
      try {
        if (t.taskKind === 'ACCESS_REVOCATION') {
          await completeAccessTask(itUser.actor, t.id, {
            systemsCompleted: ['Network account', 'Email', 'Business applications'],
            systemsUnresolved: [],
            note: 'Gap-proof completion.',
            earlyCompletionReason: 'Effective time already passed in this scenario.',
          });
          progressed = true;
          continue;
        }
        if (t.department === 'LINE_MANAGER') {
          if (t.assigneeId !== lineMgr.userId) {
            await reassignTask(manager.actor, t.id, lineMgr.userId, 'Gap-proof routing.');
          }
          await completeTask(lineMgr.actor, t.id, `${t.taskCode} completed (gap-proof).`);
          progressed = true;
          continue;
        }
        const actor =
          t.department === 'FINANCE'
            ? finUser.actor
            : t.department === 'IT'
              ? itUser.actor
              : t.requiredRole === 'HR_MANAGER'
                ? manager.actor
                : hrActor.actor;
        await completeTask(actor, t.id, `${t.taskCode} completed (gap-proof).`);
        progressed = true;
      } catch {
        // leave for a later round (dependency or release ordering)
      }
    }
    if (!progressed) {
      const stuck = (await tasksOf(caseId))
        .filter((t) => t.required && t.status !== 'COMPLETED' && t.status !== 'WAIVED')
        .map((t) => `${t.taskCode} [${t.status}]`);
      throw new Error(`PROCESS GAP: no completion path for: ${stuck.join(', ')}`);
    }
  }
}

async function finishCase(caseId: string): Promise<void> {
  for (const item of (await listCaseAssets(manager.actor, caseId)).items) {
    if (item.status === 'EXPECTED') {
      await setAssetDisposition(manager.actor, item.id, { status: 'RETURNED', condition: 'Good' });
    }
  }
  for (const e of await prisma.caseException.findMany({ where: { caseId, status: 'OPEN' } })) {
    await resolveException(
      manager.actor,
      e.id,
      'Resolved for gap-proof completion.',
      e.severity === 'CRITICAL',
    );
  }
  const view = await getClearanceView(manager.actor, caseId);
  const failing = view.readiness?.items.filter((i) => !i.ok) ?? [];
  expect(failing, `clearance readiness gaps: ${failing.map((f) => f.key).join(', ')}`).toEqual([]);
  await requestClearance(manager.actor, caseId);
  await approveFinalClearance(manager.actor, caseId);
  const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
  expect(c.status).toBe('COMPLETED');
}

describe('every seeded workflow type completes end-to-end (gap-proofing)', () => {
  it('RESIGNATION_WITH_NOTICE reaches COMPLETED', async () => {
    const created = await createDraft(officer.actor, { ...BASE, employeeSourceId: 'EMP-TEST-001' });
    const caseId = created.caseId;
    await transitionCase(officer.actor, caseId, 'submit');
    await transitionCase(manager.actor, caseId, 'approve');
    await readyAssignment(caseId, manager.actor, officer.userId, lineMgr.userId);
    await activateCase(manager.actor, caseId);

    const doc = await createLetterDraft(officer.actor, caseId);
    await submitDocument(officer.actor, doc.id);
    await approveDocument(manager.actor, doc.id);

    const form = await createActionForm(officer.actor, caseId);
    await updateActionFormHr(officer.actor, form.id, {
      hrChecklist: HR_CHECKLIST,
      ackStatus: 'ACKNOWLEDGED',
      ackMethod: 'Signed acknowledgement in HR office',
      ackDate: new Date('2026-07-29T14:00:00.000Z'),
    });
    await submitActionForm(officer.actor, form.id);
    await managerApproveForm(lineMgr.actor, form.id);
    await hrApproveForm(manager.actor, form.id);

    await updateHandover(lineMgr.actor, caseId, {
      dutiesToReassign: 'Open sales orders and till reconciliation.',
      replacementOwner: 'Branch supervisor (interim).',
    });
    await transitionHandover(lineMgr.actor, caseId, 'complete');

    await completeAllRequired(caseId, officer);
    await finishCase(caseId);
  });

  it('IMMEDIATE_RESIGNATION reaches COMPLETED', async () => {
    const created = await createDraft(officer.actor, {
      ...BASE,
      employeeSourceId: 'EMP-TEST-002',
      departureType: 'IMMEDIATE_RESIGNATION',
      confirmedLastDay: null,
    });
    const caseId = created.caseId;
    await transitionCase(officer.actor, caseId, 'submit');
    await transitionCase(manager.actor, caseId, 'approve');
    await readyAssignment(caseId, manager.actor, officer.userId, lineMgr.userId);
    await activateCase(manager.actor, caseId);

    const doc = await createLetterDraft(officer.actor, caseId);
    await submitDocument(officer.actor, doc.id);
    await approveDocument(manager.actor, doc.id);

    const form = await createActionForm(officer.actor, caseId);
    await updateActionFormHr(officer.actor, form.id, {
      hrChecklist: HR_CHECKLIST,
      ackStatus: 'NOT_OBTAINED',
      ackReason: 'Employee left immediately; acknowledgement not obtainable.',
    });
    await submitActionForm(officer.actor, form.id);
    await managerApproveForm(lineMgr.actor, form.id);
    await hrApproveForm(manager.actor, form.id);

    await updateHandover(lineMgr.actor, caseId, {
      dutiesToReassign: 'Warehouse receiving duties reconstructed from records.',
      replacementOwner: 'Warehouse shift lead (interim).',
    });
    await transitionHandover(lineMgr.actor, caseId, 'complete');

    await completeAllRequired(caseId, officer);
    await finishCase(caseId);
  });

  it('TERMINATION (restricted) reaches COMPLETED', async () => {
    const created = await createDraft(manager.actor, {
      ...BASE,
      employeeSourceId: 'EMP-TEST-003',
      departureType: 'TERMINATION',
      confirmedLastDay: null,
    });
    const caseId = created.caseId;
    await transitionCase(manager.actor, caseId, 'submit');
    await transitionCase(manager.actor, caseId, 'approve');
    // Restricted case: the accountable HR Manager is also the operating
    // officer (HR officers cannot see restricted cases by default).
    await readyAssignment(caseId, manager.actor, manager.userId, lineMgr.userId);
    await activateCase(manager.actor, caseId);

    // Restricted action form processed by the HR Manager; the manager
    // approval step is attempted but never required to be reachable by a
    // non-participant line manager.
    const form = await createActionForm(manager.actor, caseId);
    await updateActionFormHr(manager.actor, form.id, {
      hrChecklist: HR_CHECKLIST,
      ackStatus: 'NOT_OBTAINED',
      ackReason: 'Restricted separation; acknowledgement not obtainable.',
    });
    await submitActionForm(manager.actor, form.id);
    try {
      await managerApproveForm(lineMgr.actor, form.id);
    } catch {
      // acceptable on restricted flows when the line manager lacks access
    }
    await hrApproveForm(manager.actor, form.id);

    await completeAllRequired(caseId, manager);
    await finishCase(caseId);
  });
});
