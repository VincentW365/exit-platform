import {
  formatDateInput,
  formatInstant,
  RETURN_CHECKLIST_STATUS_LABEL,
  RETURN_ITEM_STATUSES,
  RETURN_ITEM_STATUS_LABEL,
  type ReturnChecklistStatus,
  type ReturnItemStatus,
} from '@exit/domain';
import { recordChecklistAction } from './actions';

/**
 * The HR-facing side of the Exit Checklist for Return Items. The recipient
 * normally completes it through the secure link; this panel shows what came
 * back and lets HR record or correct it when the paper form is what arrived.
 */

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

/** The two key rows print under a "KEYS" sub-heading on the paper form. */
function itemName(itemKey: string, label: string): string {
  return itemKey.startsWith('KEYS_') ? `Keys - ${label}` : label;
}

interface ChecklistItem {
  id: string;
  itemKey: string;
  label: string;
  status: string;
  remarks: string | null;
}

export interface ChecklistView {
  status: string;
  items: ChecklistItem[];
  unresolved: ReadonlyArray<{ label: string }>;
  canRecord: boolean;
  sentAt: Date | null;
  sentToName: string | null;
  sentToMask: string | null;
  submittedAt: Date | null;
  submittedByName: string | null;
  receivedByName: string | null;
  receivedAt: Date | null;
  employeeAcknowledgedBy: string | null;
}

export function ReturnChecklistPanel({
  caseId,
  checklist,
}: {
  caseId: string;
  checklist: ChecklistView;
}) {
  const status = checklist.status as ReturnChecklistStatus;
  const label = RETURN_CHECKLIST_STATUS_LABEL[status] ?? status;

  return (
    <section className="panel" aria-labelledby="return-checklist-h">
      <h2 id="return-checklist-h" style={{ marginTop: 0 }}>
        Exit Checklist for Return Items{' '}
        <span className={`badge ${CHECKLIST_BADGE[status] ?? 'badge--neutral'}`}>{label}</span>
      </h2>

      <dl className="kv">
        <dt>Checklist Sent</dt>
        <dd>
          {checklist.sentAt
            ? `${formatInstant(checklist.sentAt)}${
                checklist.sentToName ? ` to ${checklist.sentToName}` : ''
              }${checklist.sentToMask ? ` (${checklist.sentToMask})` : ''}`
            : 'Not sent yet'}
        </dd>
        <dt>Completed</dt>
        <dd>
          {checklist.submittedAt
            ? `${formatInstant(checklist.submittedAt)}${
                checklist.submittedByName ? ` by ${checklist.submittedByName}` : ''
              }`
            : 'Not returned yet'}
        </dd>
        <dt>Items Received By</dt>
        <dd>
          {checklist.receivedByName ?? '-'}
          {checklist.receivedAt ? ` on ${formatInstant(checklist.receivedAt)}` : ''}
        </dd>
        <dt>Employee Acknowledgement</dt>
        <dd>{checklist.employeeAcknowledgedBy ?? 'Not recorded'}</dd>
      </dl>

      {checklist.unresolved.length > 0 ? (
        <p className="hint" role="note">
          <strong>Still outstanding:</strong> {checklist.unresolved.map((i) => i.label).join(', ')}.
          Submitting the checklist never clears an item - these stay visible until HR resolves them.
        </p>
      ) : null}

      <div className="table-wrap">
        <table className="table-checklist">
          <caption className="sr-only">Return items and their recorded status</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Status</th>
              <th scope="col">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {checklist.items.map((item) => (
              <tr key={item.id}>
                <th scope="row">{itemName(item.itemKey, item.label)}</th>
                <td>
                  <span
                    className={`badge ${ITEM_BADGE[item.status as ReturnItemStatus] ?? 'badge--neutral'}`}
                  >
                    {RETURN_ITEM_STATUS_LABEL[item.status as ReturnItemStatus] ?? item.status}
                  </span>
                </td>
                <td>{item.remarks ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {checklist.canRecord ? (
        <details className="action">
          <summary>
            {checklist.submittedAt ? 'Correct the checklist' : 'Record the checklist for HR'}
          </summary>
          <form action={recordChecklistAction} className="stack">
            <input type="hidden" name="caseId" value={caseId} />
            <p className="hint">
              Use this when the completed form comes back on paper, or to correct what was
              submitted. Every change is recorded against your name.
            </p>
            <div className="table-wrap">
              <table className="table-checklist">
                <caption className="sr-only">Record the status of each return item</caption>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Status</th>
                    <th scope="col">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {checklist.items.map((item, index) => {
                    const name = itemName(item.itemKey, item.label);
                    return (
                      <tr key={item.id}>
                        <th scope="row">
                          <label htmlFor={`hr-status-${index}`}>{name}</label>
                        </th>
                        <td>
                          <input type="hidden" name={`item.${index}.key`} value={item.itemKey} />
                          <select
                            id={`hr-status-${index}`}
                            name={`item.${index}.status`}
                            defaultValue={item.status}
                          >
                            {RETURN_ITEM_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {RETURN_ITEM_STATUS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="text"
                            name={`item.${index}.remarks`}
                            aria-label={`Remarks for ${name}`}
                            maxLength={500}
                            defaultValue={item.remarks ?? ''}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="field">
              <label htmlFor="hr-receivedByName">Items Received By</label>
              <input
                id="hr-receivedByName"
                name="receivedByName"
                maxLength={120}
                required
                defaultValue={checklist.receivedByName ?? ''}
              />
            </div>
            <div className="field">
              <label htmlFor="hr-receivedAt">Date Received</label>
              <input
                id="hr-receivedAt"
                name="receivedAt"
                type="date"
                defaultValue={checklist.receivedAt ? formatDateInput(checklist.receivedAt) : ''}
              />
            </div>
            <div className="field">
              <label htmlFor="hr-submittedByName">Completed By</label>
              <input
                id="hr-submittedByName"
                name="submittedByName"
                maxLength={120}
                required
                defaultValue={checklist.submittedByName ?? ''}
              />
            </div>
            <div className="field">
              <label htmlFor="hr-employeeAcknowledgedBy">Employee Acknowledgement</label>
              <input
                id="hr-employeeAcknowledgedBy"
                name="employeeAcknowledgedBy"
                maxLength={120}
                defaultValue={checklist.employeeAcknowledgedBy ?? ''}
              />
              <span className="hint">Optional. The employee&apos;s name, if they signed.</span>
            </div>
            <button type="submit">Save Checklist</button>
          </form>
        </details>
      ) : null}
    </section>
  );
}
