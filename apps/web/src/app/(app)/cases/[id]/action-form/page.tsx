import type { Metadata } from 'next';
import { Field } from '@/components/forms';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { notFound } from 'next/navigation';
import { ServiceError, getActionForm, listSignatureRequests } from '@exit/db';
import {
  BRAND,
  FINANCE_CHECKLIST_ITEMS,
  FORM_STATUS_LABELS,
  HR_CHECKLIST_ITEMS,
  formatDateOnly,
  formatInstant,
  type ActionFormStatus,
  type ChecklistState,
} from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { CaseTitle, Feedback } from '@/components/ui';
import { CaseNav } from '../CaseNav';
import { SignaturePanel } from './SignaturePanel';
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
import { humanize } from '@/lib/text';
import { EmptyState } from '@/components/EmptyState';
import { DocumentIcon } from '@/components/icons';

export const metadata: Metadata = { title: 'Action Form' };
export const dynamic = 'force-dynamic';

/**
 * The Employee Action Form, replicated from the company's printed template.
 *
 * The sheet's regions render in their printed order - identity boxes, Action
 * Type ticks, the Prior/New status table, Termination/ROE, General Remarks,
 * the two-column HR/Payroll checklist, and the Approval block - and every
 * field the platform holds is interactive in place.
 *
 * Two honest departures from the paper, both from standing rules:
 *  - Pay figures (salary, notice pay, deductions) are never captured here.
 *    The platform records that Payroll acted, never amounts (CLAUDE.md 10).
 *  - The action-type and termination ticks reflect the case's departure type
 *    rather than being free choices: this form documents an offboarding the
 *    case already defines, so a contradictory tick would be a data error.
 *
 * The sheet carries TWO save boundaries (the HR section and the Finance
 * evidence), so controls associate with their form by the HTML `form`
 * attribute while sitting wherever the paper puts them.
 */

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

/** The printed Action Type row. Exactly one is true for an offboarding. */
const ACTION_TYPES = [
  'Promotion',
  'New Hire',
  'Wage/Salary Change',
  'Transfer',
  'Status Change',
  'Leave of Absence',
  'Resignation',
  'Termination',
  'Other',
] as const;

function actionTypeFor(departureType: string): (typeof ACTION_TYPES)[number] {
  return departureType === 'TERMINATION' ? 'Termination' : 'Resignation';
}

/** A printed tick that states a fact the case already holds. */
function StaticTick({ label, checked }: { label: string; checked: boolean }) {
  return (
    <label className="tickbox tickbox--static">
      <input type="checkbox" checked={checked} disabled readOnly />
      {label}
    </label>
  );
}

/** Done / Pending / Not applicable as tick pills bound to one checklist key. */
function TriTick({
  prefix,
  itemKey,
  label,
  value,
  disabled,
  formId,
}: {
  prefix: string;
  itemKey: string;
  label: string;
  value: string;
  disabled: boolean;
  formId: string;
}) {
  return (
    <div className="form-item">
      <span id={`${prefix}-${itemKey}-label`}>{label}</span>
      <span className="tickset" role="radiogroup" aria-labelledby={`${prefix}-${itemKey}-label`}>
        {(
          [
            ['DONE', 'Done'],
            ['PENDING', 'Pending'],
            ['NOT_APPLICABLE', 'N/A'],
          ] as const
        ).map(([v, text]) => (
          <label key={v} className="tick">
            <input
              type="radio"
              id={`${prefix}-${itemKey}-${v}`}
              name={`${prefix}.${itemKey}`}
              value={v}
              form={formId}
              defaultChecked={value === v}
              disabled={disabled}
            />
            {text}
          </label>
        ))}
      </span>
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
  const closed = f ? CLOSED_STATUSES.includes(f.status) : false;
  const canEditSheet = !!f && cap.canEdit && 'hrChecklist' in f && !!f.hrChecklist;
  // Informed completion: it is NOT blocked on the Finance checklist, but the
  // completing officer must see what the immutable PDF will record.
  const financePendingCount =
    f?.financeChecklist != null
      ? Object.values(f.financeChecklist).filter((v) => v === 'PENDING').length
      : 0;

  const dateOnly = (iso: string | null | undefined): string =>
    iso ? String(iso).slice(0, 10) : '-';
  const chosenAction = f ? actionTypeFor(String(snap['departureType'] ?? '')) : 'Resignation';
  const completion = data.attestations.find((a) => a.kind === 'HR_FORM_COMPLETION');
  const signatures = await listSignatureRequests(actor, id);
  const employeeSignature = signatures.signatures.find((s) => s.blockKey === 'acknowledgement');
  const hrSignature = signatures.signatures.find((s) => s.blockKey === 'hrCompletion');
  // Informed completion (the Finance pattern): completion is NOT blocked on
  // signatures, but the officer must see what the immutable PDF will record.
  const openSignatureRequests = signatures.requests.filter((r) => r.status === 'PENDING').length;
  const managerHistorical = data.attestations.find(
    (a) => a.kind === 'MANAGER_FORM_APPROVAL' && !a.invalidatedAt,
  );

  return (
    <>
      <CaseTitle title="Employee Action Form" caseNumber={data.caseNumber} />
      <CaseNav caseId={id} active="action-form" />
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="page-lede">
        The company&apos;s printed form, completed on screen. The assigned HR Officer prepares it,
        reviews the pre-populated information and completes it. Managers, IT and Finance have no
        approval role here - their responsibilities are handled through handover and the automated
        notifications.
      </p>

      {!f ? (
        <section className="panel">
          <EmptyState
            icon={<DocumentIcon />}
            title="No action form yet"
            body="The Employee Action Form records the HR checklist and the final approvals for this case, on the company's own template."
          />
          {cap.canEdit ? (
            <form action={createFormAction}>
              <input type="hidden" name="caseId" value={id} />
              <button type="submit">Create action form</button>
            </form>
          ) : null}
        </section>
      ) : (
        <>
          {/* App chrome above the sheet: version, state, the final PDF. */}
          <div
            className="actions-row"
            style={{ maxWidth: '52rem', margin: '0 auto var(--space-3)' }}
          >
            <span className={`badge ${FORM_BADGE[f.status] ?? 'badge--neutral'}`}>
              {FORM_STATUS_LABELS[f.status as ActionFormStatus] ?? humanize(f.status)}
            </span>
            <span className="meta">Version {f.version}</span>
            {f.hasPdf ? (
              <a className="button secondary compact" href={`/api/action-forms/${f.id}/pdf`}>
                Download final PDF
              </a>
            ) : null}
          </div>
          {f.returnReason && ['RETURNED', 'RETURNED_FOR_CORRECTION'].includes(f.status) ? (
            <p className="banner-baseline" style={{ maxWidth: '52rem', margin: '0 auto 1rem' }}>
              Returned: {f.returnReason}
            </p>
          ) : null}
          {legacyRow ? (
            <p className="banner-baseline" style={{ maxWidth: '52rem', margin: '0 auto 1rem' }}>
              This form started under the previous approval workflow. Manager approval is no longer
              required - the assigned HR Officer completes it directly.
            </p>
          ) : null}

          {/* The two save boundaries the sheet's controls associate with. */}
          {canEditSheet ? (
            <>
              <form id="af-hr" action={saveHrSectionAction}>
                <input type="hidden" name="caseId" value={id} />
                <input type="hidden" name="formId" value={f.id} />
              </form>
              <form id="af-fin" action={saveFinanceSectionAction}>
                <input type="hidden" name="caseId" value={id} />
                <input type="hidden" name="formId" value={f.id} />
              </form>
            </>
          ) : null}

          <div className="paper">
            <header className="paper__letterhead">
              {/* DEC-068 section 1: the approved logo asset itself, at its own
                  aspect ratio - never redrawn in text or CSS. The same file
                  the PDF renderer uses, so screen, print and PDF agree. */}
              {/* eslint-disable-next-line @next/next/no-img-element -- approved static brand asset */}
              <img
                src={BRAND.logoWebPath}
                alt={BRAND.logoAlt}
                className="paper__logo"
                width={BRAND.logoWidth}
                height={BRAND.logoHeight}
              />
              <div className="paper__org">Bert&apos;s Auto Parts</div>
              <p className="paper__title">Employee Action Form</p>
              <p className="paper__ref">
                Case reference: {snap['caseReference'] ?? data.caseNumber}
              </p>
            </header>

            <div className="idgrid">
              <div>
                <span className="label">Employee Name:</span>
                <span className="value">{snap['employeeName']}</span>
              </div>
              <div>
                <span className="label">Effective Date:</span>
                <span className="value">
                  {snap['effectiveSeparationAt']
                    ? formatInstant(new Date(String(snap['effectiveSeparationAt'])))
                    : '-'}
                </span>
              </div>
              <div>
                <span className="label">Employee Number:</span>
                <span className="value">
                  {snap['employeeNumber'] ?? <span className="meta">Not recorded in BambooHR</span>}
                </span>
              </div>
              <div>
                <span className="label">Department/Location:</span>
                <span className="value">
                  {snap['department']} / {snap['location']}
                </span>
              </div>
              {/* DEC-068 section 2: position and separation type belong in the
                  header a signer reads, not only in the body of the sheet. */}
              <div>
                <span className="label">Position:</span>
                <span className="value">{snap['position'] ?? '-'}</span>
              </div>
              <div>
                <span className="label">Separation Type:</span>
                <span className="value">{snap['departureType'] ?? '-'}</span>
              </div>
            </div>

            <div className="paper__bar">
              Action Type
              <span className="meta">determined by the case&apos;s departure type</span>
            </div>
            <div className="tickrow" aria-label="Action type">
              {ACTION_TYPES.map((t) => (
                <StaticTick key={t} label={t} checked={t === chosenAction} />
              ))}
            </div>

            <table className="form-table" style={{ marginTop: 'var(--space-3)' }}>
              <caption className="sr-only">Prior and new employment status</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ width: '30%' }} aria-label="Field" />
                  <th scope="col">Prior Status</th>
                  <th scope="col">New Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Position Title</th>
                  <td>{snap['position'] || '-'}</td>
                  <td>-</td>
                </tr>
                <tr>
                  <th scope="row">Department/Location</th>
                  <td>
                    {snap['department']} / {snap['location']}
                  </td>
                  <td>-</td>
                </tr>
                <tr>
                  <th scope="row">Annual Gross Salary</th>
                  <td colSpan={2} className="meta">
                    Not recorded - pay is handled by Payroll outside this platform
                  </td>
                </tr>
                <tr>
                  <th scope="row">Overtime Status / Payment Schedule</th>
                  <td colSpan={2} className="meta">
                    Not recorded - pay is handled by Payroll outside this platform
                  </td>
                </tr>
                <tr>
                  <th scope="row">Employment Status</th>
                  <td>{humanize(f.priorStatus)}</td>
                  <td>
                    <strong>{humanize(f.newStatus)}</strong>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Manager</th>
                  <td>{snap['managerName'] ?? '-'}</td>
                  <td>-</td>
                </tr>
              </tbody>
            </table>

            <div className="paper__bar">Termination / ROE Request</div>
            <div className="tickrow" aria-label="Termination type">
              <StaticTick label="Resignation" checked={chosenAction === 'Resignation'} />
              <StaticTick label="Retirement" checked={false} />
              <StaticTick label="Terminated" checked={chosenAction === 'Termination'} />
              <StaticTick label="Leave of absence" checked={false} />
            </div>
            <div className="sigline">
              <span className="sigline__label">Last Day Worked:</span>
              <span className="sigline__value">{dateOnly(snap['confirmedLastDay'])}</span>
              <span className="sigline__label">Resignation Received:</span>
              <span className="sigline__value">{dateOnly(snap['receivedAt'])}</span>
            </div>
            <p className="meta">
              Eligibility for rehire is recorded on the case itself (restricted to the HR Manager),
              never on this form.
            </p>

            <div className="paper__bar">General Remarks</div>
            {canEditSheet ? (
              <div className="field">
                <label htmlFor="hrRemarks" className="sr-only">
                  General HR remarks (restricted)
                </label>
                <textarea
                  id="hrRemarks"
                  name="hrRemarks"
                  form="af-hr"
                  rows={3}
                  maxLength={2000}
                  defaultValue={('hrRemarks' in f ? f.hrRemarks : '') ?? ''}
                  disabled={!editable}
                />
                <span className="hint">Restricted HR data - masked outside HR participants.</span>
              </div>
            ) : (
              <p className="meta">Recorded by the assigned HR Officer.</p>
            )}

            <div className="paper__bar">
              Checklist
              <span className="meta">completion evidence, not approvals</span>
            </div>
            {canEditSheet ? (
              <>
                <div className="paper-cols">
                  <section aria-labelledby="hr-col-h">
                    <h3 id="hr-col-h">Human Resources</h3>
                    {HR_CHECKLIST_ITEMS.map((i) => (
                      <TriTick
                        key={i.key}
                        prefix="hr"
                        itemKey={i.key}
                        label={i.label}
                        value={f.hrChecklist?.[i.key] ?? 'PENDING'}
                        disabled={!editable}
                        formId="af-hr"
                      />
                    ))}
                    {editable ? (
                      <p style={{ marginTop: 'var(--space-3)' }}>
                        <button type="submit" form="af-hr" className="secondary compact">
                          Save HR section
                        </button>
                      </p>
                    ) : null}
                  </section>
                  <section aria-labelledby="fin-col-h">
                    <h3 id="fin-col-h">Payroll</h3>
                    <p className="meta" style={{ margin: '0 0 var(--space-2)' }}>
                      Recorded from the automated Finance notification and returned evidence. No pay
                      amounts are recorded and nothing here calculates or changes pay.
                    </p>
                    {FINANCE_CHECKLIST_ITEMS.map((i) => (
                      <TriTick
                        key={i.key}
                        prefix="fin"
                        itemKey={i.key}
                        label={i.label}
                        value={f.financeChecklist?.[i.key] ?? 'PENDING'}
                        disabled={closed}
                        formId="af-fin"
                      />
                    ))}
                    <div className="field" style={{ marginTop: 'var(--space-2)' }}>
                      <label htmlFor="financeNotes">Finance Notes (Limited, Non-sensitive)</label>
                      <textarea
                        id="financeNotes"
                        name="financeNotes"
                        form="af-fin"
                        rows={2}
                        maxLength={1000}
                        defaultValue={('financeNotes' in f ? f.financeNotes : '') ?? ''}
                        disabled={closed}
                      />
                    </div>
                    {!closed ? (
                      <p>
                        <button type="submit" form="af-fin" className="secondary compact">
                          Save Finance evidence
                        </button>
                      </p>
                    ) : null}
                  </section>
                </div>
              </>
            ) : (
              <p className="meta">Recorded by the assigned HR Officer.</p>
            )}

            <div className="paper__bar">Approval</div>
            <table className="form-table">
              <caption className="sr-only">Approvals</caption>
              <tbody>
                <tr>
                  <th scope="row" style={{ width: '30%' }}>
                    Employee
                  </th>
                  <td>
                    {canEditSheet ? (
                      <div className="stack" style={{ gap: 'var(--space-2)' }}>
                        <div className="tickrow" style={{ margin: 0 }}>
                          <label className="tickbox" htmlFor="ackStatus">
                            Acknowledgement:
                          </label>
                          <select
                            id="ackStatus"
                            name="ackStatus"
                            form="af-hr"
                            defaultValue={f.ackStatus}
                            disabled={!editable}
                          >
                            <option value="PENDING">Pending</option>
                            <option value="ACKNOWLEDGED">Acknowledged</option>
                            <option value="NOT_OBTAINED">Not obtained (reason required)</option>
                            <option value="NOT_APPLICABLE">
                              Not applicable (termination only)
                            </option>
                          </select>
                          <label className="tickbox" htmlFor="ackDate">
                            Date:
                          </label>
                          <input
                            id="ackDate"
                            name="ackDate"
                            type="date"
                            form="af-hr"
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
                            form="af-hr"
                            maxLength={120}
                            defaultValue={f.ackMethod ?? ''}
                            placeholder="e.g. signed copy uploaded / in person with witness"
                            disabled={!editable}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="ackReason">Reason (Required for Not Obtained)</label>
                          <input
                            id="ackReason"
                            name="ackReason"
                            type="text"
                            form="af-hr"
                            maxLength={300}
                            defaultValue={('ackReason' in f ? f.ackReason : '') ?? ''}
                            disabled={!editable}
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        {humanize(f.ackStatus)}
                        {f.ackDate ? ` on ${formatDateOnly(f.ackDate)}` : ''}
                        {f.ackMethod ? ` (${f.ackMethod})` : ''}
                      </>
                    )}
                    {/* DEC-068: the mark itself, where the paper form has a
                        signature line. Shown as evidence beside the
                        acknowledgement it accompanies, never in place of it. */}
                    {employeeSignature ? (
                      <div>
                        {/* eslint-disable-next-line @next/next/no-img-element -- authorized private route */}
                        <img
                          src={`/api/signatures/${employeeSignature.id}/image`}
                          alt={`Signature of ${employeeSignature.signerName}`}
                          className="sigmark"
                        />
                      </div>
                    ) : null}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Manager</th>
                  <td className="meta">
                    {managerHistorical
                      ? `${managerHistorical.actorDisplayName} - ${formatInstant(managerHistorical.createdAt)} (historical workflow)`
                      : 'No manager approval in this workflow - manager responsibilities are handled through the departure notice.'}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Human Resources</th>
                  <td>
                    {completion ? (
                      <>
                        <strong>{completion.actorDisplayName}</strong> ({completion.actorRole}) -{' '}
                        {formatInstant(completion.createdAt)}
                        {completion.invalidatedAt ? <strong> INVALIDATED</strong> : null}
                      </>
                    ) : (
                      <span className="meta">Pending completion by the assigned HR Officer.</span>
                    )}
                    {hrSignature ? (
                      <div>
                        {/* eslint-disable-next-line @next/next/no-img-element -- authorized private route */}
                        <img
                          src={`/api/signatures/${hrSignature.id}/image`}
                          alt={`Signature of ${hrSignature.signerName}`}
                          className="sigmark"
                        />
                      </div>
                    ) : null}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Lifecycle actions live under the sheet, as app chrome. */}
          <div style={{ maxWidth: '52rem', margin: '0 auto' }}>
            {/* DEC-068: signature requests and applied marks. */}
            <SignaturePanel
              caseId={id}
              formId={f.id}
              // Signatures are collected until the version is finalized, which
              // is the same boundary the service enforces - not the narrower
              // "still being edited" one.
              formEditable={!closed}
              employeeName={data.employeeDisplayName}
              employeeEmail={data.employeeWorkEmail}
              data={signatures}
            />

            {canEditSheet && editable ? (
              <form action={submitFormAction} style={{ marginBottom: 'var(--space-3)' }}>
                <input type="hidden" name="caseId" value={id} />
                <input type="hidden" name="formId" value={f.id} />
                <button type="submit">Finish preparation (ready for review)</button>
              </form>
            ) : null}

            {reviewable && cap.canComplete && openSignatureRequests > 0 ? (
              <p className="banner-baseline" role="status">
                {openSignatureRequests} signature{' '}
                {openSignatureRequests === 1 ? 'request is' : 'requests are'} still open. Completing
                the form freezes this version and the final PDF will record only the initials and
                signatures collected so far.
              </p>
            ) : null}
            {reviewable && cap.canComplete && financePendingCount > 0 ? (
              <p className="banner-baseline" role="status">
                The Finance evidence still has {financePendingCount} item(s) marked Pending.
                Completion freezes this version and the final PDF will permanently record them as
                Pending. Confirm nothing further will be recorded, or return the form instead.
              </p>
            ) : null}
            {reviewable ? (
              <div className="actions-row" aria-label="Review and completion">
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
                    <button type="submit">
                      Complete action form (attested, renders final PDF)
                    </button>
                  </form>
                ) : null}
                {cap.canReturn ? (
                  <details className="action">
                    <summary>Return for correction</summary>
                    <form action={returnFormAction} className="stack">
                      <input type="hidden" name="caseId" value={id} />
                      <input type="hidden" name="formId" value={f.id} />
                      <div className="field">
                        <label htmlFor="ret-reason">Reason (Required)</label>
                        <textarea id="ret-reason" name="reason" rows={2} required />
                      </div>
                      <button type="submit" className="secondary">
                        Return
                      </button>
                    </form>
                  </details>
                ) : null}
              </div>
            ) : null}

            {cap.canVoid && !closed ? (
              <ConfirmDialog
                trigger="Void form"
                title="Void this action form?"
                consequence={[
                  'This version stops being the live form for the case.',
                  'Anything already recorded on it stays readable in the version history.',
                  'A fresh form has to be prepared and completed before clearance can pass.',
                ]}
              >
                <form action={voidFormAction} className="stack">
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="formId" value={f.id} />
                  <Field
                    id="void-reason"
                    label="Why is this form being voided?"
                    required
                    hint="Recorded against the form and readable in the audit trail."
                  >
                    <textarea id="void-reason" name="reason" rows={2} required />
                  </Field>
                  <button type="submit" className="danger">
                    Void form
                  </button>
                </form>
              </ConfirmDialog>
            ) : null}

            {data.history.length ? (
              <section className="panel" style={{ marginTop: 'var(--space-4)' }}>
                <h2 style={{ marginTop: 0 }}>Version History</h2>
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
          </div>
        </>
      )}
    </>
  );
}
