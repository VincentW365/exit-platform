# DMAIC Source Analysis

## 1. Source reviewed

**Document:** `DMAIC HR Offboarding Process`
**Length:** 27 pages
**Prepared/completed in source:** June–July 2026
**Purpose:** Analyze the current employee offboarding process and propose automation, digital tracking, exit-feedback, asset and notification improvements.

The source was reviewed as both text and rendered pages, including the process-flow diagram, dashboard concept, Employee Action Form, resignation-acceptance example, Outlook notification screenshots, and asset-return checklist.

## 2. What the DMAIC establishes well

### 2.1 Clear problem pattern

Pages 4–6 identify a coherent group of failures:

- manual paper/email hand-offs;
- individually drafted letters and department emails;
- no central end-to-end case view;
- weak audit evidence;
- near-zero exit-feedback completion for immediate resignations;
- poor data capture and historical retrieval;
- asset-recovery risk.

These are mutually reinforcing rather than isolated problems. A missing workflow causes missed steps, inconsistent documents, poor measurement and weak accountability.

### 2.2 Appropriate process branches

The process map on pages 10 and 21 distinguishes:

1. resignation with notice;
2. immediate resignation;
3. termination.

This is the correct starting point, but the map merges them too early and does not define the materially different confidentiality, document, access-removal, survey and approval rules. The product baseline retains the three branches throughout the workflow.

### 2.3 Useful control objectives

Pages 8–9 and 13–16 provide practical targets and reaction concepts:

- case/processing timestamps;
- letter turnaround within two business days;
- notifications within 24 hours;
- asset documentation;
- survey completion;
- pilot exit criteria;
- monthly control review;
- fallback and escalation.

The source correctly recognizes that the current metrics do not yet have reliable baselines.

### 2.4 Valuable appendices

The appendices provide operational evidence:

- page 23 shows the existing Employee Action Form and approval structure;
- page 24 shows the type of resignation acknowledgement currently issued;
- pages 25–26 show current Outlook-based notifications to IT and external providers;
- page 27 shows the current asset checklist and item types.

These artefacts are useful for field and template discovery, but they contain personal information and must not be reused as test data or committed to the product repository.

## 3. Critical contradictions and ambiguities

| ID | Source issue | Consequence if Claude guesses | Resolution in this baseline |
| --- | --- | --- | --- |
| SRC-001 | Knowledge transfer appears in both in-scope and out-of-scope lists on page 6. | The feature may be omitted or partially implemented. | `DEC-001`: configurable handover module, provisionally in scope. |
| SRC-002 | Page 8 calls baseline capture a prerequisite, while page 12 schedules quick wins during baseline. | Baseline and improved performance could be mixed. | `DEC-007`: baseline feature mode and explicit cohorts. |
| SRC-003 | Pages 9 and 12 call for AI-generated/sent messages, while page 16 calls for human sign-off. | Unsafe or inconsistent communication control. | `DEC-004` and `DEC-005`: controlled templates and human approval. |
| SRC-004 | Resignation and termination converge to the same downstream flow. | A termination may receive resignation wording or excessive disclosure. | `DEC-003` and `DEC-035`: separate workflow/document/confidentiality rules. |
| SRC-005 | General 24-hour notification target conflicts with urgent access removal. | Former users may retain access after separation. | `DEC-006`: exact effective-time task and urgent escalation. |
| SRC-006 | “100% asset recovery documentation” and “100% assets returned” are treated as one objective. | Performance becomes misleading and closure may block indefinitely. | `DEC-008`: separate documentation and physical recovery KPIs. |
| SRC-007 | Page 15 suggests reviewing whether to hold final pay for assets, despite payroll redesign being out of scope. | The app could implement a legally/policy-sensitive deduction rule. | `DEC-009`: exception only; no automatic pay action. |
| SRC-008 | Employee portal, email bot and HR intake are presented as alternatives without a decision. | Scope, security and identity design become unstable. | `DEC-002`: HR-led MVP; self-service/mail ingestion deferred. |
| SRC-009 | Survey confidentiality/anonymity is undefined. | Users may make promises the system cannot keep or expose feedback. | `DEC-011`, `DEC-015`, `DEC-024`. |
| SRC-010 | NCB and Sagicor notifications appear universal. | Non-participants may be disclosed unnecessarily. | `DEC-016` and `DEC-017`: applicability and minimum fields. |
| SRC-011 | “Acceptance” is not defined for immediate resignation or termination. | SLA triggers and documents become inconsistent. | Business rules distinguish receipt, HR approval, document issue and effective separation. |
| SRC-012 | Business-day computation has no calendar or timezone. | SLA reports vary between users/implementations. | `DEC-027`: America/Jamaica and configurable holidays. |
| SRC-013 | The Employee Action Form is proposed for digitization while structural change is out of scope. | Approval hierarchy may be accidentally redesigned. | `DEC-010`: preserve authority; digitize only. |
| SRC-014 | “Notification accuracy” is used in pilot criteria but not precisely defined. | A message could be timely but wrong and still count as success. | KPI-004 and KPI-005 separate timeliness and accuracy. |
| SRC-015 | The source has no case, task, document, notification or exception state definitions. | Claude may create ad hoc booleans that are hard to audit. | Explicit state machines and invariants. |
| SRC-016 | Retention and third-party sharing are recognized but not specified. | Production may over-retain, delete too early or share too much. | Privacy baseline and open retention/data-sharing decisions. |
| SRC-017 | The source identifies single-developer risk but not support governance. | The product may remain dependent on one person. | `DEC-028`, support and handover runbooks. |

## 4. Missing product requirements identified

The DMAIC is a process-improvement document, not a complete software specification. The following areas had to be added:

### Identity and authorization

- production SSO/MFA decision;
- least-privilege roles;
- record-level case restrictions;
- termination confidentiality;
- separation between technical administration and HR content;
- controlled break-glass access.

### Data and audit

- immutable employee snapshot;
- source-of-truth mapping;
- case/task/document/notification histories;
- correction and supersession rules;
- access/download/export audit;
- UTC storage and Jamaica business time.

### Workflow reliability

- versioned workflow definitions;
- dependencies, readiness, blockers, waivers and escalation;
- idempotency;
- date-change impact;
- closure integrity;
- feature flags for baseline measurement.

### Communications

- template versions and placeholders;
- approval state;
- outbox and retry model;
- duplicate prevention;
- submitted versus delivered evidence;
- manual fallback;
- minimum external disclosure.

### Privacy and security

- data classification and minimization;
- secure file upload;
- token security;
- retention/legal hold capability;
- cross-border/processor assessment;
- incident evidence;
- ASVS and WCAG release criteria.

### Operations

- hosting/identity/integration ownership;
- backup/restore;
- monitoring and support;
- downtime procedures;
- pilot and rollback;
- product governance after rollout.

## 5. Source-to-product interpretation by DMAIC phase

### Define — pages 4–7

The product must address the validated business problem, not merely digitize paper. The RACI informs role design, but the application uses role names rather than personal names. The process owner remains HR; IT and Finance are task responders, not broad case users.

### Measure — pages 8–9

The first usable release must capture receipt, issue, completion, asset and survey timestamps. Baseline data must be segregated from pilot and post-rollout data. Every KPI needs a formula and exclusions.

### Analyze — pages 10–11

The two validated root causes are treated as design anchors:

1. no system-enforced workflow;
2. an ill-timed, paper-based exit interview.

The solution therefore prioritizes deterministic workflow enforcement and a short post-departure survey.

### Improve — pages 12–13

The quick-win sequence is retained but reframed:

1. controlled letter generation;
2. secure short survey;
3. workflow/task engine;
4. asset/handover;
5. reliable notifications/integrations;
6. reporting/control automation.

The “AI bot” is not the system core. Approved templates and rules solve the stated problem more safely.

### Control — pages 14–17

The control plan becomes:

- automated exception rules;
- explicit task and notification SLAs;
- metric dictionary;
- reaction workflows;
- manual fallback;
- audit evidence;
- monthly control reports;
- production support and security reviews.

### Suggested features — pages 18–19

The proposed dashboard concept is useful for content hierarchy: KPI cards, active cases and exception feed. The dark visual style is not binding. The final UX uses a professional, accessible, mostly light internal application with Bert's-inspired navy/blue/yellow accents.

## 6. Privacy handling of appendices

The source appendices contain names, address details, email identities, signatures and images. These are not required to design the product. The baseline uses generic placeholders such as:

- `{{employee_full_name}}`
- `{{employee_number}}`
- `{{confirmed_last_working_date}}`
- `{{effective_separation_at}}`
- `{{department}}`
- `{{location}}`

The original source should be stored in an approved private business repository, not in the application source repository.

## 7. Recommended source authority rule

The DMAIC remains the primary process source. When it is ambiguous or contradictory:

1. an approved Decision Register entry resolves the issue;
2. the approved requirement/business rule becomes implementation authority;
3. the source remains cited for traceability;
4. Claude must not re-open a resolved decision without presenting new evidence.
