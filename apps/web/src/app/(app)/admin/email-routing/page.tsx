import type { Metadata } from 'next';
import { ServiceError, getTestMode, listDepartmentMailboxes, listRoutes } from '@exit/db';
import { destinationLabel } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { humanize } from '@/lib/text';
import { setMailboxAction, setTestAddressAction } from './actions';

export const metadata: Metadata = { title: 'Email Routing' };
export const dynamic = 'force-dynamic';

export default async function EmailRoutingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;

  let mailboxes: Awaited<ReturnType<typeof listDepartmentMailboxes>>;
  let routes: Awaited<ReturnType<typeof listRoutes>>;
  try {
    mailboxes = await listDepartmentMailboxes(actor);
    routes = await listRoutes(actor);
  } catch (e) {
    if (e instanceof ServiceError)
      return (
        <>
          <h1>Access Restricted</h1>
          <p className="panel">Email routing requires an authorized role.</p>
        </>
      );
    throw e;
  }
  const testMode = await getTestMode(actor);
  // Development and UAT can only run the capture provider, so nothing leaves
  // the network here whatever address is configured. Saying so plainly beats
  // letting someone wait for an email that was never going to arrive.
  const capturesOnly = process.env.EMAIL_MODE !== 'graph';

  return (
    <>
      <h1>Email Routing</h1>
      <Feedback err={sp.err} ok={sp.ok} />

      {/* The thing an owner needs first: prove mail works, to one address. */}
      <section className="panel" aria-labelledby="test-h">
        <h2 id="test-h" style={{ marginTop: 0 }}>
          Send Every Message to One Address
        </h2>
        {testMode.enabled ? (
          <p className="banner-restricted" role="status">
            ON — every message goes to <strong>{testMode.redirectTo}</strong>. Nothing is reaching
            its real recipients.
          </p>
        ) : (
          <p className="hint">Off — messages go to the mailboxes set below.</p>
        )}
        <p className="hint">
          Put your own address here to watch the whole offboarding workflow arrive in one inbox. The
          real recipients are still worked out normally and written at the top of every message, so
          you can check the routing is right before any of it goes to a real mailbox.
        </p>
        {capturesOnly ? (
          <p className="hint" role="note">
            <strong>This environment does not send email.</strong> It runs the capture provider, so
            every message — including these — is written to the{' '}
            <a href="/dev/mailbox">captured email</a> screen instead of leaving the network. The
            address above is what will be used once a real mail provider is configured; read the
            messages in the mailbox to check the routing now.
          </p>
        ) : null}
        <form action={setTestAddressAction} className="stack">
          <div className="field">
            <label htmlFor="tm-to">Send Everything To</label>
            <input
              id="tm-to"
              name="redirectTo"
              type="email"
              maxLength={200}
              placeholder="you@bertsautoparts.com"
              defaultValue={testMode.redirectTo}
            />
          </div>
          <div className="actions-row">
            <button type="submit" name="enabled" value="on">
              {testMode.enabled ? 'Update the address' : 'Send everything here'}
            </button>
            {testMode.enabled ? (
              <button type="submit" name="enabled" value="off" className="secondary">
                Stop — use the real mailboxes
              </button>
            ) : null}
          </div>
        </form>
      </section>

      {/* Then: what each department's mailbox actually is. */}
      <section className="panel" aria-labelledby="mailboxes-h">
        <h2 id="mailboxes-h" style={{ marginTop: 0 }}>
          Department Mailboxes
        </h2>
        <p className="hint">
          One address per department. Nothing in the platform has a mailbox written into it — change
          an address here and every notification addressed to that department follows, with no
          change to the workflow.
        </p>
        {mailboxes.map((m) => (
          <details
            key={m.destination}
            className="action"
            aria-label={`${m.destination} mailbox`}
            open={!m.usable}
          >
            <summary>
              {m.label} — {m.mask ?? 'no mailbox set'}{' '}
              {m.usable ? (
                <span className="badge badge--success">Ready</span>
              ) : (
                <span className="badge badge--warning">Needs an address</span>
              )}
            </summary>
            <form action={setMailboxAction} className="stack">
              <input type="hidden" name="destination" value={m.destination} />
              <p className="hint">{m.statusNote}</p>
              {m.usedFor.length ? (
                <p className="hint">Receives: {m.usedFor.map((t) => humanize(t)).join('; ')}.</p>
              ) : (
                <p className="hint">No notification is addressed here yet.</p>
              )}
              <div className="field">
                <label htmlFor={`mb-${m.destination}`}>Mailbox</label>
                <input
                  id={`mb-${m.destination}`}
                  name="email"
                  type="email"
                  maxLength={200}
                  required
                  placeholder="department@bertsautoparts.com"
                />
                <span className="hint">
                  The current address is shown masked above; type the full address to replace it.
                </span>
              </div>
              <div className="field">
                <label htmlFor={`rs-${m.destination}`}>Reason for the Change</label>
                <input id={`rs-${m.destination}`} name="reason" type="text" maxLength={300} />
              </div>
              <button type="submit">Save mailbox</button>
            </form>
          </details>
        ))}
      </section>

      {/* Reference, not a control: each notification has one natural home. */}
      <section className="panel" aria-labelledby="where-h">
        <h2 id="where-h" style={{ marginTop: 0 }}>
          Where Each Notification Goes
        </h2>
        <p className="hint">
          Each notification has one department it belongs to. Set that department&apos;s mailbox
          above and it arrives in the right place.
        </p>
        <div className="table-wrap" tabIndex={0}>
          <table className="data">
            <caption className="sr-only">Notification types and their destinations</caption>
            <thead>
              <tr>
                <th scope="col">Notification</th>
                <th scope="col">Goes to</th>
                <th scope="col">Copied</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.notificationType}>
                  <td>{humanize(r.notificationType)}</td>
                  <td>{destinationLabel(r.to)}</td>
                  <td>
                    {r.cc.length ? r.cc.map((k) => destinationLabel(k)).join('; ') : '-'}
                    {r.bcc.length
                      ? ` (blind: ${r.bcc.map((k) => destinationLabel(k)).join('; ')})`
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          External providers (group health, group life, payroll bank, pension) are maintained in the{' '}
          <a href="/admin/recipients">recipient directory</a>, where an external address is approved
          by a second authority before it can be used.
        </p>
      </section>
    </>
  );
}
