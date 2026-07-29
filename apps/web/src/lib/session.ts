/**
 * Session management (REQ-SEC-004): signed JWT in a Secure/HttpOnly/SameSite
 * cookie, with idle and absolute timeouts. The session carries only the user
 * id; roles are re-resolved from the database on every request so revocation
 * takes effect immediately.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { getConfig } from '@exit/config';
import { getSessionUser, type SessionUser } from '@exit/db';

const COOKIE_NAME = 'exit_session';

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getConfig().SESSION_SECRET);
}

export async function createSessionCookie(userId: string): Promise<void> {
  const config = getConfig();
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ la: now })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + config.SESSION_ABSOLUTE_HOURS * 3600)
    .sign(secretKey());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: config.SESSION_ABSOLUTE_HOURS * 3600,
  });
}

export async function destroySessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/** Verify the cookie and enforce idle/absolute timeouts. Returns userId or null. */
export async function readSessionUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const la = typeof payload['la'] === 'number' ? payload['la'] : 0;
    const idleSeconds = getConfig().SESSION_IDLE_MINUTES * 60;
    if (Math.floor(Date.now() / 1000) - la > idleSeconds) return null; // idle timeout
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/**
 * Refresh the idle-activity claim. Callable only where Next allows cookie
 * writes (server actions / route handlers).
 */
export async function touchSession(): Promise<void> {
  const userId = await readSessionUserId();
  if (userId) await createSessionCookie(userId);
}

/** Resolve the authenticated user with active roles, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const userId = await readSessionUserId();
  if (!userId) return null;
  return getSessionUser(userId);
}
