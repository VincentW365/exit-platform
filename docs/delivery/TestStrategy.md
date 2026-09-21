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
- HR Manager privacy/audit scope (DEC-042);
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

The HR Manager reconstructs the entire case in the Audit Centre; restricted rows outside their participation stay minimized (DEC-042).

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
- `e2e/keyboard.spec.ts` - the keyboard standards (DEC-059), driven with
  no mouse at all: Enter in the employee search runs the search and
  nothing else (the reported defect, asserted by counting browser
  validation reports across the navigation), Enter and the Search button
  are equivalent, an empty search is answered in its own words, arrow keys
  and Escape work the results, Enter in a step field never creates the
  case, a settled step reopens from its header, a confirmation dialog owns
  and returns focus, a whole case is created keyboard-only, a submit
  button cannot be pressed twice, and `/` reaches the case search. This is
  the automated stand-in for the directive's keyboard-only walkthrough; a
  human walkthrough on the UAT workstation is still owed and is recorded
  in the UAT plan when done.
- `pnpm regression:offboarding` (`e2e/offboarding-regression/`, its own
  `playwright.regression.config.ts`) - the full offboarding workflow
  regression and evidence pack: one controlled employee through every
  separation type discovered from the platform's profiles, in the UAT email
  posture, producing a per-run folder under `test-results/offboarding-e2e/`
  with result.md/json per scenario, .eml routing evidence, PDFs, link
  evidence, audit timelines and a summary.html with the exception list
  first. See `docs/delivery/OffboardingRegressionSuite.md`.

### BambooHR directory additions (2026-09-15)

- Unit (`packages/domain/test/directorySync.test.ts`): freshness thresholds
  (current / delayed / stale / alert / never), hourly and nightly (02:00
  Jamaica) due rules, start-up staleness, webhook HMAC verification (wrong
  key, tampered body, replayed timestamp, missing headers, closed endpoint),
  webhook payload parsing, mirrored-field change detection (names only),
  record status words.
- Integration (`packages/db/test-int/directorySync.test.ts`, fixture adapter
  only): initial sync with manager links by identifier; new, updated and
  manager-changed employees; an employee absent from the feed is archived,
  never deleted, and their case survives; webhook follow-up reads one
  employee and repeats are idempotent; a simulated source outage leaves the
  cache untouched and searchable, the status honest, and recovery succeeds;
  one run at a time under the lease; duplicate manual refreshes queue one
  run; abandoned runs are closed; HR-only directory reads and
  administrator/HR-Manager log access; existing-case protection (DEC-061).
- End-to-end (`e2e/directory.spec.ts`): the HR directory, a profile with
  its reporting line, "Start offboarding" pre-selecting the employee at
  intake, the existing-case notice and confirmation, the administrator's
  health panel, "Refresh Directory Now" and the synchronization log, the
  closed webhook endpoint.
- Regression evidence (`pnpm regression:offboarding`, test "DIR BambooHR
  Directory"): `BambooHR Directory/{initial-sync, manager-resolution,
  manual-refresh, webhook-update, hourly-reconciliation, offline-cache}`
  with screenshots, the platform's own JSON and notes.md per proof; the
  signed-webhook proof uses a per-run key generated by the runner and
  never written to the evidence.

UAT accounts are function-named (DEC-040): specs sign in as "HR Manager",
"Second IT Responder", etc. The environment is rebuilt with
`scripts/reset-environment.ts` (status | purge-live | uat | fresh, DEC-041).

### Directive 6.3 additions (2026-08-16)

**New unit suites:** `packages/domain/test/derivedActions.test.ts` (the
deterministic rules engine: same facts → same actions, benefits YES/NO/
UNKNOWN behaviour, issued-asset derivation, survey eligibility, termination
timing) and `packages/domain/test/emailActions.test.ts` (send control
resolution incl. restricted stricter-of, auto-send blockers, token
purposes/expiry, display-state projection, recipient validation). The
existing form/notification/clearance unit suites extend to the redesigned
state machines.

**New integration suites:** `directive63*` in `packages/db/test-int`,
covering derivation idempotency and overrides, derived notification
preparation and AUTO_SEND release with the AG gates, RECIPIENT_MISSING /
AUTO_SEND_BLOCKED / BENEFITS_APPLICABILITY_UNKNOWN / ACKNOWLEDGEMENT_OVERDUE
exception lifecycles, acknowledgement-token issue/redeem/replay/expiry/
revoke, HR-recorded evidence, officer form completion with the
configuration-gated review, dual-mode clearance and per-item asset
exception coverage, and notification template lifecycle.

**Invariants (the 20 Directive 6.3 acceptance-criteria invariants).** Every
one is enforced by at least one automated test:

1. No new case requires an IT or Finance application login for any step.
2. Manager approval of the Action Form does not exist for new forms; legacy
   statuses render forever and legacy live rows are never stranded.
3. The assigned HR Officer can complete an ordinary Action Form; HR-Manager
   review intervenes only when `actionForm.requireHrReview` is enabled.
4. Derivation is deterministic and fully provenanced (rule key, rules
   version, source fields, result) with an injectable clock.
5. Re-derivation is idempotent per (case, actionKey) and never duplicates a
   notification (idempotency key: case + type + recipient class + workflow
   version + effective event).
6. A derived notification with no recipient is never silently skipped: it
   raises RECIPIENT_MISSING (HIGH) and waits.
7. AUTO_SEND releases only when every condition holds (level, approved and
   verified recipient, ACTIVE template, complete body, confirmed
   applicability) AND the purpose/cohort/flag gates pass; otherwise
   AUTO_SEND_BLOCKED.
8. Restricted cases never send below the configured restricted override;
   the stricter level always wins.
9. Termination timing is confidential: IT releases no earlier than one hour
   before the effective instant; Finance at the effective instant.
10. Benefits applicability is YES/NO/UNKNOWN; UNKNOWN blocks v2 clearance
    and raises an exception; YES prepares; NO creates nothing.
11. Derived-action overrides require authority and a reason, are audited,
    and win over re-derivation until removed.
12. Acknowledgement tokens are CSPRNG, hash-only, single-use (atomic
    claim), purpose-limited, expiring, and fail neutrally.
13. Token redemption discloses only the action label and the case reference
    the email already carried - never case content or a session.
14. Email delivery is never completion evidence for IT access removal:
    clearance needs confirmed completion or an approved exception, and an
    unconfirmed IT action at the effective instant escalates CRITICAL.
15. Unresolved-asset exception coverage is per item, never case-wide.
16. Clearance is dual-mode: v1 instances clear task-based, v2 clears from
    email-action evidence; running cases are never reinterpreted.
17. The exit survey schedules automatically for eligible cases and never
    blocks clearance.
18. Every automated decision is a SYSTEM-actor audit event
    (DERIVED_ACTIONS_COMPUTED, NOTIFICATION_AUTO_PREPARED/AUTO_APPROVED,
    ACK_TOKEN_*, NOTIFICATION_SENT/ACKNOWLEDGED/COMPLETION_CONFIRMED).
19. No pay calculation, withholding or entitlement logic exists anywhere;
    asset outcomes carry no payroll effect.
20. HR-facing surfaces use business-language labels; raw enum values and
    governance identifiers appear only on administration/audit surfaces.

**Dynamic-fixture-date rule (permanent):** fixtures must not contain fixed
calendar dates. Date-anchored fixtures went stale and silently flipped test
semantics (logic review LR-009); all fixture instants are now derived from
the test run's clock (`test-int/helpers.ts`: FIXTURE_RECEIVED_AT ~25 days
back, FIXTURE_EFFECTIVE_AT 5 days ahead). A fixture with a literal calendar
date fails review.

**E2E journey changes:** new-case journeys no longer sign in as IT or
Finance responders anywhere - department confirmation happens through the
public acknowledgement route (`/ack/<token>`, exercised from the captured
email in `/dev/mailbox`), and the route sweep covers the public ack page
(valid, used, expired and implausible tokens all render neutrally).
IT/Finance sign-ins remain only in legacy-instance regression specs.
Journeys add: benefits confirmation, recipient-required resolution
(case-only entry and save-for-future), the exception-first required-actions
panel, and officer form completion without any manager approval step.

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
