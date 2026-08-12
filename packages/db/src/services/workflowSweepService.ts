/**
 * Stage 3 worker sweeps (Directive 3 sections N and Q).
 *
 * Every operation is an idempotent, transactionally-claimed state change with
 * a correlation ID and PII-free result counts. The clock is injectable for
 * tests. The sweep never sends email, never revokes live access, never calls
 * an external system (Q requirements).
 */
import {
  businessDaysBetween,
  overdueSeverity,
  DEFAULT_ESCALATION_THRESHOLDS,
  LIVE_INSTANCE_STATUSES,
  OPEN_ASSET_STATUSES,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { getActiveCalendarInfo } from './adminService.ts';
import { getSystemConfigValue } from './systemConfigService.ts';
import { openException } from './exceptionService.ts';
import { refreshClearanceReadiness } from './clearanceService.ts';
import { recalcInstanceCounts, releaseEligibleTasks } from './workflowService.ts';

export interface SweepResult {
  released: number;
  overdueExceptions: number;
  accessEscalations: number;
  notificationOverdue: number;
  assetOverdue: number;
  handoverOverdue: number;
  instancesRecalculated: number;
}

/** One full Stage 3 sweep pass. Safe to run repeatedly and concurrently. */
export async function runStage3Sweep(now: Date = new Date()): Promise<SweepResult> {
  const prisma = getPrisma();
  const result: SweepResult = {
    released: 0,
    overdueExceptions: 0,
    accessEscalations: 0,
    notificationOverdue: 0,
    assetOverdue: 0,
    handoverOverdue: 0,
    instancesRecalculated: 0,
  };
  const { calendar } = await getActiveCalendarInfo();
  // Directive 6.2 (K): configurable escalation thresholds with safe defaults.
  const numCfg = async (key: string, fallback: number): Promise<number> => {
    const v = await getSystemConfigValue(key);
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const thresholds = {
    accessSecondMinutes: await numCfg(
      'escalation.accessSecondMinutes',
      DEFAULT_ESCALATION_THRESHOLDS.accessSecondMinutes,
    ),
    ordinaryEscalateBusinessDays: await numCfg(
      'escalation.ordinaryEscalateBusinessDays',
      DEFAULT_ESCALATION_THRESHOLDS.ordinaryEscalateBusinessDays,
    ),
    ordinaryHighBusinessDays: await numCfg(
      'escalation.ordinaryHighBusinessDays',
      DEFAULT_ESCALATION_THRESHOLDS.ordinaryHighBusinessDays,
    ),
  };

  // 1. Task release: dependencies + release instants (Q "task release").
  const liveInstances = await prisma.workflowInstance.findMany({
    where: { status: { in: [...LIVE_INSTANCE_STATUSES] } },
    select: { id: true, caseId: true, status: true },
    take: 200,
  });
  for (const inst of liveInstances) {
    if (inst.status === 'ON_HOLD') continue;
    result.released += await releaseEligibleTasks(inst.caseId, now);
  }

  // 2. Overdue detection + escalation (sections I.6-I.8 and N).
  const openTasks = await prisma.workflowTask.findMany({
    where: {
      status: { in: ['READY', 'IN_PROGRESS', 'BLOCKED'] },
      dueAt: { lt: now },
      instance: { is: { status: { in: ['ACTIVE', 'CLEARANCE_PENDING'] } } },
    },
    take: 500,
  });
  for (const t of openTasks) {
    const bdOverdue = businessDaysBetween(t.dueAt!, now, calendar);
    const check = overdueSeverity(t, now, bdOverdue, thresholds.ordinaryHighBusinessDays);
    if (!check.overdue || !check.severity) continue;

    if (t.taskKind === 'ACCESS_REVOCATION') {
      // I.6/I.7: CRITICAL immediately at due time; escalate to the assigned
      // responder, HR_MANAGER and the configured IT escalation owner.
      await openException(t.caseId, {
        exceptionType: 'CRITICAL_ACCESS_OVERDUE',
        severity: 'CRITICAL',
        title: `CRITICAL: access revocation overdue (${t.title})`,
        detail: `Due ${t.dueAt!.toISOString()}; assigned responder, HR Manager and the configured IT escalation owner are notified in-app.`,
        refType: 'WorkflowTask',
        refId: t.id,
        ownerDepartment: 'IT',
        ownerId: t.assigneeId ?? undefined,
        dueAt: t.dueAt ?? undefined,
      });
      result.overdueExceptions += 1;

      // Escalation level 1 at due time; level 2 after the configured interval.
      const minutesOverdue = Math.round((now.getTime() - t.dueAt!.getTime()) / 60_000);
      const targetLevel = minutesOverdue >= thresholds.accessSecondMinutes ? 2 : 1;
      if (t.escalationLevel < targetLevel) {
        const updated = await prisma.workflowTask.updateMany({
          where: { id: t.id, escalationLevel: t.escalationLevel },
          data: { escalationLevel: targetLevel, escalatedAt: now, rowVersion: { increment: 1 } },
        });
        if (updated.count > 0) {
          result.accessEscalations += 1;
          await appendAudit(prisma, {
            eventType: 'ACCESS_TASK_ESCALATED',
            actorType: 'SYSTEM',
            objectType: 'WorkflowTask',
            objectId: t.id,
            caseId: t.caseId,
            result: 'SUCCESS',
            correlationId: newCorrelationId(),
            metadata: { level: targetLevel, minutesOverdue },
          });
        }
      }
      continue;
    }

    // Ordinary tasks: WARNING at due; HIGH at 3 business days (N defaults);
    // openException raises severity in place when it strengthens.
    await openException(t.caseId, {
      exceptionType: 'TASK_OVERDUE',
      severity: check.severity,
      title: `Task overdue: ${t.title}`,
      detail: `Due ${t.dueAt!.toISOString()}; ${bdOverdue} business day(s) overdue.`,
      refType: 'WorkflowTask',
      refId: t.id,
      ownerDepartment: t.department,
      ownerId: t.assigneeId ?? undefined,
      dueAt: t.dueAt ?? undefined,
    });
    result.overdueExceptions += 1;

    // N.3: at the configured business-days threshold, escalate to HR_MANAGER
    // + department owner (recorded on the task; surfaced through the feed).
    if (bdOverdue >= thresholds.ordinaryEscalateBusinessDays && t.escalationLevel < 1) {
      await prisma.workflowTask.updateMany({
        where: { id: t.id, escalationLevel: t.escalationLevel },
        data: { escalationLevel: 1, escalatedAt: now, rowVersion: { increment: 1 } },
      });
    }
  }

  // 3. Notification due-state (Q): approved-and-ready items going stale.
  const staleReady = await prisma.notificationRecord.findMany({
    where: {
      status: 'READY_FOR_MANUAL_SEND',
      readyAt: { lt: new Date(now.getTime() - 86_400_000) },
    },
    select: { id: true, caseId: true, notificationType: true },
    take: 100,
  });
  for (const n of staleReady) {
    await openException(n.caseId, {
      exceptionType: 'NOTIFICATION_OVERDUE',
      severity: 'WARNING',
      title: `Notification awaiting manual send: ${n.notificationType}`,
      refType: 'NotificationRecord',
      refId: n.id,
      ownerDepartment: 'HR',
    });
    result.notificationOverdue += 1;
  }

  // 4. Asset overdue detection (Q / L).
  const overdueAssets = await prisma.assetRecoveryItem.findMany({
    where: {
      status: { in: [...OPEN_ASSET_STATUSES] },
      requiredForClearance: true,
      expectedReturnAt: { lt: now },
      case: { is: { status: { in: ['ACTIVE', 'ON_HOLD', 'CLEARANCE_REVIEW'] } } },
    },
    select: { id: true, caseId: true, label: true, expectedReturnAt: true },
    take: 200,
  });
  for (const a of overdueAssets) {
    await openException(a.caseId, {
      exceptionType: 'ASSET_OVERDUE',
      severity: 'WARNING',
      title: `Asset overdue: ${a.label}`,
      detail: `Expected return ${a.expectedReturnAt!.toISOString()}. No payroll effect.`,
      refType: 'AssetRecoveryItem',
      refId: a.id,
      ownerDepartment: 'HR',
      dueAt: a.expectedReturnAt ?? undefined,
    });
    result.assetOverdue += 1;
  }

  // 5. Handover overdue detection (Q / M).
  const overdueHandovers = await prisma.handoverRecord.findMany({
    where: {
      status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
      requiredForClearance: true,
      case: {
        is: { status: { in: ['ACTIVE', 'CLEARANCE_REVIEW'] }, effectiveSeparationAt: { lt: now } },
      },
    },
    select: { id: true, caseId: true },
    take: 200,
  });
  for (const h of overdueHandovers) {
    await openException(h.caseId, {
      exceptionType: 'HANDOVER_OVERDUE',
      severity: 'WARNING',
      title: 'Handover incomplete after the effective separation time',
      refType: 'HandoverRecord',
      refId: h.id,
      ownerDepartment: 'LINE_MANAGER',
    });
    result.handoverOverdue += 1;
  }

  // 6. Counter + clearance-readiness recalculation (Q).
  for (const inst of liveInstances) {
    await recalcInstanceCounts(inst.id, now);
    await refreshClearanceReadiness(inst.caseId);
    result.instancesRecalculated += 1;
  }

  return result;
}
