import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main" style={{ maxWidth: '40rem' }}>
      <h1>Page or record not found</h1>
      <p className="panel">
        The page or record does not exist, or your access does not include it. Restricted records
        are indistinguishable from missing ones by design.
      </p>
      <p>
        <Link className="button secondary" href="/">
          Back to dashboard
        </Link>
      </p>
    </main>
  );
}
