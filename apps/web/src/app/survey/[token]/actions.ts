'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ServiceError, submitSurveyByToken } from '@exit/db';
import type { AnswerInput } from '@exit/domain';

/**
 * Simple in-process rate limit for the public survey boundary (H token rule 5).
 * Development-grade: per-IP token bucket, 20 requests per 10 minutes.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + 10 * 60_000 });
    return false;
  }
  b.count += 1;
  return b.count > 20;
}

export async function submitSurveyAction(formData: FormData): Promise<void> {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? 'local').split(',')[0]!.trim();
  const token = String(formData.get('token') ?? '');
  if (rateLimited(ip)) redirect(`/survey/expired`);

  const answers: AnswerInput[] = [];
  const byId = new Map<string, AnswerInput>();
  for (const [key, value] of formData.entries()) {
    const m = /^q:(.+):(rating|choice|text)$/.exec(key);
    if (!m || typeof value !== 'string' || !value.trim()) continue;
    const questionId = m[1]!;
    let a = byId.get(questionId);
    if (!a) {
      a = { questionId, choices: [], rating: null, text: null };
      byId.set(questionId, a);
      answers.push(a);
    }
    if (m[2] === 'rating') (a as { rating: number | null }).rating = Number(value);
    else if (m[2] === 'choice') (a.choices as string[]).push(value);
    else (a as { text: string | null }).text = value;
  }

  try {
    await submitSurveyByToken(token, answers);
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'VALIDATION') {
      redirect(`/survey/${token}?err=${encodeURIComponent(e.details.join('|').slice(0, 900))}`);
    }
    // Neutral outcome for every other failure (invalid/expired/used/duplicate).
    redirect(`/survey/expired`);
  }
  redirect(`/survey/thanks`);
}
