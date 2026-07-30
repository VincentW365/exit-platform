/**
 * Asset recovery and disposition rules (Directive 3 section L).
 *
 * Hard boundaries (fixed defaults 17-19): asset states NEVER create a payroll
 * instruction, calculate a deduction or block/alter final pay. Unresolved
 * assets surface as review exceptions only.
 */
export const ASSET_TYPES = [
  'EMPLOYEE_ID_CARD',
  'ACCESS_CARD',
  'HEALTH_CARD',
  'LUNCH_CARD',
  'UNIFORM',
  'LAPTOP',
  'MOBILE_PHONE',
  'KEYS',
  'EMPLOYEE_HANDBOOK',
  'COMPANY_DOCUMENTS',
  'OTHER',
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_TYPE_LABELS: Readonly<Record<AssetType, string>> = {
  EMPLOYEE_ID_CARD: 'Employee identification card',
  ACCESS_CARD: 'Access card / door pass',
  HEALTH_CARD: 'Health card',
  LUNCH_CARD: 'Lunch card',
  UNIFORM: 'Uniform',
  LAPTOP: 'Laptop',
  MOBILE_PHONE: 'Mobile phone',
  KEYS: 'Keys',
  EMPLOYEE_HANDBOOK: 'Employee handbook',
  COMPANY_DOCUMENTS: 'Company documents',
  OTHER: 'Other approved asset',
};

export const ASSET_STATUSES = [
  'EXPECTED',
  'REQUESTED',
  'PARTIALLY_RETURNED',
  'RETURNED',
  'NOT_ISSUED',
  'LOST',
  'DAMAGED',
  'WAIVED',
  'WRITTEN_OFF',
  'UNRESOLVED',
] as const;
export type AssetRecoveryStatus = (typeof ASSET_STATUSES)[number];

/** Final documented dispositions (L). */
export const FINAL_DISPOSITIONS: readonly AssetRecoveryStatus[] = [
  'RETURNED',
  'NOT_ISSUED',
  'LOST',
  'DAMAGED',
  'WAIVED',
  'WRITTEN_OFF',
  'UNRESOLVED',
];

/** Open operational states. */
export const OPEN_ASSET_STATUSES: readonly AssetRecoveryStatus[] = [
  'EXPECTED',
  'REQUESTED',
  'PARTIALLY_RETURNED',
];

/** L.4: dispositions that require a reason and an authorized actor. */
export const REASONED_DISPOSITIONS: readonly AssetRecoveryStatus[] = [
  'LOST',
  'DAMAGED',
  'WAIVED',
  'WRITTEN_OFF',
  'UNRESOLVED',
];

/** Dispositions that only HR_MANAGER may record (write-off authority). */
export const MANAGER_ONLY_DISPOSITIONS: readonly AssetRecoveryStatus[] = ['WAIVED', 'WRITTEN_OFF'];

export function assetDispositionError(
  next: AssetRecoveryStatus,
  reason: string | undefined,
  actorIsHrManager: boolean,
): string | null {
  if (REASONED_DISPOSITIONS.includes(next) && !reason?.trim())
    return `Disposition ${next} requires a reason (L.4).`;
  if (MANAGER_ONLY_DISPOSITIONS.includes(next) && !actorIsHrManager)
    return `Disposition ${next} requires HR_MANAGER authority.`;
  return null;
}

export interface AssetItemLike {
  status: AssetRecoveryStatus;
  requiredForClearance: boolean;
}

/**
 * L.1 + L.8/L.9: documentation rate vs physical recovery rate are distinct
 * measures with distinct denominators.
 */
export function assetMetrics(items: readonly AssetItemLike[]): {
  requiredCount: number;
  documentedCount: number;
  documentationRatePct: number | null;
  physicalDenominator: number;
  physicallyReturned: number;
  physicalRecoveryRatePct: number | null;
  openCount: number;
  unresolvedCount: number;
} {
  const required = items.filter((i) => i.requiredForClearance);
  // Documented = a real final disposition (UNRESOLVED does not count - L.3).
  const documented = required.filter(
    (i) => FINAL_DISPOSITIONS.includes(i.status) && i.status !== 'UNRESOLVED',
  );
  // Physical denominator: actually issued and due for return (excludes NOT_ISSUED - L.9).
  const physicalDen = required.filter((i) => i.status !== 'NOT_ISSUED');
  const returned = required.filter((i) => i.status === 'RETURNED');
  const pct = (num: number, den: number): number | null =>
    den === 0 ? null : Math.round((num / den) * 1000) / 10;
  return {
    requiredCount: required.length,
    documentedCount: documented.length,
    documentationRatePct: pct(documented.length, required.length),
    physicalDenominator: physicalDen.length,
    physicallyReturned: returned.length,
    physicalRecoveryRatePct: pct(returned.length, physicalDen.length),
    openCount: required.filter((i) => OPEN_ASSET_STATUSES.includes(i.status)).length,
    unresolvedCount: required.filter((i) => i.status === 'UNRESOLVED').length,
  };
}

/**
 * L.2/L.3: clearance-side check. Every required item needs a final documented
 * disposition; UNRESOLVED only passes with an approved exception.
 */
export function assetsSatisfyClearance(
  items: readonly AssetItemLike[],
  unresolvedExceptionApproved: boolean,
): { ok: boolean; detail: string } {
  const required = items.filter((i) => i.requiredForClearance);
  const open = required.filter((i) => OPEN_ASSET_STATUSES.includes(i.status));
  const unresolved = required.filter((i) => i.status === 'UNRESOLVED');
  if (open.length > 0)
    return { ok: false, detail: `${open.length} asset(s) without a documented disposition.` };
  if (unresolved.length > 0 && !unresolvedExceptionApproved)
    return {
      ok: false,
      detail: `${unresolved.length} UNRESOLVED asset(s) without an approved exception (L.3).`,
    };
  return { ok: true, detail: 'All required assets have documented dispositions.' };
}
