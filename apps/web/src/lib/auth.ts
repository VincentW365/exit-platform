import 'server-only';
import { redirect } from 'next/navigation';
import type { Actor } from '@exit/domain';
import type { SessionUser } from '@exit/db';
import { currentUser } from './session';

export interface AuthContext {
  readonly user: SessionUser;
  readonly actor: Actor;
}

/** Server-side authentication gate for pages and actions (REQ-SEC-005). */
export async function requireAuth(): Promise<AuthContext> {
  const user = await currentUser();
  if (!user) redirect('/signin');
  return { user, actor: { userId: user.userId, roles: user.roles } };
}
