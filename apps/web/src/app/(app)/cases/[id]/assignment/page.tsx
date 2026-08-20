import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServiceError, getAssignmentPlan } from '@exit/db';
import { formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { CaseNav } from '../CaseNav';
import { CaseTitle, Feedback } from '@/components/ui';
import { SubmitButton } from '@/components/SubmitButton';
import {
  assignOfficerAction,
  confirmPlanAction,
  overrideManagerAction,
  refreshManagerAction,
} from './actions';
import { humanize } from '@/lib/text';

export const metadata: Metadata = { title: 'Assignment Plan' };
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
          <h1>Access Restricted</h1>
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
      <CaseTitle title="Assignment Plan" caseNumber={plan.caseNumber} />
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
          <dd>{plan.employee.displayName}</dd>
          <dt>Employee #</dt>
          <dd>{plan.employee.employeeNumber ?? plan.employee.sourceId}</dd>
          <dt>Position</dt>
          <dd>{plan.employee.jobTitle ?? '-'}</dd>
          <dt>Department / Location</dt>
          <dd>
            {plan.employee.department} / {plan.employee.location}
            {plan.employee.division ? ` (division: ${plan.employee.division})` : ''}
          </dd>
          <dt>Employment Status</dt>
          <dd>
            {plan.employee.employmentActive === null
              ? 'Not recorded'
              : plan.employee.employmentActive
                ? 'Active'
                : 'Inactive'}
          </dd>
          <dt>Hierarchy Source</dt>
          <dd>
            {humanize(plan.employee.sourceSystem)}
            {plan.employee.lastSyncedAt
              ? ` - last synchronized ${formatInstant(plan.employee.lastSyncedAt)}`
              : ' - never synchronized'}
          </dd>
        </dl>
      </section>

      <section className="panel" aria-labelledby="mgmt-h">
        <h2 id="mgmt-h">Management Routing</h2>
        {m.changeFlaggedAt ? (
          <p className="banner-restricted" role="alert">
            The directory manager changed after confirmation ({formatInstant(m.changeFlaggedAt)}).
            Review and re-derive or override, then re-confirm below.
          </p>
        ) : null}
        <dl className="kv">
          <dt>Direct Manager (Directory)</dt>
          <dd>
            {m.managerName ?? 'Not recorded'}
            {m.managerJobTitle ? ` - ${m.managerJobTitle}` : ''}
            {m.managerSource ? (
              <>
                {' '}
                <span className={`badge ${STATE_BADGE[m.managerSource] ?? 'badge--neutral'}`}>
                  {humanize(m.managerSource)}
                </span>
              </>
            ) : null}
          </dd>
          <dt>Second-level Manager</dt>
          <dd>{m.secondLevelManagerName ?? '-'}</dd>
          <dt>Receives the Departure Notice</dt>
          <dd>
            {m.managerName ? (
              m.managerName
            ) : (
              <span className="badge badge--danger">No manager — action required</span>
            )}
          </dd>
          <dt>Confirmed</dt>
          <dd>{m.confirmedAt ? formatInstant(m.confirmedAt) : 'Not yet confirmed'}</dd>
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
                  <label htmlFor="am-user">Alternate Manager</label>
                  <select id="am-user" name="managerSourceId" required defaultValue="">
                    <option value="" disabled>
                      Choose...
                    </option>
                    {plan.responders.managers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="am-reason">Reason (Required, Audited)</label>
                  <input id="am-reason" name="reason" required maxLength={500} />
                </div>
                <SubmitButton pendingLabel="Recording…">Record alternate manager</SubmitButton>
              </form>
            </details>
          ) : null}
        </div>
      </section>

      <section className="panel" aria-labelledby="hr-h">
        <h2 id="hr-h">HR Ownership</h2>
        <dl className="kv">
          <dt>Accountable Owner</dt>
          <dd>{plan.hr.accountableOwner.displayName} (HR Manager accountability)</dd>
          <dt>Operational HR Officer</dt>
          <dd>
            {plan.hr.assignedOfficer ? (
              plan.hr.assignedOfficer.displayName
            ) : (
              <span className="badge badge--warning">Not assigned</span>
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
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="of-reason">Reason (Required, Audited)</label>
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
        <h2 id="dept-h">Notification Routing</h2>
        <p>
          IT and Finance are notified by controlled email automatically. Recipients are maintained
          under Administration &rarr; Recipient directory.
        </p>
      </section>

      <section className="panel" aria-labelledby="wf-h">
        <h2 id="wf-h">Workflow</h2>
        <dl className="kv">
          <dt>Departure Type</dt>
          <dd>{humanize(plan.workflow.departureType)}</dd>
          <dt>Workflow Version</dt>
          <dd>
            {plan.workflow.workflowName
              ? `${plan.workflow.workflowName} (v${plan.workflow.workflowVersion})`
              : 'No ACTIVE definition'}
          </dd>
          <dt>Final Working Date</dt>
          <dd>
            {plan.workflow.confirmedLastDay
              ? formatInstant(plan.workflow.confirmedLastDay).split(',')[0]
              : '-'}
          </dd>
          <dt>Effective Separation</dt>
          <dd>
            {plan.workflow.effectiveSeparationAt
              ? formatInstant(plan.workflow.effectiveSeparationAt)
              : '-'}
          </dd>
          <dt>Confidentiality</dt>
          <dd>{humanize(plan.workflow.classification)}</dd>
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
                    <td>{humanize(t.priority)}</td>
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
        <h2 id="conf-h">HR Confirmation</h2>
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
