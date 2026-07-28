# Requirements Catalogue

**Baseline version:** 0.1
**Date:** 2026-07-28
**Total requirements:** 313

## Status and priority conventions

- `MUST`: required for the assigned release/stage unless formally changed.
- `SHOULD`: expected unless a documented trade-off is approved.
- `COULD`: optional opportunity.
- `PROVISIONAL`: recommended baseline pending named stakeholder confirmation.
- `OPEN`: implementation is blocked until the associated decision is resolved.

## Summary

| Category | Count |
| --- | --- |
| Case management | 26 |
| Workflow and tasks | 34 |
| Documents and approvals | 21 |
| Notifications | 25 |
| Assets and clearance | 19 |
| Handover | 12 |
| Exit feedback | 26 |
| Reporting | 20 |
| Security | 40 |
| Privacy | 24 |
| Integrations | 24 |
| Administration | 18 |
| Non-functional | 24 |

## Case management

| Requirement ID | Title | Requirement | Priority | Stage | Status |
| --- | --- | --- | --- | --- | --- |
| REQ-CASE-001 | Unique case number | The system shall assign every offboarding case an immutable, human-readable unique case number and internal UUID. | MUST | 1 | PROVISIONAL |
| REQ-CASE-002 | HR-led case creation | The MVP shall allow only authorized HR roles to create an offboarding case. | MUST | 1 | PROVISIONAL |
| REQ-CASE-003 | Employee selection | Case creation shall support employee lookup from the configured employee source and controlled manual entry when the source is unavailable. | MUST | 1 | PROVISIONAL |
| REQ-CASE-004 | Employee snapshot | On case approval, the system shall store an immutable employee snapshot containing the approved fields used by the workflow and documents. | MUST | 1 | PROVISIONAL |
| REQ-CASE-005 | Departure types | The case shall require one of RESIGNATION_WITH_NOTICE, IMMEDIATE_RESIGNATION, or TERMINATION; additional types require a versioned configuration change. | MUST | 1 | PROVISIONAL |
| REQ-CASE-006 | Receipt timestamp | The case shall record the date and time the resignation/termination instruction was received and the source of that timestamp. | MUST | 1 | PROVISIONAL |
| REQ-CASE-007 | Proposed and confirmed dates | The case shall distinguish proposed last working date, confirmed last working date, and effective separation date/time. | MUST | 1 | PROVISIONAL |
| REQ-CASE-008 | Exact effective time | The case shall support an exact effective separation time, not only a date. | MUST | 1 | PROVISIONAL |
| REQ-CASE-009 | Notice status | Resignation cases shall record notice provided, notice requirement where known, and approved notice treatment without calculating entitlement. | MUST | 1 | PROVISIONAL |
| REQ-CASE-010 | Case owner | Every active case shall have an accountable HR owner and may have supporting HR participants. | MUST | 1 | PROVISIONAL |
| REQ-CASE-011 | Confidentiality classification | Every case shall have a classification; termination cases default to RESTRICTED. | MUST | 1 | PROVISIONAL |
| REQ-CASE-012 | Workflow version reference | Every case shall reference the immutable workflow definition version instantiated for it. | MUST | 3 | PROVISIONAL |
| REQ-CASE-013 | Measurement cohort | Every case shall be labelled BASELINE, PILOT, or POST_ROLLOUT and that label shall be immutable after case completion except by audited correction. | MUST | 1 | PROVISIONAL |
| REQ-CASE-014 | Case state machine | Case status changes shall follow the approved state machine and server-side transition rules. | MUST | 1 | PROVISIONAL |
| REQ-CASE-015 | No ordinary hard deletion | Operational users shall not hard-delete offboarding cases; incorrect cases shall be cancelled or voided with reason. | MUST | 1 | PROVISIONAL |
| REQ-CASE-016 | Void control | Voiding a case shall require HR Manager authority, a reason, and an audit event; downstream scheduled work shall be cancelled safely. | MUST | 3 | PROVISIONAL |
| REQ-CASE-017 | Reopening control | Reopening a completed case shall require HR Manager authority, reason, target status, and an audit event. | MUST | 3 | PROVISIONAL |
| REQ-CASE-018 | Attachments | Authorized HR users shall be able to attach resignation letters and supporting documents subject to file-security controls. | MUST | 1 | PROVISIONAL |
| REQ-CASE-019 | Internal notes | The system shall support timestamped internal notes with author, visibility classification, and immutable edit history. | MUST | 1 | PROVISIONAL |
| REQ-CASE-020 | Duplicate detection | Case creation shall warn about another non-voided case for the same employee with an overlapping departure event. | SHOULD | 1 | PROVISIONAL |
| REQ-CASE-021 | Search and filtering | Authorized users shall be able to search/filter cases by case number, employee, department, location, owner, departure type, status, cohort, and date range. | MUST | 1 | PROVISIONAL |
| REQ-CASE-022 | Controlled export | Case lists and case records shall be exportable only by approved roles, with field-level redaction and an audit event. | MUST | 6 | PROVISIONAL |
| REQ-CASE-023 | Case-capture SLA evidence | The system shall preserve timestamps needed to compute case capture compliance without relying on mutable UI fields. | MUST | 1 | PROVISIONAL |
| REQ-CASE-024 | Field source display | The case UI shall display the source and last synchronized time for key employee fields. | SHOULD | 1 | PROVISIONAL |
| REQ-CASE-025 | Date-change impact preview | Before confirming a changed effective date/time, the system shall show impacted tasks, documents, and notifications. | MUST | 3 | PROVISIONAL |
| REQ-CASE-026 | Sensitive field masking | Sensitive fields such as rehire eligibility and restricted reasons shall be masked from roles without explicit permission. | MUST | 1 | PROVISIONAL |

## Workflow and tasks

| Requirement ID | Title | Requirement | Priority | Stage | Status |
| --- | --- | --- | --- | --- | --- |
| REQ-WF-001 | Versioned workflow definitions | Workflow definitions shall be versioned, activatable, deactivatable, and immutable once used by a case. | MUST | 3 | PROVISIONAL |
| REQ-WF-002 | Three initial workflows | The system shall provide distinct initial workflow definitions for resignation with notice, immediate resignation, and termination. | MUST | 3 | PROVISIONAL |
| REQ-WF-003 | Instantiation on approval | An approved case shall instantiate a workflow from the active definition version exactly once. | MUST | 3 | PROVISIONAL |
| REQ-WF-004 | Task definition metadata | Each task definition shall specify title, purpose, responsible role, required/optional status, due rule, dependencies, evidence rule, visibility, and escalation policy. | MUST | 3 | PROVISIONAL |
| REQ-WF-005 | Business-calendar due dates | Due dates expressed in business days shall use the approved America/Jamaica business calendar and configurable holidays. | MUST | 1 | PROVISIONAL |
| REQ-WF-006 | Exact-time due dates | Security-critical tasks shall support due timestamps based on the approved effective separation time. | MUST | 3 | PROVISIONAL |
| REQ-WF-007 | Task dependencies | A task may depend on one or more predecessor tasks or case conditions. | MUST | 3 | PROVISIONAL |
| REQ-WF-008 | Automatic readiness | The engine shall move a task from NOT_READY to READY only when all required dependencies and conditions are satisfied. | MUST | 3 | PROVISIONAL |
| REQ-WF-009 | Task assignment | Every actionable task shall have a responsible role and may have a named assignee or queue. | MUST | 3 | PROVISIONAL |
| REQ-WF-010 | Task reassignment | Authorized reassignment shall preserve the previous assignee, reason, timestamp, and actor. | MUST | 3 | PROVISIONAL |
| REQ-WF-011 | Task evidence | A task definition may require structured fields, attestation, document, or file evidence before completion. | MUST | 3 | PROVISIONAL |
| REQ-WF-012 | Blockers | An assignee shall be able to block a task using a controlled blocker category, explanation, expected resolution, and escalation owner. | MUST | 3 | PROVISIONAL |
| REQ-WF-013 | Waivers | Only configured roles may waive an eligible task; the waiver shall require reason, authority, and evidence where configured. | MUST | 3 | PROVISIONAL |
| REQ-WF-014 | Mandatory task protection | Mandatory tasks shall not be skipped or cancelled without an approved workflow rule, waiver, case cancellation, or void. | MUST | 3 | PROVISIONAL |
| REQ-WF-015 | Overdue calculation | The engine shall calculate overdue state from the stored due timestamp and terminal state, considering approved pause periods. | MUST | 3 | PROVISIONAL |
| REQ-WF-016 | Reminders and escalation | The engine shall create reminders and escalation events at configured thresholds without duplicating them. | MUST | 3 | PROVISIONAL |
| REQ-WF-017 | Department queues | IT, Finance, and line managers shall have minimal-data work queues for tasks assigned to their role or identity. | MUST | 3 | PROVISIONAL |
| REQ-WF-018 | Parallel branches | The engine shall support tasks that run in parallel after approval. | MUST | 3 | PROVISIONAL |
| REQ-WF-019 | Conditional tasks | Tasks such as NCB, Sagicor, survey, and handover shall be created only when applicability rules evaluate true. | MUST | 3 | PROVISIONAL |
| REQ-WF-020 | Date recalculation | Changing the confirmed last working date/effective time shall recalculate eligible open tasks using a preview-and-confirm process. | MUST | 3 | PROVISIONAL |
| REQ-WF-021 | No silent historical rewrite | Recalculation shall not overwrite prior due dates or task history; it shall append an audited schedule change. | MUST | 3 | PROVISIONAL |
| REQ-WF-022 | Notification coupling | Workflow events may create notification drafts or schedules but shall not bypass the notification approval/dispatch state machine. | MUST | 5 | PROVISIONAL |
| REQ-WF-023 | Document coupling | Workflow events may request document generation but shall not mark a document issued without required approval. | MUST | 2 | PROVISIONAL |
| REQ-WF-024 | Case hold | Authorized HR users shall be able to place a case on hold with reason and define which SLA clocks pause. | MUST | 3 | OPEN |
| REQ-WF-025 | Resume from hold | Resuming a case shall restore task schedules according to the approved pause policy and create an audit event. | MUST | 3 | OPEN |
| REQ-WF-026 | Cancellation propagation | Cancelling or voiding a case shall cancel pending tasks, document drafts, reminders, and unsent notifications while preserving history. | MUST | 3 | PROVISIONAL |
| REQ-WF-027 | Closure integrity check | Before CLEARANCE_REVIEW or COMPLETED, the system shall run a deterministic closure check and show all unmet conditions. | MUST | 3 | PROVISIONAL |
| REQ-WF-028 | Controlled manual task | HR Manager may add a case-specific manual task from an approved task type with owner, due date, visibility, and reason. | SHOULD | 3 | PROVISIONAL |
| REQ-WF-029 | Workflow migration control | Existing cases shall not move to a new workflow version automatically; migration requires an explicit approved operation and preview. | MUST | 6 | PROVISIONAL |
| REQ-WF-030 | Feature flags by cohort | Automation features shall be independently configurable so baseline cases can be measured with selected automations disabled. | MUST | 1 | PROVISIONAL |
| REQ-WF-031 | Idempotent scheduled jobs | All scheduler actions shall be safe to retry and use unique event/idempotency keys. | MUST | 3 | PROVISIONAL |
| REQ-WF-032 | Escalation visibility | Escalations shall appear in the case timeline, task queue, and exception feed with owner and required action. | MUST | 3 | PROVISIONAL |
| REQ-WF-033 | Task completion timestamps | Task completion shall record actor, completion time, source, evidence, and original/current due timestamps. | MUST | 3 | PROVISIONAL |
| REQ-WF-034 | Task templates locked per instance | Changes to a task definition shall not alter already-instantiated task requirements. | MUST | 3 | PROVISIONAL |

## Documents and approvals

| Requirement ID | Title | Requirement | Priority | Stage | Status |
| --- | --- | --- | --- | --- | --- |
| REQ-DOC-001 | Versioned document templates | Controlled document templates shall have immutable versions, activation state, owner, approval status, and effective date. | MUST | 2 | PROVISIONAL |
| REQ-DOC-002 | Template placeholder schema | Every template version shall declare required and optional placeholders, data types, source fields, formatting rules, and validation messages. | MUST | 2 | PROVISIONAL |
| REQ-DOC-003 | Pre-generation validation | The system shall block generation when required source fields are missing or inconsistent and show the fields requiring correction. | MUST | 2 | PROVISIONAL |
| REQ-DOC-004 | Employee snapshot source | Generated documents shall use the approved case snapshot and case-specific approved fields rather than live mutable source data. | MUST | 2 | PROVISIONAL |
| REQ-DOC-005 | Preview | Authorized users shall be able to preview the fully rendered document before submitting it for approval. | MUST | 2 | PROVISIONAL |
| REQ-DOC-006 | Approval state machine | Documents shall follow DRAFT/GENERATED/PENDING_APPROVAL/APPROVED/ISSUED/REJECTED/SUPERSEDED/VOIDED states as applicable. | MUST | 2 | PROVISIONAL |
| REQ-DOC-007 | Separation of duties | The system shall support a rule preventing an HR Officer from approving the same restricted document they prepared. | SHOULD | 2 | PROVISIONAL |
| REQ-DOC-008 | PDF output | Issued documents shall be stored in a stable PDF representation. | MUST | 2 | PROVISIONAL |
| REQ-DOC-009 | Editable output | Where policy requires an editable version, the system shall generate a controlled DOCX and record its checksum and template version. | SHOULD | 2 | OPEN |
| REQ-DOC-010 | Immutable issued snapshot | The exact issued bytes, content hash, template version, data snapshot, approver, and issue timestamp shall be retained. | MUST | 2 | PROVISIONAL |
| REQ-DOC-011 | Supersession | Corrections shall create a new document version linked to the superseded document; the prior version shall remain retrievable by authorized users. | MUST | 2 | PROVISIONAL |
| REQ-DOC-012 | Secure storage | Documents shall be stored outside the public web root with authorization enforced on every access. | MUST | 1 | PROVISIONAL |
| REQ-DOC-013 | Download audit | Viewing or downloading restricted documents shall create an access audit event. | MUST | 2 | PROVISIONAL |
| REQ-DOC-014 | Authenticated attestation | Approvals/signatures shall be represented by authenticated attestations unless an approved electronic-signature service is required. | MUST | 2 | PROVISIONAL |
| REQ-DOC-015 | Departure-specific documents | Termination workflows shall not use resignation-acceptance templates; each departure type shall map to approved document types. | MUST | 2 | PROVISIONAL |
| REQ-DOC-016 | No authoritative free-form AI | Generative AI shall not produce the authoritative issued document without an approved controlled template and human approval. | MUST | 2 | PROVISIONAL |
| REQ-DOC-017 | AI provenance | Any optional AI-assisted draft shall be labelled, preserve prompt/model/provider metadata permitted by policy, and require human approval. | SHOULD | Future | PROVISIONAL |
| REQ-DOC-018 | Turnaround measurement | The system shall record receipt, generation, approval, and issuance timestamps required for KPI-002. | MUST | 2 | PROVISIONAL |
| REQ-DOC-019 | Field source review | The preview screen shall show key populated fields and their sources before approval. | SHOULD | 2 | PROVISIONAL |
| REQ-DOC-020 | Template activation approval | Only an approved HR Manager or template governance role may activate a new document template version. | MUST | 2 | PROVISIONAL |
| REQ-DOC-021 | Confidential marking | Templates shall support classification markings such as PRIVATE & CONFIDENTIAL based on document type. | MUST | 2 | PROVISIONAL |

## Notifications

| Requirement ID | Title | Requirement | Priority | Stage | Status |
| --- | --- | --- | --- | --- | --- |
| REQ-NOTIFY-001 | Versioned notification templates | Notification templates shall be versioned and linked to channel, purpose, applicability, classification, and approved recipients. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-002 | Applicability rules | The system shall evaluate whether each notification is required based on departure type, enrolment, assigned systems, and approved policy rules. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-003 | Transactional outbox | All outbound notification requests shall be persisted in a transactional outbox before dispatch. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-004 | Notification state machine | Notifications shall support DRAFT, PENDING_APPROVAL, APPROVED, SCHEDULED, QUEUED, SUBMITTED, DELIVERED_IF_KNOWN, FAILED, CANCELLED, and BOUNCED states. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-005 | Recipient model | Each notification shall store To/CC/BCC recipients, recipient type, source, approval status, and final resolved address. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-006 | Minimum necessary data | Templates and payloads shall include only the fields approved for the recipient and purpose. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-007 | Approval before external send | Employee-facing, external-provider, and termination notifications shall require human approval in MVP. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-008 | Scheduled dispatch | Approved notifications shall support scheduled dispatch relative to approval or exact effective separation time. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-009 | Urgent IT notification | Immediate and termination workflows shall support urgent IT notification and task creation without waiting for the general 24-hour SLA. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-010 | Retry policy | Transient failures shall be retried with bounded exponential backoff and jitter; permanent failures shall not loop indefinitely. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-011 | Idempotency key | Each dispatch shall use an idempotency key based on case, notification type, recipient, workflow version, and effective event. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-012 | Provider adapter | The domain shall depend on an email-provider interface, not provider-specific calls in business logic. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-013 | No live development send | Development and test environments shall use a sink/sandbox provider and block real external recipients. | MUST | 1 | PROVISIONAL |
| REQ-NOTIFY-014 | Failure dashboard | Failed, stuck, bounced, or overdue notifications shall appear in an operational exception queue. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-015 | Manual fallback | Authorized HR users shall be able to record a manual fallback send with method, timestamp, recipient, evidence, and reason. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-016 | Attempt log | Every provider attempt shall store start/end time, provider reference, response category, retry number, and sanitized error. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-017 | Submitted versus delivered | The system shall not equate provider acceptance with delivery; it shall display the strongest evidence actually available. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-018 | Invalid address handling | Invalid or missing recipient addresses shall block dispatch and create an exception before sending. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-019 | Reminder notifications | Survey and task reminders shall use the same outbox, approval policy, and idempotency controls. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-020 | Cancel/reschedule | Changing case dates or applicability shall cancel or reschedule unsent notifications without deleting history. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-021 | Recipient configuration | External recipient addresses and internal distribution targets shall be managed through approved configuration, not hard-coded. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-022 | Content snapshot | The final subject, body, attachments, recipient set, and template version shall be stored for every submitted notification. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-023 | Attachment controls | Attachments shall be limited to approved document types and scanned/authorized before dispatch. | MUST | 5 | PROVISIONAL |
| REQ-NOTIFY-024 | Opt-out/suppression | Employee survey communications shall respect recorded eligibility, suppression, opt-out, and invalid-contact status. | MUST | 2 | PROVISIONAL |
| REQ-NOTIFY-025 | Mail permission minimization | If Microsoft Graph is used, the application shall use the least-privileged approved mail permission and constrain mailbox access where supported. | MUST | 5 | PROVISIONAL |

## Assets and clearance

| Requirement ID | Title | Requirement | Priority | Stage | Status |
| --- | --- | --- | --- | --- | --- |
| REQ-ASSET-001 | Asset type catalogue | Administrators shall maintain versioned asset types, ownership department, value/risk category, and evidence rules. | MUST | 4 | PROVISIONAL |
| REQ-ASSET-002 | Issued asset source | The system shall support import/look-up of employee-issued assets and controlled manual entry. | MUST | 4 | PROVISIONAL |
| REQ-ASSET-003 | Case asset generation | A case shall receive required asset items from issued-asset data and workflow defaults. | MUST | 4 | PROVISIONAL |
| REQ-ASSET-004 | Asset identifier | Technology and serialized assets shall support a unique asset tag/serial identifier. | MUST | 4 | PROVISIONAL |
| REQ-ASSET-005 | Expected return date | Each returnable asset item shall have an expected return date/time derived from the workflow or set by authorized HR. | MUST | 4 | PROVISIONAL |
| REQ-ASSET-006 | Disposition states | Each asset item shall end in RETURNED, NOT_ISSUED, LOST, DAMAGED, WAIVED, or approved UNRESOLVED disposition. | MUST | 4 | PROVISIONAL |
| REQ-ASSET-007 | Receipt evidence | Returned items shall record receiver, timestamp, condition, location, and evidence/attestation where required. | MUST | 4 | PROVISIONAL |
| REQ-ASSET-008 | Condition and remarks | The system shall support controlled condition categories and restricted remarks. | MUST | 4 | PROVISIONAL |
| REQ-ASSET-009 | Automated reminders | Open asset items shall support configurable reminders before and after the expected return date. | MUST | 4 | PROVISIONAL |
| REQ-ASSET-010 | Asset exception | Lost, damaged, waived, or unresolved items shall create or link to an exception with an accountable owner. | MUST | 4 | PROVISIONAL |
| REQ-ASSET-011 | No automatic pay action | Asset status shall never directly alter final pay, payroll data, or deductions. | MUST | 4 | PROVISIONAL |
| REQ-ASSET-012 | Documentation compliance metric | The system shall compute KPI-007 from final dispositions and required item count. | MUST | 6 | PROVISIONAL |
| REQ-ASSET-013 | Recovery metric | The system shall compute KPI-008 separately from documentation compliance. | MUST | 6 | PROVISIONAL |
| REQ-ASSET-014 | Clearance gate | Case closure shall require a final disposition for every required asset, not necessarily physical return of every item. | MUST | 4 | PROVISIONAL |
| REQ-ASSET-015 | Waiver authority | Waiver of an asset obligation shall require configured authority, reason, and evidence. | MUST | 4 | PROVISIONAL |
| REQ-ASSET-016 | High-risk escalation | Unresolved high-risk assets shall escalate to configured owners and remain visible at clearance review. | MUST | 4 | PROVISIONAL |
| REQ-ASSET-017 | Manual asset addition | Authorized users shall be able to add a case-specific asset item with reason and owner. | SHOULD | 4 | PROVISIONAL |
| REQ-ASSET-018 | Asset history | Every change of asset status, identifier, due date, receiver, or condition shall be auditable. | MUST | 4 | PROVISIONAL |
| REQ-ASSET-019 | Department visibility | IT shall see technology assets; other asset items shall be visible only to appropriate owners and HR. | MUST | 4 | PROVISIONAL |

## Handover

| Requirement ID | Title | Requirement | Priority | Stage | Status |
| --- | --- | --- | --- | --- | --- |
| REQ-HAND-001 | Configurable handover module | The handover module shall be enabled by workflow and may be marked not applicable only by an authorized role with reason. | MUST | 4 | PROVISIONAL |
| REQ-HAND-002 | Manager assignment | A handover plan shall have an accountable line manager or approved delegate. | MUST | 4 | PROVISIONAL |
| REQ-HAND-003 | Structured handover items | The plan shall support duties, open tasks, customer/vendor matters, document locations, training sessions, temporary owners, and risks. | MUST | 4 | PROVISIONAL |
| REQ-HAND-004 | Item owner | Each handover item shall identify the receiving owner or explicitly state unassigned with escalation. | MUST | 4 | PROVISIONAL |
| REQ-HAND-005 | Due dates | Handover items shall support due dates and dependencies relative to the last working date. | MUST | 4 | PROVISIONAL |
| REQ-HAND-006 | Item state | Handover items shall support NOT_STARTED, IN_PROGRESS, BLOCKED, COMPLETED, and WAIVED states. | MUST | 4 | PROVISIONAL |
| REQ-HAND-007 | Risk recording | Unresolved handover risks shall be visible at clearance review and require an owner. | MUST | 4 | PROVISIONAL |
| REQ-HAND-008 | Manager sign-off | The line manager shall attest that the handover is complete or identify approved residual risks. | MUST | 4 | PROVISIONAL |
| REQ-HAND-009 | No credentials | The UI shall explicitly prohibit storing passwords, secret keys, or authentication codes in handover text or attachments. | MUST | 4 | PROVISIONAL |
| REQ-HAND-010 | Links not secrets | The plan may reference approved document repositories or vault locations without copying restricted secrets into the case. | SHOULD | 4 | PROVISIONAL |
| REQ-HAND-011 | Visibility | Handover content shall be visible only to HR, the assigned manager/delegate, and explicitly approved participants. | MUST | 4 | PROVISIONAL |
| REQ-HAND-012 | Immediate departure fallback | Immediate resignation workflows shall support a manager-led reconstruction handover without requiring employee participation. | MUST | 4 | PROVISIONAL |

## Exit feedback

| Requirement ID | Title | Requirement | Priority | Stage | Status |
| --- | --- | --- | --- | --- | --- |
| REQ-SURVEY-001 | Versioned survey definition | Survey forms and questions shall be versioned and immutable once an invitation is issued. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-002 | Short core survey | The initial survey shall contain five to eight core questions, with optional conditional follow-ups. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-003 | Eligibility decision | Every case shall record survey eligibility, decision actor, rule result, and exclusion reason where not eligible. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-004 | Verified personal contact | The invitation shall use a verified personal email or another approved post-employment channel. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-005 | Single-purpose token | Survey access shall use a cryptographically random single-purpose token unrelated to internal identifiers. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-006 | Hashed token storage | Only a secure hash of the survey token shall be stored after issuance. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-007 | Single use | The token shall be invalidated after successful submission or manual revocation. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-008 | Expiry | The invitation shall have a configurable expiry date and show a non-disclosing expired-link message. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-009 | Initial timing | The default initial invitation shall be scheduled three days after the effective departure date. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-010 | Reminder timing | The default reminder shall be scheduled seven days after departure if no completed response and no suppression exists. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-011 | No internal case exposure | The respondent page shall not expose case status, internal notes, assets, approvals, or departmental tasks. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-012 | Mobile accessibility | The survey shall be usable on mobile devices and meet the project's accessibility standard. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-013 | Privacy notice | The survey shall present an approved concise privacy/confidentiality notice before submission. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-014 | Response channel | The system shall distinguish online survey, HR interview, manager/HR verbal debrief, declined, and no response. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-015 | Verbal debrief entry | Authorized HR users shall be able to record a structured verbal debrief with source and consent/notice status as policy requires. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-016 | Non-response reason | HR shall be able to record invalid contact, declined, policy-excluded, no response, or other approved outcome. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-017 | Restricted identifiable access | Identifiable answers and free text shall be restricted to authorized HR/privacy roles. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-018 | Manager reporting | Managers shall not receive identifiable individual responses through normal reporting. | MUST | 6 | PROVISIONAL |
| REQ-SURVEY-019 | Aggregate suppression | Segmented reports shall suppress or combine cohorts below the approved threshold. | MUST | 6 | OPEN |
| REQ-SURVEY-020 | Completion metric | The system shall compute KPI-009 using explicit eligibility and successful-delivery outcomes. | MUST | 6 | PROVISIONAL |
| REQ-SURVEY-021 | Termination applicability | Termination survey creation shall follow an approved policy rule and default to not automatically sending until that rule is approved. | MUST | 2 | OPEN |
| REQ-SURVEY-022 | Free-text caution | Free-text questions shall warn respondents not to include unnecessary third-party personal or confidential information. | SHOULD | 2 | PROVISIONAL |
| REQ-SURVEY-023 | Edit before submit | Respondents shall be able to review and edit answers before final submission. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-024 | No edit after submit by respondent | After submission, the respondent shall not edit answers through the token; correction requests shall follow a controlled HR/privacy process. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-025 | Survey analytics taxonomy | Closed questions and reason categories shall use versioned codes suitable for trend analysis. | MUST | 2 | PROVISIONAL |
| REQ-SURVEY-026 | Invitation suppression | HR shall be able to suppress an unsent invitation with reason; suppression shall cancel scheduled reminders. | MUST | 2 | PROVISIONAL |

## Reporting

| Requirement ID | Title | Requirement | Priority | Stage | Status |
| --- | --- | --- | --- | --- | --- |
| REQ-REPORT-001 | HR dashboard | The HR dashboard shall show active cases, upcoming departures, overdue work, blocked cases, pending approvals, notification failures, assets, and survey status. | MUST | 1 | PROVISIONAL |
| REQ-REPORT-002 | Role-specific dashboards | Departmental dashboards shall show only assigned tasks and minimum necessary case information. | MUST | 3 | PROVISIONAL |
| REQ-REPORT-003 | Metric dictionary enforcement | Reported KPIs shall use the formulas, inclusions, exclusions, and dates defined in MetricsDictionary.md. | MUST | 6 | PROVISIONAL |
| REQ-REPORT-004 | Active case view | The dashboard shall support quick navigation from a case summary to the next required action. | MUST | 1 | PROVISIONAL |
| REQ-REPORT-005 | Upcoming departures | HR shall see departures due in configurable 7-, 14-, and 30-day windows. | SHOULD | 1 | PROVISIONAL |
| REQ-REPORT-006 | Overdue ageing | Overdue work shall be grouped by owner, department, age band, workflow, and blocker. | MUST | 3 | PROVISIONAL |
| REQ-REPORT-007 | Document performance | Reports shall show issuance timeliness, corrections, template version, and bottleneck stage. | MUST | 6 | PROVISIONAL |
| REQ-REPORT-008 | Notification performance | Reports shall separate timeliness, accuracy, submitted, delivered-if-known, failed, bounced, and manual fallback outcomes. | MUST | 6 | PROVISIONAL |
| REQ-REPORT-009 | Access revocation performance | Reports shall show completion relative to exact effective time and any exposure window. | MUST | 6 | PROVISIONAL |
| REQ-REPORT-010 | Asset reporting | Reports shall separate disposition documentation from physical recovery and support asset class analysis. | MUST | 6 | PROVISIONAL |
| REQ-REPORT-011 | Survey reporting | Reports shall show eligibility, delivery, response channel, completion, reason categories, and approved aggregate themes. | MUST | 6 | PROVISIONAL |
| REQ-REPORT-012 | Exception feed | A consolidated exception feed shall show overdue, blocked, failed, bounced, missing-data, and control-integrity issues with owner and next action. | MUST | 3 | PROVISIONAL |
| REQ-REPORT-013 | Trend reporting | Authorized HR users shall report case volume, cycle time, departure type, department, location, and reason trends by month/quarter. | MUST | 6 | PROVISIONAL |
| REQ-REPORT-014 | Cohort comparison | Reports shall compare BASELINE, PILOT, and POST_ROLLOUT without mixing cohorts by default. | MUST | 6 | PROVISIONAL |
| REQ-REPORT-015 | Filters | Reports shall support date, departure type, location, department, owner, cohort, workflow version, and status filters. | MUST | 6 | PROVISIONAL |
| REQ-REPORT-016 | Export redaction | Exports shall apply the requester's permissions, suppress restricted fields, watermark where appropriate, and create an audit event. | MUST | 6 | PROVISIONAL |
| REQ-REPORT-017 | Small-cohort protection | Exit-feedback reports shall enforce the approved small-cohort threshold and prevent drill-through to identifiable responses. | MUST | 6 | OPEN |
| REQ-REPORT-018 | Data freshness | Every dashboard/report shall display its data-as-of timestamp and integration health where source synchronization affects results. | SHOULD | 6 | PROVISIONAL |
| REQ-REPORT-019 | Scheduled management report | The platform should support a scheduled monthly HR control report after notification integration is stable. | SHOULD | 6 | PROVISIONAL |
| REQ-REPORT-020 | Baseline data export | The baseline release shall provide a clean export of required baseline timestamps and outcomes even while automation is disabled. | MUST | 1 | PROVISIONAL |

## Security

| Requirement ID | Title | Requirement | Priority | Stage | Status |
| --- | --- | --- | --- | --- | --- |
| REQ-SEC-001 | Production SSO | Production authentication shall use the company-approved OIDC or SAML identity provider. | MUST | 1 | OPEN |
| REQ-SEC-002 | MFA dependency | Production access shall require MFA where enforced by the identity provider and shall not provide a weaker local bypass. | MUST | 1 | PROVISIONAL |
| REQ-SEC-003 | Development login safeguards | Any development role switcher shall require both a non-production environment and ALLOW_DEV_LOGIN=true; startup shall fail if enabled in production. | MUST | 1 | PROVISIONAL |
| REQ-SEC-004 | Secure session | Sessions shall use secure, HttpOnly, SameSite cookies or an equivalently secure approved mechanism, with idle and absolute timeouts. | MUST | 1 | PROVISIONAL |
| REQ-SEC-005 | Server-side authorization | Every protected read and mutation shall enforce authorization on the server, independent of UI visibility. | MUST | 1 | PROVISIONAL |
| REQ-SEC-006 | Least privilege RBAC | Roles shall receive only the permissions required for their tasks. | MUST | 1 | PROVISIONAL |
| REQ-SEC-007 | Record-level authorization | Access shall consider case classification, assignment, department role, and explicit participation, not role name alone. | MUST | 1 | PROVISIONAL |
| REQ-SEC-008 | Restricted termination cases | Termination cases shall be restricted by default and excluded from broad lists/notifications for unauthorized users. | MUST | 1 | PROVISIONAL |
| REQ-SEC-009 | Restricted survey data | Identifiable exit-response data shall use separate permissions and access logging. | MUST | 2 | PROVISIONAL |
| REQ-SEC-010 | System admin data isolation | SYSTEM_ADMIN shall have no default business-data access; break-glass access shall be time-bound, approved, reasoned, and audited. | MUST | 1 | PROVISIONAL |
| REQ-SEC-011 | TLS | All production traffic, callbacks, and integrations shall use current approved TLS over HTTPS. | MUST | 1 | PROVISIONAL |
| REQ-SEC-012 | Encryption at rest | Database, backups, and object storage shall use encryption at rest managed by the hosting platform or approved equivalent. | MUST | 1 | PROVISIONAL |
| REQ-SEC-013 | Secrets management | Credentials, API keys, signing secrets, and encryption keys shall be stored outside source control in an approved secrets manager or deployment secret store. | MUST | 1 | PROVISIONAL |
| REQ-SEC-014 | CSRF protection | State-changing browser requests shall be protected against CSRF using framework and origin controls. | MUST | 1 | PROVISIONAL |
| REQ-SEC-015 | Security headers | The application shall set appropriate CSP, frame, content-type, referrer, and transport security headers. | MUST | 1 | PROVISIONAL |
| REQ-SEC-016 | Rate limiting | Authentication, survey tokens, downloads, and sensitive mutation endpoints shall have risk-based rate limiting. | MUST | 2 | PROVISIONAL |
| REQ-SEC-017 | Input validation | All external input shall be schema-validated on the server with allow-listed types and lengths. | MUST | 1 | PROVISIONAL |
| REQ-SEC-018 | Output encoding | User-controlled content shall be safely encoded and sanitized for its rendering context. | MUST | 1 | PROVISIONAL |
| REQ-SEC-019 | Upload allow-list | Uploads shall be restricted by extension, MIME, file signature, size, and business purpose. | MUST | 1 | PROVISIONAL |
| REQ-SEC-020 | Upload quarantine and scanning | Uploaded files shall be quarantined until malware scanning/validation succeeds; failures shall not be served. | MUST | 1 | PROVISIONAL |
| REQ-SEC-021 | Safe filenames | Stored object keys shall be generated by the system and shall not trust user-supplied paths or names. | MUST | 1 | PROVISIONAL |
| REQ-SEC-022 | Authorized downloads | Document and evidence downloads shall require current authorization; signed URLs, if used, shall be short-lived and scoped. | MUST | 1 | PROVISIONAL |
| REQ-SEC-023 | PII-safe logs | Operational logs shall exclude document bodies, survey answers, personal addresses, tokens, secrets, and unnecessary employee data. | MUST | 1 | PROVISIONAL |
| REQ-SEC-024 | Immutable audit events | Business audit events shall be append-only to application roles and protected from alteration. | MUST | 1 | PROVISIONAL |
| REQ-SEC-025 | Audit clock | Audit timestamps shall be stored in UTC and displayed in America/Jamaica with original offset/context where relevant. | MUST | 1 | PROVISIONAL |
| REQ-SEC-026 | Backup and restore | Production data and objects shall have automated backups and a tested restore procedure before pilot exit. | MUST | 7 | PROVISIONAL |
| REQ-SEC-027 | Dependency scanning | CI shall scan dependencies for known vulnerabilities and fail according to an approved severity policy. | MUST | 1 | PROVISIONAL |
| REQ-SEC-028 | Static analysis | CI shall run linting, type checking, secret scanning, and static security analysis. | MUST | 1 | PROVISIONAL |
| REQ-SEC-029 | Dynamic security testing | Pre-production hardening shall include authenticated dynamic testing of high-risk flows. | MUST | 7 | PROVISIONAL |
| REQ-SEC-030 | ASVS baseline | Security verification shall use OWASP ASVS 5.0.0 as the current baseline, with applicable controls selected and evidenced. | MUST | 7 | PROVISIONAL |
| REQ-SEC-031 | No production data in development | Development, tests, screenshots, demos, and seed data shall use synthetic or approved anonymized data only. | MUST | 1 | PROVISIONAL |
| REQ-SEC-032 | Admin change audit | Role grants, workflow/template activation, feature flags, integration settings, and retention changes shall be audited. | MUST | 1 | PROVISIONAL |
| REQ-SEC-033 | Token entropy | Survey and download tokens shall use cryptographically secure randomness and adequate entropy. | MUST | 2 | PROVISIONAL |
| REQ-SEC-034 | Error handling | User-facing errors shall not reveal stack traces, secrets, object keys, SQL details, or internal identifiers unnecessary to support. | MUST | 1 | PROVISIONAL |
| REQ-SEC-035 | Incident support | The platform shall preserve evidence and provide access/query support for security and privacy incident investigation. | MUST | 7 | PROVISIONAL |
| REQ-SEC-036 | Manual fallback | A documented secure manual fallback shall exist for critical offboarding when the platform is unavailable. | MUST | 7 | PROVISIONAL |
| REQ-SEC-037 | Environment separation | Development, test, staging, and production shall use separate credentials, data, storage, and notification endpoints. | MUST | 1 | PROVISIONAL |
| REQ-SEC-038 | Change protection | Production schema/configuration changes shall require reviewed migrations or approved change procedures and rollback planning. | MUST | 1 | PROVISIONAL |
| REQ-SEC-039 | Sensitive action re-authentication | High-risk actions such as break-glass access, role grants, retention deletion, and export should require recent authentication or equivalent control. | SHOULD | 7 | PROVISIONAL |
| REQ-SEC-040 | Accessibility security compatibility | Security controls such as MFA prompts, timeouts, and error messages shall remain accessible and not rely solely on colour or inaccessible CAPTCHAs. | MUST | 7 | PROVISIONAL |

## Privacy

| Requirement ID | Title | Requirement | Priority | Stage | Status |
| --- | --- | --- | --- | --- | --- |
| REQ-PRIV-001 | Purpose specification | Every personal-data field and processing activity shall map to an approved offboarding purpose. | MUST | 1 | PROVISIONAL |
| REQ-PRIV-002 | Data minimization | Screens, exports, notifications, and integrations shall expose only data necessary for the user's task and recipient purpose. | MUST | 1 | PROVISIONAL |
| REQ-PRIV-003 | Data classification | Fields and record types shall be classified as INTERNAL, CONFIDENTIAL, RESTRICTED_HR, or approved equivalent. | MUST | 1 | PROVISIONAL |
| REQ-PRIV-004 | Accuracy support | The system shall display sources and allow controlled correction of inaccurate case data without rewriting history. | MUST | 1 | PROVISIONAL |
| REQ-PRIV-005 | Privacy notices | The product shall provide approved privacy notices for internal users, survey respondents, and relevant data-sharing contexts. | MUST | 2 | PROVISIONAL |
| REQ-PRIV-006 | Configurable retention | Retention shall be configurable by record class and measured from an approved event such as separation or case completion. | MUST | 7 | OPEN |
| REQ-PRIV-007 | Automated disposition jobs | After policy approval, scheduled jobs shall identify and securely delete/anonymize eligible records with evidence and exception handling. | MUST | 7 | OPEN |
| REQ-PRIV-008 | Legal hold | Authorized privacy/legal users shall be able to place and release legal holds that suspend automated deletion. | MUST | 7 | PROVISIONAL |
| REQ-PRIV-009 | Data subject access support | The system shall support authorized search and export of a person's data for approved access requests. | MUST | 7 | PROVISIONAL |
| REQ-PRIV-010 | Correction support | The system shall support correction of inaccurate data while preserving original values and audit history. | MUST | 1 | PROVISIONAL |
| REQ-PRIV-011 | Cross-border review | Cloud hosting, external providers, and AI processing outside Jamaica shall not be enabled until an approved cross-border/data-processor assessment is recorded. | MUST | 1 | PROVISIONAL |
| REQ-PRIV-012 | Processor inventory | The project shall maintain an inventory of data processors/subprocessors, purposes, locations, contracts, and security assurances. | MUST | 7 | PROVISIONAL |
| REQ-PRIV-013 | DPIA support | The project shall complete and retain an approved data protection impact assessment before production. | MUST | 7 | PROVISIONAL |
| REQ-PRIV-014 | Breach clock support | Incident records shall support capture of awareness time, affected data/categories, actions, notifications, and regulatory deadline tracking. | MUST | 7 | PROVISIONAL |
| REQ-PRIV-015 | Affected-person notification support | The incident process shall support approved notification tracking for affected data subjects where required. | MUST | 7 | PROVISIONAL |
| REQ-PRIV-016 | Third-party sharing log | Every external disclosure shall retain recipient, purpose, field set, lawful/policy basis reference, approver, and timestamp. | MUST | 5 | PROVISIONAL |
| REQ-PRIV-017 | Survey confidentiality model | Survey invitations and notices shall state the approved confidentiality/anonymity model without making promises the system cannot enforce. | MUST | 2 | OPEN |
| REQ-PRIV-018 | Aggregate de-identification | Aggregate exit reports shall minimize re-identification through suppression, grouping, and restricted drill-through. | MUST | 6 | PROVISIONAL |
| REQ-PRIV-019 | AI assessment | Any AI feature using employee data shall require approved privacy/security assessment, data minimization, and provider controls. | MUST | Future | PROVISIONAL |
| REQ-PRIV-020 | Sensitive access review | The system shall report access to restricted documents, termination cases, survey responses, and exports for periodic review. | MUST | 6 | PROVISIONAL |
| REQ-PRIV-021 | Consent/legal basis recording | Where an approved process depends on consent or another recorded basis, the system shall capture the applicable notice/basis version and event. | SHOULD | 7 | OPEN |
| REQ-PRIV-022 | Data disposal evidence | Deletion/anonymization operations shall create non-content evidence showing record class, count, policy version, date, actor/job, and result. | MUST | 7 | PROVISIONAL |
| REQ-PRIV-023 | Personal email protection | Personal email addresses shall be classified RESTRICTED_HR and hidden from departmental users. | MUST | 1 | PROVISIONAL |
| REQ-PRIV-024 | Free-text minimization | Free-text fields shall be used only where structured fields are insufficient and shall have guidance, limits, and restricted visibility. | SHOULD | 1 | PROVISIONAL |

## Integrations

| Requirement ID | Title | Requirement | Priority | Stage | Status |
| --- | --- | --- | --- | --- | --- |
| REQ-INT-001 | Adapter boundaries | BambooHR, email, object storage, identity, and future AI integrations shall be accessed through defined interfaces/adapters. | MUST | 1 | PROVISIONAL |
| REQ-INT-002 | BambooHR read-only MVP | Initial BambooHR integration shall be read-only for employee lookup and snapshot unless a later write scope is approved. | MUST | 5 | PROVISIONAL |
| REQ-INT-003 | Dedicated identity | BambooHR access shall use a company-controlled dedicated integration identity or approved OAuth application. | MUST | 5 | PROVISIONAL |
| REQ-INT-004 | Field permission inventory | The integration shall document and validate the exact BambooHR fields it can read before production. | MUST | 5 | PROVISIONAL |
| REQ-INT-005 | Snapshot timestamp | Every synchronized employee record and case snapshot shall record source ID, retrieved_at, and integration version. | MUST | 5 | PROVISIONAL |
| REQ-INT-006 | Stale data handling | The UI shall warn when source data is stale or synchronization has failed and permit approved manual continuation with reason. | MUST | 5 | PROVISIONAL |
| REQ-INT-007 | Event-based webhook preference | If webhooks are approved, new integration should use BambooHR event-based webhooks and fetch current data through the API rather than trusting broad field payloads. | SHOULD | 5 | PROVISIONAL |
| REQ-INT-008 | Webhook signature verification | BambooHR webhook requests shall verify the HMAC signature using the raw request body and timestamp. | MUST | 5 | PROVISIONAL |
| REQ-INT-009 | Webhook replay protection | Webhook processing shall reject stale/replayed requests according to an approved timestamp window and idempotency record. | MUST | 5 | PROVISIONAL |
| REQ-INT-010 | Webhook retries and idempotency | Webhook handlers shall return appropriate status codes, process batches idempotently, and reconcile missed events. | MUST | 5 | PROVISIONAL |
| REQ-INT-011 | Integration reconciliation | The system shall provide a reconciliation process comparing local employee/source status with BambooHR for selected cases. | MUST | 5 | PROVISIONAL |
| REQ-INT-012 | Microsoft Graph v1.0 | If Microsoft Graph is selected, production calls shall use generally available v1.0 APIs unless an approved exception exists. | MUST | 5 | PROVISIONAL |
| REQ-INT-013 | Graph acceptance semantics | A Graph 202 response shall set the notification to SUBMITTED, not DELIVERED. | MUST | 5 | PROVISIONAL |
| REQ-INT-014 | Mailbox scope | Application mail permissions shall be limited to an approved service mailbox or constrained scope where supported. | MUST | 5 | PROVISIONAL |
| REQ-INT-015 | Credential rotation | Integration credentials and signing secrets shall have owners, rotation procedures, expiry monitoring where available, and revocation steps. | MUST | 5 | PROVISIONAL |
| REQ-INT-016 | Health monitoring | Each integration shall expose health, last success, last failure, queue depth, and actionable error state without exposing secrets. | MUST | 5 | PROVISIONAL |
| REQ-INT-017 | Stub providers | Development shall include deterministic stub/sink implementations for BambooHR, email, object storage, and identity. | MUST | 1 | PROVISIONAL |
| REQ-INT-018 | No production connection by default | Local and CI configurations shall not contain production endpoints or credentials and shall fail safely if missing. | MUST | 1 | PROVISIONAL |
| REQ-INT-019 | External recipient configuration | NCB, Sagicor, and other recipient endpoints shall be approved configuration with effective dates and owners. | MUST | 5 | PROVISIONAL |
| REQ-INT-020 | Integration idempotency | Create/update/dispatch operations shall be idempotent and use stable correlation IDs. | MUST | 5 | PROVISIONAL |
| REQ-INT-021 | Manual import fallback | The product shall support an approved CSV/manual employee lookup fallback without treating imported data as silently authoritative. | SHOULD | 1 | PROVISIONAL |
| REQ-INT-022 | Error work queue | Integration errors requiring human action shall create structured exceptions with owner and retry/fallback action. | MUST | 5 | PROVISIONAL |
| REQ-INT-023 | Unknown fields tolerance | Webhook and API parsers shall ignore unknown optional fields while validating required structure. | MUST | 5 | PROVISIONAL |
| REQ-INT-024 | Integration event archive | Sanitized integration event metadata shall be retained for troubleshooting according to policy without retaining unnecessary payload data. | MUST | 5 | PROVISIONAL |

## Administration

| Requirement ID | Title | Requirement | Priority | Stage | Status |
| --- | --- | --- | --- | --- | --- |
| REQ-ADMIN-001 | User and role administration | Authorized administrators shall manage user-role assignments subject to approval and audit. | MUST | 1 | PROVISIONAL |
| REQ-ADMIN-002 | No self-escalation | Users shall not grant themselves higher privileges or approve their own privileged role assignment. | MUST | 1 | PROVISIONAL |
| REQ-ADMIN-003 | Department and location configuration | HR administrators shall manage active departments and locations used for routing/reporting. | MUST | 1 | PROVISIONAL |
| REQ-ADMIN-004 | Workflow administration | Approved roles shall create draft workflow versions, validate them, and submit them for activation approval. | MUST | 3 | PROVISIONAL |
| REQ-ADMIN-005 | Template administration | Approved roles shall manage document, notification, and survey template versions with maker-checker approval. | MUST | 2 | PROVISIONAL |
| REQ-ADMIN-006 | Business calendar | Authorized administrators shall manage holidays and working-day rules with effective dates and audit history. | MUST | 1 | PROVISIONAL |
| REQ-ADMIN-007 | Reason taxonomy | HR shall manage versioned departure reason categories and reporting groupings. | MUST | 1 | OPEN |
| REQ-ADMIN-008 | Asset catalogue | Authorized asset owners shall manage asset types, risk class, and owning department. | MUST | 4 | PROVISIONAL |
| REQ-ADMIN-009 | Recipient directory | Authorized HR/IT users shall manage external and internal recipient configuration with verification and effective dates. | MUST | 5 | PROVISIONAL |
| REQ-ADMIN-010 | Feature flags | Authorized technical/product owners shall manage environment-scoped feature flags with audit history. | MUST | 1 | PROVISIONAL |
| REQ-ADMIN-011 | Retention policy configuration | Only approved privacy/governance roles shall activate retention policy versions. | MUST | 7 | OPEN |
| REQ-ADMIN-012 | Audit viewer | Authorized audit/privacy roles shall search audit events by actor, case, action, object, date, and correlation ID. | MUST | 6 | PROVISIONAL |
| REQ-ADMIN-013 | Configuration versioning | Business-critical configuration shall be versioned or historically auditable with effective dates. | MUST | 1 | PROVISIONAL |
| REQ-ADMIN-014 | Controlled correction | Administrators shall not directly edit business records through generic database/admin screens; corrections shall use domain actions. | MUST | 1 | PROVISIONAL |
| REQ-ADMIN-015 | Break-glass administration | Break-glass access shall require approval, time limit, reason, and post-use review. | MUST | 7 | PROVISIONAL |
| REQ-ADMIN-016 | Operational health page | Authorized technical users shall see job, queue, integration, storage, and scheduler health without HR content. | MUST | 5 | PROVISIONAL |
| REQ-ADMIN-017 | Survey settings | HR shall manage eligibility defaults, send timing, reminder timing, expiry, and suppression rules through versioned settings. | MUST | 2 | PROVISIONAL |
| REQ-ADMIN-018 | Export settings | Privacy/HR governance shall manage approved export types, fields, watermarking, and expiry. | SHOULD | 6 | PROVISIONAL |

## Non-functional

| Requirement ID | Title | Requirement | Priority | Stage | Status |
| --- | --- | --- | --- | --- | --- |
| REQ-NFR-001 | Modular monolith | The initial product shall use a modular monolith with clear domain boundaries and a separate background worker, not microservices. | MUST | 1 | PROVISIONAL |
| REQ-NFR-002 | Relational integrity | The authoritative operational store shall be PostgreSQL-compatible and enforce relational constraints and transactional integrity. | MUST | 1 | PROVISIONAL |
| REQ-NFR-003 | Transactional outbox reliability | Business transactions that create outbound work shall commit domain state and outbox records atomically. | MUST | 5 | PROVISIONAL |
| REQ-NFR-004 | Maintainable TypeScript | Application and worker code shall use strict TypeScript and shared validation/domain packages. | MUST | 1 | PROVISIONAL |
| REQ-NFR-005 | Schema validation | External boundaries and server actions/API inputs shall use explicit runtime schemas such as Zod. | MUST | 1 | PROVISIONAL |
| REQ-NFR-006 | Accessibility target | User interfaces shall target WCAG 2.2 Level AA, including keyboard operation, focus visibility, labels, errors, contrast, and status not conveyed by colour alone. | MUST | 1 | PROVISIONAL |
| REQ-NFR-007 | Responsive design | Core HR, department queue, and survey flows shall work on supported desktop and mobile widths. | MUST | 1 | PROVISIONAL |
| REQ-NFR-008 | Performance target | For normal operational load, common authenticated pages should meet a provisional p95 server response target of 1.5 seconds excluding external integration latency. | SHOULD | 7 | OPEN |
| REQ-NFR-009 | Queue latency | Approved scheduled jobs should begin within a provisional five-minute window, except exact-time security tasks which require a tighter approved target. | MUST | 5 | OPEN |
| REQ-NFR-010 | Availability objective | Production availability target shall be approved after hosting selection and measured separately from planned maintenance. | MUST | 7 | OPEN |
| REQ-NFR-011 | RPO/RTO | Recovery point and recovery time objectives shall be approved before pilot exit and verified by restore exercise. | MUST | 7 | OPEN |
| REQ-NFR-012 | Observability | The system shall produce structured logs, metrics, traces/correlation IDs, job health, and alertable error states. | MUST | 1 | PROVISIONAL |
| REQ-NFR-013 | Supportability | Errors shall provide user-safe reference IDs that support investigation through sanitized logs and audit events. | MUST | 1 | PROVISIONAL |
| REQ-NFR-014 | Browser support | The product shall support current company-standard Chromium/Edge browsers and responsive survey access on current mobile browsers; exact matrix is approved before UAT. | MUST | 7 | OPEN |
| REQ-NFR-015 | Timezone handling | All stored instants shall use UTC; business rules and UI shall use America/Jamaica unless a specific external timestamp requires otherwise. | MUST | 1 | PROVISIONAL |
| REQ-NFR-016 | Localization readiness | User-facing text and template content shall be externalized sufficiently to allow future localization without domain rewrites. | SHOULD | 1 | PROVISIONAL |
| REQ-NFR-017 | Data volume | The architecture shall support at least ten years of projected case volume with growth headroom without requiring distributed services. | MUST | 1 | PROVISIONAL |
| REQ-NFR-018 | File limits | Upload size/type limits shall be configurable per document/evidence type and enforced before storage. | MUST | 1 | PROVISIONAL |
| REQ-NFR-019 | Graceful degradation | Failure of email or BambooHR shall not prevent authorized HR from recording and progressing a case through approved manual fallback. | MUST | 5 | PROVISIONAL |
| REQ-NFR-020 | Test pyramid | The codebase shall include unit, integration, contract, and critical-path end-to-end tests, with security/accessibility tests in the release gate. | MUST | 1 | PROVISIONAL |
| REQ-NFR-021 | Migration safety | Database migrations shall be reversible where practical, reviewed, tested against representative synthetic data, and backed up before production execution. | MUST | 1 | PROVISIONAL |
| REQ-NFR-022 | No unbounded background work | Workers shall use bounded retries, dead-letter/error handling, concurrency limits, and idempotency. | MUST | 3 | PROVISIONAL |
| REQ-NFR-023 | Documentation as code | Architecture, requirements, runbooks, decisions, and change history shall be maintained in the repository and updated with implementation changes. | MUST | 1 | PROVISIONAL |
| REQ-NFR-024 | Auditability over convenience | The design shall favor explicit state transitions and recorded exceptions over silent automation or direct record edits. | MUST | 1 | PROVISIONAL |

## Approval and change rule

An `OPEN` requirement must not be implemented by assumption. A requirement status, statement, priority or stage may change only through the Decision Register/change-control process and corresponding traceability updates.
