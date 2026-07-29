import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServiceError, getActionForm } from '@exit/db';
import {
  FINANCE_CHECKLIST_ITEMS,
  HR_CHECKLIST_ITEMS,
  formatInstant,
  type ChecklistState,
} from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { CaseNav } from '../CaseNav';
import {
  createFormAction,
  hrApproveAction,
  hrReturnAction,
  managerApproveAction,
  managerReturnAction,
  saveFinanceSectionAction,
  saveHrSectionAction,
  submitFormAction,
  voidFormAction,
} from './actions';

export const metadata: Metadata = { title: 'Action form' };
export const dynamic = 'force-dynamic';

const FORM_BADGE: Record<string, string> = {
  DRAFT: 'badge--neutral',
  RETURNED: 'badge--warning',
  PENDING_MANAGER: 'badge--warning',
  PENDING_HR: 'badge--warning',
  APPROVED: 'badge--success',
  SUPERSEDED: 'badge--neutral',
  VOIDED: 'badge--neutral',
};

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
  const editable = f ? ['DRAFT', 'RETURNED'].includes(f.status) : false;
  const limited = data.level === 'FINANCE_FORM' || data.level === 'MANAGER_FORM';

  return (
    <>
      <h1>{data.caseNumber} - Employee Action Form (offboarding)</h1>
      {!limited ? <CaseNav caseId={id} active="action-form" /> : null}
      <Feedback err={sp.err} ok={sp.ok} />
      {limited ? (
        <p className="banner-baseline">
          You see the minimum information required for your assigned role (
          {data.level === 'FINANCE_FORM' ? 'Finance checklist' : 'Manager review'}). Restricted HR
          fields are not shown.
        </p>
      ) : null}

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
              <span className={`badge ${FORM_BADGE[f.status]}`}>
                {f.status.replaceAll('_', ' ')}
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
            {f.returnReason && f.status === 'RETURNED' ? (
              <p className="banner-baseline">Returned: {f.returnReason}</p>
            ) : null}
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
                <h3>Approvals (authenticated attestations)</h3>
                <ul>
                  {data.attestations.map((a, i) => (
                    <li key={i}>
                      {a.kind === 'MANAGER_FORM_APPROVAL'
                        ? 'Manager approval'
                        : 'HR final approval'}
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
                HR section (checklist = completion evidence, not approval)
              </h2>
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
                  <button type="submit">Submit for manager approval</button>
                </form>
              ) : null}
            </section>
          ) : null}

          {(cap.canFinanceEdit || (cap.canEdit && 'financeChecklist' in f)) &&
          f.financeChecklist ? (
            <section className="panel" aria-labelledby="fin-sec">
              <h2 id="fin-sec" style={{ marginTop: 0 }}>
                Finance checklist (all financial work happens outside this application)
              </h2>
              <p className="hint">
                No pay amounts are recorded here and nothing on this form calculates or changes pay.
              </p>
              <form action={saveFinanceSectionAction} className="stack">
                <input type="hidden" name="caseId" value={id} />
                <input type="hidden" name="formId" value={f.id} />
                <ChecklistFields
                  prefix="fin"
                  items={FINANCE_CHECKLIST_ITEMS}
                  state={f.financeChecklist}
                  disabled={
                    f.status === 'APPROVED' || f.status === 'VOIDED' || f.status === 'SUPERSEDED'
                  }
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
                <button type="submit">Save finance checklist</button>
              </form>
            </section>
          ) : null}

          {f.status === 'PENDING_MANAGER' && cap.canManagerApprove ? (
            <section className="panel actions-row" aria-label="Manager approval">
              <form action={managerApproveAction}>
                <input type="hidden" name="caseId" value={id} />
                <input type="hidden" name="formId" value={f.id} />
                <button type="submit">Approve as responsible manager (attested)</button>
              </form>
              <details className="action">
                <summary>Return with reason</summary>
                <form action={managerReturnAction} className="stack">
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="formId" value={f.id} />
                  <div className="field">
                    <label htmlFor="mgr-reason">Reason (required)</label>
                    <textarea id="mgr-reason" name="reason" rows={2} required />
                  </div>
                  <button type="submit" className="secondary">
                    Return
                  </button>
                </form>
              </details>
            </section>
          ) : null}

          {f.status === 'PENDING_HR' && cap.canHrApprove ? (
            <section className="panel actions-row" aria-label="HR final approval">
              <form action={hrApproveAction}>
                <input type="hidden" name="caseId" value={id} />
                <input type="hidden" name="formId" value={f.id} />
                <button type="submit">Give HR final approval (attested, renders final PDF)</button>
              </form>
              <details className="action">
                <summary>Return with reason</summary>
                <form action={hrReturnAction} className="stack">
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="formId" value={f.id} />
                  <div className="field">
                    <label htmlFor="hr-reason">Reason (required)</label>
                    <textarea id="hr-reason" name="reason" rows={2} required />
                  </div>
                  <button type="submit" className="secondary">
                    Return
                  </button>
                </form>
              </details>
            </section>
          ) : null}

          {cap.canVoid && !['APPROVED', 'VOIDED', 'SUPERSEDED'].includes(f.status) ? (
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
                    Version {h.version} - {h.status}
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
