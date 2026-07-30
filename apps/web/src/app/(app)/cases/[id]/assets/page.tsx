import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServiceError, listCaseAssets } from '@exit/db';
import { formatInstant, ASSET_TYPES, ASSET_TYPE_LABELS } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { CaseNav } from '../CaseNav';
import { addAssetAction, assetDispositionAction } from './actions';

export const metadata: Metadata = { title: 'Asset recovery' };
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
      return <p className="panel">This area requires full case access.</p>;
    throw e;
  }

  const m = data.metrics;

  return (
    <>
      <h1>Asset recovery - {data.caseNumber}</h1>
      <CaseNav caseId={id} active="assets" />
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Asset recovery documentation and physical recovery are separate measures. Asset status NEVER
        creates a payroll instruction, calculates a deduction or blocks final pay - an unresolved
        asset creates a review exception for authorized HR/Finance review only.
      </p>

      <section className="panel" aria-labelledby="asset-metrics-h">
        <h2 id="asset-metrics-h" style={{ marginTop: 0 }}>
          Recovery measures
        </h2>
        <dl className="kv">
          <dt>Disposition documentation rate</dt>
          <dd>
            {m.documentationRatePct === null ? '-' : `${m.documentationRatePct}%`} (
            {m.documentedCount} of {m.requiredCount} required items documented)
          </dd>
          <dt>Physical recovery rate</dt>
          <dd>
            {m.physicalRecoveryRatePct === null ? '-' : `${m.physicalRecoveryRatePct}%`} (
            {m.physicallyReturned} of {m.physicalDenominator} issued-and-due items returned;
            NOT_ISSUED excluded)
          </dd>
          <dt>Open / unresolved</dt>
          <dd>
            {m.openCount} open, {m.unresolvedCount} unresolved
          </dd>
        </dl>
      </section>

      {data.items.length === 0 ? (
        <p className="panel">
          No recovery items. Items are created from issued-asset records at activation and can be
          added manually below.
        </p>
      ) : (
        <div className="panel" style={{ overflowX: 'auto' }}>
          <table>
            <caption className="visually-hidden">Asset recovery items</caption>
            <thead>
              <tr>
                <th scope="col">Asset</th>
                <th scope="col">Identifier</th>
                <th scope="col">Department</th>
                <th scope="col">Expected return</th>
                <th scope="col">Status</th>
                <th scope="col">Disposition</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.label}
                    {!i.requiredForClearance ? <span className="hint"> (not required)</span> : null}
                  </td>
                  <td>
                    {i.identifier ?? '-'}
                    {i.serialNumber ? <span className="hint"> / {i.serialNumber}</span> : null}
                  </td>
                  <td>{i.responsibleDepartment}</td>
                  <td>
                    {i.expectedReturnAt ? formatInstant(i.expectedReturnAt) : '-'}
                    {i.overdue ? (
                      <>
                        {' '}
                        <span className="badge badge--danger">OVERDUE</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <span className={`badge ${BADGE[i.status] ?? 'badge--neutral'}`}>
                      {i.status}
                    </span>
                  </td>
                  <td>
                    {i.dispositionAt
                      ? `${formatInstant(i.dispositionAt)}${i.dispositionReason ? ` - ${i.dispositionReason}` : ''}`
                      : (i.remarks ?? '-')}
                    {data.canManage &&
                    ['EXPECTED', 'REQUESTED', 'PARTIALLY_RETURNED', 'UNRESOLVED'].includes(
                      i.status,
                    ) ? (
                      <details className="action">
                        <summary>Record status / disposition</summary>
                        <form action={assetDispositionAction}>
                          <input type="hidden" name="caseId" value={id} />
                          <input type="hidden" name="itemId" value={i.id} />
                          <label htmlFor={`st-${i.id}`}>New status</label>
                          <select id={`st-${i.id}`} name="status" required>
                            <option value="REQUESTED">REQUESTED</option>
                            <option value="PARTIALLY_RETURNED">PARTIALLY_RETURNED</option>
                            <option value="RETURNED">RETURNED (final)</option>
                            <option value="NOT_ISSUED">NOT_ISSUED (final)</option>
                            <option value="LOST">LOST (final, reason required)</option>
                            <option value="DAMAGED">DAMAGED (final, reason required)</option>
                            {data.canWaiveWriteOff ? (
                              <>
                                <option value="WAIVED">WAIVED (HR Manager, reason required)</option>
                                <option value="WRITTEN_OFF">
                                  WRITTEN_OFF (HR Manager, reason required)
                                </option>
                              </>
                            ) : null}
                            <option value="UNRESOLVED">UNRESOLVED (reason required)</option>
                          </select>
                          <label htmlFor={`cond-${i.id}`}>Condition</label>
                          <input id={`cond-${i.id}`} name="condition" maxLength={300} />
                          <label htmlFor={`rem-${i.id}`}>Remarks</label>
                          <input id={`rem-${i.id}`} name="remarks" maxLength={1000} />
                          <label htmlFor={`rsn-${i.id}`}>
                            Reason (required for LOST / DAMAGED / WAIVED / WRITTEN_OFF / UNRESOLVED)
                          </label>
                          <input id={`rsn-${i.id}`} name="reason" maxLength={1000} />
                          <button type="submit">Record</button>
                        </form>
                      </details>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.canManage ? (
        <details className="action">
          <summary>Add an asset recovery item</summary>
          <form action={addAssetAction}>
            <input type="hidden" name="caseId" value={id} />
            <label htmlFor="a-type">Asset type</label>
            <select id="a-type" name="assetType" required>
              {ASSET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ASSET_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <label htmlFor="a-label">Label (required)</label>
            <input id="a-label" name="label" required maxLength={200} />
            <label htmlFor="a-ident">Identifier</label>
            <input id="a-ident" name="identifier" maxLength={100} />
            <label htmlFor="a-serial">Serial / reference number</label>
            <input id="a-serial" name="serialNumber" maxLength={100} />
            <label htmlFor="a-dept">Responsible department</label>
            <select id="a-dept" name="responsibleDepartment">
              <option value="HR">HR</option>
              <option value="IT">IT</option>
              <option value="FINANCE">Finance</option>
              <option value="LINE_MANAGER">Line manager</option>
            </select>
            <label>
              <input type="checkbox" name="requiredForClearance" defaultChecked /> Required for
              clearance
            </label>
            <button type="submit">Add item</button>
          </form>
        </details>
      ) : null}
    </>
  );
}
