import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can } from '@exit/domain';
import { searchEmployees } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { createCaseAction, createManualEmployeeAction } from '../actions';
import { EmptyState } from '@/components/EmptyState';
import { SearchIcon } from '@/components/icons';
import { Field, FieldRow, FormActions, FormSection } from '@/components/forms';

export const metadata: Metadata = { title: 'New Case' };
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

  return (
    <>
      <h1>Create Offboarding Case</h1>
      <Feedback err={sp.err} />

      <section className="panel" aria-labelledby="emp-h">
        <h2 id="emp-h" style={{ marginTop: 0 }}>
          Step 1: Find the Employee
        </h2>
        <form method="get" aria-label="Employee search">
          <div className="field">
            <label htmlFor="emp-q">Employee Name or Number</label>
            <div className="search-bar">
              <div className="search-bar__box">
                <svg
                  className="search-bar__icon"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="8.5" cy="8.5" r="5.5" />
                  <path d="m13 13 4.5 4.5" />
                </svg>
                <input
                  id="emp-q"
                  type="search"
                  name="q"
                  defaultValue={q}
                  required
                  placeholder="Name, employee number, department or location"
                  autoComplete="off"
                />
              </div>
              <button type="submit">Search</button>
            </div>
          </div>
        </form>

        {search && search.results.length === 0 ? (
          <EmptyState
            icon={<SearchIcon />}
            title="No matching employee"
            body={`Nothing in the company directory matches "${q}". Try a different spelling, an employee number, or a department.`}
          />
        ) : null}

        {search && search.results.length > 0
          ? (() => {
              const resultsTable = (
                <div className="table-wrap" tabIndex={0}>
                  <table className="data">
                    <caption className={selected ? 'sr-only' : undefined}>
                      {`${search.results.length} ${search.results.length === 1 ? 'match' : 'matches'} for "${q}"`}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Select</th>
                        <th scope="col">Employee</th>
                        <th scope="col">Job title</th>
                        <th scope="col">Department</th>
                        <th scope="col">Location</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {search.results.map((e) => (
                        <tr key={`${e.sourceSystem}-${e.sourceId}`}>
                          <td>
                            {e.sourceId === selected?.sourceId ? (
                              <span className="badge badge--success">Selected</span>
                            ) : (
                              <a
                                className="button secondary"
                                href={`/cases/new?q=${encodeURIComponent(q)}&employee=${encodeURIComponent(e.sourceId)}`}
                              >
                                Select
                              </a>
                            )}
                          </td>
                          <td>
                            {e.displayName}{' '}
                            <span className="hint">
                              {e.employeeNumber ? `#${e.employeeNumber}` : e.sourceId}
                            </span>
                          </td>
                          <td>{e.jobTitle}</td>
                          <td>{e.department}</td>
                          <td>{e.location}</td>
                          <td>{e.active ? 'Active' : 'Inactive'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
              if (!selected) return resultsTable;
              // An employee is chosen: show a compact confirmation and tuck
              // the full result list away behind an expander.
              return (
                <>
                  <div className="selected-employee">
                    <svg
                      className="selected-employee__check"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m4 10.5 4 4 8-9" />
                    </svg>
                    <span>
                      <strong>{selected.displayName}</strong>{' '}
                      {selected.employeeNumber ? `#${selected.employeeNumber}` : selected.sourceId}
                      {selected.jobTitle ? ` · ${selected.jobTitle}` : ''}
                      {selected.department ? ` · ${selected.department}` : ''}
                    </span>
                    <a className="button secondary" href={`/cases/new?q=${encodeURIComponent(q)}`}>
                      Change employee
                    </a>
                  </div>
                  {search.results.length > 1 ? (
                    <details className="action">
                      <summary>
                        Show all {search.results.length} matches for &quot;{q}&quot;
                      </summary>
                      {resultsTable}
                    </details>
                  ) : null}
                </>
              );
            })()
          : null}

        <details className="action">
          <summary>Directory unavailable? Enter the employee manually</summary>
          <form action={createManualEmployeeAction} className="stack">
            <p className="hint">
              Enter only the minimum work details - never personal addresses or identifiers. The
              entry is flagged for review until it is matched to the directory.
            </p>
            <Field id="man-name" label="Employee Name" required>
              <input id="man-name" name="displayName" required maxLength={120} />
            </Field>
            <FieldRow>
              <Field id="man-email" label="Work Email" optional>
                <input id="man-email" name="workEmail" type="email" maxLength={200} />
              </Field>
              <Field id="man-title" label="Job Title" optional>
                <input id="man-title" name="jobTitle" maxLength={120} />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field id="man-dept" label="Department" optional>
                <input id="man-dept" name="department" maxLength={100} />
              </Field>
              <Field id="man-loc" label="Location" optional>
                <input id="man-loc" name="location" maxLength={100} />
              </Field>
            </FieldRow>
            <FormActions note="The entry is reviewable and is replaced the moment the directory catches up.">
              <button type="submit">Create manual employee entry</button>
            </FormActions>
          </form>
        </details>
      </section>

      {selected ? (
        <section className="panel" aria-labelledby="intake-h">
          <h2 id="intake-h" style={{ marginTop: 0 }}>
            Step 2: Separation Details for {selected.displayName}
          </h2>
          {/* Directive 6.2 (S): SOURCE DATA is confirmed, never re-typed. */}
          <div className="panel" style={{ background: 'var(--muted)', boxShadow: 'none' }}>
            <h3 style={{ marginTop: 0 }}>From the Employee Directory</h3>
            <dl className="kv">
              <dt>Employee</dt>
              <dd>{selected.displayName}</dd>
              <dt>Employee #</dt>
              <dd>{selected.employeeNumber ?? 'Not recorded in BambooHR'}</dd>
              <dt>Position</dt>
              <dd>{selected.jobTitle ?? '-'}</dd>
              <dt>Department / Location</dt>
              <dd>
                {selected.department ?? '-'} / {selected.location ?? '-'}
              </dd>
              <dt>Direct Manager</dt>
              <dd>{selected.managerName ?? 'None recorded - HR will assign an alternate'}</dd>
              <dt>Status</dt>
              <dd>{selected.active ? 'Active' : 'Inactive'}</dd>
            </dl>
          </div>
          {/* Section 18: the intake is three decisions, not seven fields in a
              row - what kind of departure, when it takes effect, and what the
              employee said about it. The conditional fields stay adjacent
              siblings so the :has() rules that reveal them still apply. */}
          <form action={createCaseAction} className="stack">
            <input type="hidden" name="employeeSourceId" value={selected.sourceId} />

            <FormSection step={1} title="The departure" note="What arrived, and how it reached HR.">
              <Field id="departureType" label="Departure Type" required>
                <select id="departureType" name="departureType" required defaultValue="">
                  <option value="" disabled>
                    Choose...
                  </option>
                  <option value="RESIGNATION_WITH_NOTICE">Resignation with notice</option>
                  <option value="IMMEDIATE_RESIGNATION">Immediate resignation</option>
                  <option value="TERMINATION">Termination</option>
                </select>
              </Field>

              <Field
                id="receivedAt"
                label="Date and Time Received"
                required
                hint="When HR received it - not when the employee wrote it."
              >
                <input id="receivedAt" name="receivedAt" type="datetime-local" required />
              </Field>

              {/* One-click provenance for the dispute-sensitive receipt fact
                  (owner request, 2026-08-17): pick the channel; detail only
                  when it adds evidence. These two fields must remain adjacent
                  siblings - the reveal rule is an adjacent-sibling selector. */}
              <Field id="receiptSourceKind" label="How It Was Received">
                <select
                  id="receiptSourceKind"
                  name="receiptSourceKind"
                  defaultValue="Signed letter"
                >
                  <option value="Signed letter">Signed letter</option>
                  <option value="Email">Email</option>
                  <option value="Verbal (in person)">Verbal (in person)</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              <Field id="receiptSourceDetail" label="Describe How It Was Received" required>
                <input
                  id="receiptSourceDetail"
                  name="receiptSourceDetail"
                  type="text"
                  maxLength={150}
                  placeholder="e.g. note left with the store manager"
                />
              </Field>
            </FormSection>

            <FormSection
              step={2}
              title="When employment ends"
              note="The final working date drives every due date on the case."
            >
              {/* One working-date field (owner request, 2026-08-18): the
                  proposed/confirmed pair collapsed into the date that actually
                  drives the process. */}
              <Field id="confirmedLastDay" label="Final Working Date" optional>
                <input id="confirmedLastDay" name="confirmedLastDay" type="date" />
              </Field>
              {/* Resignations with notice end at close of business on the final
                  working date, so the platform sets the instant itself (owner
                  request, 2026-08-18). Immediate resignations and terminations
                  keep the field: there the exact moment is a decision, and it
                  is what access removal is timed to. */}
              <div className="field field--effective-time">
                <label htmlFor="effectiveSeparationAt">
                  <span>Employment Ends (Date and Exact Time)</span>
                </label>
                <input
                  id="effectiveSeparationAt"
                  name="effectiveSeparationAt"
                  type="datetime-local"
                />
                <p className="hint">
                  Access removal is timed to this exact moment, not to end of day.
                </p>
              </div>
            </FormSection>

            {/* Department and location come straight from the selected
                employee's directory record (owner request, 2026-08-17) - no
                re-selection of facts the platform already knows. BambooHR is
                the source of truth; correct it there and re-sync if wrong. */}

            {/* Final-product surface (owner request, 2026-08-17): the
                measurement-classification choice is gone - every case is a
                real operational record in the active rollout; the server
                action fixes the values. */}

            <FormSection step={3} title="Reason for Leaving">
              {/* "Provided" was missing entirely, so a reason that HAD been
                  given could not be recorded (owner, 2026-08-18). The notes
                  box now appears only for that answer. */}
              <Field id="reasonCaptureStatus" label="Did the Employee Give a Reason?">
                <select id="reasonCaptureStatus" name="reasonCaptureStatus" defaultValue="PENDING">
                  <option value="PENDING">Not provided yet</option>
                  <option value="PROVIDED">Yes</option>
                  <option value="NOT_PROVIDED">No, they preferred not to say</option>
                  <option value="NOT_APPLICABLE">Not applicable</option>
                </select>
              </Field>
              <div className="field field--reason-notes">
                <label htmlFor="reasonNotes">
                  <span>What Did They Say?</span>
                </label>
                <textarea id="reasonNotes" name="reasonNotes" rows={3} maxLength={2000} />
                <p className="hint">Restricted HR information - visible only to HR on this case.</p>
              </div>
            </FormSection>

            {/* Notice tracking left the product surface entirely (owner,
                2026-08-17). The days-given figure still derives silently
                onto the record from receipt -> confirmed last working day,
                for the file only - never displayed, never calculated from. */}
            <div className="actions-row form-footer">
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
