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
import { listExceptionFeed } from './exceptionService.ts';

function hrVisibilityWhere(actor: Actor) {
  return {
    OR: [
      { classification: 'CONFIDENTIAL' as const },
      { participants: { some: { userId: actor.userId, removedAt: null } } },
      { ownerId: actor.userId },
    ],
  };
}

/**
 * Directive 6.1 (AD): the dashboard's "needs attention now" row - critical,
 * overdue, pending-approval and routing problems, before operational metrics.
 */
export async function attentionSummary(actor: Actor) {
  if (!can(actor, 'baseline.viewDashboard')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const visibility = hrVisibilityWhere(actor);
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const openStatuses = ['READY', 'IN_PROGRESS', 'BLOCKED'] as const;
  const liveTask = {
    case: { is: { AND: [visibility, { recordPurpose: 'OPERATIONAL' as const }] } },
    status: { in: [...openStatuses] },
  };

  const [
    criticalTasks,
    overdueTasks,
    dueToday,
    pendingApproval,
    missingManager,
    hierarchyFlags,
    unassignedDept,
  ] = await Promise.all([
    prisma.workflowTask.count({
      where: { ...liveTask, OR: [{ priority: 'CRITICAL' }, { escalationLevel: { gt: 0 } }] },
    }),
    prisma.workflowTask.count({ where: { ...liveTask, dueAt: { lt: now } } }),
    prisma.workflowTask.count({ where: { ...liveTask, dueAt: { gte: now, lte: endOfToday } } }),
    prisma.offboardingCase.count({
      where: { AND: [visibility, { status: 'PENDING_HR_REVIEW', recordPurpose: 'OPERATIONAL' }] },
    }),
    prisma.offboardingCase.count({
      where: {
        AND: [
          visibility,
          {
            status: { in: ['DRAFT', 'PENDING_HR_REVIEW', 'APPROVED'] },
            recordPurpose: 'OPERATIONAL',
            managerUserId: null,
          },
        ],
      },
    }),
    prisma.offboardingCase.count({
      where: { AND: [visibility, { managerChangeFlaggedAt: { not: null } }] },
    }),
    prisma.workflowTask.count({
      where: { ...liveTask, assigneeId: null, department: { in: ['IT', 'FINANCE'] } },
    }),
  ]);
  return {
    criticalTasks,
    overdueTasks,
    dueToday,
    pendingApproval,
    missingManager,
    hierarchyFlags,
    unassignedDept,
  };
}

/**
 * Directive 6.2 (AJ): operational DIAGNOSTIC metrics - queue health and
 * process-friction indicators for facilitators. Explicitly not corporate
 * KPIs; surfaced on the technical health page (health.view).
 */
export async function operationalDiagnostics(actor: Actor) {
  if (!can(actor, 'health.view')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const now = Date.now();
  const since30d = new Date(now - 30 * 86_400_000);
  const openStatuses = ['READY', 'IN_PROGRESS', 'BLOCKED'] as const;

  const [unassigned, blocked, reassignments30d, claims30d, officerReassignments30d, exceptions30d] =
    await Promise.all([
      prisma.workflowTask.findMany({
        where: {
          status: { in: [...openStatuses] },
          assigneeId: null,
          department: { in: ['IT', 'FINANCE'] },
        },
        select: { createdAt: true },
      }),
      prisma.workflowTask.findMany({
        where: { status: 'BLOCKED' },
        select: { blockedAt: true, createdAt: true },
      }),
      prisma.auditEvent.count({
        where: { eventType: 'TASK_REASSIGNED', occurredAt: { gte: since30d } },
      }),
      prisma.auditEvent.count({
        where: { eventType: 'TASK_CLAIMED', occurredAt: { gte: since30d } },
      }),
      prisma.auditEvent.count({
        where: { eventType: 'CASE_OFFICER_REASSIGNED', occurredAt: { gte: since30d } },
      }),
      prisma.caseException.count({ where: { createdAt: { gte: since30d } } }),
    ]);
  const pendingApprovalCases = await prisma.offboardingCase.findMany({
    where: { status: 'PENDING_HR_REVIEW' },
    select: { updatedAt: true },
  });
  const ageHours = (d: Date) => Math.round((now - d.getTime()) / 3_600_000);
  const maxAge = (ds: Date[]) => (ds.length ? Math.max(...ds.map(ageHours)) : 0);
  return {
    unassignedDeptTasks: unassigned.length,
    oldestUnassignedHours: maxAge(unassigned.map((t) => t.createdAt)),
    blockedTasks: blocked.length,
    oldestBlockedHours: maxAge(blocked.map((t) => t.blockedAt ?? t.createdAt)),
    approvalsWaiting: pendingApprovalCases.length,
    oldestApprovalWaitHours: maxAge(pendingApprovalCases.map((c) => c.updatedAt)),
    taskClaims30d: claims30d,
    taskReassignments30d: reassignments30d,
    officerReassignments30d,
    exceptions30d,
    // Intake friction facts (S): source-derived vs manually entered fields.
    intakeSourceDerivedFields: 6, // name, number, title, department, location, manager
    intakeManualFields: 13,
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
    formsReadyForReview,
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
      where: { ...caseVis, status: { in: ['DRAFT', 'RETURNED', 'RETURNED_FOR_CORRECTION'] } },
    }),
    // Directive 6.3 (Z): one HR review queue. Legacy PENDING_MANAGER /
    // PENDING_HR rows remain visible (marked "(legacy)" in the UI) so no
    // in-flight form is ever hidden by the lifecycle change.
    prisma.actionFormVersion.findMany({
      where: {
        ...caseVis,
        status: { in: ['READY_FOR_HR_REVIEW', 'HR_REVIEWED', 'PENDING_MANAGER', 'PENDING_HR'] },
      },
      include: { case: { select: { caseNumber: true, id: true } } },
      take: 25,
      orderBy: { updatedAt: 'asc' },
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
      formsReadyForReview,
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

/**
 * Directive 6.3 (Z): the FINANCE_RESPONDER / LINE_MANAGER form surfaces are
 * retired - departments are reached by controlled email actions, not logins,
 * so Finance responders receive no assigned-work list and the manager list
 * carries ONLY handover pointers. The list stays assignment-driven because a
 * manager owes handover work regardless of any form's lifecycle, and this
 * list is their sole navigation - limited-access roles never see case tabs.
 */
export async function assignedFormQueue(actor: Actor) {
  const prisma = getPrisma();
  const parts = await prisma.caseParticipant.findMany({
    where: {
      userId: actor.userId,
      removedAt: null,
      participantRole: 'MANAGER',
      case: { status: { in: ['ACTIVE', 'ON_HOLD', 'CLEARANCE_REVIEW'] } },
    },
    select: {
      caseId: true,
      case: { select: { caseNumber: true } },
    },
    orderBy: { case: { caseNumber: 'asc' } },
  });
  if (parts.length === 0) return [];
  const handovers = await prisma.handoverRecord.findMany({
    where: { caseId: { in: parts.map((p) => p.caseId) } },
    select: { caseId: true, status: true },
  });
  return parts.map((p) => ({
    caseId: p.caseId,
    caseNumber: p.case.caseNumber,
    handoverStatus: handovers.find((h) => h.caseId === p.caseId)?.status ?? 'NOT_STARTED',
  }));
}

/**
 * Map an exception type to the case surface that fixes it. Mirrors the
 * exceptions page targetTab map, extended with the Directive 6.3 email-action
 * exception types. BENEFITS_APPLICABILITY_UNKNOWN maps to the case overview.
 */
function exceptionFixSurface(exceptionType: string): string {
  if (exceptionType.startsWith('ASSET_')) return '/assets';
  if (exceptionType === 'HANDOVER_OVERDUE') return '/handover';
  if (
    exceptionType.startsWith('NOTIFICATION_') ||
    exceptionType === 'RECIPIENT_MISSING' ||
    exceptionType === 'ACKNOWLEDGEMENT_OVERDUE' ||
    exceptionType === 'AUTO_SEND_BLOCKED'
  )
    return '/notifications';
  if (exceptionType === 'RENDER_FAILED' || exceptionType === 'DOCUMENT_UNAPPROVED')
    return '/documents';
  if (exceptionType === 'BENEFITS_APPLICABILITY_UNKNOWN') return '';
  if (exceptionType === 'CLEARANCE_BLOCKED' || exceptionType === 'INVALID_CASE_DATE')
    return '/clearance';
  return '/workflow';
}

/** "RECIPIENT_MISSING" -> "Recipient missing" (presentation only). */
function sentenceCase(value: string): string {
  const words = value.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Directive 6.3 (Z, correction 8): the HR dashboard leads with "Requires your
 * attention". Wraps the exception feed (which already embeds record-level
 * visibility and restricted-case minimization) into the top OPEN items,
 * strongest severity first, each linking to the surface that fixes it.
 */
export async function attentionFeed(actor: Actor) {
  if (!can(actor, 'baseline.viewDashboard')) throw ServiceError.forbidden();
  const rows = await listExceptionFeed(actor, { status: 'OPEN' });
  const rank: Record<string, number> = { CRITICAL: 3, HIGH: 2, WARNING: 1, INFO: 0 };
  return [...rows]
    .sort((a, b) => (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0))
    .slice(0, 12)
    .map((r) => ({
      id: r.id,
      severity: r.severity,
      title: r.minimized ? `${sentenceCase(r.exceptionType)} on a restricted case` : r.title,
      caseNumber: r.caseNumber,
      href: r.caseId ? `/cases/${r.caseId}${exceptionFixSurface(r.exceptionType)}` : '/exceptions',
    }));
}

/** Business-language labels for derived email actions - never enum values. */
const NOTIFICATION_ACTION_LABELS: Record<string, string> = {
  IT_ACCESS_REMOVAL: 'IT access-removal email',
  FINANCE_OFFBOARDING: 'Finance notification',
  LINE_MANAGER_HANDOVER: 'Line manager departure notice',
  RETURN_ITEMS_CHECKLIST: 'Exit checklist for return items',
  SAGICOR_GROUP_HEALTH_REMOVAL: 'Group health removal notice (Sagicor)',
  NCB_GROUP_LIFE_REMOVAL: 'Group life removal notice (NCB)',
  SURVEY_INVITATION_REFERENCE: 'Exit survey reference email',
  MANUAL_EXCEPTION_NOTIFICATION: 'Manual exception notification',
  PAYROLL_OR_BANK_NOTIFICATION: 'Payroll or bank notification',
  OTHER_EXTERNAL_OFFBOARDING_NOTIFICATION: 'External provider notification',
};

function notificationActionLabel(notificationType: string): string {
  return NOTIFICATION_ACTION_LABELS[notificationType] ?? sentenceCase(notificationType);
}

export interface UpcomingAutomationItem {
  key: string;
  caseId: string;
  caseNumber: string;
  /** Business-language label, e.g. "IT access-removal email". */
  label: string;
  /** When the platform will act; null when the item is queued without one. */
  scheduledAt: Date | null;
  state: 'Scheduled' | 'Awaiting review';
  href: string;
}

/**
 * Directive 6.3 (Z): "Upcoming automations" - what the platform will do in
 * the next 7 days without HR input, plus prepared email actions awaiting a
 * human review. Ordered by time, capped at 15. Visibility-filtered like every
 * other dashboard query.
 */
export async function upcomingAutomations(actor: Actor): Promise<UpcomingAutomationItem[]> {
  if (!can(actor, 'baseline.viewDashboard')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const caseVis = { case: { is: hrVisibilityWhere(actor) } };
  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 86_400_000);

  const [scheduled, awaitingReview, outboxPending, surveysDue] = await Promise.all([
    prisma.notificationRecord.findMany({
      where: { ...caseVis, status: 'APPROVED', scheduledSendAt: { gte: now, lte: in7d } },
      select: {
        id: true,
        notificationType: true,
        scheduledSendAt: true,
        case: { select: { id: true, caseNumber: true } },
      },
      orderBy: { scheduledSendAt: 'asc' },
      take: 15,
    }),
    // Prepared email actions held for HR review (control level below
    // AUTO_SEND; manual records with no snapshot level also await review).
    prisma.notificationRecord.findMany({
      where: {
        ...caseVis,
        status: 'PENDING_APPROVAL',
        OR: [{ controlLevel: null }, { controlLevel: { not: 'AUTO_SEND' } }],
      },
      select: {
        id: true,
        notificationType: true,
        scheduledSendAt: true,
        case: { select: { id: true, caseNumber: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 15,
    }),
    prisma.notificationOutbox.findMany({
      where: {
        status: 'PENDING',
        nextAttemptAt: { gt: now },
        notificationRecord: { is: caseVis },
      },
      select: {
        id: true,
        notificationRecordId: true,
        nextAttemptAt: true,
        notificationRecord: {
          select: { notificationType: true, case: { select: { id: true, caseNumber: true } } },
        },
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: 15,
    }),
    prisma.surveyInvitation.findMany({
      where: { ...caseVis, status: 'PENDING', invitationDueAt: { gte: now, lte: in7d } },
      select: {
        id: true,
        invitationDueAt: true,
        case: { select: { id: true, caseNumber: true } },
      },
      orderBy: { invitationDueAt: 'asc' },
      take: 15,
    }),
  ]);

  // An APPROVED record and its own outbox row are one automation, not two.
  const seenRecordIds = new Set([...scheduled, ...awaitingReview].map((r) => r.id));
  const items: UpcomingAutomationItem[] = [
    ...scheduled.map((r) => ({
      key: `notification-${r.id}`,
      caseId: r.case.id,
      caseNumber: r.case.caseNumber,
      label: notificationActionLabel(r.notificationType),
      scheduledAt: r.scheduledSendAt,
      state: 'Scheduled' as const,
      href: `/cases/${r.case.id}/notifications`,
    })),
    ...awaitingReview.map((r) => ({
      key: `notification-${r.id}`,
      caseId: r.case.id,
      caseNumber: r.case.caseNumber,
      label: notificationActionLabel(r.notificationType),
      scheduledAt: r.scheduledSendAt,
      state: 'Awaiting review' as const,
      href: `/cases/${r.case.id}/notifications`,
    })),
    ...outboxPending
      .filter((o) => !seenRecordIds.has(o.notificationRecordId))
      .map((o) => ({
        key: `outbox-${o.id}`,
        caseId: o.notificationRecord.case.id,
        caseNumber: o.notificationRecord.case.caseNumber,
        label: notificationActionLabel(o.notificationRecord.notificationType),
        scheduledAt: o.nextAttemptAt,
        state: 'Scheduled' as const,
        href: `/cases/${o.notificationRecord.case.id}/notifications`,
      })),
    ...surveysDue.map((s) => ({
      key: `survey-${s.id}`,
      caseId: s.case.id,
      caseNumber: s.case.caseNumber,
      label: 'Exit survey invitation',
      scheduledAt: s.invitationDueAt,
      state: 'Scheduled' as const,
      href: `/cases/${s.case.id}/survey`,
    })),
  ];
  return items
    .sort(
      (a, b) =>
        (a.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (b.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, 15);
}
