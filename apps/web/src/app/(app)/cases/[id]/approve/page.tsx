import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field } from '@/components/forms';
import {
  ServiceError,
  getCase,
  getCaseApprovalSummary,
  READINESS_LABELS,
  type CommunicationReadiness,
  type PlannedDestination,
} from '@exit/db';
import { formatDateOnly, formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { humanize } from '@/lib/text';
import { CaseNav } from '../CaseNav';
import { transitionAction } from '../../actions';
import { Chip, Fact, Facts, SectionHead, initialsOf, type Tone } from '@/components/patterns';
import {
  CalendarIcon,
  CheckCircleIcon,
  DocumentIcon,
  FlowIcon,
  MailIcon,
  ShieldCheckIcon,
  UserIcon,
} from '@/components/icons';
import { ClassificationBadge, Feedback, RestrictedBanner, StatusBadge } from '@/components/ui';

export const metadata: Metadata = { title: 'Case Approval' };
export const dynamic = 'force-dynamic';

/**
 * Case Approval Summary (owner directive 2026-09-22, DEC-066).
 *
 * The one HR Manager decision on a case. It answers "what exactly am I
 * approving?" in one scan: the person, the exit, who will execute it, the
 * benefits and providers selected at intake, who will be contacted (with the
 * resolved destination and whether it is ready), the documents and forms the
 * case will produce, and what happens the moment it is approved. Approving
 * authorizes the assigned HR Officer to do all of it without coming back.
 */

const READINESS_TONE: Record<CommunicationReadiness, Tone> = {
  READY: 'done',
  NOT_REQUIRED: 'neutral',
  MISSING_RECIPIENT: 'critical',
  WAITING_ON_CASE: 'attention',
};

function Destination({ d, seesFull }: { d: PlannedDestination; seesFull: boolean }) {
  const source =
    d.source === 'CASE'
      ? 'from the case'
      : d.source === 'DIRECTORY'
        ? 'from the directory'
        : 'from configuration';
  return (
    <span className="meta">
      {seesFull ? <a href={`mailto:${d.address}`}>{d.address}</a> : d.address}
      {d.label && d.label !== d.address ? ` · ${d.label}` : ''} ({source})
    </span>
  );
}

export default async function CaseApprovalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;

  let summary: Awaited<ReturnType<typeof getCaseApprovalSummary>>;
  let view: Awaited<ReturnType<typeof getCase>>;
  try {
    [summary, view] = await Promise.all([getCaseApprovalSummary(actor, id), getCase(actor, id)]);
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'NOT_FOUND') notFound();
    if (e instanceof ServiceError && e.code === 'FORBIDDEN') {
      return (
        <>
          <h1>Restricted Case</h1>
          <p className="panel">
            You can see that this case exists, but its content requires explicit assignment.
          </p>
        </>
      );
    }
    throw e;
  }
  const s = summary;
  const cap = s.capabilities;
  const decidable = cap.canApprove || cap.canApproveDraft;
  const awaiting = s.status === 'PENDING_HR_REVIEW';
  const dt = (d: Date | null) => (d ? formatInstant(d) : 'Not recorded');
  const dateOnly = (d: Date | null) => (d ? formatDateOnly(d) : 'Not recorded');
  const benefitLabel = (v: string) =>
    v === 'YES' ? 'Included' : v === 'NO' ? 'Not applicable' : 'Not yet decided';
  const benefitTone = (v: string): Tone =>
    v === 'YES' ? 'progress' : v === 'NO' ? 'neutral' : 'attention';
  const anyBenefit = s.benefits.groupHealth === 'YES' || s.benefits.groupLife === 'YES';

  return (
    <>
      <header className="case-head approval-head" aria-label="Case approval summary">
        <div className="case-head__top">
          <div className="identity">
            <span className="identity__avatar identity__avatar--lg" aria-hidden>
              {initialsOf(s.employee.displayName)}
            </span>
            <div className="identity__body">
              <h1 className="case-head__name">
                <span className="eyebrow" style={{ color: 'var(--on-brand-dim)' }}>
                  Case Approval Summary · {s.caseNumber}
                </span>
                <span className="sr-only"> - </span>
                {s.employee.displayName}
              </h1>
              <p className="case-head__role">
                {s.employee.jobTitle ? `${s.employee.jobTitle} · ` : ''}
                {s.employee.department}
              </p>
              <div className="case-head__chips">
                <Chip>{s.exit.separationLabel}</Chip>
                <StatusBadge status={s.status as never} />
                <ClassificationBadge classification={s.classification} />
              </div>
            </div>
          </div>
          {decidable ? (
            <div className="approval-head__actions">
              <a href="#decision-h" className="button button--primary">
                Approve Case
              </a>
              {cap.canReturn ? (
                <a href="#decision-h" className="button secondary">
                  Return to Draft
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="case-head__facts">
          <div className="case-head__fact">
            <span className="label">Employment ends</span>
            <span className="value">{dateOnly(s.exit.confirmedLastDay)}</span>
          </div>
          <div className="case-head__fact">
            <span className="label">Assigned HR Officer</span>
            <span className="value">{s.ownership.assignedOfficerName ?? 'Unassigned'}</span>
          </div>
          <div className="case-head__fact">
            <span className="label">Status</span>
            <span className="value">
              {awaiting
                ? 'Awaiting Approval'
                : s.status === 'DRAFT'
                  ? 'Draft - approvable by the HR Manager'
                  : humanize(s.status)}
            </span>
          </div>
        </div>
      </header>
      <Feedback err={sp.err} ok={sp.ok} />
      {s.recordPurpose !== 'OPERATIONAL' ? (
        <p className="banner-uat" role="note">
          UAT — SIMULATED OFFBOARDING — THIS IS NOT A REAL EMPLOYEE SEPARATION
        </p>
      ) : null}
      {s.classification === 'RESTRICTED' ? <RestrictedBanner /> : null}
      <CaseNav caseId={id} active="approval" />

      {!awaiting && s.status !== 'DRAFT' ? (
        <p className="panel panel--edge panel--edge-done" role="status">
          This case was decided: it is {humanize(s.status).toLowerCase()}. The summary below is what
          the approval covered. <Link href={`/cases/${id}`}>Open the case overview</Link>.
        </p>
      ) : null}

      {/* Level 2: the case, read from two cards side by side. */}
      <div className="case-grid">
        <section aria-labelledby="ap-emp-h" className="panel">
          <SectionHead id="ap-emp-h" icon={<UserIcon />} tone="info" title="Employee Record" />
          <Facts className="facts--pairs">
            <Fact label="Employee" isKey>
              {s.employee.displayName}
            </Fact>
            <Fact label="Employee #">{s.employee.employeeNumber ?? 'Not recorded'}</Fact>
            <Fact label="Job title">{s.employee.jobTitle || 'Not recorded'}</Fact>
            <Fact label="Department">{s.employee.department || 'Not recorded'}</Fact>
            <Fact label="Location">{s.employee.location || 'Not recorded'}</Fact>
            <Fact label="Reporting manager">{s.employee.managerName ?? 'Not recorded'}</Fact>
            <Fact label="Work email">{s.employee.workEmailMask ?? 'Not recorded'}</Fact>
          </Facts>
        </section>

        <section aria-labelledby="ap-exit-h" className="panel">
          <SectionHead id="ap-exit-h" icon={<CalendarIcon />} title="Exit Details" />
          <Facts className="facts--pairs">
            <Fact label="Separation type">{s.exit.separationLabel}</Fact>
            <Fact label="Classification">
              {s.exit.initiator === 'EMPLOYER'
                ? 'Employer-initiated'
                : s.exit.initiator === 'EMPLOYEE'
                  ? 'Employee-initiated'
                  : s.exit.initiator === 'CONTRACT'
                    ? 'Contract end'
                    : 'Unspecified'}
              {s.exit.noticeArrangement ? ` · ${s.exit.noticeArrangement}` : ''}
            </Fact>
            <Fact label={s.exit.receivedDateLabel}>
              {dt(s.exit.receivedAt)}
              <span className="meta"> · {s.exit.receiptSource}</span>
            </Fact>
            {s.exit.contractEndDate ? (
              <Fact label="Contract ends">{dateOnly(s.exit.contractEndDate)}</Fact>
            ) : null}
            <Fact label="Employment ends (last working day)" isKey>
              {dateOnly(s.exit.confirmedLastDay)}
            </Fact>
            <Fact label="Separation effective at" isKey>
              {dt(s.exit.effectiveSeparationAt)}
            </Fact>
            {s.exit.separationTypeDetail ? (
              <Fact label="What kind of separation">{s.exit.separationTypeDetail}</Fact>
            ) : null}
            {s.exit.authorizedByName ? (
              <Fact label="Authorized by">{s.exit.authorizedByName}</Fact>
            ) : null}
            <Fact label="Reason">
              {s.exit.reasonCategory ??
                `None recorded (${humanize(s.exit.reasonCaptureStatus).toLowerCase()})`}
            </Fact>
            {s.exit.dateOverrideReason ? (
              <Fact label="Why the dates are correct">{s.exit.dateOverrideReason}</Fact>
            ) : null}
          </Facts>
        </section>
      </div>

      <div className="case-grid">
        <section aria-labelledby="ap-own-h" className="panel">
          <SectionHead id="ap-own-h" icon={<ShieldCheckIcon />} title="HR Ownership" />
          <Facts className="facts--pairs">
            <Fact label="Assigned HR Officer" isKey>
              {s.ownership.assignedOfficerName ?? 'Unassigned - assign before activation'}
            </Fact>
            <Fact label="Created by">{s.ownership.createdByName}</Fact>
            <Fact label="Created">{formatInstant(s.ownership.createdAt)}</Fact>
            <Fact label="Submitted">
              {s.ownership.submittedAt
                ? `${formatInstant(s.ownership.submittedAt)} by ${s.ownership.submittedByName ?? 'HR'}`
                : 'Not submitted yet'}
            </Fact>
            <Fact label="Current status">
              <StatusBadge status={s.status as never} />
            </Fact>
          </Facts>
        </section>

        <section aria-labelledby="ap-ben-h" className="panel">
          <SectionHead
            id="ap-ben-h"
            icon={<ShieldCheckIcon />}
            tone={anyBenefit ? 'progress' : 'neutral'}
            title="Benefits & Providers"
          />
          {s.benefits.groupHealth === 'NO' && s.benefits.groupLife === 'NO' ? (
            <p className="ok-summary" role="status">
              No benefit/provider actions selected
            </p>
          ) : (
            <ul className="plain-list" aria-label="Benefits and providers selected">
              <li className="audience__item">
                <span className="value">Group health provider</span>
                <Chip tone={benefitTone(s.benefits.groupHealth)}>
                  {benefitLabel(s.benefits.groupHealth)}
                </Chip>
              </li>
              <li className="audience__item">
                <span className="value">Group life provider</span>
                <Chip tone={benefitTone(s.benefits.groupLife)}>
                  {benefitLabel(s.benefits.groupLife)}
                </Chip>
              </li>
            </ul>
          )}
          {s.benefits.confirmedAt ? (
            <p className="meta" style={{ marginBottom: 0 }}>
              Selected {formatInstant(s.benefits.confirmedAt)}
              {s.benefits.source === 'INTAKE' ? ' during case creation' : ''}.
            </p>
          ) : null}
        </section>
      </div>

      <section aria-labelledby="ap-comms-h" className="panel">
        <SectionHead
          id="ap-comms-h"
          icon={<MailIcon />}
          tone={s.communications.missingRecipients > 0 ? 'attention' : 'done'}
          title="Notifications & Recipients"
          aside={
            s.communications.missingRecipients > 0 ? (
              <Chip tone="attention">
                {s.communications.missingRecipients} recipient
                {s.communications.missingRecipients === 1 ? '' : 's'} to resolve
              </Chip>
            ) : s.communications.groups.length > 0 ? (
              <Chip tone="done">Recipients ready</Chip>
            ) : null
          }
        />
        {s.communications.unavailableReason ? (
          <p className="hint" role="note">
            {s.communications.unavailableReason}
          </p>
        ) : (
          s.communications.groups.map((g) => (
            <div className="audience" key={g.audience}>
              <div className="audience__who">
                <span className="value">{g.label}</span>
                <Chip tone={READINESS_TONE[g.readiness]}>{READINESS_LABELS[g.readiness]}</Chip>
              </div>
              <ul className="audience__list" aria-label={`${g.label} communications`}>
                {g.items.map((item) => (
                  <li key={item.key} className="audience__item">
                    <span className={item.applicable ? 'value' : 'meta'}>{item.purpose}</span>
                    {!item.applicable ? (
                      <Chip tone="neutral">Not required</Chip>
                    ) : item.to ? (
                      <Destination d={item.to} seesFull={cap.seesFullAddresses} />
                    ) : (
                      <Chip tone={READINESS_TONE[item.readiness]}>
                        {READINESS_LABELS[item.readiness]}
                      </Chip>
                    )}
                    {item.applicable && item.cc.length > 0 ? (
                      <span className="meta">
                        copying{' '}
                        {item.cc
                          .map((c) => (cap.seesFullAddresses ? c.address : c.label))
                          .join(', ')}
                      </span>
                    ) : null}
                    {item.applicable ? <span className="meta">{item.timing}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <div className="case-grid">
        <section aria-labelledby="ap-docs-h" className="panel">
          <SectionHead id="ap-docs-h" icon={<DocumentIcon />} title="Documents & Forms" />
          <ul className="plain-list" aria-label="Planned documents and forms">
            {s.artifacts.map((a) => (
              <li key={a.key} className="audience__item">
                <span className={a.applicable ? 'value' : 'meta'}>{a.title}</span>
                <Chip tone={a.applicable ? 'progress' : 'neutral'}>
                  {a.applicable ? 'Applicable' : 'Not applicable'}
                </Chip>
                {a.applicable ? <span className="meta">{a.note}</span> : null}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="ap-wf-h" className="panel">
          <SectionHead id="ap-wf-h" icon={<FlowIcon />} title="Workflow Summary" />
          <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
            <li>The case is approved and the employee snapshot is captured.</li>
            <li>
              {s.ownership.assignedOfficerName ?? 'The assigned HR Officer'} confirms the
              responsibility plan and activates the workflow
              {s.workflow.definitionName
                ? ` (${s.workflow.definitionName}, version ${s.workflow.definitionVersion}, ${s.workflow.hrTaskCount} HR tasks)`
                : ''}
              .
            </li>
            <li>The applicable documents and forms above become available to finalize and send.</li>
            <li>
              Notifications are prepared according to configuration; routine internal emails go
              automatically, the rest are released by the assigned HR Officer.
            </li>
            <li>IT, Finance and provider actions are initiated where applicable.</li>
            <li>Completion is tracked on the case through to final clearance.</li>
          </ol>
          {s.workflow.managerTaskCount > 0 ? (
            <p className="hint" role="note">
              The workflow contains {s.workflow.managerTaskCount} HR Manager task
              {s.workflow.managerTaskCount === 1 ? '' : 's'} (the final clearance review).
            </p>
          ) : null}
        </section>
      </div>

      {decidable ? (
        <section aria-labelledby="decision-h" className="panel approval-decision">
          <SectionHead
            id="decision-h"
            icon={<CheckCircleIcon />}
            tone="attention"
            title="Decision"
          />
          <p className="approval-decision__meaning">
            Approving this case authorizes the assigned HR Officer to carry out the offboarding
            workflow shown above, including generating and sending the applicable documents, forms
            and notifications. No further HR Manager approval is asked for those steps.
          </p>
          {!s.ownership.assignedOfficerName ? (
            <p className="hint" role="note">
              No HR Officer is assigned yet. Approval still stands; assign the officer on the
              Assignment tab before the workflow is activated.
            </p>
          ) : null}
          <div className="actions-row">
            <ConfirmDialog
              trigger="Approve Case"
              triggerClassName="button--primary"
              title="Approve this case?"
              consequence={[
                'The employee snapshot is captured and the case moves to Approved.',
                `${s.ownership.assignedOfficerName ?? 'The assigned HR Officer'} is authorized to finalize and send the documents, forms and notifications listed above without further approval.`,
                'Every downstream action stays audited; you keep full oversight and can intervene at any time.',
              ]}
            >
              <form action={transitionAction} className="stack">
                <input type="hidden" name="caseId" value={id} />
                <input
                  type="hidden"
                  name="action"
                  value={cap.canApproveDraft && !awaiting ? 'submitAndApprove' : 'approve'}
                />
                <button type="submit" className="button--primary">
                  Confirm approval
                </button>
              </form>
            </ConfirmDialog>
            {cap.canReturn ? (
              <details className="action">
                <summary>Return to Draft</summary>
                <form action={transitionAction} className="stack">
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="action" value="return" />
                  <Field
                    id="return-reason"
                    label="What needs to change?"
                    required
                    hint="The HR Officer sees this on the draft. Nothing is sent while the case is returned."
                  >
                    <textarea id="return-reason" name="reason" rows={3} required maxLength={1000} />
                  </Field>
                  <button type="submit" className="secondary">
                    Return to draft
                  </button>
                </form>
              </details>
            ) : null}
            <Link href={`/cases/${id}`} className="button secondary">
              Back to overview
            </Link>
          </div>
        </section>
      ) : view.capabilities.canEdit && awaiting ? (
        <p className="panel panel--edge panel--edge-pending" role="status">
          This case is awaiting HR Manager approval. Nothing below is sent until it is approved.
        </p>
      ) : null}
    </>
  );
}
