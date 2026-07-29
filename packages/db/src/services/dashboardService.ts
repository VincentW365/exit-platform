/**
 * HR dashboard queries (REQ-REPORT-001/004/005). Every count applies the same
 * record-level visibility as detail views so restricted cases never leak
 * through numbers (REQ-SEC-008).
 */
import { completionRate, daysUntil, endOfNthBusinessDayAfter, type Actor } from '@exit/domain';
import { can } from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { getActiveCalendar } from './adminService.ts';

function hrVisibilityWhere(actor: Actor) {
  return {
    OR: [
      { classification: 'CONFIDENTIAL' as const },
      { participants: { some: { userId: actor.userId, removedAt: null } } },
      { ownerId: actor.userId },
    ],
  };
}

export async function hrDashboard(actor: Actor) {
  if (!can(actor, 'baseline.viewDashboard')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const visibility = hrVisibilityWhere(actor);

  const [byStatus, upcoming, baselineOpen, trainingCount] = await Promise.all([
    prisma.offboardingCase.groupBy({
      by: ['status'],
      where: { AND: [visibility, { recordPurpose: 'OPERATIONAL' }] },
      _count: { _all: true },
    }),
    prisma.offboardingCase.findMany({
      where: {
        AND: [
          visibility,
          {
            recordPurpose: 'OPERATIONAL',
            status: { in: ['PENDING_HR_REVIEW', 'APPROVED', 'ACTIVE'] },
            effectiveSeparationAt: {
              gte: new Date(),
              lte: new Date(Date.now() + 30 * 24 * 60 * 60_000),
            },
          },
        ],
      },
      orderBy: { effectiveSeparationAt: 'asc' },
      take: 20,
      select: {
        id: true,
        caseNumber: true,
        employeeDisplayName: true,
        classification: true,
        departureType: true,
        status: true,
        effectiveSeparationAt: true,
      },
    }),
    prisma.offboardingCase.count({
      where: {
        AND: [
          visibility,
          {
            recordPurpose: 'OPERATIONAL',
            measurementCohort: 'BASELINE',
            status: { notIn: ['VOIDED', 'CANCELLED', 'COMPLETED'] },
          },
        ],
      },
    }),
    prisma.offboardingCase.count({ where: { recordPurpose: { in: ['TRAINING', 'TEST'] } } }),
  ]);

  const now = new Date();
  return {
    countsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    upcomingDepartures: upcoming.map((c) => ({
      ...c,
      daysUntil: c.effectiveSeparationAt ? daysUntil(c.effectiveSeparationAt, now) : null,
    })),
    baselineOpenCount: baselineOpen,
    nonOperationalCount: trainingCount,
  };
}

/**
 * Stage 2 queues, exceptions and metrics (Directive 2 sections I and K).
 * Every query embeds the actor's case-visibility predicate; TRAINING/TEST
 * records are excluded from operational metrics by default.
 */
export async function stage2Dashboard(actor: Actor) {
  if (!can(actor, 'baseline.viewDashboard')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const caseVis = { case: hrVisibilityWhere(actor) };
  const operationalVis = {
    case: { AND: [hrVisibilityWhere(actor), { recordPurpose: 'OPERATIONAL' as const }] },
  };
  const now = new Date();

  const [
    docsNeedingAttention,
    docsPendingApproval,
    renderFailures,
    formsIncomplete,
    formsManagerPending,
    formsHrPending,
    invitationsDue,
    remindersDue,
    completedSurveys,
    invitations,
    turnaroundDocs,
    docReturnedCount,
    docOutdatedCount,
    invalidatedApprovals,
    formCounts,
  ] = await Promise.all([
    prisma.documentInstance.findMany({
      where: { ...caseVis, status: { in: ['DRAFT', 'VALIDATION_FAILED', 'RETURNED'] } },
      include: { case: { select: { caseNumber: true, id: true, classification: true } } },
      take: 25,
      orderBy: { updatedAt: 'asc' },
    }),
    prisma.documentInstance.findMany({
      where: { ...caseVis, status: 'PENDING_APPROVAL' },
      include: { case: { select: { caseNumber: true, id: true, classification: true } } },
      take: 25,
      orderBy: { submittedAt: 'asc' },
    }),
    prisma.documentInstance.findMany({
      where: { ...caseVis, status: 'RENDER_FAILED' },
      include: { case: { select: { caseNumber: true, id: true, classification: true } } },
      take: 25,
    }),
    prisma.actionFormVersion.count({
      where: { ...caseVis, status: { in: ['DRAFT', 'RETURNED'] } },
    }),
    prisma.actionFormVersion.findMany({
      where: { ...caseVis, status: 'PENDING_MANAGER' },
      include: { case: { select: { caseNumber: true, id: true } } },
      take: 25,
    }),
    prisma.actionFormVersion.findMany({
      where: { ...caseVis, status: 'PENDING_HR' },
      include: { case: { select: { caseNumber: true, id: true } } },
      take: 25,
    }),
    prisma.surveyInvitation.findMany({
      where: { ...caseVis, status: 'PENDING', invitationDueAt: { lte: now } },
      include: { case: { select: { caseNumber: true, id: true } } },
      take: 25,
    }),
    prisma.surveyInvitation.findMany({
      where: {
        ...caseVis,
        status: 'MANUALLY_SENT',
        OR: [
          { reminder1DueAt: { lte: now }, reminder1SentAt: null },
          { reminder2DueAt: { lte: now }, reminder2SentAt: null },
        ],
      },
      include: { case: { select: { caseNumber: true, id: true } } },
      take: 25,
    }),
    prisma.surveyInvitation.count({ where: { ...operationalVis, status: 'COMPLETED' } }),
    prisma.surveyInvitation.findMany({
      where: operationalVis,
      select: { status: true, responseChannel: true, manualSentAt: true },
    }),
    prisma.documentInstance.findMany({
      where: {
        ...operationalVis,
        status: { in: ['RENDERED', 'MANUALLY_ISSUED'] },
        renderedAt: { not: null },
        documentType: {
          in: ['RESIGNATION_ACCEPTANCE_WITH_NOTICE', 'IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT'],
        },
      },
      select: { renderedAt: true, case: { select: { receivedAt: true } } },
    }),
    prisma.documentInstance.count({ where: { ...operationalVis, status: 'RETURNED' } }),
    prisma.documentInstance.count({ where: { ...operationalVis, outdatedReason: { not: null } } }),
    prisma.attestation.count({ where: { invalidatedAt: { not: null }, subjectType: 'DOCUMENT' } }),
    prisma.actionFormVersion.groupBy({
      by: ['status'],
      where: operationalVis,
      _count: { _all: true },
    }),
  ]);

  // K.1 document turnaround: received -> approved final PDF rendered.
  const calendar = await getActiveCalendar();
  const durations = turnaroundDocs
    .filter((d) => d.renderedAt)
    .map((d) => ({
      days: (d.renderedAt!.getTime() - d.case.receivedAt.getTime()) / 86_400_000,
      within2bd:
        d.renderedAt!.getTime() <=
        endOfNthBusinessDayAfter(d.case.receivedAt, 2, calendar).getTime(),
    }))
    .sort((a, b) => a.days - b.days);
  const median =
    durations.length === 0
      ? null
      : Math.round(durations[Math.floor((durations.length - 1) / 2)]!.days * 10) / 10;

  // K.4 survey completion tally.
  const tally = {
    manuallySent: invitations.filter((i) => i.manualSentAt !== null).length,
    completedOnline: invitations.filter((i) => i.responseChannel === 'ONLINE_SURVEY').length,
    completedVerbal: invitations.filter((i) => i.responseChannel === 'VERBAL_DEBRIEF').length,
    declined: invitations.filter((i) => i.status === 'DECLINED').length,
    expired: invitations.filter((i) => i.status === 'EXPIRED').length,
    invalidContact: invitations.filter((i) => i.status === 'INVALID_CONTACT').length,
    notEligible: invitations.filter((i) => i.status === 'NOT_ELIGIBLE').length,
    notSent: invitations.filter((i) => i.status === 'PENDING').length,
  };

  return {
    queues: {
      docsNeedingAttention,
      docsPendingApproval,
      renderFailures,
      formsIncomplete,
      formsManagerPending,
      formsHrPending,
      invitationsDue,
      remindersDue,
      completedSurveys,
    },
    metrics: {
      documentTurnaround: {
        count: durations.length,
        medianDays: median,
        withinTwoBusinessDaysPct:
          durations.length === 0
            ? null
            : Math.round((durations.filter((d) => d.within2bd).length / durations.length) * 1000) /
              10,
      },
      documentCorrections: {
        returned: docReturnedCount,
        outdatedByCaseChange: docOutdatedCount,
        approvalsInvalidated: invalidatedApprovals,
      },
      actionFormStatus: Object.fromEntries(formCounts.map((r) => [r.status, r._count._all])),
      surveyCompletion: { ...tally, rate: completionRate(tally) },
    },
  };
}

/** Assigned action-form queue for FINANCE_RESPONDER / LINE_MANAGER dashboards. */
export async function assignedFormQueue(actor: Actor) {
  const prisma = getPrisma();
  const parts = await prisma.caseParticipant.findMany({
    where: {
      userId: actor.userId,
      removedAt: null,
      participantRole: { in: ['FINANCE', 'MANAGER'] },
    },
    select: { caseId: true, participantRole: true },
  });
  if (parts.length === 0) return [];
  const forms = await prisma.actionFormVersion.findMany({
    where: {
      caseId: { in: parts.map((p) => p.caseId) },
      status: { in: ['DRAFT', 'RETURNED', 'PENDING_MANAGER', 'PENDING_HR'] },
    },
    include: { case: { select: { id: true, caseNumber: true } } },
    orderBy: { updatedAt: 'asc' },
  });
  return forms.map((f) => ({
    caseId: f.case.id,
    caseNumber: f.case.caseNumber,
    formStatus: f.status,
    yourRole: parts.find((p) => p.caseId === f.caseId)!.participantRole,
  }));
}
