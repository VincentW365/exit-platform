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
the System Administrator only after the HR Manager signs the results).

> **Execution status (Directive 5, 2026-07-30):** an automated synthetic
> execution of this plan - 14 business scenarios driven through the real UI
> as the synthetic role accounts - is recorded in
> `../delivery/SyntheticUATReport.md`, including defects found and fixed.
> The journeys live in `e2e/uat-scenarios.spec.ts` plus the stage acceptance
> suites, so every future run repeats the whole plan. Stakeholder (human)
> UAT sign-off is still required before `readiness.uatPassed` may be set;
> the automated run does not substitute for it.

## Participants and prerequisites

| Role | Participant (synthetic account) | Modules |
| --- | --- | --- |
| HR Manager | HR Manager | Approvals, clearance, pilot admin, reports |
| HR Officer | HR Officer | Case intake, documents, notifications, reports |
| IT | IT Responder | Queue, access revocation, assets |
| Finance | Finance Responder | Queue, clearance inputs |
| Line Manager | Line Manager | Handover, queue |
| Privacy Officer | Privacy Officer | Privacy/retention operations |
| System Administrator | System Administrator | System admin, health, backup |

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

### UAT-3 Department execution (IT/Finance/Manager)

1. **IT: complete the access review from the queue; observe the exact-time
   revocation task release at the effective instant; complete it and check
   lateness handling.**
2. Finance/Manager: complete department tasks and the handover module,
   including credential rejection in text fields.
3. Verify no department participant can open HR case content.

### UAT-4 Notifications and outbox (HR Manager + System Administrator)

1. **Prepare, submit and approve an IT notification on a TEST case; run the
   outbox; confirm CAPTURED in the development mailbox; confirm a repeat run
   sends nothing twice.**
2. Record a manual send and confirm pending dispatch is cancelled.
3. Cancel/retry/resolve paths on the outbox monitor (audited).

### UAT-5 Clearance and completion (HR Manager)

1. **Complete all clearance conditions; approve clearance; complete the
   case; verify the immutable clearance record.**
2. Reopen with a reactivation plan; verify audit and workflow behaviour.

### UAT-6 Administration (per role)

1. **Business vs technical separation: HR cannot open `/admin/system`;
   System Administrator cannot read case content.**
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
4. **Backup: create; restore-verify PASSED.**

## Result capture

Record results in a copy of this file
(`UATResults-<date>.md`, kept outside Git if it names real staff) with:
participant, date, per-row pass/fail, defects raised (ticket references) and
the HR Manager's overall verdict. Only then may
`readiness.uatPassed=true` be set, with the worksheet reference in the
configuration change reason.
