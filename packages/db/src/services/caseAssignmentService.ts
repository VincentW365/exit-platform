/**
 * Case assignment plan (Directive 6.1 sections E/F/J).
 *
 * HR ownership (accountable HR Manager + operational HR Officer), manager
 * routing derived from the synchronized directory with audited override, and
 * the pre-activation OFFBOARDING ASSIGNMENT PLAN with its six required
 * confirmations. Every change answers: who had it, who has it, who changed
 * it, why, and when (M).
 */
import {
  activationConfirmationErrors,
  canActOnCase,
  canDiscoverCase,
  canViewCase,
  computeTaskDue,
  confirmationErrors,
  CONFIRMATION_KEYS,
  CONFIRMATION_LABELS,
  hasRole,
  type Actor,
  type CaseAccessContext,
  type ConfirmationKey,
  type ConfirmationState,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { getActiveCalendarInfo } from './adminService.ts';
import { resolveDirectoryManager } from './managerResolution.ts';

async function loadCase(caseId: string) {
  const prisma = getPrisma();
  const c = await prisma.offboardingCase.findUnique({
    where: { id: caseId },
    include: {
      participants: { where: { removedAt: null } },
      assignedOfficer: { select: { id: true, displayName: true, isActive: true } },
      managerUser: { select: { id: true, displayName: true, workEmail: true, isActive: true } },
      owner: { select: { id: true, displayName: true } },
    },
  });
  if (!c) throw ServiceError.notFound();
  const ctx: CaseAccessContext = {
    ownerId: c.ownerId,
    classification: c.classification,
    participantUserIds: c.participants.map((p) => p.userId),
  };
  return { c, ctx };
}

function assertView(actor: Actor, ctx: CaseAccessContext): void {
  if (canViewCase(actor, ctx)) return;
  if (canDiscoverCase(actor, ctx)) throw ServiceError.forbidden();
  throw ServiceError.notFound();
}

async function activeUsersWithRole(role: string) {
  const prisma = getPrisma();
  return prisma.user.findMany({
    where: { isActive: true, roleAssignments: { some: { role: role as never, revokedAt: null } } },
    select: { id: true, displayName: true, department: true },
    orderBy: { displayName: 'asc' },
  });
}

export interface AssignmentPlan {
  caseId: string;
  caseNumber: string;
  status: string;
  employee: {
    displayName: string;
    sourceId: string;
    sourceSystem: string;
    jobTitle: string | null;
    department: string;
    location: string;
    division: string | null;
    employmentActive: boolean | null;
    lastSyncedAt: Date | null;
  };
  management: {
    managerName: string | null;
    managerSourceId: string | null;
    managerJobTitle: string | null;
    managerUser: { id: string; displayName: string; isActive: boolean } | null;
    managerSource: string | null;
    secondLevelManagerName: string | null;
    confirmedAt: Date | null;
    changeFlaggedAt: Date | null;
    missing: boolean;
  };
  hr: {
    accountableOwner: { id: string; displayName: string };
    assignedOfficer: { id: string; displayName: string } | null;
  };
  responders: {
    it: Array<{ id: string; displayName: string; openTasks: number }>;
    finance: Array<{ id: string; displayName: string; openTasks: number }>;
    managers: Array<{ id: string; displayName: string }>;
    officers: Array<{ id: string; displayName: string }>;
  };
  workflow: {
    departureType: string;
    workflowName: string | null;
    workflowVersion: number | null;
    confirmedLastDay: Date | null;
    effectiveSeparationAt: Date | null;
    classification: string;
    recordPurpose: string;
    taskSummary: Array<{
      title: string;
      taskCode: string;
      department: string;
      required: boolean;
      priority: string;
      dueAt: Date | null;
      dueRule: string | null;
      dependsOn: readonly string[];
      owningQueue: string;
      assignee: string;
    }>;
  };
  confirmations: {
    keys: ReadonlyArray<{ key: ConfirmationKey; label: string; at: string | null }>;
    complete: boolean;
  };
  blockers: string[];
  canAssignOfficer: boolean;
  canOverrideManager: boolean;
  canConfirm: boolean;
}

/** J: everything the OFFBOARDING ASSIGNMENT PLAN page renders. */
export async function getAssignmentPlan(actor: Actor, caseId: string): Promise<AssignmentPlan> {
  const { c, ctx } = await loadCase(caseId);
  assertView(actor, ctx);
  const prisma = getPrisma();

  const sourceRow = await prisma.employeeSourceRecord.findUnique({
    where: {
      sourceSystem_sourceId: {
        sourceSystem: c.employeeSourceSystem,
        sourceId: c.employeeSourceId,
      },
    },
    select: { division: true, active: true, lastSyncedAt: true },
  });
  const managerRow = c.managerSourceId
    ? await prisma.employeeSourceRecord.findUnique({
        where: {
          sourceSystem_sourceId: {
            sourceSystem: c.employeeSourceSystem,
            sourceId: c.managerSourceId,
          },
        },
        select: { jobTitle: true, managerName: true },
      })
    : null;

  const [itUsers, financeUsers, managerUsers, officerOnly, hrManagers] = await Promise.all([
    activeUsersWithRole('IT_RESPONDER'),
    activeUsersWithRole('FINANCE_RESPONDER'),
    activeUsersWithRole('LINE_MANAGER'),
    activeUsersWithRole('HR_OFFICER'),
    activeUsersWithRole('HR_MANAGER'),
  ]);
  // Small-team reality: an HR Manager may hold operational ownership too.
  const officerUsers = [
    ...officerOnly,
    ...hrManagers.filter((m) => !officerOnly.some((o) => o.id === m.id)),
  ].sort((a, b) => a.displayName.localeCompare(b.displayName));
  // Workload indicator (J): open assigned tasks per responder.
  const openCounts = await prisma.workflowTask.groupBy({
    by: ['assigneeId'],
    where: {
      assigneeId: { in: [...itUsers, ...financeUsers].map((u) => u.id) },
      status: { in: ['READY', 'IN_PROGRESS', 'BLOCKED'] },
    },
    _count: { _all: true },
  });
  const countFor = (id: string) => openCounts.find((o) => o.assigneeId === id)?._count._all ?? 0;

  const activeDef = await prisma.workflowDefinition.findFirst({
    where: { workflowType: c.departureType as never, status: 'ACTIVE' },
    include: { taskDefs: { where: { enabled: true }, orderBy: { sortOrder: 'asc' } } },
  });
  // Projected due instants use the SAME calendar logic activation will use;
  // "now" stands in for the activation anchor until the case activates.
  const { calendar: planCalendar } = await getActiveCalendarInfo();
  const planDates = {
    receivedAt: c.receivedAt,
    activationAt: new Date(),
    effectiveSeparationAt: c.effectiveSeparationAt,
    confirmedLastDay: c.confirmedLastDay,
  };

  const confirmations = (c.activationConfirmations ?? {}) as ConfirmationState;
  const managerMissing = !c.managerUserId;

  const blockers: string[] = [];
  if (!c.assignedOfficerId)
    blockers.push('HR Officer not assigned (HR Manager assigns on this tab).');
  if (managerMissing)
    blockers.push(
      c.managerName
        ? `Directory manager "${c.managerName}" has no active application account with the LINE_MANAGER role - override with an alternate manager.`
        : 'MISSING MANAGER — ACTION REQUIRED: the directory records no manager for this employee; assign an alternate manager.',
    );
  const confErrors = activationConfirmationErrors(confirmations, c.managerChangeFlaggedAt ?? null);
  blockers.push(...confErrors);
  if (!activeDef) blockers.push('No ACTIVE workflow definition exists for this departure type.');

  return {
    caseId: c.id,
    caseNumber: c.caseNumber,
    status: c.status,
    employee: {
      displayName: c.employeeDisplayName,
      sourceId: c.employeeSourceId,
      sourceSystem: c.employeeSourceSystem,
      jobTitle: c.jobTitle,
      department: c.department,
      location: c.location,
      division: sourceRow?.division ?? null,
      employmentActive: sourceRow?.active ?? null,
      lastSyncedAt: sourceRow?.lastSyncedAt ?? null,
    },
    management: {
      managerName: c.managerName,
      managerSourceId: c.managerSourceId,
      managerJobTitle: managerRow?.jobTitle ?? null,
      managerUser: c.managerUser
        ? {
            id: c.managerUser.id,
            displayName: c.managerUser.displayName,
            isActive: c.managerUser.isActive,
          }
        : null,
      managerSource: c.managerSource,
      secondLevelManagerName: managerRow?.managerName ?? null,
      confirmedAt: c.managerConfirmedAt,
      changeFlaggedAt: c.managerChangeFlaggedAt,
      missing: managerMissing,
    },
    hr: {
      accountableOwner: { id: c.owner.id, displayName: c.owner.displayName },
      assignedOfficer: c.assignedOfficer
        ? { id: c.assignedOfficer.id, displayName: c.assignedOfficer.displayName }
        : null,
    },
    responders: {
      it: itUsers.map((u) => ({ id: u.id, displayName: u.displayName, openTasks: countFor(u.id) })),
      finance: financeUsers.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        openTasks: countFor(u.id),
      })),
      managers: managerUsers.map((u) => ({ id: u.id, displayName: u.displayName })),
      officers: officerUsers.map((u) => ({ id: u.id, displayName: u.displayName })),
    },
    workflow: {
      departureType: c.departureType,
      workflowName: activeDef?.name ?? null,
      workflowVersion: activeDef?.version ?? null,
      confirmedLastDay: c.confirmedLastDay,
      effectiveSeparationAt: c.effectiveSeparationAt,
      classification: c.classification,
      recordPurpose: c.recordPurpose,
      // Directive 6.2 (L): the responsibility plan resolves each task's
      // owning queue, individual assignee, projected due instant (via the
      // same calendar logic activation uses) and dependency.
      taskSummary: (activeDef?.taskDefs ?? []).map((t) => {
        const due = computeTaskDue(t, planDates, planCalendar);
        return {
          title: t.title,
          taskCode: t.taskCode,
          department: t.department,
          required: t.required,
          priority: t.priority,
          dueAt: due.dueAt,
          dueRule: due.rule,
          dependsOn: t.dependsOnCodes ?? [],
          owningQueue: t.department === 'LINE_MANAGER' ? 'Manager' : `${t.department} queue`,
          assignee:
            t.department === 'LINE_MANAGER'
              ? (c.managerUser?.displayName ?? 'MISSING MANAGER')
              : t.department === 'HR'
                ? (c.assignedOfficer?.displayName ?? 'Assigned HR Officer')
                : 'Unassigned (claim from queue)',
        };
      }),
    },
    confirmations: {
      keys: CONFIRMATION_KEYS.map((key) => ({
        key,
        label: CONFIRMATION_LABELS[key],
        at: confirmations[key]?.at ?? null,
      })),
      complete: confErrors.length === 0,
    },
    blockers,
    canAssignOfficer: canActOnCase(actor, 'case.assignOfficer', ctx),
    canOverrideManager: canActOnCase(actor, 'case.assignOfficer', ctx),
    canConfirm: canActOnCase(actor, 'case.confirmAssignment', ctx),
  };
}

/** E: manual HR-officer assignment/reassignment by the HR Manager. */
export async function assignOfficer(
  actor: Actor,
  caseId: string,
  officerUserId: string,
  reason: string,
): Promise<void> {
  const { c, ctx } = await loadCase(caseId);
  assertView(actor, ctx);
  if (!canActOnCase(actor, 'case.assignOfficer', ctx)) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required (audited).']);
  if (['COMPLETED', 'CANCELLED', 'VOIDED'].includes(c.status))
    throw ServiceError.validation(['Closed cases cannot be reassigned.']);
  const prisma = getPrisma();
  const target = await prisma.user.findUnique({
    where: { id: officerUserId },
    include: { roleAssignments: { where: { revokedAt: null }, select: { role: true } } },
  });
  if (!target || !target.isActive)
    throw ServiceError.validation(['The selected user does not exist or is inactive.']);
  const roles = target.roleAssignments.map((r) => r.role as string);
  if (!roles.includes('HR_OFFICER') && !roles.includes('HR_MANAGER'))
    throw ServiceError.validation([
      'The operational owner must hold the HR_OFFICER (or HR_MANAGER) role.',
    ]);

  const previous = c.assignedOfficer;
  const isReassignment = Boolean(previous) && previous!.id !== officerUserId;
  if (previous?.id === officerUserId)
    throw ServiceError.validation(['That officer is already assigned to this case.']);
  const correlationId = newCorrelationId();
  // Outstanding tasks that travel with the officer (E: recorded, not moved -
  // HR tasks are queue-scoped; the count is evidence for the reassignment).
  const outstanding = await prisma.workflowTask.count({
    where: { caseId, department: 'HR', status: { in: ['READY', 'IN_PROGRESS', 'BLOCKED'] } },
  });

  await prisma.$transaction(async (tx) => {
    await tx.offboardingCase.update({
      where: { id: caseId },
      data: { assignedOfficerId: officerUserId, version: { increment: 1 } },
    });
    // The operational officer participates as HR_SUPPORT (needed for
    // restricted-case participation checks); idempotent.
    const existing = await tx.caseParticipant.findFirst({
      where: { caseId, userId: officerUserId, removedAt: null },
    });
    if (!existing) {
      await tx.caseParticipant.create({
        data: {
          caseId,
          userId: officerUserId,
          participantRole: 'HR_SUPPORT',
          reason: 'Assigned operational HR Officer (Directive 6.1 E).',
          addedById: actor.userId,
        },
      });
    }
    await appendAudit(tx, {
      eventType: isReassignment ? 'CASE_OFFICER_REASSIGNED' : 'CASE_OFFICER_ASSIGNED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'OffboardingCase',
      objectId: caseId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        caseNumber: c.caseNumber,
        previousOfficerId: previous?.id ?? null,
        previousOfficerName: previous?.displayName ?? null,
        newOfficerId: officerUserId,
        newOfficerName: target.displayName,
        reason,
        outstandingHrTasks: outstanding,
      },
    });
  });
}

/** F: re-derive the manager from the current directory state (HR on case). */
export async function refreshManagerFromDirectory(actor: Actor, caseId: string): Promise<void> {
  const { c, ctx } = await loadCase(caseId);
  assertView(actor, ctx);
  if (!canActOnCase(actor, 'case.manageManager', ctx)) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const { managerName, managerSourceId, managerUserId, lastSyncedAt } =
    await resolveDirectoryManager(c.employeeSourceSystem, c.employeeSourceId);
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.offboardingCase.update({
      where: { id: caseId },
      data: {
        managerName,
        managerSourceId,
        managerUserId,
        managerSource: managerName || managerSourceId ? 'DIRECTORY' : null,
        managerChangeFlaggedAt: null,
        version: { increment: 1 },
      },
    });
    await appendAudit(tx, {
      eventType: 'CASE_MANAGER_DERIVED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'OffboardingCase',
      objectId: caseId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        caseNumber: c.caseNumber,
        managerName,
        managerSourceId,
        resolvedUserId: managerUserId,
        sourceSystem: c.employeeSourceSystem,
        lastSyncedAt,
        refresh: true,
      },
    });
  });
}

/**
 * F: audited manager override - the HR Manager routes manager-owned work to
 * an alternate LINE_MANAGER account (missing manager, or business decision).
 */
export async function overrideManager(
  actor: Actor,
  caseId: string,
  managerUserId: string,
  reason: string,
): Promise<void> {
  const { c, ctx } = await loadCase(caseId);
  assertView(actor, ctx);
  // Override is HR-Manager authority (stricter than case.manageManager).
  if (!hasRole(actor, 'HR_MANAGER') || !canActOnCase(actor, 'case.manageManager', ctx))
    throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required (audited).']);
  const prisma = getPrisma();
  const target = await prisma.user.findUnique({
    where: { id: managerUserId },
    include: { roleAssignments: { where: { revokedAt: null }, select: { role: true } } },
  });
  if (!target || !target.isActive)
    throw ServiceError.validation(['The selected user does not exist or is inactive.']);
  if (!target.roleAssignments.some((r) => r.role === 'LINE_MANAGER'))
    throw ServiceError.validation(['The alternate manager must hold the LINE_MANAGER role.']);

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.offboardingCase.update({
      where: { id: caseId },
      data: {
        managerUserId,
        managerSource: 'OVERRIDE',
        managerChangeFlaggedAt: null,
        version: { increment: 1 },
      },
    });
    await appendAudit(tx, {
      eventType: 'CASE_MANAGER_OVERRIDDEN',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'OffboardingCase',
      objectId: caseId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        caseNumber: c.caseNumber,
        originalManagerName: c.managerName,
        originalManagerUserId: c.managerUserId,
        replacementUserId: managerUserId,
        replacementManagerName: target.displayName,
        reason,
      },
    });
  });
}

/** J: record the six assignment-plan confirmations (all-or-nothing). */
export async function confirmAssignmentPlan(
  actor: Actor,
  caseId: string,
  submitted: readonly string[],
): Promise<void> {
  const { c, ctx } = await loadCase(caseId);
  assertView(actor, ctx);
  if (!canActOnCase(actor, 'case.confirmAssignment', ctx)) throw ServiceError.forbidden();
  const errors = confirmationErrors(submitted);
  if (errors.length) throw ServiceError.validation(errors);
  if (!c.assignedOfficerId)
    throw ServiceError.validation(['Assign the HR Officer before confirming the plan.']);
  if (!c.managerUserId)
    throw ServiceError.validation([
      'Manager routing is unresolved - derive or override the manager before confirming.',
    ]);
  const now = new Date().toISOString();
  const state: ConfirmationState = {};
  for (const key of CONFIRMATION_KEYS) state[key] = { at: now, byId: actor.userId };
  const correlationId = newCorrelationId();
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await tx.offboardingCase.update({
      where: { id: caseId },
      data: {
        activationConfirmations: state as never,
        managerConfirmedAt: new Date(),
        managerConfirmedById: actor.userId,
        managerChangeFlaggedAt: null,
        version: { increment: 1 },
      },
    });
    await appendAudit(tx, {
      eventType: 'CASE_MANAGER_CONFIRMED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'OffboardingCase',
      objectId: caseId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        caseNumber: c.caseNumber,
        confirmations: submitted.length,
        managerUserId: c.managerUserId,
        assignedOfficerId: c.assignedOfficerId,
      },
    });
  });
}
