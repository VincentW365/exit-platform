/**
 * Scheduled report generation (Directive 4 section O).
 *
 * Runs inherit reporting authorization and suppression (the definition
 * creator's authority is re-validated at run time); output lands in
 * generated storage and - in development - the capture mailbox. Nothing is
 * ever sent by live email unless delivery is approved and active.
 */
import { can, isRole, type Actor, type Role } from '@exit/domain';
import { z } from 'zod';
import { getConfig } from '@exit/config';
import { getPrisma } from '../client.ts';
import { getStorage, newPrefixedObjectKey } from '../storage.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { exportReportCsv, REPORT_CATALOG } from './reportingService.ts';

export const scheduleInputSchema = z.object({
  reportKey: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  recipientClass: z.enum([
    'IT_OFFBOARDING',
    'FINANCE_OFFBOARDING',
    'HR_OFFBOARDING',
    'LINE_MANAGER',
    'SAGICOR_GROUP_HEALTH',
    'NCB_GROUP_LIFE',
    'EMPLOYEE_PERSONAL',
    'OTHER_APPROVED_EXTERNAL',
  ]),
  format: z.enum(['CSV']).default('CSV'),
  filters: z.record(z.string(), z.unknown()).default({}),
});

function nextRun(frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY', from: Date): Date {
  const d = new Date(from);
  if (frequency === 'DAILY') d.setDate(d.getDate() + 1);
  else if (frequency === 'WEEKLY') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

export async function createSchedule(actor: Actor, rawInput: unknown) {
  if (!can(actor, 'reports.schedule')) throw ServiceError.forbidden();
  const parsed = scheduleInputSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;
  if (!REPORT_CATALOG.some((r) => r.key === input.reportKey))
    throw ServiceError.validation(['Unknown report key.']);
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  const row = await prisma.$transaction(async (tx) => {
    const schedule = await tx.scheduledReport.create({
      data: {
        reportKey: input.reportKey,
        name: input.name,
        frequency: input.frequency,
        recipientClass: input.recipientClass,
        format: input.format,
        filters: input.filters as never,
        nextRunAt: nextRun(input.frequency, new Date()),
        createdById: actor.userId,
      },
    });
    await appendAudit(tx, {
      eventType: 'REPORT_SCHEDULE_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'ScheduledReport',
      objectId: schedule.id,
      result: 'SUCCESS',
      correlationId,
      metadata: { reportKey: input.reportKey, frequency: input.frequency },
    });
    return schedule;
  });
  return row;
}

export async function listSchedules(actor: Actor) {
  if (!can(actor, 'reports.view')) throw ServiceError.forbidden();
  return getPrisma().scheduledReport.findMany({
    orderBy: { createdAt: 'desc' },
    include: { runs: { orderBy: { ranAt: 'desc' }, take: 3 } },
  });
}

export async function toggleSchedule(actor: Actor, id: string, active: boolean) {
  if (!can(actor, 'reports.schedule')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  await prisma.scheduledReport.update({ where: { id }, data: { active } });
  await appendAudit(prisma, {
    eventType: 'REPORT_SCHEDULE_CHANGED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'ScheduledReport',
    objectId: id,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: { active },
  });
}

/**
 * Worker pass: run due schedules under the CREATOR's authority (inheriting
 * reporting authorization and suppression). Development captures the report
 * in the dev mailbox; live email requires an approved active provider.
 */
export async function runDueSchedules(now: Date = new Date()): Promise<number> {
  const prisma = getPrisma();
  const due = await prisma.scheduledReport.findMany({
    where: { active: true, nextRunAt: { lte: now } },
    take: 10,
  });
  let ran = 0;
  for (const s of due) {
    const claimed = await prisma.scheduledReport.updateMany({
      where: { id: s.id, rowVersion: s.rowVersion },
      data: { nextRunAt: nextRun(s.frequency, now), lastRunAt: now, rowVersion: { increment: 1 } },
    });
    if (claimed.count === 0) continue;
    const correlationId = newCorrelationId();
    try {
      const creator = await prisma.user.findUniqueOrThrow({
        where: { id: s.createdById },
        include: { roleAssignments: { where: { revokedAt: null }, select: { role: true } } },
      });
      const actor: Actor = {
        userId: creator.id,
        // Deprecated enum literals (DEC-042) are filtered out of actor roles.
        roles: creator.roleAssignments.map((r) => r.role).filter((r): r is Role => isRole(r)),
      };
      const csv = await exportReportCsv(actor, s.reportKey, s.filters);
      const objectKey = newPrefixedObjectKey('generated');
      await getStorage().put(objectKey, Buffer.from(csv, 'utf8'));
      const rowCount = csv.split('\r\n').length - 2;
      await prisma.reportRun.create({
        data: { scheduledReportId: s.id, status: 'SUCCESS', rowCount, objectKey, correlationId },
      });
      await prisma.scheduledReport.updateMany({
        where: { id: s.id },
        data: { lastStatus: 'SUCCESS', lastError: null },
      });
      // Development delivery proof: capture into the dev mailbox (O).
      if (!getConfig().isProduction) {
        const anyRecord = await prisma.notificationRecord.findFirst({ select: { id: true } });
        if (anyRecord) {
          await prisma.notificationCapture.create({
            data: {
              recordId: anyRecord.id,
              subject: `[Scheduled report] ${s.name}`,
              body: `Report ${s.reportKey} generated (${rowCount} row(s)). Stored at ${objectKey}. Captured by the DEVELOPMENT mailbox - not a delivery.`,
              note: `Scheduled report run (schedule ${s.id}).`,
            },
          });
        }
      }
      await appendAudit(prisma, {
        eventType: 'REPORT_RUN_COMPLETED',
        actorType: 'SYSTEM',
        objectType: 'ScheduledReport',
        objectId: s.id,
        result: 'SUCCESS',
        correlationId,
        metadata: { reportKey: s.reportKey, rowCount },
      });
      ran += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 200) : 'unknown';
      await prisma.reportRun.create({
        data: { scheduledReportId: s.id, status: 'FAILED', error: message, correlationId },
      });
      await prisma.scheduledReport.updateMany({
        where: { id: s.id },
        data: { lastStatus: 'FAILED', lastError: message },
      });
      await appendAudit(prisma, {
        eventType: 'REPORT_RUN_COMPLETED',
        actorType: 'SYSTEM',
        objectType: 'ScheduledReport',
        objectId: s.id,
        result: 'FAILURE',
        correlationId,
        metadata: { reportKey: s.reportKey, errorCode: 'RUN_FAILED' },
      });
    }
  }
  return ran;
}
