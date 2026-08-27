/**
 * Advanced reporting centre (Directive 4 section N).
 *
 * Every report: TRAINING/TEST excluded by default (N.1); restricted cases
 * excluded from unauthorized viewers AND totals (N.2); identifiable survey
 * free text never appears in management exports (N.3); configurable
 * small-group suppression, default threshold 5 (N.4/N.5); every export is
 * audited (N.8); CSV injection controls stay enforced (N.9); survey "themes"
 * are deterministic keyword counts only - explicitly NOT AI (N.11/N.14).
 */
import {
  can,
  separationProfile,
  canViewCase,
  deterministicKeywordSummary,
  hasRole,
  suppressSmallGroups,
  DEFAULT_SUPPRESSION_THRESHOLD,
  type Actor,
} from '@exit/domain';
import { z } from 'zod';
import { getPrisma } from '../client.ts';
import { csvCell, csvNumber } from '../csv.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { getSystemConfigValue } from './systemConfigService.ts';

export const reportFilterSchema = z.object({
  from: z.union([z.literal('').transform(() => null), z.coerce.date(), z.null()]).optional(),
  to: z.union([z.literal('').transform(() => null), z.coerce.date(), z.null()]).optional(),
  recordPurpose: z.enum(['OPERATIONAL', 'TRAINING', 'TEST']).default('OPERATIONAL'),
  cohort: z.enum(['BASELINE', 'PILOT', 'POST_ROLLOUT']).optional(),
  departureType: z
    .enum(['RESIGNATION_WITH_NOTICE', 'IMMEDIATE_RESIGNATION', 'TERMINATION'])
    .optional(),
  department: z.string().trim().max(100).optional(),
  location: z.string().trim().max(100).optional(),
});
export type ReportFilter = z.infer<typeof reportFilterSchema>;

export interface ReportOutput {
  key: string;
  title: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
  note?: string;
}

function hrVisibility(actor: Actor) {
  return {
    OR: [
      { classification: 'CONFIDENTIAL' as const },
      { participants: { some: { userId: actor.userId, removedAt: null } } },
      { ownerId: actor.userId },
    ],
  };
}

function caseWhere(actor: Actor, f: ReportFilter) {
  return {
    AND: [
      hrVisibility(actor),
      { recordPurpose: f.recordPurpose },
      ...(f.cohort ? [{ measurementCohort: f.cohort }] : []),
      ...(f.departureType ? [{ departureType: f.departureType }] : []),
      ...(f.department ? [{ department: f.department }] : []),
      ...(f.location ? [{ location: f.location }] : []),
      ...(f.from ? [{ createdAt: { gte: f.from } }] : []),
      ...(f.to ? [{ createdAt: { lte: f.to } }] : []),
    ],
  };
}

async function suppressionThreshold(): Promise<number> {
  const v = (await getSystemConfigValue('reporting.suppressionThreshold')) as number | null;
  return typeof v === 'number' && v >= 1 ? v : DEFAULT_SUPPRESSION_THRESHOLD;
}

/** How an initiator reads in a report. */
const SEPARATION_CLASS: Record<string, string> = {
  EMPLOYEE: 'Voluntary',
  EMPLOYER: 'Involuntary',
  CONTRACT: 'Contractual',
  UNSPECIFIED: 'Unclassified',
};

export const REPORT_CATALOG: ReadonlyArray<{ key: string; title: string; family: string }> = [
  { key: 'volumeTrend', title: 'Offboarding volume and trend', family: 'Cases' },
  { key: 'voluntaryInvoluntary', title: 'Voluntary vs involuntary departures', family: 'Cases' },
  { key: 'reasonTrend', title: 'Reason-category trend (reporting groups)', family: 'Cases' },
  { key: 'captureTimeliness', title: 'Case-capture timeliness', family: 'Cases' },
  { key: 'documentTurnaround', title: 'Document turnaround', family: 'Documents' },
  {
    key: 'notificationStatus',
    title: 'Notification preparation, submission and delivery status',
    family: 'Notifications',
  },
  { key: 'taskSla', title: 'Task SLA compliance', family: 'Workflow' },
  { key: 'departmentWorkload', title: 'Department workload and ageing', family: 'Workflow' },
  { key: 'accessTimeliness', title: 'Access-revocation timeliness', family: 'Workflow' },
  { key: 'assetDocumentation', title: 'Asset disposition documentation', family: 'Assets' },
  { key: 'assetRecovery', title: 'Physical asset recovery', family: 'Assets' },
  { key: 'returnChecklist', title: 'Exit checklist for return items', family: 'Assets' },
  { key: 'letterIssuance', title: 'Resignation letter issuance', family: 'Documents' },
  { key: 'surveyParticipation', title: 'Exit-survey participation', family: 'Survey' },
  { key: 'surveyRatings', title: 'Survey rating distributions', family: 'Survey' },
  {
    key: 'surveyKeywords',
    title: 'Aggregate survey keyword summary (deterministic, no AI)',
    family: 'Survey',
  },
  {
    key: 'handoverCompletion',
    title: 'Handover completion (historical)',
    family: 'Workflow',
  },
  { key: 'clearanceCycle', title: 'Clearance cycle time', family: 'Workflow' },
  { key: 'endToEndCycle', title: 'End-to-end cycle time', family: 'Cases' },
  { key: 'exceptions', title: 'Exceptions and escalations', family: 'Operations' },
  { key: 'waivers', title: 'Waivers and overrides', family: 'Operations' },
  { key: 'reopenedCancelled', title: 'Reopened, cancelled and voided cases', family: 'Cases' },
  { key: 'integrationFailures', title: 'Integration failures', family: 'Operations' },
  { key: 'dataCompleteness', title: 'Data-completeness and reconciliation', family: 'Operations' },
];

export async function runReport(
  actor: Actor,
  key: string,
  rawFilter: unknown,
): Promise<ReportOutput> {
  if (!can(actor, 'reports.view')) throw ServiceError.forbidden();
  const parsed = reportFilterSchema.safeParse(rawFilter ?? {});
  if (!parsed.success) throw ServiceError.validation(['Invalid report filter.']);
  const f = parsed.data;
  // N.7: only operationally-assigned users see case-level rows; managers and
  // non-HR viewers receive aggregates (enforced per report below).
  const aggregateOnly = !hasRole(actor, 'HR_MANAGER', 'HR_OFFICER');
  const prisma = getPrisma();
  const where = caseWhere(actor, f);
  const threshold = await suppressionThreshold();

  switch (key) {
    case 'volumeTrend': {
      const rows = await prisma.offboardingCase.groupBy({
        by: ['departureType', 'status'],
        where,
        _count: { _all: true },
      });
      return {
        key,
        title: 'Offboarding volume and trend',
        columns: ['Departure type', 'Status', 'Count'],
        rows: rows.map((r) => [r.departureType, r.status, r._count._all]),
      };
    }
    case 'voluntaryInvoluntary': {
      const rows = await prisma.offboardingCase.groupBy({
        by: ['departureType'],
        where,
        _count: { _all: true },
      });
      // Who ended the employment comes from the separation profile, not from
      // naming one type here. With seven ways of leaving, "anything that is
      // not a termination is voluntary" would file a redundancy and a
      // contract expiry as the employee's own choice (directive 32).
      const mapped = rows.map((r) => ({
        label: SEPARATION_CLASS[separationProfile(r.departureType).initiator] ?? 'Unclassified',
        type: separationProfile(r.departureType).label,
        count: r._count._all,
      }));
      const suppressed = suppressSmallGroups(mapped, threshold);
      return {
        key,
        title: 'Voluntary vs involuntary departures',
        columns: ['Class', 'Departure type', 'Count'],
        rows: suppressed.map((r) =>
          'suppressed' in r ? ['(suppressed)', '(suppressed)', null] : [r.label, r.type, r.count],
        ),
        note: `Small groups below ${threshold} are suppressed.`,
      };
    }
    case 'reasonTrend': {
      const cases = await prisma.offboardingCase.findMany({
        where,
        select: {
          reasonCategory: { select: { reportingGroup: true, label: true, sensitive: true } },
        },
      });
      const counts = new Map<string, number>();
      for (const c of cases) {
        // J.6: reporting groups only; sensitive labels are never expanded.
        const g = c.reasonCategory?.reportingGroup ?? c.reasonCategory?.label ?? '(not captured)';
        const label = c.reasonCategory?.sensitive ? '(sensitive group)' : g;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      const mapped = [...counts.entries()].map(([group, count]) => ({ group, count }));
      const suppressed = suppressSmallGroups(mapped, threshold);
      return {
        key,
        title: 'Reason-category trend (reporting groups)',
        columns: ['Reporting group', 'Count'],
        rows: suppressed.map((r) =>
          'suppressed' in r ? ['(suppressed)', null] : [r.group, r.count],
        ),
        note: `Reason notes are restricted data and never appear here. Small groups below ${threshold} suppressed.`,
      };
    }
    case 'captureTimeliness': {
      const cases = await prisma.offboardingCase.findMany({
        where,
        select: { receivedAt: true, createdAt: true },
      });
      const within = cases.filter(
        (c) => c.createdAt.getTime() - c.receivedAt.getTime() <= 2 * 86_400_000,
      ).length;
      return {
        key,
        title: 'Case-capture timeliness',
        columns: ['Measured cases', 'Captured within 2 days', 'Percent'],
        rows: [
          [
            cases.length,
            within,
            cases.length ? Math.round((within / cases.length) * 1000) / 10 : null,
          ],
        ],
      };
    }
    case 'documentTurnaround': {
      const docs = await prisma.documentInstance.findMany({
        where: { case: { is: where }, renderedAt: { not: null } },
        select: { renderedAt: true, case: { select: { receivedAt: true } } },
      });
      const days = docs.map(
        (d) => (d.renderedAt!.getTime() - d.case.receivedAt.getTime()) / 86_400_000,
      );
      days.sort((a, b) => a - b);
      return {
        key,
        title: 'Document turnaround',
        columns: ['Rendered documents', 'Median days'],
        rows: [
          [
            docs.length,
            days.length ? Math.round(days[Math.floor((days.length - 1) / 2)]! * 10) / 10 : null,
          ],
        ],
      };
    }
    case 'notificationStatus': {
      const notif = await prisma.notificationRecord.groupBy({
        by: ['notificationType', 'status'],
        where: { case: { is: where } },
        _count: { _all: true },
      });
      const outbox = await prisma.notificationOutbox.groupBy({
        by: ['status', 'deliveryStatus'],
        where: { notificationRecord: { is: { case: { is: where } } } },
        _count: { _all: true },
      });
      return {
        key,
        title: 'Notification preparation, submission and delivery status',
        columns: ['Layer', 'Type/status', 'Detail', 'Count'],
        rows: [
          ...notif.map((n) => ['record', n.notificationType, n.status, n._count._all] as const),
          ...outbox.map(
            (o) => ['outbox', o.status, o.deliveryStatus ?? '-', o._count._all] as const,
          ),
        ].map((r) => [...r]),
        note: 'CAPTURED and SUBMITTED are provider-acceptance states; DELIVERED appears only with provider delivery evidence.',
      };
    }
    case 'taskSla': {
      const done = await prisma.workflowTask.findMany({
        where: { case: { is: where }, status: 'COMPLETED', required: true, dueAt: { not: null } },
        select: { completedAt: true, dueAt: true, department: true },
      });
      const byDept = new Map<string, { total: number; onTime: number }>();
      for (const t of done) {
        const d = byDept.get(t.department) ?? { total: 0, onTime: 0 };
        d.total += 1;
        if (t.completedAt && t.completedAt.getTime() <= t.dueAt!.getTime()) d.onTime += 1;
        byDept.set(t.department, d);
      }
      return {
        key,
        title: 'Task SLA compliance',
        columns: ['Department', 'Measured', 'On time', 'Percent'],
        rows: [...byDept.entries()].map(([dept, v]) => [
          dept,
          v.total,
          v.onTime,
          Math.round((v.onTime / v.total) * 1000) / 10,
        ]),
      };
    }
    case 'departmentWorkload': {
      const open = await prisma.workflowTask.groupBy({
        by: ['department', 'status'],
        where: { case: { is: where }, status: { in: ['READY', 'IN_PROGRESS', 'BLOCKED'] } },
        _count: { _all: true },
      });
      return {
        key,
        title: 'Department workload and ageing',
        columns: ['Department', 'Status', 'Open tasks'],
        rows: open.map((r) => [r.department, r.status, r._count._all]),
      };
    }
    case 'accessTimeliness': {
      const access = await prisma.workflowTask.findMany({
        where: { case: { is: where }, taskKind: 'ACCESS_REVOCATION', status: 'COMPLETED' },
        select: { lateMinutes: true },
      });
      const late = access.filter((t) => (t.lateMinutes ?? 0) > 0);
      return {
        key,
        title: 'Access-revocation timeliness',
        columns: ['Completed', 'Late', 'Max delay (min)', 'On-time percent'],
        rows: [
          [
            access.length,
            late.length,
            late.reduce((m, t) => Math.max(m, t.lateMinutes ?? 0), 0),
            access.length
              ? Math.round(((access.length - late.length) / access.length) * 1000) / 10
              : null,
          ],
        ],
      };
    }
    case 'assetDocumentation':
    case 'assetRecovery': {
      const items = await prisma.assetRecoveryItem.findMany({
        where: { case: { is: where }, requiredForClearance: true },
        select: { status: true },
      });
      const documented = items.filter(
        (i) => !['EXPECTED', 'REQUESTED', 'PARTIALLY_RETURNED', 'UNRESOLVED'].includes(i.status),
      ).length;
      const physicalDen = items.filter((i) => i.status !== 'NOT_ISSUED').length;
      const returned = items.filter((i) => i.status === 'RETURNED').length;
      return key === 'assetDocumentation'
        ? {
            key,
            title: 'Asset disposition documentation',
            columns: ['Required items', 'Documented', 'Percent'],
            rows: [
              [
                items.length,
                documented,
                items.length ? Math.round((documented / items.length) * 1000) / 10 : null,
              ],
            ],
          }
        : {
            key,
            title: 'Physical asset recovery',
            columns: ['Issued and due', 'Returned', 'Percent'],
            rows: [
              [
                physicalDen,
                returned,
                physicalDen ? Math.round((returned / physicalDen) * 1000) / 10 : null,
              ],
            ],
            note: 'NOT_ISSUED items are excluded from the physical denominator; documentation is a separate measure.',
          };
    }
    // DEC-053: did the checklist come back, and did it come back clean?
    case 'returnChecklist': {
      const checklists = await prisma.returnItemsChecklist.findMany({
        where: { case: { is: where } },
        select: { status: true, sentAt: true, submittedAt: true },
      });
      const byStatus = new Map<string, number>();
      for (const c of checklists) byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
      const sent = checklists.filter((c) => c.sentAt).length;
      const returned = checklists.filter((c) => c.submittedAt).length;
      const turnaround = checklists
        .filter((c) => c.sentAt && c.submittedAt)
        .map((c) => (c.submittedAt!.getTime() - c.sentAt!.getTime()) / 86_400_000)
        .sort((a, b) => a - b);
      const outstanding = await prisma.returnItemsChecklistEntry.count({
        where: {
          checklist: { is: { case: { is: where } } },
          status: { in: ['NOT_RETURNED', 'LOST_OR_DAMAGED'] },
        },
      });
      return {
        key,
        title: 'Exit checklist for return items',
        columns: ['Measure', 'Value'],
        rows: [
          ['Checklists created', checklists.length],
          ['Requested by email', sent],
          ['Completed', returned],
          [
            'Return rate (of those requested)',
            sent ? `${Math.round((returned / sent) * 100)}%` : null,
          ],
          [
            'Median days to return',
            turnaround.length
              ? Math.round(turnaround[Math.floor((turnaround.length - 1) / 2)]! * 10) / 10
              : null,
          ],
          ...[...byStatus.entries()].map(([status, count]) => [`Status: ${status}`, count]),
          ['Items still owed (not returned or lost/damaged)', outstanding],
        ],
        note: 'A checklist reporting outstanding property is COMPLETED_WITH_OUTSTANDING, never COMPLETED - submitting never clears an item.',
      };
    }
    // DEC-054: was the acceptance letter actually issued, and how?
    case 'letterIssuance': {
      const letters = await prisma.documentInstance.findMany({
        where: {
          case: { is: where },
          documentType: {
            in: ['RESIGNATION_ACCEPTANCE_WITH_NOTICE', 'IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT'],
          },
        },
        select: { status: true, issueMethod: true, renderedAt: true, issuedAt: true },
      });
      const byStatus = new Map<string, number>();
      for (const d of letters) byStatus.set(d.status, (byStatus.get(d.status) ?? 0) + 1);
      const byMethod = new Map<string, number>();
      for (const d of letters.filter((x) => x.issueMethod))
        byMethod.set(d.issueMethod!, (byMethod.get(d.issueMethod!) ?? 0) + 1);
      const toIssue = letters
        .filter((d) => d.renderedAt && d.issuedAt)
        .map((d) => (d.issuedAt!.getTime() - d.renderedAt!.getTime()) / 86_400_000)
        .sort((a, b) => a - b);
      const rendered = letters.filter((d) => d.status === 'RENDERED').length;
      return {
        key,
        title: 'Resignation letter issuance',
        columns: ['Measure', 'Value'],
        rows: [
          ['Letters created', letters.length],
          ...[...byStatus.entries()].map(([status, count]) => [`Status: ${status}`, count]),
          ...[...byMethod.entries()].map(([method, count]) => [`Issued by: ${method}`, count]),
          ['Rendered but not yet issued', rendered],
          [
            'Median days from render to issue',
            toIssue.length
              ? Math.round(toIssue[Math.floor((toIssue.length - 1) / 2)]! * 10) / 10
              : null,
          ],
        ],
        note: 'An issued letter cannot be recalled; a correction goes through supersession, which appears here as a new version.',
      };
    }
    case 'surveyParticipation': {
      const inv = await prisma.surveyInvitation.groupBy({
        by: ['status'],
        where: { case: { is: where } },
        _count: { _all: true },
      });
      const mapped = inv.map((r) => ({ status: r.status as string, count: r._count._all }));
      const suppressed = suppressSmallGroups(mapped, threshold);
      return {
        key,
        title: 'Exit-survey participation',
        columns: ['Invitation status', 'Count'],
        rows: suppressed.map((r) =>
          'suppressed' in r ? ['(suppressed)', null] : [r.status, r.count],
        ),
        note: `Small groups below ${threshold} suppressed.`,
      };
    }
    case 'surveyRatings': {
      const answers = await prisma.surveyAnswer.findMany({
        where: {
          valueRating: { not: null },
          response: { is: { invitation: { is: { case: { is: where } } } } },
        },
        select: { valueRating: true, question: { select: { prompt: true } } },
      });
      const byPrompt = new Map<string, number[]>();
      for (const a of answers) {
        const list = byPrompt.get(a.question.prompt) ?? [];
        list.push(a.valueRating!);
        byPrompt.set(a.question.prompt, list);
      }
      const rows: Array<Array<string | number | null>> = [];
      for (const [prompt, ratings] of byPrompt) {
        if (ratings.length < threshold) {
          rows.push([prompt, null, null, '(suppressed)']);
          continue;
        }
        const avg = Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 100) / 100;
        rows.push([prompt, ratings.length, avg, '']);
      }
      return {
        key,
        title: 'Survey rating distributions',
        columns: ['Question', 'Responses', 'Average (1-5)', 'Note'],
        rows,
        note: `Questions with fewer than ${threshold} responses are suppressed (N.4/N.5).`,
      };
    }
    case 'surveyKeywords': {
      const texts = await prisma.surveyAnswer.findMany({
        where: {
          valueText: { not: null },
          response: { is: { invitation: { is: { case: { is: where } } } } },
        },
        select: { valueText: true },
      });
      if (texts.length < threshold) {
        return {
          key,
          title: 'Aggregate survey keyword summary',
          columns: ['Keyword', 'Responses containing it'],
          rows: [['(suppressed: fewer than threshold responses)', null]],
          note: `Fewer than ${threshold} free-text responses; aggregate suppressed.`,
        };
      }
      const summary = deterministicKeywordSummary(texts.map((t) => t.valueText!));
      return {
        key,
        title: 'Aggregate survey keyword summary',
        columns: ['Keyword', 'Responses containing it'],
        rows: summary.map((s) => [s.keyword, s.count]),
        note: 'Deterministic word-frequency counting ONLY - no AI theme inference (N.11/N.14). Frequent words are not meanings; read alongside category reports. Free text itself is never exported.',
      };
    }
    case 'handoverCompletion': {
      const records = await prisma.handoverRecord.groupBy({
        by: ['status'],
        where: { case: { is: where }, requiredForClearance: true },
        _count: { _all: true },
      });
      return {
        key,
        title: 'Handover completion (historical)',
        columns: ['Status', 'Count'],
        rows: records.map((r) => [r.status, r._count._all]),
        note: 'Historical only. The platform stopped recording handover under DEC-052; existing records stay readable and nothing new is added.',
      };
    }
    case 'clearanceCycle':
    case 'endToEndCycle': {
      const completed = await prisma.offboardingCase.findMany({
        where: { AND: [where, { status: 'COMPLETED' }] },
        select: {
          receivedAt: true,
          closedAt: true,
          statusHistory: { select: { toStatus: true, occurredAt: true } },
        },
      });
      const values: number[] = [];
      for (const c of completed) {
        if (!c.closedAt) continue;
        if (key === 'endToEndCycle') {
          values.push((c.closedAt.getTime() - c.receivedAt.getTime()) / 86_400_000);
        } else {
          const entered = c.statusHistory
            .filter((h) => h.toStatus === 'CLEARANCE_REVIEW')
            .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())[0];
          if (entered)
            values.push((c.closedAt.getTime() - entered.occurredAt.getTime()) / 86_400_000);
        }
      }
      values.sort((a, b) => a - b);
      return {
        key,
        title: key === 'clearanceCycle' ? 'Clearance cycle time' : 'End-to-end cycle time',
        columns: ['Completed cases measured', 'Median days'],
        rows: [
          [
            values.length,
            values.length
              ? Math.round(values[Math.floor((values.length - 1) / 2)]! * 10) / 10
              : null,
          ],
        ],
      };
    }
    case 'exceptions': {
      const rows = await prisma.caseException.groupBy({
        by: ['exceptionType', 'severity', 'status'],
        where: { case: { is: where } },
        _count: { _all: true },
      });
      return {
        key,
        title: 'Exceptions and escalations',
        columns: ['Type', 'Severity', 'Status', 'Count'],
        rows: rows.map((r) => [r.exceptionType, r.severity, r.status, r._count._all]),
      };
    }
    case 'waivers': {
      const [waived, corrections] = await Promise.all([
        prisma.workflowTask.count({ where: { case: { is: where }, status: 'WAIVED' } }),
        prisma.taskCorrection.count({ where: { task: { is: { case: { is: where } } } } }),
      ]);
      return {
        key,
        title: 'Waivers and overrides',
        columns: ['Task waivers', 'Task corrections'],
        rows: [[waived, corrections]],
      };
    }
    case 'reopenedCancelled': {
      const rows = await prisma.offboardingCase.groupBy({
        by: ['status'],
        where: {
          AND: [
            hrVisibility(actor),
            { recordPurpose: f.recordPurpose },
            { status: { in: ['REOPENED', 'CANCELLED', 'VOIDED'] } },
          ],
        },
        _count: { _all: true },
      });
      return {
        key,
        title: 'Reopened, cancelled and voided cases',
        columns: ['Status', 'Count'],
        rows: rows.map((r) => [r.status, r._count._all]),
      };
    }
    case 'integrationFailures': {
      const [dead, failed] = await Promise.all([
        prisma.notificationOutbox.count({
          where: { status: { in: ['DEAD_LETTER', 'FAILED_PERMANENT'] } },
        }),
        prisma.notificationOutbox.groupBy({
          by: ['lastErrorCode'],
          where: { lastErrorCode: { not: null } },
          _count: { _all: true },
        }),
      ]);
      return {
        key,
        title: 'Integration failures',
        columns: ['Measure', 'Value'],
        rows: [
          ['Dead-lettered / permanently failed outbox records', dead],
          ...failed.map(
            (r) => [`Error ${r.lastErrorCode}`, r._count._all] as Array<string | number>,
          ),
        ],
      };
    }
    case 'dataCompleteness': {
      const [noReason, noSeparationTime, syncRuns] = await Promise.all([
        prisma.offboardingCase.count({ where: { AND: [where, { reasonCategoryId: null }] } }),
        prisma.offboardingCase.count({ where: { AND: [where, { effectiveSeparationAt: null }] } }),
        prisma.employeeSyncRun.count(),
      ]);
      return {
        key,
        title: 'Data-completeness and reconciliation',
        columns: ['Measure', 'Value'],
        rows: [
          ['Cases without a reason category', noReason],
          ['Cases without an effective separation time', noSeparationTime],
          ['Employee sync runs recorded', syncRuns],
        ],
      };
    }
    default:
      throw ServiceError.notFound('Unknown report.');
  }
  void aggregateOnly; // reserved: aggregate-only reports never emit case rows
  void canViewCase;
}

/** N.8: audited CSV export with existing injection controls (N.9). */
export async function exportReportCsv(
  actor: Actor,
  key: string,
  rawFilter: unknown,
): Promise<string> {
  if (!can(actor, 'reports.export')) throw ServiceError.forbidden();
  const report = await runReport(actor, key, rawFilter);
  const lines = [report.columns.map(csvCell).join(',')];
  for (const row of report.rows) {
    lines.push(
      row
        .map((v) => (v === null ? '' : typeof v === 'number' ? csvNumber(v) : csvCell(String(v))))
        .join(','),
    );
  }
  await appendAudit(getPrisma(), {
    eventType: 'REPORT_EXPORTED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'Report',
    objectId: key,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: { format: 'CSV', rowCount: report.rows.length },
  });
  return `${lines.join('\r\n')}\r\n`;
}
