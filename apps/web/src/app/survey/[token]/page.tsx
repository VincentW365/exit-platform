import type { Metadata } from 'next';
import { ServiceError, getSurveyByToken } from '@exit/db';
import { SurveyQuestions } from '@/components/SurveyQuestions';
import { BrandMark } from '@/components/BrandMark';
import { submitSurveyAction } from './actions';

export const metadata: Metadata = { title: 'Exit survey', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** Neutral page for every invalid/expired/used link - no case detail leaks. */
function NeutralPage() {
  return (
    <main id="main" style={{ maxWidth: '38rem', margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Survey Not Available</h1>
      <p className="panel">
        This survey link is not available. If you believe this is a mistake, please contact the
        Human Resources office.
      </p>
    </main>
  );
}

export default async function PublicSurveyPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ err?: string }>;
}) {
  const { token } = await params;
  const { err } = await searchParams;

  let survey: Awaited<ReturnType<typeof getSurveyByToken>>;
  try {
    survey = await getSurveyByToken(token);
  } catch (e) {
    if (e instanceof ServiceError) return <NeutralPage />;
    throw e;
  }

  return (
    <main id="main" style={{ maxWidth: '38rem', margin: '1.5rem auto', padding: '0 1rem 3rem' }}>
      {/* The company logo on every form the employee is handed (owner
          directive 2026-09-22, section 8). */}
      <div className="public-brand">
        <BrandMark size="lg" />
      </div>
      <h1>{survey.title}</h1>
      <p>{survey.introText}</p>
      <p className="banner-baseline">{survey.privacyNotice}</p>
      {err ? (
        <div className="error-summary" role="alert">
          <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Please Review Your Answers</h2>
          <ul>
            {err.split('|').map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <form action={submitSurveyAction} className="stack">
        <input type="hidden" name="token" value={token} />
        <SurveyQuestions questions={survey.questions} />
        <p className="hint">
          Review your answers before submitting - a survey can be submitted only once and answers
          cannot be changed afterwards.
        </p>
        <button type="submit">Submit survey</button>
      </form>
    </main>
  );
}
