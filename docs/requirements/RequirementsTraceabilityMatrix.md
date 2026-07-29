# Requirements Traceability Matrix

## Purpose

This matrix links every stable requirement to its source/rationale, decision status, delivery stage and expected verification evidence. The full requirement text is in `RequirementsCatalogue.md`.

## Traceability summary

- Total requirements: **313**
- Provisional: **295**
- Open: **18**
- Future-stage requirements: **2**

Two Stage 1 requirements are OPEN: `REQ-SEC-001` (production SSO, DEC-021) and `REQ-ADMIN-007` (reason taxonomy, DEC-031). Both are covered for non-production Stage 1 work by `Stage1ImplementationConstraints.md` — IC-S1-005 and IC-S1-008 respectively. Those constraints permit reversible engineering only; the requirements and their decisions remain OPEN and neither is verified until its owner approves.

Stage 1 implementation evidence (Directive 1): the non-production foundation implementing the Stage 1 requirement set was built and verified on 2026-07-28/29 — lint, strict typecheck, 70 unit tests, 36 integration tests against a real PostgreSQL test database, a Playwright critical-path E2E and a production build all pass. The version decisions, design mapping and per-check results are recorded in `../delivery/Stage1BuildRecord.md`. This is engineering evidence under the Stage 1 constraints, not stakeholder acceptance; the Stage 1 gate in `../delivery/Roadmap.md` still requires reviewer approval.

| Requirement ID | Title | Source / rationale | Status | Priority | Stage | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| REQ-CASE-001 | Unique case number | DMAIC pp. 8, 18 | PROVISIONAL | MUST | 1 | Integration and end-to-end test |
| REQ-CASE-002 | HR-led case creation | DEC-002; DMAIC p. 18 | PROVISIONAL | MUST | 1 | Authorization test |
| REQ-CASE-003 | Employee selection | DMAIC pp. 4, 10 | PROVISIONAL | MUST | 1 | Integration and fallback test |
| REQ-CASE-004 | Employee snapshot | DEC-018 | PROVISIONAL | MUST | 1 | Data integrity test |
| REQ-CASE-005 | Departure types | DMAIC pp. 6, 10; DEC-003 | PROVISIONAL | MUST | 1 | Validation test |
| REQ-CASE-006 | Receipt timestamp | DMAIC pp. 8-9 | PROVISIONAL | MUST | 1 | Validation and audit test |
| REQ-CASE-007 | Proposed and confirmed dates | DMAIC pp. 10, 24-26 | PROVISIONAL | MUST | 1 | Domain test |
| REQ-CASE-008 | Exact effective time | DEC-006 | PROVISIONAL | MUST | 1 | Domain and scheduling test |
| REQ-CASE-009 | Notice status | DMAIC p. 24 | PROVISIONAL | MUST | 1 | Validation test |
| REQ-CASE-010 | Case owner | DMAIC p. 7 | PROVISIONAL | MUST | 1 | Authorization and assignment test |
| REQ-CASE-011 | Confidentiality classification | DEC-035 | PROVISIONAL | MUST | 1 | Authorization test |
| REQ-CASE-012 | Workflow version reference | DEC-003 | PROVISIONAL | MUST | 3 | Data integrity test |
| REQ-CASE-013 | Measurement cohort and record purpose | DEC-007; Directive 0.1 section C | PROVISIONAL | MUST | 1 | Reporting and audit test; record-purpose exclusion test |
| REQ-CASE-014 | Case state machine | StateMachines.md | PROVISIONAL | MUST | 1 | Unit and authorization test |
| REQ-CASE-015 | No ordinary hard deletion | DEC-026 | PROVISIONAL | MUST | 1 | Database and authorization test |
| REQ-CASE-016 | Void control | DEC-026 | PROVISIONAL | MUST | 3 | End-to-end test |
| REQ-CASE-017 | Reopening control | DEC-026 | PROVISIONAL | MUST | 3 | End-to-end test |
| REQ-CASE-018 | Attachments | DMAIC pp. 4, 18 | PROVISIONAL | MUST | 1 | Upload security test |
| REQ-CASE-019 | Internal notes | Gap analysis | PROVISIONAL | MUST | 1 | Authorization and audit test |
| REQ-CASE-020 | Duplicate detection | Risk analysis | PROVISIONAL | SHOULD | 1 | Unit and UI test |
| REQ-CASE-021 | Search and filtering | DMAIC p. 18 | PROVISIONAL | MUST | 1 | UI and authorization test |
| REQ-CASE-022 | Controlled export | Privacy requirements | PROVISIONAL | MUST | 6 | Authorization and export test |
| REQ-CASE-023 | Case-capture SLA evidence | KPI-001 | PROVISIONAL | MUST | 1 | Data integrity test |
| REQ-CASE-024 | Field source display | DEC-018 | PROVISIONAL | SHOULD | 1 | UI and integration test |
| REQ-CASE-025 | Date-change impact preview | Workflow analysis | PROVISIONAL | MUST | 3 | End-to-end test |
| REQ-CASE-026 | Sensitive field masking | DEC-032 | PROVISIONAL | MUST | 1 | Authorization test |
| REQ-WF-001 | Versioned workflow definitions | DEC-003 | PROVISIONAL | MUST | 3 | Data integrity and admin test |
| REQ-WF-002 | Three initial workflows | DMAIC pp. 10-11; DEC-003 | PROVISIONAL | MUST | 3 | End-to-end workflow tests |
| REQ-WF-003 | Instantiation on approval | Architecture baseline | PROVISIONAL | MUST | 3 | Idempotency test |
| REQ-WF-004 | Task definition metadata | DMAIC pp. 14-16 | PROVISIONAL | MUST | 3 | Schema and admin test |
| REQ-WF-005 | Business-calendar due dates | DEC-027 | PROVISIONAL | MUST | 1 | Calendar unit tests |
| REQ-WF-006 | Exact-time due dates | DEC-006 | PROVISIONAL | MUST | 3 | Scheduling test |
| REQ-WF-007 | Task dependencies | Process map | PROVISIONAL | MUST | 3 | Workflow unit tests |
| REQ-WF-008 | Automatic readiness | StateMachines.md | PROVISIONAL | MUST | 3 | Workflow unit tests |
| REQ-WF-009 | Task assignment | DMAIC p. 7 | PROVISIONAL | MUST | 3 | Authorization and assignment tests |
| REQ-WF-010 | Task reassignment | Audit requirement | PROVISIONAL | MUST | 3 | Audit test |
| REQ-WF-011 | Task evidence | DMAIC pp. 14-15 | PROVISIONAL | MUST | 3 | Validation test |
| REQ-WF-012 | Blockers | DMAIC p. 18 | PROVISIONAL | MUST | 3 | UI and workflow test |
| REQ-WF-013 | Waivers | DEC-026 | PROVISIONAL | MUST | 3 | Authorization test |
| REQ-WF-014 | Mandatory task protection | Validated root cause | PROVISIONAL | MUST | 3 | Negative test |
| REQ-WF-015 | Overdue calculation | KPI-010 | PROVISIONAL | MUST | 3 | Unit tests |
| REQ-WF-016 | Reminders and escalation | DMAIC pp. 14-15 | PROVISIONAL | MUST | 3 | Scheduler and idempotency tests |
| REQ-WF-017 | Department queues | DMAIC p. 7 | PROVISIONAL | MUST | 3 | Authorization and UI test |
| REQ-WF-018 | Parallel branches | Process map | PROVISIONAL | MUST | 3 | Workflow test |
| REQ-WF-019 | Conditional tasks | DEC-014, DEC-016 | PROVISIONAL | MUST | 3 | Rule tests |
| REQ-WF-020 | Date recalculation | DEC-027 | PROVISIONAL | MUST | 3 | End-to-end test |
| REQ-WF-021 | No silent historical rewrite | Audit principle | PROVISIONAL | MUST | 3 | Data integrity test |
| REQ-WF-022 | Notification coupling | DEC-005 | PROVISIONAL | MUST | 5 | Integration test |
| REQ-WF-023 | Document coupling | DEC-005 | PROVISIONAL | MUST | 2 | Integration test |
| REQ-WF-024 | Case hold | Gap analysis | OPEN | MUST | 3 | Workflow test after decision |
| REQ-WF-025 | Resume from hold | Gap analysis | OPEN | MUST | 3 | Workflow test after decision |
| REQ-WF-026 | Cancellation propagation | Case lifecycle | PROVISIONAL | MUST | 3 | End-to-end test |
| REQ-WF-027 | Closure integrity check | KPI-012 | PROVISIONAL | MUST | 3 | End-to-end test |
| REQ-WF-028 | Controlled manual task | Operational flexibility | PROVISIONAL | SHOULD | 3 | Authorization and audit test |
| REQ-WF-029 | Workflow migration control | Versioning principle | PROVISIONAL | MUST | 6 | Admin and migration test |
| REQ-WF-030 | Feature flags by cohort | DEC-007 | PROVISIONAL | MUST | 1 | Configuration test |
| REQ-WF-031 | Idempotent scheduled jobs | Reliability design | PROVISIONAL | MUST | 3 | Integration test |
| REQ-WF-032 | Escalation visibility | DMAIC p. 18 | PROVISIONAL | MUST | 3 | UI and workflow test |
| REQ-WF-033 | Task completion timestamps | Control plan | PROVISIONAL | MUST | 3 | Data integrity test |
| REQ-WF-034 | Task templates locked per instance | Versioning principle | PROVISIONAL | MUST | 3 | Regression test |
| REQ-DOC-001 | Versioned document templates | DMAIC pp. 12, 24 | PROVISIONAL | MUST | 2 | Admin and data integrity test |
| REQ-DOC-002 | Template placeholder schema | Document gap analysis | PROVISIONAL | MUST | 2 | Template validation tests |
| REQ-DOC-003 | Pre-generation validation | KPI-003 | PROVISIONAL | MUST | 2 | Negative test |
| REQ-DOC-004 | Employee snapshot source | DEC-018 | PROVISIONAL | MUST | 2 | Data integrity test |
| REQ-DOC-005 | Preview | Risk R2 | PROVISIONAL | MUST | 2 | UI/end-to-end test |
| REQ-DOC-006 | Approval state machine | DEC-005 | PROVISIONAL | MUST | 2 | State machine tests |
| REQ-DOC-007 | Separation of duties | Control design | PROVISIONAL | SHOULD | 2 | Authorization test |
| REQ-DOC-008 | PDF output | DMAIC p. 24 | PROVISIONAL | MUST | 2 | Generation test |
| REQ-DOC-009 | Editable output | Operational requirement | OPEN | SHOULD | 2 | Generation test after decision |
| REQ-DOC-010 | Immutable issued snapshot | Audit requirement | PROVISIONAL | MUST | 2 | Data integrity test |
| REQ-DOC-011 | Supersession | KPI-003 | PROVISIONAL | MUST | 2 | End-to-end test |
| REQ-DOC-012 | Secure storage | Security baseline | PROVISIONAL | MUST | 1 | Security test |
| REQ-DOC-013 | Download audit | Privacy baseline | PROVISIONAL | MUST | 2 | Audit test |
| REQ-DOC-014 | Authenticated attestation | DEC-025 | PROVISIONAL | MUST | 2 | Authorization and audit test |
| REQ-DOC-015 | Departure-specific documents | DEC-003 | PROVISIONAL | MUST | 2 | Rule test |
| REQ-DOC-016 | No authoritative free-form AI | DEC-004 | PROVISIONAL | MUST | 2 | Configuration and process test |
| REQ-DOC-017 | AI provenance | DEC-030 | PROVISIONAL | SHOULD | Future | Audit test |
| REQ-DOC-018 | Turnaround measurement | DMAIC pp. 9, 14 | PROVISIONAL | MUST | 2 | Reporting test |
| REQ-DOC-019 | Field source review | KPI-003 | PROVISIONAL | SHOULD | 2 | UI test |
| REQ-DOC-020 | Template activation approval | Change control | PROVISIONAL | MUST | 2 | Authorization test |
| REQ-DOC-021 | Confidential marking | DMAIC pp. 24-27 | PROVISIONAL | MUST | 2 | Generation test |
| REQ-NOTIFY-001 | Versioned notification templates | DMAIC pp. 12, 25-26 | PROVISIONAL | MUST | 5 | Admin test |
| REQ-NOTIFY-002 | Applicability rules | DEC-016 | PROVISIONAL | MUST | 5 | Rule tests |
| REQ-NOTIFY-003 | Transactional outbox | Reliability architecture | PROVISIONAL | MUST | 5 | Integration test |
| REQ-NOTIFY-004 | Notification state machine | DEC-034 | PROVISIONAL | MUST | 5 | State machine tests |
| REQ-NOTIFY-005 | Recipient model | Notification design | PROVISIONAL | MUST | 5 | Data test |
| REQ-NOTIFY-006 | Minimum necessary data | DEC-017 | PROVISIONAL | MUST | 5 | Privacy test |
| REQ-NOTIFY-007 | Approval before external send | DEC-005 | PROVISIONAL | MUST | 5 | Authorization test |
| REQ-NOTIFY-008 | Scheduled dispatch | DMAIC pp. 9, 14 | PROVISIONAL | MUST | 5 | Scheduler test |
| REQ-NOTIFY-009 | Urgent IT notification | DEC-006 | PROVISIONAL | MUST | 5 | End-to-end test |
| REQ-NOTIFY-010 | Retry policy | Reliability design | PROVISIONAL | MUST | 5 | Failure-injection test |
| REQ-NOTIFY-011 | Idempotency key | Reliability design | PROVISIONAL | MUST | 5 | Duplicate prevention test |
| REQ-NOTIFY-012 | Provider adapter | DEC-020 | PROVISIONAL | MUST | 5 | Architecture test/review |
| REQ-NOTIFY-013 | No live development send | Security baseline | PROVISIONAL | MUST | 1 | Configuration test |
| REQ-NOTIFY-014 | Failure dashboard | DMAIC pp. 14, 18 | PROVISIONAL | MUST | 5 | UI and integration test |
| REQ-NOTIFY-015 | Manual fallback | DMAIC p. 14 | PROVISIONAL | MUST | 5 | End-to-end test |
| REQ-NOTIFY-016 | Attempt log | Control plan | PROVISIONAL | MUST | 5 | Data integrity test |
| REQ-NOTIFY-017 | Submitted versus delivered | DEC-034; Microsoft Graph documentation | PROVISIONAL | MUST | 5 | Integration and UI test |
| REQ-NOTIFY-018 | Invalid address handling | KPI-005 | PROVISIONAL | MUST | 5 | Negative test |
| REQ-NOTIFY-019 | Reminder notifications | DMAIC p. 15 | PROVISIONAL | MUST | 5 | Scheduler test |
| REQ-NOTIFY-020 | Cancel/reschedule | Workflow design | PROVISIONAL | MUST | 5 | End-to-end test |
| REQ-NOTIFY-021 | Recipient configuration | Operational control | PROVISIONAL | MUST | 5 | Admin test |
| REQ-NOTIFY-022 | Content snapshot | Audit requirement | PROVISIONAL | MUST | 5 | Data integrity test |
| REQ-NOTIFY-023 | Attachment controls | Security baseline | PROVISIONAL | MUST | 5 | Security test |
| REQ-NOTIFY-024 | Opt-out/suppression | Survey design | PROVISIONAL | MUST | 2 | Rule test |
| REQ-NOTIFY-025 | Mail permission minimization | Official Microsoft documentation | PROVISIONAL | MUST | 5 | Security review |
| REQ-ASSET-001 | Asset type catalogue | DMAIC pp. 14-15, 27 | PROVISIONAL | MUST | 4 | Admin test |
| REQ-ASSET-002 | Issued asset source | DMAIC p. 8 | PROVISIONAL | MUST | 4 | Integration/fallback test |
| REQ-ASSET-003 | Case asset generation | DMAIC pp. 10, 27 | PROVISIONAL | MUST | 4 | Rule test |
| REQ-ASSET-004 | Asset identifier | Asset control | PROVISIONAL | MUST | 4 | Validation test |
| REQ-ASSET-005 | Expected return date | DMAIC p. 12 | PROVISIONAL | MUST | 4 | Scheduling test |
| REQ-ASSET-006 | Disposition states | DEC-008 | PROVISIONAL | MUST | 4 | State test |
| REQ-ASSET-007 | Receipt evidence | DMAIC p. 27 | PROVISIONAL | MUST | 4 | Validation test |
| REQ-ASSET-008 | Condition and remarks | DMAIC p. 27 | PROVISIONAL | MUST | 4 | UI test |
| REQ-ASSET-009 | Automated reminders | DMAIC pp. 12, 14-15 | PROVISIONAL | MUST | 4 | Scheduler test |
| REQ-ASSET-010 | Asset exception | Control plan | PROVISIONAL | MUST | 4 | Workflow test |
| REQ-ASSET-011 | No automatic pay action | DEC-009 | PROVISIONAL | MUST | 4 | Negative integration test |
| REQ-ASSET-012 | Documentation compliance metric | KPI-007 | PROVISIONAL | MUST | 6 | Reporting test |
| REQ-ASSET-013 | Recovery metric | KPI-008 | PROVISIONAL | MUST | 6 | Reporting test |
| REQ-ASSET-014 | Clearance gate | DEC-026 | PROVISIONAL | MUST | 4 | End-to-end test |
| REQ-ASSET-015 | Waiver authority | Control design | PROVISIONAL | MUST | 4 | Authorization test |
| REQ-ASSET-016 | High-risk escalation | Risk analysis | PROVISIONAL | MUST | 4 | Workflow test |
| REQ-ASSET-017 | Manual asset addition | Operational need | PROVISIONAL | SHOULD | 4 | Authorization test |
| REQ-ASSET-018 | Asset history | Audit principle | PROVISIONAL | MUST | 4 | Audit test |
| REQ-ASSET-019 | Department visibility | Least privilege | PROVISIONAL | MUST | 4 | Authorization test |
| REQ-HAND-001 | Configurable handover module | DEC-001 | PROVISIONAL | MUST | 4 | Rule test |
| REQ-HAND-002 | Manager assignment | DMAIC pp. 6, 16 | PROVISIONAL | MUST | 4 | Assignment test |
| REQ-HAND-003 | Structured handover items | DMAIC p. 16 | PROVISIONAL | MUST | 4 | UI and data test |
| REQ-HAND-004 | Item owner | Process improvement | PROVISIONAL | MUST | 4 | Validation test |
| REQ-HAND-005 | Due dates | Process improvement | PROVISIONAL | MUST | 4 | Scheduling test |
| REQ-HAND-006 | Item state | Workflow design | PROVISIONAL | MUST | 4 | State test |
| REQ-HAND-007 | Risk recording | Risk analysis | PROVISIONAL | MUST | 4 | End-to-end test |
| REQ-HAND-008 | Manager sign-off | DMAIC p. 16 | PROVISIONAL | MUST | 4 | Authorization test |
| REQ-HAND-009 | No credentials | Security baseline | PROVISIONAL | MUST | 4 | UI content and security test |
| REQ-HAND-010 | Links not secrets | Security baseline | PROVISIONAL | SHOULD | 4 | Review test |
| REQ-HAND-011 | Visibility | Least privilege | PROVISIONAL | MUST | 4 | Authorization test |
| REQ-HAND-012 | Immediate departure fallback | DMAIC root cause | PROVISIONAL | MUST | 4 | End-to-end test |
| REQ-SURVEY-001 | Versioned survey definition | DMAIC pp. 12, 15 | PROVISIONAL | MUST | 2 | Data integrity test |
| REQ-SURVEY-002 | Short core survey | DMAIC p. 12 | PROVISIONAL | MUST | 2 | Configuration test |
| REQ-SURVEY-003 | Eligibility decision | DEC-014 | PROVISIONAL | MUST | 2 | Rule and audit test |
| REQ-SURVEY-004 | Verified personal contact | DMAIC p. 12 | PROVISIONAL | MUST | 2 | Validation test |
| REQ-SURVEY-005 | Single-purpose token | DEC-012 | PROVISIONAL | MUST | 2 | Security test |
| REQ-SURVEY-006 | Hashed token storage | Security baseline | PROVISIONAL | MUST | 2 | Security review/test |
| REQ-SURVEY-007 | Single use | Security baseline | PROVISIONAL | MUST | 2 | Security test |
| REQ-SURVEY-008 | Expiry | DEC-012 | PROVISIONAL | MUST | 2 | Security/UI test |
| REQ-SURVEY-009 | Initial timing | DEC-013 | PROVISIONAL | MUST | 2 | Scheduler test |
| REQ-SURVEY-010 | Reminder timing | DEC-013 | PROVISIONAL | MUST | 2 | Scheduler test |
| REQ-SURVEY-011 | No internal case exposure | Privacy design | PROVISIONAL | MUST | 2 | Authorization test |
| REQ-SURVEY-012 | Mobile accessibility | DMAIC p. 12 | PROVISIONAL | MUST | 2 | Accessibility/e2e test |
| REQ-SURVEY-013 | Privacy notice | DMAIC p. 16 | PROVISIONAL | MUST | 2 | Content and UI test |
| REQ-SURVEY-014 | Response channel | DMAIC p. 12 | PROVISIONAL | MUST | 2 | Data test |
| REQ-SURVEY-015 | Verbal debrief entry | DMAIC p. 12 | PROVISIONAL | MUST | 2 | Authorization test |
| REQ-SURVEY-016 | Non-response reason | KPI-009 | PROVISIONAL | MUST | 2 | Data and reporting test |
| REQ-SURVEY-017 | Restricted identifiable access | DEC-011 | PROVISIONAL | MUST | 2 | Authorization test |
| REQ-SURVEY-018 | Manager reporting | DEC-011 | PROVISIONAL | MUST | 6 | Authorization and report test |
| REQ-SURVEY-019 | Aggregate suppression | DEC-024 | OPEN | MUST | 6 | Reporting test after decision |
| REQ-SURVEY-020 | Completion metric | KPI-009 | PROVISIONAL | MUST | 6 | Reporting test |
| REQ-SURVEY-021 | Termination applicability | DEC-014 | OPEN | MUST | 2 | Rule test after decision |
| REQ-SURVEY-022 | Free-text caution | Privacy design | PROVISIONAL | SHOULD | 2 | Content test |
| REQ-SURVEY-023 | Edit before submit | Usability | PROVISIONAL | MUST | 2 | E2E test |
| REQ-SURVEY-024 | No edit after submit by respondent | Data integrity | PROVISIONAL | MUST | 2 | Security/e2e test |
| REQ-SURVEY-025 | Survey analytics taxonomy | Reporting need | PROVISIONAL | MUST | 2 | Data test |
| REQ-SURVEY-026 | Invitation suppression | Operational need | PROVISIONAL | MUST | 2 | Workflow test |
| REQ-REPORT-001 | HR dashboard | DMAIC pp. 18-19 | PROVISIONAL | MUST | 1 | UI and authorization test |
| REQ-REPORT-002 | Role-specific dashboards | DMAIC p. 7 | PROVISIONAL | MUST | 3 | Authorization/UI test |
| REQ-REPORT-003 | Metric dictionary enforcement | Control plan | PROVISIONAL | MUST | 6 | Reporting tests |
| REQ-REPORT-004 | Active case view | DMAIC p. 19 | PROVISIONAL | MUST | 1 | UI test |
| REQ-REPORT-005 | Upcoming departures | Operational improvement | PROVISIONAL | SHOULD | 1 | UI test |
| REQ-REPORT-006 | Overdue ageing | DMAIC p. 18 | PROVISIONAL | MUST | 3 | Reporting test |
| REQ-REPORT-007 | Document performance | KPI-002, KPI-003 | PROVISIONAL | MUST | 6 | Reporting test |
| REQ-REPORT-008 | Notification performance | KPI-004, KPI-005 | PROVISIONAL | MUST | 6 | Reporting test |
| REQ-REPORT-009 | Access revocation performance | KPI-006 | PROVISIONAL | MUST | 6 | Reporting test |
| REQ-REPORT-010 | Asset reporting | KPI-007, KPI-008 | PROVISIONAL | MUST | 6 | Reporting test |
| REQ-REPORT-011 | Survey reporting | KPI-009 | PROVISIONAL | MUST | 6 | Reporting test |
| REQ-REPORT-012 | Exception feed | DMAIC p. 18 | PROVISIONAL | MUST | 3 | UI and integration test |
| REQ-REPORT-013 | Trend reporting | DMAIC pp. 18-20 | PROVISIONAL | MUST | 6 | Reporting test |
| REQ-REPORT-014 | Cohort comparison | DEC-007; Directive 0.1 section C | PROVISIONAL | MUST | 6 | Reporting test; OPERATIONAL-default test |
| REQ-REPORT-015 | Filters | DMAIC p. 18 | PROVISIONAL | MUST | 6 | UI test |
| REQ-REPORT-016 | Export redaction | Privacy baseline | PROVISIONAL | MUST | 6 | Authorization/export test |
| REQ-REPORT-017 | Small-cohort protection | DEC-024 | OPEN | MUST | 6 | Privacy/reporting test |
| REQ-REPORT-018 | Data freshness | Integration design | PROVISIONAL | SHOULD | 6 | UI test |
| REQ-REPORT-019 | Scheduled management report | DMAIC p. 16 | PROVISIONAL | SHOULD | 6 | Scheduler and authorization test |
| REQ-REPORT-020 | Baseline data export | DMAIC p. 8; DEC-007 | PROVISIONAL | MUST | 1 | Reporting test |
| REQ-SEC-001 | Production SSO | DEC-021; constrained by IC-S1-005 | OPEN | MUST | 1 | Security integration test after decision |
| REQ-SEC-002 | MFA dependency | Security baseline | PROVISIONAL | MUST | 1 | Security review |
| REQ-SEC-003 | Development login safeguards | Operating rules | PROVISIONAL | MUST | 1 | Configuration test |
| REQ-SEC-004 | Secure session | Security baseline | PROVISIONAL | MUST | 1 | Security test |
| REQ-SEC-005 | Server-side authorization | Security baseline | PROVISIONAL | MUST | 1 | Authorization tests |
| REQ-SEC-006 | Least privilege RBAC | RolesAndPermissions.md | PROVISIONAL | MUST | 1 | Authorization review/test |
| REQ-SEC-007 | Record-level authorization | DEC-035 | PROVISIONAL | MUST | 1 | IDOR/authorization tests |
| REQ-SEC-008 | Restricted termination cases | DEC-035 | PROVISIONAL | MUST | 1 | Authorization test |
| REQ-SEC-009 | Restricted survey data | DEC-011 | PROVISIONAL | MUST | 2 | Authorization/audit test |
| REQ-SEC-010 | System admin data isolation | Roles baseline | PROVISIONAL | MUST | 1 | Security test |
| REQ-SEC-011 | TLS | Security baseline | PROVISIONAL | MUST | 1 | Configuration scan |
| REQ-SEC-012 | Encryption at rest | Security baseline | PROVISIONAL | MUST | 1 | Architecture evidence |
| REQ-SEC-013 | Secrets management | Risk R6 | PROVISIONAL | MUST | 1 | Secret scan and review |
| REQ-SEC-014 | CSRF protection | OWASP baseline | PROVISIONAL | MUST | 1 | Security test |
| REQ-SEC-015 | Security headers | OWASP baseline | PROVISIONAL | MUST | 1 | Automated security scan |
| REQ-SEC-016 | Rate limiting | Threat model | PROVISIONAL | MUST | 2 | Security test |
| REQ-SEC-017 | Input validation | OWASP baseline | PROVISIONAL | MUST | 1 | Unit/fuzz tests |
| REQ-SEC-018 | Output encoding | OWASP baseline | PROVISIONAL | MUST | 1 | Security test |
| REQ-SEC-019 | Upload allow-list | Threat model | PROVISIONAL | MUST | 1 | Upload tests |
| REQ-SEC-020 | Upload quarantine and scanning | Security baseline | PROVISIONAL | MUST | 1 | Failure-injection test |
| REQ-SEC-021 | Safe filenames | OWASP baseline | PROVISIONAL | MUST | 1 | Security test |
| REQ-SEC-022 | Authorized downloads | Security baseline | PROVISIONAL | MUST | 1 | Authorization test |
| REQ-SEC-023 | PII-safe logs | Privacy baseline | PROVISIONAL | MUST | 1 | Log inspection test |
| REQ-SEC-024 | Immutable audit events | Validated root cause | PROVISIONAL | MUST | 1 | Data integrity test |
| REQ-SEC-025 | Audit clock | Audit design | PROVISIONAL | MUST | 1 | Unit test |
| REQ-SEC-026 | Backup and restore | Risk R4 | PROVISIONAL | MUST | 7 | Restore exercise |
| REQ-SEC-027 | Dependency scanning | Secure SDLC | PROVISIONAL | MUST | 1 | CI evidence |
| REQ-SEC-028 | Static analysis | Secure SDLC | PROVISIONAL | MUST | 1 | CI evidence |
| REQ-SEC-029 | Dynamic security testing | OWASP ASVS | PROVISIONAL | MUST | 7 | Security report |
| REQ-SEC-030 | ASVS baseline | Official OWASP | PROVISIONAL | MUST | 7 | Security checklist |
| REQ-SEC-031 | No production data in development | Risk R5 | PROVISIONAL | MUST | 1 | Review and tests |
| REQ-SEC-032 | Admin change audit | Governance | PROVISIONAL | MUST | 1 | Audit test |
| REQ-SEC-033 | Token entropy | Threat model | PROVISIONAL | MUST | 2 | Security test |
| REQ-SEC-034 | Error handling | OWASP baseline | PROVISIONAL | MUST | 1 | Security test |
| REQ-SEC-035 | Incident support | Risk R5 | PROVISIONAL | MUST | 7 | Runbook exercise |
| REQ-SEC-036 | Manual fallback | Risk R4 | PROVISIONAL | MUST | 7 | Tabletop exercise |
| REQ-SEC-037 | Environment separation | Security baseline | PROVISIONAL | MUST | 1 | Configuration review |
| REQ-SEC-038 | Change protection | Secure SDLC | PROVISIONAL | MUST | 1 | Deployment evidence |
| REQ-SEC-039 | Sensitive action re-authentication | Threat model | PROVISIONAL | SHOULD | 7 | Security test |
| REQ-SEC-040 | Accessibility security compatibility | WCAG 2.2 | PROVISIONAL | MUST | 7 | Accessibility test |
| REQ-PRIV-001 | Purpose specification | Jamaica data protection standards | PROVISIONAL | MUST | 1 | Privacy review |
| REQ-PRIV-002 | Data minimization | Jamaica data protection standards | PROVISIONAL | MUST | 1 | Privacy/authorization test |
| REQ-PRIV-003 | Data classification | Risk R5 | PROVISIONAL | MUST | 1 | Data dictionary review |
| REQ-PRIV-004 | Accuracy support | Jamaica data protection standards | PROVISIONAL | MUST | 1 | Data integrity test |
| REQ-PRIV-005 | Privacy notices | DMAIC p. 16 | PROVISIONAL | MUST | 2 | Content review |
| REQ-PRIV-006 | Configurable retention | DEC-023 | OPEN | MUST | 7 | Retention tests after decision |
| REQ-PRIV-007 | Automated disposition jobs | DEC-023 | OPEN | MUST | 7 | Retention test |
| REQ-PRIV-008 | Legal hold | Retention design | PROVISIONAL | MUST | 7 | Authorization test |
| REQ-PRIV-009 | Data subject access support | Jamaica data protection standards | PROVISIONAL | MUST | 7 | Privacy workflow test |
| REQ-PRIV-010 | Correction support | Jamaica data protection standards | PROVISIONAL | MUST | 1 | Audit test |
| REQ-PRIV-011 | Cross-border review | DEC-030; Jamaica data protection standards | PROVISIONAL | MUST | 1 | Governance evidence |
| REQ-PRIV-012 | Processor inventory | Privacy governance | PROVISIONAL | MUST | 7 | Documentation review |
| REQ-PRIV-013 | DPIA support | Official OIC obligations/guidance | PROVISIONAL | MUST | 7 | Approval evidence |
| REQ-PRIV-014 | Breach clock support | OIC states 72-hour breach reporting obligation | PROVISIONAL | MUST | 7 | Tabletop test |
| REQ-PRIV-015 | Affected-person notification support | Official OIC obligations | PROVISIONAL | MUST | 7 | Runbook test |
| REQ-PRIV-016 | Third-party sharing log | DMAIC pp. 16, 26 | PROVISIONAL | MUST | 5 | Audit test |
| REQ-PRIV-017 | Survey confidentiality model | DEC-015 | OPEN | MUST | 2 | Content test after decision |
| REQ-PRIV-018 | Aggregate de-identification | DEC-011, DEC-024 | PROVISIONAL | MUST | 6 | Privacy test |
| REQ-PRIV-019 | AI assessment | DEC-030 | PROVISIONAL | MUST | Future | Governance evidence |
| REQ-PRIV-020 | Sensitive access review | Privacy control | PROVISIONAL | MUST | 6 | Reporting test |
| REQ-PRIV-021 | Consent/legal basis recording | Privacy/legal review | OPEN | SHOULD | 7 | Workflow test after decision |
| REQ-PRIV-022 | Data disposal evidence | Storage limitation | PROVISIONAL | MUST | 7 | Audit test |
| REQ-PRIV-023 | Personal email protection | Survey design | PROVISIONAL | MUST | 1 | Authorization test |
| REQ-PRIV-024 | Free-text minimization | Data minimization | PROVISIONAL | SHOULD | 1 | UI test |
| REQ-INT-001 | Adapter boundaries | Architecture direction | PROVISIONAL | MUST | 1 | Architecture review |
| REQ-INT-002 | BambooHR read-only MVP | DEC-018 | PROVISIONAL | MUST | 5 | Contract test |
| REQ-INT-003 | Dedicated identity | DEC-019 | PROVISIONAL | MUST | 5 | Security review |
| REQ-INT-004 | Field permission inventory | Official BambooHR documentation | PROVISIONAL | MUST | 5 | Integration test |
| REQ-INT-005 | Snapshot timestamp | Data integrity | PROVISIONAL | MUST | 5 | Contract test |
| REQ-INT-006 | Stale data handling | Reliability | PROVISIONAL | MUST | 5 | Failure test |
| REQ-INT-007 | Event-based webhook preference | Official BambooHR documentation | PROVISIONAL | SHOULD | 5 | Architecture review |
| REQ-INT-008 | Webhook signature verification | Official BambooHR documentation | PROVISIONAL | MUST | 5 | Security contract test |
| REQ-INT-009 | Webhook replay protection | Threat model | PROVISIONAL | MUST | 5 | Security test |
| REQ-INT-010 | Webhook retries and idempotency | Official BambooHR documentation | PROVISIONAL | MUST | 5 | Failure test |
| REQ-INT-011 | Integration reconciliation | Reliability design | PROVISIONAL | MUST | 5 | Reconciliation test |
| REQ-INT-012 | Microsoft Graph v1.0 | Official Microsoft documentation | PROVISIONAL | MUST | 5 | Integration review |
| REQ-INT-013 | Graph acceptance semantics | Official Microsoft documentation | PROVISIONAL | MUST | 5 | Contract test |
| REQ-INT-014 | Mailbox scope | Official Microsoft permissions documentation | PROVISIONAL | MUST | 5 | Security review |
| REQ-INT-015 | Credential rotation | Security baseline | PROVISIONAL | MUST | 5 | Runbook review |
| REQ-INT-016 | Health monitoring | Operations | PROVISIONAL | MUST | 5 | Monitoring test |
| REQ-INT-017 | Stub providers | No live dev integrations | PROVISIONAL | MUST | 1 | Test |
| REQ-INT-018 | No production connection by default | Security baseline | PROVISIONAL | MUST | 1 | Configuration test |
| REQ-INT-019 | External recipient configuration | DEC-017 | PROVISIONAL | MUST | 5 | Admin test |
| REQ-INT-020 | Integration idempotency | Reliability design | PROVISIONAL | MUST | 5 | Contract tests |
| REQ-INT-021 | Manual import fallback | Business continuity | PROVISIONAL | SHOULD | 1 | Import test |
| REQ-INT-022 | Error work queue | DMAIC p. 18 | PROVISIONAL | MUST | 5 | Workflow test |
| REQ-INT-023 | Unknown fields tolerance | Official BambooHR guidance | PROVISIONAL | MUST | 5 | Contract test |
| REQ-INT-024 | Integration event archive | Privacy/security | PROVISIONAL | MUST | 5 | Log review |
| REQ-ADMIN-001 | User and role administration | Roles baseline | PROVISIONAL | MUST | 1 | Authorization test |
| REQ-ADMIN-002 | No self-escalation | Security baseline | PROVISIONAL | MUST | 1 | Negative test |
| REQ-ADMIN-003 | Department and location configuration | DMAIC reporting needs | PROVISIONAL | MUST | 1 | Admin test |
| REQ-ADMIN-004 | Workflow administration | Workflow versioning | PROVISIONAL | MUST | 3 | Admin test |
| REQ-ADMIN-005 | Template administration | Risk R2 | PROVISIONAL | MUST | 2 | Admin/authorization test |
| REQ-ADMIN-006 | Business calendar | DEC-027 | PROVISIONAL | MUST | 1 | Calendar/admin test |
| REQ-ADMIN-007 | Reason taxonomy | DEC-031; constrained by IC-S1-008 | OPEN | MUST | 1 | Admin test after decision |
| REQ-ADMIN-008 | Asset catalogue | Asset design | PROVISIONAL | MUST | 4 | Admin test |
| REQ-ADMIN-009 | Recipient directory | Notification design | PROVISIONAL | MUST | 5 | Admin test |
| REQ-ADMIN-010 | Feature flags | DEC-007 | PROVISIONAL | MUST | 1 | Admin/configuration test |
| REQ-ADMIN-011 | Retention policy configuration | DEC-023 | OPEN | MUST | 7 | Authorization test after decision |
| REQ-ADMIN-012 | Audit viewer | Control plan | PROVISIONAL | MUST | 6 | UI/authorization test |
| REQ-ADMIN-013 | Configuration versioning | Governance | PROVISIONAL | MUST | 1 | Data integrity test |
| REQ-ADMIN-014 | Controlled correction | Audit principle | PROVISIONAL | MUST | 1 | Code review/negative test |
| REQ-ADMIN-015 | Break-glass administration | Security baseline | PROVISIONAL | MUST | 7 | Tabletop/security test |
| REQ-ADMIN-016 | Operational health page | Operations | PROVISIONAL | MUST | 5 | UI test |
| REQ-ADMIN-017 | Survey settings | Survey design | PROVISIONAL | MUST | 2 | Admin test |
| REQ-ADMIN-018 | Export settings | Privacy baseline | PROVISIONAL | SHOULD | 6 | Admin test |
| REQ-NFR-001 | Modular monolith | Architecture direction | PROVISIONAL | MUST | 1 | Architecture review |
| REQ-NFR-002 | Relational integrity | Architecture direction | PROVISIONAL | MUST | 1 | Migration/schema tests |
| REQ-NFR-003 | Transactional outbox reliability | Architecture direction | PROVISIONAL | MUST | 5 | Integration test |
| REQ-NFR-004 | Maintainable TypeScript | Architecture direction | PROVISIONAL | MUST | 1 | Type check |
| REQ-NFR-005 | Schema validation | Architecture direction | PROVISIONAL | MUST | 1 | Unit test |
| REQ-NFR-006 | Accessibility target | Official W3C | PROVISIONAL | MUST | 1 | Accessibility test |
| REQ-NFR-007 | Responsive design | Survey/UX needs | PROVISIONAL | MUST | 1 | E2E test |
| REQ-NFR-008 | Performance target | Non-functional baseline | OPEN | SHOULD | 7 | Performance test after environment decision |
| REQ-NFR-009 | Queue latency | Operational baseline | OPEN | MUST | 5 | Scheduler test after decision |
| REQ-NFR-010 | Availability objective | DEC-029 | OPEN | MUST | 7 | Monitoring evidence |
| REQ-NFR-011 | RPO/RTO | DEC-029 | OPEN | MUST | 7 | Restore exercise |
| REQ-NFR-012 | Observability | Operations | PROVISIONAL | MUST | 1 | Monitoring test |
| REQ-NFR-013 | Supportability | Operations | PROVISIONAL | MUST | 1 | Support test |
| REQ-NFR-014 | Browser support | UX baseline | OPEN | MUST | 7 | Compatibility test |
| REQ-NFR-015 | Timezone handling | DEC-027 | PROVISIONAL | MUST | 1 | Unit test |
| REQ-NFR-016 | Localization readiness | Forward-looking design | PROVISIONAL | SHOULD | 1 | Code review |
| REQ-NFR-017 | Data volume | Source baseline ~3 cases/month | PROVISIONAL | MUST | 1 | Capacity review |
| REQ-NFR-018 | File limits | Security baseline | PROVISIONAL | MUST | 1 | Upload test |
| REQ-NFR-019 | Graceful degradation | Risk R4 | PROVISIONAL | MUST | 5 | Failure test |
| REQ-NFR-020 | Test pyramid | Test strategy | PROVISIONAL | MUST | 1 | CI evidence |
| REQ-NFR-021 | Migration safety | Operations | PROVISIONAL | MUST | 1 | Migration evidence |
| REQ-NFR-022 | No unbounded background work | Reliability | PROVISIONAL | MUST | 3 | Failure test |
| REQ-NFR-023 | Documentation as code | Risk R6 | PROVISIONAL | MUST | 1 | Review gate |
| REQ-NFR-024 | Auditability over convenience | Validated root cause | PROVISIONAL | MUST | 1 | Architecture/code review |

## Traceability maintenance

When implementation work changes a requirement:

1. update the requirement catalogue;
2. update this matrix;
3. update affected business rules, user stories, state/workflow design and tests;
4. add or update the Decision Register/change request;
5. record the implementation commit and release in the change record.
