import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServiceError, getClearanceView } from '@exit/db';
import { formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { CaseNav } from '../CaseNav';
import {
  approveClearanceAction,
  requestClearanceAction,
  resolveExceptionAction,
  returnClearanceAction,
} from './actions';

export const metadata: Metadata = { title: 'Clearance' };
export const dynamic = 'force-dynamic';

const SEV_BADGE: Record<string, string> = {
  INFO: 'badge--neutral',
  WARNING: 'badge--warning',
  HIGH: 'badge--warning',
  CRITICAL: 'badge--danger',
};

export default async function CaseClearancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;

  let data: Awaited<ReturnType<typeof getClearanceView>>;
  try {
    data = await getClearanceView(actor, id);
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'NOT_FOUND') notFound();
    if (e instanceof ServiceError && e.code === 'FORBIDDEN')
      return (
        <>
          <h1>Access restricted</h1>
          <p className="panel">This area requires full case access.</p>
        </>
      );
    throw e;
  }

  const openExceptions = data.exceptions.filter((e) => e.status === 'OPEN');

  return (
    <>
      <h1>
        Final clearance - {data.caseNumber} ({data.caseStatus})
      </h1>
      <CaseNav caseId={id} active="clearance" />
      <Feedback err={sp.err} ok={sp.ok} />

      {data.readiness ? (
        <section className="panel" aria-labelledby="gate-h">
          <h2 id="gate-h" style={{ marginTop: 0 }}>
            Clearance gate{' '}
            {data.readiness.ok ? (
              <span className="badge badge--success">ALL CONDITIONS MET</span>
            ) : (
              <span className="badge badge--warning">NOT READY</span>
            )}
          </h2>
          {(() => {
            // Directive 6.2 (Z): a concise decision screen - conditions
            // grouped by responsible area, unresolved groups first and
            // prominent, satisfied groups collapsed.
            const GROUPS = [
              'HR',
              'Manager',
              'IT',
              'Finance',
              'Assets',
              'Documents',
              'Handover',
              'Security',
            ] as const;
            const shown = data.readiness!.items.filter((i) => i.key !== 'requiredTasks');
            const grouped = GROUPS.map((g) => ({
              group: g,
              items: shown.filter((i) => i.group === g),
            })).filter((g) => g.items.length > 0);
            const unresolved = grouped.filter((g) => g.items.some((i) => !i.ok));
            const satisfied = grouped.filter((g) => g.items.every((i) => i.ok));
            return (
              <>
                {unresolved.length === 0 ? (
                  <p className="ok-summary" role="status">
                    Every condition is satisfied - the case is ready for the final decision.
                  </p>
                ) : (
                  unresolved.map((g) => (
                    <div key={g.group} style={{ marginBottom: '0.6rem' }}>
                      <h3 style={{ margin: '0 0 0.25rem' }}>{g.group}</h3>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {g.items.map((i) => (
                          <li key={i.key} style={{ marginBottom: '0.3rem' }}>
                            <span className={`badge ${i.ok ? 'badge--success' : 'badge--danger'}`}>
                              {i.ok ? 'MET' : 'BLOCKED'}
                            </span>{' '}
                            <strong>{i.label}</strong> - {i.detail}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
                {satisfied.length > 0 ? (
                  <details className="action">
                    <summary>
                      {satisfied.length} satisfied group(s):{' '}
                      {satisfied.map((g) => g.group).join(', ')}
                    </summary>
                    {satisfied.map((g) => (
                      <div key={g.group} style={{ marginBottom: '0.4rem' }}>
                        <h3 style={{ margin: '0.4rem 0 0.2rem' }}>{g.group}</h3>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                          {g.items.map((i) => (
                            <li key={i.key}>
                              <span className="badge badge--success">MET</span>{' '}
                              <strong>{i.label}</strong> <span className="hint">- {i.detail}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </details>
                ) : null}
              </>
            );
          })()}
          <p className="hint">
            Exit-survey status: {data.surveyStatus}. Survey completion is voluntary and NEVER blocks
            clearance.
          </p>
        </section>
      ) : (
        <p className="panel">No live workflow exists; the gate applies to active workflows.</p>
      )}

      <details className="action" style={{ marginBottom: '1rem' }}>
        <summary>Notification status ({data.notifications.length})</summary>
        {data.notifications.length === 0 ? (
          <p>No notification records.</p>
        ) : (
          <ul>
            {data.notifications.map((n) => (
              <li key={n.id}>
                {n.notificationType}: {n.status}
                {n.manualSentAt ? ` (manually sent ${formatInstant(n.manualSentAt)})` : ''}
              </li>
            ))}
          </ul>
        )}
      </details>

      <section className="panel" aria-labelledby="exc-h">
        <h2 id="exc-h" style={{ marginTop: 0 }}>
          Exceptions ({openExceptions.length} open)
        </h2>
        {data.exceptions.length === 0 ? <p>No exceptions recorded.</p> : null}
        {openExceptions.map((e) => (
          <div key={e.id} style={{ marginBottom: '0.6rem' }}>
            <span className={`badge ${SEV_BADGE[e.severity] ?? 'badge--neutral'}`}>
              {e.severity}
            </span>{' '}
            <span className={`badge ${e.status === 'OPEN' ? 'badge--warning' : 'badge--success'}`}>
              {e.status}
            </span>{' '}
            <strong>{e.title}</strong>
            {e.detail ? <span className="hint"> - {e.detail}</span> : null}
            {e.resolution ? (
              <p className="hint">
                Resolved{e.securityExceptionApproved ? ' as APPROVED SECURITY EXCEPTION' : ''}:{' '}
                {e.resolution}
              </p>
            ) : null}
            {e.status === 'OPEN' ? (
              <details className="action">
                <summary>Resolve</summary>
                <form action={resolveExceptionAction}>
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="exceptionId" value={e.id} />
                  <label htmlFor={`res-${e.id}`}>Resolution (required, audited)</label>
                  <textarea
                    id={`res-${e.id}`}
                    name="resolution"
                    required
                    rows={2}
                    maxLength={1000}
                  />
                  {e.severity === 'CRITICAL' ? (
                    <label>
                      <input type="checkbox" name="securityException" /> Approve as a security
                      exception (HR Manager; keeps clearance possible despite incomplete access
                      removal)
                    </label>
                  ) : null}
                  <button type="submit">Resolve exception</button>
                </form>
              </details>
            ) : null}
          </div>
        ))}
        {data.exceptions.length > openExceptions.length ? (
          <details className="action">
            <summary>
              {data.exceptions.length - openExceptions.length} resolved exception(s)
            </summary>
            {data.exceptions
              .filter((e) => e.status !== 'OPEN')
              .map((e) => (
                <div key={e.id} style={{ marginBottom: '0.5rem' }}>
                  <span className={`badge ${SEV_BADGE[e.severity] ?? 'badge--neutral'}`}>
                    {e.severity}
                  </span>{' '}
                  <span className="badge badge--success">{e.status}</span>{' '}
                  <strong>{e.title}</strong>
                  {e.resolution ? (
                    <p className="hint">
                      Resolved{e.securityExceptionApproved ? ' as APPROVED SECURITY EXCEPTION' : ''}
                      : {e.resolution}
                    </p>
                  ) : null}
                </div>
              ))}
          </details>
        ) : null}
      </section>

      {data.canRequest ? (
        <form action={requestClearanceAction} style={{ marginBottom: '1rem' }}>
          <input type="hidden" name="caseId" value={id} />
          <button type="submit">Request clearance review</button>
        </form>
      ) : null}
      {data.canApprove ? (
        <details className="action" open>
          <summary>Approve final clearance (HR Manager)</summary>
          <form action={approveClearanceAction}>
            <input type="hidden" name="caseId" value={id} />
            <p>
              Approval re-verifies every gate condition, then completes the case and workflow and
              writes an immutable clearance record (actor, snapshot, checksum, approved exceptions).
              This administrative approval is not a qualified or advanced electronic signature.
            </p>
            <button type="submit">Approve final clearance</button>
          </form>
        </details>
      ) : null}
      {data.canReturn ? (
        <details className="action">
          <summary>Return to active (outstanding work found)</summary>
          <form action={returnClearanceAction}>
            <input type="hidden" name="caseId" value={id} />
            <label htmlFor="ret-reason">Reason (required, audited)</label>
            <textarea id="ret-reason" name="reason" required rows={2} maxLength={500} />
            <button type="submit">Return to active</button>
          </form>
        </details>
      ) : null}

      {data.clearanceRecords.length > 0 ? (
        <section className="panel" aria-labelledby="rec-h">
          <h2 id="rec-h" style={{ marginTop: 0 }}>
            Clearance records (immutable)
          </h2>
          {data.clearanceRecords.map((r) => (
            <p key={r.id}>
              {r.decision} by {r.actorDisplayName} ({r.actorRole}) at {formatInstant(r.createdAt)} -
              workflow v{r.workflowVersion} - checksum <code>{r.checksum.slice(0, 16)}...</code>
            </p>
          ))}
        </section>
      ) : null}
    </>
  );
}
