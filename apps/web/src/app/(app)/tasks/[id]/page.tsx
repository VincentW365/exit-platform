import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ServiceError, getTask, listActiveUsers } from '@exit/db';
import { formatInstant, CREDENTIAL_WARNING } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import {
  assignTaskDetailAction,
  blockTaskAction,
  claimTaskDetailAction,
  completeAccessTaskAction,
  completeTaskAction,
  correctTaskAction,
  reassignTaskAction,
  returnTaskDetailAction,
  startTaskAction,
  unblockTaskAction,
  updateAccessSystemsAction,
  waiveTaskAction,
} from './actions';

export const metadata: Metadata = { title: 'Task' };
export const dynamic = 'force-dynamic';

const TASK_BADGE: Record<string, string> = {
  NOT_READY: 'badge--neutral',
  READY: 'badge--info',
  IN_PROGRESS: 'badge--info',
  BLOCKED: 'badge--danger',
  COMPLETED: 'badge--success',
  WAIVED: 'badge--warning',
  CANCELLED: 'badge--neutral',
};

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;

  let data: Awaited<ReturnType<typeof getTask>>;
  try {
    data = await getTask(actor, id);
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'NOT_FOUND') notFound();
    throw e;
  }
  const t = data.task;
  const isAccess = t.taskKind === 'ACCESS_REVOCATION';
  const open = ['READY', 'IN_PROGRESS', 'BLOCKED'].includes(t.status);
  const overdue = data.overdue;
  const users = data.canReassign || data.canAssign ? await listActiveUsers().catch(() => []) : [];

  return (
    <>
      <h1>
        {t.title}{' '}
        <span className={`badge ${TASK_BADGE[t.status] ?? 'badge--neutral'}`}>{t.status}</span>
        {overdue ? <span className="badge badge--danger"> OVERDUE</span> : null}
        {t.confidential ? <span className="badge badge--warning"> Restricted</span> : null}
      </h1>
      <Feedback err={sp.err} ok={sp.ok} />

      <section className="panel" aria-labelledby="task-facts-h">
        <h2 id="task-facts-h" style={{ marginTop: 0 }}>
          Task details
        </h2>
        <dl className="kv">
          <dt>Case</dt>
          <dd>
            {data.access === 'HR_FULL' && t.caseId ? (
              <Link href={`/cases/${t.caseId}/workflow`}>{t.caseNumber}</Link>
            ) : (
              t.caseNumber
            )}
          </dd>
          <dt>Assignee</dt>
          <dd>{data.assigneeName ?? 'Unassigned (department queue)'}</dd>
          <dt>Employee</dt>
          <dd>{t.employeeDisplayName}</dd>
          {t.departureType ? (
            <>
              <dt>Departure type</dt>
              <dd>{t.departureType}</dd>
            </>
          ) : null}
          <dt>Department / role</dt>
          <dd>
            {t.department} ({t.requiredRole})
          </dd>
          <dt>Priority</dt>
          <dd>{t.priority}</dd>
          <dt>Required</dt>
          <dd>{t.required ? 'Required for clearance' : 'Optional'}</dd>
          <dt>Due</dt>
          <dd>
            {t.dueAt ? `${formatInstant(t.dueAt)} (America/Jamaica)` : 'No due date'}
            {t.dueRule ? <span className="hint"> - rule: {t.dueRule}</span> : null}
            {t.originalDueAt && t.dueAt && t.originalDueAt.getTime() !== t.dueAt.getTime() ? (
              <span className="hint">
                {' '}
                - original due {formatInstant(t.originalDueAt)} ({t.dueRecalcReason})
              </span>
            ) : null}
          </dd>
          {t.releaseAt ? (
            <>
              <dt>Released</dt>
              <dd>{formatInstant(t.releaseAt)}</dd>
            </>
          ) : null}
          <dt>Description</dt>
          <dd>{t.description || '-'}</dd>
          {t.dependsOnCodes.length ? (
            <>
              <dt>Depends on</dt>
              <dd>{t.dependsOnCodes.join(', ')}</dd>
            </>
          ) : null}
          {t.status === 'COMPLETED' ? (
            <>
              <dt>Completed</dt>
              <dd>
                {t.completedAt ? formatInstant(t.completedAt) : '-'}
                {(t.lateMinutes ?? 0) > 0 ? ` - ${t.lateMinutes} minute(s) after the due time` : ''}
                {t.completionNote ? ` - ${t.completionNote}` : ''}
              </dd>
            </>
          ) : null}
          {t.status === 'WAIVED' ? (
            <>
              <dt>Waived</dt>
              <dd>
                {t.waivedAt ? formatInstant(t.waivedAt) : ''} - {t.waiverReason}
              </dd>
            </>
          ) : null}
          {t.status === 'BLOCKED' ? (
            <>
              <dt>Blocked</dt>
              <dd>
                {t.blockedReason} {t.blockerOwner ? `(owner: ${t.blockerOwner})` : ''}
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      {isAccess ? (
        <section className="panel" aria-labelledby="access-h">
          <h2 id="access-h" style={{ marginTop: 0 }}>
            Exact-time access revocation
          </h2>
          <p>
            Due at the exact approved effective separation time
            {t.effectiveSeparationAt ? `: ${formatInstant(t.effectiveSeparationAt)}` : ''}. This
            task cannot be waived. Completion records manual evidence only - no live identity system
            is called.
          </p>
          <p className="hint" role="note">
            {CREDENTIAL_WARNING}
          </p>
          <h3>Access categories on record</h3>
          <ul>
            {t.accessSystems.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          {data.canWork && open ? (
            <>
              <details className="action">
                <summary>Update the systems list (preparation)</summary>
                <form action={updateAccessSystemsAction}>
                  <input type="hidden" name="taskId" value={id} />
                  <label htmlFor="acc-systems">Systems / access categories (one per line)</label>
                  <textarea
                    id="acc-systems"
                    name="systems"
                    rows={4}
                    defaultValue={t.accessSystems.join('\n')}
                    required
                  />
                  <button type="submit">Save systems list</button>
                </form>
              </details>
              <details className="action" open>
                <summary>Record access-revocation completion</summary>
                <form action={completeAccessTaskAction}>
                  <input type="hidden" name="taskId" value={id} />
                  <label htmlFor="acc-done">Systems completed (one per line)</label>
                  <textarea
                    id="acc-done"
                    name="systemsCompleted"
                    rows={4}
                    defaultValue={t.accessSystems.join('\n')}
                  />
                  <label htmlFor="acc-unres">
                    Systems that could NOT be removed (one per line; leave empty if all removed)
                  </label>
                  <textarea id="acc-unres" name="systemsUnresolved" rows={2} />
                  <label htmlFor="acc-note">Completion evidence note (required)</label>
                  <textarea id="acc-note" name="note" rows={3} required maxLength={2000} />
                  <label htmlFor="acc-early">
                    Early-completion reason (required ONLY if completing before the effective time)
                  </label>
                  <input id="acc-early" name="earlyCompletionReason" maxLength={500} />
                  <label htmlFor="acc-incident">Incident reference (if applicable)</label>
                  <input id="acc-incident" name="incidentRef" maxLength={120} />
                  <button type="submit">Record completion</button>
                </form>
              </details>
            </>
          ) : null}
          {t.accessResult ? (
            <p>
              <strong>Result:</strong> {t.accessResult}
              {t.accessSystemsUnresolved.length > 0
                ? ` - unresolved: ${t.accessSystemsUnresolved.join('; ')}`
                : ''}
              {t.incidentRef ? ` - incident ${t.incidentRef}` : ''}
              {t.earlyCompletionReason
                ? ` - early-completion reason: ${t.earlyCompletionReason}`
                : ''}
            </p>
          ) : null}
        </section>
      ) : null}

      {data.canWork && t.status === 'READY' ? (
        <form action={startTaskAction} style={{ marginBottom: '1rem' }}>
          <input type="hidden" name="taskId" value={id} />
          <button type="submit">Start task</button>
        </form>
      ) : null}

      {data.canWork && open && !isAccess ? (
        <details className="action" open={t.status === 'IN_PROGRESS'}>
          <summary>Complete with evidence</summary>
          <form action={completeTaskAction}>
            <input type="hidden" name="taskId" value={id} />
            <p className="hint" role="note">
              {CREDENTIAL_WARNING}
            </p>
            <label htmlFor="c-note">
              Completion note {t.evidenceKind === 'NOTE' ? '(required evidence)' : '(optional)'}
            </label>
            <textarea id="c-note" name="note" rows={3} maxLength={2000} />
            <button type="submit">Complete task</button>
          </form>
        </details>
      ) : null}

      {data.canWork && (t.status === 'READY' || t.status === 'IN_PROGRESS') ? (
        <details className="action">
          <summary>Mark blocked</summary>
          <form action={blockTaskAction}>
            <input type="hidden" name="taskId" value={id} />
            <label htmlFor="b-reason">Blocker reason (required, safe operational text only)</label>
            <textarea id="b-reason" name="reason" rows={2} required maxLength={2000} />
            <label htmlFor="b-owner">Blocker owner (who must act)</label>
            <input id="b-owner" name="blockerOwner" maxLength={200} />
            <button type="submit">Mark blocked</button>
          </form>
        </details>
      ) : null}

      {data.canWork && t.status === 'BLOCKED' && !isAccess ? (
        <form action={unblockTaskAction} style={{ marginBottom: '1rem' }}>
          <input type="hidden" name="taskId" value={id} />
          <button type="submit">Clear blocker (resume work)</button>
        </form>
      ) : null}

      {data.canWaive && open ? (
        <details className="action">
          <summary>Waive task (HR Manager)</summary>
          <form action={waiveTaskAction}>
            <input type="hidden" name="taskId" value={id} />
            <label htmlFor="w-reason">Waiver reason (required, audited)</label>
            <textarea id="w-reason" name="reason" rows={2} required maxLength={2000} />
            <button type="submit">Waive task</button>
          </form>
        </details>
      ) : null}

      {data.canClaim ? (
        <form action={claimTaskDetailAction} style={{ display: 'inline-block' }}>
          <input type="hidden" name="taskId" value={id} />
          <button type="submit">Claim this task</button>
        </form>
      ) : null}

      {data.canAssign ? (
        <details className="action">
          <summary>Assign to a responder</summary>
          <form action={assignTaskDetailAction}>
            <input type="hidden" name="taskId" value={id} />
            <label htmlFor="as-user">Assignee ({t.department} responders)</label>
            <select id="as-user" name="assigneeId" required>
              {users.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.displayName} ({u.roles.join(', ')})
                </option>
              ))}
            </select>
            <label htmlFor="as-reason">Reason (required, audited)</label>
            <textarea id="as-reason" name="reason" rows={2} required maxLength={500} />
            <button type="submit">Assign task</button>
          </form>
        </details>
      ) : null}

      {data.canReturn ? (
        <details className="action">
          <summary>Return to department queue</summary>
          <form action={returnTaskDetailAction}>
            <input type="hidden" name="taskId" value={id} />
            <label htmlFor="rq-reason">Reason (required, audited)</label>
            <textarea id="rq-reason" name="reason" rows={2} required maxLength={500} />
            <p className="hint">
              History and the due date are preserved; the SLA clock never resets.
            </p>
            <button type="submit" className="secondary">
              Return task to queue
            </button>
          </form>
        </details>
      ) : null}

      {data.canReassign && open ? (
        <details className="action">
          <summary>Reassign task (HR Manager)</summary>
          <form action={reassignTaskAction}>
            <input type="hidden" name="taskId" value={id} />
            <label htmlFor="r-user">Assignee</label>
            <select id="r-user" name="assigneeId" required>
              {users.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.displayName} ({u.roles.join(', ')})
                </option>
              ))}
            </select>
            <label htmlFor="r-reason">Reason (required, audited)</label>
            <textarea id="r-reason" name="reason" rows={2} required maxLength={500} />
            <button type="submit">Reassign</button>
          </form>
        </details>
      ) : null}

      {data.canCorrect ? (
        <details className="action">
          <summary>Correct completed task (HR Manager, audited)</summary>
          <form action={correctTaskAction}>
            <input type="hidden" name="taskId" value={id} />
            <p className="hint">
              The original value is preserved in an append-only correction record.
            </p>
            <label htmlFor="cor-value">Corrected completion note</label>
            <textarea id="cor-value" name="correctedValue" rows={2} required maxLength={2000} />
            <label htmlFor="cor-reason">Correction reason (required)</label>
            <textarea id="cor-reason" name="reason" rows={2} required maxLength={1000} />
            <label htmlFor="cor-effect">Effect on clearance</label>
            <input
              id="cor-effect"
              name="clearanceEffect"
              maxLength={300}
              defaultValue="No effect on clearance readiness."
            />
            <button type="submit">Record correction</button>
          </form>
        </details>
      ) : null}
    </>
  );
}
