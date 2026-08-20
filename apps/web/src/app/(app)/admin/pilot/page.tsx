import type { Metadata } from 'next';
import { ServiceError, getPilotOverview } from '@exit/db';
import { formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import {
  applyActivationAction,
  approveActivationAction,
  proposeActivationAction,
  suspendActivationAction,
} from './actions';
import { countOf, humanize } from '@/lib/text';

export const metadata: Metadata = { title: 'Pilot Readiness' };
export const dynamic = 'force-dynamic';

export default async function PilotPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;
  let data: Awaited<ReturnType<typeof getPilotOverview>>;
  try {
    data = await getPilotOverview(actor);
  } catch (e) {
    if (e instanceof ServiceError)
      return (
        <>
          <h1>Access Restricted</h1>
          <p className="panel">Pilot readiness requires an authorized role.</p>
        </>
      );
    throw e;
  }
  const current = data.records.find((r) => !r.supersededAt);

  return (
    <>
      <h1>
        Pilot Activation and Readiness{' '}
        <span
          className={`badge ${
            data.state === 'PILOT_ACTIVE'
              ? 'badge--success'
              : data.state === 'SUSPENDED'
                ? 'badge--danger'
                : 'badge--info'
          }`}
        >
          {humanize(data.state)}
        </span>
      </h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        PILOT_ACTIVE requires every mandatory gate to pass plus HR Manager and System Administrator
        approval by two different people (DEC-042). Activation never processes BASELINE cases
        retroactively; suspension stops new automated integration work at once.
      </p>

      <section className="panel" aria-labelledby="gates-h">
        <h2 id="gates-h" style={{ marginTop: 0 }}>
          Readiness Gates ({countOf(data.blockers.length, 'mandatory blocker')})
        </h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {data.gates.map((g) => (
            <li key={g.key} style={{ marginBottom: '0.35rem' }}>
              <span
                className={`badge ${g.ok ? 'badge--success' : g.mandatory ? 'badge--danger' : 'badge--warning'}`}
              >
                {g.ok ? 'Pass' : g.mandatory ? 'Blocked' : 'Advisory'}
              </span>{' '}
              <strong>{g.label}</strong> - {g.detail}
            </li>
          ))}
        </ul>
      </section>

      {current ? (
        <section className="panel" aria-labelledby="current-h">
          <h2 id="current-h" style={{ marginTop: 0 }}>
            Current Activation Record: {humanize(current.state)} ({humanize(current.cohort)})
          </h2>
          <p className="hint">
            Created {formatInstant(current.createdAt)} - checksum{' '}
            <code>{current.checksum.slice(0, 16)}...</code> - HR approval{' '}
            {current.hrApprovedAt ? formatInstant(current.hrApprovedAt) : 'pending'} - technical
            approval {current.adminApprovedAt ? formatInstant(current.adminApprovedAt) : 'pending'}
            {current.activatedAt ? ` - applied ${formatInstant(current.activatedAt)}` : ''}
            {current.suspendedAt ? ` - SUSPENDED ${formatInstant(current.suspendedAt)}` : ''}
          </p>
          <p className="hint">Rollback plan: {current.rollbackPlan}</p>
          {data.canHrApprove && !current.hrApprovedAt ? (
            <form action={approveActivationAction} style={{ display: 'inline-block' }}>
              <input type="hidden" name="id" value={current.id} />
              <input type="hidden" name="role" value="hr" />
              <button type="submit">Approve (HR Manager)</button>
            </form>
          ) : null}{' '}
          {data.canAdminApprove && !current.adminApprovedAt ? (
            <form action={approveActivationAction} style={{ display: 'inline-block' }}>
              <input type="hidden" name="id" value={current.id} />
              <input type="hidden" name="role" value="admin" />
              <button type="submit">Approve (System Administrator)</button>
            </form>
          ) : null}{' '}
          {data.canManage && !current.activatedAt ? (
            <form action={applyActivationAction} style={{ display: 'inline-block' }}>
              <input type="hidden" name="id" value={current.id} />
              <button type="submit">Apply activation (gates re-checked)</button>
            </form>
          ) : null}
        </section>
      ) : null}

      {data.canManage ? (
        <>
          <details className="action">
            <summary>Propose a new activation state</summary>
            <form action={proposeActivationAction}>
              <label htmlFor="pa-state">Target State</label>
              <select id="pa-state" name="targetState" required>
                <option value="TEST_ONLY">Test only</option>
                <option value="TRAINING_ENABLED">Training enabled</option>
                <option value="PILOT_READY">Pilot ready</option>
                <option value="PILOT_ACTIVE">Pilot active</option>
                <option value="DISABLED">Disabled</option>
              </select>
              <label htmlFor="pa-cohort">Cohort</label>
              <select id="pa-cohort" name="cohort">
                <option value="PILOT">Pilot</option>
                <option value="POST_ROLLOUT">Post rollout</option>
                <option value="NONE">None</option>
              </select>
              <label htmlFor="pa-dept">Scope: Departments (Comma-separated; Empty = All)</label>
              <input id="pa-dept" name="departments" maxLength={300} />
              <label htmlFor="pa-loc">Scope: Locations</label>
              <input id="pa-loc" name="locations" maxLength={300} />
              <label htmlFor="pa-types">Scope: Departure Types</label>
              <input id="pa-types" name="departureTypes" maxLength={300} />
              <label htmlFor="pa-max">Maximum Active Pilot Cases</label>
              <input id="pa-max" name="maxActiveCases" type="number" min={1} max={500} />
              <label htmlFor="pa-int">Enabled Integrations (Comma-separated)</label>
              <input id="pa-int" name="enabledIntegrations" maxLength={300} />
              <label htmlFor="pa-cond">Conditions</label>
              <textarea id="pa-cond" name="conditions" rows={2} maxLength={2000} />
              <label htmlFor="pa-rb">Rollback Plan (Required)</label>
              <textarea id="pa-rb" name="rollbackPlan" rows={3} required maxLength={4000} />
              <button type="submit">Record activation proposal</button>
            </form>
          </details>
          <details className="action">
            <summary>Suspend (stops new automated integration work)</summary>
            <form action={suspendActivationAction}>
              <label htmlFor="sus-reason">Reason (Required, Audited)</label>
              <textarea id="sus-reason" name="reason" rows={2} required maxLength={500} />
              <button type="submit">Suspend now</button>
            </form>
          </details>
        </>
      ) : null}
    </>
  );
}
