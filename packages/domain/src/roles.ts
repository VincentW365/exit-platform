/**
 * Application roles - the two-role model (owner directive, 2026-09-22,
 * DEC-063, superseding the six-role model of DEC-042).
 *
 * Only two roles can sign in, be granted, or satisfy any permission:
 * HR_MANAGER owns oversight and the HR-operational administration the
 * platform needs; HR_OFFICER processes cases. Everyone else the platform
 * knows about - employees, reporting managers, IT, Finance, providers - is a
 * directory record, a workflow participant, a notification recipient or a
 * token-link holder, never an application login.
 *
 * The database Role enum retains the retired values (SYSTEM_ADMIN,
 * IT_RESPONDER, FINANCE_RESPONDER, LINE_MANAGER, AUDITOR, PRIVACY_OFFICER)
 * as deprecated-in-place, so historical assignments, task attributions on
 * superseded workflow versions and append-only evidence stay intact and
 * readable. No code path grants, selects or honours them: isRole() is the
 * single gate for new assignments.
 */
export const ROLES = ['HR_MANAGER', 'HR_OFFICER'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * Retired role values that still exist in the database enum and in stored
 * rows (historical role assignments, task definitions on superseded workflow
 * versions, append-only evidence). They are READ support only: nothing in
 * the platform grants, selects or honours them, and isRole() refuses them.
 */
export const DEPRECATED_ROLES = [
  'SYSTEM_ADMIN',
  'IT_RESPONDER',
  'FINANCE_RESPONDER',
  'LINE_MANAGER',
  'AUDITOR',
  'PRIVACY_OFFICER',
] as const;
export type DeprecatedRole = (typeof DEPRECATED_ROLES)[number];
/** A role value as it may appear in STORED data: active or deprecated. */
export type StoredRole = Role | DeprecatedRole;

/** Roles that perform HR case work. */
export const HR_ROLES: readonly Role[] = ['HR_MANAGER', 'HR_OFFICER'];

/** An authenticated actor as seen by the policy layer. */
export interface Actor {
  readonly userId: string;
  readonly roles: readonly Role[];
}

export function hasRole(actor: Actor, ...roles: readonly Role[]): boolean {
  return roles.some((r) => actor.roles.includes(r));
}
