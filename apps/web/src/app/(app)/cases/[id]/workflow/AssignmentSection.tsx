import { getAssignmentPlan, ServiceError } from '@exit/db';
import { formatInstant } from '@exit/domain';
import type { Actor } from '@exit/domain';
import { SubmitButton } from '@/components/SubmitButton';
import {
  assignOfficerAction,
  confirmPlanAction,
  overrideManagerAction,
  refreshManagerAction,
} from '../assignment/actions';
import { humanize } from '@/lib/text';

/**
 * The responsibility plan, folded into the Workflow tab (owner, 2026-08-25):
 * assignment is the step immediately before activation, so it lives where
 * activation lives instead of on a tab of its own. Same data, same actions,
 * same audit - only the address changed.
 */

const STATE_BADGE: Record<string, string> = {
  DIRECTORY: 'badge--info',
  OVERRIDE: 'badge--warning',
  MANUAL: 'badge--neutral',
};

export async function AssignmentSection({ actor, caseId }: { actor: Actor; caseId: string }) {
  let plan: Awaited<ReturnType<typeof getAssignmentPlan>>;
  try {
    plan = await getAssignmentPlan(actor, caseId);
  } catch (e) {
    // No access to the plan just means this section stays silent - the
    // workflow view itself already enforces its own access.
    if (e instanceof ServiceError) return null;
    throw e;
  }
  const m = plan.management;
  const preActivation = ['DRAFT', 'PENDING_HR_REVIEW', 'APPROVED'].includes(plan.status);

  return (
    <>
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
          {/* The employer's own number, or nothing. BambooHR's internal record
              id is not an employee number and is never shown as one. */}
          <dd>{plan.employee.employeeNumber ?? 'Not recorded in BambooHR'}</dd>
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
            <input type="hidden" name="caseId" value={caseId} />
            <SubmitButton className="secondary" pendingLabel="Re-deriving…">
              Re-derive from directory
            </SubmitButton>
          </form>
          {plan.canOverrideManager ? (
            <details className="action">
              <summary>Assign alternate manager (audited override)</summary>
              <form action={overrideManagerAction} className="stack">
                <input type="hidden" name="caseId" value={caseId} />
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
              <input type="hidden" name="caseId" value={caseId} />
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

      {/* The workflow summary itself lives below on this tab - the plan
          panels stop at responsibility and confirmation. */}

      <section className="panel" aria-labelledby="conf-h">
        <h2 id="conf-h">HR Confirmation</h2>
        {plan.confirmations.complete ? (
          <p className="ok-summary" role="status">
            Assignment plan confirmed. Activation is available on the Workflow tab.
          </p>
        ) : null}
        {plan.canConfirm && preActivation ? (
          <form action={confirmPlanAction} className="stack">
            <input type="hidden" name="caseId" value={caseId} />
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
