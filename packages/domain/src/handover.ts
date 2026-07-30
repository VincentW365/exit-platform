/**
 * Knowledge-transfer and handover rules (Directive 3 section M) plus the
 * credential-detection guard shared by task comment fields (D.15/D.16).
 *
 * The application must never store passwords, private keys, API tokens, PINs,
 * access codes or recovery codes - likely credentials are rejected with a
 * clear message, not silently accepted.
 */
export const HANDOVER_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETED',
  'NOT_APPLICABLE',
  'WAIVED',
] as const;
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];

/** Statuses that satisfy the clearance gate where handover is required (M.9). */
export const HANDOVER_SATISFIED_STATUSES: readonly HandoverStatus[] = [
  'COMPLETED',
  'NOT_APPLICABLE',
  'WAIVED',
];

export const HANDOVER_SECTIONS = [
  { key: 'dutiesToReassign', label: 'Duties requiring reassignment' },
  { key: 'openWorkDeadlines', label: 'Open work and deadlines' },
  { key: 'customerVendorMatters', label: 'Customer / vendor matters' },
  { key: 'keyDocumentLocations', label: 'Key document locations' },
  { key: 'physicalFileLocations', label: 'Physical file locations' },
  { key: 'replacementOwner', label: 'Replacement or temporary owner' },
  { key: 'handoverSessions', label: 'Scheduled handover sessions' },
  { key: 'trainingCompleted', label: 'Training completed' },
  { key: 'unresolvedRisks', label: 'Unresolved risks' },
  { key: 'managerNotes', label: 'Manager notes' },
] as const;
export type HandoverSectionKey = (typeof HANDOVER_SECTIONS)[number]['key'];

export const CREDENTIAL_WARNING =
  'Do not enter passwords, access codes, private keys or authentication credentials.';

interface CredentialPattern {
  re: RegExp;
  label: string;
}

// Deliberately targeted patterns: catch likely credentials without rejecting
// ordinary operational prose ("the password policy document" is fine;
// "password: hunter2" is not).
const CREDENTIAL_PATTERNS: readonly CredentialPattern[] = [
  { re: /\bpass(word|wd|phrase)?\s*(is|[:=])\s*\S+/i, label: 'a password' },
  { re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, label: 'a private key' },
  { re: /\bapi[_ -]?key\b\s*(is|[:=])\s*\S+/i, label: 'an API key' },
  {
    re: /\b(auth(entication)?|access|bearer|session)[_ -]?token\s*(is|[:=])\s*\S+/i,
    label: 'an authentication token',
  },
  { re: /\bpin\b\s*(is|[:=])\s*\S+/i, label: 'a PIN' },
  { re: /\b(access|door|alarm|security)[_ -]?code\s*(is|[:=])\s*\S+/i, label: 'an access code' },
  { re: /\brecovery[_ -]?(code|key)s?\b\s*(are|is|[:=])?\s*\S*/i, label: 'recovery codes' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'an AWS access key ID' },
  { re: /\bghp_[A-Za-z0-9]{30,}\b/, label: 'a GitHub token' },
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/, label: 'a secret API key' },
  { re: /\bsecret\s*(is|[:=])\s*\S+/i, label: 'a secret value' },
];

/**
 * Returns a human-readable finding per likely credential in the text.
 * Empty array = safe.
 */
export function credentialFindings(text: string | null | undefined): string[] {
  if (!text) return [];
  const findings: string[] = [];
  for (const p of CREDENTIAL_PATTERNS) {
    if (p.re.test(text)) findings.push(`The text appears to contain ${p.label}.`);
  }
  return findings;
}

/** Validation helper for a set of named free-text fields. */
export function credentialFieldErrors(
  fields: Readonly<Record<string, string | null | undefined>>,
): string[] {
  const errors: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    for (const finding of credentialFindings(value)) {
      errors.push(`${name}: ${finding} ${CREDENTIAL_WARNING}`);
    }
  }
  return errors;
}

/** M: manager completion requires substantive content or an explicit basis. */
export function handoverCompletionErrors(record: {
  dutiesToReassign: string | null;
  openWorkDeadlines: string | null;
  replacementOwner: string | null;
}): string[] {
  const errors: string[] = [];
  if (!record.dutiesToReassign?.trim())
    errors.push('Duties requiring reassignment must be recorded (or mark not applicable).');
  if (!record.replacementOwner?.trim())
    errors.push('A replacement or temporary owner must be recorded (or mark not applicable).');
  return errors;
}

export type HandoverAction = 'complete' | 'notApplicable' | 'waive' | 'reopen';

const HANDOVER_TRANSITIONS: Record<HandoverAction, readonly HandoverStatus[]> = {
  complete: ['NOT_STARTED', 'IN_PROGRESS'],
  notApplicable: ['NOT_STARTED', 'IN_PROGRESS'],
  waive: ['NOT_STARTED', 'IN_PROGRESS'],
  reopen: ['COMPLETED', 'NOT_APPLICABLE', 'WAIVED'],
};

export function handoverTransitionError(
  action: HandoverAction,
  status: HandoverStatus,
  reason?: string,
): string | null {
  if (!HANDOVER_TRANSITIONS[action].includes(status))
    return `Handover action "${action}" is not allowed from status ${status}.`;
  if ((action === 'waive' || action === 'notApplicable' || action === 'reopen') && !reason?.trim())
    return `Handover action "${action}" requires a reason (M.6).`;
  return null;
}
