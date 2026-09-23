import type { Metadata } from 'next';
import { ServiceError, listDevMailbox } from '@exit/db';
import { formatInstant, EMAIL_BANNER_CID } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { EmptyState } from '@/components/EmptyState';
import { EmailPreviewFrame } from '@/components/EmailPreviewFrame';
import { InboxIcon } from '@/components/icons';
import { Chip } from '@/components/patterns';

export const metadata: Metadata = { title: 'Captured Email' };
export const dynamic = 'force-dynamic';

/**
 * Directive 4 section C: captured messages - never external deliveries.
 * DEC-067 section 6: the preview shows the complete presentation - subject,
 * recipient class, the HTML part with its links and the banner image - so
 * UAT can verify the email as a reader would see it. The text part stays
 * readable underneath for the image-blocked case.
 */
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
      {messages.map((m) => {
        // The captured HTML references the banner by Content-ID exactly as
        // the delivered message would; the preview points that reference at
        // the platform's own authorized image route.
        const previewHtml = m.html
          ? m.html.replaceAll(`cid:${EMAIL_BANNER_CID}`, `/api/email-banner/capture-${m.id}`)
          : null;
        return (
          <section className="panel" key={m.id} aria-label="Captured message">
            <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>{m.subject}</h2>
            <p className="hint">
              {m.record.notificationType} - {m.record.recipientClass} - case{' '}
              {m.record.case.caseNumber} ({m.record.case.recordPurpose}) - captured{' '}
              {formatInstant(m.capturedAt)}
            </p>
            <p className="meta" data-banner-status>
              {m.bannerObjectKey ? (
                <>
                  <Chip tone="done">Banner: {(m.bannerKind ?? 'banner').toLowerCase()}</Chip>{' '}
                  {m.bannerWidth} × {m.bannerHeight} px, alt &ldquo;{m.bannerAlt}&rdquo;
                </>
              ) : (
                <Chip tone="neutral">No email banner</Chip>
              )}
            </p>
            {previewHtml ? (
              <div className="email-preview" data-email-preview>
                <EmailPreviewFrame html={previewHtml} title={`Email preview: ${m.subject}`} />
              </div>
            ) : null}
            <details className="action">
              <summary>Plain-text part (what an image-blocked client shows)</summary>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{m.body}</pre>
            </details>
            <p className="hint">{m.note}</p>
          </section>
        );
      })}
    </>
  );
}
