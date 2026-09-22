import type { Metadata } from 'next';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field } from '@/components/forms';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  BASELINE_EVENT_TYPES,
  MISSING_REASONS,
  TIMELINE_CHIPS,
  formatDateOnly,
  formatInstant,
  separationProfile,
  humanizeAuditEvent,
  type RequiredActionRow,
  type TimelineChip,
} from '@exit/domain';
import {
  ServiceError,
  caseProgressSummary,
  getCase,
  listActiveUsers,
  listAttachments,
  listBaselineEvents,
  listCaseAudit,
  listNotes,
  listRequiredActions,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { CaseNav } from './CaseNav';
import {
  Activity,
  Chip,
  Event,
  Facts,
  Fact,
  ProviderPanel,
  Rail,
  Row,
  Rows,
  SectionHead,
} from '@/components/patterns';
import {
  AlertIcon,
  AuditIcon,
  CalendarIcon,
  ClockIcon,
  BookIcon,
  ChartIcon,
  DocumentIcon,
  FlowIcon,
  ShieldCheckIcon,
  UserIcon,
} from '@/components/icons';

/**
 * Which provider carries which benefit. Held here as presentation only - the
 * platform's own provider directory is what actually addresses the email.
 */
const BENEFIT_PROVIDERS = [
  {
    field: 'groupHealth' as const,
    provider: 'Group health provider',
    benefit: 'Group health cover',
    monogram: 'GH',
  },
  {
    field: 'groupLife' as const,
    provider: 'Group life provider',
    benefit: 'Group life cover',
    monogram: 'GL',
  },
];

/** The section takes its tone from the least settled benefit on the case. */
function benefitsTone(b: { groupHealth: string; groupLife: string }) {
  if (b.groupHealth === 'UNKNOWN' || b.groupLife === 'UNKNOWN') return 'pending' as const;
  return 'done' as const;
}
import { CaseHeader } from '@/components/CaseHeader';
import { ProgressStrip } from '@/components/ProgressStrip';
import { Feedback, RestrictedBanner } from '@/components/ui';
import {
  addNoteAction,
  addParticipantAction,
  changeEffectiveTimeAction,
  confirmBenefitsAction,
  recordBaselineAction,
  setRehireAction,
  transitionAction,
  updateDraftAction,
  uploadAttachmentAction,
} from '../actions';
import { humanize, roleList } from '@/lib/text';
import { EmptyState } from '@/components/EmptyState';

export const metadata: Metadata = { title: 'Case' };
export const dynamic = 'force-dynamic';

export default async function CaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;

  let data: Awaited<ReturnType<typeof getCase>>;
  try {
    data = await getCase(actor, id);
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
  const { case: c, capabilities: cap } = data;

  const activeChip: TimelineChip = (TIMELINE_CHIPS as readonly string[]).includes(
    sp.auditChip ?? '',
  )
    ? (sp.auditChip as TimelineChip)
    : 'ALL';
  const [attachments, baselineEvents, audit, notes, users] = await Promise.all([
    listAttachments(actor, id),
    cap.canRecordBaseline ? listBaselineEvents(actor, id) : Promise.resolve([]),
    listCaseAudit(actor, id, { chip: activeChip }),
    listNotes(actor, id),
    listActiveUsers(),
  ]);

  const dt = (d: Date | null) => (d ? formatInstant(d) : '-');
  const dateOnly = (d: Date) => formatDateOnly(d);
  const nameOf = (userId: string | null | undefined) =>
    userId ? (users.find((u) => u.userId === userId)?.displayName ?? null) : null;
  const progressSummary = await caseProgressSummary(actor, id).catch(() => null);
  const progress = progressSummary?.stages ?? [];
  // Directive 6.3 X/Y: exception-first required-actions summary.
  const required = await listRequiredActions(actor, id).catch(() => null);
  const requiredTotal = required
    ? required.summary.counts.attention +
      required.summary.counts.automatic +
      required.summary.counts.done
    : 0;

  return (
    <>
      <CaseHeader
        data={{
          caseId: id,
          caseNumber: c.caseNumber,
          status: c.status,
          classification: c.classification,
          recordPurpose: c.recordPurpose,
          measurementCohort: c.measurementCohort,
          employeeDisplayName: c.employeeDisplayName,
          jobTitle: c.jobTitle,
          department: c.department,
          location: c.location,
          departureType: c.departureType,
          effectiveSeparationAt: c.effectiveSeparationAt,
          ownerName: nameOf(c.ownerId) ?? 'HR Manager',
          officerName: nameOf((c as { assignedOfficerId?: string | null }).assignedOfficerId),
          managerName: (c as { managerName?: string | null }).managerName ?? null,
          managerUserName: nameOf((c as { managerUserId?: string | null }).managerUserId),
          confirmedLastDay: c.confirmedLastDay,
          nextAction: progressSummary?.nextAction ?? null,
          stages: progress,
          separation: data.separation,
          viewOnly: !cap.canEdit,
        }}
      />
      <Feedback err={sp.err} ok={sp.ok} />
      {c.recordPurpose !== 'OPERATIONAL' ? (
        <p className="banner-uat" role="note">
          UAT — SIMULATED OFFBOARDING — THIS IS NOT A REAL EMPLOYEE SEPARATION
        </p>
      ) : null}
      {c.classification === 'RESTRICTED' ? <RestrictedBanner /> : null}
      <CaseNav caseId={id} active="overview" />
      {/* DEC-066 section 23: a returned draft says why, where the officer
          will read it - not three screens away in the audit trail. */}
      {data.lastReturn ? (
        <div className="panel panel--edge panel--edge-attention" role="status">
          <p style={{ margin: 0 }}>
            <strong>Returned to draft</strong> by{' '}
            {nameOf(data.lastReturn.returnedById) ?? 'the HR Manager'} on{' '}
            {formatInstant(data.lastReturn.returnedAt)}
            {data.lastReturn.reason ? `: ${data.lastReturn.reason}` : '.'}
          </p>
          <p className="hint" style={{ margin: 'var(--space-2) 0 0' }}>
            Correct the case below and submit it for approval again. Nothing is sent while it is a
            draft.
          </p>
        </div>
      ) : null}
      {progress.length > 0 ? <ProgressStrip stages={progress} /> : null}

      {required && requiredTotal > 0 ? (
        <section aria-labelledby="required-h">
          <SectionHead
            id="required-h"
            icon={<AlertIcon />}
            tone={required.summary.attention.length > 0 ? 'attention' : 'done'}
            title="What this case needs"
            description="Outstanding work first, then what the platform is handling on its own. Settled work is folded away."
            aside={
              required.summary.attention.length > 0 ? (
                <Chip tone="attention">{required.summary.attention.length} to resolve</Chip>
              ) : (
                <Chip tone="done">Nothing outstanding</Chip>
              )
            }
          />
          {required.summary.attention.length > 0 ? (
            <Rows label="Outstanding actions">
              {required.summary.attention.map((r: RequiredActionRow) => (
                <Row
                  key={r.key}
                  tone={r.status === 'OVERDUE' || r.status === 'FAILED' ? 'critical' : 'attention'}
                  mark={
                    r.status === 'OVERDUE' || r.status === 'FAILED' ? <AlertIcon /> : <ClockIcon />
                  }
                  title={r.label}
                  sub={r.detail}
                  facts={
                    <Chip
                      tone={
                        r.status === 'OVERDUE' || r.status === 'FAILED' ? 'critical' : 'attention'
                      }
                    >
                      {r.status === 'FAILED'
                        ? 'Failed'
                        : r.status === 'OVERDUE'
                          ? 'Overdue'
                          : 'Needs a decision'}
                    </Chip>
                  }
                  action={
                    <Link href={r.href} className="button secondary">
                      Resolve
                    </Link>
                  }
                />
              ))}
            </Rows>
          ) : (
            <p className="ok-summary" role="status">
              Nothing needs your attention on this case.
            </p>
          )}

          {required.summary.automatic.length > 0 ? (
            <div className="well" style={{ marginTop: 'var(--space-4)' }}>
              {/* A labelled group of work deserves a real heading, not a
                  styled span: it is how the section is reached. */}
              <h3 className="label" style={{ margin: 0 }}>
                In progress automatically
              </h3>
              <ul className="plain-list" style={{ marginTop: 'var(--space-2)' }}>
                {required.summary.automatic.map((r: RequiredActionRow) => (
                  <li key={r.key}>
                    <span className="value">{r.label}</span>{' '}
                    <span className="meta">- {r.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {required.summary.done.length > 0 ? (
            <details className="action" style={{ marginTop: 'var(--space-3)' }}>
              <summary>Settled ({required.summary.counts.done})</summary>
              <ul className="plain-list">
                {required.summary.done.map((r: RequiredActionRow) => (
                  <li key={r.key} className="meta">
                    {r.label} - {r.status === 'NOT_APPLICABLE' ? 'not applicable' : 'completed'} (
                    {r.detail})
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {/* Level 2 (owner directive, 2026-09-22): the two cards a case is read
          from sit side by side where there is room and stack below it. The
          heading lives inside the card like every other section's. */}
      <div className="case-grid">
        <section aria-labelledby="details-h" className="panel">
          <SectionHead id="details-h" icon={<CalendarIcon />} title="Exit details" />
          {/* Dates carry the weight here: they are what the rest of the case is
              timed against, so they are set louder than the values beside them. */}
          <Facts className="facts--pairs">
            <Fact label="Separation type">{data.separation.label}</Fact>
            <Fact label={data.separation.receivedDateLabel}>
              {dt(c.receivedAt)}
              <span className="meta"> · {c.receiptSource}</span>
            </Fact>
            <Fact label="Employment ends (last working day)" isKey>
              {c.confirmedLastDay ? formatDateOnly(c.confirmedLastDay) : 'Not recorded'}
            </Fact>
            <Fact label="Separation effective at" isKey>
              {c.effectiveSeparationAt ? formatInstant(c.effectiveSeparationAt) : 'Not recorded'}
            </Fact>
            <Fact label="Reason category">
              {c.reasonCategory
                ? `${c.reasonCategory.label}${c.reasonCategory.isTestOnly ? ' (TEST ONLY)' : ''}`
                : `None recorded (${humanize(c.reasonCaptureStatus).toLowerCase()})`}
            </Fact>
            <Fact label="Reason notes">
              {c.reasonNotesMasked ? (
                <em>Masked (restricted HR data)</em>
              ) : (
                c.reasonNotes || 'Not recorded'
              )}
            </Fact>
            <Fact label="Rehire eligibility">
              {c.rehireMasked ? (
                <em>Masked (HR Manager only)</em>
              ) : (
                humanize(c.rehireEligibility) || 'Not recorded'
              )}
            </Fact>
            {c.closeReason ? <Fact label="Closure reason">{c.closeReason}</Fact> : null}
          </Facts>

          {/* Editing a draft belongs with the values being edited (owner
            request, 2026-08-19): one disclosure inside the card instead of
            a second full-width section repeating the same fields. */}
          {cap.canEditDraft ? (
            <details className="action" id="edit-draft" style={{ marginTop: 'var(--space-4)' }}>
              <summary>Edit these details</summary>
              <form action={updateDraftAction} className="stack">
                <input type="hidden" name="caseId" value={c.id} />
                <div className="field">
                  <label htmlFor="e-recv">Date and Time Received</label>
                  <input id="e-recv" name="receivedAt" type="datetime-local" />
                  <p className="hint">Currently: {dt(c.receivedAt)}. Leave blank to keep.</p>
                </div>
                <div className="field">
                  <label htmlFor="e-recv-src">How It Was Received</label>
                  <select id="e-recv-src" name="receiptSourceKind" defaultValue="">
                    <option value="">(keep current)</option>
                    <option value="Signed letter">Signed letter</option>
                    <option value="Email">Email</option>
                    <option value="Verbal (in person)">Verbal (in person)</option>
                    <option value="Other">Other</option>
                  </select>
                  <p className="hint">Currently: {c.receiptSource}.</p>
                </div>
                <div className="field">
                  <label htmlFor="e-recv-detail">Describe How It Was Received</label>
                  <input
                    id="e-recv-detail"
                    name="receiptSourceDetail"
                    type="text"
                    maxLength={150}
                  />
                </div>
                {/* The date concepts a correction can touch are the ones this
                separation actually uses (DEC-058). One end date (DEC-064):
                the effective instant follows it at close of business, so no
                time is asked here; an exact-time correction is the HR
                Manager's audited "Change effective separation time". */}
                {data.separation.dates.confirmedLastDay !== undefined &&
                !separationProfile(data.separation.type).forbiddenDates.includes(
                  'confirmedLastDay',
                ) ? (
                  <div className="field">
                    <label htmlFor="e-last-day">Employment Ends (Last Working Day)</label>
                    <input id="e-last-day" name="confirmedLastDay" type="date" />
                    <p className="hint">
                      Currently: {c.confirmedLastDay ? dateOnly(c.confirmedLastDay) : 'not set'}.
                      Employment ends at close of business on this date.
                    </p>
                  </div>
                ) : null}
                {!separationProfile(data.separation.type).forbiddenDates.includes(
                  'contractEndDate',
                ) &&
                (separationProfile(data.separation.type).requiredDates.includes(
                  'contractEndDate',
                ) ||
                  c.contractEndDate) ? (
                  <div className="field">
                    <label htmlFor="e-contract-end">Contract End Date</label>
                    <input id="e-contract-end" name="contractEndDate" type="date" />
                    <p className="hint">
                      Currently: {c.contractEndDate ? dateOnly(c.contractEndDate) : 'not set'}.
                    </p>
                  </div>
                ) : null}
                {/* An unusual combination is accepted with an audited reason
                rather than blocked - a correction to a historical record has
                to be possible (directive 25, 31). */}
                <div className="field">
                  <label htmlFor="e-date-reason">Why are these dates correct? (if unusual)</label>
                  <input id="e-date-reason" name="dateOverrideReason" type="text" maxLength={500} />
                  <p className="hint">Recorded in the audit trail beside the dates it explains.</p>
                </div>
                <div className="field">
                  <label htmlFor="e-reason-status">Did the Employee Give a Reason?</label>
                  <select
                    id="e-reason-status"
                    name="reasonCaptureStatus"
                    defaultValue={c.reasonCaptureStatus}
                  >
                    <option value="PENDING">Not provided yet</option>
                    <option value="PROVIDED">Yes</option>
                    <option value="NOT_PROVIDED">No, they preferred not to say</option>
                    <option value="NOT_APPLICABLE">Not applicable</option>
                  </select>
                </div>
                {!c.reasonNotesMasked ? (
                  <div className="field field--reason-notes">
                    <label htmlFor="e-reason-notes">What Did They Say?</label>
                    <textarea
                      id="e-reason-notes"
                      name="reasonNotes"
                      rows={3}
                      maxLength={2000}
                      defaultValue={c.reasonNotes ?? ''}
                    />
                  </div>
                ) : null}
                {/* DEC-066 section 9: the benefits chosen at intake are
                    corrected here while the case is a draft. */}
                <fieldset className="stack">
                  <legend>Benefits and providers</legend>
                  <input type="hidden" name="benefitsSelected" value="true" />
                  <div className="choice-cards">
                    {BENEFIT_PROVIDERS.map((b) => (
                      <label key={b.field} className="choice-card">
                        <input
                          type="checkbox"
                          name={b.field}
                          value="YES"
                          defaultChecked={required?.benefits[b.field] === 'YES'}
                        />
                        <span className="choice-card__body">
                          <strong>{b.provider}</strong>
                          <span className="meta">{b.benefit} - tick if it applies</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <button type="submit">Save draft changes</button>
              </form>
            </details>
          ) : null}
        </section>

        <section aria-labelledby="who-h" className="panel">
          <SectionHead id="who-h" icon={<UserIcon />} tone="info" title="Employee record" />
          <Facts className="facts--pairs">
            <Fact label="Employee #" isKey>
              {c.employeeNumber ?? 'Not recorded'}
            </Fact>
            <Fact label="Position">{c.jobTitle || 'Not recorded'}</Fact>
            <Fact label="Department">{c.department || 'Not recorded'}</Fact>
            <Fact label="Location">{c.location || 'Not recorded'}</Fact>
            <Fact label="Reporting manager">{c.managerName ?? 'Not recorded'}</Fact>
          </Facts>
        </section>
      </div>

      {(cap.canChangeEffectiveTime || cap.canCorrect || cap.canSetRehire) && !cap.canEditDraft ? (
        <section aria-labelledby="corr-h" className="panel">
          <SectionHead
            id="corr-h"
            icon={<ShieldCheckIcon />}
            tone="pending"
            title="Audited corrections"
            description="Changes to a live case that alter what the workflow schedules. Each one is recorded with a reason."
          />
          <div className="actions-row">
            {cap.canChangeEffectiveTime ? (
              <details className="action">
                <summary>Change effective separation time</summary>
                <form action={changeEffectiveTimeAction} className="stack">
                  <input type="hidden" name="caseId" value={c.id} />
                  <div className="field">
                    <label htmlFor="corr-eff">New Effective Date and Exact Time (Required)</label>
                    <input
                      id="corr-eff"
                      name="effectiveSeparationAt"
                      type="datetime-local"
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="corr-eff-reason">Reason (Required, Audited)</label>
                    <textarea id="corr-eff-reason" name="reason" rows={2} required />
                  </div>
                  <button type="submit">Change time (audited)</button>
                </form>
              </details>
            ) : null}
            {cap.canCorrect && c.status === 'DRAFT' ? null : null}
            {cap.canSetRehire ? (
              <details className="action">
                <summary>Set rehire eligibility (restricted)</summary>
                <form action={setRehireAction} className="stack">
                  <input type="hidden" name="caseId" value={c.id} />
                  <div className="field">
                    <label htmlFor="rehire">Rehire Eligibility</label>
                    <select
                      id="rehire"
                      name="rehireEligibility"
                      defaultValue={c.rehireEligibility ?? ''}
                    >
                      <option value="">(clear)</option>
                      <option value="ELIGIBLE">Eligible</option>
                      <option value="NOT_ELIGIBLE">Not eligible</option>
                      <option value="CONDITIONAL">Conditional</option>
                    </select>
                    <p className="hint">
                      Visible to HR Managers only; every view and change is audited.
                    </p>
                  </div>
                  <button type="submit">Save</button>
                </form>
              </details>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Final-product surface (owner request, 2026-08-17): the record-purpose
          correction control left the UI with the classification choice; the
          audited service path remains for legacy-record housekeeping. */}

      {required ? (
        <section aria-labelledby="benefits-h">
          <SectionHead
            id="benefits-h"
            icon={<ShieldCheckIcon />}
            tone={benefitsTone(required.benefits)}
            title="Benefits and providers"
            aside={
              <>
                {required.benefits.confirmedAt ? (
                  <Chip tone="done">
                    {required.benefits.source === 'INTAKE' ? 'Selected at intake' : 'Confirmed'}
                  </Chip>
                ) : (
                  <Chip tone="attention">Not yet decided</Chip>
                )}
                {c.status === 'DRAFT' && cap.canEditDraft ? (
                  // DEC-066 section 9: the selection was made at intake; a
                  // draft corrects it from the same edit experience as the dates.
                  <a href="#edit-draft" className="button secondary compact">
                    Edit selections
                  </a>
                ) : null}
              </>
            }
          />

          {BENEFIT_PROVIDERS.map((b) => {
            const applies = required.benefits[b.field];
            return (
              <ProviderPanel
                key={b.field}
                monogram={b.monogram}
                name={b.provider}
                subtitle={b.benefit}
                status={
                  applies === 'YES' ? (
                    <Chip tone="progress">Included</Chip>
                  ) : applies === 'NO' ? (
                    <Chip tone="done">Not applicable</Chip>
                  ) : (
                    <Chip tone="attention">Not yet decided</Chip>
                  )
                }
                footer={
                  <span className="meta">
                    {applies === 'YES'
                      ? c.status === 'DRAFT'
                        ? 'The provider notification is prepared once the case is approved and active.'
                        : 'The removal email is prepared for this case and appears under Email actions.'
                      : applies === 'NO'
                        ? 'No provider notification is raised for this employee.'
                        : 'Nothing is sent until this benefit is decided.'}
                  </span>
                }
              >
                {/* The provider's own progression, so it is obvious how far
                    this one benefit has travelled rather than the case as a
                    whole. */}
                <Rail
                  label={`${b.provider} progress`}
                  steps={[
                    {
                      name: 'Benefit selected',
                      state: applies === 'UNKNOWN' ? 'current' : 'done',
                      meta: required.benefits.confirmedAt
                        ? formatInstant(required.benefits.confirmedAt)
                        : 'Awaiting HR',
                    },
                    {
                      name: 'Removal prepared',
                      // Prepared only once the case is approved and active
                      // (DEC-066): before that the selection is a plan.
                      state:
                        applies === 'YES' && !['DRAFT', 'PENDING_HR_REVIEW'].includes(c.status)
                          ? 'done'
                          : 'todo',
                      meta:
                        applies === 'NO'
                          ? 'Not applicable'
                          : applies === 'YES' && ['DRAFT', 'PENDING_HR_REVIEW'].includes(c.status)
                            ? 'After approval'
                            : undefined,
                    },
                    {
                      name: 'Sent to provider',
                      state:
                        applies === 'YES' && !['DRAFT', 'PENDING_HR_REVIEW'].includes(c.status)
                          ? 'current'
                          : 'todo',
                      meta:
                        applies === 'YES' && !['DRAFT', 'PENDING_HR_REVIEW'].includes(c.status)
                          ? 'See Email actions'
                          : undefined,
                    },
                    { name: 'Provider confirmed', state: 'todo' },
                  ]}
                />
              </ProviderPanel>
            );
          })}

          {/* DEC-066 section 5: once the case leaves DRAFT the selection is an
              approved fact. Only the HR Manager amends it, and the amendment
              is an audited post-approval correction. */}
          {required.canConfirmBenefits && c.status !== 'DRAFT' ? (
            <details
              className="action"
              open={
                required.benefits.groupHealth === 'UNKNOWN' ||
                required.benefits.groupLife === 'UNKNOWN'
              }
            >
              <summary>Correct the approved benefits selection (HR Manager, audited)</summary>
              <form action={confirmBenefitsAction} className="stack">
                <input type="hidden" name="caseId" value={c.id} />
                <div className="field">
                  <label htmlFor="ben-health">Group Health Applies to This Employee?</label>
                  <select
                    id="ben-health"
                    name="groupHealth"
                    defaultValue={required.benefits.groupHealth}
                  >
                    <option value="YES">Yes</option>
                    <option value="NO">No</option>
                    <option value="UNKNOWN">Unknown</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="ben-life">Group Life Applies to This Employee?</label>
                  <select id="ben-life" name="groupLife" defaultValue={required.benefits.groupLife}>
                    <option value="YES">Yes</option>
                    <option value="NO">No</option>
                    <option value="UNKNOWN">Unknown</option>
                  </select>
                </div>
                <p className="hint">
                  &quot;Yes&quot; prepares the matching provider notification for the assigned HR
                  Officer to send; &quot;No&quot; removes it. The change is recorded against the
                  approved case.
                </p>
                <button type="submit">Confirm applicability</button>
              </form>
            </details>
          ) : null}
        </section>
      ) : null}

      {(cap.canSubmit || cap.canDecideApproval || cap.canCancel || cap.canVoid) && (
        <section aria-labelledby="actions-h" className="panel">
          <SectionHead id="actions-h" icon={<FlowIcon />} title="Move this case" />
          <div className="actions-row">
            {/* DEC-066: the one HR Manager decision lives on the Case Approval
                Summary, where the whole plan is in view - never as a bare
                button among unrelated actions. */}
            {cap.canDecideApproval ? (
              <Link href={`/cases/${c.id}/approve`} className="button button--primary">
                Review and approve
              </Link>
            ) : cap.canSubmit ? (
              <form action={transitionAction}>
                <input type="hidden" name="caseId" value={c.id} />
                <input type="hidden" name="action" value="submit" />
                <button type="submit">Submit for approval</button>
              </form>
            ) : null}
            {cap.canCancel ? (
              <ConfirmDialog
                trigger="Cancel case (non-event)"
                title="Cancel this case?"
                consequence={[
                  'The offboarding stops here: open tasks are closed and no further email goes out.',
                  'Use this when the departure did not happen - the employee withdrew, or stayed.',
                  'Nothing is deleted. The case, its history and this reason stay on the record.',
                ]}
              >
                <form action={transitionAction} className="stack">
                  <input type="hidden" name="caseId" value={c.id} />
                  <input type="hidden" name="action" value="cancel" />
                  <Field
                    id="cancel-reason"
                    label="Why is this case being cancelled?"
                    required
                    hint="Recorded against the case and readable in the audit trail."
                  >
                    <textarea id="cancel-reason" name="reason" rows={2} required />
                  </Field>
                  <button type="submit" className="danger">
                    Cancel case
                  </button>
                </form>
              </ConfirmDialog>
            ) : null}
            {cap.canVoid ? (
              <ConfirmDialog
                trigger="Void case (entered in error)"
                title="Void this case?"
                consequence={[
                  'This says the case should never have existed - it was raised in error.',
                  'It is not the same as cancelling: cancel means the departure did not happen.',
                  'Nothing is deleted. The case stays readable, marked void, with this reason.',
                ]}
              >
                <form action={transitionAction} className="stack">
                  <input type="hidden" name="caseId" value={c.id} />
                  <input type="hidden" name="action" value="void" />
                  <Field
                    id="void-reason"
                    label="Why was this case raised in error?"
                    required
                    hint="Recorded against the case and readable in the audit trail."
                  >
                    <textarea id="void-reason" name="reason" rows={2} required />
                  </Field>
                  <button type="submit" className="danger">
                    Void case
                  </button>
                </form>
              </ConfirmDialog>
            ) : null}
          </div>
        </section>
      )}

      {c.classification === 'RESTRICTED' ||
      c.participants.some((p) => p.participantRole === 'HR_SUPPORT') ? (
        <section aria-labelledby="participants-h" className="panel">
          <h2 id="participants-h" style={{ marginTop: 0 }}>
            Case Access
          </h2>
          <p className="hint">
            A restricted case is visible only to its accountable owner and the people listed here.
          </p>
          <ul>
            {c.participants.map((p) => (
              <li key={p.id}>
                {users.find((u) => u.userId === p.userId)?.displayName ?? p.userId} -{' '}
                {humanize(p.participantRole)}
                {p.reason ? ` (${p.reason})` : ''}
              </li>
            ))}
          </ul>
          {cap.canManageParticipants ? (
            <details className="action">
              <summary>Add participant</summary>
              <form action={addParticipantAction} className="stack">
                <input type="hidden" name="caseId" value={c.id} />
                <div className="field">
                  <label htmlFor="p-user">User</label>
                  <select id="p-user" name="userId" required defaultValue="">
                    <option value="" disabled>
                      Choose...
                    </option>
                    {users
                      .filter((u) => !c.participants.some((p) => p.userId === u.userId))
                      .map((u) => (
                        <option key={u.userId} value={u.userId}>
                          {u.displayName} ({roleList(u.roles)})
                        </option>
                      ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="p-role">Participant Role</label>
                  <select id="p-role" name="participantRole" defaultValue="HR_SUPPORT">
                    <option value="HR_SUPPORT">HR support (requires an HR role)</option>
                  </select>
                  <p className="hint">
                    IT, Finance and the line manager are reached by controlled email - none of them
                    holds a login or a participant seat here.
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="p-reason">Reason (Required, Audited)</label>
                  <input id="p-reason" name="reason" type="text" required maxLength={200} />
                </div>
                <button type="submit">Add participant</button>
              </form>
            </details>
          ) : null}
        </section>
      ) : null}

      {cap.canUpload || attachments.length > 0 ? (
        <section aria-labelledby="files-h" className="panel">
          <SectionHead
            id="files-h"
            icon={<DocumentIcon />}
            tone="info"
            title="Attachments"
            description="Scanned resignation letters, signed forms and supporting evidence held against this case."
          />
          {attachments.length ? (
            <div className="table-wrap" tabIndex={0}>
              <table className="data">
                <caption>Uploaded files (quarantined until scanned)</caption>
                <thead>
                  <tr>
                    <th scope="col">File</th>
                    <th scope="col">Purpose</th>
                    <th scope="col">Size</th>
                    <th scope="col">Scan status</th>
                    <th scope="col">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {attachments.map((a) => (
                    <tr key={a.id}>
                      <td>{a.fileName}</td>
                      <td>{humanize(a.purpose)}</td>
                      <td>{Math.ceil(a.sizeBytes / 1024)} KB</td>
                      <td>
                        <span
                          className={`badge ${a.scanStatus === 'CLEAN' ? 'badge--success' : 'badge--warning'}`}
                        >
                          {humanize(a.scanStatus)}
                        </span>{' '}
                        <span className="hint">{a.scanNote}</span>
                      </td>
                      <td>
                        {a.scanStatus === 'CLEAN' && cap.canDownload ? (
                          <a href={`/api/attachments/${a.id}`}>Download</a>
                        ) : (
                          <em>not available</em>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<DocumentIcon />}
              title="No attachments"
              body="Resignation letters, signed forms and supporting evidence attached to this case appear here."
            />
          )}
          {cap.canUpload ? (
            <details className="action">
              <summary>Upload a file (pdf, png, jpg; max size per configuration)</summary>
              {/* React sets the encoding for a server-action form itself - stating it here
              only produced a console warning. */}
              <form action={uploadAttachmentAction} className="stack">
                <input type="hidden" name="caseId" value={c.id} />
                <div className="field">
                  <label htmlFor="up-file">File</label>
                  <input
                    id="up-file"
                    name="file"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="up-purpose">Purpose</label>
                  <select id="up-purpose" name="purpose" defaultValue="RESIGNATION_LETTER">
                    <option value="RESIGNATION_LETTER">Resignation letter</option>
                    <option value="SUPPORTING_DOCUMENT">Supporting document</option>
                  </select>
                </div>
                <button type="submit">Upload</button>
              </form>
            </details>
          ) : null}
        </section>
      ) : null}

      {/* Baseline facts measure the old process against a case that is
          being worked; a draft has nothing to measure yet, so the section
          waits for approval (owner directive, 2026-09-22). */}
      {cap.canRecordBaseline && c.status !== 'DRAFT' ? (
        <section aria-labelledby="baseline-h" className="panel">
          <SectionHead
            id="baseline-h"
            icon={<ChartIcon />}
            tone="info"
            title="Baseline facts"
            description="Manually measured figures from the old process, kept so this one can be compared against it."
          />
          {baselineEvents.length ? (
            <div className="table-wrap" tabIndex={0}>
              <table className="data">
                <caption>Recorded facts; corrections supersede, originals stay visible</caption>
                <thead>
                  <tr>
                    <th scope="col">Fact</th>
                    <th scope="col">Occurred</th>
                    <th scope="col">Missing reason</th>
                    <th scope="col">Detail</th>
                    <th scope="col">Recorded</th>
                    <th scope="col">Superseded</th>
                  </tr>
                </thead>
                <tbody>
                  {baselineEvents.map((e) => (
                    <tr key={e.id} style={e.supersededAt ? { opacity: 0.6 } : undefined}>
                      <td>{humanize(e.eventType)}</td>
                      <td>{e.occurredAt ? formatInstant(e.occurredAt) : '-'}</td>
                      <td>{e.missingReason ?? '-'}</td>
                      <td>{e.detail ?? '-'}</td>
                      <td>{formatInstant(e.recordedAt)}</td>
                      <td>{e.supersededAt ? `yes - ${e.supersedeReason ?? ''}` : 'no'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<ChartIcon />}
              title="No baseline facts yet"
              body="Baseline facts are the manually measured figures used to compare the old process with this one."
            />
          )}
          <details className="action">
            <summary>Record a baseline fact</summary>
            <form action={recordBaselineAction} className="stack">
              <input type="hidden" name="caseId" value={c.id} />
              <div className="field">
                <label htmlFor="b-type">Fact Type</label>
                <select id="b-type" name="eventType" required defaultValue="">
                  <option value="" disabled>
                    Choose...
                  </option>
                  {BASELINE_EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {humanize(t)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="b-when">Event Date and Time (Leave Blank if Unknown)</label>
                <input id="b-when" name="occurredAt" type="datetime-local" />
                <p className="hint">
                  Do not backdate from memory; if unknown, choose a missing-data reason.
                </p>
              </div>
              <div className="field">
                <label htmlFor="b-missing">Missing-data Reason (When No Time)</label>
                <select id="b-missing" name="missingReason" defaultValue="">
                  <option value="">(not missing)</option>
                  {MISSING_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="b-note">Missing-data Note (Required for UNKNOWN_OTHER)</label>
                <input id="b-note" name="missingNote" type="text" maxLength={300} />
              </div>
              <div className="field">
                <label htmlFor="b-detail">Detail (Short, E.g. Notified Party)</label>
                <input id="b-detail" name="detail" type="text" maxLength={200} />
              </div>
              <div className="field">
                <label htmlFor="b-evidence">Evidence Reference (Location, Not Content)</label>
                <input id="b-evidence" name="evidenceRef" type="text" maxLength={300} />
              </div>
              <button type="submit">Record fact</button>
            </form>
          </details>
        </section>
      ) : null}

      {cap.canAddNote || notes.length > 0 ? (
        <section aria-labelledby="notes-h" className="panel">
          <SectionHead id="notes-h" icon={<BookIcon />} title="Internal notes" />
          {notes.length ? (
            <ul className="timeline">
              {notes.map((n) => (
                <li key={n.id}>
                  <span className="meta">
                    {formatInstant(n.createdAt)} - HR only
                    {n.supersedesId ? ' - revision' : ''}
                  </span>
                  <br />
                  {n.body}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<DocumentIcon />}
              title="No internal notes"
              body="Notes are visible to HR on this case and form part of the record."
            />
          )}
          {cap.canAddNote ? (
            <details className="action">
              <summary>Add note</summary>
              <form action={addNoteAction} className="stack">
                <input type="hidden" name="caseId" value={c.id} />
                <div className="field">
                  <label htmlFor="n-body">Note (1-4000 Characters)</label>
                  <textarea id="n-body" name="body" rows={3} required maxLength={4000} />
                </div>
                <input type="hidden" name="visibility" value="HR_ONLY" />
                <button type="submit">Add note</button>
              </form>
            </details>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="audit-h" className="panel">
        <SectionHead
          id="audit-h"
          icon={<AuditIcon />}
          tone="info"
          title="Case history"
          description="Every recorded event, newest first. The history is immutable evidence - nothing here can be edited or removed."
        />
        <nav aria-label="Audit filters" style={{ marginBottom: '0.6rem' }}>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.25rem',
            }}
          >
            {TIMELINE_CHIPS.map((chip) => (
              <li key={chip}>
                <Link
                  href={`/cases/${id}?auditChip=${chip}#audit-h`}
                  className="button secondary compact"
                  aria-current={activeChip === chip ? 'page' : undefined}
                  style={
                    activeChip === chip
                      ? { background: 'var(--accent)', color: 'var(--on-accent)' }
                      : { border: '1px solid transparent' }
                  }
                >
                  {chip.charAt(0) + chip.slice(1).toLowerCase()}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="timeline-scroll" tabIndex={0}>
          <Activity label="Case history">
            {[...audit].reverse().map((e) => (
              <Event
                key={e.id}
                time={formatInstant(e.occurredAt)}
                tone={
                  e.result === 'FAILURE'
                    ? 'critical'
                    : e.actorType === 'SYSTEM'
                      ? 'auto'
                      : undefined
                }
                automated={e.actorType === 'SYSTEM'}
                title={humanizeAuditEvent({
                  eventType: e.eventType as never,
                  result: e.result,
                  actorType: e.actorType,
                  actorDisplayName: e.actorId
                    ? (users.find((u) => u.userId === e.actorId)?.displayName ?? null)
                    : null,
                  metadata: e.metadata as never,
                })}
              />
            ))}
          </Activity>
        </div>
      </section>
    </>
  );
}
