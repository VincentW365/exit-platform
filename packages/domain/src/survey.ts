/**
 * Exit-survey domain rules (Directive 2 sections G-H).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DateTime } from 'luxon';
import { APP_ZONE } from './calendar.ts';

export const SURVEY_QUESTION_TYPES = [
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
  'RATING_1_5',
  'YES_NO_PNTS',
  'SHORT_TEXT',
  'LONG_TEXT',
] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];

export const YES_NO_PNTS_OPTIONS = ['Yes', 'No', 'Prefer not to say'] as const;

// --- tokens (H token requirements) ------------------------------------------

/** 256 bits of CSPRNG entropy, base64url (43 chars). */
export function generateSurveyToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only the hash is ever stored or compared. */
export function hashSurveyToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/** Constant-time comparison of a presented token against a stored hash. */
export function tokenMatchesHash(rawToken: string, storedHash: string): boolean {
  const a = Buffer.from(hashSurveyToken(rawToken), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isPlausibleToken(raw: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(raw);
}

// --- scheduling (H default timing; calendar days, Jamaica) -------------------

function addCalendarDays(anchor: Date, days: number): Date {
  return DateTime.fromJSDate(anchor, { zone: APP_ZONE }).plus({ days }).toJSDate();
}

/** Invitation due: 3 calendar days after effective separation. */
export function invitationDueAt(effectiveSeparationAt: Date): Date {
  return addCalendarDays(effectiveSeparationAt, 3);
}

/** Reminder/expiry schedule anchored on the MANUAL send. */
export function scheduleFromManualSend(manualSentAt: Date): {
  reminder1DueAt: Date;
  reminder2DueAt: Date;
  expiresAt: Date;
} {
  return {
    reminder1DueAt: addCalendarDays(manualSentAt, 3),
    reminder2DueAt: addCalendarDays(manualSentAt, 7),
    expiresAt: addCalendarDays(manualSentAt, 14),
  };
}

// --- eligibility (fixed defaults 19-21) --------------------------------------

export function surveyEligibility(departureType: string): {
  eligibleByDefault: boolean;
  requiresOverride: boolean;
} {
  if (departureType === 'TERMINATION') return { eligibleByDefault: false, requiresOverride: true };
  return { eligibleByDefault: true, requiresOverride: false };
}

// --- answers -----------------------------------------------------------------

export interface QuestionShape {
  id: string;
  type: SurveyQuestionType;
  prompt: string;
  required: boolean;
  options: readonly string[];
  maxLength: number | null;
}

export interface AnswerInput {
  questionId: string;
  choices: readonly string[];
  rating: number | null;
  text: string | null;
}

export function answerErrors(q: QuestionShape, a: AnswerInput | undefined): string[] {
  const errors: string[] = [];
  const empty =
    !a || (a.choices.length === 0 && a.rating === null && !(a.text && a.text.trim().length > 0));
  if (empty) {
    if (q.required) errors.push(`"${q.prompt}" requires an answer.`);
    return errors;
  }
  switch (q.type) {
    case 'SINGLE_CHOICE':
    case 'YES_NO_PNTS': {
      // YES_NO_PNTS falls back to the standard options when the question
      // defines none; a question may extend them (e.g. adding "Unsure").
      const opts =
        q.type === 'YES_NO_PNTS' && q.options.length === 0 ? YES_NO_PNTS_OPTIONS : q.options;
      if (a.choices.length !== 1 || !opts.includes(a.choices[0]!))
        errors.push(`"${q.prompt}": choose exactly one of the offered options.`);
      break;
    }
    case 'MULTI_CHOICE': {
      if (a.choices.length === 0 || a.choices.some((c) => !q.options.includes(c)))
        errors.push(`"${q.prompt}": choices must come from the offered options.`);
      break;
    }
    case 'RATING_1_5': {
      if (a.rating === null || !Number.isInteger(a.rating) || a.rating < 1 || a.rating > 5)
        errors.push(`"${q.prompt}": rating must be a whole number from 1 to 5.`);
      break;
    }
    case 'SHORT_TEXT': {
      const max = q.maxLength ?? 200;
      if ((a.text ?? '').length > max) errors.push(`"${q.prompt}": limited to ${max} characters.`);
      break;
    }
    case 'LONG_TEXT': {
      const max = q.maxLength ?? 2000;
      if ((a.text ?? '').length > max) errors.push(`"${q.prompt}": limited to ${max} characters.`);
      break;
    }
  }
  return errors;
}

// --- completion metrics (section K.4) ----------------------------------------

export interface InvitationTally {
  manuallySent: number;
  completedOnline: number;
  completedVerbal: number;
  declined: number;
  expired: number;
  invalidContact: number;
  notEligible: number;
  notSent: number;
}

export function completionRate(t: InvitationTally): {
  numerator: number;
  denominator: number;
  pct: number | null;
} {
  const numerator = t.completedOnline + t.completedVerbal;
  const denominator = t.manuallySent;
  return {
    numerator,
    denominator,
    pct: denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10,
  };
}
