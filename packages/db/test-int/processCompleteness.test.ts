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
import { completeAccessTask, completeTask } from '../src/services/taskService.ts';
import { listCaseAssets, setAssetDisposition } from '../src/services/assetService.ts';
import {
  approveFinalClearance,
  getClearanceView,
  requestClearance,
} from '../src/services/clearanceService.ts';
import { resolveException } from '../src/services/exceptionService.ts';
import { transitionNotification } from '../src/services/notificationService.ts';
import { processOutbox } from '../src/services/outboxService.ts';
import { recordManualEvidence } from '../src/services/ackTokenService.ts';
import { activateTemplate, createDraftTemplate } from '../src/services/templateService.ts';
import {
  createLetterDraft,
  finalizeDocument,
  refreshDraftFields,
} from '../src/services/documentService.ts';
import { setEmployeeAddress } from '../src/services/letterDeliveryService.ts';
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
} from './helpers.ts';

const prisma = getPrisma();

let officer: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;
let lineMgr: Awaited<ReturnType<typeof createUser>>;

// Effective separation in the recent past so every release gate has fired
// (dynamic anchors - fixed calendar dates go stale; Directive 6.3 logic audit).
const DAY = 86_400_000;
const SWEEP_CLOCK = new Date(Date.now() + DAY);
const BASE = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  receivedAt: new Date(Date.now() - 26 * DAY).toISOString(),
  confirmedLastDay: new Date(Date.now() - 15 * DAY).toISOString(),
  effectiveSeparationAt: new Date(Date.now() - 14 * DAY).toISOString(),
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
  lineMgr = await createUser('Gap Line Manager');
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
    await runStage3Sweep(SWEEP_CLOCK);
    const open = (await tasksOf(caseId)).filter(
      (t) => t.required && ['READY', 'IN_PROGRESS', 'NOT_READY', 'BLOCKED'].includes(t.status),
    );
    if (open.length === 0) return;
    let progressed = false;
    for (const t of open) {
      if (t.status === 'NOT_READY') continue; // dependency/release-gated; next round
      try {
        if (t.taskKind === 'ACCESS_REVOCATION') {
          await completeAccessTask(hrActor.actor, t.id, {
            systemsCompleted: ['Network account', 'Email', 'Business applications'],
            systemsUnresolved: [],
            note: 'Gap-proof completion.',
            earlyCompletionReason: 'Effective time already passed in this scenario.',
          });
          progressed = true;
          continue;
        }
        // Directive 6.3 I/J and DEC-063: HR records every residual legacy
        // department task, the manager's included - no other login exists.
        const actor = t.requiredRole === 'HR_MANAGER' ? manager.actor : hrActor.actor;
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
  // Directive 6.3 AA: the v2 gate clears on email-action EVIDENCE. Release
  // anything still awaiting review (restricted cases demand HR-Manager
  // release), dispatch through the capture provider, then record completion
  // evidence for IT - delivery alone is never completion.
  const derived = await prisma.notificationRecord.findMany({
    where: { caseId, origin: 'DERIVED' },
  });
  for (const r of derived) {
    if (r.status === 'PENDING_APPROVAL') {
      await transitionNotification(manager.actor, r.id, 'approve');
    }
  }
  await processOutbox(new Date());
  const itRecord = await prisma.notificationRecord.findFirst({
    where: { caseId, notificationType: 'IT_ACCESS_REMOVAL', origin: 'DERIVED' },
  });
  if (itRecord && ['SENT', 'ACKNOWLEDGED'].includes(itRecord.status)) {
    await recordManualEvidence(manager.actor, itRecord.id, {
      kind: 'COMPLETED',
      channel: 'EMAIL',
      note: 'IT confirmed all access removed (gap-proof evidence).',
    });
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
    // DEC-066: benefits and providers are selected at intake, approved with
    // the case, and executed by the officer with no further manager step.
    const created = await createDraft(officer.actor, {
      ...BASE,
      employeeSourceId: 'EMP-TEST-001',
      groupHealth: 'NO',
      groupLife: 'NO',
    });
    const caseId = created.caseId;
    await transitionCase(officer.actor, caseId, 'submit');
    await transitionCase(manager.actor, caseId, 'approve');
    await readyAssignment(caseId, manager.actor, officer.userId, lineMgr.userId);
    await activateCase(manager.actor, caseId);

    const doc = await createLetterDraft(officer.actor, caseId);
    // The acceptance letter is addressed, so HR records the address from the
    // resignation scan before it can be finalized (DEC-054).
    await setEmployeeAddress(officer.actor, caseId, {
      employeeAddress: '12 Synthetic Avenue, Kingston 5',
    });
    await refreshDraftFields(officer.actor, doc.id);
    await finalizeDocument(officer.actor, doc.id);

    const form = await createActionForm(officer.actor, caseId);
    await updateActionFormHr(officer.actor, form.id, {
      hrChecklist: HR_CHECKLIST,
      ackStatus: 'ACKNOWLEDGED',
      ackMethod: 'Signed acknowledgement in HR office',
      ackDate: new Date(Date.now() - 20 * DAY),
    });
    await submitActionForm(officer.actor, form.id);
    // Directive 6.3 F (AC invariant 1): the assigned HR Officer completes the
    // form - no manager approval exists.
    await completeActionForm(officer.actor, form.id);

    await completeAllRequired(caseId, officer);
    await finishCase(caseId);
  });

  it('IMMEDIATE_RESIGNATION reaches COMPLETED', async () => {
    const created = await createDraft(officer.actor, {
      ...BASE,
      employeeSourceId: 'EMP-TEST-002',
      departureType: 'IMMEDIATE_RESIGNATION',
      // Historical record: they stopped work when employment ended.
      confirmedLastDay: BASE.effectiveSeparationAt,
      groupHealth: 'NO',
      groupLife: 'NO',
    });
    const caseId = created.caseId;
    await transitionCase(officer.actor, caseId, 'submit');
    await transitionCase(manager.actor, caseId, 'approve');
    await readyAssignment(caseId, manager.actor, officer.userId, lineMgr.userId);
    await activateCase(manager.actor, caseId);

    const doc = await createLetterDraft(officer.actor, caseId);
    await setEmployeeAddress(officer.actor, caseId, {
      employeeAddress: '12 Synthetic Avenue, Kingston 5',
    });
    await refreshDraftFields(officer.actor, doc.id);
    await finalizeDocument(officer.actor, doc.id);

    const form = await createActionForm(officer.actor, caseId);
    await updateActionFormHr(officer.actor, form.id, {
      hrChecklist: HR_CHECKLIST,
      ackStatus: 'NOT_OBTAINED',
      ackReason: 'Employee left immediately; acknowledgement not obtainable.',
    });
    await submitActionForm(officer.actor, form.id);
    // Directive 6.3 F (AC invariant 1): the assigned HR Officer completes the
    // form - no manager approval exists.
    await completeActionForm(officer.actor, form.id);

    await completeAllRequired(caseId, officer);
    await finishCase(caseId);
  });

  it('TERMINATION (restricted) reaches COMPLETED', async () => {
    const created = await createDraft(manager.actor, {
      ...BASE,
      employeeSourceId: 'EMP-TEST-003',
      departureType: 'TERMINATION',
      // Historical record: the last working day was the effective date.
      confirmedLastDay: BASE.effectiveSeparationAt,
      groupHealth: 'NO',
      groupLife: 'NO',
    });
    const caseId = created.caseId;
    await transitionCase(manager.actor, caseId, 'submit');
    await transitionCase(manager.actor, caseId, 'approve');
    // Restricted case: the accountable HR Manager is also the operating
    // officer (HR officers cannot see restricted cases by default).
    await readyAssignment(caseId, manager.actor, manager.userId, lineMgr.userId);
    await activateCase(manager.actor, caseId);
    // DEC-066: the restricted workflow no longer carries a second
    // "Authorized HR Manager approval" task - the case approval was it.
    expect((await tasksOf(caseId)).some((t) => t.taskCode === 'HRM_AUTHORIZATION')).toBe(false);

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
    await completeActionForm(manager.actor, form.id);

    await completeAllRequired(caseId, manager);
    await finishCase(caseId);
  });
});
