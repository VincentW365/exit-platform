# Stage 1 Implementation Constraints

**Baseline version:** 0.1
**Recorded:** 2026-07-28
**Source:** Directive 0.1, section G
**Applies to:** Stage 1 / Directive 1 only

## 1. What this document is — and is not

This document records **reversible, non-production engineering constraints**. It exists so that Stage 1 foundation work can proceed without pretending that named stakeholders have formally approved unresolved business or production decisions.

Read these five statements as binding:

1. This is a reversible non-production engineering constraint.
2. **It is not production approval.**
3. **It does not change any OPEN or PROVISIONAL decision to APPROVED.** Every decision status in `DecisionRegister.md` remains exactly as recorded there.
4. Pilot and production use remain prohibited until the named decision owners approve the relevant decisions.
5. A constraint may be withdrawn or overridden by the decision owner at any time. Where a constraint and a later approved decision conflict, the approved decision wins and the implementation must be corrected.

Nothing in this document authorizes checking an approval box in `StakeholderApprovalChecklist.md`.

## 2. Absolute prohibitions during Stage 1

The following remain prohibited for the whole of Stage 1, regardless of any constraint below:

- real employee data;
- live identity;
- live email;
- live BambooHR;
- live external-provider integration;
- live object storage;
- production hosting;
- production deployment;
- production credentials;
- production secrets;
- external AI processing of employee information.

## 3. Constraint register

Each constraint names the decision it works around. The decision's status is unchanged.

| Constraint | Decision | Topic | Decision status | Decision owner |
| --- | --- | --- | --- | --- |
| IC-S1-001 | DEC-001 | Knowledge transfer scope | PROVISIONAL | Project Sponsor / HR Manager |
| IC-S1-002 | DEC-002 | MVP case initiation | PROVISIONAL | Project Sponsor / HR Manager |
| IC-S1-003 | DEC-003 | Departure workflow variants | PROVISIONAL | HR Manager |
| IC-S1-004 | DEC-007 | Baseline measurement | PROVISIONAL | Project Sponsor / HR Manager |
| IC-S1-005 | DEC-021 | Production identity provider | **OPEN** | IT / Security |
| IC-S1-006 | DEC-022 | Deployment environment | **OPEN** | IT / Project Sponsor |
| IC-S1-007 | DEC-027 | Business-day calendar | PROVISIONAL | HR Manager |
| IC-S1-008 | DEC-031 | Reason-for-leaving taxonomy | **OPEN** | HR Manager / Process Analyst |
| IC-S1-009 | DEC-032 | Rehire eligibility | PROVISIONAL | HR Manager |
| IC-S1-010 | DEC-033 | Historical migration | **OPEN** | Project Sponsor / HR Manager |
| IC-S1-011 | DEC-035 | Termination confidentiality | PROVISIONAL | HR Manager / Privacy Officer |

---

### IC-S1-001 / DEC-001 — Handover

- Keep the handover module in the product architecture.
- Do **not** implement its functional module in Directive 1.
- Later workflow activation must remain configurable by departure type.
- Do not remove the module merely because the DMAIC lists knowledge transfer in both its in-scope and out-of-scope sections.
- Formal scope approval remains required before workflow activation.

### IC-S1-002 / DEC-002 — Case initiation

- Stage 1 supports HR-created cases only.
- Employee self-service remains deferred.
- Employee resignation upload remains deferred.
- Automatic mailbox ingestion remains deferred.
- AI email ingestion remains deferred.
- Do not expose an unauthenticated case-creation route.
- Do not expose an employee portal in Stage 1.

### IC-S1-003 / DEC-003 — Workflow variants

Preserve a workflow type per canonical separation (extended from three to
seven by DEC-058, 2026-08-26):

- `RESIGNATION_WITH_NOTICE`
- `IMMEDIATE_RESIGNATION`
- `TERMINATION`
- `RETIREMENT`
- `CONTRACT_EXPIRY`
- `REDUNDANCY`
- `OTHER`

No type may fall back to another type's workflow: a separation with no
definition of its own fails activation with an explicit exception rather than
running someone else's process.

Directive 1 may store the departure type but must **not** activate automated workflow content. During the baseline-capture foundation, do not automatically generate documents, departmental tasks, notifications, surveys or asset workflows.

### IC-S1-004 / DEC-007 — Baseline

- Implement baseline capture with all improvement automation disabled.
- Use the corrected two-dimension model: `measurement_cohort` (BASELINE, PILOT, POST_ROLLOUT) and `record_purpose` (OPERATIONAL, TRAINING, TEST).
- BASELINE is a business measurement cohort.
- TRAINING and TEST are record purposes, **not** cohorts.
- The application must clearly indicate when automation is disabled.
- Baseline records must not be mixed with pilot or post-rollout reporting.
- Feature flags must default to the safe, disabled state.

### IC-S1-005 / DEC-021 — Identity

Implement:

- an identity-provider interface;
- authorization boundaries;
- session abstractions;
- a doubly guarded non-production development login or role switcher.

The development login must require **both**:

```text
ALLOW_DEV_LOGIN=true
a non-production environment (NODE_ENV != production)
```

It must be impossible to enable in production.

Do **not**:

- select a production identity provider;
- configure live SSO;
- claim MFA support is operational;
- connect to a company directory;
- use real employee accounts;
- expose the development role switcher in production builds.

Production authentication remains blocked until IT and Security approve the identity provider and MFA model. Tracks `REQ-SEC-001`, which remains OPEN.

### IC-S1-006 / DEC-022 — Hosting

Implement only:

- local development services;
- non-production configuration;
- adapter interfaces;
- portable environment configuration;
- infrastructure boundaries required for later implementation.

Do **not** choose or deploy:

- production hosting;
- production database;
- production storage;
- production network;
- production backup service;
- production monitoring service;
- cross-border data location;
- cloud region;
- vendor contract;
- production email provider.

The architecture must remain portable until hosting is approved.

### IC-S1-007 / DEC-027 — Business calendar

Implement:

- `America/Jamaica` as the application timezone;
- a configurable business calendar;
- calendar versioning;
- deterministic synthetic holidays in automated tests;
- retained due-date calculation inputs;
- audited recalculation when a controlling date changes.

Do not claim that the production holiday calendar is approved or complete. Pilot entry requires HR or Administration approval of the actual holiday and closure-date data.

### IC-S1-008 / DEC-031 — Reason taxonomy

This constraint removes the hardest Stage 1 blocker without inventing HR policy.

Do **not** implement reason categories as:

- a Prisma enum;
- a TypeScript enum;
- a hard-coded dropdown;
- an invented production seed list.

Instead, create a **versioned reference-data model** capable of holding HR-approved reason categories later.

For Stage 1:

- departure type is required before HR review or approval;
- `reason_category_id` is **nullable** while taxonomy approval remains open;
- `reason_capture_status` must support:

```text
PENDING
PROVIDED
NOT_PROVIDED
NOT_APPLICABLE
```

- reason notes must be restricted HR data;
- production reason categories must not be invented by the development team;
- synthetic fixtures may use clearly labelled test-only reason records;
- reason analytics must remain unavailable until HR approves the taxonomy;
- **Directive 1 must no longer require an "approved reason category" at case creation.**

For a later completion stage:

- final case completion must require either an approved reason category, or an explicit `NOT_PROVIDED` or `NOT_APPLICABLE` outcome;
- the outcome must be audited.

Tracks `REQ-ADMIN-007`, which remains OPEN.

### IC-S1-009 / DEC-032 — Rehire eligibility

- Model rehire eligibility as restricted HR data.
- Department responders must not receive access.
- Line managers must not automatically receive access.
- External parties must not receive access.
- It is optional during Directive 1.
- A value is not required unless HR enters it.
- Access and changes must be audited.
- Do not infer rehire eligibility from departure type or reason.

### IC-S1-010 / DEC-033 — Historical migration

- No historical paper-document migration in MVP.
- No legacy-case migration in Stage 1.
- Stage 1 captures new prospective records and synthetic fixtures only.
- Do not import names or case details from the DMAIC appendices.
- Do not scan or transcribe completed paper forms into the application.
- Any historical migration requires a later, separately approved change request.
- Any aggregate baseline import requires an explicit mapping, validation, privacy review and approval.

### IC-S1-011 / DEC-035 — Termination confidentiality

Termination cases must default to `RESTRICTED`.

Minimum rules:

- Discovery requires explicit HR assignment or an expressly authorized oversight role.
- Case content requires explicit authorization.
- Unauthorized users must not learn that a restricted case exists through search, counts, dashboards, URLs, API responses, audit feeds, autocomplete, notifications or error messages.
- Department task recipients receive minimized task views only after the applicable task is released.
- IT may receive only the information needed to revoke access.
- Finance may receive only the information needed for its approved processing.
- Line managers may receive only assigned information.
- Negative authorization tests are mandatory.
- Audit logs must record access to restricted cases.
- `SYSTEM_ADMIN` must not automatically receive unrestricted HR business access merely because it administers the system. (Superseded by DEC-063: the role is retired; platform administration is held by `HR_MANAGER` and never widens that role's record scope.)

## 4. Decisions still unresolved

Recording a constraint does not resolve a decision. The following remain outstanding and continue to gate pilot and production:

**OPEN (4 of the Stage 1 set):** DEC-021 (IT / Security), DEC-022 (IT / Project Sponsor), DEC-031 (HR Manager / Process Analyst), DEC-033 (Project Sponsor / HR Manager).

**PROVISIONAL (7 of the Stage 1 set):** DEC-001, DEC-002, DEC-003, DEC-007, DEC-027, DEC-032, DEC-035.

All eleven Stage 1 approval boxes in `StakeholderApprovalChecklist.md` remain unticked, and must stay unticked until the named owners approve in writing.

## 5. Exit from these constraints

A constraint is retired when its decision is approved and recorded in `DecisionRegister.md`. At that point:

1. update the decision status and record approver, date and final wording;
2. update the affected requirements, rules, workflows, security/privacy specifications, tests and directives;
3. remove or supersede the corresponding constraint here;
4. re-run the traceability and validation checks.

Do not carry a constraint into pilot or production as though it were a decision.
