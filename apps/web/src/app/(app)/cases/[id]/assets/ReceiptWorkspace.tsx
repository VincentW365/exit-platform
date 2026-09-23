import type { getReturnItemsChecklist, listSignatureRequests } from '@exit/db';
import {
  formatDateInput,
  formatInstant,
  FORM_DISPLAY_LABELS,
  RETURN_CHECKLIST_STATUS_LABEL,
  RETURN_ITEM_STATUS_LABEL,
  type ReturnChecklistStatus,
  type ReturnItemStatus,
} from '@exit/domain';
import { ProgressBar, SectionHead } from '@/components/patterns';
import { ClipboardIcon } from '@/components/icons';
import { RevisionHistory } from '@/components/RevisionHistory';
import { SignaturePanel } from '../action-form/SignaturePanel';
import { ReceiptEditor, type EditableRow } from './ReceiptEditor';
import {
  finalizeReceiptAction,
  markReceiptReadyAction,
  startNewReceiptVersionAction,
  updateReceiptAction,
} from './actions';

/**
 * The Exit Checklist for Return Items as a document workspace (DEC-069
 * sections 13, 14 and 43): what came back, edited by HR before it is final,
 * previewed and downloaded as a PDF, signed where required, kept as versions,
 * and superseded by a new version when a signed one must change.
 */
type Checklist = NonNullable<Awaited<ReturnType<typeof getReturnItemsChecklist>>>;
type Signatures = Awaited<ReturnType<typeof listSignatureRequests>>;

const CHECKLIST_BADGE: Record<ReturnChecklistStatus, string> = {
  NOT_STARTED: 'badge--neutral',
  IN_PROGRESS: 'badge--info',
  COMPLETED: 'badge--success',
  COMPLETED_WITH_OUTSTANDING: 'badge--warning',
};

const ITEM_BADGE: Record<ReturnItemStatus, string> = {
  OUTSTANDING: 'badge--neutral',
  RETURNED: 'badge--success',
  NOT_RETURNED: 'badge--danger',
  NOT_APPLICABLE: 'badge--neutral',
  LOST_OR_DAMAGED: 'badge--warning',
};

export function ReceiptWorkspace({
  caseId,
  checklist,
  signatures,
  employeeName,
  employeeEmail,
}: {
  caseId: string;
  checklist: Checklist;
  signatures: Signatures;
  employeeName: string;
  employeeEmail: string | null;
}) {
  const decided = checklist.items.filter((i) => i.status !== 'OUTSTANDING').length;
  const outstanding = checklist.items.length - decided;
  const percent = checklist.items.length ? Math.round((decided / checklist.items.length) * 100) : 0;
  const display = checklist.displayStatus;
  const returnTo = `/cases/${caseId}/assets`;

  const rows: EditableRow[] = checklist.items.map((i) => ({
    id: i.id,
    itemKey: i.itemKey,
    label: i.label,
    status: i.status,
    remarks: i.remarks ?? '',
    quantity: i.quantity != null ? String(i.quantity) : '',
    condition: i.condition ?? '',
    returnedAt: i.returnedAt ? formatDateInput(i.returnedAt) : '',
    assetReference: i.assetReference ?? '',
    custom: i.custom,
  }));

  return (
    <section className="panel receipt" aria-labelledby="return-checklist-h">
      <SectionHead
        id="return-checklist-h"
        icon={<ClipboardIcon />}
        title="Exit Checklist for Return Items"
        description={`Version ${checklist.version}`}
        aside={
          <>
            {display ? (
              <span className="badge badge--info">{FORM_DISPLAY_LABELS[display]}</span>
            ) : null}{' '}
            <span
              className={`badge ${CHECKLIST_BADGE[checklist.status as ReturnChecklistStatus] ?? 'badge--neutral'}`}
            >
              {RETURN_CHECKLIST_STATUS_LABEL[checklist.status as ReturnChecklistStatus] ??
                checklist.status}
            </span>
          </>
        }
      />

      {/* --- toolbar: the document's actions in one row ----------------- */}
      <div className="actions-row workspace__toolbar">
        <a
          className="button secondary compact"
          href={`/api/cases/${caseId}/return-checklist/pdf`}
          target="_blank"
          rel="noreferrer"
        >
          {checklist.locked ? 'Download PDF' : 'Download PDF (draft)'}
        </a>
        {checklist.editable && checklist.lifecycle === 'DRAFT' ? (
          <form action={markReceiptReadyAction}>
            <input type="hidden" name="caseId" value={caseId} />
            <button type="submit" className="secondary compact">
              Mark as reviewed
            </button>
          </form>
        ) : null}
        {checklist.canManage && !checklist.locked ? (
          <details className="action" style={{ display: 'inline-block' }}>
            <summary>Finalize</summary>
            <form action={finalizeReceiptAction} className="stack">
              <input type="hidden" name="caseId" value={caseId} />
              <p className="hint">
                Finalizing locks this version and renders its PDF with the signatures collected so
                far. Anything still outstanding stays outstanding on the case.
              </p>
              <button type="submit">Finalize checklist</button>
            </form>
          </details>
        ) : null}
        {checklist.canManage && (checklist.locked || checklist.hasLiveSignatures) ? (
          <details className="action" style={{ display: 'inline-block' }}>
            <summary>Start new version</summary>
            <form action={startNewReceiptVersionAction} className="stack">
              <input type="hidden" name="caseId" value={caseId} />
              <p className="hint">
                This version is kept exactly as it is, with its signatures. The new version starts
                from the same rows and notes; any signatures are collected again.
              </p>
              <label className="field">
                <span className="field__label">Reason</span>
                <input type="text" name="reason" className="input" maxLength={300} required />
              </label>
              <button type="submit" className="secondary">
                Start new version
              </button>
            </form>
          </details>
        ) : null}
      </div>

      {checklist.hasLiveSignatures && !checklist.locked ? (
        <p className="banner-baseline">
          A signature has been applied to this version, so its rows are locked. To change them,
          start a new version; the signed version is kept.
        </p>
      ) : null}

      <p className="meta">
        {percent}% · {decided} of {checklist.items.length} items decided
      </p>
      <ProgressBar percent={percent} label="Checklist completion" />

      <dl className="kv">
        <div>
          <dt>Secure link</dt>
          <dd>
            {checklist.sentAt
              ? `Sent ${formatInstant(checklist.sentAt)} to ${checklist.sentToName ?? 'the recipient'}${checklist.sentToMask ? ` (${checklist.sentToMask})` : ''}`
              : 'Not sent yet'}
          </dd>
        </div>
        <div>
          <dt>Returned</dt>
          <dd>
            {checklist.submittedAt
              ? `${formatInstant(checklist.submittedAt)}${checklist.submittedByName ? ` by ${checklist.submittedByName}` : ''}`
              : 'Not returned yet'}
          </dd>
        </div>
        <div>
          <dt>Items Received By</dt>
          <dd>
            {checklist.receivedByName ?? '-'}
            {checklist.receivedAt ? ` on ${formatInstant(checklist.receivedAt)}` : ''}
          </dd>
        </div>
        <div>
          <dt>Employee Acknowledgement</dt>
          <dd>{checklist.employeeAcknowledgedBy ?? 'Not recorded'}</dd>
        </div>
      </dl>

      {checklist.unresolved.length > 0 ? (
        <p className="hint" role="note">
          <strong>Still outstanding:</strong> {checklist.unresolved.map((i) => i.label).join(', ')}.
          Submitting the checklist never clears an item - these stay visible until HR resolves them.
        </p>
      ) : null}

      <details className="action" open={outstanding > 0 && !checklist.editable}>
        <summary>
          {outstanding > 0 ? `The checklist (${outstanding} still to answer)` : 'The checklist'}
        </summary>
        <table className="form-table">
          <caption className="sr-only">Return items and their recorded status</caption>
          <thead>
            <tr>
              <th scope="col" aria-label="Number" className="form-table__num" />
              <th scope="col">Items</th>
              <th scope="col">Check (&#10003;)</th>
              <th scope="col">Detail</th>
              <th scope="col">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {checklist.items.map((item, i) => (
              <tr key={item.id}>
                <td className="form-table__num">{i + 1}.</td>
                <th scope="row">
                  {item.itemKey?.startsWith('KEYS_') ? 'Keys - ' : ''}
                  {item.label}
                </th>
                <td>
                  <span
                    className={`badge ${ITEM_BADGE[item.status as ReturnItemStatus] ?? 'badge--neutral'}`}
                  >
                    {RETURN_ITEM_STATUS_LABEL[item.status as ReturnItemStatus] ?? item.status}
                  </span>
                </td>
                <td className="meta">
                  {[
                    item.quantity != null ? `Qty ${item.quantity}` : null,
                    item.condition,
                    item.returnedAt ? `Returned ${formatDateInput(item.returnedAt)}` : null,
                    item.assetReference ? `Ref ${item.assetReference}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '-'}
                </td>
                <td>{item.remarks ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {checklist.hrNotes ? <p className="hint">{checklist.hrNotes}</p> : null}
      </details>

      {checklist.editable ? (
        <details className="action" open={!checklist.submittedAt}>
          <summary>Edit checklist</summary>
          <p className="hint">
            Use this when the completed form comes back on paper, to correct what was submitted, or
            to record property the printed form does not list. Every save is kept as a version.
          </p>
          <ReceiptEditor
            caseId={caseId}
            rows={rows}
            hrNotes={checklist.hrNotes ?? ''}
            receivedByName={checklist.receivedByName ?? ''}
            receivedAt={checklist.receivedAt ? formatDateInput(checklist.receivedAt) : ''}
            action={updateReceiptAction}
          />
        </details>
      ) : null}

      <RevisionHistory revisions={checklist.revisions} />

      {checklist.history.length > 0 ? (
        <p className="meta">
          Earlier versions:{' '}
          {checklist.history
            .map(
              (h) =>
                `v${h.version} (${h.lifecycle.toLowerCase()}${h.supersededReason ? `: ${h.supersededReason}` : ''})`,
            )
            .join('; ')}
        </p>
      ) : null}

      <SignaturePanel
        caseId={caseId}
        formId={checklist.id}
        formEditable={!checklist.locked}
        employeeName={employeeName}
        employeeEmail={employeeEmail}
        data={signatures}
        documentKind="ASSET_RECEIPT"
        returnTo={returnTo}
      />
    </section>
  );
}
