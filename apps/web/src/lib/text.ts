/**
 * Display text helpers (owner request, 2026-08-18).
 *
 * Enum-shaped values (RESIGNATION_WITH_NOTICE, PENDING_HR_REVIEW, ...) were
 * reaching the screen two equally unprofessional ways: raw with the
 * underscores swapped for spaces ("PENDING HR REVIEW" - shouting), or run
 * through `.toLowerCase()` ("resignation with notice" - no capital letter at
 * all). `humanize` gives one sentence-case rendering, and keeps the acronyms
 * this business actually uses in capitals so "IT access removal" does not
 * become "It access removal".
 */
/**
 * Words that carry their own capitalization. Product and system names sit
 * beside the plain acronyms so BAMBOOHR reads "BambooHR" rather than the
 * almost-right "Bamboohr".
 */
const EXACT_CASE: Record<string, string> = {
  BAMBOOHR: 'BambooHR',
  HRIS: 'HRIS',
  SSO: 'SSO',
};

const ACRONYMS = new Set([
  'HR',
  'IT',
  'PDF',
  'CSV',
  'SLA',
  'UAT',
  'API',
  'PII',
  'NIS',
  'TRN',
  'CEO',
  'ID',
]);

export function humanize(value: string | null | undefined): string {
  if (!value) return '';
  const words = value.replaceAll('_', ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  return words
    .map((word, i) => {
      const upper = word.toUpperCase();
      if (EXACT_CASE[upper]) return EXACT_CASE[upper];
      if (ACRONYMS.has(upper)) return upper;
      const lower = word.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

/**
 * Human role names. The map lived in two places (the app shell and the sign-in
 * page) while five other surfaces printed the raw enum, so the same person
 * appeared as "HR Manager" in one panel and "HR_MANAGER" in the next. One
 * definition now serves all of them. Retired roles stay listed so historical
 * records keep rendering.
 */
const ROLE_LABELS: Record<string, string> = {
  HR_MANAGER: 'HR Manager',
  HR_OFFICER: 'HR Officer',
  LINE_MANAGER: 'Line Manager',
  SYSTEM_ADMIN: 'System Administrator',
  IT_RESPONDER: 'IT Responder',
  FINANCE_RESPONDER: 'Finance Responder',
  AUDITOR: 'Auditor',
  PRIVACY_OFFICER: 'Privacy Officer',
};

export function roleLabel(role: string): string {
  return (
    ROLE_LABELS[role] ??
    role
      .replaceAll('_', ' ')
      .toLowerCase()
      .replace(/\b\w/g, (ch) => ch.toUpperCase())
  );
}

/** Comma-separated human role names, or a fallback when the list is empty. */
export function roleList(roles: readonly string[], fallback = 'No roles'): string {
  return roles.map(roleLabel).join(', ') || fallback;
}

/**
 * "376 record(s)" reads like a debug string. `plural` picks the right word so
 * counts render as ordinary English; the irregular form is optional.
 */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

/** `plural` with the number in front: "1 record", "376 records". */
export function countOf(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${plural(count, singular, pluralForm)}`;
}
