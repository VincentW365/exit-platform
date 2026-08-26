import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  BASELINE_EVENT_TYPES,
  MISSING_REASONS,
  TIMELINE_CHIPS,
  formatDateOnly,
  formatInstant,
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

      <section aria-labelledby="details-h">
        <SectionHead
          id="details-h"
          icon={<CalendarIcon />}
          title="Exit details"
          description="The dates and classifications this case is worked against. The separation instant is the one the workflow schedules from."
        />
        {/* Dates carry the weight here: they are what the rest of the case is
            timed against, so they are set louder than the values beside them. */}
        <div className="panel">
          <Facts>
            <Fact label="Final working date" isKey>
              {c.confirmedLastDay ? formatDateOnly(c.confirmedLastDay) : 'Not set'}
            </Fact>
            <Fact label="Employment ends" isKey>
              {dt(c.effectiveSeparationAt)}
            </Fact>
            <Fact label="Resignation received">
              {dt(c.receivedAt)}
              <span className="meta"> · {c.receiptSource}</span>
            </Fact>
            <Fact label="Reason category">
              {c.reasonCategory
                ? `${c.reasonCategory.label}${c.reasonCategory.isTestOnly ? ' (TEST ONLY)' : ''}`
                : `None recorded (${humanize(c.reasonCaptureStatus).toLowerCase()})`}
            </Fact>
            <Fact label="Reason notes">
              {c.reasonNotesMasked ? <em>Masked (restricted HR data)</em> : (c.reasonNotes ?? '-')}
            </Fact>
            <Fact label="Rehire eligibility">
              {c.rehireMasked ? (
                <em>Masked (HR Manager only)</em>
              ) : (
                humanize(c.rehireEligibility) || 'Not set'
              )}
            </Fact>
            {c.closeReason ? <Fact label="Closure reason">{c.closeReason}</Fact> : null}
          </Facts>
        </div>
      </section>

      <section aria-labelledby="who-h">
        <SectionHead
          id="who-h"
          icon={<UserIcon />}
          tone="info"
          title="Employee record"
          description="Confirmed from the company directory when the case was approved, and held unchanged from that point."
        />
        <div className="panel">
          <Facts>
            <Fact label="Employee #" isKey>
              {c.employeeNumber ?? <span className="meta">Not recorded in BambooHR</span>}
            </Fact>
            <Fact label="Department">{c.department}</Fact>
            <Fact label="Location">{c.location}</Fact>
            <Fact label="Position">{c.jobTitle ?? '-'}</Fact>
          </Facts>
          {/* Provenance is reference material, not headline information. */}
          <div className="well" style={{ marginTop: 'var(--space-4)' }}>
            <span className="label">Record provenance</span>
            <p className="meta" style={{ margin: 'var(--space-1) 0 0' }}>
              {humanize(c.employeeSourceSystem)} directory record {c.employeeSourceId}.{' '}
              {c.snapshot ? (
                <>
                  Snapshot captured {formatInstant(c.snapshot.capturedAt)} (checksum{' '}
                  <code>{c.snapshot.checksum.slice(0, 12)}...</code>, source retrieved{' '}
                  {formatInstant(c.snapshot.retrievedAt)}) and immutable from then on.
                </>
              ) : (
                'No snapshot yet - one is captured when the case is approved.'
              )}
            </p>
          </div>
        </div>
      </section>

      {/* Editing a draft belongs with the values being edited (owner
            request, 2026-08-19): one disclosure under the summary instead of
            a second full-width section repeating the same fields. */}
      {cap.canEditDraft ? (
        <details className="action" style={{ marginTop: '0.75rem' }}>
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
              <input id="e-recv-detail" name="receiptSourceDetail" type="text" maxLength={150} />
            </div>
            <div className="field">
              <label htmlFor="e-eff">Employment Ends (Date and Exact Time)</label>
              <input id="e-eff" name="effectiveSeparationAt" type="datetime-local" />
              <p className="hint">Currently: {dt(c.effectiveSeparationAt)}.</p>
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
            <button type="submit">Save draft changes</button>
          </form>
        </details>
      ) : null}

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

      {required?.canConfirmBenefits ? (
        <section aria-labelledby="benefits-h">
          <SectionHead
            id="benefits-h"
            icon={<ShieldCheckIcon />}
            tone={benefitsTone(required.benefits)}
            title="Benefits and providers"
            description="Each benefit this employee holds has to be cancelled with the provider that carries it. Confirming applicability is what starts - or stands down - that provider's notification."
            aside={
              required.benefits.confirmedAt ? (
                <Chip tone="done">Confirmed</Chip>
              ) : (
                <Chip tone="attention">Awaiting confirmation</Chip>
              )
            }
          />

          {required.canConfirmBenefits ? (
            <details
              className="action"
              open={
                required.benefits.groupHealth === 'UNKNOWN' ||
                required.benefits.groupLife === 'UNKNOWN'
              }
            >
              <summary>Confirm which benefits apply</summary>
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
                  Confirming &quot;Yes&quot; prepares the matching provider notification;
                  &quot;No&quot; removes it. Anything left unknown stays on the attention list until
                  confirmed.
                </p>
                <button type="submit">Confirm applicability</button>
              </form>
            </details>
          ) : null}

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
                    <Chip tone="progress">Notification required</Chip>
                  ) : applies === 'NO' ? (
                    <Chip tone="done">Not applicable</Chip>
                  ) : (
                    <Chip tone="attention">Applicability unknown</Chip>
                  )
                }
                footer={
                  <span className="meta">
                    {applies === 'YES'
                      ? 'The removal email is prepared for this case and appears under Email actions.'
                      : applies === 'NO'
                        ? 'No provider notification is raised for this employee.'
                        : 'Nothing is sent until HR confirms whether this benefit applies.'}
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
                      name: 'Benefit confirmed',
                      state: applies === 'UNKNOWN' ? 'current' : 'done',
                      meta: required.benefits.confirmedAt
                        ? formatInstant(required.benefits.confirmedAt)
                        : 'Awaiting HR',
                    },
                    {
                      name: 'Removal prepared',
                      state: applies === 'NO' ? 'todo' : applies === 'YES' ? 'done' : 'todo',
                      meta: applies === 'NO' ? 'Not applicable' : undefined,
                    },
                    {
                      name: 'Sent to provider',
                      state: applies === 'YES' ? 'current' : 'todo',
                      meta: applies === 'YES' ? 'See Email actions' : undefined,
                    },
                    { name: 'Provider confirmed', state: 'todo' },
                  ]}
                />
              </ProviderPanel>
            );
          })}
        </section>
      ) : null}

      {(cap.canSubmit || cap.canApprove || cap.canReturn || cap.canCancel || cap.canVoid) && (
        <section aria-labelledby="actions-h" className="panel">
          <SectionHead
            id="actions-h"
            icon={<FlowIcon />}
            title="Move this case"
            description="Where the case goes next in its lifecycle. Cases are never deleted - cancelling or voiding preserves the full history."
          />
          <div className="actions-row">
            {'canApproveDraft' in cap && cap.canApproveDraft ? (
              <form action={transitionAction}>
                <input type="hidden" name="caseId" value={c.id} />
                <input type="hidden" name="action" value="submitAndApprove" />
                {/* The reviewer never asks themselves for review: one click
                    runs submit and approve in order, fully audited. */}
                <button type="submit">Approve case and capture snapshot</button>
              </form>
            ) : cap.canSubmit ? (
              <form action={transitionAction}>
                <input type="hidden" name="caseId" value={c.id} />
                <input type="hidden" name="action" value="submit" />
                <button type="submit">Submit for review</button>
              </form>
            ) : null}
            {cap.canApprove ? (
              <form action={transitionAction}>
                <input type="hidden" name="caseId" value={c.id} />
                <input type="hidden" name="action" value="approve" />
                <button type="submit">Approve case and capture snapshot</button>
              </form>
            ) : null}
            {cap.canReturn ? (
              <details className="action">
                <summary>Return for correction</summary>
                <form action={transitionAction} className="stack">
                  <input type="hidden" name="caseId" value={c.id} />
                  <input type="hidden" name="action" value="return" />
                  <div className="field">
                    <label htmlFor="return-reason">Reason (Required)</label>
                    <textarea id="return-reason" name="reason" rows={2} required />
                  </div>
                  <button type="submit" className="secondary">
                    Return to draft
                  </button>
                </form>
              </details>
            ) : null}
            {cap.canCancel ? (
              <details className="action">
                <summary className="summary--danger">Cancel case (non-event)</summary>
                <form action={transitionAction} className="stack">
                  <input type="hidden" name="caseId" value={c.id} />
                  <input type="hidden" name="action" value="cancel" />
                  <div className="field">
                    <label htmlFor="cancel-reason">Reason (Required)</label>
                    <textarea id="cancel-reason" name="reason" rows={2} required />
                  </div>
                  <button type="submit" className="danger">
                    Cancel case
                  </button>
                </form>
              </details>
            ) : null}
            {cap.canVoid ? (
              <details className="action">
                <summary className="summary--danger">Void case (entered in error)</summary>
                <form action={transitionAction} className="stack">
                  <input type="hidden" name="caseId" value={c.id} />
                  <input type="hidden" name="action" value="void" />
                  <div className="field">
                    <label htmlFor="void-reason">Reason (Required)</label>
                    <textarea id="void-reason" name="reason" rows={2} required />
                  </div>
                  <button type="submit" className="danger">
                    Void case
                  </button>
                </form>
              </details>
            ) : null}
          </div>
          <p className="hint">Cases are never deleted; cancel or void preserves full history.</p>
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
              <form action={uploadAttachmentAction} className="stack" encType="multipart/form-data">
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

      {cap.canRecordBaseline ? (
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
          <SectionHead
            id="notes-h"
            icon={<BookIcon />}
            title="Internal notes"
            description="Visible to HR on this case and part of the permanent record."
          />
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
