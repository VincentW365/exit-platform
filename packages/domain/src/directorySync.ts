/**
 * Employee directory synchronization rules (owner directive, 2026-09-15).
 *
 * BambooHR is the system of record; the platform keeps a read-only mirror
 * that its features read. These are the pure rules behind keeping that
 * mirror current: when a reconciliation is due, how fresh the mirror is,
 * whether a webhook is genuine, and which fields changed. No I/O here.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DateTime } from 'luxon';
import { APP_ZONE } from './calendar.ts';

export const DIRECTORY_SYNC_KINDS = ['WEBHOOK', 'HOURLY', 'NIGHTLY', 'STARTUP', 'MANUAL'] as const;
export type DirectorySyncKind = (typeof DIRECTORY_SYNC_KINDS)[number];

export const DIRECTORY_SYNC_STATUSES = [
  'QUEUED',
  'RUNNING',
  'SUCCESS',
  'PARTIAL',
  'FAILED',
] as const;
export type DirectorySyncStatus = (typeof DIRECTORY_SYNC_STATUSES)[number];

export const DIRECTORY_SYNC_KIND_LABELS: Record<DirectorySyncKind, string> = {
  WEBHOOK: 'BambooHR webhook',
  HOURLY: 'Hourly reconciliation',
  NIGHTLY: 'Nightly full reconciliation',
  STARTUP: 'Start-up staleness check',
  MANUAL: 'Manual refresh',
};

export const DIRECTORY_SYNC_STATUS_LABELS: Record<DirectorySyncStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'In progress',
  SUCCESS: 'Success',
  PARTIAL: 'Completed with failures',
  FAILED: 'Failed',
};

/** Kinds that read the WHOLE directory and may archive absent records. */
export const FULL_SYNC_KINDS: readonly DirectorySyncKind[] = ['NIGHTLY', 'MANUAL', 'STARTUP'];

/**
 * Configurable schedule and freshness thresholds (directive sections 19, 38).
 * Stored under the system configuration key `directory.sync`; every value
 * has a default so an untouched installation behaves as the directive asks.
 */
export interface DirectorySyncSettings {
  hourlyMinutes: number;
  nightlyHour: number;
  nightlyMinute: number;
  staleDelayedHours: number;
  staleWarningHours: number;
  staleAlertHours: number;
  startupStaleHours: number;
  webhookMaxSkewSeconds: number;
}

export const DIRECTORY_SYNC_SETTINGS_KEY = 'directory.sync';

export const DEFAULT_DIRECTORY_SYNC_SETTINGS: DirectorySyncSettings = {
  hourlyMinutes: 60,
  nightlyHour: 2,
  nightlyMinute: 0,
  staleDelayedHours: 2,
  staleWarningHours: 6,
  staleAlertHours: 24,
  startupStaleHours: 2,
  webhookMaxSkewSeconds: 300,
};

const positive = (v: unknown, fallback: number, max = 100_000): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? v : fallback;

/** Read stored settings defensively; anything odd falls back to the default. */
export function parseDirectorySyncSettings(value: unknown): DirectorySyncSettings {
  const d = DEFAULT_DIRECTORY_SYNC_SETTINGS;
  if (!value || typeof value !== 'object') return { ...d };
  const v = value as Record<string, unknown>;
  const hour =
    typeof v['nightlyHour'] === 'number' && v['nightlyHour'] >= 0 && v['nightlyHour'] <= 23
      ? Math.floor(v['nightlyHour'])
      : d.nightlyHour;
  const minute =
    typeof v['nightlyMinute'] === 'number' && v['nightlyMinute'] >= 0 && v['nightlyMinute'] <= 59
      ? Math.floor(v['nightlyMinute'])
      : d.nightlyMinute;
  return {
    hourlyMinutes: positive(v['hourlyMinutes'], d.hourlyMinutes, 24 * 60),
    nightlyHour: hour,
    nightlyMinute: minute,
    staleDelayedHours: positive(v['staleDelayedHours'], d.staleDelayedHours),
    staleWarningHours: positive(v['staleWarningHours'], d.staleWarningHours),
    staleAlertHours: positive(v['staleAlertHours'], d.staleAlertHours),
    startupStaleHours: positive(v['startupStaleHours'], d.startupStaleHours),
    webhookMaxSkewSeconds: positive(v['webhookMaxSkewSeconds'], d.webhookMaxSkewSeconds, 86_400),
  };
}

// --- freshness --------------------------------------------------------------

export type DirectoryFreshnessState = 'NEVER' | 'CURRENT' | 'DELAYED' | 'STALE' | 'ALERT';

export interface DirectoryFreshness {
  state: DirectoryFreshnessState;
  hoursSince: number | null;
  /** Short state word for badges. */
  label: string;
  /** The sentence a person sees; calm below the warning threshold. */
  message: string;
  /** Who should be told: nobody, HR quietly, or administrators loudly. */
  audience: 'none' | 'hr' | 'admin';
}

/**
 * How current the mirror is, judged by the last SUCCESSFUL synchronization
 * (directive section 19). Slightly-behind data does not alarm ordinary HR
 * users; a long gap warns; a very long gap is an administrative alert. No
 * successful sync ever is the only state in which the directory is
 * genuinely unavailable.
 */
export function directoryFreshness(
  lastSuccessfulAt: Date | null,
  now: Date,
  s: DirectorySyncSettings = DEFAULT_DIRECTORY_SYNC_SETTINGS,
): DirectoryFreshness {
  if (!lastSuccessfulAt) {
    return {
      state: 'NEVER',
      hoursSince: null,
      label: 'Never synchronized',
      message: 'The employee directory has never been synchronized from BambooHR.',
      audience: 'admin',
    };
  }
  const hours = Math.max(0, (now.getTime() - lastSuccessfulAt.getTime()) / 3_600_000);
  const ago = describeAge(hours);
  if (hours < s.staleDelayedHours) {
    return {
      state: 'CURRENT',
      hoursSince: hours,
      label: 'Current',
      message: `Directory last synchronized ${ago}.`,
      audience: 'none',
    };
  }
  if (hours < s.staleWarningHours) {
    return {
      state: 'DELAYED',
      hoursSince: hours,
      label: 'Refresh delayed',
      message: `Directory last synchronized ${ago}. The next refresh is overdue; cached employee data is being used.`,
      audience: 'hr',
    };
  }
  if (hours < s.staleAlertHours) {
    return {
      state: 'STALE',
      hoursSince: hours,
      label: 'Stale',
      message: `Directory last synchronized ${ago}. BambooHR has not been reachable for a while; cached employee data is being used.`,
      audience: 'hr',
    };
  }
  return {
    state: 'ALERT',
    hoursSince: hours,
    label: 'Administrative alert',
    message: `Directory last synchronized ${ago}. Synchronization has been failing for more than a day; cached employee data is being used.`,
    audience: 'admin',
  };
}

function describeAge(hours: number): string {
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (hours < 48) {
    const h = Math.round(hours);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// --- schedule --------------------------------------------------------------

/** The hourly reconciliation is due when no full or hourly sync has succeeded within the interval. */
export function hourlyDue(
  lastSuccessfulAt: Date | null,
  now: Date,
  s: DirectorySyncSettings = DEFAULT_DIRECTORY_SYNC_SETTINGS,
): boolean {
  if (!lastSuccessfulAt) return true;
  return now.getTime() - lastSuccessfulAt.getTime() >= s.hourlyMinutes * 60_000;
}

/** The instant of today's nightly slot in the business zone, or null if it is still ahead. */
export function nightlySlotPassed(
  now: Date,
  s: DirectorySyncSettings = DEFAULT_DIRECTORY_SYNC_SETTINGS,
  zone: string = APP_ZONE,
): Date | null {
  const local = DateTime.fromJSDate(now, { zone });
  const slot = local.set({
    hour: s.nightlyHour,
    minute: s.nightlyMinute,
    second: 0,
    millisecond: 0,
  });
  return slot <= local ? slot.toJSDate() : null;
}

/**
 * The nightly full reconciliation is due once per business day, after the
 * configured time (2:00 AM Jamaica by default), until one has succeeded
 * since that slot.
 */
export function nightlyDue(
  lastNightlySuccessAt: Date | null,
  now: Date,
  s: DirectorySyncSettings = DEFAULT_DIRECTORY_SYNC_SETTINGS,
  zone: string = APP_ZONE,
): boolean {
  const slot = nightlySlotPassed(now, s, zone);
  if (!slot) return false;
  return !lastNightlySuccessAt || lastNightlySuccessAt.getTime() < slot.getTime();
}

/** On start-up, sync at once when the mirror is materially stale (section 16). */
export function startupSyncNeeded(
  lastSuccessfulAt: Date | null,
  now: Date,
  s: DirectorySyncSettings = DEFAULT_DIRECTORY_SYNC_SETTINGS,
): boolean {
  if (!lastSuccessfulAt) return true;
  return now.getTime() - lastSuccessfulAt.getTime() >= s.startupStaleHours * 3_600_000;
}

// --- webhooks --------------------------------------------------------------

export interface WebhookVerification {
  ok: boolean;
  /** A short, PII-free reason when rejected; never the key or the body. */
  reason?: 'NO_KEY' | 'NO_SIGNATURE' | 'NO_TIMESTAMP' | 'STALE_TIMESTAMP' | 'BAD_SIGNATURE';
}

/**
 * Verify a BambooHR webhook the way BambooHR documents it for API-created
 * webhooks: the request carries `X-BambooHR-Timestamp` and
 * `X-BambooHR-Signature`, and the signature is the HMAC-SHA256 (hex) of the
 * raw body followed by the timestamp, keyed with the webhook's private key.
 * Timing-safe comparison; a timestamp outside the allowed skew is refused so
 * a captured request cannot be replayed later.
 */
export function verifyBambooWebhookSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  privateKey: string | null | undefined;
  now?: Date;
  maxSkewSeconds?: number;
}): WebhookVerification {
  const key = input.privateKey?.trim() ?? '';
  if (!key) return { ok: false, reason: 'NO_KEY' };
  const signature = input.signature?.trim().toLowerCase() ?? '';
  if (!signature) return { ok: false, reason: 'NO_SIGNATURE' };
  const timestamp = input.timestamp?.trim() ?? '';
  if (!timestamp) return { ok: false, reason: 'NO_TIMESTAMP' };
  const skew = input.maxSkewSeconds ?? DEFAULT_DIRECTORY_SYNC_SETTINGS.webhookMaxSkewSeconds;
  const now = input.now ?? new Date();
  const numeric = Number(timestamp);
  if (Number.isFinite(numeric)) {
    // Seconds or milliseconds since the epoch, judged by magnitude.
    const ms = numeric > 1e12 ? numeric : numeric * 1000;
    if (Math.abs(now.getTime() - ms) > skew * 1000) return { ok: false, reason: 'STALE_TIMESTAMP' };
  } else {
    const parsed = Date.parse(timestamp);
    if (Number.isNaN(parsed) || Math.abs(now.getTime() - parsed) > skew * 1000)
      return { ok: false, reason: 'STALE_TIMESTAMP' };
  }
  const expected = createHmac('sha256', key)
    .update(input.rawBody + timestamp)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return { ok: false, reason: 'BAD_SIGNATURE' };
  return { ok: true };
}

export interface WebhookEmployeeChange {
  sourceId: string;
  changedFields: string[];
  action: string | null;
}

/**
 * The employees a BambooHR employee-change event names. BambooHR posts a
 * JSON body whose `employees` array carries each changed employee's id and
 * the changed field names; only those two things are read - the payload's
 * field VALUES are never trusted, the current record is fetched afterwards
 * (directive section 11). Tolerant of the id being a number or a string, and
 * of the array living under `employees` or at the top level.
 */
export function parseBambooWebhookEmployees(body: unknown): WebhookEmployeeChange[] {
  const out: WebhookEmployeeChange[] = [];
  const seen = new Set<string>();
  const list: unknown[] = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as { employees?: unknown }).employees)
      ? ((body as { employees: unknown[] }).employees ?? [])
      : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const rawId = e['id'] ?? e['employeeId'];
    const sourceId =
      typeof rawId === 'string' ? rawId.trim() : typeof rawId === 'number' ? String(rawId) : '';
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    const fields = Array.isArray(e['changedFields'])
      ? (e['changedFields'] as unknown[])
          .filter((f): f is string => typeof f === 'string')
          .map((f) => f.slice(0, 80))
          .slice(0, 40)
      : [];
    const action = typeof e['action'] === 'string' ? e['action'].slice(0, 40) : null;
    out.push({ sourceId, changedFields: fields, action });
  }
  return out;
}

// --- change detection --------------------------------------------------------

/** The BambooHR-owned fields the mirror keeps, in one place. */
export const DIRECTORY_MIRRORED_FIELDS = [
  'displayName',
  'firstName',
  'middleName',
  'lastName',
  'preferredName',
  'workEmail',
  'workPhone',
  'workExtension',
  'jobTitle',
  'department',
  'division',
  'location',
  'employeeNumber',
  'employmentStatus',
  'hireDate',
  'managerName',
  'managerSourceId',
  'active',
] as const;
export type DirectoryMirroredField = (typeof DIRECTORY_MIRRORED_FIELDS)[number];

export type DirectoryFieldValues = Partial<
  Record<DirectoryMirroredField, string | boolean | Date | null | undefined>
>;

const norm = (v: string | boolean | Date | null | undefined): string | boolean | null => {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  return v;
};

/** Field NAMES that differ between the mirror and the source row; values never leave here. */
export function directoryFieldChanges(
  existing: DirectoryFieldValues,
  incoming: DirectoryFieldValues,
): DirectoryMirroredField[] {
  const changed: DirectoryMirroredField[] = [];
  for (const f of DIRECTORY_MIRRORED_FIELDS) {
    if (norm(existing[f]) !== norm(incoming[f])) changed.push(f);
  }
  return changed;
}

// --- presentation --------------------------------------------------------------

/** The status word shown for a directory record (directive section 20). */
export function directoryRecordStatus(r: {
  active: boolean;
  archivedAt?: Date | null;
  employmentStatus?: string | null;
}): 'Active' | 'Inactive' | 'Terminated' | 'Archived' {
  if (r.archivedAt) return 'Archived';
  if (r.active) return 'Active';
  const s = (r.employmentStatus ?? '').toLowerCase();
  if (s.includes('terminat')) return 'Terminated';
  return 'Inactive';
}

/** Overall result of a run from its counts. */
export function syncResultFromCounts(counts: {
  failed: number;
  checked: number;
}): 'SUCCESS' | 'PARTIAL' {
  return counts.failed > 0 ? 'PARTIAL' : 'SUCCESS';
}
