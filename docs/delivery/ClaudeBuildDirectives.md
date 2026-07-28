# Claude Build Directives

**Baseline version:** 0.1
**Prepared:** 2026-07-28
**Use:** Paste only one directive at a time. Do not authorize the next directive until the prior evidence has been reviewed.

## Directive-to-stage mapping

The delivery stages in `Roadmap.md` and the directives in this file are not one
to one. A roadmap stage may require more than one directive.

| Roadmap stage | Directives | Stage name |
| --- | --- | --- |
| 0 | Directive 0, Directive 0.1 | Product and architecture baseline |
| 1 | Directive 1 | Foundation, access, audit and baseline capture |
| 2 | Directive 2, Directive 3 | Controlled documents and exit-survey quick wins |
| 3 | Directive 4, Directive 5 | Workflow engine and departmental queues |
| 4 | Directive 6 | Assets, handover and clearance |
| 5 | Directive 7, Directive 8 | Notifications and integrations |
| 6 | Directive 9 | Reporting and control automation |
| 7 | Directive 10 | Hardening, UAT, pilot and rollout |

Directive 0.1 was issued as a baseline-reconciliation and repository-hygiene
correction after Directive 0 validation; it introduced no application code.

Rules that follow from this mapping:

1. A roadmap stage may require more than one directive.
2. Every directive has its own authorized scope, exclusions, acceptance gate,
   required tests, evidence requirements and local commit.
3. Completing the first directive within a stage does not complete the stage.
4. Claude must stop after every directive and wait for review.
5. A later directive must not be executed merely because an earlier directive
   in the same stage passed.

Because a stage spans several directives, the Roadmap's "Expected local commit"
column names the stage-level outcome, not any single directive's commit message.
Use the COMMIT line inside each directive as the authoritative commit message.

## Operating note

Before every directive, Claude must:

1. read `CLAUDE.md`;
2. inspect the current repository and active documentation;
3. list relevant OPEN decisions and stop if any blocks the requested behaviour;
4. preserve existing work;
5. use synthetic data;
6. commit locally and never push;
7. return the evidence format in `CLAUDE.md`;
8. stop after the directive.

---

## Directive 0 — Import and validate the baseline

```text
DIRECTIVE 0 — DOCUMENTATION IMPORT AND BASELINE VALIDATION

Read README.md, Project.md, CLAUDE.md, docs/INDEX.md, the Decision Register,
Stakeholder Approval Checklist and this directive file.

SCOPE
- Inspect the repository before changing it.
- Confirm whether application code already exists.
- Validate the documentation package for:
  * missing files;
  * broken relative links;
  * duplicate or malformed REQ, BR, DEC, KPI, R and audit-event IDs;
  * conflicts between APPROVED or PROVISIONAL artefacts;
  * OPEN decisions that block Directive 1;
  * references to files that do not exist;
  * accidental personal data copied from the source appendices.
- Create docs/delivery/BaselineValidationReport.md.
- Make only obvious, non-behavioural corrections such as links, numbering,
  spelling, duplicated headings or incorrect file paths.
- Initialize Git only when no repository exists.

DO NOT
- implement application code;
- install the application stack;
- change scope, targets, roles, workflow behaviour, architecture or decision
  status;
- copy the source DMAIC into the repository;
- push.

VERIFICATION
Run repeatable Markdown, ID uniqueness, link and sensitive-term checks. Report
the exact commands and results.

COMMIT
docs: import and validate HR offboarding product baseline

RETURN
Use the evidence format in CLAUDE.md. Explicitly state whether Directive 1 is
ready and which decisions block it. Stop.
```

---

## Directive 1 — Secure foundation and baseline capture

```text
DIRECTIVE 1 — SECURE APPLICATION FOUNDATION AND BASELINE CAPTURE

PRECONDITION
Directive 0 and Directive 0.1 are approved. The Stage 1 items in
docs/requirements/StakeholderApprovalChecklist.md have been resolved, or an
approved written implementation constraint exists for each. The written
constraints are recorded in docs/requirements/Stage1ImplementationConstraints.md
(IC-S1-001 to IC-S1-011). Those constraints permit reversible non-production
engineering only; they are NOT stakeholder approval and do not change any OPEN
or PROVISIONAL decision to APPROVED. In particular, do not invent production
SSO, hosting, reason taxonomy, historical migration or restricted-termination
rules.

OBJECTIVE
Create the maintainable application foundation and a safe baseline-capture
release. This directive does not automate the improved offboarding workflow.

READ
- Project.md and CLAUDE.md
- Stage1ImplementationConstraints.md (IC-S1-001 to IC-S1-011)
- RequirementsCatalogue.md: all Stage 1 requirements
- BusinessRules.md
- RolesAndPermissions.md
- DataDictionary.md
- Architecture.md, DomainModel.md, DataModel.md
- SecurityAndPrivacy.md and ThreatModel.md
- DesignSystemAndAccessibility.md
- TestStrategy.md and DefinitionOfDone.md

REPOSITORY AND STACK
1. Inspect and preserve existing code.
2. Select currently supported package versions using official documentation and
   the actual runtime; record material version decisions.
3. Establish the approved modular-monolith workspace with:
   - apps/web;
   - apps/worker;
   - shared domain/database/config/auth/validation/UI packages where justified;
   - strict TypeScript;
   - Next.js App Router;
   - PostgreSQL + Prisma;
   - Zod or equivalent runtime validation;
   - unit/integration/Playwright foundations.
4. Add environment schema validation and safe defaults.
5. Do not introduce microservices, GraphQL, Kubernetes, a second database or
   speculative infrastructure.

AUTHENTICATION AND AUTHORIZATION
1. Implement an identity-provider abstraction. Use only the approved development
   identity approach in non-production.
2. A development role switcher must require BOTH:
     NODE_ENV != production
     ALLOW_DEV_LOGIN=true
   The app must fail closed if development login is enabled in production.
3. Implement server-side policy checks for all eight roles:
   HR_MANAGER, HR_OFFICER, IT_RESPONDER, FINANCE_RESPONDER, LINE_MANAGER,
   AUDITOR, PRIVACY_OFFICER and SYSTEM_ADMIN.
4. SYSTEM_ADMIN must not gain routine HR-case access merely because it is a
   technical role.
5. PRIVACY_OFFICER covers privacy oversight, retention oversight, disclosure
   review, access review, data-subject request oversight, investigation of
   unauthorized access and review of privacy-sensitive reporting. It must NOT
   receive authority to create ordinary offboarding cases, approve
   resignations, approve terminations, alter final-pay details, edit exit
   responses or perform ordinary HR case processing. Preserve the
   restrictions defined in RolesAndPermissions.md; do not broaden the role
   into routine HR operations.
6. Implement restricted-by-default termination-case access with negative tests.
7. Implement session/user/role audit events.

FOUNDATIONAL DATA
Implement the minimum approved entities and constraints for:
- users, roles and assignments;
- employees/source references and immutable case snapshot;
- offboarding case, status history and confidentiality;
- case participants;
- attachments/file metadata boundary;
- audit events;
- cohort;
- business calendar/holiday configuration;
- feature flags;
- integration/config placeholders without live credentials.

CASE BASELINE FLOW
1. Authorized HR creates a DRAFT case.
2. Employee is selected from a synthetic/manual source adapter.
3. Require departure type, receipt timestamp, proposed/confirmed effective
   date/time, case owner and location/department.
   Do NOT require an approved reason category at case creation: the taxonomy
   decision DEC-031 is still OPEN. Per IC-S1-008 in
   Stage1ImplementationConstraints.md, implement a versioned reference-data
   model with a nullable reason_category_id and a reason_capture_status of
   PENDING, PROVIDED, NOT_PROVIDED or NOT_APPLICABLE. Do not invent reason
   categories as an enum, hard-coded dropdown or production seed list.
4. Validate high-risk fields and show a review step.
5. HR submits and approves/accepts according to the approved Stage 1 state rules.
6. Store the immutable employee snapshot on approval.
7. Support list, search, filter and case detail with least-privilege views.
8. Support authorized correction/voiding with reason and audit history.
9. Never hard-delete a case.

BASELINE MODE
1. Implement two separate dimensions. Do not use a five-value cohort enum.
   - measurement_cohort: exactly BASELINE, PILOT, POST_ROLLOUT.
   - record_purpose:     exactly OPERATIONAL, TRAINING, TEST.
   OPERATIONAL records require a measurement cohort. TRAINING and TEST records
   must be synthetic, must carry no measurement cohort, and must never call a
   live integration. TRAINING and TEST are not business cohorts.
   record_purpose is set at creation and may change only by authorized,
   reasoned, audited correction before operational use. Never silently convert
   OPERATIONAL to TRAINING/TEST, or TRAINING/TEST to OPERATIONAL.
2. BASELINE must disable all improvement automations:
   no generated/issued letter, no survey, no notification dispatch, no automatic
   reminder/escalation.
3. Capture manual timestamps/outcomes needed by BaselineDataCapturePlan.md.
4. Provide a basic baseline dashboard/export showing counts and missing fields.
   Reports default to record_purpose = OPERATIONAL.
5. Exclude TRAINING and TEST records from operational KPIs, management reports,
   baseline/pilot/post-rollout reports, notification and document-turnaround
   performance, survey completion, asset recovery and business-volume reporting.

ATTACHMENTS
Create a secure adapter boundary and metadata model. A local development adapter
may be used, but:
- randomize object names;
- enforce configured size/type allow-list;
- never execute/serve inline unsafe content;
- model quarantine/scanning status;
- require authorization for download;
- do not claim production malware scanning unless it exists.

AUDIT
Use structured, append-oriented business audit events. Capture actor, action,
target, case, timestamp, request/correlation ID and safe metadata. Do not log
addresses, document bodies, survey text, tokens or secrets.

UI
Create a professional responsive shell and:
- sign-in/development access page;
- HR dashboard;
- case list;
- create/review case;
- case overview and audit timeline;
- role-appropriate unauthorized/not-found states.
Follow WCAG 2.2 AA requirements and do not copy the dark concept dashboard.

SYNTHETIC DATA
Use deterministic fictional fixtures only. Never use names, addresses,
signatures, emails or employee numbers from the source DMAIC.

TESTS
At minimum:
- environment/dev-login production guard;
- role and record authorization matrix, including restricted termination;
- case validation/state/void/correction;
- immutable snapshot;
- cohort and baseline automation guard;
- business-calendar calculations;
- audit append and PII-safe logging;
- upload metadata/type/size/quarantine authorization;
- database constraints and migrations;
- critical Playwright HR case path;
- lint, format, strict typecheck, build.

DOCUMENTATION
Update architecture/data/run instructions and traceability surgically. Record
any unresolved issue rather than inventing it.

OUT OF SCOPE
- workflow/task automation;
- controlled document generation;
- surveys;
- outbox/email;
- BambooHR/live identity/storage integrations;
- assets/handover;
- KPI engine beyond baseline capture;
- AI;
- production deployment.

COMMIT
feat: establish secure offboarding foundation and baseline capture

RETURN
Provide all CLAUDE.md evidence, including migration status, exact tests, security
implications, git status and commit hash. Confirm no live external system was
called and nothing was pushed. Stop.
```

---

## Directive 2 — Controlled documents and digital action form

```text
DIRECTIVE 2 — CONTROLLED DOCUMENTS, APPROVALS AND DIGITAL ACTION FORM

PRECONDITION
Directive 1 is approved. Document wording, output formats, digital attestation
requirements and the existing Employee Action Form hierarchy have been approved
for the scope being implemented. Do not resolve OPEN document decisions in code.

OBJECTIVE
Implement controlled, versioned document generation and approval. Do not add
live email dispatch.

READ
- Stage 2 document requirements in RequirementsCatalogue.md
- DocumentAndNotificationDesign.md
- StateMachines.md
- ControlledCommunicationTemplates.md
- TemplateCatalogue.md
- RolesAndPermissions.md
- DataClassificationAndRetention.md
- DecisionRegister entries that govern controlled documents and approvals:
  DEC-004 (authoritative automation model), DEC-005 (communication approval),
  DEC-007 (baseline measurement and the prohibition on improvement automation
  during baseline capture), DEC-010 (Employee Action Form approval hierarchy)
  and DEC-025 (digital signatures and attestations).
  DEC-008 governs the asset-recovery stage and is NOT a controlling decision
  for document generation and approval.

FUNCTIONAL SCOPE
1. Implement document-template definitions and immutable versions.
2. Define typed placeholders, required/optional fields, formatting/validation
   rules, effective dates, status and approval metadata.
3. Pin each generated document to:
   case snapshot;
   template version;
   workflow version where applicable;
   generator version;
   generation timestamp.
4. Validate placeholders before generation and block unresolved required fields.
5. Provide preview and field/source review before approval.
6. Implement the approved document states:
   DRAFT, PENDING_APPROVAL, APPROVED, GENERATED/ISSUED as specified,
   REJECTED, SUPERSEDED, VOIDED or corrected equivalents.
7. Enforce maker-checker where required; an unauthorized user cannot self-approve
   a restricted document.
8. Generate the approved output format. Do not create DOCX unless DEC-025 and
   REQ-DOC-009 are approved for the relevant template.
9. Store checksum, object reference, MIME type, size and approval/issue evidence.
10. Implement correction/supersession; never overwrite an issued artefact.
11. Log preview, approval, rejection, generation, download, issue, correction
    and supersession events.
12. Restrict document access by case participation and classification.

TEMPLATE SCOPE
Implement only templates whose content status is approved:
- resignation with notice acknowledgement/acceptance;
- immediate resignation acknowledgement;
- approved termination placeholder/template;
- digital Employee Action Form;
- asset/clearance acknowledgement if approved.
An unapproved template may exist only as INACTIVE draft configuration and must
not be issuable.

EMPLOYEE ACTION FORM
Digitize existing data and approval order without changing authority. Preserve
prior/new values, action type, effective date, remarks and approvals. Do not
implement payroll calculations or automatic deduction.

RENDERING
- deterministic output;
- company-brand adapter/approved letterhead asset;
- safe encoding;
- locale/timezone-correct dates;
- no missing-placeholder leakage;
- accessible PDF where the chosen rendering stack supports it;
- testable rendering service behind an interface.

TESTS
- version immutability and case pinning;
- placeholder validation and encoding;
- incorrect/missing field rejection;
- approval authorization and self-approval restriction;
- deterministic fixture/checksum expectations where practical;
- issue/supersede/correction history;
- restricted-document list/download negative tests;
- concurrent approval conflict;
- storage/scanner failure path;
- no real employee data;
- E2E generate -> preview -> approve -> issue -> supersede;
- lint/typecheck/build.

OUT OF SCOPE
- live email;
- AI-generated wording;
- full workflow engine;
- survey;
- payroll action;
- electronic-signature claims not approved by policy/legal owner.

COMMIT
feat: add controlled offboarding document generation and approvals

RETURN
Use CLAUDE.md evidence. List every active template/version and its approval
status. Confirm no unapproved wording can be issued and nothing was pushed.
Stop.
```

---

## Directive 3 — Secure post-departure exit survey

```text
DIRECTIVE 3 — SECURE EXIT SURVEY AND HR-RECORDED FEEDBACK

PRECONDITION
Directive 1 is approved. DEC-014, DEC-015 and the survey privacy/eligibility
items required by Stage 2 are approved. The notice must accurately describe
whether responses are confidential, identifiable or anonymous.

OBJECTIVE
Implement the short post-departure survey and HR-recorded verbal fallback using
a non-production notification sink. Do not connect live email.

READ
- ExitSurveySpecification.md
- Stage 2 survey/privacy/security requirements
- StateMachines.md
- MetricsDictionary.md
- DataClassificationAndRetention.md
- ThreatModel.md
- RolesAndPermissions.md

SURVEY ADMINISTRATION
1. Implement immutable survey definitions and versions.
2. Support approved question types, required/optional rules and display order.
3. Pin an invitation/response to the case, eligibility decision, survey version
   and privacy-notice version.
4. HR records eligibility, verified personal email, exclusion reason, suppression
   or reschedule with audit.
5. Default termination cases to no automatic invitation unless policy approves
   applicability.

TOKEN AND RESPONDENT FLOW
1. Generate at least 128 bits of cryptographically secure entropy.
2. Store only a secure hash, not the raw token.
3. Single-purpose, one-time, expiring token; expiry is configurable and approved.
4. Rate limit and use constant-behaviour invalid/expired responses.
5. Do not expose employee name, case status, departure reason or internal task
   information on the public route.
6. Prevent token replay and double submission under concurrency.
7. Provide mobile-responsive, keyboard-accessible review and submit flow.
8. Display approved privacy/confidentiality notice and contact route.
9. On success, invalidate the token and show a neutral confirmation.
10. Do not place token or response content in logs/analytics URLs.

SCHEDULING
- initial invitation on approved day 3 after effective departure;
- one reminder on approved day 7 only when no response and not suppressed;
- HR may suppress/reschedule with reason;
- use the application outbox/worker boundary but send only to a test/sink adapter;
- idempotency must prevent duplicate invitations/reminders.

RESPONSES
- restrict identifiable responses to approved HR roles;
- keep response text out of ordinary case/department views;
- support HR-recorded verbal debrief as a distinct response channel;
- record non-completion/delivery/exclusion outcomes;
- do not expose small-cohort analytics yet beyond safe totals.

TESTS
- eligibility and termination default;
- version/notice pinning;
- token entropy interface, hash storage, expiry, replay, brute-force rate limit,
  concurrency and neutral error response;
- day-3/day-7 calculation in America/Jamaica;
- suppression/reschedule;
- duplicate-job/idempotency;
- sink-only environment guard;
- response authorization and count leakage;
- no sensitive logs;
- mobile/keyboard/accessibility;
- E2E invitation -> sink -> submit -> replay rejected;
- lint/typecheck/build.

OUT OF SCOPE
- live email;
- AI sentiment/theme analysis;
- manager access to identifiable responses;
- anonymous promises unless approved and technically enforceable;
- Stage 6 segmented reporting.

COMMIT
feat: add secure post-departure exit feedback workflow

RETURN
Use CLAUDE.md evidence. Include token/security tests and proof that non-production
cannot send real messages. Stop.
```

---

## Directive 4 — Versioned workflow engine and case lifecycle

```text
DIRECTIVE 4 — VERSIONED WORKFLOW ENGINE AND CASE LIFECYCLE

PRECONDITION
Directives 1–3 are approved as applicable. Stage 3 workflow decisions, including
case hold/pause behaviour, are approved. Do not invent which SLA clocks pause.

OBJECTIVE
Implement the generic deterministic workflow engine, state guards and scheduling
foundation. Do not implement live integrations.

READ
- WorkflowDesign.md
- StateMachines.md
- DomainModel.md and DataModel.md
- BusinessRules.md
- Stage 3 requirements
- AuditEventCatalogue.md
- TestStrategy.md

MODEL
Implement immutable/versioned:
- workflow definitions and versions;
- task definitions and dependencies;
- workflow instances;
- task instances;
- assignments;
- due-date provenance;
- reminders/escalations;
- blockers;
- evidence;
- waivers;
- exceptions;
- transition history.

ENGINE INVARIANTS
1. Workflow creation is atomic and idempotent.
2. Cases remain pinned to the workflow version used at instantiation.
3. Definitions cannot be edited after activation; publish a new version.
4. Task states and case states follow the approved state machines.
5. Dependencies control NOT_READY -> READY.
6. Mandatory tasks cannot be cancelled or waived by an unauthorized user.
7. Waiver requires authorized role, reason, evidence where required and audit.
8. Closure integrity is evaluated by the domain service, not UI assumptions.
9. Concurrent transitions use transaction/optimistic-concurrency protection.
10. Historical timestamps are never rewritten silently.

SCHEDULING
1. Use America/Jamaica and the versioned business calendar.
2. Store due timestamp, rule/version, anchor event and calculation inputs.
3. A confirmed effective-date change produces preview, approval, recalculation
   and audit rather than silent mutation.
4. Model calendar-day, business-day and exact-timestamp rules.
5. Scheduled work is claimed safely by the separate worker.
6. Retrying after a crash cannot duplicate transitions/reminders.

CASE LIFECYCLE
Implement the authoritative progression:
DRAFT -> PENDING_HR_REVIEW -> APPROVED -> ACTIVE -> CLEARANCE_REVIEW ->
COMPLETED
and the controlled alternative states ON_HOLD, CANCELLED, VOIDED and REOPENED.

APPROVED is the single authoritative post-review case state. Do not use
APPROVED_OR_ACCEPTED: "accepted" is not valid for every departure type. It is
a resignation communication or document outcome, not a universal case-lifecycle
state. Represent resignation acceptance or acknowledgement through document
records, document approval records, document status, communication records and
communication status - never through a universal case status.

Use final names from the approved state specification in StateMachines.md; do
not rename them for convenience without updating the baseline.

UI/API
- workflow timeline;
- task list and task detail;
- transition actions with reasons;
- due/overdue/blocker indicators;
- authorized hold/resume/date-change;
- audit timeline;
- next-required-action summary.

TESTS
- every allowed and forbidden transition;
- dependency readiness;
- mandatory/optional/waiver rules;
- exact stored due provenance;
- weekend/holiday/date-change cases;
- hold/resume according to approved policy;
- idempotent instantiation;
- crash/retry and concurrent transition;
- closure integrity;
- negative authorization;
- E2E generic workflow path;
- migrations/lint/typecheck/build.

OUT OF SCOPE
- final three workflow content activation if not included in this directive;
- live notification/BambooHR;
- full asset/handover module;
- KPI reporting;
- AI.

COMMIT
feat: implement versioned offboarding workflow engine

RETURN
Use CLAUDE.md evidence. Include a state-transition and scheduling test summary.
Stop.
```

---

## Directive 5 — Three operational workflows and department queues

```text
DIRECTIVE 5 — ACTIVATE DEPARTURE WORKFLOWS AND DEPARTMENT QUEUES

PRECONDITION
Directive 4 is approved. Workflow task matrices, owners, applicability, exact
effective-time rules and termination confidentiality are approved.

OBJECTIVE
Activate the three versioned workflow templates and role-minimized work queues.

WORKFLOWS
Implement the approved versions for:
1. resignation with notice;
2. immediate resignation;
3. termination.

Use docs/architecture/WorkflowDesign.md as the task/order source. Do not force all
three branches into one universal list and do not issue resignation documents
for termination.

EXACT-TIME SECURITY CONTROL
- access-revocation due time is the approved effective separation timestamp;
- immediate resignation/termination may require immediate or explicitly scheduled
  action;
- the general 24-hour notification KPI must never postpone access removal;
- show countdown/due/overdue clearly;
- escalate through the approved operational channel;
- require completion evidence and record late reason;
- no automatic direct account disablement unless separately approved.

DEPARTMENT QUEUES
Provide:
- IT queue: minimum identity/work-account/location/effective-time/system data;
- Finance queue: approved separation/pay-workflow fields only;
- line-manager queue: handover actions only;
- HR queue: full authorized case coordination;
- auditor view: read-only evidence within scope.

A queue user must not see:
- resignation/termination letter contents unless required;
- identifiable survey feedback;
- rehire eligibility;
- unrelated HR notes;
- other restricted cases;
- broad counts that leak a restricted termination.

TASK OPERATIONS
- assignment/reassignment;
- acknowledge/start;
- block with structured reason;
- attach/record safe evidence;
- complete;
- request waiver where allowed;
- reminder and escalation;
- overdue ageing;
- manual external completion evidence.

TERMINATION
- restricted by default;
- preparation visibility only to explicit participants;
- coordinated activation at approved time;
- no premature broad queue item;
- termination-specific document/task applicability.

TESTS
- full synthetic execution of all three workflows;
- task matrices, dependencies and applicability;
- exact-time scheduling under worker restart and clock boundary;
- unauthorized queue/list/count/search tests;
- restricted termination before and after effective time;
- reassignment/blocker/escalation/waiver;
- document and survey applicability per departure type;
- completion gate;
- E2E for each workflow;
- lint/typecheck/build.

OUT OF SCOPE
- direct account revocation;
- live email/provider integration;
- final-pay calculation;
- assets/handover depth handled by Directive 6;
- AI.

COMMIT
feat: activate offboarding workflows and department work queues

RETURN
Use CLAUDE.md evidence. Include a matrix of workflow tasks actually activated and
proof of minimal departmental visibility. Stop.
```

---

## Directive 6 — Assets, handover and clearance

```text
DIRECTIVE 6 — ASSET RECOVERY, HANDOVER AND CLEARANCE

PRECONDITION
Directive 5 is approved. Asset catalogue/source rules, disposition/waiver
authority and handover scope are approved.

OBJECTIVE
Create trustworthy asset disposition and handover evidence, then enforce final
clearance without automating pay action.

READ
- AssetRecoverySpecification.md
- HandoverSpecification.md
- Stage 4 requirements
- WorkflowDesign.md
- RolesAndPermissions.md
- AuditEventCatalogue.md

ASSETS
1. Support a versioned standard catalogue and employee-specific issued assets.
2. Record source, identifier, expected return date, responsible receiver and
   applicability.
3. Required final dispositions:
   RETURNED, NOT_ISSUED, LOST, DAMAGED, WAIVED or UNRESOLVED using final approved
   enum names.
4. Capture received by/time, condition, remarks and evidence as appropriate.
5. Keep disposition documentation separate from physical recovery KPI.
6. Reminders/follow-up are idempotent and suppressible with reason.
7. Lost/damaged/unresolved items create controlled exceptions.
8. Do not create a payroll deduction, final-pay hold or entitlement adjustment.
   Route any decision to authorized HR/Finance outside the automated path.
9. Record waivers/write-offs only with approved authority and audit.

HANDOVER
1. Implement plan and item types for duties, open tasks, customer/vendor matters,
   document locations, temporary/replacement owner, training sessions and risks.
2. Provide prominent instruction not to enter passwords, secrets, tokens or
   confidential credentials.
3. Allow a line manager to update only assigned handover content.
4. Require manager attestation and HR review where approved.
5. Support not-applicable/waived items with reason.
6. Keep handover content out of IT/Finance queues unless explicitly assigned.

CLEARANCE
- case may enter CLEARANCE_REVIEW only when mandatory workflow conditions are met;
- completion requires all mandatory tasks completed/validly waived and every
  required asset has an approved final disposition;
- unresolved exceptions require authorized disposition;
- HR Manager performs completion approval;
- completion and reopening create audit history;
- reopening never deletes prior clearance evidence.

TESTS
- asset source/manual item and duplicate prevention;
- every disposition and required evidence;
- 100% disposition gate vs recovery-rate calculation;
- no-pay-side-effect regression test;
- waiver authorization;
- reminder idempotency;
- handover row/record authorization;
- secret-warning and safe logging;
- clearance block/complete/reopen;
- E2E asset/handover/clearance;
- lint/typecheck/build.

COMMIT
feat: add asset disposition handover and clearance controls

RETURN
Use CLAUDE.md evidence. Explicitly prove there is no automated pay modification
path. Stop.
```

---

## Directive 7 — Reliable notification outbox and non-production dispatch

```text
DIRECTIVE 7 — CONTROLLED NOTIFICATION OUTBOX AND WORKER

PRECONDITION
Prior workflow/document stages are approved. Notification templates, owners,
recipient rules and approval model are approved. Live provider credentials are
not required for this directive.

OBJECTIVE
Implement reliable, approved, idempotent notification orchestration using only a
non-production sink/test adapter.

READ
- DocumentAndNotificationDesign.md
- IntegrationStrategy.md
- ControlledCommunicationTemplates.md
- Stage 5 notification requirements
- StateMachines.md
- ThreatModel.md

NOTIFICATION MODEL
Implement immutable template/version and notification records with:
- type/purpose;
- case/workflow reference;
- approved recipients and recipient source;
- minimum data fields;
- subject/body snapshot;
- classification;
- creator/approver;
- scheduled time;
- status;
- idempotency key;
- attempts/provider result;
- manual fallback/reconciliation;
- cancellation/supersession.

Use the approved status model:
DRAFT -> PENDING_APPROVAL -> APPROVED -> SCHEDULED/QUEUED -> SUBMITTED,
FAILED, CANCELLED and delivery/bounce states where evidence exists.

APPROVAL AND PRIVACY
- recipient and content preview before approval;
- maker-checker for sensitive/external messages;
- validate applicability for Sagicor/NCB;
- no reason-for-leaving, survey text or unapproved fields;
- recipient configuration is versioned and change-controlled;
- approved notification must use a content snapshot so later template edits do
  not alter it.

TRANSACTIONAL OUTBOX
1. Business state and outbox creation occur in one database transaction.
2. Worker claims records safely and supports retries/backoff.
3. Logical idempotency key prevents duplicate send across retry/restart.
4. Distinguish transient and permanent failure.
5. Dead-letter/failed records remain visible and actionable.
6. Cancellation rules prevent a queued obsolete message from dispatching.
7. Provider acceptance is SUBMITTED, not proof of delivery.
8. Manual send records recipient, time, actor and evidence then reconciles state.
9. In-flight message state survives worker restart.
10. Operational logs contain IDs/status only, not full sensitive bodies.

ENVIRONMENT SAFETY
- default provider is sink/file/test mailbox;
- startup guard rejects real provider in test/development unless an explicit
  approved staging setting exists;
- BASELINE measurement-cohort records cannot send externally, and neither can
  TRAINING or TEST record-purpose records;
- provide a visible environment/no-send indicator.

TESTS
- transaction rollback/outbox atomicity;
- duplicate job and crash at each dispatch boundary;
- idempotency;
- transient/permanent failure/backoff/dead-letter;
- cancellation and obsolete effective-date message;
- recipient/applicability/minimum-field checks;
- approval authorization;
- provider acceptance vs delivery status;
- manual fallback reconciliation;
- no-send/cohort/environment guards;
- PII-safe logs;
- E2E approve -> sink submit -> failure/retry;
- lint/typecheck/build.

OUT OF SCOPE
- live Microsoft Graph or other production provider;
- BambooHR;
- AI drafting;
- automated external delivery claims.

COMMIT
feat: add reliable approved notification outbox

RETURN
Use CLAUDE.md evidence. Include crash/idempotency test results and prove the
environment cannot send real email. Stop.
```

---

## Directive 8 — Approved production integrations

```text
DIRECTIVE 8 — IDENTITY, EMAIL, BAMBOOHR, STORAGE AND SCANNER INTEGRATIONS

PRECONDITION
Directive 7 is approved. IT, HR and Privacy have approved:
- production identity provider and claims;
- hosting/data locations;
- email provider/mailbox and least-privilege permissions;
- BambooHR field map and company-controlled integration identity;
- Sagicor/NCB recipient and minimum field sets;
- object storage and malware-scanner design;
- secrets/rotation ownership;
- cross-border/processor assessment where applicable.

Do not proceed with an unapproved production integration. Implement unaffected
adapters only and stop at the blocker.

OBJECTIVE
Replace approved adapter stubs with production-ready integrations while
preserving safe fallbacks and reconciliation.

IDENTITY
- OIDC/SAML adapter according to approved provider;
- verify issuer, audience, signature, nonce/state and time;
- map stable identity/group claims to application roles;
- no auto-grant of HR access from email domain alone;
- role removal/session revocation behaviour;
- MFA remains enforced by approved identity policy;
- emergency/break-glass access only if approved and audited.

EMAIL
- implement provider adapter with least-privilege permissions;
- use company-owned sending mailbox;
- preserve SUBMITTED vs DELIVERED distinction;
- capture safe provider IDs/status;
- process bounce/delivery signals only where trustworthy;
- retry only safe/transient cases;
- never log access tokens or message bodies;
- sandbox/staging recipient override before production enablement.

BAMBOOHR
- use a company-controlled service identity/OAuth application, never an ordinary
  employee's personal API key;
- begin with approved read-only lookup/snapshot;
- field allow-list and source timestamp;
- timeout/retry/circuit behaviour;
- reconciliation dashboard for missing/stale/mismatched records;
- manual fallback;
- webhook only if separately approved:
  verify signature/timestamp, reject replay, idempotently process and monitor
  permission/identity health;
- do not perform broad employee write-back in this directive.

STORAGE/SCANNER
- private objects, encryption, random object keys and least privilege;
- signed/authorized download path;
- quarantine before availability;
- scanner clean/reject/timeout/unavailable behaviour;
- checksum/integrity verification;
- retention/legal-hold integration hooks;
- backup/restore consistency.

CONFIGURATION AND SECRETS
- secret manager/environment injection, no repository secrets;
- startup validation;
- rotation runbook;
- environment-specific recipient and endpoint allow-lists;
- integration health without exposing PII;
- controlled feature enablement and rollback.

TESTS
- official-contract fixtures and staging/sandbox smoke tests;
- identity forged/expired/wrong-audience/role-revocation;
- email accepted/transient/permanent/bounce/duplicate;
- BambooHR permission denied/stale/timeout/identity deactivation;
- webhook spoof/replay if implemented;
- storage unauthorized/path/content-type/hash/scanner failure;
- secret/log scan;
- manual fallback and reconciliation;
- no production personal data in test evidence;
- lint/typecheck/build.

PRODUCTION ENABLEMENT
Do not enable real dispatch/sync merely because code exists. Record a separate,
two-person configuration review and explicit environment activation.

COMMIT
feat: integrate approved offboarding identity mail and employee sources

RETURN
Use CLAUDE.md evidence. List permissions/scopes, environments called, synthetic
test identities and all live features that remain disabled. Stop.
```

---

## Directive 9 — KPI, exception and control reporting

```text
DIRECTIVE 9 — CONTROL REPORTING, EXCEPTIONS AND PRIVACY-SAFE ANALYTICS

PRECONDITION
Operational data exists and Metric Dictionary definitions are approved.
Small-cohort threshold and survey-report rules are approved before segmented
exit-feedback reporting.

OBJECTIVE
Implement transparent, reconcilable reports that expose failures rather than
creating attractive but ambiguous percentages.

READ
- MetricsDictionary.md
- Stage 6 report requirements
- DataClassificationAndRetention.md
- RolesAndPermissions.md
- PilotAndRolloutPlan.md
- DMAIC control-plan mapping in DMAIC_Source_Analysis.md

METRIC ENGINE
Implement approved calculations for:
- case capture compliance;
- letter turnaround/compliance;
- document field accuracy;
- notification timeliness;
- notification accuracy;
- exact-time access revocation;
- asset disposition documentation;
- physical asset recovery;
- exit-feedback completion;
- workflow completeness;
- overdue-step rate;
- end-to-end cycle time;
- case volume.

For every metric show:
- numerator;
- denominator;
- exclusions;
- reporting period;
- cohort;
- target;
- data freshness;
- count as well as percentage;
- link to authorized exception detail.

Use stored event timestamps and the approved business calendar. Do not infer
critical events from current status alone.

DASHBOARDS
- HR operational dashboard;
- exception feed with owner, age, severity and next action;
- baseline vs pilot vs post-rollout comparison;
- upcoming effective departures and exact-time IT exposure;
- documents/notifications/access/assets/survey/control views;
- monthly control report;
- data-quality/missing-source report.

PRIVACY AND AUTHORIZATION
- department users see only their tasks/metrics;
- auditors receive approved read-only evidence;
- identifiable survey responses stay restricted;
- apply small-cohort suppression/combination;
- prevent drill-through, export or totals from revealing suppressed groups;
- controlled export with purpose, filters, row count, classification, actor and
  audit event;
- protect restricted termination counts.

VALIDATION
Create hand-calculated synthetic fixtures for each KPI, including:
- zero denominator;
- excluded/ineligible case;
- late access task;
- provider accepted but bounced;
- asset not issued;
- baseline case;
- reopened case;
- weekend/holiday;
- suppressed cohort.

TESTS
- formula fixtures reconcile exactly;
- timezone/calendar boundaries;
- cohort and exclusion filters;
- role/record authorization;
- restricted count leakage;
- suppression and no drill-through/export bypass;
- export audit and formula-injection protection;
- report query performance over synthetic long-term volume;
- E2E exception -> authorized detail -> action;
- lint/typecheck/build.

OUT OF SCOPE
- external BI warehouse;
- AI theme/sentiment generation;
- unapproved predictive analytics;
- ranking departments without context.

COMMIT
feat: add auditable offboarding controls and reporting

RETURN
Use CLAUDE.md evidence. Include a KPI reconciliation table with expected vs
actual synthetic values. Stop.
```

---

## Directive 10 — Hardening, UAT and pilot readiness

```text
DIRECTIVE 10 — SECURITY HARDENING, UAT AND PILOT READINESS

PRECONDITION
All release-scope directives are approved. Production owners, retention policy,
incident process, availability/recovery objectives, browser matrix and pilot
scope are approved.

OBJECTIVE
Produce a release candidate and evidence package. Do not declare production
approval on behalf of stakeholders.

READ
- SecurityVerificationChecklist.md
- ThreatModel.md
- DefinitionOfDone.md
- PilotAndRolloutPlan.md
- ManualFallbackAndBusinessContinuity.md
- SupportAndIncidentManagement.md
- RiskRegister.md
- TestStrategy.md

HARDENING
1. Complete the ASVS-aligned checklist for implemented scope.
2. Run dependency, secret, SAST and DAST checks with reviewed findings.
3. Execute full authorization/IDOR matrix.
4. Review session, CSRF, XSS, headers, uploads, tokens, webhooks, exports,
   redirects and rate limits.
5. Verify PII-safe logs, observability access and audit completeness.
6. Run accessibility automated and manual checks against WCAG 2.2 AA target.
7. Run performance/resilience tests appropriate to low operational volume.
8. Verify configuration, feature flags, no-send safeguards and recipient review.
9. Test backup and restore for database and objects, including consistency.
10. Execute manual fallback and incident tabletop.
11. Verify retention/legal-hold jobs in dry-run and approved staging mode.
12. Review company ownership of repo, credentials, runbooks and secondary owner.

UAT
- prepare synthetic scenarios from PilotAndRolloutPlan.md;
- record tester, expected result, actual result, defect and approval;
- include HR, IT, Finance, manager, auditor, privacy officer, admin and
  survey respondent;
- retest all fixed critical/high defects;
- maintain known-limitations register.

PILOT READINESS PACKAGE
Create/update:
- release notes;
- environment/configuration inventory without secrets;
- deployment and rollback runbook;
- backup/restore evidence;
- support contacts and severity matrix;
- training/job aids;
- UAT report;
- security/privacy/accessibility report;
- risk residuals;
- traceability/coverage report;
- pilot monitoring dashboard;
- formal go/no-go checklist.

RELEASE GATES
Block recommendation when:
- Critical defect or control failure remains;
- unauthorized restricted-data access is possible;
- exact-time access-removal path is unreliable;
- notification duplication/incorrect-recipient control fails;
- restore/fallback cannot be demonstrated;
- required retention/privacy/operations owner is absent;
- OPEN decision controls enabled production behaviour.

TESTS
Run the complete CI and release suite and report exact commands/results. Do not
hide flaky or skipped tests. Justify every exclusion.

COMMIT
chore: harden HR offboarding platform for controlled pilot

RETURN
Use CLAUDE.md evidence plus:
- unresolved defects by severity;
- accepted residual risks and approvers;
- UAT sign-off status;
- backup/restore result;
- go/no-go recommendation as technical evidence only;
- explicit confirmation that sponsor/HR still control production approval.
Do not push. Stop.
```

---

## Directive discipline

- Do not paste multiple directives in one Claude turn.
- Do not let Claude continue because a previous stage “looked fine.”
- Review code, tests, migrations, security implications and commit before the next stage.
- A change in approved behaviour must pass through `ChangeControl.md`.
- Keep live integrations and optional AI disabled until their specific approvals and directives.
