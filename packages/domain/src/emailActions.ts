/**
 * Email-first department action rules (Directive 6.3 K/R/S/T/U).
 *
 * Departments and external providers are reached by controlled, versioned
 * email - not application logins. This module owns the pure rules: send
 * control levels, automated-send eligibility, acknowledgement-token rules and
 * the business-facing state projection. Everything is deterministic; no
 * generative AI participates in any decision.
 */
import { DateTime } from 'luxon';
import { APP_ZONE } from './calendar.ts';
import {
  generateSurveyToken,
  hashSurveyToken,
  isPlausibleToken,
  tokenMatchesHash,
} from './survey.ts';
import type { NotificationStatus, NotificationType } from './notifications.ts';

// --- send control levels (Directive 6.3 R/S) ---------------------------------

export const SEND_CONTROL_LEVELS = [
  'AUTO_SEND',
  'HR_REVIEW_THEN_SEND',
  'HR_MANAGER_APPROVAL_REQUIRED',
] as const;
export type SendControlLevel = (typeof SEND_CONTROL_LEVELS)[number];

/**
 * Directive S defaults: internal departments AUTO_SEND; external providers
 * HR_REVIEW_THEN_SEND until operations establish confidence. Stored in system
 * configuration (`notifications.sendControl`); these are the seeded/fallback
 * values, never a hard-coded ceiling.
 */
export const DEFAULT_SEND_CONTROL: Readonly<Record<NotificationType, SendControlLevel>> = {
  IT_ACCESS_REMOVAL: 'AUTO_SEND',
  FINANCE_OFFBOARDING: 'AUTO_SEND',
  LINE_MANAGER_HANDOVER: 'AUTO_SEND',
  RETURN_ITEMS_CHECKLIST: 'AUTO_SEND',
  RESIGNATION_ACCEPTANCE_LETTER: 'HR_REVIEW_THEN_SEND',
  SAGICOR_GROUP_HEALTH_REMOVAL: 'HR_REVIEW_THEN_SEND',
  NCB_GROUP_LIFE_REMOVAL: 'HR_REVIEW_THEN_SEND',
  SURVEY_INVITATION_REFERENCE: 'HR_REVIEW_THEN_SEND',
  MANUAL_EXCEPTION_NOTIFICATION: 'HR_MANAGER_APPROVAL_REQUIRED',
  PAYROLL_OR_BANK_NOTIFICATION: 'HR_REVIEW_THEN_SEND',
  OTHER_EXTERNAL_OFFBOARDING_NOTIFICATION: 'HR_REVIEW_THEN_SEND',
};

export function isSendControlLevel(v: unknown): v is SendControlLevel {
  return typeof v === 'string' && (SEND_CONTROL_LEVELS as readonly string[]).includes(v);
}

/**
 * Resolve the control level for one notification on one case.
 * Restricted (termination) cases are never sent below
 * HR_MANAGER_APPROVAL_REQUIRED when the configured restricted override says so
 * (Directive S: "Restricted termination: use explicit confidentiality/timing
 * controls").
 */
export function resolveSendControl(args: {
  notificationType: NotificationType;
  configured: Partial<Record<string, string>> | null;
  caseClassification: 'CONFIDENTIAL' | 'RESTRICTED';
  restrictedOverride?: string | null;
}): SendControlLevel {
  const configuredLevel = args.configured?.[args.notificationType];
  const base = isSendControlLevel(configuredLevel)
    ? configuredLevel
    : DEFAULT_SEND_CONTROL[args.notificationType];
  if (args.caseClassification === 'RESTRICTED') {
    const override = args.restrictedOverride ?? 'HR_MANAGER_APPROVAL_REQUIRED';
    if (isSendControlLevel(override)) {
      // The stricter of the two applies; ordering below is weakest-first.
      const rank: Record<SendControlLevel, number> = {
        AUTO_SEND: 0,
        HR_REVIEW_THEN_SEND: 1,
        HR_MANAGER_APPROVAL_REQUIRED: 2,
      };
      return rank[override] > rank[base] ? override : base;
    }
  }
  return base;
}

/**
 * Directive R: automatic sending happens only when EVERY condition is
 * satisfied. Returns the list of blockers (empty = eligible). The caller
 * layers the record-purpose / cohort / feature-flag safety gates on top
 * (Directive AG - those live with the data, not here).
 */
export function autoSendBlockers(args: {
  controlLevel: SendControlLevel;
  recipientResolved: boolean;
  recipientApprovedAndVerified: boolean;
  templateActive: boolean;
  bodyComplete: boolean;
  applicabilityConfirmed: boolean;
}): string[] {
  const blockers: string[] = [];
  if (args.controlLevel !== 'AUTO_SEND') blockers.push(`Control level is ${args.controlLevel}.`);
  if (!args.recipientResolved) blockers.push('No recipient is configured.');
  else if (!args.recipientApprovedAndVerified)
    blockers.push('The recipient is not approved and verified.');
  if (!args.templateActive) blockers.push('No ACTIVE template exists for this notification.');
  if (!args.bodyComplete) blockers.push('The rendered content still has missing fields.');
  if (!args.applicabilityConfirmed) blockers.push('Applicability is not confirmed.');
  return blockers;
}

// --- scheduled send timing (Directive 6.3 U/L) -------------------------------

/**
 * When the IT access-removal email goes out, by departure type (U.2):
 * - resignation with notice: immediately at activation (advance notice with
 *   the exact effective time);
 * - immediate resignation: immediately (urgent);
 * - termination: close to the effective instant (confidential timing) - one
 *   hour before, never earlier.
 */
export function itEmailScheduledAt(args: {
  departureType: string;
  effectiveSeparationAt: Date;
  now: Date;
}): Date {
  if (args.departureType === 'TERMINATION') {
    const oneHourBefore = new Date(args.effectiveSeparationAt.getTime() - 60 * 60_000);
    return oneHourBefore.getTime() > args.now.getTime() ? oneHourBefore : args.now;
  }
  return args.now;
}

// --- acknowledgement tokens (Directive 6.3 T) --------------------------------

export const TOKEN_PURPOSES = [
  'ACKNOWLEDGE_RECEIPT',
  'CONFIRM_COMPLETION',
  'COMPLETE_RETURN_CHECKLIST',
] as const;
export type ActionTokenPurpose = (typeof TOKEN_PURPOSES)[number];

/** Same CSPRNG/hash discipline as the survey tokens (in-repo precedent). */
export const generateActionToken = generateSurveyToken;
export const hashActionToken = hashSurveyToken;
export const actionTokenMatchesHash = tokenMatchesHash;
export const isPlausibleActionToken = isPlausibleToken;

/**
 * Token lifetime: IT access-removal confirmations are time-critical (72h);
 * everything else defaults to 14 days.
 */
export function actionTokenExpiry(args: {
  notificationType: NotificationType;
  issuedAt: Date;
}): Date {
  const hours = args.notificationType === 'IT_ACCESS_REMOVAL' ? 72 : 14 * 24;
  return new Date(args.issuedAt.getTime() + hours * 60 * 60_000);
}

/**
 * Which token purposes an email action may carry (T: "It may allow only
 * ACKNOWLEDGE RECEIPT and, where approved, CONFIRM ACTION COMPLETED").
 * Completion confirmation is approved for the internal department actions;
 * external providers get acknowledgement only.
 */
export function allowedTokenPurposes(type: NotificationType): readonly ActionTokenPurpose[] {
  switch (type) {
    case 'IT_ACCESS_REMOVAL':
    case 'FINANCE_OFFBOARDING':
      return ['ACKNOWLEDGE_RECEIPT', 'CONFIRM_COMPLETION'];
    // The checklist link opens a form; it carries no acknowledgement.
    case 'RETURN_ITEMS_CHECKLIST':
      return ['COMPLETE_RETURN_CHECKLIST'];
    // The letter carries itself. Asking a departing employee to click a link
    // to acknowledge their own acceptance letter would be theatre.
    case 'RESIGNATION_ACCEPTANCE_LETTER':
      return [];
    case 'SAGICOR_GROUP_HEALTH_REMOVAL':
    case 'NCB_GROUP_LIFE_REMOVAL':
    case 'PAYROLL_OR_BANK_NOTIFICATION':
    case 'OTHER_EXTERNAL_OFFBOARDING_NOTIFICATION':
      return ['ACKNOWLEDGE_RECEIPT'];
    default:
      return [];
  }
}

/** HR-recorded (no-login alternative) evidence channels (T). */
export const EVIDENCE_CHANNELS = ['EMAIL', 'PHONE', 'OTHER'] as const;
export type EvidenceChannel = (typeof EVIDENCE_CHANNELS)[number];

// --- recipient entry validation (Directive 6.3 O) ----------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function recipientEmailErrors(args: {
  email: string;
  name: string;
  organization: string;
}): string[] {
  const errors: string[] = [];
  if (!EMAIL_RE.test(args.email.trim())) errors.push('Enter a valid email address.');
  if (args.email.length > 254) errors.push('The email address is too long.');
  if (!args.name.trim()) errors.push('The recipient name is required.');
  if (args.name.length > 200) errors.push('The recipient name is too long.');
  if (!args.organization.trim()) errors.push('The organization is required.');
  if (args.organization.length > 200) errors.push('The organization name is too long.');
  return errors;
}

// --- business-facing action state (Directive 6.3 U + correction 7) -----------

/**
 * The single display state for one email action. Derived - never stored -
 * from the notification record, its schedule and its exception state.
 */
export type EmailActionDisplayState =
  | 'NOT_APPLICABLE'
  | 'RECIPIENT_REQUIRED'
  | 'NEEDS_REVIEW'
  | 'SCHEDULED'
  | 'SENT'
  | 'ACKNOWLEDGED'
  | 'COMPLETED'
  | 'FAILED'
  | 'OVERDUE'
  | 'CANCELLED';

export function emailActionDisplayState(args: {
  applicable: boolean;
  status: NotificationStatus | null;
  recipientResolved: boolean;
  scheduledSendAt: Date | null;
  ackDeadlineAt: Date | null;
  requiresCompletionEvidence: boolean;
  now: Date;
}): EmailActionDisplayState {
  if (!args.applicable) return 'NOT_APPLICABLE';
  if (args.status === null) return args.recipientResolved ? 'NEEDS_REVIEW' : 'RECIPIENT_REQUIRED';
  switch (args.status) {
    case 'CANCELLED':
    case 'SUPERSEDED':
      return 'CANCELLED';
    case 'FAILED':
      return 'FAILED';
    case 'CONFIRMED_COMPLETE':
      return 'COMPLETED';
    case 'ACKNOWLEDGED':
      return args.requiresCompletionEvidence &&
        args.ackDeadlineAt !== null &&
        args.now.getTime() > args.ackDeadlineAt.getTime()
        ? 'OVERDUE'
        : 'ACKNOWLEDGED';
    case 'SENT':
    case 'MANUALLY_SENT':
      return args.ackDeadlineAt !== null && args.now.getTime() > args.ackDeadlineAt.getTime()
        ? 'OVERDUE'
        : 'SENT';
    case 'APPROVED':
      return args.recipientResolved ? 'SCHEDULED' : 'RECIPIENT_REQUIRED';
    case 'DRAFT':
    case 'PENDING_APPROVAL':
    case 'READY_FOR_MANUAL_SEND':
      return args.recipientResolved ? 'NEEDS_REVIEW' : 'RECIPIENT_REQUIRED';
  }
}

export const EMAIL_ACTION_STATE_LABELS: Readonly<Record<EmailActionDisplayState, string>> = {
  NOT_APPLICABLE: 'Not applicable',
  RECIPIENT_REQUIRED: 'Recipient required',
  NEEDS_REVIEW: 'Needs your review',
  SCHEDULED: 'Scheduled',
  SENT: 'Sent',
  ACKNOWLEDGED: 'Acknowledged',
  COMPLETED: 'Completed',
  FAILED: 'Could not send',
  OVERDUE: 'Awaiting confirmation - overdue',
  CANCELLED: 'Cancelled',
};

/** Format a scheduled instant for HR display in the app timezone. */
export function formatScheduledFor(at: Date): string {
  return DateTime.fromJSDate(at, { zone: APP_ZONE }).toFormat('d LLL yyyy, h:mm a');
}
