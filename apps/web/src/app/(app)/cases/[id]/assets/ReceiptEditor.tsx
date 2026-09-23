'use client';

import { useState } from 'react';
import { RETURN_ITEM_STATUSES, RETURN_ITEM_STATUS_LABEL } from '@exit/domain';

/**
 * Editing the Exit Checklist for Return Items (DEC-069 section 14).
 *
 * The company's ten rows stay; HR marks what does not apply, records
 * quantity, condition, the date returned and any asset number, adds rows for
 * property the printed form does not list, removes the rows it added, notes
 * what is outstanding and writes its own notes. The whole sheet posts as one
 * save, which the platform keeps as a version.
 */
export interface EditableRow {
  id: string | null;
  itemKey: string | null;
  label: string;
  status: string;
  remarks: string;
  quantity: string;
  condition: string;
  returnedAt: string;
  assetReference: string;
  custom: boolean;
}

export function ReceiptEditor({
  caseId,
  rows,
  hrNotes,
  receivedByName,
  receivedAt,
  action,
}: {
  caseId: string;
  rows: EditableRow[];
  hrNotes: string;
  receivedByName: string;
  receivedAt: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [list, setList] = useState<EditableRow[]>(rows);

  const update = (index: number, patch: Partial<EditableRow>) =>
    setList((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <form action={action} className="stack receipt-editor">
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="rowCount" value={list.length} />
      <table className="form-table receipt-editor__table">
        <caption className="sr-only">Edit the return items</caption>
        <thead>
          <tr>
            <th scope="col" aria-label="Number" className="form-table__num" />
            <th scope="col">Item</th>
            <th scope="col">Check</th>
            <th scope="col">Qty</th>
            <th scope="col">Condition</th>
            <th scope="col">Returned</th>
            <th scope="col">Asset ref.</th>
            <th scope="col">Remarks</th>
            <th scope="col" aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {list.map((r, i) => (
            <tr key={r.id ?? `new-${i}`} data-custom={r.custom ? 'yes' : 'no'}>
              <td className="form-table__num">{i + 1}.</td>
              <th scope="row">
                <input type="hidden" name={`row.${i}.id`} value={r.id ?? ''} />
                <input type="hidden" name={`row.${i}.itemKey`} value={r.itemKey ?? ''} />
                {r.custom ? (
                  <input
                    type="text"
                    name={`row.${i}.label`}
                    aria-label={`Item name for row ${i + 1}`}
                    value={r.label}
                    maxLength={120}
                    required
                    onChange={(e) => update(i, { label: e.target.value })}
                  />
                ) : (
                  <>
                    <input type="hidden" name={`row.${i}.label`} value={r.label} />
                    {r.label}
                  </>
                )}
              </th>
              <td>
                <select
                  name={`row.${i}.status`}
                  aria-label={`Status for ${r.label || `row ${i + 1}`}`}
                  value={r.status}
                  onChange={(e) => update(i, { status: e.target.value })}
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
                  type="number"
                  name={`row.${i}.quantity`}
                  aria-label={`Quantity for ${r.label || `row ${i + 1}`}`}
                  value={r.quantity}
                  min={0}
                  max={9999}
                  style={{ width: '4.5rem' }}
                  onChange={(e) => update(i, { quantity: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="text"
                  name={`row.${i}.condition`}
                  aria-label={`Condition for ${r.label || `row ${i + 1}`}`}
                  value={r.condition}
                  maxLength={300}
                  onChange={(e) => update(i, { condition: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="date"
                  name={`row.${i}.returnedAt`}
                  aria-label={`Date returned for ${r.label || `row ${i + 1}`}`}
                  value={r.returnedAt}
                  onChange={(e) => update(i, { returnedAt: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="text"
                  name={`row.${i}.assetReference`}
                  aria-label={`Asset reference for ${r.label || `row ${i + 1}`}`}
                  value={r.assetReference}
                  maxLength={120}
                  onChange={(e) => update(i, { assetReference: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="text"
                  name={`row.${i}.remarks`}
                  aria-label={`Remarks for ${r.label || `row ${i + 1}`}`}
                  value={r.remarks}
                  maxLength={500}
                  onChange={(e) => update(i, { remarks: e.target.value })}
                />
              </td>
              <td>
                {r.custom ? (
                  <button
                    type="button"
                    className="secondary compact"
                    onClick={() => setList((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Remove row ${i + 1}`}
                  >
                    Remove
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions-row">
        <button
          type="button"
          className="secondary compact"
          onClick={() =>
            setList((prev) => [
              ...prev,
              {
                id: null,
                itemKey: null,
                label: '',
                status: 'OUTSTANDING',
                remarks: '',
                quantity: '',
                condition: '',
                returnedAt: '',
                assetReference: '',
                custom: true,
              },
            ])
          }
        >
          Add a row
        </button>
        <span className="meta">
          The company form&apos;s own rows are kept; mark one &ldquo;not applicable&rdquo; rather
          than removing it.
        </span>
      </div>

      <div className="sigline">
        <label className="sigline__label" htmlFor="rc-receivedByName">
          Items Received By:
        </label>
        <input
          id="rc-receivedByName"
          name="receivedByName"
          maxLength={120}
          defaultValue={receivedByName}
        />
        <label className="sigline__label" htmlFor="rc-receivedAt">
          Date:
        </label>
        <input
          id="rc-receivedAt"
          name="receivedAt"
          type="date"
          style={{ flex: '0 1 11rem' }}
          defaultValue={receivedAt}
        />
      </div>
      <label className="field">
        <span className="field__label">HR notes (printed on the receipt)</span>
        <textarea
          name="hrNotes"
          className="input"
          rows={3}
          defaultValue={hrNotes}
          maxLength={2000}
        />
      </label>
      <div className="actions-row">
        <button type="submit">Save checklist</button>
        <span className="meta">Each save is kept as a version.</span>
      </div>
    </form>
  );
}
