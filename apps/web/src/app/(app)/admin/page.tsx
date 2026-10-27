import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ROLES, can, formatInstant } from '@exit/domain';
import { listActiveUsers, listCalendars, listConfigItems, listFlags } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { Chip, SectionHead } from '@/components/patterns';
import { AdminIcon, BuildingIcon, CalendarIcon, FlowIcon, ShieldIcon } from '@/components/icons';
import { countOf } from '@/lib/text';
import {
  addConfigItemAction,
  approveCalendarAction,
  grantRoleAction,
  previewCalendarAction,
  publishCalendarAction,
  revokeRoleAction,
  setFlagAction,
} from './actions';
import { roleLabel, roleList } from '@/lib/text';

export const metadata: Metadata = { title: 'Administration' };
export const dynamic = 'force-dynamic';

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; ok?: string; preview?: string }>;
}) {
  const { actor } = await requireAuth();
  // Both gates are HR Manager capabilities under DEC-063; they stay separate
  // because each section below mirrors its own page's permission.
  const canAdminRoles = can(actor, 'admin.roles');
  const isHrConfig = can(actor, 'admin.calendar');
  if (!canAdminRoles && !isHrConfig) redirect('/unauthorized');
  const sp = await searchParams;

  const [users, flags] = await Promise.all([
    canAdminRoles ? listActiveUsers() : Promise.resolve([]),
    listFlags(actor).catch(() => []),
  ]);
  const calendars = isHrConfig ? await listCalendars(actor) : [];
  const departments = isHrConfig ? await listConfigItems('DEPARTMENT') : [];
  const locations = isHrConfig ? await listConfigItems('LOCATION') : [];

  // Each entry mirrors the target page's OWN permission gate, so the hub
  // never offers a door the signed-in role cannot open (owner, 2026-08-25:
  // a link that lands on "Access Restricted" is a dead end, not a feature).
  const hubLinks: Array<{ href: string; label: string; kind: 'business' | 'technical' }> = [
    ...(can(actor, 'admin.organization') || can(actor, 'org.view')
      ? [
          {
            href: '/admin/organization',
            label: 'Organization and Assignment Mapping',
            kind: 'business' as const,
          },
        ]
      : []),
    ...(can(actor, 'workflowDef.view')
      ? [{ href: '/admin/workflows', label: 'Workflow Definitions', kind: 'business' as const }]
      : []),
    ...(can(actor, 'template.view')
      ? [{ href: '/admin/templates', label: 'Document Templates', kind: 'business' as const }]
      : []),
    ...(can(actor, 'baseline.viewDashboard')
      ? [{ href: '/baseline', label: 'Baseline Dashboard', kind: 'business' as const }]
      : []),
    ...(can(actor, 'reasons.manage')
      ? [{ href: '/admin/reasons', label: 'Reason Taxonomy', kind: 'business' as const }]
      : []),
    ...(can(actor, 'recipients.viewBusiness')
      ? [{ href: '/admin/recipients', label: 'Recipient Directory', kind: 'business' as const }]
      : []),
    ...(can(actor, 'notifTemplate.view')
      ? [
          {
            href: '/admin/notification-templates',
            label: 'Notification Templates',
            kind: 'business' as const,
          },
        ]
      : []),
    ...(can(actor, 'reports.view')
      ? [{ href: '/reports', label: 'Reporting Center', kind: 'business' as const }]
      : []),
    ...(can(actor, 'pilot.view')
      ? [
          {
            href: '/admin/pilot',
            label: 'Pilot Readiness and Activation',
            kind: 'business' as const,
          },
        ]
      : []),
    ...(can(actor, 'privacy.operate')
      ? [{ href: '/admin/privacy', label: 'Privacy and Retention', kind: 'business' as const }]
      : []),
    { href: '/continuity', label: 'Business Continuity', kind: 'business' },
    ...(can(actor, 'directory.viewSync')
      ? [
          {
            href: '/admin/directory-sync',
            label: 'Directory Synchronization Log',
            kind: 'technical' as const,
          },
        ]
      : []),
    ...(can(actor, 'admin.system')
      ? [
          {
            href: '/admin/system',
            label: 'System Administration',
            kind: 'technical' as const,
          },
        ]
      : []),
    ...(can(actor, 'health.view')
      ? [{ href: '/admin/health', label: 'Integration Health', kind: 'technical' as const }]
      : []),
    ...(can(actor, 'notifications.routing')
      ? [{ href: '/admin/email-routing', label: 'Email Routing', kind: 'business' as const }]
      : []),
    ...(can(actor, 'outbox.view')
      ? [
          { href: '/admin/email-log', label: 'Email Log', kind: 'technical' as const },
          { href: '/admin/outbox', label: 'Email Delivery Status', kind: 'technical' as const },
        ]
      : []),
    { href: '/dev/mailbox', label: 'Captured Email', kind: 'technical' },
    { href: '/support', label: 'Support and Incidents', kind: 'technical' },
  ];

  return (
    <div className="exit-center">
      <div className="page-head">
        <div className="page-head__text">
          <h1 className="page-title">Administration Center</h1>
          <p className="page-lede">
            HR configuration, user access and platform settings, for the HR Manager.
          </p>
        </div>
        {can(actor, 'admin.system') ? (
          <div className="page-head__actions">
            <Link className="button" href="/admin/system">
              System Administration
            </Link>
          </div>
        ) : null}
      </div>
      <Feedback err={sp.err} ok={sp.ok} />

      <section className="panel" aria-labelledby="hub-h">
        <SectionHead id="hub-h" icon={<AdminIcon />} title="Administration Areas" />
        {/* Two labelled groups instead of a "(technical)" suffix repeated on
            every second button (owner request, 2026-08-18). */}
        <h3>HR Configuration</h3>
        <div className="actions-row">
          {hubLinks
            .filter((l) => l.kind === 'business')
            .map((l) => (
              <a key={l.href} className="button secondary" href={l.href}>
                {l.label}
              </a>
            ))}
        </div>
        <h3>Platform Administration</h3>
        <div className="actions-row">
          {hubLinks
            .filter((l) => l.kind === 'technical')
            .map((l) => (
              <a key={l.href} className="button secondary" href={l.href}>
                {l.label}
              </a>
            ))}
        </div>
      </section>

      {canAdminRoles ? (
        <section className="panel" aria-labelledby="roles-h">
          <SectionHead
            id="roles-h"
            icon={<ShieldIcon />}
            tone="info"
            title="Users and Roles"
            description="Nobody can change their own role. Every change is recorded."
            aside={<Chip tone="neutral">{countOf(users.length, 'active user')}</Chip>}
          />
          <div className="table-wrap" tabIndex={0}>
            <table className="data">
              <caption className="sr-only">Active users and their roles</caption>
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
                    <td>{roleList(u.roles, '-')}</td>
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
                        {roleLabel(r)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="g-reason">Reason (recorded)</label>
                  <input id="g-reason" name="reason" type="text" required maxLength={200} />
                </div>
                <button type="submit">Grant role</button>
              </form>
            </details>
            <details className="action">
              <summary className="summary--danger">Revoke a role</summary>
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
                        {roleLabel(r)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="r-reason">Reason (recorded)</label>
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

      {canAdminRoles ? (
        <section className="panel" aria-labelledby="flags-h">
          <SectionHead
            id="flags-h"
            icon={<FlowIcon />}
            tone="info"
            title="Feature Flags"
            description="What the platform carries out on its own. Every change is recorded."
            aside={
              <Chip tone={flags.some((f) => f.enabled) ? 'done' : 'neutral'}>
                {flags.filter((f) => f.enabled).length} of {flags.length} on
              </Chip>
            }
          />
          <div className="table-wrap" tabIndex={0}>
            <table className="data">
              <caption className="sr-only">Automation feature flags</caption>
              <thead>
                <tr>
                  <th scope="col">Automation</th>
                  <th scope="col">State</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((f) => (
                  <tr key={f.key}>
                    <td>
                      {f.description}
                      <br />
                      <span className="meta">{f.key}</span>
                    </td>
                    <td>
                      {f.enabled ? (
                        <span className="badge badge--success">On</span>
                      ) : (
                        <span className="badge badge--neutral">Off</span>
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
          <SectionHead
            id="cal-h"
            icon={<CalendarIcon />}
            tone="pending"
            title="Business Calendar"
            description="Company holidays, so due dates skip non-working days. Publishing makes a new version active and keeps the earlier ones."
          />
          {calendars.length ? (
            <ul>
              {calendars.map((cal) => (
                <li key={cal.id}>
                  <strong>
                    {cal.name} v{cal.version}
                  </strong>{' '}
                  {cal.isActive ? <span className="badge badge--success">Active</span> : null}{' '}
                  {cal.approvedAt ? (
                    <span className="badge badge--success">Approved</span>
                  ) : (
                    <span className="badge badge--warning">Awaiting approval</span>
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
            <p className="meta">
              No working calendar yet. Add the company holidays so due dates skip non-working days.
            </p>
          )}
          <details className="action">
            <summary>Preview the effect of a holiday list (nothing is applied)</summary>
            <form action={previewCalendarAction} className="stack">
              <div className="field">
                <label htmlFor="cal-preview">Holidays, one per line (YYYY-MM-DD,Label)</label>
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
                <label htmlFor="cal-name">Calendar Name</label>
                <input
                  id="cal-name"
                  name="name"
                  type="text"
                  defaultValue="business-calendar"
                  maxLength={80}
                />
              </div>
              <div className="field">
                <label htmlFor="cal-holidays">Holidays, one per line (YYYY-MM-DD,Label)</label>
                <textarea
                  id="cal-holidays"
                  name="holidays"
                  rows={6}
                  required
                  placeholder="2026-08-06,Independence Day"
                />
              </div>
              <div className="field">
                <label htmlFor="cal-reason">Reason (recorded)</label>
                <input id="cal-reason" name="reason" type="text" required maxLength={200} />
              </div>
              <button type="submit">Publish and activate</button>
            </form>
          </details>
        </section>
      ) : null}

      {isHrConfig ? (
        <section className="panel" aria-labelledby="lists-h">
          <SectionHead
            id="lists-h"
            icon={<BuildingIcon />}
            tone="info"
            title="Departments and Locations"
            description="The lists offered when a case is created."
          />
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
    </div>
  );
}
