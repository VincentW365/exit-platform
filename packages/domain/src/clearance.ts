/**
 * Final clearance gate (Directive 3 section O).
 *
 * The evaluation is pure: the service gathers the facts, this module decides.
 * Exit-survey completion is deliberately NOT an input - it never blocks
 * clearance (fixed default 20 / O).
 */
import { createHash } from 'node:crypto';
import { assetsSatisfyClearance, type AssetItemLike } from './assets.ts';
import { HANDOVER_SATISFIED_STATUSES, type HandoverStatus } from './handover.ts';
import type { TaskKind, TaskStatus } from './workflow.ts';

export interface ClearanceTaskFact {
  taskCode: string;
  title: string;
  required: boolean;
  status: TaskStatus;
  taskKind: TaskKind;
  /** Owning department for the grouped decision view; absent → HR bucket. */
  department?: string;
}

export interface ClearanceFacts {
  departureType: string;
  tasks: readonly ClearanceTaskFact[];
  /** Live resignation letter status where applicable; null for termination. */
  letterStatus: string | null;
  letterRequired: boolean;
  actionFormStatus: string | null;
  assets: readonly AssetItemLike[];
  assetUnresolvedExceptionApproved: boolean;
  handoverRequired: boolean;
  handoverStatus: HandoverStatus | null;
  openCriticalExceptionCount: number;
  accessSecurityExceptionApproved: boolean;
}

/** Directive 6.2 (Z): the decision-screen grouping for readiness items. */
export type ClearanceGroup =
  'HR' | 'Manager' | 'IT' | 'Finance' | 'Assets' | 'Documents' | 'Handover' | 'Security';

export interface ClearanceItem {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  group: ClearanceGroup;
}

export interface ClearanceReadiness {
  ok: boolean;
  items: ClearanceItem[];
}

const DONE: readonly TaskStatus[] = ['COMPLETED', 'WAIVED'];

const DEPT_GROUP: Record<string, { group: ClearanceGroup; label: string }> = {
  HR: { group: 'HR', label: 'HR tasks' },
  IT: { group: 'IT', label: 'IT tasks' },
  FINANCE: { group: 'Finance', label: 'Finance tasks' },
  LINE_MANAGER: { group: 'Manager', label: 'Manager tasks' },
};

export function evaluateClearance(f: ClearanceFacts): ClearanceReadiness {
  const items: ClearanceItem[] = [];

  // O.1: every required workflow task completed or validly waived. The
  // aggregate item keeps its historical key; per-department items carry the
  // grouped decision view (Directive 6.2 Z).
  const openRequired = f.tasks.filter((t) => t.required && !DONE.includes(t.status));
  items.push({
    key: 'requiredTasks',
    label: 'Required workflow tasks',
    group: 'HR',
    ok: openRequired.length === 0,
    detail:
      openRequired.length === 0
        ? 'All required tasks are completed or validly waived.'
        : `${openRequired.length} required task(s) open: ${openRequired
            .slice(0, 5)
            .map((t) => t.title)
            .join('; ')}${openRequired.length > 5 ? '; ...' : ''}`,
  });
  for (const [dept, meta] of Object.entries(DEPT_GROUP)) {
    const deptTasks = f.tasks.filter((t) => (t.department ?? 'HR') === dept);
    if (deptTasks.length === 0) continue;
    const open = deptTasks.filter((t) => t.required && !DONE.includes(t.status));
    items.push({
      key: `tasks:${dept}`,
      label: meta.label,
      group: meta.group,
      ok: open.length === 0,
      detail:
        open.length === 0
          ? `All ${deptTasks.length} task(s) completed or waived.`
          : `${open.length} open: ${open
              .slice(0, 4)
              .map((t) => t.title)
              .join('; ')}${open.length > 4 ? '; ...' : ''}`,
    });
  }

  // O.2 / I.10: access revocation completed, or an HR_MANAGER-approved
  // security exception recorded.
  const accessTasks = f.tasks.filter((t) => t.taskKind === 'ACCESS_REVOCATION');
  const accessDone = accessTasks.length > 0 && accessTasks.every((t) => t.status === 'COMPLETED');
  items.push({
    key: 'accessRevocation',
    label: 'IT access revocation',
    group: 'Security',
    ok: accessDone || (accessTasks.length > 0 && f.accessSecurityExceptionApproved),
    detail: accessDone
      ? 'Access revocation is completed.'
      : accessTasks.length === 0
        ? 'No access-revocation task exists in this workflow.'
        : f.accessSecurityExceptionApproved
          ? 'Incomplete, covered by an HR-Manager-approved security exception (I.10).'
          : 'Access revocation is not completed and no approved security exception exists.',
  });

  // O.3: required documents approved and rendered where applicable.
  items.push({
    key: 'documents',
    label: 'Resignation document',
    group: 'Documents',
    ok: !f.letterRequired || f.letterStatus === 'RENDERED' || f.letterStatus === 'MANUALLY_ISSUED',
    detail: !f.letterRequired
      ? 'No letter is applicable for this departure type.'
      : `Letter status: ${f.letterStatus ?? 'none'} (RENDERED or MANUALLY_ISSUED required).`,
  });

  // O.4: action form at its required final state.
  items.push({
    key: 'actionForm',
    label: 'Employee action form',
    group: 'Documents',
    ok: f.actionFormStatus === 'APPROVED',
    detail: `Action form status: ${f.actionFormStatus ?? 'none'} (APPROVED required).`,
  });

  // O.5: every required asset has a documented disposition.
  const assets = assetsSatisfyClearance(f.assets, f.assetUnresolvedExceptionApproved);
  items.push({
    key: 'assets',
    label: 'Asset dispositions',
    group: 'Assets',
    ok: assets.ok,
    detail: assets.detail,
  });

  // O.6: required handover completed / not applicable / validly waived.
  items.push({
    key: 'handover',
    label: 'Knowledge transfer / handover',
    group: 'Handover',
    ok:
      !f.handoverRequired ||
      (f.handoverStatus !== null && HANDOVER_SATISFIED_STATUSES.includes(f.handoverStatus)),
    detail: !f.handoverRequired
      ? 'Handover is not required for this workflow.'
      : `Handover status: ${f.handoverStatus ?? 'none'}.`,
  });

  // O.9: no unresolved CRITICAL exception. (O.7/O.8 - Finance workpaper and
  // the HRIS record - are required tasks and covered by the task check.)
  items.push({
    key: 'criticalExceptions',
    label: 'Critical exceptions',
    group: 'Security',
    ok: f.openCriticalExceptionCount === 0,
    detail:
      f.openCriticalExceptionCount === 0
        ? 'No open critical exceptions.'
        : `${f.openCriticalExceptionCount} open CRITICAL exception(s).`,
  });

  return { ok: items.every((i) => i.ok), items };
}

/** Deterministic checksum binding a clearance approval to its snapshot. */
export function clearanceChecksum(snapshot: unknown): string {
  return createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex');
}

export const CLEARANCE_MEANING =
  'I confirm that I have reviewed the clearance summary for this case and approve final clearance. ' +
  'This administrative approval records process completion evidence; it is not a qualified or advanced electronic signature.';
