import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServiceError, getAssignmentPlan } from '@exit/db';
import { formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { CaseNav } from '../CaseNav';
import { Feedback } from '@/components/ui';
import { SubmitButton } from '@/components/SubmitButton';
import {
  assignOfficerAction,
  confirmPlanAction,
  overrideManagerAction,
  refreshManagerAction,
} from './actions';

export const metadata: Metadata = { title: 'Assignment plan' };
export const dynamic = 'force-dynamic';

const STATE_BADGE: Record<string, string> = {
  DIRECTORY: 'badge--info',
  OVERRIDE: 'badge--warning',
  MANUAL: 'badge--neutral',
};

export default async function AssignmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;

  let plan: Awaited<ReturnType<typeof getAssignmentPlan>>;
  try {
    plan = await getAssignmentPlan(actor, id);
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'NOT_FOUND') notFound();
    if (e instanceof ServiceError && e.code === 'FORBIDDEN') {
      return (
        <>
          <h1>Access restricted</h1>
          <p className="panel">The assignment plan requires case access.</p>
        </>
      );
    }
    throw e;
  }
  const m = plan.management;
  const preActivation = ['DRAFT', 'PENDING_HR_REVIEW', 'APPROVED'].includes(plan.status);

  return (
    <>
      <h1>{plan.caseNumber} - Offboarding assignment plan</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <CaseNav caseId={id} active="assignment" />

      {plan.blockers.length > 0 && preActivation ? (
        <div className="banner-baseline" role="status">
          <strong>Before activation:</strong>
          <ul style={{ margin: '0.25rem 0 0 1.1rem' }}>
            {plan.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="panel" aria-labelledby="emp-h">
        <h2 id="emp-h">Employee</h2>
        <dl className="kv">
          <dt>Name</dt>
          <dd>
            {plan.employee.displayName} ({plan.employee.sourceId})
          </dd>
          <dt>Position</dt>
          <dd>{plan.employee.jobTitle ?? '-'}</dd>
          <dt>Department / location</dt>
          <dd>
            {plan.employee.department} / {plan.employee.location}
            {plan.employee.division ? ` (division: ${plan.employee.division})` : ''}
          </dd>
          <dt>Employment status</dt>
          <dd>
            {plan.employee.employmentActive === null
              ? 'not recorded'
              : plan.employee.employmentActive
                ? 'Active'
                : 'Inactive'}
          </dd>
          <dt>Hierarchy source</dt>
          <dd>
            {plan.employee.sourceSystem}
            {plan.employee.lastSyncedAt
              ? ` - last synchronized ${formatInstant(plan.employee.lastSyncedAt)}`
              : ' - never synchronized'}
          </dd>
        </dl>
      </section>

      <section className="panel" aria-labelledby="mgmt-h">
        <h2 id="mgmt-h">Management routing</h2>
        {m.changeFlaggedAt ? (
          <p className="banner-restricted" role="alert">
            The directory manager changed after confirmation ({formatInstant(m.changeFlaggedAt)}).
            Review and re-derive or override, then re-confirm below.
          </p>
        ) : null}
        <dl className="kv">
          <dt>Direct manager (directory)</dt>
          <dd>
            {m.managerName ?? 'NOT RECORDED'}
            {m.managerJobTitle ? ` - ${m.managerJobTitle}` : ''}
            {m.managerSource ? (
              <>
                {' '}
                <span className={`badge ${STATE_BADGE[m.managerSource] ?? 'badge--neutral'}`}>
                  {m.managerSource}
                </span>
              </>
            ) : null}
          </dd>
          <dt>Second-level manager</dt>
          <dd>{m.secondLevelManagerName ?? '-'}</dd>
          <dt>Receives manager tasks</dt>
          <dd>
            {m.managerUser ? (
              <>
                {m.managerUser.displayName}
                {m.managerUser.isActive ? '' : ' (INACTIVE ACCOUNT)'}
              </>
            ) : (
              <span className="badge badge--danger">MISSING MANAGER — ACTION REQUIRED</span>
            )}
          </dd>
          <dt>Confirmed</dt>
          <dd>{m.confirmedAt ? formatInstant(m.confirmedAt) : 'not yet confirmed'}</dd>
        </dl>
        <div className="actions-row" style={{ marginTop: '0.75rem' }}>
          <form action={refreshManagerAction}>
            <input type="hidden" name="caseId" value={id} />
            <SubmitButton className="secondary" pendingLabel="Re-deriving…">
              Re-derive from directory
            </SubmitButton>
          </form>
          {plan.canOverrideManager ? (
            <details className="action">
              <summary>Assign alternate manager (audited override)</summary>
              <form action={overrideManagerAction} className="stack">
                <input type="hidden" name="caseId" value={id} />
                <div className="field">
                  <label htmlFor="am-user">Alternate manager (LINE_MANAGER accounts)</label>
                  <select id="am-user" name="managerUserId" required defaultValue="">
                    <option value="" disabled>
                      Choose...
                    </option>
                    {plan.responders.managers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="am-reason">Reason (required, audited)</label>
                  <input id="am-reason" name="reason" required maxLength={500} />
                </div>
                <SubmitButton pendingLabel="Recording…">Record alternate manager</SubmitButton>
              </form>
            </details>
          ) : null}
        </div>
      </section>

      <section className="panel" aria-labelledby="hr-h">
        <h2 id="hr-h">HR ownership</h2>
        <dl className="kv">
          <dt>Accountable owner</dt>
          <dd>{plan.hr.accountableOwner.displayName} (HR Manager accountability)</dd>
          <dt>Operational HR Officer</dt>
          <dd>
            {plan.hr.assignedOfficer ? (
              plan.hr.assignedOfficer.displayName
            ) : (
              <span className="badge badge--warning">NOT ASSIGNED</span>
            )}
          </dd>
        </dl>
        {plan.canAssignOfficer ? (
          <details className="action" style={{ marginTop: '0.5rem' }}>
            <summary>
              {plan.hr.assignedOfficer ? 'Reassign HR Officer' : 'Assign HR Officer'}
            </summary>
            <form action={assignOfficerAction} className="stack">
              <input type="hidden" name="caseId" value={id} />
              <div className="field">
                <label htmlFor="of-user">HR Officer</label>
                <select id="of-user" name="officerUserId" required defaultValue="">
                  <option value="" disabled>
                    Choose...
                  </option>
                  {plan.responders.officers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="of-reason">Reason (required, audited)</label>
                <input id="of-reason" name="reason" required maxLength={500} />
              </div>
              <SubmitButton pendingLabel="Assigning…">
                {plan.hr.assignedOfficer ? 'Reassign case' : 'Assign officer'}
              </SubmitButton>
            </form>
          </details>
        ) : (
          <p className="hint">The HR Manager assigns and reassigns the operational officer.</p>
        )}
      </section>

      <section className="panel" aria-labelledby="dept-h">
        <h2 id="dept-h">Department routing</h2>
        <p className="hint">
          IT and Finance tasks start in their department queues; responders claim or are assigned
          work there. Current responders and open workload:
        </p>
        <div className="table-wrap" tabIndex={0}>
          <table className="data">
            <caption className="visually-hidden">Department responders</caption>
            <thead>
              <tr>
                <th scope="col">Queue</th>
                <th scope="col">Responder</th>
                <th scope="col">Open tasks</th>
              </tr>
            </thead>
            <tbody>
              {plan.responders.it.map((u) => (
                <tr key={u.id}>
                  <td>IT queue</td>
                  <td>{u.displayName}</td>
                  <td className="tabular-nums">{u.openTasks}</td>
                </tr>
              ))}
              {plan.responders.finance.map((u) => (
                <tr key={u.id}>
                  <td>Finance queue</td>
                  <td>{u.displayName}</td>
                  <td className="tabular-nums">{u.openTasks}</td>
                </tr>
              ))}
              {plan.responders.it.length === 0 ? (
                <tr>
                  <td>IT queue</td>
                  <td colSpan={2}>No active IT responders configured</td>
                </tr>
              ) : null}
              {plan.responders.finance.length === 0 ? (
                <tr>
                  <td>Finance queue</td>
                  <td colSpan={2}>No active Finance responders configured</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="wf-h">
        <h2 id="wf-h">Workflow</h2>
        <dl className="kv">
          <dt>Departure type</dt>
          <dd>{plan.workflow.departureType.replaceAll('_', ' ').toLowerCase()}</dd>
          <dt>Workflow version</dt>
          <dd>
            {plan.workflow.workflowName
              ? `${plan.workflow.workflowName} (v${plan.workflow.workflowVersion})`
              : 'No ACTIVE definition'}
          </dd>
          <dt>Last working day</dt>
          <dd>
            {plan.workflow.confirmedLastDay
              ? formatInstant(plan.workflow.confirmedLastDay).split(',')[0]
              : '-'}
          </dd>
          <dt>Effective separation</dt>
          <dd>
            {plan.workflow.effectiveSeparationAt
              ? formatInstant(plan.workflow.effectiveSeparationAt)
              : '-'}
          </dd>
          <dt>Confidentiality</dt>
          <dd>{plan.workflow.classification}</dd>
        </dl>
        {plan.workflow.taskSummary.length > 0 ? (
          <div className="table-wrap" tabIndex={0} style={{ marginTop: '0.75rem' }}>
            <table className="data table-sticky">
              <caption className="visually-hidden">Tasks that will be created</caption>
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Owning queue</th>
                  <th scope="col">Assignee</th>
                  <th scope="col">Due</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Dependency</th>
                  <th scope="col">Required</th>
                </tr>
              </thead>
              <tbody>
                {plan.workflow.taskSummary.map((t) => (
                  <tr key={t.taskCode}>
                    <td>{t.title}</td>
                    <td>{t.owningQueue}</td>
                    <td>{t.assignee}</td>
                    <td className="tabular-nums" title={t.dueRule ?? undefined}>
                      {t.dueAt ? formatInstant(t.dueAt) : (t.dueRule ?? '-')}
                    </td>
                    <td>{t.priority}</td>
                    <td>
                      {t.dependsOn.length > 0 ? (
                        <code>{t.dependsOn.join(', ')}</code>
                      ) : (
                        <span className="hint">-</span>
                      )}
                    </td>
                    <td>{t.required ? 'Mandatory' : 'Optional'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="panel" aria-labelledby="conf-h">
        <h2 id="conf-h">HR confirmation</h2>
        {plan.confirmations.complete ? (
          <p className="ok-summary" role="status">
            Assignment plan confirmed. Activation is available on the Workflow tab.
          </p>
        ) : null}
        {plan.canConfirm && preActivation ? (
          <form action={confirmPlanAction} className="stack">
            <input type="hidden" name="caseId" value={id} />
            {plan.confirmations.keys.map((k) => (
              <label key={k.key} style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                <input
                  type="checkbox"
                  name="confirmations"
                  value={k.key}
                  defaultChecked={Boolean(k.at)}
                  style={{ width: 'auto' }}
                />
                <span>
                  {k.label}
                  {k.at ? (
                    <span className="hint"> (confirmed {formatInstant(new Date(k.at))})</span>
                  ) : null}
                </span>
              </label>
            ))}
            <SubmitButton pendingLabel="Confirming…">Confirm assignment plan</SubmitButton>
          </form>
        ) : (
          <p className="hint">
            {preActivation
              ? 'Confirmation requires HR access to this case.'
              : 'The plan was confirmed before activation; changes after activation go through audited reassignment.'}
          </p>
        )}
      </section>
    </>
  );
}
