# Scope, Assumptions and Constraints

## Scope baseline

The authoritative initial scope is defined in `Project.md` and `PRD.md`. This document makes the boundary explicit for implementation planning.

## Included

| Area | Included capability |
| --- | --- |
| Intake | HR-created case, employee lookup, controlled manual fallback, document upload |
| Case | Three departure types, exact effective time, owner, classification, status, cohort |
| Workflow | Versioned rules, tasks, due dates, blockers, waivers, escalation, closure check |
| Documents | Controlled templates, validation, preview, approval, issue and supersession |
| Notifications | Approved templates, applicability, outbox, retry, manual fallback |
| IT/Finance/Manager | Minimal-data queues and structured completion evidence |
| Assets | Issued/default items, dispositions, reminders, evidence and exceptions |
| Handover | Configurable manager-led checklist and risk sign-off |
| Feedback | Short secure survey plus HR/verbal fallback |
| Reporting | KPI, exceptions, operational and control reports |
| Governance | RBAC/record access, audit, privacy, retention capability, runbooks |

## Explicitly excluded from the first release

- onboarding/recruitment;
- payroll calculation redesign;
- automatic deductions or final-pay withholding;
- direct legal/policy interpretation;
- changed Action Form authority;
- employee account/portal for resignation submission;
- mailbox ingestion;
- autonomous AI;
- broad historical migration;
- unapproved direct write-back to BambooHR;
- microservices.

## Working assumptions

| ID | Assumption | Validation owner | Impact if false |
| --- | --- | --- | --- |
| ASM-001 | HR remains accountable for end-to-end offboarding. | Project Sponsor / HR Manager | Role model and approvals change. |
| ASM-002 | Outlook/Microsoft 365 is the likely production email environment. | IT | Email adapter/provider choice changes, domain design remains. |
| ASM-003 | BambooHR remains an employee source of truth. | HR / BambooHR Admin | Source adapter and field ownership change. |
| ASM-004 | Process volume remains low enough for a modular monolith and one relational store. | Product Owner / IT | Capacity testing changes; architecture likely still sufficient. |
| ASM-005 | HR can verify a personal email before post-departure survey dispatch. | HR Manager | Alternative survey channel is required. |
| ASM-006 | IT, Finance and line managers can authenticate through a company identity provider. | IT | Local account lifecycle and MFA design are required. |
| ASM-007 | Existing paper approval authority remains valid for digitization. | HR Manager | Approval workflow must be revised through change control. |
| ASM-008 | NCB/Sagicor participation can be determined from an approved source or HR decision. | Benefits owner | Notifications remain manual or require new data capture. |
| ASM-009 | A company-owned repository and deployment environment will be available. | Project Sponsor / IT | Key-person and security risks remain unacceptable. |
| ASM-010 | The Privacy/DPO function can approve retention, sharing and survey confidentiality before production. | Project Sponsor | Production rollout is blocked. |

## Constraints

- The source baseline lacks valid historical timing/completion data.
- The original appendices contain personal information and cannot be used as fixtures.
- Integration credentials and access require company administrators.
- Exact legal/policy treatment of final pay and retention is outside product authority.
- The build is expected to be AI-assisted by Claude, increasing the need for bounded directives and independent review.
- The product must remain usable when email/BambooHR are temporarily unavailable.

## Scope-control rule

A feature is in scope only when it has:

1. an approved requirement or decision;
2. an assigned delivery stage;
3. acceptance criteria;
4. test/evidence expectations;
5. no unresolved blocking decision.

A screenshot, idea, source suggestion or Claude recommendation is not automatically a requirement.
