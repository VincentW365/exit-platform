/**
 * Exit surveys (Directive 2 sections G-H): versioned templates, hash-only
 * tokens, manual-send workflow, online + verbal channels, strict masking.
 */
import {
  answerErrors,
  canActOnCase,
  hashSurveyToken,
  generateSurveyToken,
  invitationDueAt,
  isPlausibleToken,
  scheduleFromManualSend,
  surveyEligibility,
  type Actor,
  type AnswerInput,
  type QuestionShape,
} from '@exit/domain';
import { hasRole } from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, auditDenied, newCorrelationId } from './auditService.ts';
import { assertFeatureAllowed, assertFullView, loadCaseAccess } from './shared.ts';

// --- invitations (HR side) ---------------------------------------------------

export async function createInvitation(actor: Actor, caseId: string, overrideReason?: string) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  assertFullView(actor, ctx);
  if (!canActOnCase(actor, 'survey.manage', ctx)) throw ServiceError.forbidden();
  await assertFeatureAllowed(c, 'automation.surveyInvitations');
  if (!c.effectiveSeparationAt)
    throw ServiceError.validation([
      'The case needs an effective separation date before a survey can be scheduled.',
    ]);

  const rule = surveyEligibility(c.departureType);
  if (rule.requiresOverride) {
    // Fixed default 21: termination requires an explicit HR_MANAGER override.
    if (!hasRole(actor, 'HR_MANAGER'))
      throw ServiceError.forbidden('Termination surveys require an HR Manager override.');
    if (!overrideReason?.trim())
      throw ServiceError.validation([
        'A reasoned override is required to make a termination case survey-eligible.',
      ]);
  }

  const prisma = getPrisma();
  const template = await prisma.surveyTemplate.findFirst({ where: { status: 'ACTIVE' } });
  if (!template) throw ServiceError.conflict('No ACTIVE survey template exists.');

  const existing = await prisma.surveyInvitation.findFirst({
    where: { caseId, status: { in: ['PENDING', 'MANUALLY_SENT'] } },
  });
  if (existing) throw ServiceError.conflict('An open invitation already exists for this case.');

  const correlationId = newCorrelationId();
  return prisma.$transaction(async (tx) => {
    const inv = await tx.surveyInvitation.create({
      data: {
        caseId,
        templateId: template.id,
        status: 'PENDING',
        invitationDueAt: invitationDueAt(c.effectiveSeparationAt!),
        overrideReason: overrideReason?.trim() || null,
        createdById: actor.userId,
      },
    });
    await appendAudit(tx, {
      eventType: 'SURVEY_INVITATION_CREATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'SurveyInvitation',
      objectId: inv.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { templateVersion: template.version, departureType: c.departureType },
    });
    if (rule.requiresOverride) {
      await appendAudit(tx, {
        eventType: 'SURVEY_ELIGIBILITY_OVERRIDDEN',
        actorType: 'USER',
        actorId: actor.userId,
        effectiveRoles: actor.roles,
        objectType: 'SurveyInvitation',
        objectId: inv.id,
        caseId,
        result: 'SUCCESS',
        correlationId,
        metadata: { reason: overrideReason },
      });
    }
    return inv;
  });
}

/**
 * Directive 6.3 (AF.14): the system schedules the exit survey according to
 * the configured rule - HR no longer creates routine invitations by hand.
 * Deterministic and idempotent: eligible ACTIVE cases with the automation
 * flag satisfied get exactly one invitation. Termination stays manual (it
 * requires an HR-Manager override by rule).
 */
export async function scheduleDueSurveyInvitations(_now: Date = new Date()): Promise<number> {
  const prisma = getPrisma();
  const template = await prisma.surveyTemplate.findFirst({ where: { status: 'ACTIVE' } });
  if (!template) return 0;
  const flag = await prisma.featureFlag.findUnique({
    where: { key: 'automation.surveyInvitations' },
  });
  const { getConfig } = await import('@exit/config');

  const candidates = await prisma.offboardingCase.findMany({
    where: {
      status: 'ACTIVE',
      effectiveSeparationAt: { not: null },
      departureType: { in: ['RESIGNATION_WITH_NOTICE', 'IMMEDIATE_RESIGNATION'] },
      surveyInvitations: { none: {} },
    },
    select: {
      id: true,
      ownerId: true,
      effectiveSeparationAt: true,
      recordPurpose: true,
      measurementCohort: true,
      departureType: true,
    },
    take: 50,
  });
  let created = 0;
  for (const c of candidates) {
    // Same automation gate as every side effect (AG): TEST/TRAINING outside
    // production; OPERATIONAL needs the flag and never BASELINE.
    const permitted =
      c.recordPurpose !== 'OPERATIONAL'
        ? !getConfig().isProduction
        : c.measurementCohort !== 'BASELINE' && flag?.enabled === true;
    if (!permitted) continue;
    const inv = await prisma.surveyInvitation.create({
      data: {
        caseId: c.id,
        templateId: template.id,
        status: 'PENDING',
        invitationDueAt: invitationDueAt(c.effectiveSeparationAt!),
        createdById: c.ownerId,
      },
    });
    await appendAudit(prisma, {
      eventType: 'SURVEY_INVITATION_CREATED',
      actorType: 'SYSTEM',
      objectType: 'SurveyInvitation',
      objectId: inv.id,
      caseId: c.id,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: {
        templateVersion: template.version,
        departureType: c.departureType,
        scheduledBy: 'automation (Directive 6.3 rule RULE_SURVEY_ELIGIBILITY_V1)',
      },
    });
    created += 1;
  }
  return created;
}

async function loadInvitation(actor: Actor, invitationId: string) {
  const inv = await getPrisma().surveyInvitation.findUnique({
    where: { id: invitationId },
    include: { template: { select: { version: true, title: true } } },
  });
  if (!inv) throw ServiceError.notFound();
  const { c, ctx } = await loadCaseAccess(actor, inv.caseId);
  assertFullView(actor, ctx);
  return { inv, c, ctx };
}

/**
 * Generate (or regenerate) the secure link token. Returns the RAW token
 * exactly once for HR to copy; only its hash is stored, and it is never
 * logged or audited.
 */
export async function generateInvitationToken(actor: Actor, invitationId: string) {
  const { inv, ctx } = await loadInvitation(actor, invitationId);
  if (!canActOnCase(actor, 'survey.manage', ctx)) throw ServiceError.forbidden();
  if (!['PENDING', 'MANUALLY_SENT'].includes(inv.status))
    throw ServiceError.conflict('Tokens can only be generated for open invitations.');

  const raw = generateSurveyToken();
  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const u = await tx.surveyInvitation.updateMany({
      where: { id: invitationId, rowVersion: inv.rowVersion },
      data: {
        tokenHash: hashSurveyToken(raw),
        tokenGeneratedAt: new Date(),
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0) throw ServiceError.conflict('The invitation changed; reload and retry.');
    await appendAudit(tx, {
      eventType: inv.tokenHash ? 'SURVEY_TOKEN_REGENERATED' : 'SURVEY_TOKEN_GENERATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'SurveyInvitation',
      objectId: invitationId,
      caseId: inv.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { regenerated: Boolean(inv.tokenHash) },
    });
  });
  return { rawToken: raw };
}

export async function recordManualSent(actor: Actor, invitationId: string) {
  const { inv, ctx } = await loadInvitation(actor, invitationId);
  if (!canActOnCase(actor, 'survey.manage', ctx)) throw ServiceError.forbidden();
  if (inv.status !== 'PENDING')
    throw ServiceError.conflict('Only pending invitations can be marked sent.');
  if (!inv.tokenHash)
    throw ServiceError.validation(['Generate the invitation link before recording it as sent.']);

  const now = new Date();
  const schedule = scheduleFromManualSend(now);
  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const u = await tx.surveyInvitation.updateMany({
      where: { id: invitationId, rowVersion: inv.rowVersion, status: 'PENDING' },
      data: {
        status: 'MANUALLY_SENT',
        manualSentById: actor.userId,
        manualSentAt: now,
        ...schedule,
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0) throw ServiceError.conflict('The invitation changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'SURVEY_MARKED_SENT',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'SurveyInvitation',
      objectId: invitationId,
      caseId: inv.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { expiresAt: schedule.expiresAt },
    });
  });
}

export async function recordReminderSent(actor: Actor, invitationId: string, which: 1 | 2) {
  const { inv, ctx } = await loadInvitation(actor, invitationId);
  if (!canActOnCase(actor, 'survey.manage', ctx)) throw ServiceError.forbidden();
  if (inv.status !== 'MANUALLY_SENT')
    throw ServiceError.conflict('Reminders apply to sent, open invitations.');
  const field = which === 1 ? 'reminder1SentAt' : 'reminder2SentAt';
  if (inv[field]) throw ServiceError.conflict(`Reminder ${which} was already recorded.`);

  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const u = await tx.surveyInvitation.updateMany({
      where: { id: invitationId, rowVersion: inv.rowVersion },
      data: { [field]: new Date(), rowVersion: { increment: 1 } },
    });
    if (u.count === 0) throw ServiceError.conflict('The invitation changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'SURVEY_REMINDER_RECORDED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'SurveyInvitation',
      objectId: invitationId,
      caseId: inv.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { reminder: which },
    });
  });
}

async function closeInvitation(
  actor: Actor,
  invitationId: string,
  status: 'CANCELLED' | 'INVALID_CONTACT' | 'NOT_ELIGIBLE' | 'DECLINED',
  eventType:
    | 'SURVEY_CANCELLED'
    | 'SURVEY_INVALID_CONTACT'
    | 'SURVEY_MARKED_NOT_ELIGIBLE'
    | 'SURVEY_DECLINED',
  note: string,
) {
  const { inv, ctx } = await loadInvitation(actor, invitationId);
  if (!canActOnCase(actor, 'survey.manage', ctx)) throw ServiceError.forbidden();
  if (!['PENDING', 'MANUALLY_SENT'].includes(inv.status))
    throw ServiceError.conflict('Only open invitations can be closed.');
  if (!note.trim()) throw ServiceError.validation(['A reason/note is required.']);

  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const u = await tx.surveyInvitation.updateMany({
      where: { id: invitationId, rowVersion: inv.rowVersion },
      data: {
        status,
        // Invalidate the link immediately on any closure.
        tokenHash: null,
        ...(status === 'CANCELLED' ? { cancelReason: note.trim() } : {}),
        ...(status === 'INVALID_CONTACT' ? { invalidContactNote: note.trim() } : {}),
        ...(status === 'NOT_ELIGIBLE' ? { eligibilityNote: note.trim() } : {}),
        ...(status === 'DECLINED' ? { responseChannel: 'DECLINED', completedAt: new Date() } : {}),
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0) throw ServiceError.conflict('The invitation changed; reload and retry.');
    await appendAudit(tx, {
      eventType,
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'SurveyInvitation',
      objectId: invitationId,
      caseId: inv.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { reasonNote: note },
    });
  });
}

export const cancelInvitation = (a: Actor, id: string, reason: string) =>
  closeInvitation(a, id, 'CANCELLED', 'SURVEY_CANCELLED', reason);
export const recordInvalidContact = (a: Actor, id: string, note: string) =>
  closeInvitation(a, id, 'INVALID_CONTACT', 'SURVEY_INVALID_CONTACT', note);
export const markNotEligible = (a: Actor, id: string, note: string) =>
  closeInvitation(a, id, 'NOT_ELIGIBLE', 'SURVEY_MARKED_NOT_ELIGIBLE', note);
export const recordDeclined = (a: Actor, id: string, note: string) =>
  closeInvitation(a, id, 'DECLINED', 'SURVEY_DECLINED', note);

/** HR-recorded verbal debrief (channel VERBAL_DEBRIEF). */
export async function recordVerbalDebrief(
  actor: Actor,
  invitationId: string,
  answers: readonly AnswerInput[],
) {
  const { inv, ctx } = await loadInvitation(actor, invitationId);
  if (!canActOnCase(actor, 'survey.recordVerbal', ctx)) throw ServiceError.forbidden();
  if (!['PENDING', 'MANUALLY_SENT'].includes(inv.status))
    throw ServiceError.conflict('This invitation is already closed.');

  const questions = await getQuestions(inv.templateId);
  const errors = validateAnswers(questions, answers, { requireRequired: false });
  if (errors.length) throw ServiceError.validation(errors);

  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const u = await tx.surveyInvitation.updateMany({
      where: {
        id: invitationId,
        rowVersion: inv.rowVersion,
        status: { in: ['PENDING', 'MANUALLY_SENT'] },
      },
      data: {
        status: 'COMPLETED',
        responseChannel: 'VERBAL_DEBRIEF',
        completedAt: new Date(),
        tokenHash: null,
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0) throw ServiceError.conflict('The invitation changed; reload and retry.');
    const response = await tx.surveyResponse.create({
      data: {
        invitationId,
        caseId: inv.caseId,
        channel: 'VERBAL_DEBRIEF',
        recordedById: actor.userId,
      },
    });
    await createAnswers(tx, response.id, questions, answers);
    await appendAudit(tx, {
      eventType: 'SURVEY_VERBAL_DEBRIEF_RECORDED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'SurveyResponse',
      objectId: response.id,
      caseId: inv.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { answerCount: answers.length },
    });
  });
}

// --- HR views ----------------------------------------------------------------

export async function getCaseSurvey(actor: Actor, caseId: string) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  assertFullView(actor, ctx);
  const prisma = getPrisma();
  const invitations = await prisma.surveyInvitation.findMany({
    where: { caseId },
    orderBy: { createdAt: 'desc' },
    include: { template: { select: { title: true, version: true } } },
  });
  const rule = surveyEligibility(c.departureType);
  return {
    eligibility: rule,
    invitations,
    capabilities: {
      canManage: canActOnCase(actor, 'survey.manage', ctx),
      canViewResponses: canActOnCase(actor, 'survey.viewResponses', ctx),
      canRecordVerbal: canActOnCase(actor, 'survey.recordVerbal', ctx),
    },
  };
}

/**
 * Identifiable responses: HR on the case only (DEC-042 removed the auditor
 * metadata-only tier with the role). Every view is audited.
 */
export async function getInvitationResponse(actor: Actor, invitationId: string) {
  const { inv, ctx } = await loadInvitation(actor, invitationId);
  const canView = canActOnCase(actor, 'survey.viewResponses', ctx);
  if (!canView) {
    await auditDenied(actor, 'ACCESS_DENIED', 'SurveyResponse', invitationId, inv.caseId);
    throw ServiceError.forbidden();
  }
  const prisma = getPrisma();
  const response = await prisma.surveyResponse.findUnique({
    where: { invitationId },
    include: { answers: { include: { question: true } } },
  });
  if (!response) return { metadata: inv, response: null, masked: false };

  await appendAudit(prisma, {
    eventType: 'SURVEY_RESPONSE_VIEWED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'SurveyResponse',
    objectId: response.id,
    caseId: inv.caseId,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: { channel: response.channel },
  });
  return { metadata: inv, response, masked: false };
}

// --- public (token) side -----------------------------------------------------

async function getQuestions(templateId: string): Promise<QuestionShape[]> {
  const rows = await getPrisma().surveyQuestion.findMany({
    where: { templateId },
    orderBy: { order: 'asc' },
  });
  return rows.map((q) => ({
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    required: q.required,
    options: q.options,
    maxLength: q.maxLength,
  }));
}

function validateAnswers(
  questions: QuestionShape[],
  answers: readonly AnswerInput[],
  opts: { requireRequired: boolean },
): string[] {
  const errors: string[] = [];
  const byQ = new Map(answers.map((a) => [a.questionId, a]));
  for (const a of answers) {
    if (!questions.some((q) => q.id === a.questionId))
      errors.push('Unknown question in submission.');
  }
  for (const q of questions) {
    const a = byQ.get(q.id);
    const qErrors = answerErrors(q, a);
    if (!opts.requireRequired) {
      // verbal debriefs may be partial: drop only the "requires an answer" errors
      errors.push(...qErrors.filter((e) => !e.includes('requires an answer')));
    } else {
      errors.push(...qErrors);
    }
  }
  return errors;
}

async function createAnswers(
  tx: Parameters<Parameters<ReturnType<typeof getPrisma>['$transaction']>[0]>[0],
  responseId: string,
  questions: QuestionShape[],
  answers: readonly AnswerInput[],
): Promise<void> {
  for (const a of answers) {
    const q = questions.find((x) => x.id === a.questionId);
    if (!q) continue;
    const empty = a.choices.length === 0 && a.rating === null && !(a.text && a.text.trim());
    if (empty) continue;
    await tx.surveyAnswer.create({
      data: {
        responseId,
        questionId: a.questionId,
        valueChoice: [...a.choices],
        valueRating: a.rating,
        valueText: a.text?.trim() || null,
      },
    });
  }
}

/** Neutral outcome for every invalid case (H token rule 6). */
const NEUTRAL = 'This survey link is not available.';

export async function getSurveyByToken(rawToken: string) {
  if (!isPlausibleToken(rawToken)) throw ServiceError.notFound(NEUTRAL);
  const prisma = getPrisma();
  const inv = await prisma.surveyInvitation.findUnique({
    where: { tokenHash: hashSurveyToken(rawToken) },
    include: { template: true },
  });
  if (!inv || inv.status === 'CANCELLED' || inv.status === 'COMPLETED')
    throw ServiceError.notFound(NEUTRAL);
  if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) throw ServiceError.notFound(NEUTRAL);
  if (!['PENDING', 'MANUALLY_SENT'].includes(inv.status)) throw ServiceError.notFound(NEUTRAL);

  // No internal case details on the public page (G rule 6).
  return {
    invitationId: inv.id,
    title: inv.template.title,
    introText: inv.template.introText,
    privacyNotice: inv.template.privacyNotice,
    questions: await getQuestions(inv.templateId),
  };
}

/** Transactional, duplicate-safe online submission (H rules 7-9). */
export async function submitSurveyByToken(rawToken: string, answers: readonly AnswerInput[]) {
  if (!isPlausibleToken(rawToken)) throw ServiceError.notFound(NEUTRAL);
  const prisma = getPrisma();
  const inv = await prisma.surveyInvitation.findUnique({
    where: { tokenHash: hashSurveyToken(rawToken) },
  });
  if (!inv || !['PENDING', 'MANUALLY_SENT'].includes(inv.status))
    throw ServiceError.notFound(NEUTRAL);
  if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) throw ServiceError.notFound(NEUTRAL);

  const questions = await getQuestions(inv.templateId);
  const errors = validateAnswers(questions, answers, { requireRequired: true });
  if (errors.length) throw ServiceError.validation(errors);

  await prisma.$transaction(async (tx) => {
    // Atomic claim: exactly one submission can flip the status.
    const u = await tx.surveyInvitation.updateMany({
      where: { id: inv.id, status: { in: ['PENDING', 'MANUALLY_SENT'] } },
      data: {
        status: 'COMPLETED',
        responseChannel: 'ONLINE_SURVEY',
        completedAt: new Date(),
        tokenHash: null, // single-use: invalidate immediately
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0) throw ServiceError.notFound(NEUTRAL);
    const response = await tx.surveyResponse.create({
      data: { invitationId: inv.id, caseId: inv.caseId, channel: 'ONLINE_SURVEY' },
    });
    await createAnswers(tx, response.id, questions, answers);
    await appendAudit(tx, {
      eventType: 'SURVEY_COMPLETED_ONLINE',
      actorType: 'SYSTEM',
      objectType: 'SurveyResponse',
      objectId: response.id,
      caseId: inv.caseId,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: { answerCount: answers.length },
    });
  });
}
