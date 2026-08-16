/**
 * Deterministic workflow engine rules (Directive 3 sections B-I).
 *
 * Everything here is pure: definition validation, version pinning checksums,
 * dependency resolution, due-date calculation with provenance, hold/pause
 * rules, waiver rules, escalation defaults and the exact-time access-
 * revocation timing rules. No generative AI is involved anywhere in workflow
 * selection, task creation, due dates or escalation (fixed default 2).
 */
import { createHash } from 'node:crypto';
import {
  endOfNthBusinessDayAfter,
  endOfNthBusinessDayBefore,
  interpretDateOnlyInZone,
  type BusinessCalendar,
} from './calendar.ts';
import type { Actor, Role } from './roles.ts';
import { hasRole } from './roles.ts';
import type { DepartureType } from './caseStates.ts';

// --- vocabulary --------------------------------------------------------------

export const WORKFLOW_DEFINITION_STATUSES = ['DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED'] as const;
export type WorkflowDefinitionStatus = (typeof WORKFLOW_DEFINITION_STATUSES)[number];

export const WORKFLOW_INSTANCE_STATUSES = [
  'PREVIEW',
  'ACTIVE',
  'ON_HOLD',
  'CLEARANCE_PENDING',
  'COMPLETED',
  'CANCELLED',
  'SUPERSEDED',
] as const;
export type WorkflowInstanceStatus = (typeof WORKFLOW_INSTANCE_STATUSES)[number];

export const TASK_STATUSES = [
  'NOT_READY',
  'READY',
  'IN_PROGRESS',
  'BLOCKED',
  'COMPLETED',
  'WAIVED',
  'CANCELLED',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_DEPARTMENTS = ['HR', 'IT', 'FINANCE', 'LINE_MANAGER'] as const;
export type TaskDepartment = (typeof TASK_DEPARTMENTS)[number];

export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
export type TaskKind = 'STANDARD' | 'ACCESS_REVOCATION';
export type DueBasis =
  'CASE_RECEIVED' | 'WORKFLOW_ACTIVATION' | 'EFFECTIVE_SEPARATION' | 'FINAL_WORKING_DAY' | 'NONE';
export type DueOffsetKind = 'BUSINESS_DAYS' | 'CALENDAR_DAYS' | 'EXACT_TIME';
export type ReleaseBasis = 'IMMEDIATE' | 'EFFECTIVE_SEPARATION';
export type TaskEvidenceKind = 'NONE' | 'NOTE' | 'ATTACHMENT' | 'LINKED_RECORD';

/** Live (non-terminal) workflow-instance statuses. */
export const LIVE_INSTANCE_STATUSES: readonly WorkflowInstanceStatus[] = [
  'ACTIVE',
  'ON_HOLD',
  'CLEARANCE_PENDING',
];

/** Task statuses that still need work. */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  'NOT_READY',
  'READY',
  'IN_PROGRESS',
  'BLOCKED',
];

/** Statuses that satisfy a dependency (D.1). */
export const DEP_SATISFYING_STATUSES: readonly TaskStatus[] = ['COMPLETED', 'WAIVED'];

// --- definition shape and validation (section B) -----------------------------

export interface TaskDefinitionShape {
  taskCode: string;
  sortOrder: number;
  enabled: boolean;
  title: string;
  description: string;
  department: TaskDepartment;
  requiredRole: Role;
  taskKind: TaskKind;
  priority: TaskPriority;
  confidential: boolean;
  required: boolean;
  waiverAllowed: boolean;
  waiverAuthority: Role;
  dueBasis: DueBasis;
  dueOffsetDays: number;
  dueOffsetKind: DueOffsetKind;
  releaseBasis: ReleaseBasis;
  releaseOffsetHours: number;
  pausesOnHold: boolean;
  blockPausesSla: boolean;
  dependsOnCodes: string[];
  evidenceKind: TaskEvidenceKind;
  evidenceNote?: string | null;
  slaNote?: string | null;
  escalationNote?: string | null;
}

export interface WorkflowDefinitionShape {
  workflowType: DepartureType;
  name: string;
  version: number;
  description: string;
  activationConditions: string;
  tasks: TaskDefinitionShape[];
}

const TASK_CODE_RE = /^[A-Z0-9_]{3,60}$/;

export function workflowDefinitionErrors(def: WorkflowDefinitionShape): string[] {
  const errors: string[] = [];
  if (!def.name.trim() || def.name.length > 200) errors.push('Name must be 1-200 characters.');
  const enabled = def.tasks.filter((t) => t.enabled);
  if (enabled.length === 0) errors.push('A workflow needs at least one enabled task.');
  const codes = new Set<string>();
  for (const t of def.tasks) {
    if (!TASK_CODE_RE.test(t.taskCode))
      errors.push(`Task code "${t.taskCode}" must be 3-60 chars of A-Z, 0-9 and underscores.`);
    if (codes.has(t.taskCode)) errors.push(`Duplicate task code "${t.taskCode}".`);
    codes.add(t.taskCode);
    if (!t.title.trim() || t.title.length > 200)
      errors.push(`Task "${t.taskCode}": title must be 1-200 characters.`);
    if (t.description.length > 2000)
      errors.push(`Task "${t.taskCode}": description is limited to 2000 characters.`);
    if (t.taskKind === 'ACCESS_REVOCATION') {
      if (t.waiverAllowed) errors.push(`Task "${t.taskCode}": access revocation cannot be waived.`);
      if (!t.required) errors.push(`Task "${t.taskCode}": access revocation must be required.`);
      if (t.pausesOnHold)
        errors.push(`Task "${t.taskCode}": access revocation must not pause on hold (E.4).`);
      if (t.dueBasis !== 'EFFECTIVE_SEPARATION' || t.dueOffsetKind !== 'EXACT_TIME')
        errors.push(
          `Task "${t.taskCode}": access revocation is due at the exact effective separation time.`,
        );
    }
    if (t.dueOffsetKind === 'EXACT_TIME' && t.dueBasis !== 'EFFECTIVE_SEPARATION')
      errors.push(`Task "${t.taskCode}": EXACT_TIME is only valid with EFFECTIVE_SEPARATION.`);
    if (t.dueBasis === 'NONE' && t.dueOffsetDays !== 0)
      errors.push(`Task "${t.taskCode}": offset requires a due basis.`);
    if (!Number.isInteger(t.dueOffsetDays) || Math.abs(t.dueOffsetDays) > 90)
      errors.push(`Task "${t.taskCode}": due offset must be a whole number within +/-90 days.`);
    if (!Number.isInteger(t.releaseOffsetHours) || Math.abs(t.releaseOffsetHours) > 24 * 90)
      errors.push(`Task "${t.taskCode}": release offset must be within +/-90 days in hours.`);
    if (t.dependsOnCodes.includes(t.taskCode))
      errors.push(`Task "${t.taskCode}" cannot depend on itself.`);
  }
  // Dependencies must reference existing enabled tasks and be acyclic.
  const enabledCodes = new Set(enabled.map((t) => t.taskCode));
  for (const t of enabled) {
    for (const dep of t.dependsOnCodes) {
      if (!enabledCodes.has(dep))
        errors.push(`Task "${t.taskCode}" depends on unknown or disabled task "${dep}".`);
    }
  }
  if (hasDependencyCycle(enabled)) errors.push('Task dependencies contain a cycle.');
  return errors;
}

export function hasDependencyCycle(
  tasks: readonly { taskCode: string; dependsOnCodes: readonly string[] }[],
): boolean {
  const deps = new Map(tasks.map((t) => [t.taskCode, t.dependsOnCodes]));
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (code: string): boolean => {
    const s = state.get(code);
    if (s === 'done') return false;
    if (s === 'visiting') return true;
    state.set(code, 'visiting');
    for (const dep of deps.get(code) ?? []) if (deps.has(dep) && visit(dep)) return true;
    state.set(code, 'done');
    return false;
  };
  return tasks.some((t) => visit(t.taskCode));
}

/** Deterministic configuration checksum for version pinning (B / C). */
export function workflowConfigChecksum(def: WorkflowDefinitionShape): string {
  const canonical = {
    workflowType: def.workflowType,
    name: def.name,
    version: def.version,
    tasks: [...def.tasks]
      .sort((a, b) => a.taskCode.localeCompare(b.taskCode))
      .map((t) => ({
        taskCode: t.taskCode,
        sortOrder: t.sortOrder,
        enabled: t.enabled,
        title: t.title,
        description: t.description,
        department: t.department,
        requiredRole: t.requiredRole,
        taskKind: t.taskKind,
        priority: t.priority,
        confidential: t.confidential,
        required: t.required,
        waiverAllowed: t.waiverAllowed,
        waiverAuthority: t.waiverAuthority,
        dueBasis: t.dueBasis,
        dueOffsetDays: t.dueOffsetDays,
        dueOffsetKind: t.dueOffsetKind,
        releaseBasis: t.releaseBasis,
        releaseOffsetHours: t.releaseOffsetHours,
        pausesOnHold: t.pausesOnHold,
        blockPausesSla: t.blockPausesSla,
        dependsOnCodes: [...t.dependsOnCodes].sort(),
        evidenceKind: t.evidenceKind,
      })),
  };
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

/** Definition lifecycle guard (B rules 1-5). */
export function workflowDefTransitionError(
  action: 'edit' | 'activate' | 'supersede' | 'retire',
  status: WorkflowDefinitionStatus,
): string | null {
  switch (action) {
    case 'edit':
      return status === 'DRAFT' ? null : 'Non-draft workflow versions are immutable (B.3).';
    case 'activate':
      return status === 'DRAFT' ? null : `Cannot activate a ${status} version.`;
    case 'supersede':
      return status === 'ACTIVE' ? null : `Cannot supersede a ${status} version.`;
    case 'retire':
      return status === 'ACTIVE' || status === 'SUPERSEDED'
        ? null
        : `Cannot retire a ${status} version.`;
  }
}

// --- due dates with provenance (section E) -----------------------------------

export interface CaseAnchorDates {
  receivedAt: Date;
  activationAt: Date;
  effectiveSeparationAt: Date | null;
  confirmedLastDay: Date | null;
}

export interface DueComputation {
  dueAt: Date | null;
  /** Human-readable calculation rule retained with the task (E). */
  rule: string;
  sourceAt: Date | null;
}

export function computeTaskDue(
  def: Pick<TaskDefinitionShape, 'dueBasis' | 'dueOffsetDays' | 'dueOffsetKind'>,
  dates: CaseAnchorDates,
  calendar: BusinessCalendar,
): DueComputation {
  const offset = def.dueOffsetDays;
  const businessOrCalendar = (anchor: Date, label: string): DueComputation => {
    if (def.dueOffsetKind === 'CALENDAR_DAYS') {
      const due = new Date(anchor.getTime() + offset * 86_400_000);
      return {
        dueAt: due,
        rule: `${label} ${offset >= 0 ? '+' : ''}${offset} calendar day(s)`,
        sourceAt: anchor,
      };
    }
    const due =
      offset >= 1
        ? endOfNthBusinessDayAfter(anchor, offset, calendar)
        : endOfNthBusinessDayBefore(anchor, Math.abs(offset), calendar);
    return {
      dueAt: due,
      rule:
        offset >= 0
          ? `end of business day ${label} +${offset === 0 ? 0 : offset}bd`
          : `end of business day ${Math.abs(offset)}bd before ${label}`,
      sourceAt: anchor,
    };
  };

  switch (def.dueBasis) {
    case 'NONE':
      return { dueAt: null, rule: 'no due date', sourceAt: null };
    case 'CASE_RECEIVED':
      return businessOrCalendar(dates.receivedAt, 'case receipt');
    case 'WORKFLOW_ACTIVATION':
      return businessOrCalendar(dates.activationAt, 'workflow activation');
    case 'EFFECTIVE_SEPARATION': {
      if (!dates.effectiveSeparationAt)
        return { dueAt: null, rule: 'effective separation time not set', sourceAt: null };
      if (def.dueOffsetKind === 'EXACT_TIME')
        return {
          dueAt: dates.effectiveSeparationAt,
          rule: 'exact effective separation instant (elapsed clock time, not business days)',
          sourceAt: dates.effectiveSeparationAt,
        };
      return businessOrCalendar(dates.effectiveSeparationAt, 'effective separation');
    }
    case 'FINAL_WORKING_DAY': {
      // Fall back to the effective separation date when no confirmed last day
      // exists (immediate departures). Date-only anchors (stored midnight
      // UTC) are re-anchored to the same calendar date in the app zone.
      const raw = dates.confirmedLastDay ?? dates.effectiveSeparationAt;
      if (!raw) return { dueAt: null, rule: 'final working day not set', sourceAt: null };
      const anchor = interpretDateOnlyInZone(raw, calendar.timezone);
      const r = businessOrCalendar(anchor, 'final working day');
      // Where notice does not permit the lead time, clamp forward to the end
      // of the first business day after activation (never a pre-activation due).
      if (r.dueAt && r.dueAt.getTime() < dates.activationAt.getTime()) {
        return {
          dueAt: endOfNthBusinessDayAfter(dates.activationAt, 1, calendar),
          rule: `${r.rule}; clamped to activation +1bd (notice period too short)`,
          sourceAt: anchor,
        };
      }
      return r;
    }
  }
}

/** Release instant (D.1 / H.4 restricted timing). Null = releasable at once. */
export function computeTaskRelease(
  def: Pick<TaskDefinitionShape, 'releaseBasis' | 'releaseOffsetHours'>,
  dates: CaseAnchorDates,
): Date | null {
  if (def.releaseBasis === 'IMMEDIATE') return null;
  if (!dates.effectiveSeparationAt) return null;
  return new Date(dates.effectiveSeparationAt.getTime() + def.releaseOffsetHours * 3_600_000);
}

/** D.1: dependencies satisfied and release time arrived. */
export function taskReadyToRelease(
  task: { dependsOnCodes: readonly string[]; releaseAt: Date | null },
  satisfiedCodes: ReadonlySet<string>,
  now: Date,
): boolean {
  if (task.releaseAt && task.releaseAt.getTime() > now.getTime()) return false;
  return task.dependsOnCodes.every((c) => satisfiedCodes.has(c));
}

// --- task lifecycle (section D) ----------------------------------------------

export type TaskAction =
  'start' | 'complete' | 'block' | 'unblock' | 'waive' | 'reassign' | 'cancel';

const TASK_TRANSITIONS: Record<TaskAction, readonly TaskStatus[]> = {
  start: ['READY'],
  complete: ['READY', 'IN_PROGRESS', 'BLOCKED'],
  block: ['READY', 'IN_PROGRESS'],
  unblock: ['BLOCKED'],
  waive: ['NOT_READY', 'READY', 'IN_PROGRESS', 'BLOCKED'],
  reassign: ['NOT_READY', 'READY', 'IN_PROGRESS', 'BLOCKED'],
  cancel: ['NOT_READY', 'READY', 'IN_PROGRESS', 'BLOCKED'],
};

export function taskTransitionError(
  action: TaskAction,
  task: {
    status: TaskStatus;
    taskKind: TaskKind;
    waiverAllowed: boolean;
    waiverAuthority: Role;
  },
  actor: Actor | null,
  reason?: string,
): string | null {
  if (!TASK_TRANSITIONS[action].includes(task.status))
    return `Action "${action}" is not allowed from status ${task.status}.`;
  if (action === 'waive') {
    if (task.taskKind === 'ACCESS_REVOCATION') return 'Access revocation cannot be waived (I.9).';
    if (!task.waiverAllowed) return 'This task does not permit a waiver (D.8).';
    if (!reason?.trim()) return 'A waiver requires a reason (fixed default 23).';
    if (actor && !hasRole(actor, task.waiverAuthority))
      return `Only ${task.waiverAuthority} may approve this waiver (D.9).`;
  }
  if ((action === 'block' || action === 'cancel' || action === 'reassign') && !reason?.trim())
    return `Action "${action}" requires a reason.`;
  return null;
}

/** I.5: exact stored delay in whole minutes (0 when on time or early). */
export function lateMinutes(dueAt: Date | null, completedAt: Date): number | null {
  if (!dueAt) return null;
  return Math.max(0, Math.round((completedAt.getTime() - dueAt.getTime()) / 60_000));
}

// --- escalation defaults (sections I and N) ----------------------------------
// Directive 6.2 (K): these are DEFAULTS; the sweep reads the audited system
// configuration keys escalation.accessSecondMinutes,
// escalation.ordinaryEscalateBusinessDays and
// escalation.ordinaryHighBusinessDays, falling back to these values.

export const ACCESS_SECOND_ESCALATION_MINUTES = 15;
export const ORDINARY_ESCALATE_BUSINESS_DAYS = 2;
export const ORDINARY_HIGH_BUSINESS_DAYS = 3;

export interface EscalationThresholds {
  accessSecondMinutes: number;
  ordinaryEscalateBusinessDays: number;
  ordinaryHighBusinessDays: number;
}

export const DEFAULT_ESCALATION_THRESHOLDS: EscalationThresholds = {
  accessSecondMinutes: ACCESS_SECOND_ESCALATION_MINUTES,
  ordinaryEscalateBusinessDays: ORDINARY_ESCALATE_BUSINESS_DAYS,
  ordinaryHighBusinessDays: ORDINARY_HIGH_BUSINESS_DAYS,
};

export type ExceptionSeverity = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';

/**
 * Overdue evaluation for a single open task. BLOCKED tasks whose definition
 * pauses the SLA while blocked are not escalated (D.6/D.7).
 */
export function overdueSeverity(
  task: {
    status: TaskStatus;
    taskKind: TaskKind;
    dueAt: Date | null;
    blockPausesSla: boolean;
  },
  now: Date,
  businessDaysOverdue: number,
  highBusinessDays: number = ORDINARY_HIGH_BUSINESS_DAYS,
): { overdue: boolean; severity: ExceptionSeverity | null } {
  if (!task.dueAt || !OPEN_TASK_STATUSES.includes(task.status) || task.status === 'NOT_READY')
    return { overdue: false, severity: null };
  if (task.dueAt.getTime() > now.getTime()) return { overdue: false, severity: null };
  if (task.status === 'BLOCKED' && task.blockPausesSla) return { overdue: false, severity: null };
  if (task.taskKind === 'ACCESS_REVOCATION') return { overdue: true, severity: 'CRITICAL' };
  return {
    overdue: true,
    severity: businessDaysOverdue >= highBusinessDays ? 'HIGH' : 'WARNING',
  };
}

// --- queue access (sections J and R) -----------------------------------------

/**
 * Departments whose queue a role may read. SYSTEM_ADMIN: none (R.8).
 * Directive 6.3 I/J: IT and Finance are reached by controlled email, never
 * logins - HR works any residual IT/FINANCE tasks on legacy (v1) instances.
 */
export function queueDepartmentsForActor(actor: Actor): TaskDepartment[] {
  const out: TaskDepartment[] = [];
  if (hasRole(actor, 'HR_MANAGER', 'HR_OFFICER')) out.push('HR', 'IT', 'FINANCE');
  if (hasRole(actor, 'LINE_MANAGER')) out.push('LINE_MANAGER');
  return out;
}

/**
 * Line managers see only tasks expressly assigned to them (H.6); other
 * departments see their department's released tasks with minimum data.
 */
export function departmentQueueRequiresAssignment(department: TaskDepartment): boolean {
  return department === 'LINE_MANAGER';
}

// --- workflow instance lifecycle ---------------------------------------------

export function instanceTransitionError(
  action: 'hold' | 'resume' | 'requestClearance' | 'complete' | 'cancel' | 'supersede',
  status: WorkflowInstanceStatus,
): string | null {
  const allowed: Record<typeof action, readonly WorkflowInstanceStatus[]> = {
    hold: ['ACTIVE'],
    resume: ['ON_HOLD'],
    requestClearance: ['ACTIVE'],
    complete: ['CLEARANCE_PENDING'],
    cancel: ['ACTIVE', 'ON_HOLD', 'CLEARANCE_PENDING'],
    supersede: ['ACTIVE', 'ON_HOLD', 'CLEARANCE_PENDING'],
  };
  return allowed[action].includes(status)
    ? null
    : `Workflow action "${action}" is not allowed from status ${status}.`;
}
