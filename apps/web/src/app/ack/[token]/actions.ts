'use server';

import { redirect } from 'next/navigation';
import { redeemActionToken } from '@exit/db';

/**
 * Public no-login redemption boundary (Directive 6.3 T).
 *
 * Simple in-process fixed-window rate limiting: per token prefix AND a
 * module-wide counter, roughly 30 attempts per minute. Development-grade,
 * no external dependencies - the service itself stays single-use atomic.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const buckets = new Map<string, { count: number; resetAt: number }>();
let globalCount = 0;
let globalResetAt = 0;

function rateLimited(prefix: string): boolean {
  const now = Date.now();
  if (globalResetAt < now) {
    globalResetAt = now + WINDOW_MS;
    globalCount = 0;
  }
  globalCount += 1;
  if (globalCount > MAX_PER_WINDOW) return true;
  const b = buckets.get(prefix);
  if (!b || b.resetAt < now) {
    if (buckets.size > 1000) buckets.clear();
    buckets.set(prefix, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > MAX_PER_WINDOW;
}

export async function redeemAckAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '').slice(0, 128);
  const note = String(formData.get('note') ?? '')
    .trim()
    .slice(0, 500);
  const path = `/ack/${encodeURIComponent(token)}`;

  if (rateLimited(token.slice(0, 8))) redirect(`${path}?retry=1`);

  let outcome: Awaited<ReturnType<typeof redeemActionToken>> = null;
  try {
    outcome = await redeemActionToken(token, note || undefined);
  } catch {
    // Neutral outcome for every failure - the page reveals nothing further.
    outcome = null;
  }
  if (outcome) redirect(`${path}?done=1`);
  redirect(path);
}
