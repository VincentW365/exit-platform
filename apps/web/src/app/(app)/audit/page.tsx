import type { Metadata } from 'next';
import { Fragment } from 'react';
import { redirect } from 'next/navigation';
import {
  auditCategoryOptions,
  listGlobalAudit,
  listActiveUsers,
  type GlobalAuditFilter,
} from '@exit/db';
import {
  beforeAfterPairs,
  can,
  formatInstant,
  humanizeAuditEvent,
  redactAuditValue,
  type AuditCategory,
} from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { humanize } from '@/lib/text';
import { Chip } from '@/components/patterns';

export const metadata: Metadata = { title: 'Audit Center' };
export const dynamic = 'force-dynamic';

const CATEGORY_BADGE: Record<string, string> = {
  SECURITY: 'badge--danger',
  ASSIGNMENT: 'badge--info',
  APPROVAL: 'badge--success',
  EXCEPTION: 'badge--warning',
};

function parseDate(v: string | undefined, endOfDay = false): Date | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default async function AuditCentrePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  if (!can(actor, 'audit.viewGlobal') && !can(actor, 'audit.viewTechnical'))
    redirect('/unauthorized');
  const sp = await searchParams;
  const technicalOnly = !can(actor, 'audit.viewGlobal');

  const filter: GlobalAuditFilter = {
    from: parseDate(sp.from),
    to: parseDate(sp.to, true),
    actorId: sp.actor || undefined,
    category: (sp.category as AuditCategory) || undefined,
    eventType: sp.eventType || undefined,
    caseNumber: sp.caseNumber || undefined,
    result: (sp.result as GlobalAuditFilter['result']) || undefined,
    recordPurpose: (sp.purpose as GlobalAuditFilter['recordPurpose']) || undefined,
    cursor: sp.cursor || undefined,
    take: 50,
  };
  const [{ rows, nextCursor, summary }, users] = await Promise.all([
    listGlobalAudit(actor, filter),
    can(actor, 'audit.viewGlobal') ? listActiveUsers().catch(() => []) : Promise.resolve([]),
  ]);

  const olderHref = (() => {
    if (!nextCursor) return null;
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== 'cursor') p.set(k, v);
    p.set('cursor', nextCursor);
    return `/audit?${p.toString()}`;
  })();
  const exportHref = (() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== 'cursor') p.set(k, v);
    return `/api/audit-export?${p.toString()}`;
  })();

  return (
    <>
      <h1>Audit Center</h1>
      <p className="hint" role="note">
        The complete, append-only business audit trail
        {technicalOnly
          ? ' - technical events only (identity, configuration, system); HR case content is never shown here.'
          : ' - every case, assignment, approval and security event with who, what, why and when.'}
      </p>

      <div className="stat-grid" style={{ marginBottom: '1rem' }}>
        <div className="stat">
          <span className="stat__value tabular-nums">{summary.today}</span>
          <span className="badge badge--info">Events today</span>
        </div>
        <div className="stat">
          <span className="stat__value tabular-nums">{summary.assignments}</span>
          <span className="badge badge--info">Assignment changes</span>
        </div>
        <div className="stat">
          <span className="stat__value tabular-nums">{summary.approvals}</span>
          <span className="badge badge--success">Approvals</span>
        </div>
        <div className="stat">
          <span className="stat__value tabular-nums">{summary.security}</span>
          <span className="badge badge--danger">Security events</span>
        </div>
        <div className="stat">
          <span className="stat__value tabular-nums">{summary.denied}</span>
          <span className="badge badge--warning">Denied attempts</span>
        </div>
      </div>

      <form method="get" className="panel filter-toolbar" aria-label="Audit filters">
        <div className="field" style={{ maxWidth: '10rem' }}>
          <label htmlFor="af-from">From (Date)</label>
          <input id="af-from" type="date" name="from" defaultValue={sp.from ?? ''} />
        </div>
        <div className="field" style={{ maxWidth: '10rem' }}>
          <label htmlFor="af-to">To (Date)</label>
          <input id="af-to" type="date" name="to" defaultValue={sp.to ?? ''} />
        </div>
        <div className="field" style={{ maxWidth: '12rem' }}>
          <label htmlFor="af-category">Category</label>
          <select id="af-category" name="category" defaultValue={sp.category ?? ''}>
            <option value="">Any</option>
            {auditCategoryOptions().map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {!technicalOnly ? (
          <div className="field" style={{ maxWidth: '13rem' }}>
            <label htmlFor="af-actor">Actor</label>
            <select id="af-actor" name="actor" defaultValue={sp.actor ?? ''}>
              <option value="">Any</option>
              {users.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {!technicalOnly ? (
          <div className="field" style={{ maxWidth: '11rem' }}>
            <label htmlFor="af-case">Case Number</label>
            <input
              id="af-case"
              name="caseNumber"
              defaultValue={sp.caseNumber ?? ''}
              maxLength={20}
            />
          </div>
        ) : null}
        <div className="field" style={{ maxWidth: '10rem' }}>
          <label htmlFor="af-result">Outcome</label>
          <select id="af-result" name="result" defaultValue={sp.result ?? ''}>
            <option value="">Any</option>
            <option value="SUCCESS">Success</option>
            <option value="DENIED">Denied</option>
            <option value="FAILURE">Failure</option>
          </select>
        </div>
        <div className="field" style={{ maxWidth: '11rem' }}>
          <label htmlFor="af-purpose">Record Purpose</label>
          <select id="af-purpose" name="purpose" defaultValue={sp.purpose ?? ''}>
            <option value="">Any</option>
            <option value="OPERATIONAL">Operational</option>
            <option value="TRAINING">Training</option>
            <option value="TEST">Test</option>
          </select>
        </div>
        <div className="field" style={{ maxWidth: '14rem' }}>
          <label htmlFor="a-type">Event Type (Exact)</label>
          <input id="a-type" name="eventType" defaultValue={sp.eventType ?? ''} maxLength={60} />
        </div>
        <div style={{ alignSelf: 'flex-end', display: 'flex', gap: '0.5rem' }}>
          <button type="submit">Filter</button>
          {can(actor, 'audit.export') ? (
            <a className="button secondary" href={exportHref}>
              Export CSV (audited)
            </a>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="panel empty">
          <p>
            <strong>No audit events match these filters.</strong>
          </p>
          <p className="hint">Widen the date range or clear a filter to see more history.</p>
        </div>
      ) : (
        <div className="panel" style={{ overflowX: 'auto' }} tabIndex={0}>
          <table className="table-sticky">
            <caption className="visually-hidden">Audit events</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Category</th>
                <th scope="col">What happened</th>
                <th scope="col">Case</th>
                <th scope="col">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="tabular-nums">{formatInstant(e.occurredAt)}</td>
                  <td>
                    <span className={`badge ${CATEGORY_BADGE[e.category] ?? 'badge--neutral'}`}>
                      {humanize(e.category)}
                    </span>
                  </td>
                  <td>
                    {e.minimized ? (
                      <em>Restricted-case event - content requires explicit assignment.</em>
                    ) : (
                      <>
                        {humanizeAuditEvent({
                          eventType: e.eventType as never,
                          result: e.result as never,
                          actorDisplayName: e.actorDisplayName,
                          actorType: e.actorType,
                          metadata: e.metadata,
                        })}{' '}
                        {/* Whether a person did this or the workflow did is
                            the first question of any audit review. */}
                        {e.actorType === 'SYSTEM' ? (
                          <Chip tone="info">Automated</Chip>
                        ) : (
                          <Chip>By a person</Chip>
                        )}
                        {/* A change is best read as a change, not buried in a
                            details panel. */}
                        {beforeAfterPairs(e.metadata).map((pair) => (
                          <span key={`inline-${pair.label}`} className="activity__change">
                            <span className="label">{pair.label}</span>
                            <s>{pair.before}</s>
                            <span aria-hidden>&rarr;</span>
                            <strong>{pair.after}</strong>
                          </span>
                        ))}
                        <details className="action" style={{ marginTop: '0.3rem' }}>
                          <summary>Details</summary>
                          <dl className="kv" style={{ marginTop: '0.4rem' }}>
                            <dt>Event</dt>
                            <dd>
                              <code>{e.eventType}</code>
                            </dd>
                            <dt>Object</dt>
                            <dd>
                              {e.objectType} <code>{e.objectId.slice(0, 8)}</code>
                            </dd>
                            <dt>Roles</dt>
                            <dd>{e.effectiveRoles.join(', ') || '-'}</dd>
                            <dt>Correlation</dt>
                            <dd>
                              <code>{e.correlationId.slice(0, 8)}</code>
                            </dd>
                            {beforeAfterPairs(e.metadata).map((p) => (
                              <Fragment key={`ba-${p.label}`}>
                                <dt>{p.label} (before → after)</dt>
                                <dd>
                                  {p.before} → {p.after}
                                </dd>
                              </Fragment>
                            ))}
                            {Object.entries(e.metadata).map(([k, v]) => (
                              <Fragment key={`md-${k}`}>
                                <dt>{k}</dt>
                                <dd>{redactAuditValue(k, v)}</dd>
                              </Fragment>
                            ))}
                          </dl>
                        </details>
                      </>
                    )}
                  </td>
                  <td>{e.caseNumber ?? '-'}</td>
                  <td>
                    <span
                      className={`badge ${
                        e.result === 'SUCCESS'
                          ? 'badge--success'
                          : e.result === 'RESTRICTED'
                            ? 'badge--neutral'
                            : 'badge--danger'
                      }`}
                    >
                      {humanize(e.result)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {olderHref ? (
            <p style={{ marginTop: '0.75rem' }}>
              <a className="button secondary" href={olderHref}>
                Older events →
              </a>
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
