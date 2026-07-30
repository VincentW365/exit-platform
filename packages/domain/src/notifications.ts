/**
 * Controlled notification rules (Directive 3 section K).
 *
 * Deterministic templates only - no generative wording (fixed default 2).
 * No live email is ever sent in this increment (fixed default 12); records
 * document preparation, approval and MANUAL sending only.
 */
export const NOTIFICATION_TYPES = [
  'IT_ACCESS_REMOVAL',
  'FINANCE_OFFBOARDING',
  'LINE_MANAGER_HANDOVER',
  'SAGICOR_GROUP_HEALTH_REMOVAL',
  'NCB_GROUP_LIFE_REMOVAL',
  'SURVEY_INVITATION_REFERENCE',
  'MANUAL_EXCEPTION_NOTIFICATION',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationRecipient = 'INTERNAL_DEPARTMENT' | 'EXTERNAL_PROVIDER' | 'EMPLOYEE';

export const NOTIFICATION_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'READY_FOR_MANUAL_SEND',
  'MANUALLY_SENT',
  'CANCELLED',
  'FAILED',
  'SUPERSEDED',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Recipient class per type (K.16: never more data than the recipient needs). */
export const NOTIFICATION_RECIPIENT_CLASS: Readonly<
  Record<NotificationType, NotificationRecipient>
> = {
  IT_ACCESS_REMOVAL: 'INTERNAL_DEPARTMENT',
  FINANCE_OFFBOARDING: 'INTERNAL_DEPARTMENT',
  LINE_MANAGER_HANDOVER: 'INTERNAL_DEPARTMENT',
  SAGICOR_GROUP_HEALTH_REMOVAL: 'EXTERNAL_PROVIDER',
  NCB_GROUP_LIFE_REMOVAL: 'EXTERNAL_PROVIDER',
  SURVEY_INVITATION_REFERENCE: 'EMPLOYEE',
  MANUAL_EXCEPTION_NOTIFICATION: 'EMPLOYEE',
};

/**
 * Allow-listed placeholders per notification type - the minimum-data
 * declaration in executable form. Anything else is rejected at template
 * validation time (reuses the document placeholder syntax).
 */
export const NOTIFICATION_PLACEHOLDERS: Readonly<Record<NotificationType, readonly string[]>> = {
  IT_ACCESS_REMOVAL: [
    'EMPLOYEE_LEGAL_NAME',
    'CASE_REFERENCE',
    'EFFECTIVE_SEPARATION_DATE',
    'EFFECTIVE_SEPARATION_TIME',
    'ACCESS_SYSTEMS_SUMMARY',
  ],
  FINANCE_OFFBOARDING: [
    'EMPLOYEE_LEGAL_NAME',
    'CASE_REFERENCE',
    'DEPARTMENT',
    'CONFIRMED_LAST_WORKING_DATE',
    'EFFECTIVE_SEPARATION_DATE',
  ],
  LINE_MANAGER_HANDOVER: [
    'EMPLOYEE_LEGAL_NAME',
    'CASE_REFERENCE',
    'CONFIRMED_LAST_WORKING_DATE',
    'HANDOVER_DUE_DATE',
  ],
  SAGICOR_GROUP_HEALTH_REMOVAL: [
    'EMPLOYEE_LEGAL_NAME',
    'EMPLOYEE_REFERENCE',
    'EFFECTIVE_SEPARATION_DATE',
  ],
  NCB_GROUP_LIFE_REMOVAL: [
    'EMPLOYEE_LEGAL_NAME',
    'EMPLOYEE_REFERENCE',
    'EFFECTIVE_SEPARATION_DATE',
  ],
  SURVEY_INVITATION_REFERENCE: ['EMPLOYEE_LEGAL_NAME', 'CASE_REFERENCE', 'SURVEY_EXPIRY_NOTE'],
  MANUAL_EXCEPTION_NOTIFICATION: ['EMPLOYEE_LEGAL_NAME', 'CASE_REFERENCE', 'MANUAL_NOTE'],
};

/** Types that require confirmed applicability before a record exists (K.9/K.10). */
export const APPLICABILITY_GATED_TYPES: readonly NotificationType[] = [
  'SAGICOR_GROUP_HEALTH_REMOVAL',
  'NCB_GROUP_LIFE_REMOVAL',
];

/** K.2 vs K.3: which recipient classes need HR_MANAGER approval. */
export function requiresManagerApproval(recipientClass: NotificationRecipient): boolean {
  return recipientClass === 'EXTERNAL_PROVIDER' || recipientClass === 'EMPLOYEE';
}

interface NotifTransition {
  from: readonly NotificationStatus[];
  to: NotificationStatus;
  reasonRequired: boolean;
}

export const NOTIFICATION_TRANSITIONS = {
  submit: { from: ['DRAFT'], to: 'PENDING_APPROVAL', reasonRequired: false },
  approve: { from: ['PENDING_APPROVAL'], to: 'APPROVED', reasonRequired: false },
  return: { from: ['PENDING_APPROVAL'], to: 'DRAFT', reasonRequired: true },
  markReady: { from: ['APPROVED'], to: 'READY_FOR_MANUAL_SEND', reasonRequired: false },
  recordManualSend: { from: ['READY_FOR_MANUAL_SEND'], to: 'MANUALLY_SENT', reasonRequired: false },
  cancel: {
    from: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'READY_FOR_MANUAL_SEND'],
    to: 'CANCELLED',
    reasonRequired: true,
  },
  fail: { from: ['READY_FOR_MANUAL_SEND'], to: 'FAILED', reasonRequired: true },
  supersede: {
    from: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'READY_FOR_MANUAL_SEND'],
    to: 'SUPERSEDED',
    reasonRequired: true,
  },
} as const satisfies Record<string, NotifTransition>;

export type NotificationAction = keyof typeof NOTIFICATION_TRANSITIONS;

export function notificationTransitionError(
  action: NotificationAction,
  status: NotificationStatus,
  reason?: string,
): string | null {
  const t = NOTIFICATION_TRANSITIONS[action] as NotifTransition;
  if (!t.from.includes(status)) return `Action "${action}" is not allowed from status ${status}.`;
  if (t.reasonRequired && !reason?.trim()) return `Action "${action}" requires a reason.`;
  return null;
}

/**
 * K.11 idempotency key: case + type + recipient class + workflow version +
 * effective event instant.
 */
export function notificationIdempotencyKey(args: {
  caseId: string;
  notificationType: NotificationType;
  recipientClass: NotificationRecipient;
  workflowVersion: number;
  effectiveEventAt: Date | null;
}): string {
  return [
    args.caseId,
    args.notificationType,
    args.recipientClass,
    `wf${args.workflowVersion}`,
    args.effectiveEventAt ? args.effectiveEventAt.toISOString() : 'none',
  ].join(':');
}

/** Approved manual-send methods (recorded, never performed by the system). */
export const MANUAL_SEND_METHODS = [
  'PRINTED_LETTER',
  'PHONE_CALL',
  'IN_PERSON',
  'EXTERNAL_PORTAL',
  'OTHER_APPROVED',
] as const;
export type ManualSendMethod = (typeof MANUAL_SEND_METHODS)[number];
