import type { Metadata } from 'next';
import Link from 'next/link';
import { ServiceError, listEmailLog } from '@exit/db';
import { formatInstant, OUTBOX_STATUSES } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { humanize } from '@/lib/text';
import { EmptyState } from '@/components/EmptyState';
import { MailIcon } from '@/components/icons';

export const metadata: Metadata = { title: 'Email Log' };
export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'badge--neutral',
  CLAIMED: 'badge--info',
  SUBMITTED: 'badge--success',
  DELIVERED: 'badge--success',
  FAILED_RETRYABLE: 'badge--warning',
  FAILED_PERMANENT: 'badge--danger',
  CANCELLED: 'badge--neutral',
  DEAD_LETTER: 'badge--danger',
};

export default async function EmailLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;

  let rows: Awaited<ReturnType<typeof listEmailLog>>;
  try {
    rows = await listEmailLog(actor, {
      status: sp.status,
      testOnly: sp.test === '1',
      caseNumber: sp.case,
    });
  } catch (e) {
    if (e instanceof ServiceError)
      return (
        <>
          <h1>Access Restricted</h1>
          <p className="panel">The email log requires an authorized role.</p>
        </>
      );
    throw e;
  }

  return (
    <>
      <h1>Email Log</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Every message the platform tried to send: what routing intended, where it actually went, and
        whether it was a test. Addresses are masked - the log is here to answer &ldquo;did this go
        to the right place&rdquo;, not to become a directory of everyone&apos;s email. The most
        recent 200 entries are shown.
      </p>

      <form className="filter-toolbar" role="search">
        <div className="field field--md">
          <label htmlFor="f-status">Delivery Status</label>
          <select id="f-status" name="status" defaultValue={sp.status ?? ''}>
            <option value="">Any</option>
            {OUTBOX_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="field field--md">
          <label htmlFor="f-case">Case Reference</label>
          <input id="f-case" name="case" type="search" defaultValue={sp.case ?? ''} />
        </div>
        <div className="field field--sm">
          <label htmlFor="f-test">Test Sends</label>
          <select id="f-test" name="test" defaultValue={sp.test ?? ''}>
            <option value="">All</option>
            <option value="1">Test only</option>
          </select>
        </div>
        <button type="submit">Apply</button>
      </form>

      {rows.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<MailIcon />}
            title="No messages match"
            body="Nothing has been generated yet, or nothing matches these filters."
          />
        </div>
      ) : (
        <div className="table-wrap" tabIndex={0}>
          <table className="data">
            <caption>{rows.length} message(s), newest first</caption>
            <thead>
              <tr>
                <th scope="col">Generated</th>
                <th scope="col">Case / employee</th>
                <th scope="col">Notification</th>
                <th scope="col">Intended recipients</th>
                <th scope="col">Actually sent to</th>
                <th scope="col">Subject</th>
                <th scope="col">Status</th>
                <th scope="col">Mode</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {formatInstant(r.generatedAt)}
                    {r.submittedAt ? (
                      <>
                        <br />
                        <span className="meta">sent {formatInstant(r.submittedAt)}</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <Link href={`/cases?q=${encodeURIComponent(r.caseNumber)}`}>
                      {r.caseNumber}
                    </Link>
                    <br />
                    <span className="meta">{r.employee}</span>
                  </td>
                  <td>{humanize(r.notificationType)}</td>
                  <td>
                    {r.intendedToMask ?? '-'}
                    {r.intendedCcMasks.length ? (
                      <>
                        <br />
                        <span className="meta">Cc: {r.intendedCcMasks.join(', ')}</span>
                      </>
                    ) : null}
                    {r.intendedBccMasks.length ? (
                      <>
                        <br />
                        <span className="meta">Bcc: {r.intendedBccMasks.join(', ')}</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {r.actualToMask ?? <span className="meta">not sent yet</span>}
                    {r.wasTestMode && r.actualToMask ? (
                      <>
                        <br />
                        <span className="meta">redirected</span>
                      </>
                    ) : null}
                  </td>
                  <td>{r.subject}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[r.status] ?? 'badge--neutral'}`}>
                      {humanize(r.status)}
                    </span>
                    {r.deliveryStatus ? (
                      <>
                        <br />
                        <span className="meta">{humanize(r.deliveryStatus)}</span>
                      </>
                    ) : null}
                    {r.errorCode ? (
                      <>
                        <br />
                        <span className="meta">
                          {humanize(r.errorCode)}
                          {r.attempts > 1 ? ` after ${r.attempts} attempts` : ''}
                        </span>
                        {r.errorDetail ? (
                          <>
                            <br />
                            <span className="meta">{r.errorDetail}</span>
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </td>
                  <td>
                    {r.wasTestMode ? (
                      <span className="badge badge--warning">Test</span>
                    ) : (
                      <span className="badge badge--neutral">Live</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
