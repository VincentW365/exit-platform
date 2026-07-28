# Risk Register

**Baseline version:** 0.1
**Prepared:** 2026-07-28
**Status:** Proposed control baseline; owners must confirm treatment and residual acceptance before the relevant delivery stage.

## 1. Purpose

This register expands the seven risks in the DMAIC into product, privacy, security, integration, delivery and operational risks that can be actively controlled during development and rollout.

Risk scoring is intentionally simple:

- likelihood: Low, Medium or High;
- impact: Low, Medium, High or Critical;
- priority: derived planning indicator, not a substitute for owner judgement;
- trigger: observable condition that requires review or execution of the response.

## 2. Risk register

| ID | Risk | Likelihood | Impact | Priority | Owner | Preventive/mitigating controls | Trigger or early warning |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-001 | Staff resistance or workarounds outside the platform | Medium | Medium | Medium | HR Manager | Phased rollout, role-specific training, champions, usage monitoring, feedback loop | Cases found only in email/paper after go-live |
| R-002 | Incorrect document or notification content | Low | High | Medium | HR Manager / Product Owner | Controlled templates, validation, preview, maker-checker approval, versioning, correction process | Any issued correction or wrong recipient |
| R-003 | Low exit-survey participation | Medium | High | High | HR Manager | Short mobile form, day-3/day-7 timing, personal email verification, verbal fallback, delivery monitoring | Monthly completion below pilot/full target |
| R-004 | Platform outage during an urgent departure | Low | High | Medium | IT / Product Owner | Manual fallback SOP, exact-time IT escalation channel, backups, health monitoring, restore test | Unavailable platform or worker at departure event |
| R-005 | Unauthorized access to HR or survey data | Low | Critical | Medium | IT Security / Privacy Officer | SSO/MFA, server-side RBAC/ABAC, restricted cases, access logging, security testing | Access anomaly, IDOR finding, leaked link |
| R-006 | Single-developer/key-person dependency | Medium | High | High | Project Sponsor / IT | Company-owned repo and credentials, runbooks, architecture docs, code review, backup owner, handover | No secondary technical owner before pilot |
| R-007 | Scope creep from suggestions becoming requirements | High | Medium | High | Process Analyst / Product Owner | Approved baseline, decision register, stage gates, change requests, MoSCoW priorities | Unapproved feature enters an implementation directive |
| R-008 | Conflicting business rules in source DMAIC | High | High | Critical | Product Owner / HR Manager | Decision register, explicit authority hierarchy, unresolved items block affected stage | Open decision reaches implementation stage |
| R-009 | Urgent access removal delayed by 24-hour rule | Medium | Critical | Critical | HR Manager / IT Manager | Exact effective time tasks, urgent workflow, escalation, KPI-006 | Task due after effective time or completed late |
| R-010 | Duplicate or unintended emails | Medium | High | High | IT / Product Owner | Transactional outbox, idempotency keys, approval, recipient preview, sandbox | Same logical notification submitted more than once |
| R-011 | Provider accepts email but it is not delivered | Medium | Medium | Medium | HR Manager / IT | SUBMITTED vs DELIVERED distinction, bounce handling, manual confirmation/fallback | 202 accepted with later bounce/no evidence |
| R-012 | BambooHR integration uses a personal API identity | Medium | High | High | IT / BambooHR Admin | Dedicated company identity/OAuth app, credential owner, health and reconciliation | Integration identity belongs to ordinary employee |
| R-013 | Stale or incorrect employee source data | Medium | High | High | HR Manager / BambooHR Admin | Snapshot review, source timestamp, pre-generation validation, controlled correction | Source mismatch or stale sync warning |
| R-014 | External provider receives excessive data | Low | High | Medium | Privacy Officer / Benefits Owner | Minimum field matrix, approved templates, sharing log, recipient configuration | Template includes reason/free text/unapproved field |
| R-015 | Unreturned asset leads to unlawful or unapproved pay action | Medium | High | High | HR Manager / Finance | No automated payroll action; route exception for authorized decision | Any direct system-to-pay deduction path proposed |
| R-016 | Case is closed with skipped mandatory work | Medium | High | High | HR Manager | Closure integrity check, mandatory task protection, waiver authority, audit | Closure check fails or post-close defect found |
| R-017 | Termination case appears in broad queues | Low | Critical | Medium | HR Manager / IT Security | Restricted-by-default classification, explicit participation, negative authorization tests | Unauthorized role can list/view restricted case |
| R-018 | Survey token is guessed, forwarded or reused | Low | High | Medium | IT Security | High entropy, hash storage, single use, expiry, rate limiting, no case data exposure | Token replay or brute-force test succeeds |
| R-019 | Malicious or unsafe uploaded file | Medium | High | High | IT Security | Allow-list, signature checks, quarantine, malware scanning, generated object names | Scanner failure, executable/polyglot accepted |
| R-020 | Sensitive content leaks into logs or monitoring | Medium | High | High | IT / Privacy Officer | PII-safe logging standard, structured allow-list logs, test inspection, restricted observability access | Log contains email body, survey text, tokens, address |
| R-021 | Retention period is undefined or inconsistent | High | High | Critical | Privacy Officer / HR Manager | Approve record-class policy, legal hold, deletion evidence, retention tests | Production readiness with DEC-023 open |
| R-022 | Cross-border/cloud processing is not assessed | Medium | High | High | Privacy Officer / IT | Processor inventory, DPIA, transfer assessment, contract review before enablement | Hosting/AI provider selected without assessment |
| R-023 | Small departmental survey reports identify individuals | Medium | High | High | HR Manager / Privacy Officer | Cohort threshold, suppression, no drill-through, restricted free text | Segment report below approved threshold |
| R-024 | Feature flags accidentally enable live automation in baseline or development | Medium | High | High | Product Owner / IT | Environment-scoped flags, safe defaults, startup guards, tests | Automation enabled in BASELINE or non-production |
| R-025 | Business-day calculation is wrong | Medium | Medium | Medium | Product Owner / HR Manager | America/Jamaica calendar, approved holidays, deterministic tests, stored due dates | Date discrepancy around weekends/holidays |
| R-026 | Manual fallback actions are not reconciled | Medium | Medium | Medium | HR Manager | Structured manual completion/send records, reconciliation task, audit review | Action done outside platform without evidence |
| R-027 | Inadequate backup or untested restore | Low | Critical | Medium | IT | Automated backups, object/database consistency, restore exercise, RPO/RTO approval | Pilot begins without successful restore test |
| R-028 | System administrator can read all HR data by default | Medium | High | High | IT Security / Privacy Officer | Technical/business role separation, break-glass workflow, access review | SYSTEM_ADMIN has normal case access |
| R-029 | AI provider retains or trains on employee data | Medium | Critical | Critical | Privacy Officer / Project Sponsor | AI disabled by default, approved provider assessment, minimization/de-identification, contractual terms | Employee data sent before DEC-030 approval |
| R-030 | Metrics are gamed or misinterpreted | Medium | Medium | Medium | Process Analyst / HR Manager | Metric dictionary, show numerator/denominator/exclusions, percentile cycle time, quality plus speed | Dashboard shows percentage without denominator/exclusions |
| R-031 | Over-automation removes necessary human judgement | Medium | High | High | HR Manager | Human approval gates, exception routing, no AI decision authority | Workflow auto-approves sensitive action |
| R-032 | Role changes are not promptly reflected | Medium | High | High | IT / HR Manager | SSO group lifecycle, periodic access review, immediate revocation, audit | User retains role after transfer/departure |
| R-033 | Template change silently alters active cases | Medium | High | High | HR Manager / Product Owner | Immutable versions; cases pin versions; explicit migration only | Old case renders using new template unexpectedly |
| R-034 | Integration/webhook replay or spoofing | Low | High | Medium | IT Security | HMAC verification, timestamp window, idempotency, HTTPS, secret rotation | Unsigned/stale webhook accepted |
| R-035 | Unclear product ownership after rollout | Medium | High | High | Project Sponsor | Name product owner, technical owner, privacy owner, support SLAs and governance meeting | No owner assigned before pilot exit |

## 3. Risk-treatment workflow

1. The owner confirms the description, likelihood, impact and treatment.
2. The active delivery directive identifies risks affected by its scope.
3. Preventive controls are implemented and verified through acceptance tests.
4. A trigger creates an exception, incident, decision or change request as appropriate.
5. The owner records residual likelihood, residual impact and acceptance before the stage gate.
6. Critical or unaccepted High risks block release.
7. Closed risks remain in history; they are not deleted.

## 4. Mandatory pre-pilot risk evidence

Before pilot, the project must show evidence for at least:

- authorization and restricted-termination negative tests;
- exact-time access-removal scheduling and escalation;
- notification idempotency and failure recovery;
- survey-token expiry, replay and rate-limit tests;
- file quarantine and malware-scanner failure handling;
- sanitized logs and observability access;
- backup and restore exercise;
- manual fallback tabletop;
- approved retention and incident ownership;
- company-owned repository, credentials and secondary technical owner;
- feature flags that prevent real dispatch in development and baseline mode.

## 5. Escalation rule

A risk becomes a blocking issue when any of the following is true:

- the trigger has occurred and no owner has accepted a time-bound treatment;
- a Critical-impact control is absent or has failed;
- a required decision remains open at the affected stage;
- the risk could expose personal data, leave access active past the approved effective time, cause an incorrect employee communication, or compromise audit evidence;
- the owner cannot demonstrate the stated mitigation.

## 6. Relationship to other artefacts

- Decisions: `../requirements/DecisionRegister.md`
- Business rules: `../requirements/BusinessRules.md`
- Security controls: `../security/SecurityVerificationChecklist.md`
- Test evidence: `TestStrategy.md`
- Operational responses: `../operations/SupportAndIncidentManagement.md`
- Manual continuity: `../operations/ManualFallbackAndBusinessContinuity.md`
