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
import { ProgressBar, SectionHead } from '@/components/patterns';
import { ClipboardIcon } from '@/components/icons';

/**
 * The HR-facing side of the Exit Checklist for Return Items, on the company's
 * printed layout. The recipient normally completes it through the secure
 * link; this panel shows what came back on the same ruled table, and lets HR
 * record or correct it in place when the paper form is what arrived.
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

/** Items above the KEYS sub-heading, exactly as the sheet numbers them. */
function splitItems(items: readonly ChecklistItem[]) {
  return {
    main: items.filter((i) => !i.itemKey.startsWith('KEYS_')),
    keys: items.filter((i) => i.itemKey.startsWith('KEYS_')),
  };
}

/** The recorded state of one item, read-only, on the ruled table. */
function ViewRow({ item, number }: { item: ChecklistItem; number: number }) {
  return (
    <tr>
      <td className="form-table__num">{number}.</td>
      <th scope="row">{item.label}</th>
      <td>
        <span
          className={`badge ${ITEM_BADGE[item.status as ReturnItemStatus] ?? 'badge--neutral'}`}
        >
          {RETURN_ITEM_STATUS_LABEL[item.status as ReturnItemStatus] ?? item.status}
        </span>
      </td>
      <td>{item.remarks ?? '-'}</td>
    </tr>
  );
}

/**
 * One editable row of the HR record/correct form. Unlike the public link,
 * HR can also tick an item BACK to Outstanding when a correction demands it,
 * so all five states are offered and one is always ticked.
 */
function EditRow({ item, index, number }: { item: ChecklistItem; index: number; number: number }) {
  return (
    <tr>
      <td className="form-table__num">{number}.</td>
      <th scope="row" id={`hr-item-${index}`}>
        {item.label}
      </th>
      <td>
        <input type="hidden" name={`item.${index}.key`} value={item.itemKey} />
        <div className="tickset" role="radiogroup" aria-labelledby={`hr-item-${index}`}>
          {RETURN_ITEM_STATUSES.map((s) => (
            <label key={s} className="tick">
              <input
                type="radio"
                name={`item.${index}.status`}
                value={s}
                defaultChecked={item.status === s}
              />
              {RETURN_ITEM_STATUS_LABEL[s]}
            </label>
          ))}
        </div>
      </td>
      <td>
        <input
          type="text"
          name={`item.${index}.remarks`}
          aria-label={`Remarks for ${item.label}`}
          maxLength={500}
          defaultValue={item.remarks ?? ''}
        />
      </td>
    </tr>
  );
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
  const { main, keys } = splitItems(checklist.items);

  // Section 10: a guided completion, so the reader sees how far this has run
  // before they see the detail. An item counts as settled once somebody has
  // decided about it - "not returned" is an answer, not a blank.
  const settled = checklist.items.filter((i) => i.status !== 'OUTSTANDING').length;
  const total = checklist.items.length;
  const percent = total === 0 ? 0 : Math.round((settled / total) * 100);
  const outstanding = total - settled;

  return (
    <section className="panel" aria-labelledby="return-checklist-h">
      <SectionHead
        id="return-checklist-h"
        icon={<ClipboardIcon />}
        tone={checklist.unresolved.length > 0 ? 'attention' : outstanding > 0 ? 'pending' : 'done'}
        title="Exit Checklist for Return Items"
        description="The company's printed checklist, as it came back. Every item is decided before the case can close."
        aside={
          <span className={`badge ${CHECKLIST_BADGE[status] ?? 'badge--neutral'}`}>{label}</span>
        }
      />

      <div className="well" style={{ marginBottom: 'var(--space-4)' }}>
        <span className="label">Completion</span>
        <p className="value numeric" style={{ margin: 'var(--space-1) 0' }}>
          {percent}% · {settled} of {total} items decided
          {outstanding > 0 ? ` · ${outstanding} still to answer` : ''}
        </p>
        <ProgressBar percent={percent} light label="Checklist completion" />
      </div>

      <dl className="facts" style={{ marginBottom: 'var(--space-4)' }}>
        <div>
          <dt>Checklist Sent</dt>
          <dd>
            {checklist.sentAt
              ? `${formatInstant(checklist.sentAt)}${
                  checklist.sentToName ? ` to ${checklist.sentToName}` : ''
                }${checklist.sentToMask ? ` (${checklist.sentToMask})` : ''}`
              : 'Not sent yet'}
          </dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>
            {checklist.submittedAt
              ? `${formatInstant(checklist.submittedAt)}${
                  checklist.submittedByName ? ` by ${checklist.submittedByName}` : ''
                }`
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

      {/* The whole sheet stays available, but once everything is decided it
          folds away: a finished checklist should not dominate the page. */}
      <details className="action" open={outstanding > 0}>
        <summary>
          {outstanding > 0
            ? `The checklist (${outstanding} still to answer)`
            : 'The completed checklist'}
        </summary>
        <table className="form-table">
          <caption className="sr-only">Return items and their recorded status</caption>
          <thead>
            <tr>
              <th scope="col" aria-label="Number" className="form-table__num" />
              <th scope="col">Items</th>
              <th scope="col">Check (&#10003;)</th>
              <th scope="col">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {main.map((item, i) => (
              <ViewRow key={item.id} item={item} number={i + 1} />
            ))}
            <tr className="form-table__group">
              <td className="form-table__num" />
              <th scope="rowgroup" colSpan={3}>
                Keys
              </th>
            </tr>
            {keys.map((item, i) => (
              <ViewRow key={item.id} item={item} number={main.length + i + 1} />
            ))}
          </tbody>
        </table>
      </details>

      {checklist.canRecord ? (
        <details className="action" style={{ marginTop: 'var(--space-3)' }}>
          <summary>
            {checklist.submittedAt ? 'Correct the checklist' : 'Record the checklist for HR'}
          </summary>
          <form action={recordChecklistAction}>
            <input type="hidden" name="caseId" value={caseId} />
            <p className="hint">
              Use this when the completed form comes back on paper, or to correct what was
              submitted. Every change is recorded against your name.
            </p>
            <table className="form-table">
              <caption className="sr-only">Record the status of each return item</caption>
              <thead>
                <tr>
                  <th scope="col" aria-label="Number" className="form-table__num" />
                  <th scope="col">Items</th>
                  <th scope="col">Check (&#10003;)</th>
                  <th scope="col">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {main.map((item, i) => (
                  <EditRow key={item.id} item={item} index={i} number={i + 1} />
                ))}
                <tr className="form-table__group">
                  <td className="form-table__num" />
                  <th scope="rowgroup" colSpan={3}>
                    Keys
                  </th>
                </tr>
                {keys.map((item, i) => (
                  <EditRow
                    key={item.id}
                    item={item}
                    index={main.length + i}
                    number={main.length + i + 1}
                  />
                ))}
              </tbody>
            </table>
            <div className="sigline">
              <label className="sigline__label" htmlFor="hr-receivedByName">
                Items Received By:
              </label>
              <input
                id="hr-receivedByName"
                name="receivedByName"
                maxLength={120}
                required
                defaultValue={checklist.receivedByName ?? ''}
              />
              <label className="sigline__label" htmlFor="hr-receivedAt">
                Date:
              </label>
              <input
                id="hr-receivedAt"
                name="receivedAt"
                type="date"
                style={{ flex: '0 1 11rem' }}
                defaultValue={checklist.receivedAt ? formatDateInput(checklist.receivedAt) : ''}
              />
            </div>
            <div className="sigline">
              <label className="sigline__label" htmlFor="hr-submittedByName">
                Completed By:
              </label>
              <input
                id="hr-submittedByName"
                name="submittedByName"
                maxLength={120}
                required
                defaultValue={checklist.submittedByName ?? ''}
              />
              <label className="sigline__label" htmlFor="hr-employeeAcknowledgedBy">
                Employee Acknowledgement:
              </label>
              <input
                id="hr-employeeAcknowledgedBy"
                name="employeeAcknowledgedBy"
                maxLength={120}
                defaultValue={checklist.employeeAcknowledgedBy ?? ''}
              />
            </div>
            <button type="submit">Save Checklist</button>
          </form>
        </details>
      ) : null}
    </section>
  );
}
