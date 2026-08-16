/**
 * Assignment-plan confirmation rules (Directive 6.1 sections E/F/J).
 *
 * Before workflow activation HR must review and confirm the assignment plan.
 * The six confirmation keys are shared by the service, the UI and the tests;
 * activation requires all of them, recorded after the last manager change.
 */

export const CONFIRMATION_KEYS = [
  'employee-identity',
  'manager-routing',
  'hr-ownership',
  'it-routing',
  'finance-routing',
  'workflow-selection',
] as const;

export type ConfirmationKey = (typeof CONFIRMATION_KEYS)[number];

export const CONFIRMATION_LABELS: Readonly<Record<ConfirmationKey, string>> = {
  'employee-identity': 'Employee information reviewed',
  'manager-routing': 'Reporting manager confirmed',
  'hr-ownership': 'HR Officer assigned',
  'it-routing': 'IT notification routing reviewed (automated email)',
  'finance-routing': 'Finance notification routing reviewed (automated email)',
  'workflow-selection': 'Effective separation date/time and workflow confirmed',
};

export interface ConfirmationEntry {
  readonly at: string;
  readonly byId: string;
}

export type ConfirmationState = Partial<Record<ConfirmationKey, ConfirmationEntry>>;

/** Validation errors for a submitted confirmation set (all-or-nothing). */
export function confirmationErrors(submitted: readonly string[]): string[] {
  const errors: string[] = [];
  const unknown = submitted.filter((k) => !(CONFIRMATION_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) errors.push(`Unknown confirmation key(s): ${unknown.join(', ')}.`);
  const missing = CONFIRMATION_KEYS.filter((k) => !submitted.includes(k));
  if (missing.length > 0)
    errors.push(
      `All confirmations are required before activation; missing: ${missing
        .map((k) => CONFIRMATION_LABELS[k])
        .join('; ')}.`,
    );
  return errors;
}

/**
 * Activation gate (Directive 6.1 J): every key confirmed, and none of the
 * confirmations predate the latest manager change (a re-derived or overridden
 * manager invalidates the review).
 */
export function activationConfirmationErrors(
  state: ConfirmationState | null | undefined,
  managerChangedAt: Date | null,
): string[] {
  const errors: string[] = [];
  const missing = CONFIRMATION_KEYS.filter((k) => !state?.[k]);
  if (missing.length > 0) {
    errors.push(
      `Assignment plan is not confirmed (${missing.length} of ${CONFIRMATION_KEYS.length} confirmations outstanding). Complete the Assignment tab first.`,
    );
    return errors;
  }
  if (managerChangedAt) {
    const stale = CONFIRMATION_KEYS.filter((k) => {
      const at = state?.[k]?.at;
      return !at || new Date(at).getTime() < managerChangedAt.getTime();
    });
    if (stale.length > 0)
      errors.push(
        'The manager routing changed after the assignment plan was confirmed; review and re-confirm the Assignment tab.',
      );
  }
  return errors;
}
