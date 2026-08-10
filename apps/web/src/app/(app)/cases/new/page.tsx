import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can, formatInstant } from '@exit/domain';
import { listConfigItems, searchEmployees } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { createCaseAction, createManualEmployeeAction } from '../actions';

const SOURCE_LABEL: Record<string, string> = {
  SYNTHETIC: 'Synthetic fixture',
  BAMBOOHR: 'BambooHR (live)',
  MANUAL: 'Manual entry',
};

export const metadata: Metadata = { title: 'New case' };
export const dynamic = 'force-dynamic';

export default async function NewCasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  if (!can(actor, 'case.create')) redirect('/unauthorized');
  const sp = await searchParams;
  const q = sp.q ?? '';
  const selectedId = sp.employee ?? '';

  const search = q ? await searchEmployees(actor, q) : null;
  const selected = search?.results.find((e) => e.sourceId === selectedId) ?? null;
  const [departments, locations] = await Promise.all([
    listConfigItems('DEPARTMENT'),
    listConfigItems('LOCATION'),
  ]);

  return (
    <>
      <h1>Create offboarding case</h1>
      <Feedback err={sp.err} />

      <section className="panel" aria-labelledby="emp-h">
        <h2 id="emp-h" style={{ marginTop: 0 }}>
          Step 1 - find the employee
        </h2>
        <form method="get" className="actions-row" aria-label="Employee search">
          <div className="field" style={{ maxWidth: '22rem' }}>
            <label htmlFor="emp-q">
              Search the employee source (name, id, department, position or location)
            </label>
            <input id="emp-q" type="search" name="q" defaultValue={q} required />
            <p className="hint">
              Searches the local employee source cache: synthetic fixtures, the read-only BambooHR
              directory once synchronized, and manual entries. Searches are audited without
              recording their content.
            </p>
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button type="submit">Search</button>
          </div>
        </form>

        {search ? (
          search.results.length === 0 ? (
            <p>No employee matches &quot;{q}&quot;.</p>
          ) : (
            <div className="table-wrap" tabIndex={0}>
              <table className="data">
                <caption>
                  Local employee source cache, queried {formatInstant(search.retrievedAt)}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Select</th>
                    <th scope="col">Employee</th>
                    <th scope="col">Job title</th>
                    <th scope="col">Department</th>
                    <th scope="col">Location</th>
                    <th scope="col">Source</th>
                    <th scope="col">Status</th>
                    <th scope="col">Last sync</th>
                  </tr>
                </thead>
                <tbody>
                  {search.results.map((e) => (
                    <tr key={`${e.sourceSystem}-${e.sourceId}`}>
                      <td>
                        <a
                          className="button secondary"
                          href={`/cases/new?q=${encodeURIComponent(q)}&employee=${encodeURIComponent(e.sourceId)}`}
                        >
                          Select
                        </a>
                      </td>
                      <td>
                        {e.displayName} ({e.sourceId})
                      </td>
                      <td>{e.jobTitle}</td>
                      <td>{e.department}</td>
                      <td>{e.location}</td>
                      <td>
                        <span className="badge badge--neutral">
                          {SOURCE_LABEL[e.sourceSystem] ?? e.sourceSystem}
                        </span>
                      </td>
                      <td>{e.active ? 'Active' : 'Inactive'}</td>
                      <td>{e.lastSyncedAt ? formatInstant(e.lastSyncedAt) : 'not synced'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        <details className="action">
          <summary>Directory unavailable? Enter the employee manually</summary>
          <form action={createManualEmployeeAction}>
            <p className="hint">
              Manual fallback (audited): the record is stored with source MANUAL and reported by
              reconciliation until it is matched to the directory. Enter only the minimum work
              details - never personal addresses or identifiers.
            </p>
            <label htmlFor="man-name">Employee name (required)</label>
            <input id="man-name" name="displayName" required maxLength={120} />
            <label htmlFor="man-email">Work email</label>
            <input id="man-email" name="workEmail" type="email" maxLength={200} />
            <label htmlFor="man-title">Position / job title</label>
            <input id="man-title" name="jobTitle" maxLength={120} />
            <label htmlFor="man-dept">Department</label>
            <input id="man-dept" name="department" maxLength={100} />
            <label htmlFor="man-loc">Location</label>
            <input id="man-loc" name="location" maxLength={100} />
            <button type="submit">Create manual employee entry</button>
          </form>
        </details>
      </section>

      {selected ? (
        <section className="panel" aria-labelledby="intake-h">
          <h2 id="intake-h" style={{ marginTop: 0 }}>
            Step 2 - intake details for {selected.displayName} ({selected.sourceId})
          </h2>
          <p className="hint">
            Source: {SOURCE_LABEL[selected.sourceSystem] ?? selected.sourceSystem}
            {selected.lastSyncedAt
              ? `, last synchronized ${formatInstant(selected.lastSyncedAt)}`
              : ' (not synchronized)'}
            . Review the pre-populated organizational details before creating the draft - the case
            is never created automatically from the directory.
          </p>
          <p className="hint">
            Required fields are marked &quot;(required)&quot;. Times are entered and shown in
            America/Jamaica. A draft is created first; you review it before submitting for HR
            review.
          </p>
          <form action={createCaseAction} className="stack">
            <input type="hidden" name="employeeSourceId" value={selected.sourceId} />

            <div className="field">
              <label htmlFor="departureType">Departure type (required)</label>
              <select id="departureType" name="departureType" required defaultValue="">
                <option value="" disabled>
                  Choose...
                </option>
                <option value="RESIGNATION_WITH_NOTICE">Resignation with notice</option>
                <option value="IMMEDIATE_RESIGNATION">Immediate resignation</option>
                <option value="TERMINATION">Termination (restricted by default)</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="receivedAt">Receipt date and time (required)</label>
              <input id="receivedAt" name="receivedAt" type="datetime-local" required />
              <p className="hint">
                When HR first received the resignation/termination instruction.
              </p>
            </div>

            <div className="field">
              <label htmlFor="receiptSource">Source of the receipt timestamp (required)</label>
              <input
                id="receiptSource"
                name="receiptSource"
                type="text"
                required
                maxLength={200}
                placeholder="e.g. Signed letter handed to HR front desk"
              />
            </div>

            <div className="field">
              <label htmlFor="proposedLastDay">Proposed last working day</label>
              <input id="proposedLastDay" name="proposedLastDay" type="date" />
            </div>
            <div className="field">
              <label htmlFor="confirmedLastDay">Confirmed last working day</label>
              <input id="confirmedLastDay" name="confirmedLastDay" type="date" />
            </div>
            <div className="field">
              <label htmlFor="effectiveSeparationAt">
                Effective separation date and exact time (required before submission)
              </label>
              <input
                id="effectiveSeparationAt"
                name="effectiveSeparationAt"
                type="datetime-local"
              />
              <p className="hint">
                Security-critical deadlines use this exact time, not end of day (BR-CASE-006).
              </p>
            </div>

            <div className="field">
              <label htmlFor="department">Department (required)</label>
              <select
                id="department"
                name="department"
                defaultValue={selected.department ?? undefined}
                required
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.value}>
                    {d.value}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="location">Location (required)</label>
              <select
                id="location"
                name="location"
                defaultValue={selected.location ?? undefined}
                required
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.value}>
                    {l.value}
                  </option>
                ))}
              </select>
            </div>

            <fieldset>
              <legend>Measurement classification</legend>
              <div className="field">
                <label htmlFor="recordPurpose">Record purpose</label>
                <select id="recordPurpose" name="recordPurpose" defaultValue="OPERATIONAL">
                  <option value="OPERATIONAL">OPERATIONAL - a real business record</option>
                  <option value="TRAINING">TRAINING - synthetic demo record</option>
                  <option value="TEST">TEST - engineering test record</option>
                </select>
                <p className="hint">
                  Training and test records are excluded from all business reporting and never
                  trigger live behaviour.
                </p>
              </div>
              <div className="field">
                <label htmlFor="measurementCohort">Measurement cohort (operational records)</label>
                <select id="measurementCohort" name="measurementCohort" defaultValue="BASELINE">
                  <option value="BASELINE">BASELINE - current-process measurement</option>
                  <option value="PILOT">PILOT (not yet authorized)</option>
                  <option value="POST_ROLLOUT">POST_ROLLOUT (not yet authorized)</option>
                </select>
              </div>
            </fieldset>

            <fieldset>
              <legend>Reason for leaving (taxonomy pending decision DEC-031)</legend>
              <div className="field">
                <label htmlFor="reasonCaptureStatus">Reason capture status</label>
                <select id="reasonCaptureStatus" name="reasonCaptureStatus" defaultValue="PENDING">
                  <option value="PENDING">Pending - to be captured</option>
                  <option value="NOT_PROVIDED">Not provided by the employee</option>
                  <option value="NOT_APPLICABLE">Not applicable</option>
                </select>
                <p className="hint">
                  Approved reason categories are not yet available; the case does not require one to
                  proceed (IC-S1-008).
                </p>
              </div>
              <div className="field">
                <label htmlFor="reasonNotes">Reason notes (restricted HR data, optional)</label>
                <textarea id="reasonNotes" name="reasonNotes" rows={3} maxLength={2000} />
              </div>
            </fieldset>

            <fieldset>
              <legend>Notice (resignations; recorded, never calculated)</legend>
              <div className="field">
                <label htmlFor="noticeProvidedDays">Notice provided (days)</label>
                <input
                  id="noticeProvidedDays"
                  name="noticeProvidedDays"
                  type="number"
                  min={0}
                  max={365}
                />
              </div>
              <div className="field">
                <label htmlFor="noticeRequiredDays">Notice required (days, where known)</label>
                <input
                  id="noticeRequiredDays"
                  name="noticeRequiredDays"
                  type="number"
                  min={0}
                  max={365}
                />
              </div>
              <div className="field">
                <label htmlFor="noticeTreatment">Approved notice treatment</label>
                <input
                  id="noticeTreatment"
                  name="noticeTreatment"
                  type="text"
                  maxLength={300}
                  placeholder="e.g. Working full notice period"
                />
              </div>
            </fieldset>

            <div className="actions-row">
              <button type="submit">Create draft case</button>
              <Link className="button secondary" href="/cases">
                Cancel
              </Link>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
