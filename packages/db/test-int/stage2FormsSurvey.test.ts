/**
 * Stage 2 integration: action form (N.8-N.14) and exit survey (N.15-N.21).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { LocalStorageAdapter, setStorageForTests } from '../src/storage.ts';
import { addParticipant, createDraft } from '../src/services/caseService.ts';
import {
  createActionForm,
  downloadActionFormPdf,
  getActionForm,
  hrApproveForm,
  managerApproveForm,
  submitActionForm,
  updateActionFormFinance,
  updateActionFormHr,
} from '../src/services/actionFormService.ts';
import {
  createInvitation,
  generateInvitationToken,
  getCaseSurvey,
  getInvitationResponse,
  getSurveyByToken,
  recordManualSent,
  submitSurveyByToken,
} from '../src/services/surveyService.ts';
import { stage2Dashboard } from '../src/services/dashboardService.ts';
import { FINANCE_CHECKLIST_ITEMS, HR_CHECKLIST_ITEMS } from '@exit/domain';
import { createUser, resetDb, VALID_DRAFT } from './helpers.ts';

const prisma = getPrisma();

let officer: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;
let finance: Awaited<ReturnType<typeof createUser>>;
let lineManager: Awaited<ReturnType<typeof createUser>>;
let sysadmin: Awaited<ReturnType<typeof createUser>>;
let caseId: string;
let formId: string;

function doneChecklist(items: readonly { key: string }[]) {
  return Object.fromEntries(items.map((i) => [i.key, 'DONE' as const]));
}

async function seedSurveyTemplate() {
  const existing = await prisma.surveyTemplate.findFirst({ where: { status: 'ACTIVE' } });
  if (existing) return existing;
  return prisma.surveyTemplate.create({
    data: {
      code: 'exit-survey-test',
      version: 1,
      status: 'ACTIVE',
      title: 'Test exit survey',
      introText: 'intro',
      privacyNotice: 'Reviewed by authorized HR personnel; confidential, not anonymous.',
      questions: {
        create: [
          {
            order: 1,
            type: 'RATING_1_5',
            prompt: 'Overall experience?',
            required: true,
            options: [],
          },
          {
            order: 2,
            type: 'SINGLE_CHOICE',
            prompt: 'Primary factor?',
            required: true,
            options: ['Compensation', 'Environment', 'Prefer not to say'],
          },
          {
            order: 3,
            type: 'LONG_TEXT',
            prompt: 'Improvement?',
            required: false,
            options: [],
            maxLength: 2000,
          },
        ],
      },
    },
  });
}

beforeAll(async () => {
  await resetDb();
  setStorageForTests(new LocalStorageAdapter(mkdtempSync(path.join(tmpdir(), 'exit-pdf2-'))));
  officer = await createUser('F Officer', 'HR_OFFICER');
  manager = await createUser('F Manager', 'HR_MANAGER');
  finance = await createUser('F Finance', 'FINANCE_RESPONDER');
  lineManager = await createUser('F LineMgr', 'LINE_MANAGER');
  sysadmin = await createUser('F Sysadmin', 'SYSTEM_ADMIN');
  await seedSurveyTemplate();

  const created = await createDraft(officer.actor, {
    ...VALID_DRAFT,
    departureType: 'IMMEDIATE_RESIGNATION',
    recordPurpose: 'TEST',
    measurementCohort: null,
  });
  caseId = created.caseId;
  await addParticipant(
    manager.actor,
    caseId,
    finance.userId,
    'FINANCE',
    'Assigned finance responder.',
  );
  await addParticipant(manager.actor, caseId, lineManager.userId, 'MANAGER', 'Assigned manager.');
});

describe('action form (section F)', () => {
  it('HR officer creates the form; finance can edit ONLY finance fields (N.8/N.9)', async () => {
    const f = await createActionForm(officer.actor, caseId);
    formId = f.id;

    await updateActionFormFinance(finance.actor, formId, {
      financeChecklist: doneChecklist(FINANCE_CHECKLIST_ITEMS),
      financeNotes: 'Workpaper handled outside the application.',
    });
    await expect(
      updateActionFormHr(finance.actor, formId, { hrRemarks: 'finance trying HR edit' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('line manager sees only the minimum view - no restricted HR content (N.10/N.11)', async () => {
    const view = await getActionForm(lineManager.actor, caseId);
    expect(view.level).toBe('MANAGER_FORM');
    const serialized = JSON.stringify(view.current);
    expect(serialized).not.toContain('financeNotes');
    expect(serialized).not.toContain('hrRemarks');
    expect(serialized).not.toContain('ackReason');
    // and the finance participant never sees HR checklist or remarks
    const finView = await getActionForm(finance.actor, caseId);
    expect(JSON.stringify(finView.current)).not.toContain('hrChecklist');
  });

  it('immediate resignation supports NOT_OBTAINED with a reason (N.13)', async () => {
    await updateActionFormHr(officer.actor, formId, {
      hrChecklist: doneChecklist(HR_CHECKLIST_ITEMS),
      ackStatus: 'NOT_OBTAINED',
      ackReason: 'Employee departed immediately; acknowledgement not obtainable.',
      hrRemarks: 'Synthetic remarks.',
    });
    const f = await prisma.actionFormVersion.findUniqueOrThrow({ where: { id: formId } });
    expect(f.ackStatus).toBe('NOT_OBTAINED');
  });

  it('manager approves the assigned form; sysadmin/unassigned cannot', async () => {
    await submitActionForm(officer.actor, formId);
    await expect(managerApproveForm(sysadmin.actor, formId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(managerApproveForm(officer.actor, formId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await managerApproveForm(lineManager.actor, formId);
    const f = await prisma.actionFormVersion.findUniqueOrThrow({ where: { id: formId } });
    expect(f.status).toBe('PENDING_HR');
  });

  it('HR final approval creates the immutable version with attested PDF (N.12)', async () => {
    await hrApproveForm(manager.actor, formId);
    const f = await prisma.actionFormVersion.findUniqueOrThrow({ where: { id: formId } });
    expect(f.status).toBe('APPROVED');
    expect(f.pdfObjectKey).toBeTruthy();
    const attestations = await prisma.attestation.findMany({
      where: { subjectType: 'ACTION_FORM', subjectId: formId },
    });
    expect(attestations.map((a) => a.kind).sort()).toEqual([
      'HR_FORM_FINAL_APPROVAL',
      'MANAGER_FORM_APPROVAL',
    ]);
    const dl = await downloadActionFormPdf(manager.actor, formId);
    expect(dl.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('no form data mentions pay and nothing altered any pay field (N.14)', async () => {
    const f = await prisma.actionFormVersion.findUniqueOrThrow({ where: { id: formId } });
    const everything = JSON.stringify(f);
    for (const banned of ['salary', 'finalPay', 'deduction', 'commission', 'loanBalance']) {
      expect(everything.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });
});

describe('exit survey (section H)', () => {
  let invitationId: string;
  let rawToken: string;

  it('invitation stores only a token hash (N.15)', async () => {
    const inv = await createInvitation(officer.actor, caseId);
    invitationId = inv.id;
    const gen = await generateInvitationToken(officer.actor, invitationId);
    rawToken = gen.rawToken;
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await prisma.surveyInvitation.findUniqueOrThrow({ where: { id: invitationId } });
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.tokenHash).not.toBe(rawToken);
    // The raw token appears nowhere in the database.
    const audit = await prisma.auditEvent.findMany({ where: { caseId } });
    expect(JSON.stringify(audit)).not.toContain(rawToken);
    await recordManualSent(officer.actor, invitationId);
  });

  it('valid token loads the survey without any case detail (N.16)', async () => {
    const s = await getSurveyByToken(rawToken);
    expect(s.questions).toHaveLength(3);
    expect(JSON.stringify(s)).not.toContain('OFF-'); // no case reference
    expect(JSON.stringify(s)).not.toContain('Avery'); // no employee identity
  });

  it('invalid tokens return neutral outcomes (N.17)', async () => {
    await expect(getSurveyByToken('x'.repeat(43))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getSurveyByToken('short')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('online submission completes once; duplicates are neutrally refused (N.18)', async () => {
    const questions = await prisma.surveyQuestion.findMany({ orderBy: { order: 'asc' } });
    const answers = [
      { questionId: questions[0]!.id, choices: [], rating: 4, text: null },
      { questionId: questions[1]!.id, choices: ['Environment'], rating: null, text: null },
      { questionId: questions[2]!.id, choices: [], rating: null, text: 'More synthetic snacks.' },
    ];
    await submitSurveyByToken(rawToken, answers);
    const inv = await prisma.surveyInvitation.findUniqueOrThrow({ where: { id: invitationId } });
    expect(inv.status).toBe('COMPLETED');
    expect(inv.responseChannel).toBe('ONLINE_SURVEY');
    expect(inv.tokenHash).toBeNull(); // single-use
    await expect(submitSurveyByToken(rawToken, answers)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await prisma.surveyResponse.count({ where: { invitationId } })).toBe(1);
  });

  it('responses are inaccessible to unauthorized roles (N.19)', async () => {
    for (const denied of [finance, lineManager, sysadmin]) {
      await expect(getInvitationResponse(denied.actor, invitationId)).rejects.toMatchObject({
        code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/),
      });
    }
    const hrView = await getInvitationResponse(officer.actor, invitationId);
    expect(hrView.masked).toBe(false);
    expect(hrView.response?.answers.length).toBe(3);
  });

  it('termination surveys require an HR Manager override with reason (defaults 20/21)', async () => {
    const term = await createDraft(manager.actor, {
      ...VALID_DRAFT,
      employeeSourceId: 'EMP-TEST-003',
      departureType: 'TERMINATION',
      recordPurpose: 'TEST',
      measurementCohort: null,
    });
    await expect(createInvitation(manager.actor, term.caseId)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const inv = await createInvitation(
      manager.actor,
      term.caseId,
      'Sponsor-approved synthetic exception.',
    );
    expect(inv.overrideReason).toContain('synthetic');
    const overrideAudit = await prisma.auditEvent.findFirst({
      where: { caseId: term.caseId, eventType: 'SURVEY_ELIGIBILITY_OVERRIDDEN' },
    });
    expect(overrideAudit).not.toBeNull();
    // Restricted survey data never leaks into the officer's view (N.20).
    await expect(getCaseSurvey(officer.actor, term.caseId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('TRAINING/TEST records stay out of operational metrics (N.21)', async () => {
    const dash = await stage2Dashboard(manager.actor);
    expect(dash.queues.completedSurveys).toBe(0); // completed survey was on a TEST case
    expect(dash.metrics.surveyCompletion.rate.denominator).toBe(0);
    expect(dash.metrics.documentTurnaround.count).toBe(0);
  });
});
