/**
 * Stage 4 operational rules (Directive 4 sections E-H, N, P, Q, R):
 * identity-claim validation, BambooHR field mapping and reconciliation,
 * storage-path and scanner rules, reporting suppression and deterministic
 * summaries, retention eligibility, backup metadata and fallback references.
 */

// --- identity (section E) ----------------------------------------------------

export interface IdClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  email?: string;
  name?: string;
  exp?: number;
}

/**
 * E.8: claims are validated against SERVER configuration; role claims from
 * the client are never accepted - application roles resolve exclusively from
 * the server-side role_assignment table (E.9).
 */
export function idClaimErrors(
  claims: IdClaims,
  expected: { issuer: string; audience: string },
  nowSeconds: number,
): string[] {
  const errors: string[] = [];
  if (!claims.sub?.trim()) errors.push('Missing subject (sub) claim.');
  if (claims.iss !== expected.issuer) errors.push('Issuer mismatch.');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(expected.audience)) errors.push('Audience mismatch.');
  if (!claims.exp || claims.exp <= nowSeconds) errors.push('Token expired.');
  if (!claims.email?.trim()) errors.push('Missing email claim.');
  return errors;
}

/** Claim keys that are DELIBERATELY ignored if presented by a client. */
export const IGNORED_CLAIM_KEYS = ['roles', 'groups', 'permissions', 'admin'] as const;

// --- BambooHR mapping (section F) --------------------------------------------

/** F.3/F.4: only these fields are requested, stored and mapped. */
export const BAMBOO_FIELD_MAPPING: ReadonlyArray<{
  sourceField: string;
  targetField: 'displayName' | 'workEmail' | 'jobTitle' | 'department' | 'location';
}> = [
  { sourceField: 'displayName', targetField: 'displayName' },
  { sourceField: 'workEmail', targetField: 'workEmail' },
  { sourceField: 'jobTitle', targetField: 'jobTitle' },
  { sourceField: 'department', targetField: 'department' },
  { sourceField: 'location', targetField: 'location' },
];

export interface EmployeeFieldSet {
  displayName: string;
  workEmail: string | null;
  jobTitle: string | null;
  department: string | null;
  location: string | null;
}

/** F.6: differences shown before overwriting mutable source fields. */
export function computeEmployeeDiff(
  current: EmployeeFieldSet,
  incoming: EmployeeFieldSet,
): Array<{ field: string; from: string | null; to: string | null }> {
  const diffs: Array<{ field: string; from: string | null; to: string | null }> = [];
  for (const m of BAMBOO_FIELD_MAPPING) {
    const from = current[m.targetField] ?? null;
    const to = incoming[m.targetField] ?? null;
    if (from !== to) diffs.push({ field: m.targetField, from, to });
  }
  return diffs;
}

/** Case fields the adapter must NEVER touch (F.7/F.8). */
export const SYNC_FORBIDDEN_CASE_FIELDS = [
  'departureType',
  'confirmedLastDay',
  'effectiveSeparationAt',
  'reasonCategoryId',
  'reasonNotes',
  'rehireEligibility',
  'status',
] as const;

export type ReconciliationKind =
  | 'SOURCE_EMPLOYEE_MISSING'
  | 'INACTIVE_SOURCE_EMPLOYEE'
  | 'CHANGED_MANAGER'
  | 'CHANGED_DEPARTMENT_OR_LOCATION'
  | 'UNMATCHED_EMPLOYEE_IDENTIFIER'
  | 'DUPLICATE_EXTERNAL_IDENTIFIER';

// --- storage (section G) -----------------------------------------------------

export const STORAGE_PREFIXES = ['quarantine', 'clean', 'rejected', 'generated'] as const;
export type StoragePrefix = (typeof STORAGE_PREFIXES)[number];

// Legacy Stage 1-3 keys are bare 48-hex random strings; Stage 4 keys are
// prefixed with an approved path segment. Both are system-generated randomness
// with no meaningful text and never an employee name (G rules).
const PREFIXED_KEY_RE = /^(quarantine|clean|rejected|generated)\/[a-f0-9]{48}$/;
const LEGACY_KEY_RE = /^[a-f0-9]{48}$/;

export function storageKeyErrors(key: string): string[] {
  return PREFIXED_KEY_RE.test(key) || LEGACY_KEY_RE.test(key)
    ? []
    : ['Storage keys must be system-generated randomness with an approved prefix.'];
}

// --- scanner (section H) -----------------------------------------------------

export const SCAN_STATUSES_V2 = [
  'QUARANTINED',
  'SCAN_PENDING',
  'CLEAN',
  'INFECTED',
  'SCAN_FAILED',
  'REJECTED',
] as const;

/** H.1/H.2/H.4: is the content downloadable? Only CLEAN, ever. */
export function downloadableScanStatuses(): readonly string[] {
  return ['CLEAN'];
}

export function scannerUnavailableOutcome(): {
  status: 'QUARANTINED';
  openException: true;
  note: string;
} {
  // H.2: unavailable scanner leaves uploads quarantined; never auto-clean.
  return {
    status: 'QUARANTINED',
    openException: true,
    note: 'Scanner unavailable: upload remains quarantined; no automatic clean result is assigned.',
  };
}

// --- reporting (section N) ---------------------------------------------------

export const DEFAULT_SUPPRESSION_THRESHOLD = 5;

/**
 * N.4/N.5: small-group suppression. Rows whose count is below the threshold
 * are replaced by a suppressed marker so small groups cannot be identified.
 */
export function suppressSmallGroups<T extends { count: number }>(
  rows: readonly T[],
  threshold: number = DEFAULT_SUPPRESSION_THRESHOLD,
): Array<T | { suppressed: true; count: null }> {
  return rows.map((r) => (r.count < threshold ? ({ suppressed: true, count: null } as const) : r));
}

const SUMMARY_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'of',
  'to',
  'in',
  'for',
  'on',
  'with',
  'at',
  'was',
  'is',
  'are',
  'were',
  'be',
  'been',
  'i',
  'my',
  'me',
  'we',
  'our',
  'you',
  'your',
  'it',
  'its',
  'this',
  'that',
  'there',
  'not',
  'no',
  'very',
  'more',
  'so',
  'as',
  'by',
  'from',
  'have',
  'had',
  'has',
  'would',
  'could',
  'should',
  'they',
  'their',
  'them',
]);

/**
 * N.14/N.11: deterministic keyword summary - explicit word-frequency counting
 * only, no AI inference of themes. Limitations: counts surface FREQUENT words,
 * not meaning; results must be read alongside the underlying categories.
 */
export function deterministicKeywordSummary(
  texts: readonly string[],
  topN = 10,
): Array<{ keyword: string; count: number }> {
  const counts = new Map<string, number>();
  for (const t of texts) {
    const seen = new Set<string>();
    for (const raw of t.toLowerCase().split(/[^a-z']+/)) {
      const w = raw.replace(/^'+|'+$/g, '');
      if (w.length < 4 || SUMMARY_STOPWORDS.has(w) || seen.has(w)) continue;
      seen.add(w); // count each keyword once per response
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
    .slice(0, topN);
}

// --- retention (section P) ---------------------------------------------------

export interface RetentionPolicyLike {
  recordType: string;
  retainYears: number;
  active: boolean;
  approvedById: string | null;
}

/**
 * P: a record is retention-eligible only when the ACTIVE APPROVED policy
 * period has elapsed and no hold applies (P.4).
 */
export function retentionEligible(
  record: { closedAt: Date | null; hasActiveHold: boolean },
  policy: RetentionPolicyLike,
  now: Date,
): { eligible: boolean; reason: string } {
  if (!policy.active || !policy.approvedById)
    return { eligible: false, reason: 'No active approved retention policy.' };
  if (!record.closedAt) return { eligible: false, reason: 'Record is not closed.' };
  if (record.hasActiveHold)
    return { eligible: false, reason: 'A legal/administrative hold applies.' };
  const due = new Date(record.closedAt);
  due.setFullYear(due.getFullYear() + policy.retainYears);
  if (due.getTime() > now.getTime())
    return {
      eligible: false,
      reason: `Retention period runs until ${due.toISOString().slice(0, 10)}.`,
    };
  return { eligible: true, reason: 'Retention period elapsed and no hold applies.' };
}

/** Case identity fields replaced by the approved anonymization workflow. */
export const ANONYMIZED_CASE_FIELDS = [
  'employeeDisplayName',
  'employeeWorkEmail',
  'reasonNotes',
] as const;

/** P.8: exclusions for data-subject packages. */
export const DSR_PACKAGE_EXCLUSIONS = [
  'other employees’ personal data',
  'restricted manager/private notes not lawfully disclosable',
  'secrets and credential references',
  'internal security details',
] as const;

// --- backup (section Q) ------------------------------------------------------

export function backupMetadataErrors(meta: {
  kind: string;
  sizeBytes: number | bigint;
  checksum: string;
  objectPath: string;
}): string[] {
  const errors: string[] = [];
  if (meta.kind !== 'DATABASE') errors.push('Unsupported backup kind.');
  if (BigInt(meta.sizeBytes) <= BigInt(0)) errors.push('Backup file is empty.');
  if (!/^[a-f0-9]{64}$/.test(meta.checksum)) errors.push('Checksum must be SHA-256 hex.');
  if (!meta.objectPath.trim()) errors.push('Backup path is required.');
  return errors;
}

// --- manual fallback (section R) ---------------------------------------------

/** Controlled fallback reference: FB-<year>-<seq> (R "controlled numbers"). */
export function fallbackRefNumber(year: number, seq: number): string {
  return `FB-${year}-${String(seq).padStart(4, '0')}`;
}

export function isFallbackRef(value: string): boolean {
  return /^FB-\d{4}-\d{4}$/.test(value);
}
