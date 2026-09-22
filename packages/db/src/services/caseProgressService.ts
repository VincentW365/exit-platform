/**
 * Case progress summary (Directive 6.1 section AC).
 *
 * A high-level, clickable stage strip for the case header. Summary only -
 * it never forces workflows into a sequence, and NOT_APPLICABLE is a first-
 * class state. Visibility follows the case exactly like getCase.
 */
import {
  canDiscoverCase,
  canViewCase,
  computeCaseNextAction,
  OPEN_TASK_STATUSES,
  type Actor,
  type CaseAccessContext,
  type CaseNextAction,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';

export type ProgressStageKey =
  | 'CASE'
  | 'DOCUMENTS'
  | 'IT'
  | 'FINANCE'
  | 'EMAIL_ACTIONS'
  | 'BENEFITS'
  | 'ASSETS'
  | 'SURVEY'
  | 'CLEARANCE';

export type ProgressState =
  'COMPLETED' | 'IN_PROGRESS' | 'BLOCKED' | 'NOT_STARTED' | 'NOT_APPLICABLE';

export interface ProgressStage {
  key: ProgressStageKey;
  label: string;
  state: ProgressState;
  detail: string;
  href: string;
}

export interface CaseProgressSummary {
  stages: ProgressStage[];
  nextAction: CaseNextAction | null;
}

/** Back-compatible stage list (see caseProgressSummary for the full payload). */
export async function caseProgress(actor: Actor, caseId: string): Promise<ProgressStage[]> {
  return (await caseProgressSummary(actor, caseId)).stages;
}

export async function caseProgressSummary(
  actor: Actor,
  caseId: string,
): Promise<CaseProgressSummary> {
  const prisma = getPrisma();
  const c = await prisma.offboardingCase.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      status: true,
      ownerId: true,
      assignedOfficerId: true,
      classification: true,
      groupHealthApplicability: true,
      groupLifeApplicability: true,
      otherProviderApplicability: true,
      participants: { where: { removedAt: null }, select: { userId: true } },
    },
  });
  if (!c) throw ServiceError.notFound();
  const ctx: CaseAccessContext = {
    ownerId: c.ownerId,
    assignedOfficerId: c.assignedOfficerId,
    classification: c.classification,
    participantUserIds: c.participants.map((p) => p.userId),
  };
  if (!canViewCase(actor, ctx)) {
    if (canDiscoverCase(actor, ctx)) throw ServiceError.forbidden();
    throw ServiceError.notFound();
  }

  const now = new Date();
  const [
    tasksByDept,
    documents,
    assets,
    invitations,
    clearance,
    taskCounts,
    emailEvidence,
    approvedEmailExceptions,
    attentionExceptions,
  ] = await Promise.all([
    prisma.workflowTask.groupBy({
      by: ['department', 'status'],
      where: { caseId },
      _count: { _all: true },
    }),
    prisma.documentInstance.findMany({ where: { caseId }, select: { status: true } }),
    prisma.assetRecoveryItem.findMany({ where: { caseId }, select: { status: true } }),
    prisma.surveyInvitation.findMany({
      where: { caseId },
      select: { status: true, completedAt: true },
    }),
    prisma.clearanceRecord.count({ where: { caseId } }),
    Promise.all([
      prisma.workflowTask.count({
        where: { caseId, required: true, status: { in: [...OPEN_TASK_STATUSES] } },
      }),
      prisma.workflowTask.count({
        where: { caseId, status: { in: [...OPEN_TASK_STATUSES] }, dueAt: { lt: now } },
      }),
      prisma.workflowTask.count({ where: { caseId, status: 'BLOCKED' } }),
    ]),
    // Directive 6.3: the current workflow reaches IT/Finance by controlled
    // email; stage state comes from the derived records' evidence.
    prisma.notificationRecord.findMany({
      where: {
        caseId,
        origin: 'DERIVED',
        notificationType: { in: ['IT_ACCESS_REMOVAL', 'FINANCE_OFFBOARDING'] },
      },
      select: {
        id: true,
        notificationType: true,
        status: true,
        sentAt: true,
        manualSentAt: true,
        acknowledgedAt: true,
        completionConfirmedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    // Management-approved exceptions stand in for missing completion
    // evidence (same posture as the clearance gate).
    prisma.caseException.findMany({
      where: {
        caseId,
        status: 'RESOLVED',
        securityExceptionApproved: true,
        exceptionType: {
          in: ['ACKNOWLEDGEMENT_OVERDUE', 'AUTO_SEND_BLOCKED', 'RECIPIENT_MISSING'],
        },
      },
      select: { refId: true },
    }),
    // Directive 6.3 X: open items that need a human decision right now -
    // the newest becomes the case's next action.
    prisma.caseException.findMany({
      where: {
        caseId,
        status: 'OPEN',
        exceptionType: {
          in: [
            'RECIPIENT_MISSING',
            'BENEFITS_APPLICABILITY_UNKNOWN',
            'ACKNOWLEDGEMENT_OVERDUE',
            'AUTO_SEND_BLOCKED',
            'NOTIFICATION_FAILED',
          ],
        },
      },
      select: { exceptionType: true, title: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const [openRequiredTasks, overdueTasks, blockedTasks] = taskCounts;
  const base = `/cases/${caseId}`;

  const dept = (d: string) => {
    const counts = { open: 0, blocked: 0, done: 0, total: 0 };
    for (const row of tasksByDept) {
      if (row.department !== d) continue;
      const n = row._count._all;
      counts.total += n;
      if (row.status === 'BLOCKED') counts.blocked += n;
      else if (['COMPLETED', 'WAIVED', 'CANCELLED'].includes(row.status)) counts.done += n;
      else counts.open += n;
    }
    return counts;
  };
  const deptState = (d: string): { state: ProgressState; detail: string } => {
    const s = dept(d);
    if (s.total === 0) return { state: 'NOT_APPLICABLE', detail: 'No tasks in this workflow' };
    if (s.blocked > 0) return { state: 'BLOCKED', detail: `${s.blocked} blocked task(s)` };
    if (s.open === 0) return { state: 'COMPLETED', detail: `${s.done} of ${s.total} done` };
    if (s.done > 0 || c.status !== 'APPROVED')
      return { state: 'IN_PROGRESS', detail: `${s.done} of ${s.total} done` };
    return { state: 'NOT_STARTED', detail: `${s.total} task(s) planned` };
  };

  // Older cases still carry IT/Finance login tasks (legacy workflow) and stay
  // task-based; current cases have none and progress by controlled-email
  // evidence instead (Directive 6.3 - IT/Finance never sign in).
  const approvedExceptionRefs = new Set(
    approvedEmailExceptions.map((e) => e.refId).filter((id): id is string => id !== null),
  );
  const liveEmailRecord = (type: 'IT_ACCESS_REMOVAL' | 'FINANCE_OFFBOARDING') =>
    emailEvidence.find(
      (r) => r.notificationType === type && !['CANCELLED', 'SUPERSEDED'].includes(r.status),
    ) ??
    emailEvidence.find((r) => r.notificationType === type) ??
    null;

  const itEmailState = (): { state: ProgressState; detail: string } => {
    // IT access removal always applies - the stage is never "not applicable".
    const r = liveEmailRecord('IT_ACCESS_REMOVAL');
    if (!r) return { state: 'NOT_STARTED', detail: 'Notification prepared at activation' };
    if (r.completionConfirmedAt)
      return { state: 'COMPLETED', detail: 'Access removal confirmed by IT' };
    if (approvedExceptionRefs.has(r.id))
      return { state: 'COMPLETED', detail: 'Closed by a management-approved exception' };
    if (r.acknowledgedAt)
      return { state: 'IN_PROGRESS', detail: 'Acknowledged - awaiting completion confirmation' };
    if (r.sentAt ?? r.manualSentAt)
      return { state: 'IN_PROGRESS', detail: 'Notification sent - awaiting IT response' };
    return { state: 'NOT_STARTED', detail: 'Automated notification not yet sent' };
  };

  const financeEmailState = (): { state: ProgressState; detail: string } => {
    const r = liveEmailRecord('FINANCE_OFFBOARDING');
    if (!r) return { state: 'NOT_STARTED', detail: 'Notification prepared at activation' };
    if (r.sentAt ?? r.manualSentAt)
      return { state: 'COMPLETED', detail: 'Finance notified by controlled email' };
    return { state: 'IN_PROGRESS', detail: 'Automated notification not yet sent' };
  };

  const legacyIt = dept('IT').total > 0;
  const legacyFinance = dept('FINANCE').total > 0;

  // IT and Finance no longer sign in or hold a queue, so the case Overview
  // stopped carrying a chip for each of them (owner request, 2026-08-19).
  // Their controlled emails progress as one item that links to the Email
  // Actions tab. Legacy cases whose pinned workflow really did create IT and
  // Finance task queues keep their own chips so old records still read true.
  const departmentStages: ProgressStage[] = [];
  if (legacyIt)
    departmentStages.push({
      key: 'IT',
      label: 'IT',
      ...deptState('IT'),
      href: `${base}/workflow`,
    });
  if (legacyFinance)
    departmentStages.push({
      key: 'FINANCE',
      label: 'Finance',
      ...deptState('FINANCE'),
      href: `${base}/workflow`,
    });
  if (!legacyIt || !legacyFinance) {
    const parts = [
      ...(legacyIt ? [] : [itEmailState()]),
      ...(legacyFinance ? [] : [financeEmailState()]),
    ];
    const worst: ProgressState = parts.some((s) => s.state === 'BLOCKED')
      ? 'BLOCKED'
      : parts.some((s) => s.state === 'NOT_STARTED')
        ? 'NOT_STARTED'
        : parts.some((s) => s.state === 'IN_PROGRESS')
          ? 'IN_PROGRESS'
          : 'COMPLETED';
    const detail =
      worst === 'COMPLETED'
        ? 'Department notifications complete'
        : (parts.find((s) => s.state === worst)?.detail ?? 'Awaiting automated notifications');
    departmentStages.push({
      key: 'EMAIL_ACTIONS',
      label: 'Email Actions',
      state: worst,
      detail,
      href: `${base}/notifications`,
    });
  }

  // Benefits & providers (Directive 6.3 V): confirmed once by HR; anything
  // still unknown keeps the stage open.
  const benefitsUnknowns = [
    c.groupHealthApplicability,
    c.groupLifeApplicability,
    c.otherProviderApplicability,
  ].filter((v) => v === 'UNKNOWN').length;
  const benefitsState: { state: ProgressState; detail: string } =
    benefitsUnknowns === 0
      ? { state: 'COMPLETED', detail: 'Applicability confirmed for all providers' }
      : {
          state: 'IN_PROGRESS',
          detail: `${benefitsUnknowns} determination(s) to confirm`,
        };

  const caseState: { state: ProgressState; detail: string } =
    c.status === 'COMPLETED'
      ? { state: 'COMPLETED', detail: 'Case completed' }
      : ['CANCELLED', 'VOIDED'].includes(c.status)
        ? { state: 'NOT_APPLICABLE', detail: `Case ${c.status.toLowerCase()}` }
        : ['ACTIVE', 'ON_HOLD', 'CLEARANCE_REVIEW', 'REOPENED'].includes(c.status)
          ? { state: 'IN_PROGRESS', detail: c.status.replaceAll('_', ' ').toLowerCase() }
          : { state: 'NOT_STARTED', detail: c.status.replaceAll('_', ' ').toLowerCase() };

  const docState: { state: ProgressState; detail: string } = (() => {
    const active = documents.filter((d) => !['SUPERSEDED', 'VOIDED'].includes(d.status));
    if (active.length === 0) return { state: 'NOT_STARTED', detail: 'No documents yet' } as const;
    const done = active.filter((d) => ['RENDERED', 'MANUALLY_ISSUED'].includes(d.status));
    if (done.length === active.length)
      return { state: 'COMPLETED', detail: `${done.length} finalized` } as const;
    return {
      state: 'IN_PROGRESS',
      detail: `${done.length} of ${active.length} finalized`,
    } as const;
  })();

  const assetState: { state: ProgressState; detail: string } = (() => {
    if (assets.length === 0)
      return { state: 'NOT_APPLICABLE', detail: 'No issued assets' } as const;
    const unresolved = assets.filter((a) =>
      ['EXPECTED', 'REQUESTED', 'PARTIALLY_RETURNED', 'UNRESOLVED'].includes(a.status),
    );
    if (unresolved.length === 0)
      return { state: 'COMPLETED', detail: `${assets.length} resolved` } as const;
    return {
      state: 'IN_PROGRESS',
      detail: `${assets.length - unresolved.length} of ${assets.length} resolved`,
    } as const;
  })();

  const surveyState: { state: ProgressState; detail: string } = (() => {
    if (invitations.length === 0) return { state: 'NOT_STARTED', detail: 'No invitation' } as const;
    if (invitations.some((i) => i.completedAt))
      return { state: 'COMPLETED', detail: 'Response received' } as const;
    if (
      invitations.every((i) =>
        ['CANCELLED', 'NOT_ELIGIBLE', 'EXPIRED', 'DECLINED', 'INVALID_CONTACT'].includes(i.status),
      )
    )
      return { state: 'NOT_APPLICABLE', detail: 'Closed without response' } as const;
    return { state: 'IN_PROGRESS', detail: 'Invitation open' } as const;
  })();

  const clearanceState: { state: ProgressState; detail: string } =
    clearance > 0
      ? { state: 'COMPLETED', detail: 'Clearance approved' }
      : c.status === 'CLEARANCE_REVIEW'
        ? { state: 'IN_PROGRESS', detail: 'Under review' }
        : { state: 'NOT_STARTED', detail: 'Not yet requested' };

  const stages: ProgressStage[] = [
    { key: 'CASE', label: 'Case', ...caseState, href: base },
    { key: 'DOCUMENTS', label: 'Documents', ...docState, href: `${base}/documents` },
    ...departmentStages,
    { key: 'BENEFITS', label: 'Benefits', ...benefitsState, href: base },
    { key: 'ASSETS', label: 'Assets', ...assetState, href: `${base}/assets` },
    { key: 'SURVEY', label: 'Survey', ...surveyState, href: `${base}/survey` },
    { key: 'CLEARANCE', label: 'Clearance', ...clearanceState, href: `${base}/clearance` },
  ];
  // Exception-first next action (Directive 6.3 X): the newest open item that
  // needs a human decision beats routine open work.
  const firstAttention = attentionExceptions[0] ?? null;
  const nextAction = computeCaseNextAction(caseId, {
    status: c.status,
    stages,
    openRequiredTasks,
    overdueTasks,
    blockedTasks,
    attentionCount: attentionExceptions.length,
    firstAttentionLabel: firstAttention?.title,
    firstAttentionHref: firstAttention
      ? firstAttention.exceptionType === 'BENEFITS_APPLICABILITY_UNKNOWN'
        ? base
        : `${base}/notifications`
      : undefined,
  });
  return { stages, nextAction };
}
