/**
 * Transactional outbox and email-provider rules (Directive 4 sections B-D).
 *
 * Deterministic and template-driven (fixed defaults 1/2): no generative
 * content anywhere. Provider acceptance is NEVER represented as delivery
 * (B.6); duplicate dispatch is impossible via DB-enforced idempotency (B.7).
 */
export const OUTBOX_STATUSES = [
  'PENDING',
  'CLAIMED',
  'SUBMITTED',
  'DELIVERED',
  'FAILED_RETRYABLE',
  'FAILED_PERMANENT',
  'CANCELLED',
  'DEAD_LETTER',
] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const EMAIL_PROVIDERS = ['dev-capture', 'graph'] as const;
export type EmailProviderMode = (typeof EMAIL_PROVIDERS)[number];

export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_BASE_DELAY_MS = 30_000;
export const OUTBOX_MAX_DELAY_MS = 30 * 60_000;

/**
 * Bounded exponential backoff with jitter (B.4). `random` is injectable so
 * tests are deterministic.
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const exp = Math.min(OUTBOX_MAX_DELAY_MS, OUTBOX_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  const jitter = 0.5 + random() * 0.5; // 50-100% of the computed delay
  return Math.round(exp * jitter);
}

/**
 * Normalized, PII-free provider error codes (C "normalize provider errors").
 * Codes are stable for logs and retry classification.
 */
export const RETRYABLE_ERROR_CODES = [
  'PROVIDER_THROTTLED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'NETWORK_ERROR',
] as const;
export const PERMANENT_ERROR_CODES = [
  'RECIPIENT_REJECTED',
  'RECIPIENT_INVALID',
  'MESSAGE_REJECTED',
  'AUTH_FAILED',
  'CONFIG_INVALID',
  'PROVIDER_NOT_CONFIGURED',
] as const;

export type ProviderErrorCode =
  (typeof RETRYABLE_ERROR_CODES)[number] | (typeof PERMANENT_ERROR_CODES)[number];

export function isRetryableError(code: string): boolean {
  return (RETRYABLE_ERROR_CODES as readonly string[]).includes(code);
}

/** Map raw provider/HTTP conditions to stable safe codes. */
export function normalizeProviderError(input: {
  httpStatus?: number;
  code?: string;
}): ProviderErrorCode {
  if (input.code && isRetryableError(input.code)) return input.code as ProviderErrorCode;
  if (input.code && (PERMANENT_ERROR_CODES as readonly string[]).includes(input.code))
    return input.code as ProviderErrorCode;
  const s = input.httpStatus ?? 0;
  if (s === 429) return 'PROVIDER_THROTTLED';
  if (s === 408 || s === 503 || s === 502 || s === 504) return 'PROVIDER_UNAVAILABLE';
  if (s === 401 || s === 403) return 'AUTH_FAILED';
  if (s === 400 || s === 404 || s === 422) return 'MESSAGE_REJECTED';
  if (s >= 500) return 'PROVIDER_UNAVAILABLE';
  return 'NETWORK_ERROR';
}

/** Typed provider failure carried through the outbox worker. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryAfterMs?: number;
  constructor(code: ProviderErrorCode, message?: string, retryAfterMs?: number) {
    super(message ?? code);
    this.name = 'ProviderError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

// --- recipient directory (section D) -----------------------------------------

export const RECIPIENT_CLASSES = [
  'IT_OFFBOARDING',
  'FINANCE_OFFBOARDING',
  'HR_OFFBOARDING',
  'LINE_MANAGER',
  'SAGICOR_GROUP_HEALTH',
  'NCB_GROUP_LIFE',
  'EMPLOYEE_PERSONAL',
  'OTHER_APPROVED_EXTERNAL',
  // Directive 6.3 N: independently configurable provider purposes.
  'PAYROLL_BANK',
  'PENSION_PROVIDER',
] as const;
export type RecipientClassName = (typeof RECIPIENT_CLASSES)[number];

export const EXTERNAL_RECIPIENT_CLASSES: readonly RecipientClassName[] = [
  'SAGICOR_GROUP_HEALTH',
  'NCB_GROUP_LIFE',
  'EMPLOYEE_PERSONAL',
  'OTHER_APPROVED_EXTERNAL',
  'PAYROLL_BANK',
  'PENSION_PROVIDER',
];

/** Directive 6.3 N/P: configurable provider purposes (TS-level, no DB enum). */
export const PROVIDER_PURPOSES = [
  'GROUP_HEALTH_REMOVAL',
  'GROUP_LIFE_REMOVAL',
  'PAYROLL_OR_BANK_NOTIFICATION',
  'PENSION_NOTIFICATION',
  'OTHER_APPROVED_PROVIDER',
] as const;
export type ProviderPurpose = (typeof PROVIDER_PURPOSES)[number];

const DEV_ONLY_DESTINATION = /@example\.invalid$|@localhost$|^capture:\/\//i;
const PLAUSIBLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** D.4/D.5: destination validation differs by environment. */
export function destinationErrors(destination: string, environment: string): string[] {
  const errors: string[] = [];
  const d = destination.trim();
  if (!d) return ['A destination is required.'];
  const devStyle = DEV_ONLY_DESTINATION.test(d);
  if (environment === 'production') {
    if (devStyle)
      errors.push(
        'Production recipients must not use example.invalid, localhost or capture destinations (D.5).',
      );
    if (!PLAUSIBLE_EMAIL.test(d)) errors.push('Production destination must be a valid address.');
  } else {
    // Development must use safe non-deliverable or capture destinations (D.4).
    if (!devStyle)
      errors.push(
        'Development recipients must use capture:// or @example.invalid destinations - never a deliverable address (D.4/D.6).',
      );
  }
  return errors;
}

/** Masked display: never show the full destination outside authorized admin. */
export function maskDestination(destination: string): string {
  const d = destination.trim();
  if (d.startsWith('capture://')) return d; // capture channels are not addresses
  const at = d.indexOf('@');
  if (at <= 0) return `${d.slice(0, 2)}***`;
  const local = d.slice(0, at);
  const domain = d.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain.slice(0, 1)}***${domain.slice(domain.lastIndexOf('.'))}`;
}

export interface RecipientUsability {
  active: boolean;
  approvalStatus: string;
  verifiedAt: Date | null;
  effectiveFrom: Date | null;
  environment: string;
  allowedTypes: readonly string[];
}

/** D.7: expired, inactive or unverified recipients never receive anything. */
export function recipientUsableErrors(
  r: RecipientUsability,
  notificationType: string,
  environment: string,
  now: Date,
): string[] {
  const errors: string[] = [];
  if (!r.active) errors.push('Recipient configuration is inactive.');
  if (r.approvalStatus !== 'APPROVED') errors.push('Recipient configuration is not approved.');
  if (!r.verifiedAt) errors.push('Recipient configuration is not verified.');
  if (r.effectiveFrom && r.effectiveFrom.getTime() > now.getTime())
    errors.push('Recipient configuration is not yet effective.');
  if (r.environment !== environment)
    errors.push(`Recipient configuration is for ${r.environment}, not ${environment}.`);
  if (!r.allowedTypes.includes(notificationType))
    errors.push('This notification type is not allowed for the recipient class.');
  return errors;
}

/** Graph production-readiness checklist entries (section C). */
export const GRAPH_READINESS_CHECKLIST = [
  { key: 'GRAPH_TENANT_ID', label: 'Azure tenant ID (company approval required)' },
  { key: 'GRAPH_CLIENT_ID', label: 'Registered application (client) ID' },
  {
    key: 'GRAPH_CLIENT_SECRET_REF',
    label: 'Credential/certificate REFERENCE (vault path, never the secret)',
  },
  { key: 'GRAPH_SENDER_MAILBOX', label: 'Approved sending mailbox' },
  { key: 'GRAPH_ALLOWED_DOMAINS', label: 'Allowed recipient domains' },
  { key: 'EXTERNAL_APPROVAL', label: 'External-recipient approval recorded by HR Manager' },
  { key: 'CALLBACK_CONFIG', label: 'Delivery/bounce callback configuration (where applicable)' },
] as const;
