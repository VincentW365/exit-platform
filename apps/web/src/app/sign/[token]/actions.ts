'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { submitSignatures } from '@exit/db';

/**
 * Public no-login signature submission (DEC-068).
 *
 * Same trust shape as the acknowledgement and checklist links: neutral
 * outcomes, per-token and process-wide rate limiting, and no case content in
 * any response. The single-use claim itself is atomic inside the service, so
 * this layer only has to keep a flood from reaching it.
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

/** One mark, after the untrusted payload has been narrowed to its shape. */
interface ParsedMark {
  blockKey: string;
  dataUrl: string;
  provenance: 'DRAWN' | 'TYPED';
}

/**
 * The marks arrive as JSON because a PNG data URL is not a form field a
 * signer types. Everything here is untrusted: the shape is checked, the count
 * is capped, and the images themselves are validated in the service against
 * the blocks the request actually requires.
 */
function parseMarks(raw: string): ParsedMark[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((entry): ParsedMark[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const row = entry as Record<string, unknown>;
    const blockKey = typeof row['blockKey'] === 'string' ? row['blockKey'].slice(0, 64) : '';
    const dataUrl = typeof row['dataUrl'] === 'string' ? row['dataUrl'] : '';
    if (!blockKey || !dataUrl) return [];
    // A megabyte and a half of base64 is already past what the service will
    // accept; refuse it here rather than decoding it.
    if (dataUrl.length > 1_600_000) return [];
    return [
      {
        blockKey,
        dataUrl,
        provenance: row['provenance'] === 'TYPED' ? 'TYPED' : 'DRAWN',
      },
    ];
  });
}

export async function submitSigningAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '').slice(0, 128);
  const path = `/sign/${encodeURIComponent(token)}`;
  if (rateLimited(token.slice(0, 8))) redirect(`${path}?retry=1`);

  const marks = parseMarks(String(formData.get('marks') ?? ''));
  const consented = String(formData.get('consent') ?? '') === 'yes';

  // Supporting evidence only, never identification on its own (directive 1
  // section 18). The address is hashed so the platform keeps the ability to
  // compare submissions without storing where somebody was.
  const head = await headers();
  const forwarded = (head.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? '';
  const ipHash = forwarded
    ? createHash('sha256').update(`signature:${forwarded}`).digest('hex').slice(0, 32)
    : null;
  const userAgent = head.get('user-agent');

  const outcome = await submitSignatures(token, { marks, consented, ipHash, userAgent });
  if (outcome.ok) redirect(`${path}?done=1`);
  redirect(`${path}?error=1`);
}
