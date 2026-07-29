import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Thank you', robots: { index: false } };

export default function SurveyThanksPage() {
  return (
    <main id="main" style={{ maxWidth: '38rem', margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Thank you</h1>
      <p className="panel">
        Your survey has been submitted. Your feedback is appreciated and will be reviewed by
        authorized Human Resources personnel.
      </p>
    </main>
  );
}
