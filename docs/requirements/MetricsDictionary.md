# Metrics Dictionary

All dashboards, pilot decisions and post-implementation claims must use these definitions. A metric is not complete without its numerator/denominator or statistic, exclusions, cohort, owner and reaction plan.

## Global measurement rules

- Store instants in UTC; apply `America/Jamaica` for business rules and display.
- Business-day calculations use the approved holiday calendar version.
- Preserve the timestamps used when an event occurs; do not recalculate historical performance from later-edited dates.
- Report BASELINE, PILOT and POST_ROLLOUT measurement cohorts separately by default.
- Default every metric to `record_purpose = OPERATIONAL`. TRAINING and TEST records are synthetic and are excluded from all operational KPIs, management reports, cohort reports, notification and document-turnaround performance, survey completion, asset recovery and business-volume reporting. TRAINING and TEST are record purposes, not measurement cohorts.
- Show counts and exclusions beside percentages.
- A provider's technical acceptance is not final delivery evidence.
- For low monthly volumes, show rolling periods and raw counts; do not over-interpret one case.

## KPI-001 — Case capture compliance

| Field | Definition |
| --- | --- |
| Definition | Percentage of in-scope departures entered as an offboarding case within one business day of the controlling receipt timestamp. |
| Numerator/statistic | Cases whose `created_at` is no later than the end of the first business day after `received_at`. |
| Denominator | All in-scope departures received in the reporting period. |
| Exclusions | Cases later proven to be duplicates or voided as non-events; exclusions remain visible. |
| Target | 100% during pilot and production. |
| Owner | HR Manager |
| Frequency | Per case; monthly summary |
| Reaction plan | Log missing case immediately, identify cause, and review repeated failures. |

## KPI-002 — Acceptance-letter turnaround

| Field | Definition |
| --- | --- |
| Definition | Business time from resignation receipt to issuance of the final approved acceptance/acknowledgement letter. |
| Numerator/statistic | Eligible resignation cases issued within two business days. |
| Denominator | Eligible resignation cases requiring a letter. |
| Exclusions | Termination cases; cases placed on approved hold for missing employee/date information are reported separately, not silently removed. |
| Target | At least 90% in pilot; 100% operational target; each case ≤2 business days. |
| Owner | HR Manager |
| Frequency | Per case; monthly summary |
| Reaction plan | Issue manually the same day after breach, investigate source/template/approval delay, escalate recurring failures. |

## KPI-003 — Document field accuracy

| Field | Definition |
| --- | --- |
| Definition | Percentage of issued controlled documents with no post-issuance correction to a required data field. |
| Numerator/statistic | Issued documents with zero correction/supersession caused by incorrect required fields. |
| Denominator | All issued controlled documents in the period. |
| Exclusions | Cosmetic reformatting that does not alter meaning, tracked separately. |
| Target | 100%. |
| Owner | HR Manager |
| Frequency | Per document; monthly summary |
| Reaction plan | Correct and supersede document, record defect category, review validation/source mapping after any error. |

## KPI-004 — Notification timeliness

| Field | Definition |
| --- | --- |
| Definition | Percentage of required notifications submitted to the provider by their rule-based deadline. |
| Numerator/statistic | Required notifications with `submitted_at` on or before `due_at`. |
| Denominator | All required notifications due in the period. |
| Exclusions | Notifications cancelled because applicability was removed before dispatch; cancellations remain auditable. |
| Target | 100% within the applicable SLA; departmental general target within 24 hours of approval. |
| Owner | HR Manager |
| Frequency | Per notification; monthly summary |
| Reaction plan | Use manual fallback within four hours of detection and log an incident. |

## KPI-005 — Notification accuracy

| Field | Definition |
| --- | --- |
| Definition | Percentage of submitted notifications using the correct template/version, recipient, employee, effective date, programme applicability, and approved content. |
| Numerator/statistic | Submitted notifications with all accuracy checks passed and no correction required. |
| Denominator | All submitted notifications. |
| Exclusions | Test/sandbox notifications. |
| Target | ≥98% during pilot and 100% operational aspiration; no unreported failures. |
| Owner | HR Manager |
| Frequency | Per notification; monthly summary |
| Reaction plan | Stop affected template/integration if systemic, send corrected notice, and perform recipient/data impact review. |

## KPI-006 — Access revocation timeliness

| Field | Definition |
| --- | --- |
| Definition | Percentage of required access-removal tasks completed no later than the approved effective separation time. |
| Numerator/statistic | Required revocation tasks completed by `effective_at`, or by an explicitly approved immediate deadline. |
| Denominator | All cases with access-revocation requirements. |
| Exclusions | Systems formally documented as not provisioned; still counted in completeness checks. |
| Target | 100%. |
| Owner | IT Manager / HR Manager |
| Frequency | Per case; monthly summary |
| Reaction plan | Urgent escalation to IT and HR, document exposure window, evaluate security incident criteria. |

## KPI-007 — Asset disposition documentation compliance

| Field | Definition |
| --- | --- |
| Definition | Percentage of required case asset items with a final approved disposition. |
| Numerator/statistic | Required asset items in RETURNED, NOT_ISSUED, LOST, DAMAGED, WAIVED, or approved UNRESOLVED terminal disposition. |
| Denominator | All required case asset items. |
| Exclusions | None; not-applicable assets must be explicitly recorded. |
| Target | 100% before case completion. |
| Owner | HR Officer |
| Frequency | Per case; monthly summary |
| Reaction plan | Block final completion, assign owner, and escalate unresolved high-value items. |

## KPI-008 — Physical asset recovery rate

| Field | Definition |
| --- | --- |
| Definition | Percentage of issued assets due for return that are physically returned. |
| Numerator/statistic | Issued assets marked RETURNED. |
| Denominator | Issued assets due for return, excluding approved NOT_ISSUED and WAIVED items. |
| Exclusions | Policy-approved waivers shown separately. |
| Target | Target to be approved by asset class; trend monitored. |
| Owner | HR Manager / Asset owners |
| Frequency | Per case; monthly summary |
| Reaction plan | Follow approved recovery process; do not automatically alter final pay. |

## KPI-009 — Exit feedback completion

| Field | Definition |
| --- | --- |
| Definition | Percentage of eligible, successfully delivered exit-feedback invitations that result in a completed survey or documented HR verbal debrief. |
| Numerator/statistic | Eligible cases with completed survey or qualifying verbal debrief. |
| Denominator | Eligible cases whose invitation was successfully delivered, plus eligible cases handled by approved verbal route. |
| Exclusions | Policy-excluded cases, deceased employees, invalid personal contact after documented attempts, and explicit opt-outs; all exclusions reported. |
| Target | ≥60% during pilot; ≥80% after full rollout. |
| Owner | HR Manager |
| Frequency | Monthly |
| Reaction plan | Review timing, channel, question length, delivery failures, and non-response patterns. |

## KPI-010 — Overdue task rate

| Field | Definition |
| --- | --- |
| Definition | Percentage of due mandatory tasks not in a terminal acceptable state by the end of the reporting period. |
| Numerator/statistic | Mandatory tasks overdue and not COMPLETED, WAIVED, or CANCELLED with valid reason. |
| Denominator | All mandatory tasks that became due in the period. |
| Exclusions | Approved pause periods are reported separately. |
| Target | 0 unactioned tasks overdue more than three days; downward trend for all overdue tasks. |
| Owner | HR Manager |
| Frequency | Daily operational; monthly summary |
| Reaction plan | Notify owner, escalate after configured thresholds, review recurring bottlenecks. |

## KPI-011 — End-to-end offboarding cycle time

| Field | Definition |
| --- | --- |
| Definition | Elapsed and business time from controlling receipt timestamp to final case completion, segmented by departure type. |
| Numerator/statistic | Not applicable; report median, 75th percentile, 90th percentile, and maximum. |
| Denominator | Completed cases in the cohort. |
| Exclusions | Voided cases; on-hold time reported both included and excluded. |
| Target | Baseline first; target set after 4–6 weeks of valid data. |
| Owner | Process Analyst / HR Manager |
| Frequency | Monthly/quarterly |
| Reaction plan | Investigate step-level duration and bottlenecks rather than optimizing only the headline. |

## KPI-012 — Workflow completeness

| Field | Definition |
| --- | --- |
| Definition | Percentage of completed cases with every mandatory task completed or validly waived and every required approval/evidence present. |
| Numerator/statistic | Completed cases passing the closure integrity check. |
| Denominator | All completed cases. |
| Exclusions | None. |
| Target | 100%. |
| Owner | HR Manager / Auditor |
| Frequency | Per completion; monthly audit |
| Reaction plan | Reopen defective case, record control failure, correct configuration or training. |

## KPI-013 — Offboarding case volume

| Field | Definition |
| --- | --- |
| Definition | Count of cases received and completed by month, departure type, location, and department. |
| Numerator/statistic | Count only. |
| Denominator | Not applicable. |
| Exclusions | Voided duplicates shown separately. |
| Target | Monitor only; source baseline approximately three cases per month. |
| Owner | HR Manager |
| Frequency | Monthly |
| Reaction plan | Use for capacity planning; no performance judgement based on volume alone. |

## Pilot decision rule

The source DMAIC proposes a two-consecutive-month pilot. The approved pilot uses the following minimums, subject to adequate case volume and qualitative UAT:

- 100% case capture within one business day;
- at least 90% of eligible letters within two business days;
- notification accuracy at or above 98%, with no unreported failures;
- at least 60% eligible exit-feedback completion;
- 100% closure integrity and asset disposition documentation;
- 100% access-revocation tasks completed by effective time;
- no unresolved critical security/privacy defects.

Because source volume is approximately three cases per month, the sponsor should consider whether two months provides enough evidence. Raw case review remains mandatory even when percentages appear strong.
