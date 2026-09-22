# User Acceptance Test Plan (Synthetic UAT)

> **Directive 6.1:** realistic (aliased) stakeholder UAT on the organization-
> aware platform is specified in
> `RealisticStakeholderUATWalkthrough.md` and
> `RealisticUATAssignmentMatrix.md`. This plan remains the synthetic
> baseline; the realistic pass adds real organizational patterns under the
> alias/purge safeguards and never replaces the synthetic evidence.

Structured acceptance testing of the offboarding platform by the pilot user
group, using SYNTHETIC data only (EMP-TEST employees, TEST record purpose).
Passing this plan is a pilot readiness gate (`readiness.uatPassed` is set by
the HR Manager only after signing the results; DEC-063).

> **Execution status (Directive 5, 2026-07-30):** an automated synthetic
> execution of this plan - 14 business scenarios driven through the real UI
> as the synthetic role accounts - is recorded in
> `../delivery/SyntheticUATReport.md`, including defects found and fixed.
> The journeys live in `e2e/uat-scenarios.spec.ts` plus the stage acceptance
> suites, so every future run repeats the whole plan. Stakeholder (human)
> UAT sign-off is still required before `readiness.uatPassed` may be set;
> the automated run does not substitute for it.

> **Directive 6.3 (2026-08-16, HR-validated workflow):** IT and Finance no
> longer sign in for NEW-case scenarios (DEC-045). They act on the captured
> automated emails (Development mailbox) and confirm through the secure
> acknowledgement links. The IT/Finance responder accounts remain only for
> historical/legacy-instance checks. Scenario adjustments below are marked
> "(6.3)".

## Participants and prerequisites

| Role | Participant (synthetic account) | Modules |
| --- | --- | --- |
| HR Manager | HR Manager | Approvals, letters, provider-notification review, clearance, pilot admin, reports |
| HR Officer | HR Officer | Case intake, benefits confirmation, exceptions, action-form completion, recipient entry, reports |
| IT (no login, 6.3) | Acts via captured email + secure link | Reads the access-removal email in `/dev/mailbox`; confirms receipt/completion through the acknowledgement link |
| Finance (no login, 6.3) | Acts via captured email + secure link | Reads the Finance notification in `/dev/mailbox`; acknowledges through the link |
| Line Manager (no login, DEC-051/DEC-063) | Receives the departure notice by captured email | Reads the notice in `/dev/mailbox`; holds no queue or task |
| HR Manager (DEC-042) | HR Manager | Privacy/retention operations |
| HR Manager (platform administration, DEC-063) | HR Manager | System configuration, identity lifecycle, directory refresh, health, outbox; attests backup/restore evidence |

Prerequisites: seeded development database; training module for the
participant's role completed (recorded in the Operations centre); this plan
executed against a build where all automated checks pass.

> **Live directory caution (Directive 5.1):** if the environment shows the
> red "LIVE HR DIRECTORY DATA" banner, real employee names are present in
> the employee selector. Do not capture screenshots or attach UAT evidence
> in that state - purge the live cache from `/admin/system` (or use a
> freshly seeded database) first. UAT case records must keep using the
> synthetic EMP-TEST employees.

## Test sets

Each row is pass/fail with a comment. A FAIL on a bold row blocks UAT
sign-off.

### UAT-1 Case lifecycle (HR)

1. **Create a TEST resignation case from a synthetic employee; submit;
   approve with snapshot; activate workflow.**
2. Hold and resume the case with reasons; verify audit entries.
3. Attempt to approve a case you submitted yourself (must be refused where
   the rule applies).

### UAT-2 Documents and surveys (HR)

1. **Generate, approve and attest the resignation acknowledgement.**
2. Verify a termination letter remains impossible.
3. Issue an exit survey token; complete the survey; confirm responses appear
   only in aggregate reporting.

### UAT-3 Department actions by email (6.3 - no IT/Finance logins)

1. **Activate a TEST case and verify the IT access-removal and Finance
   notifications are derived and dispatched automatically (zero HR clicks
   for the internal emails); open both in the Development mailbox
   (`/dev/mailbox`) and confirm the exact effective time is stated.**
2. **Open the acknowledgement link from the captured IT email; confirm
   receipt, then confirm completion; verify the case's IT evidence updates
   and a second use of the link fails neutrally.**
3. Record HR evidence ("confirmed by phone") on the Finance notification
   instead of the link; verify the audit trail names the actor and channel.
4. Manager: complete the handover module, including credential rejection in
   text fields. Verify the manager cannot see HR case content beyond their
   scope and that no IT/Finance sign-in occurs anywhere in this scenario.

### UAT-3b Benefits confirmation and recipient handling (6.3)

1. **Confirm benefits (group health YES, group life NO, other NO); verify
   the Sagicor notification is prepared for review, no NCB record exists,
   and the UNKNOWN attention item clears.**
2. **Remove/omit a provider recipient first: verify the "Recipient
   required" exception appears (never a silent skip), enter a case-only
   recipient as the HR Officer, and watch the notification proceed.**
3. Save a recipient "for future cases" and verify it requires directory
   authority plus approval/verification before automatic use.
4. Leave one benefit UNKNOWN and verify clearance is blocked with a plain
   explanation until it is resolved.

### UAT-4 Notification review, outbox and templates (HR Officer + HR Manager)

1. **Approve a provider notification from "Needs your review"; run the
   outbox; confirm CAPTURED in the development mailbox; confirm a repeat
   run sends nothing twice.**
2. Record a manual send and confirm pending dispatch is cancelled.
3. Cancel/retry/resolve paths on the outbox monitor (audited).
4. (6.3) Draft, preview and test-send a notification template revision
   (synthetic sample values only); activate it as the HR Manager and verify
   the prior version is superseded.

### UAT-5 Clearance and completion (HR Manager)

1. **Complete all clearance conditions; approve clearance; complete the
   case; verify the immutable clearance record.** (6.3) On a new-model
   case, verify IT shows ready only with confirmed completion (or an
   approved exception) - a sent-but-unconfirmed email must block - and
   that each unresolved asset needs its own decision or exception.
2. Reopen with a reactivation plan; verify audit and workflow behaviour.

### UAT-6 Administration (per role)

1. **Role separation (DEC-063): the HR Officer cannot open `/admin/system`;
   the sign-in page offers exactly HR Manager and HR Officer.**
2. Reason taxonomy: create, approve, retire a category; verify reporting
   groups.
3. Calendar: preview impact (compute-only), approve.
4. Recipients: masked destinations, business/technical edit split, external
   approval.

### UAT-7 Pilot, privacy, continuity, backup

1. **Pilot: gates visible with real facts; TRAINING_ENABLED apply;
   suspension stops dispatch.**
2. Privacy: retention policy version + approval; dry run (identifies,
   deletes nothing); hold blocks anonymization; DSR search + package with
   exclusions.
3. Continuity: declare outage → fallback entry → one-time reconciliation →
   close.
4. **Backup and restore test attested** (`readiness.backupVerified`,
   `readiness.restoreTested`) from the operations runbook evidence - the
   application performs neither (DEC-063).

### UAT-8 Case ownership - Cases versus My Work (DEC-065)

1. As the **HR Officer**, create a Draft case for a synthetic employee.
   **Immediately**: it is listed under **My Work → My cases**, it is listed
   under **Cases**, the header reads "Assigned HR Officer: HR Officer", and
   "Edit these details" is offered.
2. As the **HR Manager**: the same case is in **Cases**, is editable, and the
   Assignment tab offers **Reassign HR Officer**.
3. As the **HR Manager**, create a case: it starts **Unassigned** - it is in
   Cases, editable by the manager, in nobody's My Work, and an officer opening
   it sees "Unassigned - view only" with no edit controls until assigned.
4. Where a second HR Officer login exists (mapped from the directory under
   Administration → Organization), reassign a case from one officer to the
   other: it leaves the first officer's My Work (still readable in Cases,
   marked "View only") and appears in the second officer's My Work with edit
   rights; the case history shows the reassignment with both officers and
   the manager who made it; Created By is unchanged.

## Result capture

Record results in a copy of this file
(`UATResults-<date>.md`, kept outside Git if it names real staff) with:
participant, date, per-row pass/fail, defects raised (ticket references) and
the HR Manager's overall verdict. Only then may
`readiness.uatPassed=true` be set, with the worksheet reference in the
configuration change reason.
