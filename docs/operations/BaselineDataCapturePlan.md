# Baseline Data Capture Plan

**Baseline version:** 0.1
**Prepared:** 2026-07-28
**Owner:** HR Manager; analysis by Process Analyst
**Duration:** Four to six weeks after approval, subject to the sufficiency review below.

## 1. Purpose

Establish a trustworthy current-state measure before improvement automation changes the process.

The source DMAIC notes that exit-interview completion, processing time and asset recovery were not consistently recorded. The baseline therefore focuses on complete event timestamps and outcome evidence rather than retrospective estimates.

## 2. Baseline questions

1. How many offboarding cases occur and what is the departure-type mix?
2. How quickly are cases recorded after HR receives the initiating event?
3. How long does the qualifying acceptance/acknowledgement document take?
4. When are departments notified?
5. Is access removed by the effective separation time?
6. Are issued assets returned or otherwise documented?
7. How often is exit feedback offered, delivered and completed?
8. Which tasks are delayed, skipped or reconstructed from email/paper?
9. What data is missing and why?

## 3. Population

Include every in-scope employee departure received during the baseline period:

- resignation with notice;
- immediate resignation;
- termination;
- other approved separation types only when a clear mapping is recorded.

Do not sample. Reconcile the register weekly against an independent HR source.

Training, duplicate, voided-before-process and test cases are excluded but remain counted in a data-quality reconciliation.

## 4. Measurement boundary

Baseline starts at the authoritative receipt event approved by HR and ends when the current manual process is considered complete.

Each case records:

- source of receipt;
- receipt date/time;
- proposed and confirmed effective date/time;
- documentation completion;
- departmental notification;
- access-removal request/due/completion;
- asset outcomes;
- exit-feedback events;
- final process completion;
- exceptions and missing evidence.

Do not backdate events based on memory. When original evidence is unavailable, mark the field `UNKNOWN` with a reason and recorder.

## 5. Data collection table

| Field/event | Definition | Source/evidence | Recorder | Timing |
| --- | --- | --- | --- | --- |
| Case receipt | First verified receipt by HR of resignation/termination instruction | email metadata, signed letter receipt or approved HR record | HR Officer | same business day |
| Case logged | Baseline-register creation timestamp | application/manual log | system/HR | automatic |
| Departure type | Approved category | HR decision/source document | HR | at creation |
| Effective separation | Confirmed date and exact time | HR-approved record | HR Manager | when confirmed |
| Document request | Date/time preparation begins or is assigned | current process evidence | HR | per event |
| Document approval | Authorized approval timestamp | email/signature/current approval | HR | per event |
| Document issue | Date/time sent or delivered | sent item/receipt | HR | per event |
| Notification sent | Department/provider and date/time | sent item/current evidence | HR | per event |
| Access request/due/complete | Exact timestamps | HR request and IT evidence | HR/IT | per event |
| Asset due/returned/disposition | Issued asset and outcome | asset/checklist evidence | HR/receiver | per event |
| Exit feedback offered | Interview/survey offered timestamp and channel | invitation/form | HR | per event |
| Exit feedback completed | Completed interview/survey timestamp | current record | HR | per event |
| Process complete | Current-process completion decision | HR sign-off | HR Manager | at closure |
| Missing/deviation | Missing field, reason and impact | recorder statement | HR | as discovered |

## 6. Baseline capture mode

Where the Stage 1 application is used:

- set cohort to `BASELINE`;
- disable all improvement automation;
- do not generate/issue controlled letters through the new feature;
- do not send automatic survey invitations/reminders;
- do not send automatic department/provider notifications;
- do not introduce new escalation prompts that materially change current performance;
- allow only structured recording, missing-field prompts and neutral completeness checks;
- record any accidental automation as a deviation.

If application prompts themselves accelerate the process, note the limitation and retain a parallel indicator of pre-platform behaviour.

## 7. Metric calculations

Use the exact formulas in `../requirements/MetricsDictionary.md`.

Baseline outputs must show:

- numerator and denominator;
- counts;
- median and range for cycle times;
- individual case values where volume is small and access permits;
- exclusions and unknown values;
- data-completeness percentage;
- departure type;
- week;
- baseline cohort only.

Do not present a percentage without its count.

## 8. Data-quality controls

### Completeness

Weekly compare:

```text
Cases in baseline register
vs.
independent HR resignation/termination list
```

Investigate all unmatched items.

### Timestamp integrity

- use system-generated capture time in addition to reported event time;
- keep source/evidence reference;
- prevent future event dates unless explicitly scheduled;
- flag event sequences that are impossible;
- preserve corrections with original value and reason.

### Classification

- use controlled enums for departure type, event/outcome and missing reason;
- do not create ad hoc spelling variants;
- retain restricted termination visibility.

### Privacy

- collect only fields needed for the defined metrics;
- do not place survey free text in the baseline measurement table;
- restrict exports to authorized HR/analysis users;
- use company-controlled storage;
- do not share identifiable baseline case details in broad presentations.

## 9. Missing-data reason codes

| Code | Meaning |
| --- | --- |
| `NOT_RECORDED_CURRENT_PROCESS` | Event may have occurred but current process created no evidence |
| `SOURCE_UNAVAILABLE` | Expected source could not be accessed |
| `NOT_APPLICABLE` | Event legitimately does not apply |
| `CASE_IN_PROGRESS` | Event has not occurred by report cutoff |
| `DISPUTED` | Conflicting records require HR resolution |
| `UNKNOWN_OTHER` | Unknown; explanation required |

`NOT_APPLICABLE` is not treated as a failure when the approved metric excludes it. Unknowns remain visible.

## 10. Weekly review

Participants: HR Manager, assigned HR recorder and Process Analyst.

Review:

- newly identified cases;
- missing/unmatched cases;
- overdue data entry;
- impossible/inconsistent timestamps;
- deviations from baseline mode;
- operational issues requiring immediate action;
- whether collection instructions need clarification without changing definitions.

Do not wait for baseline end to correct a live security or employee-impact issue.

## 11. Four-week sufficiency checkpoint

At week four assess:

- number of cases;
- representation of departure types;
- completeness by field;
- stability of definitions;
- unusual one-off cases;
- whether another two weeks is likely to add useful information.

Extend to six weeks when:

- fewer cases than expected occurred;
- material fields remain missing;
- the period was operationally abnormal;
- definitions changed and need a clean period;
- sponsor/HR determines more observation is needed.

A longer period may be approved, but the improvement build can continue in non-production so long as baseline automation remains off and the analysis does not mix cohorts.

## 12. Baseline report

The final report contains:

1. period and case count;
2. departure-type mix;
3. data completeness;
4. metric results with counts and distributions;
5. task/exception observations;
6. known limitations;
7. deviations/contamination;
8. comparison readiness;
9. recommendations that do not rewrite the approved baseline.

The report is approved by HR Manager and Process Analyst and retained with the project evidence.

## 13. Baseline-to-pilot comparability

Before pilot comparison confirm:

- same event definitions;
- same timezone/business calendar;
- same eligibility/exclusion logic;
- any changed definition is disclosed;
- baseline and pilot cohorts are never combined;
- low-volume interpretation shows counts and does not overstate statistical certainty.
