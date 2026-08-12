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
  'CASE' | 'DOCUMENTS' | 'HANDOVER' | 'IT' | 'FINANCE' | 'ASSETS' | 'SURVEY' | 'CLEARANCE';

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
      classification: true,
      participants: { where: { removedAt: null }, select: { userId: true } },
    },
  });
  if (!c) throw ServiceError.notFound();
  const ctx: CaseAccessContext = {
    ownerId: c.ownerId,
    classification: c.classification,
    participantUserIds: c.participants.map((p) => p.userId),
  };
  if (!canViewCase(actor, ctx)) {
    if (canDiscoverCase(actor, ctx)) throw ServiceError.forbidden();
    throw ServiceError.notFound();
  }

  const now = new Date();
  const [tasksByDept, documents, handover, assets, invitations, clearance, taskCounts] =
    await Promise.all([
      prisma.workflowTask.groupBy({
        by: ['department', 'status'],
        where: { caseId },
        _count: { _all: true },
      }),
      prisma.documentInstance.findMany({ where: { caseId }, select: { status: true } }),
      prisma.handoverRecord.findUnique({
        where: { caseId },
        select: { status: true, requiredForClearance: true, notApplicableReason: true },
      }),
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
    ]);
  const [openRequiredTasks, overdueTasks, blockedTasks] = taskCounts;

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

  const handoverState: { state: ProgressState; detail: string } = !handover
    ? { state: 'NOT_STARTED', detail: 'Created at activation' }
    : handover.status === 'COMPLETED'
      ? { state: 'COMPLETED', detail: 'Manager attested' }
      : handover.status === 'NOT_APPLICABLE' || handover.status === 'WAIVED'
        ? { state: 'NOT_APPLICABLE', detail: handover.status.replaceAll('_', ' ').toLowerCase() }
        : handover.status === 'NOT_STARTED'
          ? { state: 'NOT_STARTED', detail: 'Not started' }
          : { state: 'IN_PROGRESS', detail: handover.status.replaceAll('_', ' ').toLowerCase() };

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

  const base = `/cases/${caseId}`;
  const stages: ProgressStage[] = [
    { key: 'CASE', label: 'Case', ...caseState, href: base },
    { key: 'DOCUMENTS', label: 'Documents', ...docState, href: `${base}/documents` },
    { key: 'HANDOVER', label: 'Handover', ...handoverState, href: `${base}/handover` },
    { key: 'IT', label: 'IT', ...deptState('IT'), href: `${base}/workflow` },
    { key: 'FINANCE', label: 'Finance', ...deptState('FINANCE'), href: `${base}/workflow` },
    { key: 'ASSETS', label: 'Assets', ...assetState, href: `${base}/assets` },
    { key: 'SURVEY', label: 'Survey', ...surveyState, href: `${base}/survey` },
    { key: 'CLEARANCE', label: 'Clearance', ...clearanceState, href: `${base}/clearance` },
  ];
  const nextAction = computeCaseNextAction(caseId, {
    status: c.status,
    stages,
    openRequiredTasks,
    overdueTasks,
    blockedTasks,
  });
  return { stages, nextAction };
}
