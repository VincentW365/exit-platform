import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServiceError, getActionForm } from '@exit/db';
import {
  FINANCE_CHECKLIST_ITEMS,
  FORM_STATUS_LABELS,
  HR_CHECKLIST_ITEMS,
  formatInstant,
  type ActionFormStatus,
  type ChecklistState,
} from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { CaseNav } from '../CaseNav';
import {
  completeFormAction,
  createFormAction,
  hrReviewAction,
  returnFormAction,
  saveFinanceSectionAction,
  saveHrSectionAction,
  submitFormAction,
  voidFormAction,
} from './actions';

export const metadata: Metadata = { title: 'Action form' };
export const dynamic = 'force-dynamic';

const FORM_BADGE: Record<string, string> = {
  DRAFT: 'badge--neutral',
  READY_FOR_HR_REVIEW: 'badge--info',
  HR_REVIEWED: 'badge--info',
  COMPLETE: 'badge--success',
  RETURNED_FOR_CORRECTION: 'badge--warning',
  SUPERSEDED: 'badge--neutral',
  VOIDED: 'badge--neutral',
  // Legacy statuses stay renderable on historical rows (Directive 6.3 AD).
  RETURNED: 'badge--warning',
  PENDING_MANAGER: 'badge--warning',
  PENDING_HR: 'badge--warning',
  APPROVED: 'badge--success',
};

const EDITABLE_STATUSES = ['DRAFT', 'RETURNED', 'RETURNED_FOR_CORRECTION'];
const REVIEWABLE_STATUSES = ['READY_FOR_HR_REVIEW', 'HR_REVIEWED', 'PENDING_MANAGER', 'PENDING_HR'];
const CLOSED_STATUSES = ['COMPLETE', 'APPROVED', 'VOIDED', 'SUPERSEDED'];

function ChecklistFields({
  prefix,
  items,
  state,
  disabled,
}: {
  prefix: string;
  items: readonly { key: string; label: string }[];
  state: ChecklistState;
  disabled: boolean;
}) {
  return (
    <div className="stack">
      {items.map((i) => (
        <div key={i.key} className="field" style={{ maxWidth: '40rem' }}>
          <label htmlFor={`${prefix}-${i.key}`}>{i.label}</label>
          <select
            id={`${prefix}-${i.key}`}
            name={`${prefix}.${i.key}`}
            defaultValue={state[i.key] ?? 'PENDING'}
            disabled={disabled}
          >
            <option value="PENDING">Pending</option>
            <option value="DONE">Done</option>
            <option value="NOT_APPLICABLE">Not applicable</option>
          </select>
        </div>
      ))}
    </div>
  );
}

export default async function ActionFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;

  let data: Awaited<ReturnType<typeof getActionForm>>;
  try {
    data = await getActionForm(actor, id);
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'NOT_FOUND') notFound();
    throw e;
  }
  const f = data.current as
    | (NonNullable<typeof data.current> & {
        hrChecklist?: ChecklistState;
        financeChecklist?: ChecklistState;
        financeNotes?: string | null;
        ackReason?: string | null;
        hrRemarks?: string | null;
      })
    | null;
  const cap = data.capabilities;
  const snap = (f?.fieldSnapshot ?? {}) as Record<string, string | null>;
  const editable = f ? EDITABLE_STATUSES.includes(f.status) : false;
  const reviewable = f ? REVIEWABLE_STATUSES.includes(f.status) : false;
  const legacyRow = f ? ['PENDING_MANAGER', 'PENDING_HR'].includes(f.status) : false;
  // Informed completion: it is NOT blocked on the Finance checklist, but the
  // completing officer must see what the immutable PDF will record.
  const financePendingCount =
    f?.financeChecklist != null
      ? Object.values(f.financeChecklist).filter((v) => v === 'PENDING').length
      : 0;

  return (
    <>
      <h1>{data.caseNumber} - Offboarding Action Form</h1>
      <CaseNav caseId={id} active="action-form" />
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint">
        This form is an HR-controlled record: the assigned HR Officer prepares it, reviews the
        pre-populated information and completes it. Managers, IT and Finance have no approval role
        here - their responsibilities are handled through handover and the automated notifications.
      </p>

      {!f ? (
        <section className="panel">
          <p>No action form exists for this case yet.</p>
          {cap.canEdit ? (
            <form action={createFormAction}>
              <input type="hidden" name="caseId" value={id} />
              <button type="submit">Create action form</button>
            </form>
          ) : null}
        </section>
      ) : (
        <>
          <section className="panel" aria-labelledby="af-status">
            <h2 id="af-status" style={{ marginTop: 0 }}>
              Version {f.version}{' '}
              <span className={`badge ${FORM_BADGE[f.status] ?? 'badge--neutral'}`}>
                {FORM_STATUS_LABELS[f.status as ActionFormStatus] ?? f.status.replaceAll('_', ' ')}
              </span>
              {f.hasPdf ? (
                <>
                  {' '}
                  <a className="button secondary" href={`/api/action-forms/${f.id}/pdf`}>
                    Download final PDF
                  </a>
                </>
              ) : null}
            </h2>
            {f.returnReason && ['RETURNED', 'RETURNED_FOR_CORRECTION'].includes(f.status) ? (
              <p className="banner-baseline">Returned: {f.returnReason}</p>
            ) : null}
            {legacyRow ? (
              <p className="banner-baseline">
                This form started under the previous approval workflow. Manager approval is no
                longer required - the assigned HR Officer completes it directly.
              </p>
            ) : null}
            <h3 style={{ marginBottom: '0.3rem' }}>
              Employee and case details{' '}
              <span className="badge badge--neutral" title="Pre-populated from the case record">
                From case record
              </span>
            </h3>
            <dl className="kv">
              <dt>Employee</dt>
              <dd>
                {snap['employeeName']} ({snap['employeeId']})
              </dd>
              <dt>Position / Department / Location</dt>
              <dd>
                {snap['position'] || '-'} / {snap['department']} / {snap['location']}
              </dd>
              <dt>Departure type</dt>
              <dd>{(snap['departureType'] ?? '').replaceAll('_', ' ').toLowerCase()}</dd>
              <dt>Dates</dt>
              <dd>
                received {String(snap['receivedAt'] ?? '').slice(0, 10)}; confirmed last day{' '}
                {String(snap['confirmedLastDay'] ?? '').slice(0, 10) || '-'}; effective{' '}
                {snap['effectiveSeparationAt'] ?? '-'}
              </dd>
              <dt>Status change</dt>
              <dd>
                {f.priorStatus} to {f.newStatus}
              </dd>
              <dt>Acknowledgement</dt>
              <dd>
                {f.ackStatus}
                {f.ackDate ? ` on ${formatInstant(f.ackDate)}` : ''}
                {f.ackMethod ? ` (${f.ackMethod})` : ''}
              </dd>
            </dl>
            {data.attestations.length ? (
              <>
                <h3>Completion and approvals (authenticated attestations)</h3>
                <ul>
                  {data.attestations.map((a, i) => (
                    <li key={i}>
                      {a.kind === 'MANAGER_FORM_APPROVAL'
                        ? 'Manager approval (historical)'
                        : a.kind === 'HR_FORM_COMPLETION'
                          ? 'HR completion'
                          : 'HR final approval (historical)'}
                      : {a.actorDisplayName} ({a.actorRole}) - {formatInstant(a.createdAt)} - form v
                      {a.subjectVersion}
                      {a.invalidatedAt ? <strong> INVALIDATED</strong> : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          {cap.canEdit && 'hrChecklist' in f && f.hrChecklist ? (
            <section className="panel" aria-labelledby="hr-sec">
              <h2 id="hr-sec" style={{ marginTop: 0 }}>
                HR section{' '}
                <span className="badge badge--neutral" title="Recorded by HR">
                  HR-entered
                </span>
              </h2>
              <p className="hint">Checklist entries are completion evidence, not approvals.</p>
              <form action={saveHrSectionAction} className="stack">
                <input type="hidden" name="caseId" value={id} />
                <input type="hidden" name="formId" value={f.id} />
                <fieldset>
                  <legend>HR checklist</legend>
                  <ChecklistFields
                    prefix="hr"
                    items={HR_CHECKLIST_ITEMS}
                    state={f.hrChecklist}
                    disabled={!editable}
                  />
                </fieldset>
                <fieldset>
                  <legend>Employee acknowledgement (not an internal approval)</legend>
                  <div className="field">
                    <label htmlFor="ackStatus">Status</label>
                    <select
                      id="ackStatus"
                      name="ackStatus"
                      defaultValue={f.ackStatus}
                      disabled={!editable}
                    >
                      <option value="PENDING">Pending</option>
                      <option value="ACKNOWLEDGED">Acknowledged</option>
                      <option value="NOT_OBTAINED">Not obtained (reason required)</option>
                      <option value="NOT_APPLICABLE">Not applicable (termination only)</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="ackDate">Date</label>
                    <input
                      id="ackDate"
                      name="ackDate"
                      type="date"
                      defaultValue={f.ackDate ? f.ackDate.toISOString().slice(0, 10) : ''}
                      disabled={!editable}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ackMethod">Method</label>
                    <input
                      id="ackMethod"
                      name="ackMethod"
                      type="text"
                      maxLength={120}
                      defaultValue={f.ackMethod ?? ''}
                      placeholder="e.g. signed copy uploaded / in person with witness"
                      disabled={!editable}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ackReason">Reason (required for NOT_OBTAINED)</label>
                    <input
                      id="ackReason"
                      name="ackReason"
                      type="text"
                      maxLength={300}
                      defaultValue={('ackReason' in f ? f.ackReason : '') ?? ''}
                      disabled={!editable}
                    />
                  </div>
                </fieldset>
                <div className="field">
                  <label htmlFor="hrRemarks">General HR remarks (restricted)</label>
                  <textarea
                    id="hrRemarks"
                    name="hrRemarks"
                    rows={2}
                    maxLength={2000}
                    defaultValue={('hrRemarks' in f ? f.hrRemarks : '') ?? ''}
                    disabled={!editable}
                  />
                </div>
                {editable ? <button type="submit">Save HR section</button> : null}
              </form>
              {editable ? (
                <form action={submitFormAction} style={{ marginTop: '0.6rem' }}>
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="formId" value={f.id} />
                  <button type="submit">Finish preparation (ready for review)</button>
                </form>
              ) : null}
            </section>
          ) : null}

          {cap.canEdit && 'financeChecklist' in f && f.financeChecklist ? (
            <section className="panel" aria-labelledby="fin-sec">
              <h2 id="fin-sec" style={{ marginTop: 0 }}>
                Finance evidence (recorded by HR; Finance works outside this application)
              </h2>
              <p className="hint">
                Finance receives the automated notification and completes its process in its own
                systems. Record here what the notification and any returned evidence establish. No
                pay amounts are recorded and nothing on this form calculates or changes pay.
              </p>
              <form action={saveFinanceSectionAction} className="stack">
                <input type="hidden" name="caseId" value={id} />
                <input type="hidden" name="formId" value={f.id} />
                <ChecklistFields
                  prefix="fin"
                  items={FINANCE_CHECKLIST_ITEMS}
                  state={f.financeChecklist}
                  disabled={CLOSED_STATUSES.includes(f.status)}
                />
                <div className="field">
                  <label htmlFor="financeNotes">Finance notes (limited, non-sensitive)</label>
                  <textarea
                    id="financeNotes"
                    name="financeNotes"
                    rows={2}
                    maxLength={1000}
                    defaultValue={('financeNotes' in f ? f.financeNotes : '') ?? ''}
                  />
                </div>
                {!CLOSED_STATUSES.includes(f.status) ? (
                  <button type="submit">Save Finance evidence</button>
                ) : null}
              </form>
            </section>
          ) : null}

          {reviewable && cap.canComplete && financePendingCount > 0 ? (
            <p className="banner-baseline" role="status">
              The Finance evidence still has {financePendingCount} item(s) marked Pending.
              Completion freezes this version and the final PDF will permanently record them as
              Pending. Confirm nothing further will be recorded, or return the form instead.
            </p>
          ) : null}
          {reviewable ? (
            <section className="panel actions-row" aria-label="Review and completion">
              {f.status === 'READY_FOR_HR_REVIEW' && cap.canHrReview && cap.requireHrReview ? (
                <form action={hrReviewAction}>
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="formId" value={f.id} />
                  <button type="submit">Record management review</button>
                </form>
              ) : null}
              {cap.canComplete ? (
                <form action={completeFormAction}>
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="formId" value={f.id} />
                  <button type="submit">Complete action form (attested, renders final PDF)</button>
                </form>
              ) : null}
              {cap.canReturn ? (
                <details className="action">
                  <summary>Return for correction</summary>
                  <form action={returnFormAction} className="stack">
                    <input type="hidden" name="caseId" value={id} />
                    <input type="hidden" name="formId" value={f.id} />
                    <div className="field">
                      <label htmlFor="ret-reason">Reason (required)</label>
                      <textarea id="ret-reason" name="reason" rows={2} required />
                    </div>
                    <button type="submit" className="secondary">
                      Return
                    </button>
                  </form>
                </details>
              ) : null}
            </section>
          ) : null}

          {cap.canVoid && !CLOSED_STATUSES.includes(f.status) ? (
            <details className="action">
              <summary>Void form</summary>
              <form action={voidFormAction} className="stack">
                <input type="hidden" name="caseId" value={id} />
                <input type="hidden" name="formId" value={f.id} />
                <div className="field">
                  <label htmlFor="void-reason">Reason (required)</label>
                  <textarea id="void-reason" name="reason" rows={2} required />
                </div>
                <button type="submit" className="danger">
                  Void form
                </button>
              </form>
            </details>
          ) : null}

          {data.history.length ? (
            <section className="panel">
              <h2 style={{ marginTop: 0 }}>Version history</h2>
              <ul>
                {data.history.map((h) => (
                  <li key={h.id}>
                    Version {h.version} -{' '}
                    {FORM_STATUS_LABELS[h.status as ActionFormStatus] ?? h.status}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
