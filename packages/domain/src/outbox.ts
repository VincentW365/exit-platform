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
  // Email routing directive: the remaining departmental destinations, so no
  // workflow has to name a mailbox.
  'HR_OFFICERS',
  'PAYROLL',
  'SECURITY',
  'ASSET_WAREHOUSE',
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

// RFC 2606 reserves .invalid and .test, and RFC 6761 reserves localhost:
// none of them can resolve, so none of them can deliver. The synthetic
// directory standardizes on example.test, so it belongs in this set.
const DEV_ONLY_DESTINATION = /@example\.invalid$|@[^\s@]*\.test$|@localhost$|^capture:\/\//i;
const PLAUSIBLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * D.4/D.5: destination validation differs by environment.
 *
 *  - development: nothing deliverable, ever. A local mistake must not be able
 *    to reach a person even if every other guard failed.
 *  - test/UAT: the REAL organizational addresses are configured and resolved,
 *    because the point of UAT is to prove routing. They are never delivered
 *    to - every message is redirected to the test mailbox - so a real address
 *    here is correct rather than dangerous.
 *  - production: must be a real, deliverable address.
 */
export function destinationErrors(destination: string, environment: string): string[] {
  const errors: string[] = [];
  const d = destination.trim();
  if (!d) return ['A destination is required.'];
  const devStyle = DEV_ONLY_DESTINATION.test(d);
  if (environment === 'production') {
    if (devStyle)
      errors.push(
        'Production recipients must not use reserved test domains, localhost or capture destinations (D.5).',
      );
    if (!PLAUSIBLE_EMAIL.test(d)) errors.push('Production destination must be a valid address.');
  } else if (environment === 'test') {
    if (!PLAUSIBLE_EMAIL.test(d) && !d.startsWith('capture://'))
      errors.push('A test/UAT destination must be a valid address or a capture:// channel.');
  } else {
    // Development must use safe non-deliverable or capture destinations (D.4).
    if (!devStyle)
      errors.push(
        'Development recipients must use capture://, a reserved .test/.invalid domain or localhost - never a deliverable address (D.4/D.6).',
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

// --- test mode ---------------------------------------------------------------

/**
 * Rehearsal mode (HR samples directive section 8).
 *
 * HR must be able to walk the real workflow - real templates, real rules, real
 * timing - without a single message reaching a real person. When test mode is
 * on, every outgoing message goes to ONE nominated mailbox instead of its
 * recipients, carries an unmissable marker, and states in its own body who it
 * WOULD have gone to (masked). Nothing else about the flow changes: the same
 * records, the same outbox, the same evidence.
 */
export interface TestModeConfig {
  enabled: boolean;
  /** The single mailbox every message is redirected to while this is on. */
  redirectTo: string;
  /** Optional line explaining the rehearsal, shown in the redirected body. */
  note?: string;
}

export const TEST_MODE_SUBJECT_PREFIX = '[TEST MODE] ';

/** Read a stored configuration value defensively; anything odd means "off". */
export function parseTestMode(value: unknown): TestModeConfig {
  if (!value || typeof value !== 'object') return { enabled: false, redirectTo: '' };
  const v = value as Record<string, unknown>;
  return {
    enabled: v.enabled === true,
    redirectTo: typeof v.redirectTo === 'string' ? v.redirectTo.trim() : '',
    note: typeof v.note === 'string' && v.note.trim() ? v.note.trim() : undefined,
  };
}

/** Validation for turning test mode on. Turning it OFF is always allowed. */
export function testModeErrors(cfg: TestModeConfig, environment: string): string[] {
  if (!cfg.enabled) return [];
  const errors: string[] = [];
  if (!cfg.redirectTo) errors.push('A redirect mailbox is required to turn test mode on.');
  else errors.push(...destinationErrors(cfg.redirectTo, environment));
  if (cfg.note && cfg.note.length > 200) errors.push('The note is limited to 200 characters.');
  return errors;
}

export interface RedirectableMessage {
  subject: string;
  body: string;
  destination: string;
  cc?: readonly string[];
  bcc?: readonly string[];
}

export interface RedirectOutcome extends RedirectableMessage {
  /** True when the message was diverted; false leaves everything untouched. */
  redirected: boolean;
  /** Who it would have reached, in full, for the tester to verify routing. */
  intendedTo: string;
  intendedCc: readonly string[];
  intendedBcc: readonly string[];
  /** The same recipients masked, for the audit trail and the email log. */
  intendedMasks: readonly string[];
}

function recipientLine(label: string, values: readonly string[]): string | null {
  return values.length ? `  ${label}: ${values.join(', ')}` : null;
}

/**
 * Divert a message to the test mailbox.
 *
 * The intended To/CC/BCC are calculated normally and then written into the
 * redirected copy IN FULL. That is deliberate: the whole point of testing is
 * for the tester to confirm that routing is correct, and a masked address
 * cannot be checked against a routing table. The audit trail and the email
 * log still keep masks - only the message delivered to the nominated test
 * mailbox, read by the person running the test, carries the real addresses.
 */
export function applyTestModeRedirect(
  message: RedirectableMessage,
  cfg: TestModeConfig,
): RedirectOutcome {
  const to = message.destination.trim();
  const cc = (message.cc ?? []).map((a) => a.trim()).filter(Boolean);
  const bcc = (message.bcc ?? []).map((a) => a.trim()).filter(Boolean);
  const intendedMasks = [to, ...cc, ...bcc].filter(Boolean).map(maskDestination);

  if (!cfg.enabled || !cfg.redirectTo) {
    return {
      ...message,
      redirected: false,
      intendedTo: to,
      intendedCc: cc,
      intendedBcc: bcc,
      intendedMasks,
    };
  }

  const header = [
    'TEST MODE - THIS MESSAGE WAS INTERCEPTED AND NOT DELIVERED TO ITS RECIPIENTS.',
    '',
    'Intended recipients (calculated by the normal routing rules):',
    recipientLine('To', to ? [to] : []),
    recipientLine('Cc', cc),
    recipientLine('Bcc', bcc),
    cfg.note ? `\nNote: ${cfg.note}` : null,
    '',
    '---',
    '',
  ]
    .filter((l) => l !== null)
    .join('\n');

  return {
    subject: message.subject.startsWith(TEST_MODE_SUBJECT_PREFIX)
      ? message.subject
      : `${TEST_MODE_SUBJECT_PREFIX}${message.subject}`,
    body: `${header}${message.body}`,
    destination: cfg.redirectTo,
    cc: [],
    bcc: [],
    redirected: true,
    intendedTo: to,
    intendedCc: cc,
    intendedBcc: bcc,
    intendedMasks,
  };
}

// --- centralized routing (email routing directive) ---------------------------

/**
 * Where a notification can be addressed. Two kinds:
 *
 *  - STATIC destinations resolve to a configured mailbox in the recipient
 *    directory (payroll@, itsupport@, ...). Changing who receives IT
 *    notifications is then a configuration change, not a code change.
 *  - DYNAMIC destinations resolve per case from the case itself (this
 *    employee's manager, the assigned HR officer). They cannot be a fixed
 *    mailbox because the answer differs for every employee.
 *
 * No workflow, template or component names a mailbox: they name a
 * destination, and the routing table says what that destination means.
 */
export const STATIC_DESTINATIONS = [
  'HR',
  'HR_OFFICERS',
  'PAYROLL',
  'FINANCE',
  'IT',
  'SECURITY',
  'ASSET_WAREHOUSE',
  'GROUP_HEALTH_PROVIDER',
  'GROUP_LIFE_PROVIDER',
  'PAYROLL_BANK',
  'PENSION_PROVIDER',
  'OTHER_APPROVED_EXTERNAL',
] as const;
export type StaticDestination = (typeof STATIC_DESTINATIONS)[number];

export const DYNAMIC_DESTINATIONS = [
  'EMPLOYEE_MANAGER',
  'ASSIGNED_HR_OFFICER',
  'CASE_OWNER',
  'EMPLOYEE',
] as const;
export type DynamicDestination = (typeof DYNAMIC_DESTINATIONS)[number];

export type DestinationKey = `static:${StaticDestination}` | `dynamic:${DynamicDestination}`;

export const DESTINATION_LABELS: Record<StaticDestination | DynamicDestination, string> = {
  HR: 'Human Resources (shared mailbox)',
  HR_OFFICERS: 'HR Officers (shared mailbox)',
  PAYROLL: 'Payroll',
  FINANCE: 'Finance',
  IT: 'IT',
  SECURITY: 'Security',
  ASSET_WAREHOUSE: 'Asset / Warehouse',
  GROUP_HEALTH_PROVIDER: 'Group health provider',
  GROUP_LIFE_PROVIDER: 'Group life provider',
  PAYROLL_BANK: 'Payroll bank',
  PENSION_PROVIDER: 'Pension provider',
  OTHER_APPROVED_EXTERNAL: 'Other approved external party',
  EMPLOYEE_MANAGER: "This employee's manager (from the directory)",
  ASSIGNED_HR_OFFICER: 'The assigned HR Officer on this case',
  CASE_OWNER: 'The case owner',
  EMPLOYEE: 'The departing employee',
};

/** Which recipient-directory class a static destination reads from. */
export const STATIC_DESTINATION_CLASS: Record<StaticDestination, RecipientClassName> = {
  HR: 'HR_OFFBOARDING',
  HR_OFFICERS: 'HR_OFFICERS',
  PAYROLL: 'PAYROLL',
  FINANCE: 'FINANCE_OFFBOARDING',
  IT: 'IT_OFFBOARDING',
  SECURITY: 'SECURITY',
  ASSET_WAREHOUSE: 'ASSET_WAREHOUSE',
  GROUP_HEALTH_PROVIDER: 'SAGICOR_GROUP_HEALTH',
  GROUP_LIFE_PROVIDER: 'NCB_GROUP_LIFE',
  PAYROLL_BANK: 'PAYROLL_BANK',
  PENSION_PROVIDER: 'PENSION_PROVIDER',
  OTHER_APPROVED_EXTERNAL: 'OTHER_APPROVED_EXTERNAL',
};

export function isDestinationKey(value: string): value is DestinationKey {
  const [kind, name] = value.split(':');
  if (kind === 'static') return (STATIC_DESTINATIONS as readonly string[]).includes(name ?? '');
  if (kind === 'dynamic') return (DYNAMIC_DESTINATIONS as readonly string[]).includes(name ?? '');
  return false;
}

export function destinationLabel(key: string): string {
  const [, name] = key.split(':');
  return DESTINATION_LABELS[name as StaticDestination] ?? key;
}

/** One notification type's addressing. */
export interface NotificationRoute {
  notificationType: string;
  to: DestinationKey;
  cc: readonly DestinationKey[];
  bcc: readonly DestinationKey[];
}

/** Validation for an administrator editing a route. */
export function routeErrors(input: {
  to: string;
  cc: readonly string[];
  bcc: readonly string[];
}): string[] {
  const errors: string[] = [];
  if (!input.to) errors.push('A primary recipient (To) is required.');
  else if (!isDestinationKey(input.to)) errors.push(`Unknown destination "${input.to}".`);
  for (const [label, list] of [
    ['Cc', input.cc],
    ['Bcc', input.bcc],
  ] as const) {
    for (const key of list) {
      if (!isDestinationKey(key)) errors.push(`Unknown ${label} destination "${key}".`);
    }
  }
  // The same destination twice is a configuration mistake, not a policy: a
  // person copied on their own message reads as a system fault.
  const all = [input.to, ...input.cc, ...input.bcc];
  const seen = new Set<string>();
  for (const key of all) {
    if (seen.has(key))
      errors.push(`${destinationLabel(key)} appears more than once on this route.`);
    seen.add(key);
  }
  return errors;
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
