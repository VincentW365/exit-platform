/**
 * Baseline capture vocabulary (BaselineDataCapturePlan.md sections 5 and 9,
 * REQ-REPORT-020, IC-S1-004).
 *
 * Baseline facts are manual, structured recordings of what the CURRENT
 * process did - they do not drive workflow and they never trigger automation.
 * Events are append-only; corrections supersede, never overwrite.
 */
export const BASELINE_EVENT_TYPES = [
  'DOCUMENT_REQUESTED',
  'DOCUMENT_APPROVED',
  'DOCUMENT_ISSUED',
  'NOTIFICATION_SENT',
  'ACCESS_REMOVAL_REQUESTED',
  'ACCESS_REMOVAL_DUE',
  'ACCESS_REMOVAL_COMPLETED',
  'ASSET_DUE',
  'ASSET_RETURNED',
  'ASSET_DISPOSITION_RECORDED',
  'EXIT_FEEDBACK_OFFERED',
  'EXIT_FEEDBACK_COMPLETED',
  'PROCESS_COMPLETED',
] as const;

export type BaselineEventType = (typeof BASELINE_EVENT_TYPES)[number];

/** Event types whose occurrence time may legitimately be in the future. */
const FUTURE_ALLOWED: readonly BaselineEventType[] = ['ACCESS_REMOVAL_DUE', 'ASSET_DUE'];

/** Missing-data reason codes (plan section 9). */
export const MISSING_REASONS = [
  'NOT_RECORDED_CURRENT_PROCESS',
  'SOURCE_UNAVAILABLE',
  'NOT_APPLICABLE',
  'CASE_IN_PROGRESS',
  'DISPUTED',
  'UNKNOWN_OTHER',
] as const;

export type MissingReason = (typeof MISSING_REASONS)[number];

export interface BaselineEventInput {
  readonly eventType: BaselineEventType;
  /** Reported real-world event time; null when unknown (then missingReason required). */
  readonly occurredAt: Date | null;
  readonly missingReason: MissingReason | null;
  readonly missingNote: string | null;
  /** Short structured detail, e.g. the notified department. Not free-form narrative. */
  readonly detail: string | null;
  /** Reference to the evidence location (no document content). */
  readonly evidenceRef: string | null;
}

export function baselineEventErrors(input: BaselineEventInput, now: Date): string[] {
  const errors: string[] = [];
  if (input.occurredAt === null && input.missingReason === null) {
    errors.push('Either an event time or a missing-data reason code is required.');
  }
  if (input.occurredAt !== null && input.missingReason !== null) {
    errors.push('Provide an event time or a missing-data reason, not both.');
  }
  if (
    input.occurredAt !== null &&
    !FUTURE_ALLOWED.includes(input.eventType) &&
    input.occurredAt.getTime() > now.getTime() + 5 * 60_000
  ) {
    errors.push('Event time cannot be in the future (only due-type events may be scheduled).');
  }
  if (input.missingReason === 'UNKNOWN_OTHER' && !input.missingNote?.trim()) {
    errors.push('UNKNOWN_OTHER requires an explanation.');
  }
  if (input.detail && input.detail.length > 200)
    errors.push('Detail must be 200 characters or fewer.');
  if (input.missingNote && input.missingNote.length > 300)
    errors.push('Missing-data note must be 300 characters or fewer.');
  if (input.evidenceRef && input.evidenceRef.length > 300)
    errors.push('Evidence reference must be 300 characters or fewer.');
  return errors;
}

/**
 * Completeness view: which baseline facts are still unrecorded for a case.
 * Used by the missing-fields report (plan section 7).
 */
export function missingBaselineEventTypes(
  recorded: readonly BaselineEventType[],
): readonly BaselineEventType[] {
  return BASELINE_EVENT_TYPES.filter((t) => !recorded.includes(t));
}
