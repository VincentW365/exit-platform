# Product Requirements Document (PRD)

## 1. Document control

| Field | Value |
| --- | --- |
| Product | Employee Offboarding Web Application |
| Organization | Bert's Auto Parts Ltd. |
| Version | 0.1 |
| Date | 2026-07-28 |
| Status | Proposed baseline pending stakeholder approvals |
| Source | Employee Offboarding DMAIC and approved Decision Register |
| Product owner | Business Analyst / designated product owner |
| Process owner | HR Manager |
| Technical owner | To be assigned before pilot |

## 2. Executive summary

The product replaces a fragmented paper/email offboarding process with one controlled case, workflow and evidence trail. It coordinates HR, IT, Finance and line-manager work without exposing the entire HR record to every participant. It supports controlled documents and notifications, asset dispositions, handover, short post-departure feedback, exceptions and management reporting.

The application is not a payroll engine, legal decision system or autonomous AI agent. It records approved HR decisions and executes deterministic rules. Optional AI assistance is deferred until privacy/security review and always remains subject to human approval.

## 3. Users and needs

| User | Primary need | Data boundary |
| --- | --- | --- |
| HR_MANAGER | Accountable process owner and approval authority. | Cannot alter immutable audit events; cannot bypass mandatory controls without recorded override authority and reason. |
| HR_OFFICER | Executes day-to-day offboarding work. | Cannot approve own restricted communications, close cases requiring manager sign-off, change retention policy, or grant roles. |
| IT_RESPONDER | Performs access and technology-asset tasks. | No access to resignation letters, reasons, pay details, identifiable survey responses, or unrelated cases. |
| FINANCE_RESPONDER | Performs final-pay and finance clearance tasks. | No access to exit feedback, unrestricted HR notes, or technology/access details. |
| LINE_MANAGER | Completes handover, duty reassignment, and manager confirmations. | No access to confidential exit responses, HR-only reasons, rehire eligibility, pay details, or termination preparation unless explicitly authorized. |
| AUDITOR | Performs read-only assurance and control reviews. | Identifiable exit free text and restricted termination content are masked unless separately authorized; no operational changes. |
| PRIVACY_OFFICER | Reviews data protection, access, retention, breach, and data-subject matters. | No routine operational edits except privacy workflows; cannot change HR decisions. |
| SYSTEM_ADMIN | Maintains technical configuration and platform availability. | No default access to HR case content. Break-glass access requires explicit approval, time limitation, reason, and enhanced audit. |

A departing employee is a limited survey respondent, not an internal application user.

## 4. Product outcomes

### Operational outcomes

- every departure is captured promptly;
- required tasks are generated from the correct workflow;
- owners, due dates, blockers and escalations are visible;
- access removal is coordinated to the exact effective time;
- documents and notices are consistent, approved and traceable;
- each asset reaches a documented disposition;
- cases cannot close with unapproved missing work;
- manual fallback remains auditable.

### Management outcomes

- baseline and post-change performance are comparable;
- HR can see cycle time, exceptions, accuracy, survey completion and asset outcomes;
- risk and bottleneck trends are visible by workflow, location and department;
- controls can be independently audited.

### Employee/privacy outcomes

- communications are accurate and professional;
- survey access does not require an internal account;
- sensitive feedback is protected;
- third parties receive only necessary fields;
- access, retention and disclosure are controlled and evidenced.

## 5. Functional modules

### 5.1 Identity and access

- production SSO through the approved identity provider;
- roles, record-level restrictions and minimal departmental views;
- restricted termination cases;
- separate permissions for identifiable exit feedback;
- audited role grants and break-glass access.

### 5.2 Employee source and case management

- employee lookup and source status;
- HR-led case creation;
- employee snapshot;
- receipt and effective timestamps;
- departure type and workflow selection;
- attachments, notes, classification and owner;
- duplicate warning;
- case lifecycle, hold, cancellation, void and reopening;
- baseline/pilot/post-rollout cohort.

### 5.3 Workflow and tasks

- versioned workflow definitions;
- separate departure workflows;
- dependencies, conditional tasks and parallel branches;
- business-day and exact-time deadlines;
- department queues;
- blockers, evidence, waivers, reminders and escalation;
- audited date changes;
- closure-integrity gate.

### 5.4 Documents and approvals

- approved versioned templates;
- typed placeholders and source mapping;
- validation and preview;
- maker-checker approval;
- PDF and optional controlled DOCX output;
- issue, correction, supersession and access audit;
- departure-specific document types.

### 5.5 Notifications

- versioned notification templates and recipient configuration;
- applicability rules;
- human approval for sensitive/external sends;
- scheduled outbox dispatch;
- idempotency, retry and attempt history;
- submitted versus delivered evidence;
- failures, bounces, manual fallback and reconciliation.

### 5.6 Assets and clearance

- asset type catalogue and employee-issued assets;
- case checklist and expected return dates;
- final disposition, receiver, condition and evidence;
- reminders, waivers and high-risk exceptions;
- separate documentation and physical recovery reporting;
- no automatic payroll action.

### 5.7 Handover

- configurable workflow module;
- duties, open work, owners, document locations, sessions and risks;
- manager attestation;
- no passwords/secrets;
- immediate-departure reconstruction workflow.

### 5.8 Exit feedback

- versioned short survey;
- eligibility and personal contact verification;
- one-time expiring token;
- day-3 invitation and day-7 reminder;
- online, HR interview and verbal debrief channels;
- privacy notice;
- restricted identifiable responses;
- aggregate reporting with small-cohort protection.

### 5.9 Reporting and exceptions

- HR dashboard and departmental task queues;
- active cases, upcoming departures and next action;
- consolidated exception feed;
- KPI reports using an approved metric dictionary;
- baseline/pilot/post-rollout comparison;
- role-aware exports and sensitive-access reporting.

### 5.10 Administration and operations

- workflow/template/settings versioning;
- business calendar;
- departments, locations, taxonomies, asset types and recipients;
- feature flags;
- integration/worker health;
- audit viewer;
- retention/legal hold capability;
- backup, restore, fallback and incident runbooks.

## 6. Initial workflow summary

### Resignation with notice

1. HR captures and approves the case.
2. employee data and date/notice details are validated.
3. acknowledgement/acceptance document is generated, approved and issued.
4. departmental, asset and handover tasks are created.
5. IT access removal is scheduled for the confirmed effective time.
6. Finance/benefits tasks and applicable provider notifications proceed.
7. feedback route is scheduled.
8. clearance integrity is reviewed and approved.

### Immediate resignation

1. urgent HR review confirms the effective time.
2. IT receives an immediate/exact-time access task.
3. acknowledgement documentation is issued.
4. asset location/recovery, Finance and provider tasks proceed.
5. manager reconstructs handover where necessary.
6. eligible survey is sent post-departure.
7. exceptions are resolved and clearance approved.

### Termination

1. restricted preparation and approvals occur on a need-to-know basis.
2. exact effective time and coordinated access removal are confirmed.
3. termination-specific documents are issued.
4. minimum necessary department tasks are released.
5. assets, Finance and applicable provider work proceed.
6. survey is created only if approved policy says eligible.
7. HR performs restricted clearance review and completion.

## 7. Business rules

The authoritative rule set is `BusinessRules.md`. High-impact rules include:

- no workflow starts from a DRAFT case;
- no case completes with an unmet mandatory closure condition;
- no sensitive external message bypasses approval in MVP;
- no provider acceptance is represented as delivery without evidence;
- no asset outcome directly alters pay;
- no new template/workflow version rewrites an existing case;
- no ordinary hard deletion;
- no employee data in non-production;
- no AI processing before approved privacy/security assessment.

## 8. Data requirements

Core data classes:

- identity, role and assignment;
- employee source record and immutable snapshot;
- case and status history;
- workflow/task definitions and instances;
- approvals and evidence;
- documents/files;
- notifications/attempts/recipients;
- asset items/dispositions;
- handover items;
- survey definitions/invitations/responses;
- exceptions/waivers;
- audit and integration events;
- business calendar and retention policy.

See `DataDictionary.md`, `DomainModel.md` and `DataModel.md`.

## 9. Non-functional requirements

- modular monolith and separate worker;
- PostgreSQL transactional integrity;
- strict TypeScript and runtime validation;
- secure, observable, supportable and testable;
- WCAG 2.2 Level AA target;
- OWASP ASVS 5.0.0 verification baseline;
- UTC storage and America/Jamaica business time;
- graceful degradation when integrations fail;
- configurable file limits;
- tested backup/restore;
- company-owned repository, credentials and documentation.

## 10. Reporting and metrics

The product shall implement the formulas in `MetricsDictionary.md`, not derive informal dashboard percentages. Reports must expose enough context to understand:

- numerator;
- denominator;
- exclusions;
- cohort;
- date range;
- workflow/version;
- data-as-of time.

## 11. MVP acceptance

The MVP is not accepted merely because screens exist. At minimum:

- Stage 1 authorization, audit and baseline capture work end-to-end;
- no unauthorized role can enumerate or view restricted cases;
- case timestamps support valid baseline metrics;
- feature flags prevent live automation in baseline/non-production;
- controlled document and survey flows pass required tests;
- the workflow engine prevents skipped mandatory tasks;
- urgent IT tasks use exact timestamps;
- assets cannot be closed without a disposition;
- notification retries/idempotency/manual fallback work;
- reports use metric definitions;
- security, accessibility, backup/restore and UAT gates pass;
- open decisions that affect production are closed.

## 12. Deferred opportunities

- employee self-service resignation submission;
- controlled mailbox ingestion and document extraction;
- AI-assisted field extraction/drafting;
- direct revocation integrations for individual systems;
- payroll write-back;
- historical file migration;
- advanced de-identified theme analysis;
- mobile native application.

Each deferred feature requires a change request and updated threat/privacy assessment.
