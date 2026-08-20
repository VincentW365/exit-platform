import type { Metadata } from 'next';
import { ServiceError, listDevMailbox } from '@exit/db';
import { formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { EmptyState } from '@/components/EmptyState';
import { InboxIcon } from '@/components/icons';

export const metadata: Metadata = { title: 'Captured Email' };
export const dynamic = 'force-dynamic';

/** Directive 4 section C: captured messages - never external deliveries. */
export default async function DevMailboxPage() {
  const { actor } = await requireAuth();
  let messages: Awaited<ReturnType<typeof listDevMailbox>>;
  try {
    messages = await listDevMailbox(actor);
  } catch (e) {
    if (e instanceof ServiceError)
      return (
        <>
          <h1>Access Restricted</h1>
          <p className="panel">
            The development mailbox is not available for your role or environment.
          </p>
        </>
      );
    throw e;
  }
  return (
    <>
      <h1>Captured Email</h1>
      <p className="banner-baseline" role="note">
        DEVELOPMENT CAPTURE ONLY - these messages were captured locally and were NEVER delivered
        externally. This mailbox does not exist in production.
      </p>
      {messages.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<InboxIcon />}
            title="No captured messages"
            body="Every email this environment produces is captured here instead of being delivered."
          />
        </div>
      ) : null}
      {messages.map((m) => (
        <section className="panel" key={m.id} aria-label="Captured message">
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>{m.subject}</h2>
          <p className="hint">
            {m.record.notificationType} - {m.record.recipientClass} - case{' '}
            {m.record.case.caseNumber} ({m.record.case.recordPurpose}) - captured{' '}
            {formatInstant(m.capturedAt)}
          </p>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{m.body}</pre>
          <p className="hint">{m.note}</p>
        </section>
      ))}
    </>
  );
}
