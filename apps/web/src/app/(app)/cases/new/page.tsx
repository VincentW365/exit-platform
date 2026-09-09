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
import { ArrowKeyList, AutoFocus } from '@/components/keyboard';
import { Field, FieldRow, FormActions } from '@/components/forms';
import { StepAccordion, type StepSpec } from '@/components/StepAccordion';

export const metadata: Metadata = { title: 'New Case' };
export const dynamic = 'force-dynamic';

/** The one form every step after the separation type contributes to. */
const FORM_ID = 'new-case';

const REASON_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Reason not provided yet',
  PROVIDED: 'Reason given',
  NOT_PROVIDED: 'Preferred not to say',
  NOT_APPLICABLE: 'Not applicable',
};

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
  // The search was submitted with nothing in it: `q` is present in the
  // address but blank. Distinct from "no search yet", which has no `q`.
  const emptySearch = 'q' in sp && q.trim() === '';

  const search = q ? await searchEmployees(actor, q) : null;
  const selected = search?.results.find((e) => e.sourceId === selectedId) ?? null;

  // Section 15/29 of the separation directive: the type is chosen first and
  // the rest of the form is drawn from its profile. Reading it from the query
  // string rather than from client state means the SERVER decides what is
  // asked - the same authority that will validate the answers.
  const departureType: DepartureType | null = isDepartureType(sp.type) ? sp.type : null;
  const profile = departureType ? separationProfile(departureType) : null;
  const contractEnd = selected?.contractEndDate ?? null;
  const defaults = departureType
    ? defaultDates(departureType, new Date(), { contractEndDate: contractEnd })
    : null;
  const noticeApplicable = profile?.noticeApplicable ?? null;
  const noticeServed = profile?.noticeServed ?? null;

  /** Whether a date concept is asked for at all, and whether it is required. */
  const shows = (field: DateField) =>
    !!profile && (profile.requiredDates.includes(field) || profile.optionalDates.includes(field));
  const requires = (field: DateField) => !!profile && profile.requiredDates.includes(field);

  // <input type="date"> and type="datetime-local" both want a LOCAL wall
  // clock, and every date in this platform is a Jamaican working date - so
  // they are formatted in the company's zone, never with toISOString().
  const dateInput = (d: Date | null | undefined) => (d ? isoDateInZone(d) : undefined);
  const instantInput = (d: Date | null | undefined) => (d ? isoDateTimeInZone(d) : undefined);

  // --- step 1: who is leaving ------------------------------------------------

  const resultsTable =
    search && search.results.length > 0 ? (
      // Keyboard directive (2026-09-09, section 5): after a search the cursor
      // lands on the first match, ↑ ↓ move between matches, Enter selects,
      // Escape goes back to the search box. The links stay ordinary links -
      // Tab reaches them too - so nothing is taken from anyone.
      <ArrowKeyList escapeTo="#emp-q" focusFirst={!selected}>
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
                        data-list-item
                        aria-label={`Select ${e.displayName}`}
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
        <p className="hint" style={{ marginTop: 'var(--space-2)' }}>
          <kbd>↑</kbd> <kbd>↓</kbd> move between matches · <kbd>Enter</kbd> selects · <kbd>Esc</kbd>{' '}
          returns to the search box
        </p>
      </ArrowKeyList>
    ) : null;

  const employeeContent = (
    <>
      {/* This step keeps its own GET form: choosing a different employee is a
          navigation, which is why the accordion is not itself a form. */}
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
                placeholder="Name, employee number, department or location"
                autoComplete="off"
                aria-describedby={emptySearch ? 'emp-q-error' : undefined}
                aria-invalid={emptySearch || undefined}
              />
            </div>
            <button type="submit">Search</button>
          </div>
          {/* An empty search is answered by the search, in the search's own
              words - not by the browser's generic bubble, and never by the
              validation of some other form on the page (keyboard directive,
              2026-09-09, section 4). */}
          {emptySearch ? (
            <p id="emp-q-error" className="field__error" role="alert">
              Enter an employee name, employee number, department, job title or location to search.
            </p>
          ) : null}
        </div>
      </form>
      {/* The cursor starts where the reader is about to type (section 14) -
          only while no employee is chosen, so a returning reader is not
          pulled back to step 1, and only while there are no matches to
          choose from: once there are, the first match takes the cursor
          instead (the results list asks for it), and two requests for focus
          on one page would be a race the search box wins by being first. */}
      {!selected && !(search && search.results.length > 0) ? <AutoFocus selector="#emp-q" /> : null}

      {search && search.results.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title="No matching employee"
          body={`Nothing in the company directory matches "${q}". Try a different spelling, an employee number, or a department.`}
        />
      ) : null}

      {selected ? (
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

          {/* Directive 6.2 (S): SOURCE DATA is confirmed, never re-typed. */}
          <div className="well" style={{ marginTop: 'var(--space-4)' }}>
            <h3 style={{ marginTop: 0, fontSize: 'var(--text-base)' }}>
              From the Employee Directory
            </h3>
            <dl className="kv">
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
          {search && search.results.length > 1 ? (
            <details className="action">
              <summary>
                Show all {search.results.length} matches for &quot;{q}&quot;
              </summary>
              {resultsTable}
            </details>
          ) : null}
        </>
      ) : (
        resultsTable
      )}

      <details className="action">
        <summary>Directory unavailable? Enter the employee manually</summary>
        <form action={createManualEmployeeAction} className="stack">
          <p className="hint">
            Enter only the minimum work details - never personal addresses or identifiers. The entry
            is flagged for review until it is matched to the directory.
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
    </>
  );

  // --- step 2: how they are leaving -----------------------------------------

  const separationContent = selected ? (
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
      <FormActions note="Changing this redraws the rest of the case, so anything already typed below is cleared.">
        <button type="submit" className="secondary">
          Use this separation type
        </button>
      </FormActions>
    </form>
  ) : null;

  // --- step 3: dates ---------------------------------------------------------

  const datesContent =
    profile && defaults ? (
      <div className="stack">
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
            form={FORM_ID}
            name="receivedAt"
            type="datetime-local"
            required
            defaultValue={instantInput(defaults.receivedAt)}
          />
        </Field>

        {/* The type already answers whether a notice period is served, so
            nothing here asks HR to say it again. */}
        {noticeApplicable ? (
          <p className="hint" role="note">
            <strong>Notice arrangement:</strong>{' '}
            {noticeServed
              ? (profile.noticeArrangement ?? 'Notice period served.')
              : 'No notice period is being served - derived from the separation type.'}
          </p>
        ) : null}

        {/* One-click provenance for the dispute-sensitive receipt fact: pick
            the channel; detail only when it adds evidence. These two fields
            must stay adjacent siblings - the reveal rule is an adjacent
            sibling selector. */}
        <Field id="receiptSourceKind" label="How It Was Received">
          <select
            id="receiptSourceKind"
            form={FORM_ID}
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
            form={FORM_ID}
            name="receiptSourceDetail"
            type="text"
            maxLength={150}
            placeholder="e.g. note left with the store manager"
          />
        </Field>

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
              form={FORM_ID}
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
              form={FORM_ID}
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
              form={FORM_ID}
              name="effectiveSeparationAt"
              type="datetime-local"
              required={requires('effectiveSeparationAt')}
              defaultValue={instantInput(defaults.effectiveSeparationAt)}
            />
          </Field>
        ) : null}

        <p className="hint" role="note">
          Every date here can be backdated. A departure that already happened is recorded as it
          happened; the platform keeps the date it was entered separately.
        </p>

        {/* An unusual date combination is questioned, not blocked: a
            historical case is legitimate and has to be recordable. */}
        <details className="action">
          <summary>These dates are unusual but correct</summary>
          <Field
            id="dateOverrideReason"
            label="Why are these dates correct?"
            hint="Kept in the audit trail beside the dates it explains."
          >
            <textarea
              id="dateOverrideReason"
              form={FORM_ID}
              name="dateOverrideReason"
              rows={2}
              maxLength={500}
            />
          </Field>
        </details>
      </div>
    ) : null;

  // --- step 4: what kind of separation (only where it cannot be inferred) ----

  const needsAbout = !!profile && (profile.requiresDetail || profile.authorizerExpected);
  const aboutContent = profile ? (
    <div className="stack">
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
              form={FORM_ID}
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
              form={FORM_ID}
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
            form={FORM_ID}
            name="authorizedByName"
            type="text"
            maxLength={160}
          />
        </Field>
      ) : null}
    </div>
  ) : null;

  // --- step 5: reason --------------------------------------------------------

  const reasonContent = (
    <div className="stack">
      <Field id="reasonCaptureStatus" label="Did the Employee Give a Reason?">
        <select
          id="reasonCaptureStatus"
          form={FORM_ID}
          name="reasonCaptureStatus"
          defaultValue="PENDING"
        >
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
        <textarea id="reasonNotes" form={FORM_ID} name="reasonNotes" rows={3} maxLength={2000} />
        <p className="hint">Restricted HR information - visible only to HR on this case.</p>
      </div>
    </div>
  );

  // --- the steps -------------------------------------------------------------

  const steps: StepSpec[] = [
    {
      id: 'employee',
      title: 'Who is leaving',
      note: 'Find the employee in the company directory.',
      settledByServer: !!selected,
      staticSummary: selected ? (
        <>
          <strong>{selected.displayName}</strong>
          {selected.employeeNumber ? ` · #${selected.employeeNumber}` : ''}
          {selected.jobTitle ? ` · ${selected.jobTitle}` : ''}
          {selected.department ? ` · ${selected.department}` : ''}
        </>
      ) : null,
      content: employeeContent,
    },
  ];

  if (selected) {
    steps.push({
      id: 'separation',
      title: 'How they are leaving',
      note: 'This decides what the platform asks for next, and how the whole case is run.',
      settledByServer: !!profile,
      staticSummary: profile ? (
        <>
          <strong>{profile.label}</strong> · {profile.guidance}
        </>
      ) : null,
      content: separationContent,
    });
  }

  if (selected && profile && departureType && defaults) {
    const dateSummary: StepSpec['summaryFields'] = [
      { field: 'receivedAt', label: profile.receivedDateLabel, as: 'datetime' as const },
      ...(shows('contractEndDate')
        ? [{ field: 'contractEndDate', label: 'Contract ends', as: 'date' as const }]
        : []),
      ...(shows('confirmedLastDay')
        ? [{ field: 'confirmedLastDay', label: 'Last working day', as: 'date' as const }]
        : []),
      ...(shows('effectiveSeparationAt')
        ? [
            {
              field: 'effectiveSeparationAt',
              label: profile.initiator === 'EMPLOYER' ? 'Effective' : 'Employment ends',
              as: 'datetime' as const,
            },
          ]
        : []),
    ];

    steps.push({
      id: 'dates',
      title: noticeApplicable ? 'Notice and dates' : 'Dates',
      note: 'These dates drive every deadline on the case - access removal, asset return and payroll notification.',
      requiredFields: [
        'receivedAt',
        ...(requires('confirmedLastDay') ? ['confirmedLastDay'] : []),
        ...(requires('effectiveSeparationAt') ? ['effectiveSeparationAt'] : []),
        ...(requires('contractEndDate') ? ['contractEndDate'] : []),
      ],
      summaryFields: dateSummary,
      content: datesContent,
    });

    if (needsAbout) {
      steps.push({
        id: 'about',
        title:
          profile.type === 'OTHER'
            ? 'About this separation'
            : `About this ${profile.label.toLowerCase()}`,
        note: profile.requiresDetail
          ? 'The platform will not guess what this separation is, or whether notice applies.'
          : 'Who authorized it, where that is known.',
        requiredFields: profile.requiresDetail
          ? ['separationTypeDetail', 'noticeApplicableOverride']
          : [],
        summaryFields: [
          { field: 'separationTypeDetail' },
          { field: 'authorizedByName', label: 'Authorized by' },
          {
            field: 'noticeApplicableOverride',
            label: 'Employee notice',
            display: { true: 'Applies', false: 'Does not apply' },
          },
        ],
        content: aboutContent,
      });
    }

    steps.push({
      id: 'reason',
      title: 'Reason for leaving',
      note: 'Recorded where the employee gave one. Restricted to HR on this case.',
      requiredFields: ['reasonCaptureStatus'],
      summaryFields: [{ field: 'reasonCaptureStatus', display: REASON_STATUS_LABEL }],
      content: reasonContent,
    });

    steps.push({
      id: 'review',
      title: 'Review and create',
      note: 'What will be recorded, and what the platform will do next.',
      finalStep: true,
      reviewGroups: [
        {
          stepId: 'employee',
          heading: 'Employee',
          staticLines: [
            `${selected.displayName}${selected.employeeNumber ? ` · #${selected.employeeNumber}` : ''}`,
            `${selected.jobTitle ?? '-'} · ${selected.department ?? '-'}`,
          ],
        },
        { stepId: 'separation', heading: 'Separation type', staticLines: [profile.label] },
        { stepId: 'dates', heading: 'Dates' },
        ...(needsAbout ? [{ stepId: 'about', heading: 'About this separation' }] : []),
        { stepId: 'reason', heading: 'Reason' },
      ],
      content: (
        <>
          <p className="hint" role="note">
            Creating the case records a DRAFT. Nothing is sent and no task is created until it is
            approved and activated - the workflow, documents and notifications for a{' '}
            {profile.label.toLowerCase()} are prepared then.
          </p>
          <div className="form-actions">
            <button type="submit" form={FORM_ID} data-final-submit="true">
              Create draft case
            </button>
            <Link className="button secondary" href="/cases">
              Cancel
            </Link>
          </div>
        </>
      ),
    });
  }

  return (
    <>
      <h1 className="page-title">Create Offboarding Case</h1>
      <Feedback err={sp.err} />

      {/* The form lives beside the accordion, not around it: the first steps
          carry their own GET forms and a form cannot contain another. Every
          field in the later steps joins this one by its `form` attribute. */}
      {selected && departureType ? (
        <form id={FORM_ID} action={createCaseAction} className="sr-only">
          <input type="hidden" name="employeeSourceId" value={selected.sourceId} />
          <input type="hidden" name="departureType" value={departureType} />
        </form>
      ) : null}

      <StepAccordion steps={steps} formId={FORM_ID} />
    </>
  );
}
