/**
 * Shared next-action computation (Directive 6.2 U).
 *
 * One work-aware answer to "what do I need to do next?" for a case, consumed
 * by the case header, dashboard and progress surfaces. Pure: the caller
 * supplies status, stage summaries and task counts; this module only decides.
 */

export interface NextActionStage {
  readonly key: string;
  readonly label: string;
  readonly state: 'COMPLETED' | 'IN_PROGRESS' | 'BLOCKED' | 'NOT_STARTED' | 'NOT_APPLICABLE';
  readonly detail: string;
  readonly href: string;
}

export interface NextActionInput {
  readonly status: string;
  readonly stages: readonly NextActionStage[];
  readonly openRequiredTasks: number;
  readonly overdueTasks: number;
  readonly blockedTasks: number;
}

export interface CaseNextAction {
  readonly label: string;
  readonly href: string;
  /** attention = act now; progress = keep working; done = nothing left. */
  readonly tone: 'attention' | 'progress' | 'done';
}

export function computeCaseNextAction(
  caseId: string,
  input: NextActionInput,
): CaseNextAction | null {
  const base = `/cases/${caseId}`;
  switch (input.status) {
    case 'DRAFT':
      return { label: 'Complete the draft and submit for HR review', href: base, tone: 'progress' };
    case 'PENDING_HR_REVIEW':
      return { label: 'HR Manager: review and approve the case', href: base, tone: 'attention' };
    case 'APPROVED':
      return {
        label: 'Complete the responsibility plan, then activate the workflow',
        href: `${base}/assignment`,
        tone: 'attention',
      };
    case 'ON_HOLD':
      return { label: 'Case on hold - resume when ready', href: base, tone: 'attention' };
    case 'CLEARANCE_REVIEW':
      return {
        label: 'HR Manager: final clearance decision',
        href: `${base}/clearance`,
        tone: 'attention',
      };
    case 'COMPLETED':
    case 'CANCELLED':
    case 'VOIDED':
      return null;
  }

  // ACTIVE / REOPENED: pick the most urgent open work.
  if (input.blockedTasks > 0) {
    return {
      label: `${input.blockedTasks} blocked task(s) - clear the blocker(s)`,
      href: `${base}/workflow`,
      tone: 'attention',
    };
  }
  if (input.overdueTasks > 0) {
    return {
      label: `${input.overdueTasks} overdue task(s) - work these first`,
      href: `${base}/workflow`,
      tone: 'attention',
    };
  }
  if (input.openRequiredTasks > 0) {
    const inProgress = input.stages.filter(
      (s) => s.state === 'IN_PROGRESS' && !['CASE', 'CLEARANCE'].includes(s.key),
    );
    const where = inProgress.length > 0 ? ` (${inProgress.map((s) => s.label).join(', ')})` : '';
    return {
      label: `${input.openRequiredTasks} required task(s) open${where}`,
      href: inProgress[0]?.href ?? `${base}/workflow`,
      tone: 'progress',
    };
  }
  const nonTaskOpen = input.stages.find(
    (s) =>
      ['DOCUMENTS', 'HANDOVER', 'ASSETS', 'SURVEY'].includes(s.key) &&
      (s.state === 'IN_PROGRESS' || s.state === 'BLOCKED'),
  );
  if (nonTaskOpen) {
    return {
      label: `Finish ${nonTaskOpen.label.toLowerCase()}: ${nonTaskOpen.detail}`,
      href: nonTaskOpen.href,
      tone: 'progress',
    };
  }
  return {
    label: 'All required work is done - request final clearance',
    href: `${base}/clearance`,
    tone: 'done',
  };
}
