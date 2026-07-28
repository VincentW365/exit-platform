# User Stories and Acceptance Criteria

The acceptance criteria below are product-level and testable. Implementation directives may decompose them into smaller engineering tasks, but may not weaken them.

## US-001 — HR Officer: Create a draft offboarding case from an employee lookup

**As a** HR Officer
**I want to** create a draft offboarding case from an employee lookup
**So that** the process is captured promptly and consistently.

**Acceptance criteria**

1. Only HR roles can access case creation.
2. Employee source results show source and retrieval time.
3. Required receipt and departure fields are validated.
4. Saving creates a unique case number and audit event.
5. No workflow or external communication is started while the case is DRAFT.

## US-002 — HR Officer: Upload a resignation letter safely

**As a** HR Officer
**I want to** upload a resignation letter safely
**So that** the source document is attached to the case.

**Acceptance criteria**

1. Only approved file types/sizes are accepted.
2. The file is quarantined until validation/scanning succeeds.
3. The original filename is displayed safely but is not used as the storage path.
4. Upload, rejection, viewing, and download are audited.

## US-003 — HR Manager: Review and approve a case

**As a** HR Manager
**I want to** review and approve a case
**So that** the correct workflow starts only after authoritative review.

**Acceptance criteria**

1. The review screen shows key employee fields, source, dates, departure type, confidentiality, and missing information.
2. Approval is blocked if required fields are invalid.
3. Approval records actor, timestamp, decision, and employee snapshot.
4. Workflow instantiation is idempotent.

## US-004 — HR Officer: Identify an overlapping case

**As a** HR Officer
**I want to** identify an overlapping case
**So that** duplicates are prevented without losing legitimate events.

**Acceptance criteria**

1. The system warns when the same employee has an overlapping non-voided case.
2. The user can open the existing case.
3. Proceeding requires an authorized reason.
4. The warning and outcome are audited.

## US-005 — HR Manager: Void an erroneous case

**As a** HR Manager
**I want to** void an erroneous case
**So that** incorrect records do not distort operations or reports.

**Acceptance criteria**

1. Only authorized HR Managers can void.
2. A reason is mandatory.
3. Pending tasks and unsent notifications are cancelled safely.
4. History remains visible and the case is excluded from normal operational metrics but reported as voided.

## US-006 — HR Manager: Reopen a completed case

**As a** HR Manager
**I want to** reopen a completed case
**So that** a late issue can be resolved without rewriting history.

**Acceptance criteria**

1. A reason and target state are required.
2. The prior completion remains in history.
3. Affected tasks or exceptions are explicitly created/reactivated.
4. The action is audited and visible in the timeline.

## US-007 — HR Officer: Change a confirmed separation date

**As a** HR Officer
**I want to** change a confirmed separation date
**So that** dependent work is rescheduled transparently.

**Acceptance criteria**

1. The system previews affected tasks, documents, and notifications.
2. The previous date and due dates remain in history.
3. The user confirms the change with reason.
4. Already submitted communications are not silently recalled or altered.

## US-008 — HR Manager: Place a case on hold

**As a** HR Manager
**I want to** place a case on hold
**So that** approved delays are visible and measured correctly.

**Acceptance criteria**

1. A reason and expected review date are required.
2. The UI shows which SLA clocks pause.
3. Scheduled actions are handled according to policy.
4. Resume creates an audit event and recalculates eligible deadlines.

## US-009 — HR Officer: See my next required action

**As a** HR Officer
**I want to** see my next required action
**So that** I can manage cases efficiently.

**Acceptance criteria**

1. Dashboard cards link to filtered actionable lists.
2. Each case shows owner, status, next task, due date, blocker, and confidentiality.
3. Restricted cases are not disclosed to unauthorized users.
4. Filters can be saved in the user's session/preferences.

## US-010 — HR Manager: See process exceptions

**As a** HR Manager
**I want to** see process exceptions
**So that** I can intervene before controls fail.

**Acceptance criteria**

1. The exception feed includes overdue, blocked, failed, bounced, missing-data, and closure-integrity issues.
2. Each item has owner, age, severity, and next action.
3. Acknowledgement does not close the underlying issue.
4. Resolution is linked to evidence and audit history.

## US-011 — HR Officer: Generate a resignation acknowledgement from a controlled template

**As a** HR Officer
**I want to** generate a resignation acknowledgement from a controlled template
**So that** the letter is accurate and consistent.

**Acceptance criteria**

1. The case is eligible for the selected document type.
2. Required placeholders are validated.
3. Preview shows populated values and sources.
4. The output records template version and data snapshot.
5. Generation alone does not issue the letter.

## US-012 — HR Manager: Approve and issue a controlled letter

**As a** HR Manager
**I want to** approve and issue a controlled letter
**So that** the organization has evidence of authorized communication.

**Acceptance criteria**

1. The approver can compare source data and preview.
2. Approval requires an authenticated attestation.
3. Issued PDF bytes and checksum are stored.
4. Issue timestamps support SLA reporting.
5. A correction creates a superseding version.

## US-013 — HR Officer: Correct an issued document

**As a** HR Officer
**I want to** correct an issued document
**So that** the record remains accurate without hiding the original.

**Acceptance criteria**

1. The original remains immutable.
2. A correction reason is mandatory.
3. The replacement references the superseded version.
4. The correction is counted in document accuracy reporting.

## US-014 — HR template owner: Publish a new document template version

**As a** HR template owner
**I want to** publish a new document template version
**So that** changes are governed.

**Acceptance criteria**

1. Draft and active versions are distinct.
2. Placeholder/schema validation passes.
3. A maker-checker approval is required.
4. Existing cases remain pinned to their original version unless explicitly migrated.

## US-015 — IT responder: Receive an exact-time access-removal task

**As a** IT responder
**I want to** receive an exact-time access-removal task
**So that** I can revoke access at the correct time.

**Acceptance criteria**

1. The task shows employee/work identifiers, systems, location, and effective time only.
2. Immediate departures are clearly marked urgent.
3. The task does not reveal exit feedback, pay, or unnecessary reasons.
4. Completion records systems disabled, actor, timestamp, and evidence.

## US-016 — IT responder: Block an access task with a reason

**As a** IT responder
**I want to** block an access task with a reason
**So that** HR can resolve missing information before the deadline.

**Acceptance criteria**

1. A controlled blocker category and explanation are required.
2. An accountable resolver and expected resolution are recorded.
3. HR is notified/escalated according to the rule.
4. Blocking does not hide the due time or overdue status.

## US-017 — Finance responder: Complete final-pay preparation tasks

**As a** Finance responder
**I want to** complete final-pay preparation tasks
**So that** finance work is coordinated without exposing unrelated HR data.

**Acceptance criteria**

1. Only approved dates and necessary finance fields are visible.
2. The application does not calculate or alter final pay unless a separately approved integration exists.
3. Asset exceptions do not automatically create deductions.
4. Completion/evidence is audited.

## US-018 — Line manager: Complete a handover plan

**As a** Line manager
**I want to** complete a handover plan
**So that** business continuity risks are captured.

**Acceptance criteria**

1. The plan supports duties, open work, owners, document locations, training, and risks.
2. Passwords and secret values are prohibited.
3. Unassigned or blocked items are escalated.
4. Manager attestation is required or an authorized waiver is recorded.

## US-019 — HR Officer: Track employee-issued assets

**As a** HR Officer
**I want to** track employee-issued assets
**So that** every item receives a documented outcome.

**Acceptance criteria**

1. Case items are created from issued assets and workflow defaults.
2. Each item has an owner and expected return date.
3. Final disposition, receiver, condition, and evidence are recorded.
4. Case completion is blocked until all required items have final dispositions.

## US-020 — HR Manager: Approve an asset waiver

**As a** HR Manager
**I want to** approve an asset waiver
**So that** unrecoverable items are resolved under authority.

**Acceptance criteria**

1. Only configured roles may approve.
2. The reason, asset, authority, and evidence are stored.
3. The waiver does not automatically alter payroll.
4. The item remains included in documentation reporting and excluded/identified in physical recovery calculations as defined.

## US-021 — Departing employee: Complete a short survey from a personal device

**As a** Departing employee
**I want to** complete a short survey from a personal device
**So that** I can provide feedback after departure without an internal account.

**Acceptance criteria**

1. The link uses a valid unexpired one-time token.
2. No internal case data is shown.
3. The form is mobile and keyboard accessible.
4. A privacy/confidentiality notice appears before submission.
5. The user can review answers before final submission.

## US-022 — HR Officer: Send or suppress a survey invitation

**As a** HR Officer
**I want to** send or suppress a survey invitation
**So that** the correct eligible employees are contacted.

**Acceptance criteria**

1. Eligibility and verified contact are required.
2. Default timing is day 3 with day 7 reminder.
3. Suppression requires a reason and cancels reminders.
4. No live send occurs in development/test.

## US-023 — HR Officer: Record a verbal exit debrief

**As a** HR Officer
**I want to** record a verbal exit debrief
**So that** non-digital feedback is represented consistently.

**Acceptance criteria**

1. The response channel and interviewer are recorded.
2. Only approved structured questions and restricted notes are stored.
3. The record follows the same confidentiality rules as online responses.
4. It is included in KPI-009 according to the metric definition.

## US-024 — HR Manager: View aggregate exit trends

**As a** HR Manager
**I want to** view aggregate exit trends
**So that** I can identify themes without exposing individuals.

**Acceptance criteria**

1. Reports show eligibility, delivery, response rate, channels, and categories.
2. Small cohorts are suppressed/combined.
3. No drill-through to identifiable free text is available to managers.
4. Filters that would create a small cohort are also protected.

## US-025 — HR Officer: Approve a notification before send

**As a** HR Officer
**I want to** approve a notification before send
**So that** recipients and content are correct.

**Acceptance criteria**

1. The preview shows resolved To/CC/BCC, template version, fields, attachments, and scheduled time.
2. Invalid/missing addresses block approval.
3. The approver can reject with reason.
4. Approval is separate from provider submission.

## US-026 — Background worker: Dispatch an approved notification exactly once

**As a** Background worker
**I want to** dispatch an approved notification exactly once
**So that** automation is reliable.

**Acceptance criteria**

1. A persisted outbox record exists.
2. An idempotency key prevents duplicates.
3. Transient failures retry with bounded backoff.
4. The provider response and attempts are recorded.
5. A 202 response is shown as SUBMITTED, not DELIVERED.

## US-027 — HR Officer: Record a manual fallback notification

**As a** HR Officer
**I want to** record a manual fallback notification
**So that** the case remains complete when automation is unavailable.

**Acceptance criteria**

1. Method, recipient, time, sender, reason, and evidence are required.
2. The original failed/suppressed automated record remains visible.
3. The fallback satisfies timeliness only according to the metric definition.
4. The action is audited.

## US-028 — HR Manager: See notification failures and bounces

**As a** HR Manager
**I want to** see notification failures and bounces
**So that** I can ensure required parties are actually contacted.

**Acceptance criteria**

1. Failures are severity-ranked and assigned.
2. Provider acceptance, bounce, and manual confirmation are distinct.
3. Retries and next action are visible.
4. Resolution does not delete attempt history.

## US-029 — HR Manager: Compare baseline, pilot, and post-rollout performance

**As a** HR Manager
**I want to** compare baseline, pilot, and post-rollout performance
**So that** improvement claims are valid.

**Acceptance criteria**

1. Cohorts are separate by default.
2. The report shows numerator, denominator, exclusions, and data-as-of time.
3. Metrics use the approved dictionary.
4. Cases cannot silently change cohort after completion.

## US-030 — Auditor: Review a completed case

**As a** Auditor
**I want to** review a completed case
**So that** control compliance can be independently verified.

**Acceptance criteria**

1. The auditor can see status history, task evidence, approvals, notifications, asset dispositions, and audit events within scope.
2. Sensitive survey free text and restricted termination details are masked unless separately authorized.
3. The auditor cannot modify records.
4. Exports are redacted and audited.

## US-031 — Privacy Officer: Review access to restricted records

**As a** Privacy Officer
**I want to** review access to restricted records
**So that** unusual access can be investigated.

**Acceptance criteria**

1. The report includes actor, object, action, timestamp, result, and correlation ID.
2. Views/downloads/exports of restricted content are included.
3. Filtering does not expose the content itself.
4. Review outcomes can be recorded outside immutable audit events.

## US-032 — Privacy Officer: Place a legal hold

**As a** Privacy Officer
**I want to** place a legal hold
**So that** eligible records are not deleted.

**Acceptance criteria**

1. The hold identifies subject/scope, authority, reason, effective date, and reviewer.
2. Retention jobs skip held records and report the skip.
3. Release is separately authorized and audited.
4. The hold does not grant broader content access.

## US-033 — System administrator: Monitor platform health without reading hr data

**As a** System administrator
**I want to** monitor platform health without reading HR data
**So that** I can support availability securely.

**Acceptance criteria**

1. Health views show queues, jobs, integrations, storage, and errors using technical identifiers.
2. Employee names, survey answers, letters, and email bodies are absent.
3. Break-glass content access is a separate approved workflow.
4. All configuration changes are audited.

## US-034 — Administrator: Configure jamaica holidays

**As a** Administrator
**I want to** configure Jamaica holidays
**So that** business-day SLAs are calculated consistently.

**Acceptance criteria**

1. Holidays have effective dates and descriptions.
2. Changes are versioned/audited.
3. Existing stored due dates do not silently change.
4. Calendar tests cover weekends and configured holidays.

## US-035 — Product owner: Enable automation by cohort/environment

**As a** Product owner
**I want to** enable automation by cohort/environment
**So that** baseline and test environments remain controlled.

**Acceptance criteria**

1. Feature flags are environment-scoped.
2. Baseline defaults disable improvement automations.
3. Production cannot use the development role switcher.
4. Flag changes are audited and visible in release evidence.

## US-036 — BambooHR integration: Synchronize employee fields safely

**As a** BambooHR integration
**I want to** synchronize employee fields safely
**So that** case data is accurate and traceable.

**Acceptance criteria**

1. Only approved fields are requested.
2. Source ID and retrieval time are stored.
3. Permissions/errors are surfaced.
4. Webhook/API processing is idempotent and signed where applicable.
5. Manual fallback is available without overwriting source history.

## US-037 — HR Officer: Continue a case when bamboohr is unavailable

**As a** HR Officer
**I want to** continue a case when BambooHR is unavailable
**So that** urgent work is not blocked.

**Acceptance criteria**

1. The UI clearly marks manual/stale data.
2. Required manual values and reason are captured.
3. A reconciliation task is created.
4. Later sync does not silently overwrite approved snapshot fields.

## US-038 — Product owner: Activate a workflow version

**As a** Product owner
**I want to** activate a workflow version
**So that** new rules are introduced safely.

**Acceptance criteria**

1. The draft validates tasks, dependencies, due rules, roles, and templates.
2. Approval is required.
3. Effective date and version are recorded.
4. Existing cases remain unchanged unless migrated through a controlled process.

## US-039 — HR Manager: Complete a case

**As a** HR Manager
**I want to** complete a case
**So that** all required outcomes are present.

**Acceptance criteria**

1. Closure integrity check passes.
2. All mandatory tasks are completed or validly waived.
3. Every asset has a final disposition.
4. Required documents/notifications and approvals are present.
5. Completion actor and time are audited.

## US-040 — Support owner: Restore the service from backup

**As a** Support owner
**I want to** restore the service from backup
**So that** business records and evidence can be recovered.

**Acceptance criteria**

1. Database and object-store consistency is verified.
2. RPO/RTO results are recorded.
3. No live external notifications are emitted during restore testing.
4. The exercise produces a remediation list and sign-off.
