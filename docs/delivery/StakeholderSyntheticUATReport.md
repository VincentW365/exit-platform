# Stakeholder Synthetic UAT Report (Directive 6)

**Status: ENVIRONMENT PREPARED - STAKEHOLDER TESTING NOT YET STARTED.**

This report is the capture record for stakeholder-performed synthetic UAT.
No stakeholder has executed the tests yet; nothing below claims otherwise,
and no sign-off exists until real stakeholders record their results here.

## Environment under test

- Commit tested: `<fill at session start - prepared on 558a1ec + this
  preparation commit>`
- Environment: local workstation, http://localhost:3000, development mode,
  synthetic providers (email capture, dev identity, local storage,
  dev-passthrough scan), BambooHR FIXTURE adapter active.
- Dataset: SYNTHETIC STAKEHOLDER UAT DATA - cases OFF-2026-0001..0010 per
  `StakeholderUATGuide.md` section 2 (rebuild procedure recorded there).
- Live-directory rule: any private live demonstration follows guide section
  3; the red banner must be OFF before evidence capture; live employee data
  must never appear in this report or its evidence folder.

## Session log

| Date | Facilitator | Participants (name or approved tester reference) | Notes |
| --- | --- | --- | --- |
| _pending_ | | | |

## Scenario results (one row per scenario per role)

Severity scale: BLOCKER / HIGH / MEDIUM / LOW / ENHANCEMENT /
TRAINING_OR_PROCESS.

| Scenario | Role | Tester | Date | PASS/FAIL | Actual result | Comments | Evidence ref (artifacts/stakeholder-uat/) | Finding ID | Severity | Retest | Sign-off |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 resignation with notice (full journey) | HR Officer + all | | | | | | | | | | |
| S2 immediate resignation (urgent access) | HR Officer / IT | | | | | | | | | | |
| S3 restricted termination non-disclosure | HR Manager (+ negative checks by others) | | | | | | | | | | |
| S4 document correction and re-approval | HR Officer / HR Manager | | | | | | | | | | |
| S5 overdue task and escalation | IT / Finance / HR Manager | | | | | | | | | | |
| S6 asset exception, no payroll effect | HR Officer / Finance | | | | | | | | | | |
| S7 handover completion and waiver | Line Manager / HR Manager | | | | | | | | | | |
| S8 survey invitation, completion, privacy | HR Officer / Privacy Officer | | | | | | | | | | |
| S9 notification captured in dev outbox | HR Manager / System Admin | | | | | | | | | | |
| S10 clearance blocked then completed | HR Manager | | | | | | | | | | |
| S11 user deactivation and reassignment | System Admin / HR Manager | | | | | | | | | | |
| S12 manual fallback and reconciliation | HR Manager | | | | | | | | | | |
| S13 reporting and CSV/PDF exports | HR Manager / Auditor | | | | | | | | | | |
| S14 pilot readiness and suspension | HR Manager / System Admin | | | | | | | | | | |

## Feedback questionnaire answers (guide section 5, per role)

| Role | Q1-Q15 answers / notes |
| --- | --- |
| HR Officer | _pending_ |
| HR Manager | _pending_ |
| IT Responder | _pending_ |
| Finance Responder | _pending_ |
| Line Manager | _pending_ |
| Privacy Officer | _pending_ |
| Auditor | _pending_ |
| System Administrator | _pending_ |

## Findings register

| ID | Severity | Description | Raised by | Scenario | Resolution | Retest | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| _none recorded yet_ | | | | | | | |

Fix within the UAT window: BLOCKER, HIGH, and low-risk in-scope MEDIUM only.
ENHANCEMENT and TRAINING_OR_PROCESS items are recorded for later
prioritization - not implemented during UAT.

## Sign-off

| Role | Stakeholder | Verdict (pass / pass with conditions / fail) | Date |
| --- | --- | --- | --- |
| HR Manager (process owner) | _pending_ | | |
| Privacy Officer | _pending_ | | |
| IT | _pending_ | | |
| Finance | _pending_ | | |

Stakeholder UAT is complete only when the scenarios above are executed by
the named stakeholders, findings are dispositioned, and this sign-off table
is filled in by the stakeholders themselves.
