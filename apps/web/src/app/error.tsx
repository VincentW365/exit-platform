'use client';

// Global error boundary: user-safe wording only, no stack traces or internals
// (REQ-SEC-034). The digest is Next's sanitized reference id for support.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" style={{ maxWidth: '40rem', margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Something went wrong</h1>
      <p className="panel">
        The action could not be completed. The event was logged
        {error.digest ? (
          <>
            {' '}
            with reference <code>{error.digest}</code>
          </>
        ) : null}
        . Try again, and quote the reference if you contact support.
      </p>
      <button type="button" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
