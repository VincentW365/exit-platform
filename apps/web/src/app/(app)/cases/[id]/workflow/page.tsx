import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ServiceError,
  getAssignmentPlan,
  getCaseWorkflow,
  previewWorkflowForCase,
  previewEffectiveChangeImpact,
  listCaseNotifications,
} from '@exit/db';
import { formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { CaseTitle, Feedback } from '@/components/ui';
import { CaseNav } from '../CaseNav';
import { AssignmentSection } from './AssignmentSection';
import {
  activateWorkflowAction,
  holdCaseAction,
  reopenCaseAction,
  resumeCaseAction,
  supersedeWorkflowAction,
} from './actions';
import { countOf, humanize } from '@/lib/text';
import { Chip, Row, Rows, SectionHead, type Tone } from '@/components/patterns';
import { CoinsIcon, FlowIcon, MailIcon, ServerIcon, UserIcon } from '@/components/icons';

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

/**
 * Section 7: the four owners of offboarding work, each described in its own
 * terms. IT and Finance hold no login in this operating model - their work
 * leaves as a controlled email and returns as evidence - so their sections
 * say that rather than implying someone will tick a box in here.
 */
/** Which email types carry each department's work when it holds no tasks. */
const DEPARTMENT_EMAILS: Readonly<Record<string, readonly string[]>> = {
  HR: [],
  LINE_MANAGER: ['LINE_MANAGER_HANDOVER'],
  IT: ['IT_ACCESS_REMOVAL'],
  FINANCE: ['FINANCE_OFFBOARDING'],
};

/** Plain words for where one department's request has got to. */
const EMAIL_STATE: Readonly<Record<string, { label: string; tone: Tone }>> = {
  DRAFT: { label: 'Being prepared', tone: 'progress' },
  PENDING_APPROVAL: { label: 'Waiting for approval', tone: 'attention' },
  APPROVED: { label: 'Approved, waiting to send', tone: 'progress' },
  READY_FOR_MANUAL_SEND: { label: 'Ready to send by hand', tone: 'attention' },
  MANUALLY_SENT: { label: 'Sent by hand', tone: 'progress' },
  SENT: { label: 'Sent - waiting to hear back', tone: 'progress' },
  ACKNOWLEDGED: { label: 'Acknowledged', tone: 'progress' },
  CONFIRMED_COMPLETE: { label: 'Confirmed complete', tone: 'done' },
  FAILED: { label: 'Could not send', tone: 'critical' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  SUPERSEDED: { label: 'Replaced by a newer request', tone: 'neutral' },
};

const DEPARTMENT_SECTIONS = [
  {
    key: 'HR' as const,
    title: 'HR actions',
    description: 'Work the assigned HR Officer performs and records on this case.',
    icon: <UserIcon />,
  },
  {
    key: 'LINE_MANAGER' as const,
    title: 'Manager actions',
    description:
      "What the employee's manager is expected to do. The manager holds no login - they are told by email and HR records the outcome.",
    icon: <FlowIcon />,
  },
  {
    key: 'IT' as const,
    title: 'IT access removal',
    description:
      "Requested by controlled email and completed in IT's own systems. Delivery is never treated as completion - confirmation or recorded evidence is.",
    icon: <ServerIcon />,
  },
  {
    key: 'FINANCE' as const,
    title: 'Finance and payroll clearance',
    description:
      'Finance is notified automatically and works in its own systems. The platform records status only - it never calculates or changes pay.',
    icon: <CoinsIcon />,
  },
];

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
      return (
        <>
          <h1>Access Restricted</h1>
          <p className="panel">This area requires full case access.</p>
        </>
      );
    throw e;
  }

  // Section 7: IT, Finance and the manager hold no login - their work leaves
  // as a controlled email and comes back as evidence. Their sections read from
  // the email trail so each department has a real presence here, not a gap.
  const emails = await listCaseNotifications(actor, id)
    .then((n) => n.records)
    .catch(() => []);

  const assignment = <AssignmentSection actor={actor} caseId={id} />;
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
      <CaseTitle title="Workflow" caseNumber={data.caseNumber} status={data.caseStatus} />
      <CaseNav caseId={id} active="workflow" />
      <Feedback err={sp.err} ok={sp.ok} />
      {/* Before activation the responsibility plan IS the work, so it leads.
          Once the workflow is running the department sections lead and the
          plan becomes reference, kept below them. */}
      {data.instances.length === 0 ? assignment : null}

      {data.instances.length === 0 && !preview ? (
        <p className="panel">
          No workflow exists yet. The workflow is created when an approved case is activated.
        </p>
      ) : null}

      {data.instances.map((inst) => (
        <section className="panel" key={inst.id} aria-label={`Workflow ${inst.status}`}>
          <h2 style={{ marginTop: 0 }}>
            {inst.definition.name} V{inst.definitionVersion}{' '}
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
          <div className="wf-progress">
            <div className="wf-progress__head">
              <span className="wf-progress__pct">{inst.completionPct}%</span>
              <span className="hint">
                {inst.completedTaskCount} of {inst.requiredTaskCount} required tasks complete
                {inst.waivedTaskCount > 0 ? ` (${inst.waivedTaskCount} waived)` : ''}
              </span>
              <span
                className={`badge ${inst.clearanceReady ? 'badge--success' : 'badge--neutral'}`}
              >
                {inst.clearanceReady ? 'Ready for clearance' : 'Not yet ready for clearance'}
              </span>
            </div>
            <div
              className="meter"
              role="img"
              aria-label={`${inst.completionPct}% of required tasks complete`}
            >
              <span className="meter__fill" style={{ width: `${inst.completionPct}%` }} />
            </div>
            <p className="wf-progress__facts">
              {inst.overdueTaskCount > 0 ? (
                <span className="badge badge--danger">
                  {countOf(inst.overdueTaskCount, 'task')} overdue
                </span>
              ) : null}
              {inst.blockedTaskCount > 0 ? (
                <span className="badge badge--warning">
                  {countOf(inst.blockedTaskCount, 'task')} blocked
                </span>
              ) : null}
              {inst.overdueTaskCount === 0 && inst.blockedTaskCount === 0 ? (
                <span className="badge badge--success">Nothing overdue or blocked</span>
              ) : null}
              <span className="hint">
                Activated {formatInstant(inst.activatedAt)} · checksum{' '}
                <code>{inst.configChecksum.slice(0, 12)}...</code>
              </span>
            </p>
          </div>
          {/* Section 7: responsibilities are grouped by who owns them, and
              each group gets the treatment its work deserves. IT and Finance
              hold no login in this model - their work leaves as email and
              comes back as evidence, so their sections say so. */}
          {DEPARTMENT_SECTIONS.map((group) => {
            const groupTasks = inst.tasks.filter((t) => t.department === group.key);
            const groupEmails = emails.filter(
              (e) =>
                (DEPARTMENT_EMAILS[group.key] ?? []).includes(e.notificationType) &&
                e.status !== 'SUPERSEDED',
            );
            // A department with neither tasks nor email has nothing to say yet.
            if (groupTasks.length === 0 && groupEmails.length === 0) return null;
            const outstanding = groupTasks.filter((t) =>
              ['NOT_READY', 'READY', 'IN_PROGRESS', 'BLOCKED'].includes(t.status),
            ).length;
            const overdueHere = groupTasks.filter(
              (t) =>
                t.dueAt &&
                t.dueAt.getTime() < now &&
                ['READY', 'IN_PROGRESS', 'BLOCKED'].includes(t.status),
            ).length;
            const emailsOpen = groupEmails.filter(
              (e) => !['CONFIRMED_COMPLETE', 'CANCELLED'].includes(e.status),
            ).length;
            const emailsFailed = groupEmails.some((e) => e.status === 'FAILED');
            const open = outstanding + emailsOpen;
            return (
              <div key={group.key} style={{ marginTop: 'var(--space-5)' }}>
                <SectionHead
                  icon={group.icon}
                  tone={
                    overdueHere > 0 || emailsFailed ? 'critical' : open > 0 ? 'pending' : 'done'
                  }
                  title={group.title}
                  description={group.description}
                  aside={
                    open > 0 ? (
                      <Chip tone={overdueHere > 0 || emailsFailed ? 'critical' : 'pending'}>
                        {open} outstanding
                      </Chip>
                    ) : (
                      <Chip tone="done">All done</Chip>
                    )
                  }
                />
                {groupTasks.length > 0 ? (
                  <Rows label={`${group.title} tasks`}>
                    {groupTasks.map((t) => {
                      const overdue =
                        t.dueAt &&
                        t.dueAt.getTime() < now &&
                        ['READY', 'IN_PROGRESS', 'BLOCKED'].includes(t.status);
                      return (
                        <Row
                          key={t.id}
                          tone={
                            overdue
                              ? 'critical'
                              : t.status === 'BLOCKED'
                                ? 'attention'
                                : ['COMPLETED', 'WAIVED'].includes(t.status)
                                  ? 'done'
                                  : 'progress'
                          }
                          muted={['COMPLETED', 'WAIVED', 'CANCELLED'].includes(t.status)}
                          mark={group.icon}
                          title={
                            <>
                              <Link href={`/tasks/${t.id}`}>{t.title}</Link>
                              {t.taskKind === 'ACCESS_REVOCATION' ? (
                                <>
                                  {' '}
                                  <Chip tone="critical">Exact time</Chip>
                                </>
                              ) : null}
                              {!t.required ? <span className="meta"> · optional</span> : null}
                            </>
                          }
                          sub={
                            t.status === 'COMPLETED' && t.completedAt
                              ? `Completed ${formatInstant(t.completedAt)}${
                                  (t.lateMinutes ?? 0) > 0 ? ` - ${t.lateMinutes} min late` : ''
                                }`
                              : t.status === 'WAIVED'
                                ? `Waived: ${t.waiverReason ?? ''}`
                                : t.status === 'BLOCKED'
                                  ? `Blocked: ${t.blockedReason ?? ''}`
                                  : t.dueRecalcReason
                                    ? `Due recalculated: ${t.dueRecalcReason}`
                                    : undefined
                          }
                          facts={
                            <>
                              <span>
                                <span className="label">Due</span>
                                <span className="value numeric">
                                  {t.dueAt ? formatInstant(t.dueAt) : 'No date'}
                                </span>
                              </span>
                              <span className={`badge ${TASK_BADGE[t.status] ?? 'badge--neutral'}`}>
                                {humanize(t.status)}
                              </span>
                              {overdue ? <Chip tone="critical">Overdue</Chip> : null}
                              {t.priority && t.priority !== 'NORMAL' ? (
                                <Chip tone="attention">{humanize(t.priority)}</Chip>
                              ) : null}
                            </>
                          }
                        />
                      );
                    })}
                  </Rows>
                ) : null}

                {groupEmails.length > 0 ? (
                  <Rows label={`${group.title} email requests`}>
                    {groupEmails.map((e) => {
                      const state = EMAIL_STATE[e.status] ?? {
                        label: humanize(e.status),
                        tone: 'neutral' as Tone,
                      };
                      return (
                        <Row
                          key={e.id}
                          tone={state.tone}
                          muted={state.tone === 'done' || state.tone === 'neutral'}
                          mark={<MailIcon />}
                          title={
                            <Link href={`/cases/${id}/notifications`}>
                              {humanize(e.notificationType)}
                            </Link>
                          }
                          sub={
                            e.sentAt
                              ? `Sent ${formatInstant(e.sentAt)}`
                              : e.scheduledSendAt
                                ? `Scheduled for ${formatInstant(e.scheduledSendAt)}`
                                : 'Not sent yet'
                          }
                          facts={
                            <>
                              <span>
                                <span className="label">Recipient</span>
                                <span className="value">
                                  {e.recipientName ??
                                    e.recipientOrg ??
                                    e.caseRecipientMask ??
                                    'Not set'}
                                </span>
                              </span>
                              <Chip tone={state.tone}>{state.label}</Chip>
                              {e.acknowledgedAt ? (
                                <span>
                                  <span className="label">Acknowledged</span>
                                  <span className="value numeric">
                                    {formatInstant(e.acknowledgedAt)}
                                  </span>
                                </span>
                              ) : null}
                            </>
                          }
                        />
                      );
                    })}
                  </Rows>
                ) : null}
              </div>
            );
          })}
        </section>
      ))}

      {preview && assignmentBlockers.length > 0 ? (
        <div className="banner-baseline" role="status">
          <strong>Activation is blocked by the assignment plan:</strong>
          <ul style={{ margin: '0.25rem 0 0 1.1rem' }}>
            {assignmentBlockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p style={{ margin: '0.4rem 0 0' }}>Resolve these in the responsibility plan above.</p>
        </div>
      ) : null}

      {preview ? (
        <section className="panel" aria-labelledby="preview-h">
          <h2 id="preview-h">Workflow Preview (Read-only, Before Activation)</h2>
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
                              <span className="badge badge--attention">Exact time</span>
                            </>
                          ) : null}
                          {t.confidential ? (
                            <>
                              {' '}
                              <span className="badge badge--warning">Restricted</span>
                            </>
                          ) : null}
                        </td>
                        <td>{humanize(t.department)}</td>
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
            <label htmlFor="hold-reason">Reason (Required, Audited)</label>
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
            <label htmlFor="resume-reason">Reason (Required, Audited)</label>
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
            <label htmlFor="sup-type">New Departure Type</label>
            <select id="sup-type" name="newType" required>
              <option value="RESIGNATION_WITH_NOTICE">Resignation with notice</option>
              <option value="IMMEDIATE_RESIGNATION">Immediate resignation</option>
              <option value="TERMINATION">Termination (restricted)</option>
            </select>
            <label htmlFor="sup-reason">Reason (Required, Audited)</label>
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
            <label htmlFor="ro-reason">Reason (Required)</label>
            <textarea id="ro-reason" name="reason" required maxLength={500} rows={2} />
            <label htmlFor="ro-plan">Reactivation Plan (Required)</label>
            <textarea id="ro-plan" name="plan" required maxLength={4000} rows={3} />
            <button type="submit">Reopen case</button>
          </form>
        </details>
      ) : null}

      {impact.length > 0 ? (
        <section className="panel" aria-labelledby="impact-h">
          <h2 id="impact-h">Tasks Affected by an Effective-time Change</h2>
          <p className="hint">
            If the effective separation time is corrected (case overview), these open tasks will be
            recalculated. Old due dates are retained and retrospective moves appear in the exception
            history.
          </p>
          <ul>
            {impact.map((t) => (
              <li key={t.id}>
                {t.title} ({humanize(t.department)}) - currently due{' '}
                {t.dueAt ? formatInstant(t.dueAt) : '-'} - based on the{' '}
                {humanize(t.basis).toLowerCase()}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.instances.length > 0 ? assignment : null}
    </>
  );
}
