import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Survey not available', robots: { index: false } };

export default function SurveyExpiredPage() {
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
