# Project Charter — Employee Offboarding Web Application

## 1. Project identity

| Field | Value |
| --- | --- |
| Organization | Bert's Auto Parts Ltd. |
| Product name | Employee Offboarding Web Application |
| Source initiative | DMAIC — Employee Offboarding Process Improvement |
| Sponsor | Project sponsor identified in the DMAIC |
| Process owner | HR Manager / HR Team |
| Business/project lead | Business Analyst / Product Owner |
| Technical implementation | Claude acting as bounded implementation engineer under review |
| Baseline version | 0.1 |
| Baseline date | 2026-07-28 |

## 2. Product vision

Provide HR with one secure, auditable and measurable workflow for every employee departure, while giving IT, Finance, line managers, auditors and departing employees only the information and actions appropriate to them.

The product is successful when required work is triggered reliably, urgent access removal happens at the approved time, controlled documents and notifications are accurate, assets receive documented outcomes, exit feedback is captured more effectively, and management can prove what happened without reconstructing it from paper files and email chains.

## 3. Business problem

The current process depends on memory, paper forms, individually written emails and manual routing. Immediate departures frequently bypass exit feedback; departmental tasks can be delayed or skipped; asset evidence is fragmented; and HR cannot consistently measure cycle time, completion, accuracy or exceptions.

## 4. Objectives

1. Establish one case record and immutable audit trail per departure.
2. Enforce distinct workflows for resignation with notice, immediate resignation and termination.
3. Create role-specific tasks, deadlines, reminders and escalation.
4. Produce controlled documents from validated, versioned templates.
5. Dispatch approved notifications through a reliable outbox with failure recovery.
6. Track every issued asset to a documented disposition.
7. improve exit-feedback completion using a short post-departure survey and controlled verbal fallback.
8. provide reliable KPI and exception reporting.
9. protect confidential HR information through least privilege, privacy controls and evidence-based security verification.
10. provide a maintainable company-owned product, repository and operational handover.

## 5. Initial product scope

### In scope

- HR-created offboarding cases.
- Resignation with notice, immediate resignation and termination.
- Employee source lookup and immutable case snapshot.
- Case approval and lifecycle.
- Versioned workflow/task engine.
- Controlled resignation/acknowledgement and termination-document placeholders.
- Existing Employee Action Form hierarchy represented digitally without changing authority.
- IT, Finance and line-manager departmental queues.
- Exact-time access-revocation task management.
- Versioned notification templates and reliable dispatch.
- Applicable Sagicor and NCB notifications.
- Digital asset-recovery tracking and evidence.
- Configurable handover/knowledge-transfer module.
- Short post-departure survey and HR-recorded verbal feedback.
- Dashboards, exception feed, KPI reports and controlled exports.
- Role/record-level authorization, audit, privacy, retention capability and operational runbooks.
- Baseline, pilot and post-rollout cohort measurement.

### Out of scope for the initial release

- Recruitment and onboarding.
- Redesign of payroll calculation or final-pay policy.
- Automatic withholding/deduction of final pay.
- Legal or HR policy changes.
- Redesign of the Employee Action Form approval hierarchy.
- Employee self-service case initiation.
- Automatic resignation-mailbox ingestion.
- Automatic legal decision-making or unreviewed AI dispatch.
- Full historical paper-file migration.
- Microservices.
- A mobile native application.
- Direct account revocation in every target system unless separately approved; the MVP coordinates and records the task.

## 6. Product principles

- Deterministic controls before generative assistance.
- Human approval for sensitive communications and decisions.
- Least privilege and minimum necessary disclosure.
- Immutable history instead of silent edits.
- Configurable/versioned workflows instead of scattered hard-coded logic.
- Reliable asynchronous work through an outbox and idempotent worker.
- Manual fallback without loss of auditability.
- Synthetic data outside production.
- Metrics with transparent numerators, denominators, exclusions and cohorts.
- Company ownership of source, credentials, documentation and operational knowledge.

## 7. Success measures

The authoritative definitions are in `docs/requirements/MetricsDictionary.md`. Headline targets include:

- 100% of in-scope cases logged within one business day.
- qualifying acceptance/acknowledgement letters issued within two business days, with at least 90% compliance during pilot.
- 100% exact-time access-revocation compliance.
- at least 98% notification accuracy during pilot, with no unreported failures.
- 100% asset disposition documentation before completion.
- at least 60% eligible exit-feedback completion during pilot, rising to at least 80% after full rollout.
- 100% workflow completeness at case closure.

## 8. Constraints and dependencies

- Business baseline data is currently incomplete.
- BambooHR, identity, email and hosting decisions require IT participation.
- Retention, survey confidentiality, external-sharing fields and termination-survey policy require HR/privacy approval.
- The process volume is low, approximately three cases per month in the source baseline; simplicity and maintainability take priority over distributed scale.
- The original source contains personal information and must not be committed.

## 9. Governance

- The Project Sponsor approves scope and major decisions.
- HR Manager owns process rules, templates, workflow acceptance and operational sign-off.
- The Business Analyst/Product Owner owns requirements, traceability, change control and Claude directives.
- IT owns production identity, hosting, integration credentials, technical operations and security implementation.
- Privacy/DPO function reviews processing, retention, sharing, incidents, cross-border transfers and data-subject handling.
- Claude implements only a bounded approved directive and stops for review.

## 10. Stage model

The planned stages are detailed in `docs/delivery/Roadmap.md`:

0. Requirements and architecture baseline.
1. Foundation, authorization, audit and baseline capture.
2. Controlled documents and exit-survey quick wins.
3. Workflow engine and departmental queues.
4. Assets, handover and clearance.
5. Notification automation and integrations.
6. Reporting and control-plan automation.
7. Hardening, UAT, pilot, training and rollout.
