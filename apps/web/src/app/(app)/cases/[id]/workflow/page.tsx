import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ServiceError,
  getAssignmentPlan,
  getCaseWorkflow,
  previewWorkflowForCase,
  previewEffectiveChangeImpact,
} from '@exit/db';
import { formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { CaseNav } from '../CaseNav';
import {
  activateWorkflowAction,
  holdCaseAction,
  reopenCaseAction,
  resumeCaseAction,
  supersedeWorkflowAction,
} from './actions';

export const metadata: Metadata = { title: 'Workflow' };
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

export default async function CaseWorkflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;

  let data: Awaited<ReturnType<typeof getCaseWorkflow>>;
  try {
    data = await getCaseWorkflow(actor, id);
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'NOT_FOUND') notFound();
    if (e instanceof ServiceError && e.code === 'FORBIDDEN')
      return <p className="panel">This area requires full case access.</p>;
    throw e;
  }

  const preview = data.canActivate ? await previewWorkflowForCase(actor, id) : null;
  // Directive 6.1 (J): surface assignment-plan blockers next to activation.
  const assignmentBlockers = data.canActivate
    ? await getAssignmentPlan(actor, id)
        .then((p) => p.blockers)
        .catch(() => [])
    : [];
  const impact =
    data.caseStatus === 'ACTIVE' || data.caseStatus === 'ON_HOLD'
      ? await previewEffectiveChangeImpact(actor, id)
      : [];
  const now = data.now.getTime();

  return (
    <>
      <h1>
        Workflow - {data.caseNumber} ({data.caseStatus})
      </h1>
      <CaseNav caseId={id} active="workflow" />
      <Feedback err={sp.err} ok={sp.ok} />

      {preview && assignmentBlockers.length > 0 ? (
        <div className="banner-baseline" role="status">
          <strong>Activation is blocked by the assignment plan:</strong>
          <ul style={{ margin: '0.25rem 0 0 1.1rem' }}>
            {assignmentBlockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p style={{ margin: '0.4rem 0 0' }}>
            <Link href={`/cases/${id}/assignment`}>Open the Assignment tab</Link> to resolve these.
          </p>
        </div>
      ) : null}

      {preview ? (
        <section className="panel" aria-labelledby="preview-h">
          <h2 id="preview-h">Workflow preview (read-only, before activation)</h2>
          {preview.definition ? (
            <>
              <p>
                <strong>{preview.definition.name}</strong> - version {preview.definition.version} -
                checksum <code>{preview.definition.configChecksum.slice(0, 12)}...</code> - calendar
                v{preview.definition.calendarVersion}. Activation pins this case to exactly this
                version; later edits never silently change it.
              </p>
              <div style={{ overflowX: 'auto' }} tabIndex={0}>
                <table>
                  <caption className="visually-hidden">Tasks that will be created</caption>
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Task</th>
                      <th scope="col">Department</th>
                      <th scope="col">Required</th>
                      <th scope="col">Depends on</th>
                      <th scope="col">Due (calculated)</th>
                      <th scope="col">SLA / escalation</th>
                      <th scope="col">Waiver</th>
                      <th scope="col">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.tasks.map((t, i) => (
                      <tr key={t.taskCode}>
                        <td>{i + 1}</td>
                        <td>
                          {t.title}
                          {t.taskKind === 'ACCESS_REVOCATION' ? (
                            <>
                              {' '}
                              <span className="badge badge--danger">EXACT TIME</span>
                            </>
                          ) : null}
                          {t.confidential ? (
                            <>
                              {' '}
                              <span className="badge badge--warning">Restricted</span>
                            </>
                          ) : null}
                        </td>
                        <td>{t.department}</td>
                        <td>{t.required ? 'Required' : 'Optional'}</td>
                        <td>{t.dependsOnCodes.join(', ') || '-'}</td>
                        <td>
                          {t.dueAt ? formatInstant(t.dueAt) : '-'}
                          <br />
                          <span className="hint">{t.dueRule}</span>
                        </td>
                        <td>
                          {t.slaNote ?? '-'}
                          {t.escalationNote ? (
                            <>
                              <br />
                              <span className="hint">{t.escalationNote}</span>
                            </>
                          ) : null}
                        </td>
                        <td>{t.waiverAllowed ? `Yes (${t.waiverAuthority})` : 'No'}</td>
                        <td>{t.evidenceKind}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <form action={activateWorkflowAction}>
                <input type="hidden" name="caseId" value={id} />
                <button type="submit">Activate case and create these tasks</button>
              </form>
            </>
          ) : (
            <p className="hint">{preview.warning}</p>
          )}
        </section>
      ) : null}

      {data.canHold ? (
        <details className="action">
          <summary>Place case on hold</summary>
          <form action={holdCaseAction}>
            <input type="hidden" name="caseId" value={id} />
            <p>
              A hold pauses eligible administrative due dates only. Access revocation, security
              tasks and the exact effective-separation event are never paused.
            </p>
            <label htmlFor="hold-reason">Reason (required, audited)</label>
            <textarea id="hold-reason" name="reason" required maxLength={500} rows={2} />
            <button type="submit">Place on hold</button>
          </form>
        </details>
      ) : null}
      {data.canResume ? (
        <details className="action" open>
          <summary>Resume case from hold</summary>
          <form action={resumeCaseAction}>
            <input type="hidden" name="caseId" value={id} />
            <label htmlFor="resume-reason">Reason (required, audited)</label>
            <textarea id="resume-reason" name="reason" required maxLength={500} rows={2} />
            <button type="submit">Resume case</button>
          </form>
        </details>
      ) : null}
      {data.canSupersede ? (
        <details className="action">
          <summary>Correct departure type (supersedes the workflow)</summary>
          <form action={supersedeWorkflowAction}>
            <input type="hidden" name="caseId" value={id} />
            <p>
              HR-Manager review (C.7): the current workflow is preserved as SUPERSEDED; a
              replacement workflow is created and only matching completed evidence is carried
              forward.
            </p>
            <label htmlFor="sup-type">New departure type</label>
            <select id="sup-type" name="newType" required>
              <option value="RESIGNATION_WITH_NOTICE">Resignation with notice</option>
              <option value="IMMEDIATE_RESIGNATION">Immediate resignation</option>
              <option value="TERMINATION">Termination (restricted)</option>
            </select>
            <label htmlFor="sup-reason">Reason (required, audited)</label>
            <textarea id="sup-reason" name="reason" required maxLength={500} rows={2} />
            <button type="submit">Supersede and recreate workflow</button>
          </form>
        </details>
      ) : null}
      {data.caseStatus === 'COMPLETED' ? (
        <details className="action">
          <summary>Reopen case (HR Manager)</summary>
          <form action={reopenCaseAction}>
            <input type="hidden" name="caseId" value={id} />
            <p>
              Reopening records an audited reactivation plan. The completed workflow is preserved
              untouched - nothing is overwritten.
            </p>
            <label htmlFor="ro-reason">Reason (required)</label>
            <textarea id="ro-reason" name="reason" required maxLength={500} rows={2} />
            <label htmlFor="ro-plan">Reactivation plan (required)</label>
            <textarea id="ro-plan" name="plan" required maxLength={4000} rows={3} />
            <button type="submit">Reopen case</button>
          </form>
        </details>
      ) : null}

      {impact.length > 0 ? (
        <section className="panel" aria-labelledby="impact-h">
          <h2 id="impact-h">Tasks affected by an effective-time change</h2>
          <p className="hint">
            If the effective separation time is corrected (case overview), these open tasks will be
            recalculated. Old due dates are retained and retrospective moves appear in the exception
            history.
          </p>
          <ul>
            {impact.map((t) => (
              <li key={t.id}>
                {t.title} ({t.department}) - currently due {t.dueAt ? formatInstant(t.dueAt) : '-'}{' '}
                - basis {t.basis}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.instances.length === 0 && !preview ? (
        <p className="panel">
          No workflow exists yet. The workflow is created when an APPROVED case is activated.
        </p>
      ) : null}

      {data.instances.map((inst) => (
        <section className="panel" key={inst.id} aria-label={`Workflow ${inst.status}`}>
          <h2 style={{ marginTop: 0 }}>
            {inst.definition.name} v{inst.definitionVersion}{' '}
            <span
              className={`badge ${
                inst.status === 'COMPLETED'
                  ? 'badge--success'
                  : inst.status === 'CANCELLED' || inst.status === 'SUPERSEDED'
                    ? 'badge--neutral'
                    : 'badge--info'
              }`}
            >
              {inst.status}
            </span>
          </h2>
          <p>
            Activated {formatInstant(inst.activatedAt)} - checksum{' '}
            <code>{inst.configChecksum.slice(0, 12)}...</code> - completion {inst.completionPct}% (
            {inst.completedTaskCount} completed, {inst.waivedTaskCount} waived of{' '}
            {inst.requiredTaskCount} required) - {inst.blockedTaskCount} blocked -{' '}
            {inst.overdueTaskCount} overdue -{' '}
            {inst.clearanceReady ? 'READY for clearance' : 'not yet ready for clearance'}
          </p>
          <div style={{ overflowX: 'auto' }} tabIndex={0}>
            <table>
              <caption className="visually-hidden">Workflow tasks</caption>
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Department</th>
                  <th scope="col">Status</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Due</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {inst.tasks.map((t) => {
                  const overdue =
                    t.dueAt &&
                    t.dueAt.getTime() < now &&
                    ['READY', 'IN_PROGRESS', 'BLOCKED'].includes(t.status);
                  return (
                    <tr key={t.id}>
                      <td>
                        <Link href={`/tasks/${t.id}`}>{t.title}</Link>
                        {t.taskKind === 'ACCESS_REVOCATION' ? (
                          <>
                            {' '}
                            <span className="badge badge--danger">EXACT TIME</span>
                          </>
                        ) : null}
                        {!t.required ? <span className="hint"> (optional)</span> : null}
                      </td>
                      <td>{t.department}</td>
                      <td>
                        <span className={`badge ${TASK_BADGE[t.status] ?? 'badge--neutral'}`}>
                          {t.status}
                        </span>
                        {overdue ? (
                          <>
                            {' '}
                            <span className="badge badge--danger">OVERDUE</span>
                          </>
                        ) : null}
                      </td>
                      <td>{t.priority}</td>
                      <td>
                        {t.dueAt ? formatInstant(t.dueAt) : '-'}
                        {t.dueRecalcReason ? (
                          <>
                            <br />
                            <span className="hint">recalculated: {t.dueRecalcReason}</span>
                          </>
                        ) : null}
                      </td>
                      <td>
                        {t.status === 'COMPLETED' && t.completedAt
                          ? `Completed ${formatInstant(t.completedAt)}${
                              (t.lateMinutes ?? 0) > 0 ? ` (${t.lateMinutes} min late)` : ''
                            }`
                          : t.status === 'WAIVED'
                            ? `Waived: ${t.waiverReason ?? ''}`
                            : t.status === 'BLOCKED'
                              ? `Blocked: ${t.blockedReason ?? ''}`
                              : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
