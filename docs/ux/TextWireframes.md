# Text Wireframes

These wireframes define information priority and controls, not final pixel design.

## 1. HR Dashboard

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Offboarding                                      [Search] [Help] [Profile]  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Dashboard | Cases | Tasks | Approvals | Exceptions | Reports               │
├──────────────────────────────────────────────────────────────────────────────┤
│ Period: [This month v]  Cohort: [Pilot v]  Data as of 09:15                 │
│                                                                              │
│ [Active 8] [Next 7d 3] [Overdue 2] [Urgent IT 1] [Failures 1] [Clearance 2]│
│                                                                              │
│ MY NEXT ACTIONS                                                              │
│ Due       Case         Action                         Owner      Status       │
│ Today     OFF-00027    Approve acknowledgement       You        Due soon     │
│ 10:00     OFF-00028    Confirm effective time        You        Urgent       │
│ Tomorrow  OFF-00024    Review asset exception        You        Blocked      │
│                                                                              │
│ ACTIVE CASES                                            [View all cases]     │
│ Case       Employee      Type        Effective      Next step       SLA      │
│ OFF-...    Avery Brown   Notice      31 Jul 17:00  Letter approval  On track │
│ OFF-...    Jordan Lee    Immediate   28 Jul 09:30  IT evidence     Overdue   │
│                                                                              │
│ EXCEPTION FEED                                         [View all]           │
│ Critical  Access task overdue 18 min      OFF-...  Owner: IT Queue          │
│ High      External notice failed          OFF-...  Owner: HR Officer        │
│ Medium    Asset return unresolved         OFF-...  Owner: HR Officer        │
│                                                                              │
│ CONTROL SNAPSHOT                                                           │
│ Letters ≤2bd  5/6 (83%)   Notifications accurate 11/11 (100%)              │
│ Access on time 6/6 (100%) Asset dispositions 6/6 cases (100%)              │
│ Exit feedback 3/5 eligible (60%) [definitions]                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

Controls:

- cards show counts and denominators, not only percentages;
- restricted cases appear only to authorized participants;
- urgent access issue is visually prominent and not colour-only;
- every exception links to its next action.

## 2. Create Case — Employee and departure

```text
Step 1 Employee  ── Step 2 Departure ── Step 3 Documents ── Step 4 Review

Employee source
[ Search by employee number or name __________________ ] [Search]

Result
Avery Brown | EMP-TEST-001 | Parts | Spanish Town | Source: BambooHR
Retrieved: 28 Jul 2026 09:12  [Select]

Source unavailable? [Start controlled manual entry]
Manual entries require a reason and create a reconciliation task.

Departure details
Type*                 [Resignation with notice v]
Received at*          [2026-07-28] [09:00]
Receipt source*       [Email v]
Proposed last day     [2026-08-14]
Confirmed last day*   [2026-08-14]
Effective time*       [17:00]
Case owner*           [HR Officer v]
Classification*       [Restricted HR v]
Measurement cohort*   [Pilot v]

[Save draft] [Continue]
```

Validation:

- exact effective time required;
- termination sets restricted classification and limits participants;
- overlapping case warning includes link but no unauthorized detail;
- no workflow, letter or email starts from draft.

## 3. Case Overview

```text
PRIVATE & CONFIDENTIAL             OFF-00027             ACTIVE
Avery Brown | EMP-TEST-001 | Parts | Spanish Town
Resignation with notice
Received: 28 Jul 09:00 | Last day: 14 Aug | Effective: 14 Aug 17:00

NEXT REQUIRED ACTION
Approve acknowledgement letter
Owner: HR Manager | Due: 30 Jul 17:00 | [Review document]

Alerts
[!] One asset is not confirmed in the issued-asset source.
[ ] No overdue mandatory tasks.

Progress
Intake ✓  Letter 2/3  IT 1/2  Finance 0/1  Assets 2/5  Handover 1/4  Clearance 0/2

Tabs: Overview | Workflow | Documents | Notifications | Assets | Handover |
      Feedback | Exceptions | Audit

Case facts
Owner             HR Officer
Workflow          RESIGN_NOTICE_V1
Cohort            Pilot
Source snapshot   28 Jul 09:12
Personal email    [Restricted: authorized HR only]
Reason/rehire     [Restricted section]
```

## 4. Workflow Timeline

```text
Filter [All] [Ready] [Blocked] [Overdue]   View [Timeline v]

✓ Validate case                  HR Officer       Completed 28 Jul 09:22
✓ Approve case                   HR Manager       Completed 28 Jul 09:34
● Approve and issue letter       HR Manager       Due 30 Jul 17:00
○ Prepare IT removal plan        IT Queue         Due 13 Aug 12:00
○ Revoke access                  IT Queue         Due 14 Aug 17:00 EXACT
! Confirm issued laptop          HR Officer       Blocked — asset source mismatch
○ Complete handover              Line Manager     Due 14 Aug 12:00
○ Finance clearance              Finance Queue    Due 16 Aug 12:00
```

Selecting a row opens a task drawer/page with:

- purpose;
- minimum case data;
- original/current due time;
- dependencies;
- evidence fields;
- complete/block/reassign/waive controls based on authority;
- history.

## 5. IT Queue

```text
IT OFFBOARDING QUEUE
[Urgent 1] [Due today 2] [Upcoming 4] [Blocked 1]

Due/Effective        Employee       Location       Systems         Status
NOW / 09:30          Jordan Lee     Warehouse      4 accounts      URGENT
14 Aug / 17:00       Avery Brown    Spanish Town   3 accounts      Planned

Task detail
Employee: Jordan Lee | Work ID: EMP-TEST-002
Effective revocation: 28 Jul 2026 09:30
Systems: Microsoft 365, POS, VPN, BambooHR user
Technology assets: Laptop ASSET-TEST-4, access card

[Start] [Block] [Complete]
Completion requires:
[ ] M365 disabled
[ ] POS disabled
[ ] VPN disabled
[ ] HR platform access disabled
Evidence/reference: ______________________
```

No exit reason, letter, survey, personal email or pay data appears.

## 6. Document Approval

```text
DOCUMENT: Resignation acknowledgement | Template v1 | GENERATED
Case OFF-00027 | Due 30 Jul 17:00

Field review
Employee name              Avery Brown        Source: case snapshot
Received date              28 July 2026       Source: case.received_at
Confirmed last working day 14 August 2026     Source: case decision
Signatory                   HR Manager         Source: template config

[Rendered preview PDF]

Classification: PRIVATE & CONFIDENTIAL
[Return for correction] [Approve and issue]

Attestation:
[ ] I reviewed the employee, dates, wording and template version.
```

## 7. Notification Approval and Attempts

```text
NOTIFICATION: IT access removal | PENDING APPROVAL
To: it-offboarding@example.test
CC: hr-offboarding@example.test
Scheduled: 14 Aug 2026 16:45
Effective revocation: 14 Aug 2026 17:00
Template: IT_ACCESS_REMOVAL v2
Fields: name, employee number, location, effective time, system list

[Content preview]

[Return] [Approve schedule]

After dispatch
Status: SUBMITTED (not confirmed delivered)
Provider reference: TEST-123
Attempts:
1  14 Aug 16:45  Accepted  Provider response 202
[Record manual fallback] [Open exception]
```

## 8. Asset Checklist

```text
ASSETS — 3/5 FINAL DISPOSITIONS

Item                 ID            Due           Disposition       Evidence
Laptop               AST-TEST-01   14 Aug 17:00  OPEN              [Record]
Access card          AC-TEST-02    14 Aug 17:00  RETURNED          Received by...
Health card          —             14 Aug 17:00  NOT ISSUED        Confirmed...
Uniforms (2)         —             14 Aug 17:00  RETURNED          2 received
Door key             KEY-TEST-01   14 Aug 17:00  UNRESOLVED        Exception open

[Add approved item]

Summary
Documentation compliance: 4/5 items final
Physical recovery: 3/4 items due for return
No payroll action is created by this screen.
```

## 9. Handover

```text
HANDOVER PLAN — Owner: Line Manager — Due 14 Aug 12:00

Category       Item                          Receiving owner    Status
Open work      Supplier quote follow-up      Morgan Reed        Complete
Customer       Fleet account renewal         Unassigned         Blocked
Documents      Monthly report location       Morgan Reed        Complete
Training       POS reconciliation demo       Taylor Singh       In progress
Risk           Two unresolved warranty cases HR review          Open

[Add item] [Record session] [Complete handover]

Warning: Do not enter passwords, one-time codes or secret keys.
```

## 10. Survey respondent

```text
Bert's Auto Parts — Exit Feedback

Thank you for taking a few minutes to share feedback.
[Approved confidentiality/privacy notice]

1. What was the primary reason for leaving?       [Select]
2. How clear were your role expectations?         [1 2 3 4 5]
3. How supported did you feel by your manager?    [1 2 3 4 5]
4. How would you rate the work environment?       [1 2 3 4 5]
5. What most influenced your decision?            [Select up to 2]
6. What could the company improve?                [Text, 500 chars]
7. Would you consider returning in future?        [Yes / Maybe / No / Prefer not]
8. Anything else?                                 [Optional text]

Please avoid including unnecessary personal information about other people.

[Review answers]
```

Review screen shows answers and `[Back] [Submit final response]`.

## 11. Clearance Review

```text
CLEARANCE REVIEW — OFF-00027

PASS  Required document issued
PASS  IT access revoked by effective time
PASS  Finance task complete
FAIL  Asset KEY-TEST-01 lacks approved final disposition
PASS  Handover complete
PASS  Required provider notices submitted
INFO  Survey invitation scheduled; survey completion is not a closure blocker

Blocking conditions: 1
[Open asset item]

After all pass:
[ ] I confirm required work/evidence has been reviewed.
[Complete case]
```

## 12. Reports

```text
REPORT: Notification Accuracy
Period [Jul 2026] Cohort [Pilot] Department [All]
Data as of 28 Jul 09:30

Target ≥98%
Result 11/11 = 100%
Exclusions 1 test notification
Submitted 11 | Delivered if known 7 | Bounced 0 | Manual fallback 1

Trend [chart]
Defect categories [table]
Cases [permission-aware drilldown]
[Export controlled report]
```

## 13. Administration — workflow diff

```text
WORKFLOW RESIGN_NOTICE
Active v1                 Proposed v2

Task IT_PREP              unchanged
Task IT_REVOKE            due rule changed:
  v1  at effective time
  v2  15 minutes before effective time
Task PROVIDER_NOTICE      condition changed:
  v1  always
  v2  enrolled == true

Validation
✓ no circular dependencies
✓ all mandatory tasks have owners/evidence
✓ document/template references active
! decision DEC-016 must be APPROVED before activation

[Submit for approval]
```
