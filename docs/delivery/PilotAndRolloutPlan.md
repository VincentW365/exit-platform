# Baseline, Pilot and Rollout Plan

**Baseline version:** 0.1
**Prepared:** 2026-07-28
**Status:** Proposed; pilot dates and named participants remain subject to sponsor, HR and IT approval.

## 1. Objective

Introduce the product without contaminating the current-state baseline, exposing real employee data in development, or treating a technically successful deployment as operational acceptance.

The rollout has five controlled periods:

1. preparation and approvals;
2. four-to-six-week current-state baseline capture;
3. synthetic/UAT validation;
4. live operational pilot for two consecutive reporting months;
5. full rollout and post-implementation control.

## 2. Cohort model

Every case carries two distinct dimensions. They must not be collapsed into a single enum.

### Measurement cohort — the business-analysis dimension

Exactly three values. Required on every `OPERATIONAL` record.

| Measurement cohort | Meaning | Automation state | Reporting treatment |
| --- | --- | --- | --- |
| `BASELINE` | Current/manual process measurement before improvement | Improvement automation off; system may capture facts only | Establish current performance; never mix with pilot |
| `PILOT` | Approved limited production use | Only pilot-approved features enabled | Compared with baseline and pilot targets |
| `POST_ROLLOUT` | Normal production process after sponsor sign-off | Approved production feature set | Monitored against full targets |

### Record purpose — the data-use dimension

Exactly three values. Set when the record is created.

| Record purpose | Meaning | Measurement cohort | Integrations | Reporting treatment |
| --- | --- | --- | --- | --- |
| `OPERATIONAL` | Real business record | Required | Per approved feature set | Included, subject to cohort |
| `TRAINING` | Synthetic training/demonstration data | Must be absent | Never live | Excluded from all business reporting |
| `TEST` | Automated or engineering test data | Must be absent | Never live | Excluded from all business reporting |

`TRAINING` and `TEST` are **not** business cohorts. Records so marked must be synthetic and are excluded from operational KPIs, management reports, baseline/pilot/post-rollout reports, notification performance, document-turnaround performance, survey completion performance, asset recovery performance and business-volume reporting. Reports default to `record_purpose = OPERATIONAL`.

### Change control for both dimensions

- Measurement-cohort changes require an authorized correction event and must not silently rewrite historical metrics.
- Record purpose may change only through an authorized, reasoned, audited correction, and only before the record has been used operationally.
- An `OPERATIONAL` record must never be silently converted to `TRAINING` or `TEST` to remove it from reporting, nor may `TRAINING` or `TEST` records be silently converted to `OPERATIONAL`.

## 3. Phase A — Preparation

### Entry criteria

- documentation package validated;
- Stage 1 blocking decisions resolved;
- product owner, HR owner and technical owner named;
- development and production data boundaries approved;
- no source-DMAIC personal data copied into the repository;
- baseline data-capture owners trained.

### Activities

- confirm metric definitions and source timestamps;
- approve baseline log and exclusions;
- confirm Jamaica holiday calendar;
- identify all offboarding cases during the period through an independent source such as HR's termination/resignation register;
- establish weekly completeness reconciliation;
- configure feature flags so baseline cases cannot trigger letters, surveys or notifications;
- document manual fallback and urgent IT contact paths.

### Exit criteria

- baseline process and forms approved;
- first completeness reconciliation tested with synthetic data;
- environment guard proves live integrations cannot be enabled accidentally.

## 4. Phase B — Four-to-six-week baseline capture

The DMAIC states that three of the four initial metrics were not recorded and proposes a four-to-six-week manual baseline. The platform may be used as a structured measurement register only when its improvement automations are disabled.

### Minimum captured fields

- case identifier;
- departure type;
- receipt date/time and source;
- proposed and confirmed last working/effective date;
- document requested, approved and issued timestamps;
- departmental notification timestamps;
- access-removal requested, due and completed timestamps;
- issued assets due, returned and final disposition;
- exit-interview/survey offered, delivered and completed status;
- process-completion timestamp;
- exclusions and evidence references.

### Control against baseline contamination

- `BASELINE` cohort is set at case creation;
- automated template generation, reminders, survey dispatch and provider notification remain disabled;
- capture screens do not introduce earlier prompts or escalations that materially improve the measured process;
- any emergency use of an improvement feature is flagged as a deviation and excluded or separately reported;
- baseline completeness is reconciled weekly against an independent HR case list.

### Baseline sufficiency review

At the end of week four, the Process Analyst reviews:

- number of cases and departure-type mix;
- missing fields and inconsistent timestamps;
- whether the period includes enough cases to establish useful descriptive measures;
- whether extension to six weeks is required;
- whether medians and individual-case detail are more informative than percentages because of low volume.

A small case volume does not invalidate the baseline, but targets must be interpreted with the numerator and denominator visible.

## 5. Phase C — UAT and operational readiness

UAT uses synthetic or formally sanitized data only.

### UAT personas

- HR Manager;
- HR Officer;
- IT responder;
- Finance responder;
- line manager;
- auditor;
- system administrator without normal HR-case access;
- external survey respondent.

### Mandatory UAT scenarios

1. resignation with notice;
2. immediate resignation with urgent access-removal time;
3. restricted termination invisible to unauthorized users;
4. corrected effective date and due-date recalculation;
5. controlled letter preview, approval, issue and supersession;
6. survey delivery through a non-production sink, completion, replay and expiry;
7. blocked task, waiver and escalation;
8. asset returned, not issued, lost, damaged and waived outcomes;
9. handover completion without entering secrets;
10. provider failure and manual fallback;
11. case completion blocked by unresolved mandatory work;
12. controlled report/export and small-cohort protection.

### Readiness evidence

- all critical paths pass;
- no unresolved Critical or High severity defect without written risk acceptance;
- security, privacy and accessibility checklists completed for pilot scope;
- backup/restore and fallback tabletop completed;
- training materials and support contacts available;
- feature flags and rollback plan tested;
- production recipient configuration independently reviewed.

## 6. Phase D — Limited production pilot

### Pilot duration

Two consecutive full reporting months after the first complete pilot case. The sponsor may extend the pilot where case volume is too low to evaluate the process responsibly.

### Pilot population

All in-scope departures during the approved pilot period unless HR explicitly documents a policy or operational exclusion. Exclusions remain visible in reporting.

### Recommended feature scope

- secure HR case creation and approval;
- three approved workflow types;
- department queues and exact-time IT tasks;
- controlled documents;
- asset and handover tracking;
- survey and reminders;
- approved notification channels;
- exception feed and pilot reports;
- manual fallback.

Do not enable optional AI during the pilot unless it has a separate approved change, privacy assessment and test plan.

### Source-aligned pilot exit criteria

Over two consecutive reporting months:

| Measure | Pilot criterion |
| --- | --- |
| Case capture | 100% of in-scope cases logged within one business day |
| Letter turnaround | At least 90% of qualifying letters issued within two business days |
| Notification accuracy | At least 98%, with no unreported dispatch failures |
| Exit feedback | At least 60% of eligible, successfully delivered invitations completed |
| Access removal | 100% completed no later than the approved effective separation time, or every miss formally investigated |
| Asset documentation | 100% of required assets have a final documented disposition before completion |
| Workflow integrity | 100% of completed cases pass the closure-integrity check |
| Privacy/security | No unresolved material unauthorized disclosure or access-control defect |
| Support readiness | Every incident and manual fallback reconciled into the case record |

Because the source baseline indicates approximately three cases per month, show counts beside percentages. A single miss must not be hidden by rounding.

### Pilot review cadence

- per case: HR closure review;
- weekly: open exceptions, upcoming departures, overdue work and integration failures;
- monthly: KPI/control review and risk review;
- end of pilot: formal go/no-go report.

## 7. Go/no-go decision

### Go

All mandatory criteria are met, open defects are within approved tolerance, operational owners accept the product, and sponsor approval is recorded.

### Conditional go

Only non-critical limitations remain; each has:

- documented business impact;
- owner;
- compensating control;
- deadline;
- accepted residual risk.

### No-go

Any of the following blocks rollout:

- unauthorized access to restricted data;
- inability to execute urgent access removal reliably;
- duplicate or incorrect external notifications without an effective control;
- unresolved data loss/restore failure;
- inability to complete a case with trustworthy evidence;
- missing operational/support ownership;
- retention, privacy or production-integration decisions required for the enabled scope remain open.

## 8. Phase E — Full rollout

### Activities

- enable approved production cohort and features;
- train all assigned roles;
- publish concise role-specific job aids;
- maintain heightened daily monitoring for the first two weeks;
- review every completed case for the first month;
- transition defects and enhancements to normal change control;
- preserve baseline and pilot reports for comparison.

### Full target

The source target for exit feedback rises from at least 60% during pilot to at least 80% after rollout. Other approved KPI targets remain as defined in `../requirements/MetricsDictionary.md`.

## 9. Rollback

Rollback is an operational state, not deletion of pilot evidence.

Triggers include:

- material privacy/security event;
- repeated incorrect or duplicate communications;
- unresolved exact-time task failures;
- sustained outage without safe fallback;
- data-integrity defect affecting case closure;
- sponsor/HR/IT decision.

Rollback actions:

1. disable live automation through controlled flags;
2. preserve data and audit evidence;
3. switch to the approved manual fallback;
4. notify operational owners;
5. reconcile in-flight tasks and communications;
6. investigate and correct;
7. repeat affected readiness tests before re-enable.

## 10. Training and adoption

Training is role based:

- HR: case lifecycle, approvals, exceptions, privacy, corrections and reports;
- IT/Finance/managers: minimal queues, due dates, evidence and blockers;
- auditors: read-only evidence and exports;
- administrators: configuration without routine HR-data access;
- support: incident, restore, integration and no-send controls.

Training completion, attendance and unresolved questions are recorded before pilot access is granted.

## 11. Post-implementation review

Conduct at approximately 30, 60 and 90 days after rollout:

- baseline/pilot/post-rollout comparison;
- process adherence and off-platform workarounds;
- KPI quality and denominators;
- user feedback;
- privacy/security incidents and access review;
- integration and notification failure trends;
- outstanding risks and change requests;
- support workload and ownership;
- sponsor decision on further enhancements.

## 12. Required outputs

- baseline summary and data-quality report;
- UAT approval;
- security/privacy/accessibility evidence;
- pilot case and KPI report;
- risk and defect disposition;
- support handover;
- go/no-go record;
- post-implementation review.
