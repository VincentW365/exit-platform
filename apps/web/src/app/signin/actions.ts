'use server';

/**
 * Development role switcher (REQ-SEC-003, IC-S1-005). The action is a no-op
 * unless BOTH safeguards hold; production cannot even start with the flag on
 * (config guard), and this second gate keeps the behaviour fail-closed.
 */
import { redirect } from 'next/navigation';
import { getConfig } from '@exit/config';
import { auditLogin, auditLogout, getSessionUser } from '@exit/db';
import { createSessionCookie, currentUser, destroySessionCookie } from '@/lib/session';

export async function devLoginAction(formData: FormData): Promise<void> {
  if (!getConfig().devLoginEnabled) redirect('/signin?err=Development+login+is+disabled.');
  const userId = String(formData.get('userId') ?? '');
  const user = userId ? await getSessionUser(userId) : null;
  if (!user) {
    await auditLogin(userId || 'unknown', [], false);
    redirect('/signin?err=Unknown+or+inactive+user.');
  }
  await createSessionCookie(user.userId);
  await auditLogin(user.userId, user.roles, true);
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  const user = await currentUser();
  if (user) await auditLogout(user.userId, user.roles);
  await destroySessionCookie();
  redirect('/signin');
}
