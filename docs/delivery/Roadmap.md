# Delivery Roadmap

## Delivery principles

- One bounded stage at a time.
- Stakeholder decisions precede the affected stage.
- Claude returns evidence and stops after every directive.
- Local commits only until explicit push authorization.
- Security, privacy, accessibility, documentation and tests are part of each stage.
- Stage gates are outcome/evidence based, not calendar based.

## Directive mapping

Stages and directives are not one to one. A stage may require more than one
directive, and each directive has its own scope, acceptance gate, tests,
evidence and local commit. The authoritative mapping is the
directive-to-stage table in `ClaudeBuildDirectives.md`:

| Stage | Directives |
| --- | --- |
| 0 | Directive 0, Directive 0.1 |
| 1 | Directive 1 |
| 2 | Directive 2, Directive 3 |
| 3 | Directive 4, Directive 5 |
| 4 | Directive 6 |
| 5 | Directive 7, Directive 8 |
| 6 | Directive 9 |
| 7 | Directive 10 |

Completing the first directive in a stage does not complete the stage. Claude
stops after every directive and waits for review. The "Expected local commit"
column below names the stage-level outcome; the authoritative commit message
for any single piece of work is the COMMIT line inside its directive.

Stage 1 additionally operates under the non-production engineering constraints
recorded in `../requirements/Stage1ImplementationConstraints.md`, which do not
constitute stakeholder approval.

## Stage roadmap

| Stage | Name | Included | Excluded | Dependencies | Acceptance gate | Expected local commit |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Product and architecture baseline | This documentation package; stakeholder decisions; traceability | Application code | DMAIC review; sponsor/HR/IT/privacy availability | Required blocking decisions approved; baseline validated | docs: import and validate HR offboarding product baseline |
| 1 | Foundation, access, audit and baseline capture | Monorepo; Next.js/worker foundation; PostgreSQL/Prisma; config; auth abstraction; dev login guard; RBAC/record access; audit; synthetic seed; case register/create; attachments boundary; cohort; basic dashboard; feature flags | Workflow automation, live email, BambooHR production integration | Stage 1 decisions; development environment | Case creation/approval baseline path works; unauthorized access tests pass; baseline export works; no live integrations | feat: establish secure offboarding foundation and baseline capture |
| 2 | Controlled documents and exit-survey quick wins | Template/version model; letter generation/preview/approval/issue; secure storage; survey definitions, token flow, respondent UI, eligibility, day-3/day-7 scheduling through sink outbox; manual fallback | Live email provider; full workflow engine; termination wording beyond approved template | Template wording/approval; survey confidentiality/eligibility; storage/scanner | Letter and survey critical paths pass; token/upload/auth tests; no real send | feat: add controlled offboarding documents and exit feedback |
| 3 | Workflow engine and departmental queues | Workflow versions; three workflow templates; task dependencies; due engine; exact-time IT tasks; blockers, evidence, waivers, reminders/escalation; IT/Finance/manager queues; case hold/date change; closure check foundation | Assets/handover depth; live integrations | Workflow approvals; business calendar; role owners | All three synthetic cases execute; exact-time and mandatory-task controls tested | feat: implement versioned offboarding workflows and department queues |
| 4 | Assets, handover and clearance | Asset catalogue/source/manual items; dispositions/evidence/reminders/exceptions; handover plan/items/attestation; clearance integrity; completion/reopen | Payroll deductions; direct asset system write-back | Asset owners/rules; handover scope; waiver authority | 100% disposition gate; no pay side effect; closure/reopen tests pass | feat: add asset clearance and handover controls |
| 5 | Notifications and integrations | Notification templates/approval/outbox/worker; live provider adapter after IT approval; retries/idempotency/bounce/manual fallback; BambooHR read-only lookup/sync/reconciliation; provider recipient config; Sagicor/NCB applicability | AI; payroll write-back; broad BambooHR write-back | Identity/mail/BambooHR credentials and field maps; privacy sharing approvals | Sandbox/staging contract tests; duplicate/failure/reconciliation tests; production permissions reviewed | feat: integrate reliable offboarding notifications and employee source |
| 6 | Reporting and control automation | KPI calculations; exception feed; cohort comparisons; document/notification/access/asset/survey reports; controlled exports; access reports; monthly control report | Advanced BI/data warehouse; AI themes | Valid baseline data; metric approval; cohort threshold | Metric fixtures reconcile manually; privacy suppression/export tests pass | feat: add offboarding control reporting and exception analytics |
| 7 | Hardening, UAT, pilot and rollout | ASVS-based review; DAST; accessibility; performance; backup/restore; incident/fallback tabletop; retention/legal hold if approved; UAT; training; pilot; support handover; deployment/rollback | Unapproved future features | All production decisions/owners; hosting; DPIA; runbooks | No unresolved critical defects; pilot exit criteria; sponsor sign-off | chore: harden and prepare HR offboarding platform for rollout |

## Indicative effort

For a single AI-assisted developer under active review, a practical planning range is:

| Stage | Indicative effort | Main uncertainty |
| --- | --- | --- |
| 0 | Complete as baseline; approval 1–2 workshops | Decision availability |
| 1 | 2–3 weeks | Identity/hosting and repository condition |
| 2 | 2–3 weeks | Template rendering, storage/scanning, survey policy |
| 3 | 3–5 weeks | Workflow rules, authorization and scheduling |
| 4 | 2–3 weeks | Asset source and handover acceptance |
| 5 | 3–5 weeks | Company integration access and provider behaviours |
| 6 | 2–3 weeks | Baseline quality and metric validation |
| 7 | 3–6 weeks plus two-month pilot | Security remediation, case volume and stakeholder availability |

These are planning ranges, not commitments. Rebaseline after Stage 1 environment inspection and after integration access is confirmed.

## Release slices

### Baseline capture release

- secure HR case register;
- receipt/completion timestamps;
- manual outcome capture;
- cohort tagging;
- basic reporting/export;
- improvement automations disabled.

### Quick-win release

- controlled letter;
- secure survey;
- manual/sink communications;
- no live integration dependency.

### Operational workflow release

- tasks/queues/asset/handover/clearance;
- manual provider actions can still be recorded.

### Integrated/control release

- reliable live notification and BambooHR integration;
- KPI/control reporting;
- hardening and rollout.

## Gate rule

A stage is not complete when code compiles. It is complete when:

- acceptance criteria pass;
- required tests/evidence pass;
- security/privacy review is complete for added surfaces;
- documentation/traceability are updated;
- no blocking decision is open;
- a local commit exists;
- reviewer approves progression.
