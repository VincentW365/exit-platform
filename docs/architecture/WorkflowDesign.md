# Workflow Design

## 1. Workflow design rules

- Workflow definitions are versioned and pin to a case.
- The three initial departure types remain distinct.
- Due rules are configuration, not scattered constants.
- Security-critical access tasks use exact timestamps.
- Business-day rules use the approved Jamaica calendar.
- Conditional tasks are created only when applicability is true.
- Mandatory tasks cannot be skipped; valid waivers require authority.
- Date changes show an impact preview and append schedule history.
- Workflow automation can be disabled by feature flags for BASELINE cases.
- The matrices below are provisional and require HR/IT/Finance validation before activation.

## 2. Resignation with notice — proposed version `RESIGN_NOTICE_V1`

| Code | Task | Owner | Due rule | Dependencies | Mandatory | Visibility | Required evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RN-001 | Validate case and employee snapshot | HR_OFFICER | Within 1 business day of receipt | Case submitted | Yes | HR only | Validated source fields; confirmed dates; classification |
| RN-002 | Approve resignation case | HR_MANAGER | Within 1 business day of receipt | RN-001 | Yes | HR only | Approval attestation |
| RN-003 | Generate acknowledgement/acceptance letter | HR_OFFICER | Immediately after approval | RN-002 | Yes | HR only | Validated rendered draft |
| RN-004 | Approve and issue letter | HR_MANAGER | No later than 2 business days from receipt | RN-003 | Yes | HR only / employee document | Issued PDF and approval |
| RN-005 | Complete digital Employee Action Form | HR_OFFICER | Configurable; before Finance completion | RN-002 | Yes | HR/Finance minimum view | Approved form fields and existing sign-off hierarchy |
| RN-006 | Create/confirm asset checklist | HR_OFFICER | Within 1 business day of approval | RN-002 | Yes | HR + relevant asset owners | Issued/default assets reviewed |
| RN-007 | Prepare handover plan | LINE_MANAGER | By configurable offset before last working day | RN-002 | Conditional | HR + assigned manager | Handover items, owners, risks |
| RN-008 | Prepare IT access-removal plan | IT_RESPONDER | Before effective separation time | RN-002 | Yes | IT minimum view | Systems/assets confirmed |
| RN-009 | Revoke access | IT_RESPONDER | At or before effective separation time | RN-008 | Yes | IT minimum view | Systems disabled, timestamp, evidence |
| RN-010 | Prepare final-pay/Finance clearance | FINANCE_RESPONDER | By configured payroll deadline | RN-002,RN-005 | Yes | Finance minimum view | Finance task attestation; no calculation in app |
| RN-011 | Determine benefits/provider applicability | HR_OFFICER | Within 1 business day of approval | RN-002 | Yes | HR only | Sagicor/NCB applicability evidence |
| RN-012 | Approve and dispatch applicable provider notices | HR_MANAGER | Within applicable SLA | RN-011 | Conditional | HR/external minimum data | Approved notification and submission evidence |
| RN-013 | Schedule exit-feedback route | HR_OFFICER | Before or at departure | RN-002 | Conditional | HR only | Eligibility, verified contact, route |
| RN-014 | Collect/resolve assets | HR_OFFICER | By last working day or approved follow-up | RN-006 | Yes | HR + assigned owners | Final disposition per item |
| RN-015 | Complete handover | LINE_MANAGER | By last working day | RN-007 | Conditional | HR + assigned manager | Manager attestation/residual risks |
| RN-016 | Update/confirm BambooHR separation status | HR_OFFICER | By approved post-departure SLA | RN-002 | Yes | HR only | Manual/integration evidence |
| RN-017 | Run clearance review | HR_OFFICER | After effective time and mandatory work terminal | RN-004,RN-009,RN-010,RN-012,RN-014,RN-015,RN-016 | Yes | HR only | Closure integrity report |
| RN-018 | Approve case completion | HR_MANAGER | Within configured review SLA | RN-017 | Yes | HR only | Completion attestation |

### Key timing behaviour

- Case capture target: within one business day of receipt.
- Letter issue target: within two business days of receipt.
- IT preparation may happen early, but revocation completes at or before `effective_separation_at`.
- Handover and asset work can run in parallel.
- Survey eligibility/contact is prepared before departure; the post-departure survey schedule uses the effective date.
- Clearance cannot complete before access, Finance, required provider notices and asset dispositions are resolved.

## 3. Immediate resignation — proposed version `IMMEDIATE_RESIGNATION_V1`

| Code | Task | Owner | Due rule | Dependencies | Mandatory | Visibility | Required evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IR-001 | Urgent case validation | HR_OFFICER | Immediately; target within 1 hour of awareness | Case submitted | Yes | HR only | Identity, effective time, classification |
| IR-002 | Urgent HR approval | HR_MANAGER | Immediately after validation | IR-001 | Yes | HR only | Approval attestation |
| IR-003 | Create urgent IT revocation task | System/HR | Immediately on approval | IR-002 | Yes | IT minimum view | Exact effective deadline |
| IR-004 | Revoke access | IT_RESPONDER | Immediately or by approved effective time | IR-003 | Yes | IT minimum view | Systems disabled, timestamp, evidence |
| IR-005 | Generate immediate-resignation acknowledgement | HR_OFFICER | Same business day where possible | IR-002 | Yes | HR only | Validated draft |
| IR-006 | Approve and issue acknowledgement | HR_MANAGER | No later than 2 business days from receipt | IR-005 | Yes | HR only / employee document | Issued PDF and approval |
| IR-007 | Complete digital Employee Action Form | HR_OFFICER | Before Finance completion | IR-002 | Yes | HR/Finance minimum view | Existing sign-off hierarchy |
| IR-008 | Locate and confirm issued assets | HR_OFFICER | Immediately after approval | IR-002 | Yes | HR + asset owners | Issued/default assets and current location |
| IR-009 | Manager reconstructs critical handover | LINE_MANAGER | Within 1 business day | IR-002 | Conditional | HR + manager | Open work, owners, risks; no employee required |
| IR-010 | Finance clearance preparation | FINANCE_RESPONDER | By configured payroll deadline | IR-002,IR-007 | Yes | Finance minimum view | Finance task evidence |
| IR-011 | Determine provider applicability | HR_OFFICER | Within 1 business day | IR-002 | Yes | HR only | Applicability evidence |
| IR-012 | Approve and dispatch provider notices | HR_MANAGER | Within applicable SLA | IR-011 | Conditional | HR/external minimum data | Submission evidence |
| IR-013 | Recover or disposition assets | HR_OFFICER | Follow approved recovery schedule | IR-008 | Yes | HR + assigned owners | Final disposition and exceptions |
| IR-014 | Schedule post-departure feedback | HR_OFFICER | Day 3 after effective departure | IR-002 | Conditional | HR only / employee survey | Eligibility and verified personal email |
| IR-015 | Record feedback outcome | HR_OFFICER/System | By invitation expiry/fallback deadline | IR-014 | Conditional | Restricted HR | Completed, declined, failed, expired or verbal route |
| IR-016 | Update/confirm BambooHR separation status | HR_OFFICER | By approved post-departure SLA | IR-002 | Yes | HR only | Manual/integration evidence |
| IR-017 | Run clearance review | HR_OFFICER | After mandatory work/dispositions | IR-004,IR-006,IR-010,IR-012,IR-013,IR-016 | Yes | HR only | Closure integrity report |
| IR-018 | Approve case completion | HR_MANAGER | Within configured review SLA | IR-017 | Yes | HR only | Completion attestation |

### Key timing behaviour

- HR must capture the exact awareness/effective time.
- Access revocation is urgent and must not wait for letter issue or the general notification SLA.
- Manager handover is a reconstruction/fallback task and does not depend on employee participation.
- Asset recovery may extend beyond the departure, but every item needs a final documented disposition/exception.
- Survey is scheduled post-departure only when eligible and contact is verified.

## 4. Termination — proposed version `TERMINATION_V1`

| Code | Task | Owner | Due rule | Dependencies | Mandatory | Visibility | Required evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TM-001 | Create restricted termination preparation case | HR_MANAGER | Per approved management instruction | Management instruction | Yes | Restricted HR | Classification and explicit participants |
| TM-002 | Validate authority, employee and effective time | HR_MANAGER | Before release of downstream tasks | TM-001 | Yes | Restricted HR | Approval basis reference; no legal calculation |
| TM-003 | Approve termination action | Configured authorized approver | Before effective event | TM-002 | Yes | Restricted HR | Authenticated approval |
| TM-004 | Prepare termination-specific document | HR_OFFICER/HR_MANAGER | Before effective event or approved issue time | TM-003 | Yes | Restricted HR | Approved template and preview |
| TM-005 | Approve/issue termination document | Configured authorized approver | Per approved policy | TM-004 | Yes | Restricted HR / employee document | Issued document and approval |
| TM-006 | Create coordinated IT revocation task | System | At approved release point | TM-003 | Yes | IT minimum view | Exact effective deadline |
| TM-007 | Revoke access | IT_RESPONDER | At or before exact effective time | TM-006 | Yes | IT minimum view | Systems disabled, timestamp, evidence |
| TM-008 | Release manager handover/continuity task | HR_MANAGER | At approved need-to-know point | TM-003 | Conditional | Assigned manager only | Critical duties and owner reconstruction |
| TM-009 | Create/confirm asset recovery plan | HR_OFFICER | At approved release point | TM-003 | Yes | HR + assigned owners | Items/location/collection plan |
| TM-010 | Complete digital Employee Action Form | HR_OFFICER | Before Finance completion | TM-003 | Yes | Restricted HR/Finance minimum view | Existing sign-off hierarchy |
| TM-011 | Finance clearance preparation | FINANCE_RESPONDER | By configured payroll deadline | TM-003,TM-010 | Yes | Finance minimum view | Finance evidence |
| TM-012 | Determine provider applicability | HR_OFFICER | At/after approved effective event | TM-003 | Yes | Restricted HR | Applicability evidence |
| TM-013 | Approve and dispatch provider notices | HR_MANAGER | Within applicable SLA | TM-012 | Conditional | HR/external minimum data | Submission evidence |
| TM-014 | Recover or disposition assets | HR_OFFICER | Per approved recovery plan | TM-009 | Yes | HR + assigned owners | Final dispositions/exceptions |
| TM-015 | Determine survey eligibility | HR_MANAGER | After effective event | TM-003 | Yes | Restricted HR | Policy rule and decision |
| TM-016 | Schedule/record feedback route | HR_OFFICER | Only if eligible | TM-015 | Conditional | Restricted HR | Invitation or interview outcome |
| TM-017 | Update/confirm BambooHR separation status | HR_OFFICER | By approved post-event SLA | TM-003 | Yes | Restricted HR | Manual/integration evidence |
| TM-018 | Run restricted clearance review | HR_MANAGER | After mandatory work/dispositions | TM-005,TM-007,TM-011,TM-013,TM-014,TM-017 | Yes | Restricted HR | Closure integrity report |
| TM-019 | Approve case completion | HR_MANAGER | Within configured review SLA | TM-018 | Yes | Restricted HR | Completion attestation |

### Key confidentiality behaviour

- The case is RESTRICTED from creation.
- Only explicit HR participants can discover preparation work.
- IT, Finance and manager tasks are released at approved points and show minimum fields.
- Termination-specific documents are required; resignation wording is prohibited.
- Survey is not automatically sent. HR Manager records eligibility according to approved policy.
- Provider notices and departmental tasks do not expose termination rationale.

## 5. Due-rule types

The engine should support typed rules such as:

```text
ABSOLUTE_TIMESTAMP
ON_CASE_APPROVAL
BUSINESS_DAYS_AFTER_RECEIPT
BUSINESS_DAYS_AFTER_APPROVAL
CALENDAR_DAYS_AFTER_EFFECTIVE
BUSINESS_DAYS_BEFORE_LAST_WORKING_DATE
AT_EFFECTIVE_SEPARATION_TIME
MANUAL_WITH_VALIDATION
```

A due-rule result stores:

- rule type/version;
- input timestamps;
- calendar version;
- original due timestamp;
- current due timestamp;
- calculation event/correlation.

## 6. Applicability conditions

Examples:

```text
requires_sagicor_notice =
  case.sagicor_enrolment == ACTIVE
  AND workflow.provider_notice_enabled == true

requires_ncb_notice =
  case.ncb_group_life_enrolment == ACTIVE
  AND workflow.provider_notice_enabled == true

requires_handover =
  workflow.handover_enabled == true
  AND NOT approved_not_applicable

requires_survey =
  case.survey_eligibility == ELIGIBLE
  AND verified_personal_contact_exists
  AND NOT suppressed

requires_it_revocation =
  assigned_system_count > 0 OR workflow.force_it_confirmation == true
```

Conditions must be testable, versioned and explainable in the UI.

## 7. Date-change algorithm

Before applying a changed confirmed last day/effective time:

1. load all open tasks, documents and unsent notifications whose schedules depend on the old date;
2. calculate proposed new dates using the pinned workflow and calendar;
3. identify already completed/submitted effects that cannot be changed;
4. show old/new schedule and consequence;
5. require authorized confirmation and reason;
6. append date/schedule history;
7. update only eligible open work;
8. cancel/reschedule reminders idempotently;
9. create exceptions for impossible/late outcomes.

## 8. Hold and pause policy

This remains an OPEN decision in part. The implementation must support the concept without assuming all clocks pause.

Recommended initial policy:

- case status can be ON_HOLD;
- access-revocation security deadlines never pause automatically;
- statutory/external deadlines do not pause unless policy explicitly allows;
- document/case operational SLAs may pause only for approved missing-information categories;
- reports show both elapsed time and approved paused time;
- due-date changes remain audited.

## 9. Closure integrity check

The deterministic check returns PASS/FAIL plus unmet conditions:

- case in valid state and effective event reached where required;
- mandatory tasks completed or validly waived;
- no blocking open exception;
- required document(s) issued;
- required notifications at least submitted or manual fallback recorded;
- IT access task completed by/with exposure exception;
- Finance task complete;
- every asset has a final disposition;
- required handover complete/waived;
- source-system update task complete;
- survey outcome recorded where required, without making survey completion a universal closure blocker unless policy says so;
- required approvals/evidence present.

The check result is stored with the completion decision.

## 10. Directive 6.3 delta (2026-08-16): workflow v2 - the HR-validated model

Product direction: HR operational feedback (DEC-044..DEC-050). The three
departure-type workflows are re-issued as v2 definitions; v1 is superseded
for NEW cases and running instances stay pinned to v1, finish task-based
and are never reinterpreted (dual-mode clearance).

### What v2 removes from the task matrices above

| Removed v1 tasks | Replaced by |
| --- | --- |
| IT tasks (RN/IR/TM access review + revocation, `IT_RESPONDER` owner) | Derived IT access-removal EMAIL ACTION with the exact effective time, secure confirmation link, HR-recorded evidence alternative, CRITICAL escalation if unconfirmed at the effective instant, and the v2 clearance IT-evidence gate (delivery is never completion). |
| Finance tasks (`FIN_ACKNOWLEDGE`, workpaper init/done, `FINANCE_RESPONDER` owner) | Derived Finance offboarding EMAIL ACTION (acknowledgement link); the Action Form's Finance checklist records evidence of work performed OUTSIDE the application. |
| `MGR_ACTION_FORM_APPROVE` / `HRM_ACTION_FORM_FINAL` | Officer completion of the Action Form; optional configuration-gated HR-Manager review (DEC-050). The manager keeps ONLY the handover tasks. |
| `HR_SAGICOR_APPLICABILITY`, `HR_NCB_APPLICABILITY`, `HR_EXTERNAL_NOTIFICATIONS` | One-time benefits confirmation (YES/NO/UNKNOWN) on the case; the rules engine derives, prepares and (per send control level) dispatches provider notifications. |
| `HR_SURVEY_INVITE` (manual scheduling) | Automatic survey-invitation scheduling by the worker under the standard automation gates; the survey never blocks clearance. |
| Generic asset-checklist creation from the 11-type catalogue | Asset recovery actions derived strictly from the employee's issued assets; ADD UNLISTED ASSET is the explicit exception path. |

### What v2 keeps

- HR tasks: case validation, date confirmation, resignation document,
  HRIS/BambooHR update, clearance review - with their v1 due rules and the
  approved Jamaica calendar.
- The manager handover tasks (plan → reassign → complete) unchanged.
- Versioning discipline: definitions are versioned, pinned per case, and
  activation supersedes atomically; conditional tasks are created only when
  applicable; mandatory tasks cannot be skipped without a valid waiver.
- Restricted-termination confidentiality: v2 email actions honour it with
  confidential timing (IT released no earlier than one hour before the
  effective instant, Finance at the effective instant) and the
  stricter-of send-control override for RESTRICTED cases.

### Derived actions instead of scattered conditionals

The applicability examples in section 6 are implemented as the
deterministic derived-action rules (`packages/domain/src/derivedActions.ts`,
rules version `hr-validated-workflow-v2`): every rule records its key, its
exact source fields and its result on the `CaseRequiredAction` row, and the
UI explains "derived from ..." per item. Overrides are authorized, reasoned
and audited, and win over re-derivation until removed. Material fact
changes (dates, departure type, benefits confirmation) re-run derivation
idempotently - rows update in place, nothing duplicates, superseded items
are marked.

## Separation types and their workflows (DEC-058, 2026-08-26)

The platform recognises seven ways of leaving, and each has its own workflow
definition. None inherits another's.

| Separation | Workflow | Shape |
| --- | --- | --- |
| Resignation - with notice | `RESIGNATION_WITH_NOTICE` | The full planned spine, including the resignation-acceptance document. |
| Resignation - immediate | `IMMEDIATE_RESIGNATION` | Urgent same-day HR review and exact-time access removal. |
| Termination | `TERMINATION` | Restricted preparation, HR Manager authorization, confidential notification timing. |
| Retirement | `RETIREMENT` | The planned spine with retirement wording; no resignation-acceptance document. |
| End of contract | `CONTRACT_EXPIRY` | The planned spine, opening from the contract end date rather than a resignation. |
| Redundancy | `REDUNDANCY` | The planned spine plus HR Manager authorization; restricted by default. |
| Other | `OTHER` | The neutral spine. HR has described the separation on the case. |

### What decides the shape

Nothing in a workflow definition re-derives what a separation type means. The
authoritative profile is `packages/domain/src/separation.ts`: it says whether
notice applies, which dates are required, which default to today, how urgent
the case is, whether it is restricted, and how the type is worded in a
document or a message. The intake form draws its fields from that profile,
the server validates against the same profile, and workflow generation reads
it for urgency - so the form cannot offer something the server will reject,
and a new separation type cannot quietly behave like a resignation.

### What the workflows deliberately do NOT contain

The four types added in 2026-08 carry no document-preparation task for an
employee-facing letter. Retirement, redundancy, contract expiry and "other"
each need HR's own approved wording, and the platform does not author HR
documents (CLAUDE.md rule 4). Where HR approves such a template, its
preparation task is added to that workflow as a normal versioned change.

### Timing

Due dates are measured from the separation effective instant or the final
working day, never from the date notice arrived. In practice that means a
resignation with a month of notice keeps its access for the month, an
immediate resignation's deadlines are all today because its final working day
is today, and a termination scheduled for next month does not fire its
actions on the day the case was raised.
