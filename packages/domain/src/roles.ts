/**
 * Application roles - the eight-role model from RolesAndPermissions.md.
 * Directive 0.1 section B restored PRIVACY_OFFICER; do not remove it.
 */
export const ROLES = [
  'HR_MANAGER',
  'HR_OFFICER',
  'IT_RESPONDER',
  'FINANCE_RESPONDER',
  'LINE_MANAGER',
  'AUDITOR',
  'PRIVACY_OFFICER',
  'SYSTEM_ADMIN',
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Roles that perform HR case work. */
export const HR_ROLES: readonly Role[] = ['HR_MANAGER', 'HR_OFFICER'];

/**
 * Read-only oversight roles (IC-S1-011: "expressly authorized oversight
 * role"). They may see audit trails within scope; they never perform ordinary
 * HR case processing.
 */
export const OVERSIGHT_ROLES: readonly Role[] = ['AUDITOR', 'PRIVACY_OFFICER'];

/** An authenticated actor as seen by the policy layer. */
export interface Actor {
  readonly userId: string;
  readonly roles: readonly Role[];
}

export function hasRole(actor: Actor, ...roles: readonly Role[]): boolean {
  return roles.some((r) => actor.roles.includes(r));
}
