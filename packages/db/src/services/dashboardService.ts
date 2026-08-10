/**
 * HR dashboard queries (REQ-REPORT-001/004/005). Every count applies the same
 * record-level visibility as detail views so restricted cases never leak
 * through numbers (REQ-SEC-008).
 */
import {
  assetMetrics,
  completionRate,
  daysUntil,
  endOfNthBusinessDayAfter,
  type Actor,
  type AssetItemLike,
} from '@exit/domain';
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

/**
 * Stage 3 dashboard and reporting (Directive 3 section P).
 *
 * Queues use the actor's case visibility; operational reporting excludes
 * TRAINING/TEST records by default. Manual-send timeliness is reported as
 * exactly that - the system records NO provider delivery and claims none.
 */
export async function stage3Dashboard(actor: Actor) {
  if (!can(actor, 'baseline.viewDashboard')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const caseVis = hrVisibilityWhere(actor);
  const taskCaseVis = { case: { is: caseVis } };
  const opCaseVis = { case: { is: { AND: [caseVis, { recordPurpose: 'OPERATIONAL' as const }] } } };
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const endOfWeek = new Date(now.getTime() + 7 * 86_400_000);
  const OPEN = ['READY', 'IN_PROGRESS', 'BLOCKED'] as const;

  const [
    activeWorkflows,
    dueToday,
    dueThisWeek,
    overdueTasks,
    criticalAccess,
    blockedTasks,
    unassignedManagerTasks,
    notifAwaitingApproval,
    notifReadyForSend,
    assetsOutstanding,
    assetExceptions,
    handoversOutstanding,
    readyForClearance,
    clearanceBlockedOpen,
    completedCases,
  ] = await Promise.all([
    prisma.workflowInstance.count({
      where: { status: { in: ['ACTIVE', 'ON_HOLD', 'CLEARANCE_PENDING'] }, ...taskCaseVis },
    }),
    prisma.workflowTask.count({
      where: { ...taskCaseVis, status: { in: [...OPEN] }, dueAt: { lte: endOfToday } },
    }),
    prisma.workflowTask.count({
      where: { ...taskCaseVis, status: { in: [...OPEN] }, dueAt: { lte: endOfWeek } },
    }),
    prisma.workflowTask.count({
      where: { ...taskCaseVis, status: { in: [...OPEN] }, dueAt: { lt: now } },
    }),
    prisma.workflowTask.findMany({
      where: { ...taskCaseVis, taskKind: 'ACCESS_REVOCATION', status: { in: [...OPEN] } },
      select: {
        id: true,
        title: true,
        dueAt: true,
        status: true,
        escalationLevel: true,
        case: { select: { id: true, caseNumber: true } },
      },
      orderBy: { dueAt: 'asc' },
      take: 20,
    }),
    prisma.workflowTask.count({ where: { ...taskCaseVis, status: 'BLOCKED' } }),
    prisma.workflowTask.count({
      where: {
        ...taskCaseVis,
        department: 'LINE_MANAGER',
        assigneeId: null,
        status: { in: [...OPEN] },
      },
    }),
    prisma.notificationRecord.count({ where: { ...taskCaseVis, status: 'PENDING_APPROVAL' } }),
    prisma.notificationRecord.count({ where: { ...taskCaseVis, status: 'READY_FOR_MANUAL_SEND' } }),
    prisma.assetRecoveryItem.count({
      where: {
        ...taskCaseVis,
        requiredForClearance: true,
        status: { in: ['EXPECTED', 'REQUESTED', 'PARTIALLY_RETURNED'] },
      },
    }),
    prisma.caseException.count({
      where: {
        ...taskCaseVis,
        status: 'OPEN',
        exceptionType: { in: ['ASSET_OVERDUE', 'ASSET_UNRESOLVED'] },
      },
    }),
    prisma.handoverRecord.count({
      where: {
        ...taskCaseVis,
        requiredForClearance: true,
        status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
        case: {
          is: { AND: [caseVis, { status: { in: ['ACTIVE', 'ON_HOLD', 'CLEARANCE_REVIEW'] } }] },
        },
      },
    }),
    prisma.workflowInstance.count({
      where: {
        ...taskCaseVis,
        status: { in: ['ACTIVE', 'CLEARANCE_PENDING'] },
        clearanceReady: true,
      },
    }),
    prisma.caseException.count({
      where: { ...taskCaseVis, status: 'OPEN', exceptionType: 'CLEARANCE_BLOCKED' },
    }),
    prisma.offboardingCase.count({
      where: { AND: [caseVis, { status: 'COMPLETED', recordPurpose: 'OPERATIONAL' }] },
    }),
  ]);

  // --- reporting (operational records only; P rules) -------------------------
  const [completedTasks, openOverdue, waived, corrections, notifRecords, assetRows, handoverRows] =
    await Promise.all([
      prisma.workflowTask.findMany({
        where: { ...opCaseVis, status: 'COMPLETED' },
        select: {
          department: true,
          taskKind: true,
          completedAt: true,
          releasedAt: true,
          createdAt: true,
          dueAt: true,
          lateMinutes: true,
          required: true,
        },
      }),
      prisma.workflowTask.findMany({
        where: { ...opCaseVis, status: { in: [...OPEN] }, dueAt: { lt: now } },
        select: { dueAt: true },
      }),
      prisma.workflowTask.count({ where: { ...opCaseVis, status: 'WAIVED' } }),
      prisma.taskCorrection.count({ where: { task: { is: { ...opCaseVis } } } }),
      prisma.notificationRecord.findMany({
        where: opCaseVis,
        select: {
          status: true,
          createdAt: true,
          approvedAt: true,
          readyAt: true,
          manualSentAt: true,
          approvalInvalidatedAt: true,
        },
      }),
      prisma.assetRecoveryItem.findMany({
        where: opCaseVis,
        select: { status: true, requiredForClearance: true },
      }),
      prisma.handoverRecord.findMany({
        where: { ...opCaseVis, requiredForClearance: true },
        select: { status: true },
      }),
    ]);

  const median = (values: number[]): number | null => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return Math.round(sorted[Math.floor((sorted.length - 1) / 2)]! * 10) / 10;
  };
  const pct = (num: number, den: number): number | null =>
    den === 0 ? null : Math.round((num / den) * 1000) / 10;

  // P.1 task SLA compliance (completed required tasks with a due date).
  const withDue = completedTasks.filter((t) => t.required && t.dueAt && t.completedAt);
  const onTime = withDue.filter((t) => t.completedAt!.getTime() <= t.dueAt!.getTime());

  // P.2 median completion time by department (release -> completion, hours).
  const byDept: Record<string, number[]> = {};
  for (const t of completedTasks) {
    if (!t.completedAt) continue;
    const start = t.releasedAt ?? t.createdAt;
    (byDept[t.department] ??= []).push((t.completedAt.getTime() - start.getTime()) / 3_600_000);
  }

  // P.3/P.4 access-revocation timeliness.
  const accessDone = completedTasks.filter((t) => t.taskKind === 'ACCESS_REVOCATION');
  const lateAccess = accessDone.filter((t) => (t.lateMinutes ?? 0) > 0);

  // P.5 notification preparation and manual-send timeliness (manual-send only;
  // provider delivery does not exist and is not claimed).
  const prepHours = notifRecords
    .filter((n) => n.approvedAt)
    .map((n) => (n.approvedAt!.getTime() - n.createdAt.getTime()) / 3_600_000);
  const sendHours = notifRecords
    .filter((n) => n.readyAt && n.manualSentAt)
    .map((n) => (n.manualSentAt!.getTime() - n.readyAt!.getTime()) / 3_600_000);

  // P.10/P.11 cycle times from status history (completed operational cases).
  const completedCaseRows = await prisma.offboardingCase.findMany({
    where: { AND: [caseVis, { status: 'COMPLETED', recordPurpose: 'OPERATIONAL' }] },
    select: {
      id: true,
      receivedAt: true,
      closedAt: true,
      statusHistory: { select: { toStatus: true, occurredAt: true } },
    },
    take: 500,
  });
  const clearanceDays: number[] = [];
  const endToEndDays: number[] = [];
  for (const cc of completedCaseRows) {
    if (!cc.closedAt) continue;
    endToEndDays.push((cc.closedAt.getTime() - cc.receivedAt.getTime()) / 86_400_000);
    const entered = cc.statusHistory
      .filter((h) => h.toStatus === 'CLEARANCE_REVIEW')
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())[0];
    if (entered)
      clearanceDays.push((cc.closedAt.getTime() - entered.occurredAt.getTime()) / 86_400_000);
  }

  // P.12 overdue ageing buckets.
  const ageing = { underOneDay: 0, oneToThreeDays: 0, threeToSevenDays: 0, overSevenDays: 0 };
  for (const t of openOverdue) {
    const days = (now.getTime() - t.dueAt!.getTime()) / 86_400_000;
    if (days < 1) ageing.underOneDay += 1;
    else if (days < 3) ageing.oneToThreeDays += 1;
    else if (days < 7) ageing.threeToSevenDays += 1;
    else ageing.overSevenDays += 1;
  }

  // P.14 exceptions by category (visibility-filtered).
  const exceptionsByType = await prisma.caseException.groupBy({
    by: ['exceptionType', 'ownerDepartment', 'status'],
    where: taskCaseVis,
    _count: { _all: true },
  });

  return {
    queues: {
      activeWorkflows,
      tasksDueToday: dueToday,
      tasksDueThisWeek: dueThisWeek,
      overdueTasks,
      criticalAccessTasks: criticalAccess,
      blockedTasks,
      pendingDepartmentOwnership: unassignedManagerTasks,
      notificationsAwaitingApproval: notifAwaitingApproval,
      notificationsReadyForManualSend: notifReadyForSend,
      assetsOutstanding,
      assetExceptions,
      handoversOutstanding,
      casesReadyForClearance: readyForClearance,
      casesBlockedFromClearance: clearanceBlockedOpen,
      completedCases,
    },
    reports: {
      taskSlaCompliance: {
        measured: withDue.length,
        onTime: onTime.length,
        pct: pct(onTime.length, withDue.length),
      },
      medianCompletionHoursByDepartment: Object.fromEntries(
        Object.entries(byDept).map(([d, hours]) => [d, median(hours)]),
      ),
      accessRevocationTimeliness: {
        completed: accessDone.length,
        late: lateAccess.length,
        onTimePct: pct(accessDone.length - lateAccess.length, accessDone.length),
        maxDelayMinutes: lateAccess.reduce((m, t) => Math.max(m, t.lateMinutes ?? 0), 0),
        medianDelayMinutes: median(lateAccess.map((t) => t.lateMinutes ?? 0)),
      },
      notificationTimeliness: {
        medianPrepToApprovalHours: median(prepHours),
        medianReadyToManualSendHours: median(sendHours),
        note: 'Manual-send recording only; no provider delivery exists or is claimed.',
      },
      notificationCorrections: {
        superseded: notifRecords.filter((n) => n.status === 'SUPERSEDED').length,
        approvalsInvalidated: notifRecords.filter((n) => n.approvalInvalidatedAt !== null).length,
      },
      assets: assetMetrics(assetRows as AssetItemLike[]),
      handoverCompletion: {
        required: handoverRows.length,
        satisfied: handoverRows.filter((h) =>
          ['COMPLETED', 'NOT_APPLICABLE', 'WAIVED'].includes(h.status),
        ).length,
        pct: pct(
          handoverRows.filter((h) => ['COMPLETED', 'NOT_APPLICABLE', 'WAIVED'].includes(h.status))
            .length,
          handoverRows.length,
        ),
      },
      clearanceCycleDays: { count: clearanceDays.length, median: median(clearanceDays) },
      endToEndCycleDays: { count: endToEndDays.length, median: median(endToEndDays) },
      overdueAgeing: ageing,
      waiversAndOverrides: { taskWaivers: waived, taskCorrections: corrections },
      exceptionsByCategory: exceptionsByType.map((e) => ({
        exceptionType: e.exceptionType,
        ownerDepartment: e.ownerDepartment,
        status: e.status,
        count: e._count._all,
      })),
    },
  };
}

/** Assigned action-form queue for FINANCE_RESPONDER / LINE_MANAGER dashboards. */
/**
 * The Finance/Manager dashboard work list is assignment-driven, NOT form-
 * driven: an assigned manager owes handover work even before HR drafts the
 * action form (and after it is approved), and their only navigation to those
 * surfaces is this list - limited-access roles never see the case tabs.
 */
export async function assignedFormQueue(actor: Actor) {
  const prisma = getPrisma();
  const parts = await prisma.caseParticipant.findMany({
    where: {
      userId: actor.userId,
      removedAt: null,
      participantRole: { in: ['FINANCE', 'MANAGER'] },
      case: { status: { in: ['ACTIVE', 'ON_HOLD', 'CLEARANCE_REVIEW'] } },
    },
    select: {
      caseId: true,
      participantRole: true,
      case: { select: { caseNumber: true } },
    },
    orderBy: { case: { caseNumber: 'asc' } },
  });
  if (parts.length === 0) return [];
  const caseIds = parts.map((p) => p.caseId);
  const forms = await prisma.actionFormVersion.findMany({
    where: {
      caseId: { in: caseIds },
      status: { in: ['DRAFT', 'RETURNED', 'PENDING_MANAGER', 'PENDING_HR'] },
    },
    select: { caseId: true, status: true },
  });
  const handovers = await prisma.handoverRecord.findMany({
    where: { caseId: { in: caseIds } },
    select: { caseId: true, status: true },
  });
  return parts.map((p) => ({
    caseId: p.caseId,
    caseNumber: p.case.caseNumber,
    formStatus: forms.find((f) => f.caseId === p.caseId)?.status ?? null,
    handoverStatus:
      p.participantRole === 'MANAGER'
        ? (handovers.find((h) => h.caseId === p.caseId)?.status ?? 'NOT_STARTED')
        : null,
    yourRole: p.participantRole,
  }));
}
