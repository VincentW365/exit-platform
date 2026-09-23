import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  ServiceError,
  getCase,
  getReturnItemsChecklist,
  listCaseAssets,
  listIssuedAssetsForEmployee,
  listSignatureRequests,
} from '@exit/db';
import { formatInstant, ASSET_TYPES, ASSET_TYPE_LABELS } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { CaseTitle, Feedback } from '@/components/ui';
import { CaseNav } from '../CaseNav';
import { addAssetAction, assetDispositionAction, selectAssetsAction } from './actions';
import { ReceiptWorkspace } from './ReceiptWorkspace';
import { humanize } from '@/lib/text';
import { Chip, Row, Rows, SectionHead } from '@/components/patterns';
import { BoxIcon, CardIcon, KeyIcon, LaptopIcon, PhoneIcon, ShirtIcon } from '@/components/icons';

/** A recognizable mark per asset kind, so a row reads before its label. */
function assetIcon(assetType: string) {
  switch (assetType) {
    case 'LAPTOP':
      return <LaptopIcon />;
    case 'MOBILE_PHONE':
      return <PhoneIcon />;
    case 'KEYS':
      return <KeyIcon />;
    case 'EMPLOYEE_ID_CARD':
    case 'ACCESS_CARD':
    case 'HEALTH_CARD':
    case 'LUNCH_CARD':
      return <CardIcon />;
    case 'UNIFORM':
      return <ShirtIcon />;
    default:
      return <BoxIcon />;
  }
}

export const metadata: Metadata = { title: 'Asset Recovery' };
export const dynamic = 'force-dynamic';

const BADGE: Record<string, string> = {
  EXPECTED: 'badge--neutral',
  REQUESTED: 'badge--info',
  PARTIALLY_RETURNED: 'badge--warning',
  RETURNED: 'badge--success',
  NOT_ISSUED: 'badge--neutral',
  LOST: 'badge--danger',
  DAMAGED: 'badge--warning',
  WAIVED: 'badge--warning',
  WRITTEN_OFF: 'badge--warning',
  UNRESOLVED: 'badge--danger',
};

export default async function CaseAssetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;

  let data: Awaited<ReturnType<typeof listCaseAssets>>;
  try {
    data = await listCaseAssets(actor, id);
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

  const checklist = await getReturnItemsChecklist(actor, id);
  // DEC-069: the receipt collects signatures like the action form does.
  const signatures = checklist ? await listSignatureRequests(actor, id) : null;
  const caseView = checklist ? await getCase(actor, id) : null;
  const m = data.metrics;
  // What the directory says this employee holds - alive from the first day
  // of the case, before activation turns these into recovery items.
  const issued = await listIssuedAssetsForEmployee(actor, data.employeeSourceId).catch(() => []);
  const preActivation = ['DRAFT', 'PENDING_HR_REVIEW', 'APPROVED'].includes(data.caseStatus);
  // A type already being recovered must not be offered again, or the same
  // laptop ends up tracked twice.
  const tracked = new Set(data.items.map((i) => i.assetType));
  const caseClosed = ['COMPLETED', 'CANCELLED', 'VOIDED'].includes(data.caseStatus);
  const selectable = ASSET_TYPES.filter((a) => !tracked.has(a));

  return (
    <>
      <CaseTitle title="Asset Recovery" caseNumber={data.caseNumber} />
      <CaseNav caseId={id} active="assets" />
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Asset recovery documentation and physical recovery are separate measures. Asset status NEVER
        creates a payroll instruction, calculates a deduction or blocks final pay - an unresolved
        asset creates a review exception for authorized HR/Finance review only.
      </p>

      {checklist && signatures ? (
        <ReceiptWorkspace
          caseId={id}
          checklist={checklist}
          signatures={signatures}
          employeeName={caseView?.case.employeeDisplayName ?? 'Employee'}
          employeeEmail={caseView?.case.employeeWorkEmail ?? null}
        />
      ) : (
        <section className="panel" aria-labelledby="return-checklist-h">
          <h2 id="return-checklist-h" style={{ marginTop: 0 }}>
            Exit Checklist for Return Items{' '}
            <span className="badge badge--neutral">Not created yet</span>
          </h2>
          {/* Absent silently was read as broken (owner, 2026-08-25): the
              section now says when the checklist will exist. */}
          <p className="hint">
            The checklist is created when the workflow is activated, and the secure link for whoever
            receives the items goes out with the activation emails. Activate the case under Workflow
            to start it.
          </p>
        </section>
      )}

      {data.canManage && !caseClosed && selectable.length > 0 ? (
        <section className="panel" aria-labelledby="select-assets-h">
          <SectionHead
            id="select-assets-h"
            icon={<BoxIcon />}
            tone="attention"
            title="Which company assets does this employee hold?"
            description="Tick everything they hold. Each ticked item becomes a tracked recovery item, appears on the exit checklist, and is followed until it comes back."
            aside={
              data.items.length > 0 ? (
                <Chip tone="progress">{data.items.length} already tracked</Chip>
              ) : null
            }
          />
          <form action={selectAssetsAction}>
            <input type="hidden" name="caseId" value={id} />
            <table className="form-table">
              <caption className="sr-only">Company assets to select</caption>
              <thead>
                <tr>
                  <th scope="col">Holds</th>
                  <th scope="col">Asset</th>
                  <th scope="col">Identifier or serial (optional)</th>
                </tr>
              </thead>
              <tbody>
                {selectable.map((a) => (
                  <tr key={a}>
                    <td style={{ width: '5rem' }}>
                      <label className="tickbox">
                        <input type="checkbox" name="assetType" value={a} />
                        <span className="sr-only">{ASSET_TYPE_LABELS[a]}</span>
                      </label>
                    </td>
                    <th scope="row">
                      <span
                        className="row-item__mark"
                        aria-hidden
                        style={{ marginRight: 'var(--space-2)' }}
                      >
                        {assetIcon(a)}
                      </span>
                      {ASSET_TYPE_LABELS[a]}
                    </th>
                    <td>
                      <input
                        type="text"
                        name={`identifier.${a}`}
                        aria-label={`Identifier for ${ASSET_TYPE_LABELS[a]}`}
                        maxLength={100}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              Ticked assets are required for clearance and owned by HR. Anything unusual - a
              vehicle, tools, a company card - goes in under &ldquo;Other approved asset&rdquo; with
              a note in the identifier field.
            </p>
            <button type="submit" className="button--primary">
              Add the ticked assets
            </button>
          </form>
        </section>
      ) : null}

      {data.items.length === 0 ? (
        <section className="panel" aria-labelledby="issued-h">
          <SectionHead
            id="issued-h"
            icon={<BoxIcon />}
            tone={issued.length > 0 ? 'pending' : 'info'}
            title="Issued to this employee"
            description={
              preActivation
                ? 'What the company records say this employee holds. Each of these becomes a tracked recovery item the moment the workflow is activated - nothing needs recording here yet.'
                : 'No recovery items exist on this case yet. Add anything the employee holds below.'
            }
            aside={
              issued.length > 0 ? (
                <Chip tone="pending">{issued.length} to recover at activation</Chip>
              ) : (
                <Chip>Nothing on record</Chip>
              )
            }
          />
          {issued.length > 0 ? (
            <ul className="plain-list">
              {issued.map((a) => (
                <li
                  key={a.id}
                  className="row-item"
                  style={{ border: 0, padding: 'var(--space-2) 0' }}
                >
                  <span className="row-item__mark" aria-hidden>
                    {assetIcon(a.assetType)}
                  </span>
                  <span className="row-item__body">
                    <span className="row-item__title">{a.catalogueLabel}</span>
                    <span className="row-item__sub">
                      {humanize(a.assetType)}
                      {a.identifier ? ` · ${a.identifier}` : ''}
                      {a.issuedAt ? ` · issued ${formatInstant(a.issuedAt).split(',')[0]}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">
              The company&apos;s issued-asset records hold nothing for this employee. If they do
              hold company property, add it below so its return is tracked.
            </p>
          )}
        </section>
      ) : (
        <section aria-labelledby="tracked-h">
          <SectionHead
            id="tracked-h"
            icon={<BoxIcon />}
            tone={m.unresolvedCount > 0 ? 'critical' : m.openCount > 0 ? 'pending' : 'done'}
            title="Company property being recovered"
            description="Each item is followed until it comes back or its outcome is recorded. An unresolved item never affects pay - it raises a review exception for HR."
            aside={
              m.openCount > 0 ? (
                <Chip tone="pending">{m.openCount} outstanding</Chip>
              ) : (
                <Chip tone="done">All settled</Chip>
              )
            }
          />
          {/* Physical things, tracked: what it is, which one, when it is due
              back, and where it stands. */}
          <Rows label="Asset recovery items">
            {data.items.map((i) => (
              <Row
                key={i.id}
                tone={
                  ['LOST', 'DAMAGED', 'UNRESOLVED'].includes(i.status)
                    ? 'critical'
                    : i.overdue
                      ? 'attention'
                      : i.status === 'RETURNED'
                        ? 'done'
                        : 'progress'
                }
                muted={['RETURNED', 'NOT_ISSUED'].includes(i.status)}
                mark={assetIcon(i.assetType)}
                title={
                  <>
                    {i.label}
                    {!i.requiredForClearance ? (
                      <span className="meta"> · not required for clearance</span>
                    ) : null}
                  </>
                }
                sub={
                  <>
                    {[i.identifier, i.serialNumber].filter(Boolean).join(' / ') ||
                      humanize(i.assetType)}
                    {' · '}
                    {i.responsibleDepartment}
                    {i.dispositionAt
                      ? ` · recorded ${formatInstant(i.dispositionAt)}${i.dispositionReason ? ` - ${i.dispositionReason}` : ''}`
                      : i.remarks
                        ? ` · ${i.remarks}`
                        : ''}
                  </>
                }
                facts={
                  <>
                    <span>
                      <span className="label">Expected back</span>
                      <span className="value numeric">
                        {i.expectedReturnAt ? formatInstant(i.expectedReturnAt).split(',')[0] : '-'}
                      </span>
                    </span>
                    <span className={`badge ${BADGE[i.status] ?? 'badge--neutral'}`}>
                      {humanize(i.status)}
                    </span>
                    {i.overdue ? <Chip tone="critical">Overdue</Chip> : null}
                  </>
                }
                action={
                  data.canManage &&
                  ['EXPECTED', 'REQUESTED', 'PARTIALLY_RETURNED', 'UNRESOLVED'].includes(
                    i.status,
                  ) ? (
                    <details className="action">
                      <summary>Record outcome</summary>
                      <form action={assetDispositionAction} className="stack">
                        <input type="hidden" name="caseId" value={id} />
                        <input type="hidden" name="itemId" value={i.id} />
                        <div className="field">
                          <label htmlFor={`st-${i.id}`}>New Status</label>
                          <select id={`st-${i.id}`} name="status" required>
                            <option value="REQUESTED">Requested</option>
                            <option value="PARTIALLY_RETURNED">Partially returned</option>
                            <option value="RETURNED">Returned (final)</option>
                            <option value="NOT_ISSUED">Not issued (final)</option>
                            <option value="LOST">Lost (final, reason required)</option>
                            <option value="DAMAGED">Damaged (final, reason required)</option>
                            {data.canWaiveWriteOff ? (
                              <>
                                <option value="WAIVED">Waived (HR Manager, reason required)</option>
                                <option value="WRITTEN_OFF">
                                  Written off (HR Manager, reason required)
                                </option>
                              </>
                            ) : null}
                            <option value="UNRESOLVED">Unresolved (reason required)</option>
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor={`cond-${i.id}`}>Condition</label>
                          <input id={`cond-${i.id}`} name="condition" maxLength={300} />
                        </div>
                        <div className="field">
                          <label htmlFor={`rem-${i.id}`}>Remarks</label>
                          <input id={`rem-${i.id}`} name="remarks" maxLength={1000} />
                        </div>
                        <div className="field">
                          <label htmlFor={`rsn-${i.id}`}>
                            Reason (Required for lost, damaged, waived, written off or unresolved)
                          </label>
                          <input id={`rsn-${i.id}`} name="reason" maxLength={1000} />
                        </div>
                        <button type="submit">Record</button>
                      </form>
                    </details>
                  ) : null
                }
              />
            ))}
          </Rows>
        </section>
      )}

      <section className="panel" aria-labelledby="asset-metrics-h">
        <h2 id="asset-metrics-h" style={{ marginTop: 0 }}>
          Recovery Measures
        </h2>
        <dl className="kv">
          <dt>Disposition Documentation Rate</dt>
          <dd>
            {m.documentationRatePct === null ? '-' : `${m.documentationRatePct}%`} (
            {m.documentedCount} of {m.requiredCount} required items documented)
          </dd>
          <dt>Physical Recovery Rate</dt>
          <dd>
            {m.physicalRecoveryRatePct === null ? '-' : `${m.physicalRecoveryRatePct}%`} (
            {m.physicallyReturned} of {m.physicalDenominator} issued-and-due items returned;
            NOT_ISSUED excluded)
          </dd>
          <dt>Open / Unresolved</dt>
          <dd>
            {m.openCount} open, {m.unresolvedCount} unresolved
          </dd>
        </dl>
      </section>

      {data.canManage ? (
        <details className="action">
          <summary>Add an asset this employee holds (unlisted in the records)</summary>
          <form action={addAssetAction}>
            <input type="hidden" name="caseId" value={id} />
            <label htmlFor="a-type">Asset Type</label>
            <select id="a-type" name="assetType" required>
              {ASSET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ASSET_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <label htmlFor="a-label">Label (Required)</label>
            <input id="a-label" name="label" required maxLength={200} />
            <label htmlFor="a-ident">Identifier</label>
            <input id="a-ident" name="identifier" maxLength={100} />
            <label htmlFor="a-serial">Serial / Reference Number</label>
            <input id="a-serial" name="serialNumber" maxLength={100} />
            <label htmlFor="a-dept">Responsible Department</label>
            <select id="a-dept" name="responsibleDepartment">
              <option value="HR">HR</option>
              <option value="IT">IT</option>
              <option value="FINANCE">Finance</option>
            </select>
            <label>
              <input type="checkbox" name="requiredForClearance" defaultChecked /> Required for
              Clearance
            </label>
            <button type="submit">Add item</button>
          </form>
        </details>
      ) : null}
    </>
  );
}
