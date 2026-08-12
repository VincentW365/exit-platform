/**
 * Application roles - the six-role model from RolesAndPermissions.md.
 * DEC-042 (owner instruction, 2026-08-12) removed AUDITOR and PRIVACY_OFFICER
 * from the active model (superseding the Directive 0.1 section B note):
 * HR_MANAGER absorbs privacy/retention approvals and survey oversight;
 * SYSTEM_ADMIN keeps technical administration with no case content. The
 * database Role enum retains the old values as deprecated so historical
 * assignments and append-only evidence stay intact - no code path grants or
 * honours them.
 */
export const ROLES = [
  'HR_MANAGER',
  'HR_OFFICER',
  'IT_RESPONDER',
  'FINANCE_RESPONDER',
  'LINE_MANAGER',
  'SYSTEM_ADMIN',
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

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
