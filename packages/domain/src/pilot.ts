/**
 * Pilot activation model and readiness gates (Directive 4 sections L-M).
 */
import { createHash } from 'node:crypto';

export const ACTIVATION_STATES = [
  'DISABLED',
  'TEST_ONLY',
  'TRAINING_ENABLED',
  'PILOT_READY',
  'PILOT_ACTIVE',
  'POST_ROLLOUT_READY',
  'POST_ROLLOUT_ACTIVE',
  'SUSPENDED',
] as const;
export type ActivationStateName = (typeof ACTIVATION_STATES)[number];

/** L.1: safe defaults. */
export const DEFAULT_ACTIVATION_STATE: ActivationStateName = 'TEST_ONLY';

const STATE_ORDER: Readonly<Record<ActivationStateName, readonly ActivationStateName[]>> = {
  DISABLED: ['TEST_ONLY'],
  TEST_ONLY: ['TRAINING_ENABLED', 'DISABLED'],
  TRAINING_ENABLED: ['PILOT_READY', 'TEST_ONLY', 'DISABLED'],
  PILOT_READY: ['PILOT_ACTIVE', 'TRAINING_ENABLED', 'DISABLED'],
  PILOT_ACTIVE: ['SUSPENDED', 'POST_ROLLOUT_READY'],
  POST_ROLLOUT_READY: ['POST_ROLLOUT_ACTIVE', 'SUSPENDED'],
  POST_ROLLOUT_ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['PILOT_READY', 'TRAINING_ENABLED', 'DISABLED'],
};

export function activationTransitionError(
  from: ActivationStateName,
  to: ActivationStateName,
): string | null {
  return STATE_ORDER[from].includes(to) ? null : `Activation cannot move from ${from} to ${to}.`;
}

export interface ActivationScope {
  departments?: readonly string[];
  locations?: readonly string[];
  departureTypes?: readonly string[];
  dateFrom?: string | null;
  dateTo?: string | null;
  maxActiveCases?: number | null;
}

/** L.7: is a case inside the activation scope? */
export function caseInScope(
  scope: ActivationScope,
  c: { department: string; location: string; departureType: string; createdAt: Date },
  activePilotCaseCount: number,
): { ok: boolean; reason?: string } {
  if (scope.departments?.length && !scope.departments.includes(c.department))
    return { ok: false, reason: 'department outside pilot scope' };
  if (scope.locations?.length && !scope.locations.includes(c.location))
    return { ok: false, reason: 'location outside pilot scope' };
  if (scope.departureTypes?.length && !scope.departureTypes.includes(c.departureType))
    return { ok: false, reason: 'departure type outside pilot scope' };
  if (scope.dateFrom && c.createdAt < new Date(scope.dateFrom))
    return { ok: false, reason: 'before pilot date range' };
  if (scope.dateTo && c.createdAt > new Date(scope.dateTo))
    return { ok: false, reason: 'after pilot date range' };
  if (
    scope.maxActiveCases !== null &&
    scope.maxActiveCases !== undefined &&
    activePilotCaseCount >= scope.maxActiveCases
  )
    return { ok: false, reason: 'maximum active pilot cases reached' };
  return { ok: true };
}

export function activationChecksum(record: {
  environment: string;
  cohort: string;
  scope: unknown;
  enabledIntegrations: unknown;
  approvedWorkflowVersions: unknown;
  approvedTemplateVersions: unknown;
  approvedCalendarVersion: number | null;
  rollbackPlan: string;
}): string {
  return createHash('sha256').update(JSON.stringify(record), 'utf8').digest('hex');
}

// --- readiness gates (section M) ---------------------------------------------

export interface GateResult {
  key: string;
  label: string;
  mandatory: boolean;
  ok: boolean;
  detail: string;
}

/** The 24 pilot readiness gates. Mandatory gates block PILOT_ACTIVE. */
export const READINESS_GATES: ReadonlyArray<{ key: string; label: string; mandatory: boolean }> = [
  {
    key: 'workflowVersions',
    label: 'Approved workflow versions (one ACTIVE per type)',
    mandatory: true,
  },
  { key: 'documentTemplates', label: 'Approved document templates', mandatory: true },
  { key: 'notificationTemplates', label: 'Approved notification templates', mandatory: true },
  { key: 'recipients', label: 'Verified recipient configurations', mandatory: true },
  { key: 'calendar', label: 'Business calendar approval', mandatory: true },
  { key: 'reasonTaxonomy', label: 'Reason taxonomy approval', mandatory: true },
  { key: 'identityProvider', label: 'Identity provider health', mandatory: true },
  { key: 'emailProvider', label: 'Email provider health', mandatory: true },
  { key: 'bamboohr', label: 'BambooHR adapter health', mandatory: false },
  { key: 'objectStorage', label: 'Object-storage health', mandatory: true },
  { key: 'malwareScanner', label: 'Malware-scanner health', mandatory: true },
  { key: 'worker', label: 'Worker health', mandatory: true },
  { key: 'migrations', label: 'Database migration status', mandatory: true },
  { key: 'backup', label: 'Backup status', mandatory: true },
  { key: 'restoreTest', label: 'Restore-test status', mandatory: true },
  { key: 'retentionPolicy', label: 'Retention-policy status', mandatory: true },
  { key: 'criticalExceptions', label: 'No unresolved CRITICAL exceptions', mandatory: true },
  { key: 'securityFindings', label: 'No unresolved security findings', mandatory: true },
  { key: 'uat', label: 'UAT status', mandatory: true },
  { key: 'training', label: 'Training completion', mandatory: false },
  { key: 'sop', label: 'SOP availability', mandatory: true },
  { key: 'manualFallback', label: 'Manual fallback readiness', mandatory: true },
  { key: 'auditLog', label: 'Audit-log health', mandatory: true },
  { key: 'integrationTimestamps', label: 'Integration last-success timestamps', mandatory: false },
];

export function evaluateGateBlockers(results: readonly GateResult[]): GateResult[] {
  return results.filter((g) => g.mandatory && !g.ok);
}
