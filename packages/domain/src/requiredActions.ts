/**
 * Required-actions projection for the case overview (Directive 6.3 X/Y,
 * corrections 7-8).
 *
 * A case may internally hold many derived actions; HR sees an exception-first
 * summary: "Requires your attention" (only unresolved items), then "In
 * progress automatically", then "Completed". Pure: the service gathers rows,
 * this module buckets and phrases them in business language.
 */

export const REQUIRED_ACTION_STATUSES = [
  'AUTOMATED',
  'READY',
  'WAITING',
  'ACTION_REQUIRED',
  'COMPLETE',
  'NOT_APPLICABLE',
  'FAILED',
  'OVERDUE',
] as const;
export type RequiredActionStatus = (typeof REQUIRED_ACTION_STATUSES)[number];

export interface RequiredActionRow {
  /** Stable key for links/tests. */
  key: string;
  /** Business-language label, e.g. "IT access-removal email". */
  label: string;
  /** Business-language status detail, e.g. "Scheduled for 5:00 PM". */
  detail: string;
  status: RequiredActionStatus;
  /** Grouping bucket per Directive Y. */
  group:
    | 'HR'
    | 'DOCUMENTS'
    | 'MANAGER_HANDOVER'
    | 'IT'
    | 'FINANCE'
    | 'BENEFITS'
    | 'ASSETS'
    | 'SURVEY'
    | 'CLEARANCE';
  /** Where clicking the row leads. */
  href: string;
  /** Due instant where one exists (drives OVERDUE presentation). */
  dueAt: Date | null;
  /** True when the platform is progressing this without HR input. */
  automated: boolean;
}

export interface RequiredActionsSummary {
  /** Only items needing a human decision - the panel lead (correction 8). */
  attention: RequiredActionRow[];
  /** Progressing automatically - visible but quiet. */
  automatic: RequiredActionRow[];
  /** Done or not applicable - collapsed by default. */
  done: RequiredActionRow[];
  counts: { attention: number; automatic: number; done: number };
}

const ATTENTION_STATUSES: readonly RequiredActionStatus[] = [
  'ACTION_REQUIRED',
  'FAILED',
  'OVERDUE',
];
const DONE_STATUSES: readonly RequiredActionStatus[] = ['COMPLETE', 'NOT_APPLICABLE'];

/** Bucket rows exception-first; order inside each bucket is caller-provided. */
export function summarizeRequiredActions(
  rows: readonly RequiredActionRow[],
): RequiredActionsSummary {
  const attention = rows.filter((r) => ATTENTION_STATUSES.includes(r.status));
  const done = rows.filter((r) => DONE_STATUSES.includes(r.status));
  const automatic = rows.filter(
    (r) => !ATTENTION_STATUSES.includes(r.status) && !DONE_STATUSES.includes(r.status),
  );
  return {
    attention,
    automatic,
    done,
    counts: { attention: attention.length, automatic: automatic.length, done: done.length },
  };
}

export const REQUIRED_ACTION_STATUS_LABELS: Readonly<Record<RequiredActionStatus, string>> = {
  AUTOMATED: 'Automatic',
  READY: 'Ready',
  WAITING: 'Waiting',
  ACTION_REQUIRED: 'Needs your attention',
  COMPLETE: 'Complete',
  NOT_APPLICABLE: 'Not applicable',
  FAILED: 'Failed',
  OVERDUE: 'Overdue',
};
