# Exit Survey Specification

**Baseline version:** 0.1
**Prepared:** 2026-07-28
**Status:** Proposed. HR and Privacy must approve eligibility, confidentiality wording, question content, retention and reporting threshold before activation.

## 1. Objective

Increase useful exit-feedback completion without exposing internal case data, overburdening the respondent or implying that participation is mandatory.

The initial survey should take approximately three to five minutes and contain five to eight core questions.

## 2. Design principles

- voluntary;
- plain language;
- mobile first;
- one question per logical topic;
- no forced free-text explanation;
- approved confidentiality/privacy notice before submission;
- minimal identity and metadata;
- one-time expiring link;
- identifiable responses restricted to authorized HR unless an approved anonymous design is implemented;
- no manager access to individual answers;
- aggregate reporting protected by cohort suppression;
- HR-recorded verbal debrief is a separate response channel.

## 3. Eligibility

HR records one of:

| Status | Meaning |
| --- | --- |
| `ELIGIBLE` | Approved to invite |
| `INELIGIBLE_POLICY` | Excluded by approved departure/policy rule |
| `NO_VERIFIED_CONTACT` | No verified personal delivery address |
| `SUPPRESSED_BY_HR` | HR suppresses for a documented case-specific reason |
| `DEFERRED` | Invite rescheduled with date/reason |
| `DECLINED` | Employee explicitly declines |
| `NOT_APPLICABLE` | Approved non-survey case type |
| `UNKNOWN_REVIEW_REQUIRED` | Eligibility not yet decided |

Termination cases default to no automatic invitation until the policy owner approves the rule. Eligibility changes require actor, reason, timestamp and audit.

## 4. Timing

Provisional approved pattern:

- initial invitation: day 3 after the effective separation date;
- reminder: day 7 after the effective separation date;
- no reminder after response, decline, suppression or expiry;
- HR may reschedule/suppress;
- use America/Jamaica for scheduling;
- invitation expiry is configurable and stated clearly.

The scheduler must be idempotent and must not send to external recipients for records in the `BASELINE` measurement cohort or with `TRAINING` or `TEST` record purpose. Survey completion reporting defaults to `record_purpose = OPERATIONAL`, so training and test responses never affect the completion KPI.

## 5. Respondent identity and token

- no normal internal account required;
- generate at least 128 bits of cryptographic entropy;
- store only a secure token hash;
- token is tied to one invitation/survey version;
- single use;
- expires;
- rate limited;
- raw token excluded from logs/analytics/referrers where technically possible;
- invalid, expired and used tokens receive a neutral response;
- public page does not reveal employee name, department, departure reason, case status or eligibility;
- concurrent double submission accepts only one final response.

## 6. Privacy/confidentiality notice

The page must display the approved version before questions.

It should state, accurately:

- who is collecting the response;
- why feedback is collected;
- whether the response is identifiable, confidential or anonymous;
- who can view individual responses;
- how aggregate reporting is used;
- whether any question is optional;
- expected retention or link to the approved notice;
- contact route for privacy questions/rights;
- voluntary nature and any approved statement about consequences;
- limits where content raises safety, misconduct, legal or other escalation concerns.

Do not promise anonymity if a token links the response to a case and the link is retained.

Record the notice version presented and acceptance/acknowledgement event where approved.

## 7. Draft core questions

These are product specifications, not final HR-approved wording.

| ID | Draft question | Type | Required | Purpose/reporting |
| --- | --- | --- | --- | --- |
| `Q-001` | What was the main reason you decided to leave? | Single select controlled taxonomy + `Prefer not to say` + optional `Other` | Yes, with prefer-not option | reason distribution |
| `Q-002` | Which factors influenced your decision? | Multi-select, maximum configured choices | No | contributing factors |
| `Q-003` | Overall, how would you rate your experience working with the company? | 1–5 labelled scale | No | experience trend |
| `Q-004` | How supported did you feel by your immediate manager/supervisor? | 1–5 labelled scale + not applicable/prefer not | No | management-support trend |
| `Q-005` | How clear and manageable were your role expectations and workload? | 1–5 labelled scale + not applicable/prefer not | No | role/workload trend |
| `Q-006` | What is one thing the company could improve for employees? | Optional text with length limit | No | qualitative improvement |
| `Q-007` | Is there anything else you would like HR to know? | Optional text with length limit and escalation notice | No | additional feedback |

Potential alternatives such as recommendation score, pay/benefit detail or branch-specific questions require approval and should not make the survey longer without evidence.

## 8. Controlled reason/factor taxonomy

HR owns a versioned taxonomy. Suggested high-level categories for discussion:

- career development/opportunity;
- compensation/benefits;
- management/supervision;
- work environment/culture;
- workload/schedule;
- location/transport;
- personal/family;
- health/wellbeing;
- retirement;
- education;
- relocation;
- contract/end of assignment;
- other;
- prefer not to say.

Do not infer a reason from free text or automatically overwrite the HR case reason. Survey reason and administrative reason are separate fields.

## 9. Question behaviour

- scales show text labels at meaningful points;
- no ambiguous numeric-only inputs;
- `Prefer not to say` available for sensitive questions;
- optional text length is bounded;
- line breaks and safe characters are allowed;
- HTML/script is treated as text;
- autosave is avoided unless privacy/token behaviour is approved;
- respondent can review before final submission;
- final submission is explicit;
- no editing after submission unless HR policy defines a controlled correction process.

## 10. Response model

Record:

- response ID;
- invitation ID;
- case reference in restricted storage;
- survey version;
- privacy-notice version;
- channel: `ONLINE`, `VERBAL_HR_RECORDED`, other approved value;
- started/submitted timestamps;
- answers;
- responder-selected prefer-not flags;
- HR recorder for verbal response;
- completion/outcome;
- technical anti-abuse metadata minimized and retained under approved policy.

Do not copy response text into general case notes or operational logs.

## 11. HR-recorded verbal debrief

Where no online response is received and policy permits:

- HR conducts a voluntary conversation;
- uses the same approved question set or a clearly identified verbal version;
- records the channel and HR recorder;
- distinguishes exact employee statements from HR summary;
- avoids recording unnecessary allegations/details in broad fields;
- follows the approved escalation path for serious concerns;
- does not impersonate the employee in the online form.

## 12. Serious or sensitive feedback

The application must not use AI to decide whether an allegation is valid or what employment action to take.

The interface should permit authorized HR to:

- flag a response for restricted follow-up;
- assign an HR owner;
- record a safe category and action reference;
- restrict visibility further;
- preserve original response;
- avoid copying sensitive detail into notifications.

Policy owners define mandatory escalation categories and access.

## 13. Reporting

### Operational

- invitations eligible;
- invitations scheduled/submitted/delivery failed;
- responses completed;
- declined/suppressed/ineligible/no contact;
- reminder status;
- response rate with numerator/denominator.

### Aggregate

- total/eligible/completed counts;
- reason/factor distributions;
- scale distributions/trends;
- cohort/time comparison;
- no segmented result below approved threshold;
- no manager drill-through to individuals;
- optional free text accessible only to authorized HR, not placed in standard dashboards.

## 14. Completion denominator

Recommended formula:

```text
Completed eligible online or approved verbal responses
divided by
Eligible invitations successfully submitted/delivered under the approved rule
```

The final definition is in `../requirements/MetricsDictionary.md`. Show exclusions such as ineligible, invalid/no verified contact or policy suppression separately.

## 15. Accessibility

- WCAG 2.2 AA target;
- mobile reflow;
- keyboard operable;
- visible focus;
- programmatic labels/instructions;
- errors adjacent to fields and summarized;
- no timeout while actively responding unless security requires it and warning/extension is provided;
- scale labels readable by screen readers;
- no colour-only state;
- review page identifies unanswered optional questions without coercion.

## 16. Security tests

- token hash not raw;
- entropy source;
- expiry;
- replay/concurrent submit;
- brute-force/rate limit;
- neutral invalid response;
- cross-case access;
- response authorization;
- referrer/log leakage;
- XSS/encoding;
- CSRF where relevant;
- duplicate schedule;
- no-send environment guard;
- small-cohort leakage;
- export restrictions.

## 17. Retention

Response and invitation retention are separate configurable record classes. Production durations and anonymization/deletion rules remain subject to approved HR/privacy policy. Legal hold must suspend automated disposition where approved.

## 18. Acceptance criteria

- eligible respondent can complete the approved survey from a one-time link;
- no internal case data is exposed;
- one response only;
- unauthorized users cannot list/read identifiable responses or infer restricted counts;
- reminders follow approved schedule and suppression;
- all versions and outcomes are auditable;
- metrics reconcile to synthetic fixtures;
- no source-DMAIC personal data is used.
