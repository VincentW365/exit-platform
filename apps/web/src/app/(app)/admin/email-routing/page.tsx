import type { Metadata } from 'next';
import { ServiceError, getTestMode, listRoutes } from '@exit/db';
import {
  DESTINATION_LABELS,
  DYNAMIC_DESTINATIONS,
  STATIC_DESTINATIONS,
  type DestinationKey,
} from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { humanize } from '@/lib/text';
import { setRouteAction } from './actions';

export const metadata: Metadata = { title: 'Email Routing' };
export const dynamic = 'force-dynamic';

const STATIC_OPTIONS = STATIC_DESTINATIONS.map(
  (d) => [`static:${d}` as DestinationKey, DESTINATION_LABELS[d]] as const,
);
const DYNAMIC_OPTIONS = DYNAMIC_DESTINATIONS.map(
  (d) => [`dynamic:${d}` as DestinationKey, DESTINATION_LABELS[d]] as const,
);

function DestinationOptions() {
  return (
    <>
      <optgroup label="Shared mailboxes (from the recipient directory)">
        {STATIC_OPTIONS.map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </optgroup>
      <optgroup label="People on this case (resolved per employee)">
        {DYNAMIC_OPTIONS.map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </optgroup>
    </>
  );
}

export default async function EmailRoutingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;

  let routes: Awaited<ReturnType<typeof listRoutes>>;
  try {
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

  return (
    <>
      <h1>Email Routing</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Who receives each notification, in one place. Nothing in the platform names a mailbox: a
        notification is addressed to a <strong>destination</strong>, and this page says what each
        destination means. Moving a department to a new address, or copying Security on access
        removals, is a change here - never a change to the workflow.
      </p>
      <p className="hint">
        Shared mailboxes come from the <a href="/admin/recipients">recipient directory</a>, where
        the address itself is held encrypted and approved. Destinations resolved per employee (a
        manager, the assigned officer) are read from the case at send time.
      </p>

      {testMode.enabled ? (
        <p className="banner-restricted" role="status">
          Rehearsal mode is ON: these routes are still calculated in full, but every message is
          redirected to the test mailbox and states its intended recipients.
        </p>
      ) : null}

      {routes.map((r) => (
        <section
          key={r.notificationType}
          className="panel"
          aria-label={`${r.notificationType} routing`}
        >
          <h2 style={{ marginTop: 0 }}>
            {humanize(r.notificationType)}{' '}
            {r.isDefault ? <span className="badge badge--neutral">Default</span> : null}
          </h2>
          <dl className="kv">
            <dt>To</dt>
            <dd>{DESTINATION_LABELS[r.to.split(':')[1] as never] ?? r.to}</dd>
            <dt>Copied</dt>
            <dd>
              {r.cc.length
                ? r.cc.map((k) => DESTINATION_LABELS[k.split(':')[1] as never]).join('; ')
                : 'Nobody'}
            </dd>
            <dt>Blind copied</dt>
            <dd>
              {r.bcc.length
                ? r.bcc.map((k) => DESTINATION_LABELS[k.split(':')[1] as never]).join('; ')
                : 'Nobody'}
            </dd>
          </dl>
          {r.note ? <p className="hint">{r.note}</p> : null}

          <details className="action">
            <summary>Change who receives this</summary>
            <form action={setRouteAction} className="stack">
              <input type="hidden" name="notificationType" value={r.notificationType} />
              <div className="field">
                <label htmlFor={`to-${r.notificationType}`}>Primary Recipient (To)</label>
                <select id={`to-${r.notificationType}`} name="to" defaultValue={r.to} required>
                  <DestinationOptions />
                </select>
              </div>
              <div className="field">
                <label htmlFor={`cc-${r.notificationType}`}>Copied (Cc)</label>
                <select
                  id={`cc-${r.notificationType}`}
                  name="cc"
                  multiple
                  size={6}
                  defaultValue={[...r.cc]}
                >
                  <DestinationOptions />
                </select>
                <span className="hint">Hold Ctrl (or Cmd) to select several, or none at all.</span>
              </div>
              <div className="field">
                <label htmlFor={`bcc-${r.notificationType}`}>Blind Copied (Bcc)</label>
                <select
                  id={`bcc-${r.notificationType}`}
                  name="bcc"
                  multiple
                  size={6}
                  defaultValue={[...r.bcc]}
                >
                  <DestinationOptions />
                </select>
                <span className="hint">
                  Blind copies are not shown to the other recipients. Use sparingly - a person who
                  cannot see who else received a message cannot correct a mistake.
                </span>
              </div>
              <div className="field">
                <label htmlFor={`note-${r.notificationType}`}>Why This Route</label>
                <input
                  id={`note-${r.notificationType}`}
                  name="note"
                  type="text"
                  maxLength={300}
                  defaultValue={r.note ?? ''}
                />
              </div>
              <button type="submit">Save routing</button>
            </form>
          </details>
        </section>
      ))}
    </>
  );
}
