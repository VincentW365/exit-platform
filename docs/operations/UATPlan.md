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

1. **Create a TEST resignation case from a synthetic employee, selecting the
   benefits and providers in the Benefits & Providers step; verify the Draft
   Overview shows them as a summary with "Edit selections"; submit; as the HR
   Manager open "Review and approve" (the Case Approval Summary), verify the
   Employee Record, Exit Details, HR Ownership, Benefits & Providers,
   Notifications & Recipients (each audience with a resolved destination and a
   readiness state), Documents & Forms and Workflow Summary sections, then
   Approve Case; activate workflow.** (DEC-066)
2. Hold and resume the case with reasons; verify audit entries.
3. Attempt to approve a case as the HR Officer (must be refused).
4. Return a submitted case to draft with a reason; verify the officer sees the
   reason on the draft and that no document can be finalized while returned.

### UAT-2 Documents and surveys (HR)

1. **As the assigned HR Officer, generate, validate and finalize (attested)
   the resignation acknowledgement under the case approval; verify the PDF
   renders and that no "approve document" control exists for the HR
   Manager; send it to the employee by email as the officer.** (DEC-066)
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

1. **Select benefits at intake (group health included, group life not);
   verify the approval summary lists the group health provider as Ready and
   the group life provider as Not required, that after activation the Sagicor
   notification is prepared for review and no NCB record exists, and that the
   assigned HR Officer releases it without an HR Manager step. Verify the
   officer cannot amend the selection after submission and the HR Manager can
   (audited).** (DEC-066)
2. **Remove/omit a provider recipient first: verify the "Recipient
   required" exception appears (never a silent skip), enter a case-only
   recipient as the HR Officer, and watch the notification proceed.**
3. Save a recipient "for future cases" and verify it requires directory
   authority plus approval/verification before automatic use.
4. Leave one benefit UNKNOWN and verify clearance is blocked with a plain
   explanation until it is resolved.

### UAT-4 Notification review, outbox and templates (HR Officer + HR Manager)

1. **As the assigned HR Officer, release a provider notification from "Needs
   your review" (no HR Manager release exists since DEC-066); run the
   outbox; confirm CAPTURED in the development mailbox; confirm a repeat
   run sends nothing twice.**
2. Record a manual send and confirm pending dispatch is cancelled.
3. Cancel/retry/resolve paths on the outbox monitor (audited).
4. (6.3) Draft, preview and test-send a notification template revision
   (synthetic sample values only); activate it as the HR Manager and verify
   the prior version is superseded.
5. **(DEC-067) Upload the supplied banner JPG under Administration → System →
   Email banner; capture any email; verify in the development mailbox that
   the HTML preview shows the banner once at the bottom, scaled at a mobile
   width without clipping or horizontal scroll, that the plain-text part
   still carries the links, and that removing the banner does not stop the
   next email.**

### UAT-4b Signing the Employee Action Form (DEC-068)

1. **Open the Employee Action Form on an approved case and confirm the
   company logo appears at the head of the sheet at its own proportions,
   above a header naming the employee, employee number, position,
   department and location, separation type, effective date and case
   reference.**
2. **Create a signature request for the employee. Confirm the status card
   names the signer, the document, the status, the destination, when it was
   created and when it expires, and that no HR Manager approval is asked
   for anywhere.**
3. **Copy Signing Link. Confirm the whole address is copied in one piece and
   that the confirmation says "Signing link copied".**
4. **Send by Email, run an outbox pass, and confirm the captured message in
   `/dev/mailbox` carries the same link and states the date it runs until.**
5. **Open the link on a phone (or a phone-sized window) with no sign-in.
   Confirm there is no HR navigation or role switcher, that only the
   details needed to sign are shown, and that submitting without every mark
   names exactly what is missing.**
6. **Draw your initials once, apply them to the remaining sections, sign,
   tick the declaration and submit. Confirm the thank-you page, then reopen
   the link and confirm it says the request has already been completed.**
7. **Back in the platform, confirm the marks appear on the sheet, sign the
   Human Resources block, complete the form, and confirm the downloaded PDF
   shows the logo, the initials, both signatures and their dates.**
8. **On a second request, use Extend Link and confirm the new date; then
   Revoke Link with a reason and confirm the signer sees "This signing
   request is no longer valid." and nothing about the case.**
9. **Confirm the audit centre shows the request created, copied, emailed,
   extended, revoked and completed - and that no entry anywhere contains
   the signing link itself.**

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
