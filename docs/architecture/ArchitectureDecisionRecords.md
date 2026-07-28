# Architecture Decision Records

## ADR-001 — Modular monolith with separate worker

**Status:** ACCEPTED (baseline)

### Decision

Use one TypeScript/Next.js modular monolith plus a separately deployed worker and PostgreSQL.

### Context

Process volume is low and transactional consistency/auditability are more important than distributed scaling.

### Consequences

Simpler deployment and ownership; modules must be kept explicit to avoid a monolithic code tangle.

## ADR-002 — PostgreSQL transactional outbox

**Status:** ACCEPTED (baseline)

### Decision

Persist outbound/scheduled work in PostgreSQL in the same transaction as domain changes.

### Context

Avoids lost notifications and does not require a message broker at current scale.

### Consequences

Worker/idempotency/dead-letter design is mandatory.

## ADR-003 — Deterministic workflow engine

**Status:** ACCEPTED (baseline)

### Decision

Use versioned rules/tasks rather than an AI agent as the process controller.

### Context

The root cause is skipped manual work; deterministic rules are auditable and testable.

### Consequences

Optional AI remains assistive only.

## ADR-004 — HR-led MVP intake

**Status:** PROVISIONAL

### Decision

Only authorized HR users create cases in MVP.

### Context

Avoids public/employee identity, spam and support complexity while preserving current governance.

### Consequences

Employee portal and mailbox ingestion are deferred.

## ADR-005 — Immutable employee snapshot

**Status:** ACCEPTED (baseline)

### Decision

Pin approved employee/source fields to each case.

### Context

Live source changes must not retroactively change issued documents or historical cases.

### Consequences

Requires controlled correction and reconciliation.

## ADR-006 — Versioned workflows and templates

**Status:** ACCEPTED (baseline)

### Decision

Definitions are immutable once used; cases pin versions.

### Context

Supports audit and controlled change.

### Consequences

Configuration administration needs maker-checker approval.

## ADR-007 — Role plus record-level authorization

**Status:** ACCEPTED (baseline)

### Decision

Combine RBAC with case classification, assignment and explicit participation.

### Context

Broad roles alone cannot protect termination and survey content.

### Consequences

Every list/detail endpoint requires server-side predicates.

## ADR-008 — Exact-time access revocation

**Status:** ACCEPTED (baseline)

### Decision

Model effective separation as an instant and schedule security tasks accordingly.

### Context

A 24-hour general notification SLA is insufficient for urgent departures.

### Consequences

Calendar/date-only models are not adequate.

## ADR-009 — Controlled templates before AI drafting

**Status:** ACCEPTED (baseline)

### Decision

Use approved placeholders, validation, preview and approval for authoritative content.

### Context

Lower error/privacy risk and directly addresses consistency.

### Consequences

AI may be added later as a suggestion layer.

## ADR-010 — Separate asset documentation and recovery

**Status:** ACCEPTED (baseline)

### Decision

Closure requires documented disposition, while physical recovery is measured separately.

### Context

The system cannot force physical return and should not block forever.

### Consequences

Exceptions/waivers are explicit; no payroll action.

## ADR-011 — Token-based public survey

**Status:** ACCEPTED (baseline)

### Decision

Use one-time expiring hashed tokens rather than employee accounts.

### Context

Departing employees may no longer have internal access.

### Consequences

Requires strong token security, privacy notice and no case-data exposure.

## ADR-012 — Email provider abstraction

**Status:** ACCEPTED (baseline)

### Decision

Keep Microsoft Graph/SMTP-specific code behind an adapter.

### Context

Provider/permissions are not confirmed and acceptance semantics differ.

### Consequences

Domain notification status remains provider-neutral.

## ADR-013 — No generic business-record admin CRUD

**Status:** ACCEPTED (baseline)

### Decision

All changes occur through domain commands, not unrestricted admin forms.

### Context

Protects invariants and audit history.

### Consequences

Administrative screens manage configuration, not arbitrary database rows.

## ADR-014 — WCAG 2.2 AA and ASVS 5.0.0 baselines

**Status:** ACCEPTED (baseline)

### Decision

Use current W3C accessibility and OWASP security verification baselines.

### Context

The product handles sensitive HR data and must be usable and verifiable.

### Consequences

Requires release evidence; not a certification claim.

## ADR-015 — No production data in lower environments

**Status:** ACCEPTED (baseline)

### Decision

Use synthetic/anonymized approved data only outside production.

### Context

Source appendices contain personal data and offboarding records are highly sensitive.

### Consequences

Demos/tests must use fictional identities.
