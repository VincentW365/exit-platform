import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ROLES, can, formatInstant } from '@exit/domain';
import {
  listActiveUsers,
  listCalendars,
  listConfigItems,
  listFlags,
  listIntegrations,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import {
  addConfigItemAction,
  approveCalendarAction,
  grantRoleAction,
  previewCalendarAction,
  publishCalendarAction,
  revokeRoleAction,
  setFlagAction,
} from './actions';

export const metadata: Metadata = { title: 'Administration' };
export const dynamic = 'force-dynamic';

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; ok?: string; preview?: string }>;
}) {
  const { actor } = await requireAuth();
  const isSysAdmin = can(actor, 'admin.roles');
  const isHrConfig = can(actor, 'admin.calendar');
  if (!isSysAdmin && !isHrConfig) redirect('/unauthorized');
  const sp = await searchParams;

  const [users, flags, integrations] = await Promise.all([
    isSysAdmin ? listActiveUsers() : Promise.resolve([]),
    listFlags(actor).catch(() => []),
    listIntegrations(),
  ]);
  const calendars = isHrConfig ? await listCalendars(actor) : [];
  const departments = isHrConfig ? await listConfigItems('DEPARTMENT') : [];
  const locations = isHrConfig ? await listConfigItems('LOCATION') : [];

  const hubLinks: Array<{ href: string; label: string; kind: 'business' | 'technical' }> = [
    { href: '/admin/workflows', label: 'Workflow definitions', kind: 'business' },
    { href: '/admin/templates', label: 'Document templates', kind: 'business' },
    { href: '/baseline', label: 'Baseline dashboard', kind: 'business' },
    { href: '/admin/reasons', label: 'Reason taxonomy', kind: 'business' },
    { href: '/admin/recipients', label: 'Recipient directory', kind: 'business' },
    { href: '/reports', label: 'Reporting centre', kind: 'business' },
    { href: '/admin/pilot', label: 'Pilot readiness and activation', kind: 'business' },
    { href: '/admin/privacy', label: 'Privacy and retention', kind: 'business' },
    { href: '/continuity', label: 'Business continuity', kind: 'business' },
    { href: '/admin/system', label: 'System configuration and identity', kind: 'technical' },
    { href: '/admin/health', label: 'Integration health', kind: 'technical' },
    { href: '/admin/outbox', label: 'Email/outbox status', kind: 'technical' },
    { href: '/dev/mailbox', label: 'Development mailbox', kind: 'technical' },
    { href: '/support', label: 'Support and incidents', kind: 'technical' },
  ];

  return (
    <>
      <h1>Administration centre</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint">
        Technical administration and HR business configuration are separated by role; system
        administration includes no HR case content (least privilege).
      </p>

      <section className="panel" aria-labelledby="hub-h">
        <h2 id="hub-h" style={{ marginTop: 0 }}>
          Administration areas
        </h2>
        <div className="actions-row">
          {hubLinks.map((l) => (
            <a key={l.href} className="button secondary" href={l.href}>
              {l.label}
              {l.kind === 'technical' ? ' (technical)' : ''}
            </a>
          ))}
        </div>
      </section>

      {isSysAdmin ? (
        <section className="panel" aria-labelledby="roles-h">
          <h2 id="roles-h" style={{ marginTop: 0 }}>
            Users and roles (SYSTEM_ADMIN)
          </h2>
          <div className="table-wrap" tabIndex={0}>
            <table className="data">
              <caption>
                Active users; self-service role changes are refused and every change is audited
              </caption>
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Roles</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.userId}>
                    <td>
                      {u.displayName} <span className="hint">{u.workEmail}</span>
                    </td>
                    <td>{u.roles.join(', ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions-row">
            <details className="action">
              <summary>Grant a role</summary>
              <form action={grantRoleAction} className="stack">
                <div className="field">
                  <label htmlFor="g-user">User</label>
                  <select id="g-user" name="userId" required defaultValue="">
                    <option value="" disabled>
                      Choose...
                    </option>
                    {users.map((u) => (
                      <option key={u.userId} value={u.userId}>
                        {u.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="g-role">Role</label>
                  <select id="g-role" name="role" required defaultValue="">
                    <option value="" disabled>
                      Choose...
                    </option>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="g-reason">Reason (required, audited)</label>
                  <input id="g-reason" name="reason" type="text" required maxLength={200} />
                </div>
                <button type="submit">Grant role</button>
              </form>
            </details>
            <details className="action">
              <summary>Revoke a role</summary>
              <form action={revokeRoleAction} className="stack">
                <div className="field">
                  <label htmlFor="r-user">User</label>
                  <select id="r-user" name="userId" required defaultValue="">
                    <option value="" disabled>
                      Choose...
                    </option>
                    {users.map((u) => (
                      <option key={u.userId} value={u.userId}>
                        {u.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="r-role">Role</label>
                  <select id="r-role" name="role" required defaultValue="">
                    <option value="" disabled>
                      Choose...
                    </option>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="r-reason">Reason (required, audited)</label>
                  <input id="r-reason" name="reason" type="text" required maxLength={200} />
                </div>
                <button type="submit" className="danger">
                  Revoke role
                </button>
              </form>
            </details>
          </div>
        </section>
      ) : null}

      {isSysAdmin ? (
        <section className="panel" aria-labelledby="flags-h">
          <h2 id="flags-h" style={{ marginTop: 0 }}>
            Feature flags (SYSTEM_ADMIN)
          </h2>
          <p className="hint">
            Improvement automation stays disabled for Stage 1 baseline capture (DEC-007 /
            IC-S1-004). Changes are audited.
          </p>
          <div className="table-wrap" tabIndex={0}>
            <table className="data">
              <caption>Automation feature flags</caption>
              <thead>
                <tr>
                  <th scope="col">Flag</th>
                  <th scope="col">State</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((f) => (
                  <tr key={f.key}>
                    <td>
                      <code>{f.key}</code>
                      <br />
                      <span className="hint">{f.description}</span>
                    </td>
                    <td>
                      {f.enabled ? (
                        <span className="badge badge--warning">ENABLED</span>
                      ) : (
                        <span className="badge badge--success">disabled (safe)</span>
                      )}
                    </td>
                    <td>
                      <form action={setFlagAction} className="actions-row">
                        <input type="hidden" name="key" value={f.key} />
                        <input type="hidden" name="enabled" value={f.enabled ? 'false' : 'true'} />
                        <label className="sr-only" htmlFor={`flag-reason-${f.key}`}>
                          Reason
                        </label>
                        <input
                          id={`flag-reason-${f.key}`}
                          name="reason"
                          type="text"
                          required
                          maxLength={200}
                          placeholder="Reason (required)"
                          style={{ maxWidth: '14rem' }}
                        />
                        <button type="submit" className="secondary">
                          {f.enabled ? 'Disable' : 'Enable'}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {isHrConfig ? (
        <section className="panel" aria-labelledby="cal-h">
          <h2 id="cal-h" style={{ marginTop: 0 }}>
            Business calendar (HR Manager)
          </h2>
          <p className="hint">
            America/Jamaica. Publishing creates a new version and activates it; prior versions are
            retained (REQ-ADMIN-013). The seeded holidays are synthetic - the production list
            requires approval under DEC-027.
          </p>
          {calendars.length ? (
            <ul>
              {calendars.map((cal) => (
                <li key={cal.id}>
                  <strong>
                    {cal.name} v{cal.version}
                  </strong>{' '}
                  {cal.isActive ? <span className="badge badge--success">active</span> : null}{' '}
                  {cal.approvedAt ? (
                    <span className="badge badge--success">approved</span>
                  ) : (
                    <span className="badge badge--warning">unapproved</span>
                  )}{' '}
                  - {cal.holidays.length} holidays ({formatInstant(cal.createdAt)})
                  {cal.isActive && !cal.approvedAt ? (
                    <form action={approveCalendarAction} style={{ display: 'inline-block' }}>
                      <input type="hidden" name="calendarId" value={cal.id} />
                      <button type="submit" className="secondary">
                        Approve active version
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>No calendar configured.</p>
          )}
          <details className="action">
            <summary>Preview SLA impact of a candidate holiday list (nothing is applied)</summary>
            <form action={previewCalendarAction} className="stack">
              <div className="field">
                <label htmlFor="cal-preview">
                  Candidate holidays, one per line: YYYY-MM-DD,Label
                </label>
                <textarea id="cal-preview" name="holidays" rows={4} required />
              </div>
              <button type="submit">Preview impact</button>
            </form>
            {sp.preview ? (
              <p className="hint" role="status">
                {sp.preview}
              </p>
            ) : null}
          </details>
          <details className="action">
            <summary>Publish a new calendar version</summary>
            <form action={publishCalendarAction} className="stack">
              <div className="field">
                <label htmlFor="cal-name">Calendar name</label>
                <input
                  id="cal-name"
                  name="name"
                  type="text"
                  defaultValue="business-calendar"
                  maxLength={80}
                />
              </div>
              <div className="field">
                <label htmlFor="cal-holidays">Holidays, one per line: YYYY-MM-DD,Label</label>
                <textarea
                  id="cal-holidays"
                  name="holidays"
                  rows={6}
                  required
                  placeholder="2026-08-06,Independence Day"
                />
              </div>
              <div className="field">
                <label htmlFor="cal-reason">Reason (required, audited)</label>
                <input id="cal-reason" name="reason" type="text" required maxLength={200} />
              </div>
              <button type="submit">Publish and activate</button>
            </form>
          </details>
        </section>
      ) : null}

      {isHrConfig ? (
        <section className="panel" aria-labelledby="lists-h">
          <h2 id="lists-h" style={{ marginTop: 0 }}>
            Departments and locations (HR Manager)
          </h2>
          <dl className="kv">
            <dt>Departments</dt>
            <dd>{departments.map((d) => d.value).join(', ') || '-'}</dd>
            <dt>Locations</dt>
            <dd>{locations.map((l) => l.value).join(', ') || '-'}</dd>
          </dl>
          <details className="action">
            <summary>Add a value</summary>
            <form action={addConfigItemAction} className="stack">
              <div className="field">
                <label htmlFor="cl-kind">List</label>
                <select id="cl-kind" name="kind" defaultValue="DEPARTMENT">
                  <option value="DEPARTMENT">Department</option>
                  <option value="LOCATION">Location</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="cl-value">Value</label>
                <input id="cl-value" name="value" type="text" required maxLength={100} />
              </div>
              <button type="submit">Add</button>
            </form>
          </details>
        </section>
      ) : null}

      <section className="panel" aria-labelledby="int-h">
        <h2 id="int-h" style={{ marginTop: 0 }}>
          Integration status
        </h2>
        <div className="table-wrap" tabIndex={0}>
          <table className="data">
            <caption>
              All integrations are stubs; nothing is configured with live credentials
            </caption>
            <thead>
              <tr>
                <th scope="col">Integration</th>
                <th scope="col">Mode</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {integrations.map((i) => (
                <tr key={i.key}>
                  <td>{i.displayName}</td>
                  <td>
                    <span className="badge badge--neutral">{i.mode}</span>{' '}
                    {i.configured ? 'configured' : 'not configured'}
                  </td>
                  <td className="hint">{i.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
