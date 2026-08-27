import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can } from '@exit/domain';
import { searchEmployees } from '@exit/db';
import {
  DEPARTURE_TYPES,
  defaultDates,
  formatDateOnly,
  isDepartureType,
  isoDateInZone,
  isoDateTimeInZone,
  separationProfile,
  type DateField,
  type DepartureType,
} from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { createCaseAction, createManualEmployeeAction } from '../actions';
import { EmptyState } from '@/components/EmptyState';
import { FlowIcon, SearchIcon } from '@/components/icons';
import { Chip, Row, Rows } from '@/components/patterns';
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

  // Section 15/29: the separation type is chosen first and the rest of the
  // form is drawn from its profile. Reading the type from the query string
  // rather than from client state means the SERVER decides what is asked -
  // the same authority that will validate the answers (section 30).
  const departureType: DepartureType | null = isDepartureType(sp.type) ? sp.type : null;
  const profile = departureType ? separationProfile(departureType) : null;
  const contractEnd = selected?.contractEndDate ?? null;
  const defaults = departureType
    ? defaultDates(departureType, new Date(), { contractEndDate: contractEnd })
    : null;
  const noticeApplicable = departureType ? separationProfile(departureType).noticeApplicable : null;
  const noticeServed = departureType ? separationProfile(departureType).noticeServed : null;

  /** Whether a date concept is asked for at all, and whether it is required. */
  const shows = (field: DateField) =>
    !!profile && (profile.requiredDates.includes(field) || profile.optionalDates.includes(field));
  const requires = (field: DateField) => !!profile && profile.requiredDates.includes(field);

  // <input type="date"> and type="datetime-local" both want a LOCAL wall
  // clock, and every date in this platform is a Jamaican working date - so
  // they are formatted in the company's zone, never with toISOString().
  const dateInput = (d: Date | null | undefined) => (d ? isoDateInZone(d) : undefined);
  const instantInput = (d: Date | null | undefined) => (d ? isoDateTimeInZone(d) : undefined);

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
        <section className="panel" aria-labelledby="type-h">
          <h2 id="type-h" style={{ marginTop: 0 }}>
            Step 2: How Is {selected.displayName} Leaving?
          </h2>
          <p className="hint">
            This decides what the platform asks for next, and how the whole case is run. A
            termination is not a resignation without notice, and a contract expiry is not a
            resignation at all.
          </p>
          {/* Section 15: changing the type re-renders the form from the SERVER,
              the same way choosing an employee already does. The profile that
              draws the fields is the profile that validates them, so the two
              cannot drift apart (section 30). */}
          <form method="get" aria-label="Separation type">
            <input type="hidden" name="q" value={q} />
            <input type="hidden" name="employee" value={selectedId} />
            <Rows label="Ways of leaving">
              {DEPARTURE_TYPES.map((type) => {
                const option = separationProfile(type);
                const chosen = type === departureType;
                return (
                  <Row
                    key={type}
                    tone={chosen ? 'progress' : undefined}
                    mark={<FlowIcon />}
                    title={
                      <label htmlFor={`dt-${type}`} style={{ fontWeight: 'var(--weight-semi)' }}>
                        <input
                          id={`dt-${type}`}
                          type="radio"
                          name="type"
                          value={type}
                          defaultChecked={chosen}
                          style={{ width: 'auto', marginRight: '0.5rem' }}
                        />
                        {option.label}
                      </label>
                    }
                    sub={option.guidance}
                    action={chosen ? <Chip tone="progress">Selected</Chip> : null}
                  />
                );
              })}
            </Rows>
            <FormActions note="The next step changes to match.">
              <button type="submit" className="secondary">
                Continue
              </button>
            </FormActions>
          </form>
        </section>
      ) : null}

      {selected && profile && departureType && defaults ? (
        <section className="panel" aria-labelledby="intake-h">
          <h2 id="intake-h" style={{ marginTop: 0 }}>
            Step 3: {profile.label} - Details for {selected.displayName}
          </h2>
          {/* Directive 6.2 (S): SOURCE DATA is confirmed, never re-typed. */}
          <div className="well" style={{ marginBottom: 'var(--space-4)' }}>
            <h3 style={{ marginTop: 0, fontSize: 'var(--text-base)' }}>
              From the Employee Directory
            </h3>
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
              {contractEnd ? (
                <>
                  <dt>Contract ends</dt>
                  <dd>{formatDateOnly(contractEnd)}</dd>
                </>
              ) : null}
            </dl>
          </div>

          <form action={createCaseAction} className="stack">
            <input type="hidden" name="employeeSourceId" value={selected.sourceId} />
            <input type="hidden" name="departureType" value={departureType} />

            <FormSection
              step={1}
              title={noticeApplicable ? 'Notice' : 'The separation'}
              note={profile.noticeArrangement ?? undefined}
            >
              <Field
                id="receivedAt"
                label={`${profile.receivedDateLabel} (date and time)`}
                required
                hint={
                  noticeApplicable
                    ? 'When the employee told HR they were leaving.'
                    : 'When this separation was recorded by HR.'
                }
              >
                <input
                  id="receivedAt"
                  name="receivedAt"
                  type="datetime-local"
                  required
                  defaultValue={instantInput(defaults.receivedAt)}
                />
              </Field>

              {/* Section 14: the type already answers whether a notice period
                  is served, so nothing here asks HR to say it again. */}
              {noticeApplicable ? (
                <p className="hint" role="note">
                  <strong>Notice arrangement:</strong>{' '}
                  {noticeServed
                    ? (profile.noticeArrangement ?? 'Notice period served.')
                    : 'No notice period is being served - derived from the separation type.'}
                </p>
              ) : null}

              {/* One-click provenance for the dispute-sensitive receipt fact
                  (owner request, 2026-08-17): pick the channel; detail only
                  when it adds evidence. These two fields must remain adjacent
                  siblings - the reveal rule is an adjacent-sibling selector. */}
              <Field id="receiptSourceKind" label="How It Was Received">
                <select
                  id="receiptSourceKind"
                  name="receiptSourceKind"
                  defaultValue={noticeApplicable ? 'Signed letter' : 'Internal HR instruction'}
                >
                  <option value="Signed letter">Signed letter</option>
                  <option value="Email">Email</option>
                  <option value="Verbal (in person)">Verbal (in person)</option>
                  <option value="Internal HR instruction">Internal HR instruction</option>
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
              note="These dates drive every deadline on the case - access removal, asset return and payroll notification."
            >
              {shows('contractEndDate') ? (
                <Field
                  id="contractEndDate"
                  label="Contract End Date"
                  required={requires('contractEndDate')}
                  optional={!requires('contractEndDate')}
                  hint={
                    contractEnd
                      ? 'Taken from the employee record. Change it only if the record is wrong.'
                      : 'The employee record holds no contract end date, so it has to be entered.'
                  }
                >
                  <input
                    id="contractEndDate"
                    name="contractEndDate"
                    type="date"
                    required={requires('contractEndDate')}
                    defaultValue={dateInput(defaults.contractEndDate)}
                  />
                </Field>
              ) : null}

              {shows('confirmedLastDay') ? (
                <Field
                  id="confirmedLastDay"
                  label="Last Working Day"
                  required={requires('confirmedLastDay')}
                  optional={!requires('confirmedLastDay')}
                  hint="The final day the employee is expected to perform work."
                >
                  <input
                    id="confirmedLastDay"
                    name="confirmedLastDay"
                    type="date"
                    required={requires('confirmedLastDay')}
                    defaultValue={dateInput(defaults.confirmedLastDay)}
                  />
                </Field>
              ) : null}

              {shows('effectiveSeparationAt') ? (
                <Field
                  id="effectiveSeparationAt"
                  label={
                    profile.initiator === 'EMPLOYER'
                      ? 'Effective Date (and Exact Time)'
                      : 'Employment Ends (Date and Exact Time)'
                  }
                  required={requires('effectiveSeparationAt')}
                  optional={!requires('effectiveSeparationAt')}
                  hint="Access removal is timed to this exact moment, not to end of day."
                >
                  <input
                    id="effectiveSeparationAt"
                    name="effectiveSeparationAt"
                    type="datetime-local"
                    required={requires('effectiveSeparationAt')}
                    defaultValue={instantInput(defaults.effectiveSeparationAt)}
                  />
                </Field>
              ) : null}

              <p className="hint" role="note">
                Every date here can be backdated. A departure that already happened is recorded as
                it happened; the platform keeps the date it was entered separately.
              </p>
            </FormSection>

            {profile.requiresDetail || profile.authorizerExpected ? (
              <FormSection
                step={3}
                // "About this other" reads as a typo; every other label works.
                title={
                  profile.type === 'OTHER'
                    ? 'About this separation'
                    : `About this ${profile.label.toLowerCase()}`
                }
              >
                {profile.requiresDetail ? (
                  <>
                    <Field
                      id="separationTypeDetail"
                      label="What kind of separation is this?"
                      required
                      hint={'The platform cannot interpret "Other" - say what happened.'}
                    >
                      <input
                        id="separationTypeDetail"
                        name="separationTypeDetail"
                        type="text"
                        required
                        maxLength={300}
                      />
                    </Field>
                    <Field
                      id="noticeApplicableOverride"
                      label="Does employee notice apply?"
                      required
                      hint="Every other separation type answers this itself. This one cannot be inferred."
                    >
                      <select
                        id="noticeApplicableOverride"
                        name="noticeApplicableOverride"
                        required
                        defaultValue=""
                      >
                        <option value="" disabled>
                          Choose...
                        </option>
                        <option value="true">Yes - the employee gave notice</option>
                        <option value="false">No</option>
                      </select>
                    </Field>
                  </>
                ) : null}
                {profile.authorizerExpected ? (
                  <Field
                    id="authorizedByName"
                    label="Authorized or requested by"
                    optional
                    hint="Recorded on the case. Leave blank for a historical record where this is no longer known."
                  >
                    <input
                      id="authorizedByName"
                      name="authorizedByName"
                      type="text"
                      maxLength={160}
                    />
                  </Field>
                ) : null}
              </FormSection>
            ) : null}

            <FormSection
              step={profile.requiresDetail || profile.authorizerExpected ? 4 : 3}
              title="Reason for Leaving"
            >
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

            {/* An unusual date combination is questioned, not blocked: a
                historical case is legitimate and has to be recordable
                (section 25). The reason is audited with the dates. */}
            <details className="action">
              <summary>These dates are unusual but correct</summary>
              <Field
                id="dateOverrideReason"
                label="Why are these dates correct?"
                hint="Kept in the audit trail beside the dates it explains."
              >
                <textarea
                  id="dateOverrideReason"
                  name="dateOverrideReason"
                  rows={2}
                  maxLength={500}
                />
              </Field>
            </details>

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
