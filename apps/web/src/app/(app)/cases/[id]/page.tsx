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
  type TimelineChip,
} from '@exit/domain';
import {
  ServiceError,
  caseProgress,
  getCase,
  listActiveUsers,
  listAttachments,
  listBaselineEvents,
  listCaseAudit,
  listNotes,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { CaseNav } from './CaseNav';
import { CaseHeader } from '@/components/CaseHeader';
import { ProgressStrip } from '@/components/ProgressStrip';
import {
  ClassificationBadge,
  Feedback,
  PurposeBadge,
  RestrictedBanner,
  StatusBadge,
} from '@/components/ui';
import {
  addNoteAction,
  addParticipantAction,
  changeEffectiveTimeAction,
  correctPurposeAction,
  recordBaselineAction,
  setRehireAction,
  transitionAction,
  updateDraftAction,
  uploadAttachmentAction,
} from '../actions';

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
          <h1>Restricted case</h1>
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
  const progress = await caseProgress(actor, id).catch(() => []);

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
        }}
      />
      <Feedback err={sp.err} ok={sp.ok} />
      {c.classification === 'RESTRICTED' ? <RestrictedBanner /> : null}
      <CaseNav caseId={id} active="overview" />
      {progress.length > 0 ? <ProgressStrip stages={progress} /> : null}

      <section className="panel" aria-labelledby="summary-h">
        <h2 id="summary-h" style={{ marginTop: 0 }}>
          Summary <StatusBadge status={c.status} />{' '}
          <ClassificationBadge classification={c.classification} />{' '}
          <PurposeBadge purpose={c.recordPurpose} cohort={c.measurementCohort} />
        </h2>
        <dl className="kv">
          <dt>Employee</dt>
          <dd>
            {c.employeeDisplayName} ({c.employeeSourceId}, source {c.employeeSourceSystem})
          </dd>
          <dt>Department / location</dt>
          <dd>
            {c.department} / {c.location}
          </dd>
          <dt>Departure type</dt>
          <dd>{c.departureType.replaceAll('_', ' ').toLowerCase()}</dd>
          <dt>Received</dt>
          <dd>
            {dt(c.receivedAt)} - {c.receiptSource}
          </dd>
          <dt>Proposed / confirmed last day</dt>
          <dd>
            {c.proposedLastDay ? formatDateOnly(c.proposedLastDay) : '-'} /{' '}
            {c.confirmedLastDay ? formatDateOnly(c.confirmedLastDay) : '-'}
          </dd>
          <dt>Effective separation (exact)</dt>
          <dd>
            <strong>{dt(c.effectiveSeparationAt)}</strong> America/Jamaica
          </dd>
          <dt>Notice</dt>
          <dd>
            provided: {c.noticeProvidedDays ?? '-'} days; required: {c.noticeRequiredDays ?? '-'}{' '}
            days; treatment: {c.noticeTreatment ?? '-'}
          </dd>
          <dt>Reason category</dt>
          <dd>
            {c.reasonCategory
              ? `${c.reasonCategory.label}${c.reasonCategory.isTestOnly ? ' (TEST ONLY)' : ''}`
              : `none - status ${c.reasonCaptureStatus} (taxonomy pending DEC-031)`}
          </dd>
          <dt>Reason notes</dt>
          <dd>
            {c.reasonNotesMasked ? <em>masked (restricted HR data)</em> : (c.reasonNotes ?? '-')}
          </dd>
          <dt>Rehire eligibility</dt>
          <dd>
            {c.rehireMasked ? (
              <em>masked (HR Manager only)</em>
            ) : (
              (c.rehireEligibility ?? 'not set')
            )}
          </dd>
          <dt>Snapshot</dt>
          <dd>
            {c.snapshot ? (
              <>
                captured {formatInstant(c.snapshot.capturedAt)} (checksum{' '}
                <code>{c.snapshot.checksum.slice(0, 12)}...</code>, source retrieved{' '}
                {formatInstant(c.snapshot.retrievedAt)}) - immutable
              </>
            ) : (
              'not yet captured (created at approval)'
            )}
          </dd>
          {c.closeReason ? (
            <>
              <dt>Closure reason</dt>
              <dd>{c.closeReason}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {(cap.canSubmit || cap.canApprove || cap.canReturn || cap.canCancel || cap.canVoid) && (
        <section className="panel" aria-labelledby="actions-h">
          <h2 id="actions-h" style={{ marginTop: 0 }}>
            Actions
          </h2>
          <div className="actions-row">
            {cap.canSubmit ? (
              <form action={transitionAction}>
                <input type="hidden" name="caseId" value={c.id} />
                <input type="hidden" name="action" value="submit" />
                <button type="submit">Submit for HR review</button>
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
                    <label htmlFor="return-reason">Reason (required)</label>
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
                <summary>Cancel case (non-event)</summary>
                <form action={transitionAction} className="stack">
                  <input type="hidden" name="caseId" value={c.id} />
                  <input type="hidden" name="action" value="cancel" />
                  <div className="field">
                    <label htmlFor="cancel-reason">Reason (required)</label>
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
                <summary>Void case (entered in error)</summary>
                <form action={transitionAction} className="stack">
                  <input type="hidden" name="caseId" value={c.id} />
                  <input type="hidden" name="action" value="void" />
                  <div className="field">
                    <label htmlFor="void-reason">Reason (required)</label>
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

      {cap.canEditDraft ? (
        <section className="panel" aria-labelledby="edit-h">
          <h2 id="edit-h" style={{ marginTop: 0 }}>
            Edit draft
          </h2>
          <form action={updateDraftAction} className="stack">
            <input type="hidden" name="caseId" value={c.id} />
            <div className="field">
              <label htmlFor="e-recv">Receipt date and time</label>
              <input id="e-recv" name="receivedAt" type="datetime-local" />
              <p className="hint">Currently: {dt(c.receivedAt)}. Leave blank to keep.</p>
            </div>
            <div className="field">
              <label htmlFor="e-recv-src">Receipt source</label>
              <input id="e-recv-src" name="receiptSource" type="text" maxLength={200} />
              <p className="hint">Currently: {c.receiptSource}. Leave blank to keep.</p>
            </div>
            <div className="field">
              <label htmlFor="e-eff">Effective separation (exact date and time)</label>
              <input id="e-eff" name="effectiveSeparationAt" type="datetime-local" />
              <p className="hint">Currently: {dt(c.effectiveSeparationAt)}.</p>
            </div>
            <div className="field">
              <label htmlFor="e-reason-status">Reason capture status</label>
              <select
                id="e-reason-status"
                name="reasonCaptureStatus"
                defaultValue={c.reasonCaptureStatus}
              >
                <option value="PENDING">PENDING</option>
                <option value="PROVIDED">PROVIDED</option>
                <option value="NOT_PROVIDED">NOT_PROVIDED</option>
                <option value="NOT_APPLICABLE">NOT_APPLICABLE</option>
              </select>
            </div>
            {!c.reasonNotesMasked ? (
              <div className="field">
                <label htmlFor="e-reason-notes">Reason notes (restricted HR data)</label>
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
        </section>
      ) : null}

      {(cap.canChangeEffectiveTime || cap.canCorrect || cap.canSetRehire) && !cap.canEditDraft ? (
        <section className="panel" aria-labelledby="corr-h">
          <h2 id="corr-h" style={{ marginTop: 0 }}>
            Audited corrections (HR Manager)
          </h2>
          <div className="actions-row">
            {cap.canChangeEffectiveTime ? (
              <details className="action">
                <summary>Change effective separation time</summary>
                <form action={changeEffectiveTimeAction} className="stack">
                  <input type="hidden" name="caseId" value={c.id} />
                  <div className="field">
                    <label htmlFor="corr-eff">New effective date and exact time (required)</label>
                    <input
                      id="corr-eff"
                      name="effectiveSeparationAt"
                      type="datetime-local"
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="corr-eff-reason">Reason (required, audited)</label>
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
                    <label htmlFor="rehire">Rehire eligibility</label>
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
                      Visible to HR Managers only; access is audited (DEC-032).
                    </p>
                  </div>
                  <button type="submit">Save</button>
                </form>
              </details>
            ) : null}
          </div>
        </section>
      ) : null}

      {cap.canCorrect && c.status === 'DRAFT' ? (
        <section className="panel" aria-labelledby="purpose-h">
          <h2 id="purpose-h" style={{ marginTop: 0 }}>
            Record purpose correction
          </h2>
          <details className="action">
            <summary>Correct record purpose (currently {c.recordPurpose})</summary>
            <form action={correctPurposeAction} className="stack">
              <input type="hidden" name="caseId" value={c.id} />
              <div className="field">
                <label htmlFor="purpose-to">New record purpose</label>
                <select id="purpose-to" name="recordPurpose" defaultValue={c.recordPurpose}>
                  <option value="OPERATIONAL">OPERATIONAL</option>
                  <option value="TRAINING">TRAINING</option>
                  <option value="TEST">TEST</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="purpose-reason">Reason (required, audited)</label>
                <textarea id="purpose-reason" name="reason" rows={2} required />
              </div>
              <button type="submit">Correct purpose (audited)</button>
            </form>
          </details>
          <p className="hint">
            Allowed only while the record is a draft; operational records are never silently
            reclassified (BR-CASE-014).
          </p>
        </section>
      ) : null}

      <section className="panel" aria-labelledby="participants-h">
        <h2 id="participants-h" style={{ marginTop: 0 }}>
          Participants
        </h2>
        <ul>
          {c.participants.map((p) => (
            <li key={p.id}>
              {users.find((u) => u.userId === p.userId)?.displayName ?? p.userId} -{' '}
              {p.participantRole.replaceAll('_', ' ').toLowerCase()}
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
                        {u.displayName} ({u.roles.join(', ')})
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="p-role">Participant role</label>
                <select id="p-role" name="participantRole" defaultValue="HR_SUPPORT">
                  <option value="HR_SUPPORT">HR support (requires an HR role)</option>
                  <option value="OVERSIGHT">Oversight (auditor / privacy officer)</option>
                  <option value="FINANCE">Finance - action-form checklist only</option>
                  <option value="MANAGER">Manager - action-form review/approval only</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="p-reason">Reason (required, audited)</label>
                <input id="p-reason" name="reason" type="text" required maxLength={200} />
              </div>
              <button type="submit">Add participant</button>
            </form>
          </details>
        ) : null}
      </section>

      {cap.canUpload || attachments.length > 0 ? (
        <section className="panel" aria-labelledby="files-h">
          <h2 id="files-h" style={{ marginTop: 0 }}>
            Attachments
          </h2>
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
                      <td>{a.purpose.replaceAll('_', ' ').toLowerCase()}</td>
                      <td>{Math.ceil(a.sizeBytes / 1024)} KB</td>
                      <td>
                        <span
                          className={`badge ${a.scanStatus === 'CLEAN' ? 'badge--success' : 'badge--warning'}`}
                        >
                          {a.scanStatus}
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
            <p>No attachments.</p>
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
        <section className="panel" aria-labelledby="baseline-h">
          <h2 id="baseline-h" style={{ marginTop: 0 }}>
            Baseline facts (manual record of the current process)
          </h2>
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
                      <td>{e.eventType.replaceAll('_', ' ').toLowerCase()}</td>
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
            <p>No baseline facts recorded yet.</p>
          )}
          <details className="action">
            <summary>Record a baseline fact</summary>
            <form action={recordBaselineAction} className="stack">
              <input type="hidden" name="caseId" value={c.id} />
              <div className="field">
                <label htmlFor="b-type">Fact type</label>
                <select id="b-type" name="eventType" required defaultValue="">
                  <option value="" disabled>
                    Choose...
                  </option>
                  {BASELINE_EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replaceAll('_', ' ').toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="b-when">Event date and time (leave blank if unknown)</label>
                <input id="b-when" name="occurredAt" type="datetime-local" />
                <p className="hint">
                  Do not backdate from memory; if unknown, choose a missing-data reason.
                </p>
              </div>
              <div className="field">
                <label htmlFor="b-missing">Missing-data reason (when no time)</label>
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
                <label htmlFor="b-note">Missing-data note (required for UNKNOWN_OTHER)</label>
                <input id="b-note" name="missingNote" type="text" maxLength={300} />
              </div>
              <div className="field">
                <label htmlFor="b-detail">Detail (short, e.g. notified party)</label>
                <input id="b-detail" name="detail" type="text" maxLength={200} />
              </div>
              <div className="field">
                <label htmlFor="b-evidence">Evidence reference (location, not content)</label>
                <input id="b-evidence" name="evidenceRef" type="text" maxLength={300} />
              </div>
              <button type="submit">Record fact</button>
            </form>
          </details>
        </section>
      ) : null}

      {cap.canAddNote || notes.length > 0 ? (
        <section className="panel" aria-labelledby="notes-h">
          <h2 id="notes-h" style={{ marginTop: 0 }}>
            Internal notes
          </h2>
          {notes.length ? (
            <ul className="timeline">
              {notes.map((n) => (
                <li key={n.id}>
                  <span className="meta">
                    {formatInstant(n.createdAt)} -{' '}
                    {n.visibility === 'HR_ONLY' ? 'HR only' : 'HR + oversight'}
                    {n.supersedesId ? ' - revision' : ''}
                  </span>
                  <br />
                  {n.body}
                </li>
              ))}
            </ul>
          ) : (
            <p>No notes.</p>
          )}
          {cap.canAddNote ? (
            <details className="action">
              <summary>Add note</summary>
              <form action={addNoteAction} className="stack">
                <input type="hidden" name="caseId" value={c.id} />
                <div className="field">
                  <label htmlFor="n-body">Note (1-4000 characters)</label>
                  <textarea id="n-body" name="body" rows={3} required maxLength={4000} />
                </div>
                <div className="field">
                  <label htmlFor="n-vis">Visibility</label>
                  <select id="n-vis" name="visibility" defaultValue="HR_ONLY">
                    <option value="HR_ONLY">HR only</option>
                    <option value="HR_AND_OVERSIGHT">HR and oversight</option>
                  </select>
                </div>
                <button type="submit">Add note</button>
              </form>
            </details>
          ) : null}
        </section>
      ) : null}

      <section className="panel" aria-labelledby="audit-h">
        <h2 id="audit-h" style={{ marginTop: 0 }}>
          Audit history
        </h2>
        <p className="hint">
          Newest first ({audit.length} event(s)); the complete history is immutable evidence.
          Low-level system noise is hidden by default.
        </p>
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
          <ul className="timeline">
            {[...audit].reverse().map((e) => (
              <li key={e.id}>
                {humanizeAuditEvent({
                  eventType: e.eventType as never,
                  result: e.result,
                  actorType: e.actorType,
                  actorDisplayName: e.actorId
                    ? (users.find((u) => u.userId === e.actorId)?.displayName ?? null)
                    : null,
                  metadata: e.metadata as never,
                })}{' '}
                <span className="meta">{formatInstant(e.occurredAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
