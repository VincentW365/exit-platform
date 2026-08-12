# Test Strategy

## 1. Objective

Prove that the product enforces business, authorization, privacy, workflow, reliability and accessibility requirements—not only that pages render.

## 2. Test layers

### Static and build checks

- formatting;
- lint;
- strict TypeScript;
- schema generation/validation;
- dependency and secret scan;
- Markdown link/requirement consistency;
- build for web and worker.

### Unit tests

Use for:

- business-day calculations;
- state transition guards;
- applicability rules;
- due-date recalculation;
- KPI formulas;
- template placeholder validation;
- authorization policy functions;
- token hashing/expiry logic;
- idempotency key construction;
- classification/redaction;
- closure-integrity rules.

### Database/integration tests

Use a real isolated PostgreSQL test database for:

- constraints and transactions;
- optimistic concurrency;
- workflow instantiation;
- outbox atomicity;
- worker claiming/retries;
- audit append;
- role/record filters;
- retention/legal-hold dry run;
- file metadata and supersession;
- aggregate report queries.

Mocks alone are insufficient for database and transaction guarantees.

### Contract tests

Provider adapters:

- BambooHR response/permission/error/stale scenarios;
- webhook signature, timestamp, batching and unknown fields;
- email provider accepted/transient/permanent/bounce scenarios;
- object storage unavailable/hash mismatch;
- malware scanner clean/reject/timeout;
- identity claim mapping.

Use official examples and recorded synthetic fixtures; never production payloads.

### End-to-end tests

Critical browser paths:

1. HR creates and approves resignation-with-notice case.
2. HR creates urgent immediate-resignation case; IT task due exactly.
3. restricted termination case is invisible to unauthorized users.
4. controlled letter generation/approval/issue/correction.
5. survey invitation through sink, token submit, replay/expiry rejection.
6. IT/Finance/manager minimal queues.
7. task blocker/waiver/escalation.
8. asset disposition/exception.
9. handover and no-secret guidance.
10. notification approval, dispatch, failure and manual fallback.
11. clearance blocked then completed.
12. reports and cohort/privacy filters.
13. role grant/break-glass where implemented.

### Security tests

- authorization/IDOR matrix;
- CSRF;
- XSS/encoding;
- upload polyglot/path/oversize;
- survey token brute force/replay/concurrency;
- session/role revocation;
- secret/log inspection;
- webhook spoof/replay;
- duplicate dispatch after crash;
- export/download authorization;
- restricted search/count leakage;
- dependency/SAST/DAST;
- backup restore and no-send mode.

### Accessibility tests

Automated plus manual:

- keyboard/focus;
- landmarks/headings;
- labels/errors;
- contrast;
- zoom/reflow;
- screen-reader spot checks;
- status not colour-only;
- data-table semantics;
- survey mobile and review/submit;
- timeout/security controls.

### Performance and resilience

Given low volume, focus on predictability rather than high throughput:

- p95 common page/API response under provisional target;
- queue begins work within target;
- exact-time jobs under clock skew/restart;
- concurrent approval/update conflict;
- worker crash at each dispatch step;
- provider outage;
- database/object/scanner outage;
- backlog recovery without duplicates;
- report queries over synthetic 10-year volume;
- file size limits.

## 3. Test data

Use deterministic synthetic fixtures:

```text
EMP-TEST-001 Avery Brown — resignation with notice
EMP-TEST-002 Jordan Lee — immediate resignation
EMP-TEST-003 Morgan Reed — restricted termination
EMP-TEST-004 Taylor Singh — provider not applicable
EMP-TEST-005 Casey Grant — invalid personal email
```

Never use source appendix identities or real company records.

Fixture dimensions:

- departure type;
- classification;
- department/location;
- enrolled/not enrolled;
- systems/assets;
- dates crossing weekend/holiday;
- open/block/waive;
- delivery failure/bounce;
- survey eligible/ineligible/suppressed;
- small reporting cohort.

## 4. Authorization test matrix

For every resource/action, test:

- allowed role and in-scope record;
- same role but out-of-scope record;
- unauthorized role;
- restricted case;
- no assignment;
- explicit participant;
- system administrator;
- auditor/privacy scope;
- list/count/search;
- detail;
- mutation;
- file/download;
- export;
- direct API call independent of UI.

A single “not logged in” test is not adequate.

## 5. State-machine tests

For each state machine:

- every allowed transition;
- every forbidden shortcut;
- authority;
- required reason/evidence;
- idempotent repeat;
- concurrent attempt;
- audit/history;
- downstream effects;
- cancellation/void/reopen;
- rollback on transaction failure.

## 6. Metric tests

Each KPI receives synthetic fixtures with:

- numerator success/failure;
- denominator inclusion;
- every exclusion;
- timezone/weekend/holiday boundary;
- changed date and preserved original;
- baseline/pilot/post cohort;
- low-volume raw count;
- manual fallback;
- submitted versus delivered;
- small-cohort suppression where relevant.

Product owner/HR manually verifies expected values before report acceptance.

## 7. Stage test gates

| Stage | Required minimum |
| --- | --- |
| 1 | Build/lint/type; database migrations; auth/record authorization; case lifecycle; audit; upload boundary; baseline export; dev-login guard |
| 2 | Template/render/approval; immutable issue/supersession; survey token/expiry/replay; accessibility; sink scheduling |
| 3 | Workflow/state/dependency/due-date/idempotency; exact-time IT; departmental authorization; blocker/waiver/escalation; closure negative paths |
| 4 | Asset dispositions/metrics/no-pay effect; handover/no-secrets; clearance/reopen |
| 5 | Outbox atomicity; worker crash/retry; duplicate prevention; provider contracts; webhook HMAC/replay; reconciliation; no-live-dev |
| 6 | KPI reconciliation; cohort comparison; access-aware drilldown/export; small-cohort suppression; report performance |
| 7 | ASVS-based review; DAST; full accessibility; performance/resilience; backup/restore; incident/fallback tabletop; UAT/regression |

## 8. UAT scenarios

### UAT-01 Notice resignation

HR captures an email resignation, confirms date, issues acknowledgement, coordinates departments, completes assets/handover and closes with valid evidence.

### UAT-02 Immediate resignation

HR records immediate departure, IT receives urgent exact-time work, acknowledgement follows, assets are unresolved then dispositioned, survey is sent post-departure.

### UAT-03 Restricted termination

Preparation is invisible to unauthorized users; tasks release at the approved point; no resignation wording or reason disclosure occurs.

### UAT-04 Wrong/missing data

Document/notification approval is blocked until required source fields and recipient configuration are fixed.

### UAT-05 Provider failure

Email provider fails; retries occur without duplicate; exception is visible; manual fallback is recorded.

### UAT-06 Date change

HR changes last day; impact preview shows affected tasks/notices; prior dates remain historical.

### UAT-07 Case cannot close

Missing IT evidence or asset disposition blocks completion and clearly explains the next action.

### UAT-08 Survey privacy

Manager sees aggregate only; HR sees authorized detail; small cohort is suppressed; forwarded/expired token reveals no case data.

### UAT-09 Downtime fallback

Urgent access removal proceeds through approved manual process and is reconciled later.

### UAT-10 Audit

Auditor reconstructs the entire case without modifying it and sees appropriate redaction.

### Directive 6.1 additions (2026-08-11)

New suites: `packages/domain/test/orgGraph.test.ts` and
`auditCategories.test.ts` (unit); `packages/db/test-int/directive61OrgSync
.test.ts`, `directive61Assignment.test.ts`, `directive61AuditCentre.test.ts`
(integration); `e2e/directive61-flows.spec.ts` and `e2e/directive61-visual
.spec.ts` (E2E incl. 1440/1280/768/375 responsive + axe). The synthetic
fixture directory now carries a manager graph (11 EMP-TEST employees) so
organization-aware routing is fully testable with synthetic data; activation
in every suite goes through the shared assignment-plan step. Realistic
(aliased) UAT is facilitator-run and never part of automated suites.

### Gap-proofing and theme additions (2026-08-11, owner-directed)

Deployment-gap protection, permanent from this point on:

- `packages/db/test-int/processCompleteness.test.ts` - every seeded workflow
  type (resignation with notice, immediate resignation, restricted
  termination) is driven from draft to COMPLETED using services only; a task
  with no completion path fails the suite naming the stuck task codes.
- `e2e/route-coverage.spec.ts` - every application route renders for every
  role (content or a polite denial - never a 500, an error boundary, or a
  dead page), plus every case tab on a live case.
- `e2e/dark-mode.spec.ts` - theme toggle, persistence, dark-palette axe
  scans, and the topbar quick case search.

UAT accounts are function-named (DEC-040): specs sign in as "HR Manager",
"Second IT Responder", etc. The environment is rebuilt with
`scripts/reset-environment.ts` (status | purge-live | uat | fresh, DEC-041).

## 9. Defect severity

| Severity | Definition | Release treatment |
| --- | --- | --- |
| Critical | Unauthorized restricted access, duplicate/wrong sensitive send, unsafe upload/RCE, missing exact-time security control, data loss/corruption | Block release; immediate remediation |
| High | Major workflow/control/privacy failure with material workaround risk | Block stage/pilot unless authorized risk acceptance |
| Medium | Important usability/reporting/operational defect with viable controlled workaround | Plan before or during pilot with owner/date |
| Low | Cosmetic/minor issue not affecting control or accessibility | Backlog according to priority |

Accessibility failures that prevent task completion can be High/Critical, not automatically Low.

## 10. Test evidence

Claude must report exact commands/results. Release evidence includes:

- test summary by layer;
- failed/skipped/quarantined tests and reasons;
- coverage for critical domain modules (coverage percentage is supporting, not sole evidence);
- authorization matrix result;
- migration status;
- screenshots/video only with synthetic data;
- security/accessibility reports;
- UAT sign-off;
- known defects/risk acceptance;
- commit hash and environment.
