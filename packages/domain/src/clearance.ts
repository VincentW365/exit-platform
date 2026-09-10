/**
 * Final clearance gate (Directive 3 section O, redesigned by Directive 6.3 AA:
 * clearance from EVIDENCE, not logins).
 *
 * The evaluation is pure: the service gathers the facts, this module decides.
 * Dual-mode by construction: a workflow instance that carries IT/FINANCE
 * department tasks (every pre-redesign v1 instance) is judged by its task
 * completions - historical cases clear under the rules they ran under. A v2
 * instance has no department-login tasks; IT and Finance are judged by
 * email-action evidence (sent / acknowledged / confirmed / approved
 * exception).
 *
 * Exit-survey completion is deliberately NOT an input - it never blocks
 * clearance (fixed default 20 / O). Manager approval of the Action Form is
 * not an input anywhere (Directive 6.3 D).
 */
import { createHash } from 'node:crypto';
import { assetsSatisfyClearance, type AssetItemLike } from './assets.ts';
import { FORM_DONE_STATUSES } from './actionForm.ts';
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

/** Email-action evidence for the v2 gate (Directive 6.3 AA/U). */
export interface ClearanceEmailActionFact {
  notificationType: string;
  applicable: boolean;
  sentAt: Date | null;
  acknowledgedAt: Date | null;
  completionConfirmedAt: Date | null;
  /** RECIPIENT_MISSING / ACKNOWLEDGEMENT_OVERDUE / AUTO_SEND_BLOCKED approved. */
  exceptionApproved: boolean;
}

export interface ClearanceFacts {
  departureType: string;
  tasks: readonly ClearanceTaskFact[];
  /** Live resignation letter status where applicable; null for termination. */
  letterStatus: string | null;
  letterRequired: boolean;
  actionFormStatus: string | null;
  assets: readonly AssetItemLike[];
  /** Item ids covered by a resolved ASSET_UNRESOLVED exception (per item). */
  approvedUnresolvedAssetIds: readonly string[];
  openCriticalExceptionCount: number;
  accessSecurityExceptionApproved: boolean;
  /** Directive 6.3: email-action evidence per applicable action. */
  emailActions: readonly ClearanceEmailActionFact[];
  /** Any benefits applicability still UNKNOWN? (blocks: uncertainty is work.) */
  benefitsUnresolvedCount: number;
  /**
   * Exit Checklist for Return Items. Null when the case has none (legacy
   * instances). Submitting it never clears an item, so property recorded as
   * still owed keeps blocking until HR resolves it.
   */
  returnChecklist?: { submitted: boolean; unresolvedLabels: readonly string[] } | null;
}

/** Directive 6.2 (Z): the decision-screen grouping for readiness items. */
export type ClearanceGroup =
  | 'HR'
  | 'Manager'
  | 'IT'
  | 'Finance'
  | 'Providers'
  | 'Benefits'
  | 'Assets'
  | 'Documents'
  | 'Security';

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

/**
 * Emails that stay inside the company. The manager departure notice and the
 * return-items checklist belong here: counting them as external provider
 * notifications would report the wrong blocker on the clearance screen.
 */
const INTERNAL_EMAIL_TYPES = [
  'IT_ACCESS_REMOVAL',
  'FINANCE_OFFBOARDING',
  'LINE_MANAGER_HANDOVER',
  'RETURN_ITEMS_CHECKLIST',
];

/** Letter states that satisfy the documents condition (O.3). */
export const LETTER_SATISFIES_CLEARANCE: readonly string[] = [
  'RENDERED',
  'MANUALLY_ISSUED',
  'ISSUED_BY_EMAIL',
];

export function evaluateClearance(f: ClearanceFacts): ClearanceReadiness {
  const items: ClearanceItem[] = [];
  const hasItTasks = f.tasks.some((t) => (t.department ?? 'HR') === 'IT');
  const hasFinanceTasks = f.tasks.some((t) => (t.department ?? 'HR') === 'FINANCE');

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

  // O.2 / I.10 (legacy mode): access revocation completed, or an
  // HR_MANAGER-approved security exception recorded. Only meaningful when the
  // pinned instance actually carries access tasks (v1).
  const accessTasks = f.tasks.filter((t) => t.taskKind === 'ACCESS_REVOCATION');
  if (accessTasks.length > 0) {
    const accessDone = accessTasks.every((t) => t.status === 'COMPLETED');
    items.push({
      key: 'accessRevocation',
      label: 'IT access revocation',
      group: 'Security',
      ok: accessDone || f.accessSecurityExceptionApproved,
      detail: accessDone
        ? 'Access revocation is completed.'
        : f.accessSecurityExceptionApproved
          ? 'Incomplete, covered by an HR-Manager-approved security exception (I.10).'
          : 'Access revocation is not completed and no approved security exception exists.',
    });
  }

  // Directive 6.3 AA (v2 mode): department + provider evidence from email
  // actions. IT requires confirmation-grade evidence; Finance requires the
  // notification to have gone out; providers require sent-where-applicable.
  if (!hasItTasks) {
    const it = f.emailActions.find((a) => a.notificationType === 'IT_ACCESS_REMOVAL');
    const itOk = !!it && (it.completionConfirmedAt !== null || it.exceptionApproved);
    items.push({
      key: 'itEvidence',
      label: 'IT access removal',
      group: 'IT',
      ok: it ? itOk : false,
      detail: !it
        ? 'No IT access-removal action exists for this case.'
        : it.completionConfirmedAt
          ? 'Confirmed complete.'
          : it.exceptionApproved
            ? 'Covered by an approved exception.'
            : it.acknowledgedAt
              ? 'Acknowledged - completion evidence still required (delivery is not completion).'
              : it.sentAt
                ? 'Notification sent - completion evidence still required.'
                : 'Notification not sent yet.',
    });
  }
  if (!hasFinanceTasks) {
    const fin = f.emailActions.find((a) => a.notificationType === 'FINANCE_OFFBOARDING');
    const finOk = !!fin && (fin.sentAt !== null || fin.exceptionApproved);
    items.push({
      key: 'financeEvidence',
      label: 'Finance notification',
      group: 'Finance',
      ok: fin ? finOk : false,
      detail: !fin
        ? 'No Finance notification exists for this case.'
        : fin.sentAt
          ? fin.acknowledgedAt
            ? 'Sent and acknowledged.'
            : 'Sent.'
          : fin.exceptionApproved
            ? 'Covered by an approved exception.'
            : 'Notification not sent yet.',
    });
  }
  // The checklist blocks only on what it actually reports: property still
  // owed. An unreturned form is covered by the asset items above, so it never
  // double-gates the case.
  if (f.returnChecklist?.submitted && f.returnChecklist.unresolvedLabels.length > 0) {
    items.push({
      key: 'returnChecklist',
      label: 'Exit checklist for return items',
      group: 'Assets',
      ok: false,
      detail: `Still outstanding: ${f.returnChecklist.unresolvedLabels.join(', ')}.`,
    });
  }
  const providerActions = f.emailActions.filter(
    (a) => !INTERNAL_EMAIL_TYPES.includes(a.notificationType) && a.applicable,
  );
  if (providerActions.length > 0) {
    const unsent = providerActions.filter((a) => a.sentAt === null && !a.exceptionApproved);
    items.push({
      key: 'providers',
      label: 'External provider notifications',
      group: 'Providers',
      ok: unsent.length === 0,
      detail:
        unsent.length === 0
          ? `All ${providerActions.length} applicable provider notification(s) sent or covered by an approved exception.`
          : `${unsent.length} applicable provider notification(s) not sent.`,
    });
  }

  // Directive 6.3 V: unresolved benefits applicability blocks - uncertainty
  // is open work, not something to clear past. Applies to the HR-validated
  // (v2) model only; legacy instances ran benefits as workflow tasks (AD: no
  // retroactive reinterpretation).
  if (!hasItTasks && !hasFinanceTasks) {
    items.push({
      key: 'benefits',
      label: 'Benefits applicability',
      group: 'Benefits',
      ok: f.benefitsUnresolvedCount === 0,
      detail:
        f.benefitsUnresolvedCount === 0
          ? 'All benefits applicability determinations are resolved.'
          : `${f.benefitsUnresolvedCount} benefits determination(s) still UNKNOWN.`,
    });
  }

  // O.3: required documents approved and rendered where applicable.
  items.push({
    key: 'documents',
    label: 'Resignation document',
    group: 'Documents',
    // A letter the platform itself sent by email (ISSUED_BY_EMAIL) is as
    // issued as one handed over by hand; the gate used to know only the
    // rendered and manually-issued states, so a case whose letter went out
    // through the platform's own path could never clear (found by the
    // offboarding regression suite, 2026-09-09).
    ok: !f.letterRequired || LETTER_SATISFIES_CLEARANCE.includes(f.letterStatus ?? ''),
    detail: !f.letterRequired
      ? 'No letter is applicable for this departure type.'
      : `Letter status: ${f.letterStatus ?? 'none'} (RENDERED, MANUALLY_ISSUED or ISSUED_BY_EMAIL required).`,
  });

  // O.4: action form complete (new model) or approved (legacy rows).
  items.push({
    key: 'actionForm',
    label: 'Offboarding action form',
    group: 'Documents',
    ok:
      f.actionFormStatus !== null &&
      (FORM_DONE_STATUSES as readonly string[]).includes(f.actionFormStatus),
    detail: `Action form status: ${f.actionFormStatus ?? 'none'} (COMPLETE required).`,
  });

  // O.5: every required asset has a documented disposition (per-item
  // exception coverage - Directive 6.3 logic-audit fix).
  const assets = assetsSatisfyClearance(f.assets, f.approvedUnresolvedAssetIds);
  items.push({
    key: 'assets',
    label: 'Asset dispositions',
    group: 'Assets',
    ok: assets.ok,
    detail: assets.detail,
  });

  // Owner decision 2026-08-19: the platform no longer records a handover, so
  // clearance no longer gates on one. Cases that ran on an earlier workflow
  // keep their handover record as history; it is simply not a condition.

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
