# Stakeholder Synthetic UAT Report (Directive 6)

**Status: ENVIRONMENT PREPARED - STAKEHOLDER TESTING DEFERRED (DEC-036).**

This report is the capture record for stakeholder-performed synthetic UAT.
On 2026-07-30 the product owner deferred stakeholder execution because the
stakeholders are not currently available; development continues on the
accepted engineering-led synthetic UAT evidence (`SyntheticUATReport.md`).
The environment, dataset and guides stay permanently available so each role
can run their 20-30 minute slice asynchronously (start with
`UATQuickStart.md`). No stakeholder has executed the tests yet; nothing
below claims otherwise, no sign-off exists until real stakeholders record
their results here, and the pilot readiness UAT gate remains unmet until
then.

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
| UAT-F-003 | MEDIUM | Final HR-approved action form PDFs record the Finance checklist as PENDING. Investigated: not a data-loss bug - the assigned Finance participant's checklist was genuinely never filled (confirmed in data for OFF-2026-0001 and the seeded OFF-2026-0009), and HR final approval offered no indication that Finance items were outstanding. No approved rule gates approval on Finance completion (spec Q-6 remains OPEN), so approval must stay possible. | Facilitator | S1/S5 (action form) | Informed-approval warning added to the HR final-approval panel (2026-08-10): when Finance items are PENDING it states how many and that the immutable PDF will record them, advising confirmation with Finance or return of the form. Finance discoverability already improved under UAT-F-002 (assignment-driven dashboard work list). Approved forms stay immutable - OFF-2026-0001's form can only be redone via the audited case-correction path. | OFF-2026-0010 is staged at PENDING_HR with Finance untouched: as HR Manager, verify the warning; as Finance, complete the checklist from the dashboard link; approve and confirm the PDF records the Finance items. | RESOLVED - pending stakeholder retest |
| UAT-F-002 | MEDIUM | Line Manager had no navigation path to the handover surface: the only link was the case-detail tab bar, which limited-access roles (MANAGER_FORM level, DEC-035/Directive 2 F) never see; the dashboard work list only showed cases with an in-flight action form. | Facilitator | S7 (handover) | Dashboard work list (`assignedFormQueue` + dashboard page, 2026-08-10) is now assignment-driven: every ACTIVE/ON_HOLD/CLEARANCE_REVIEW case where the actor is the assigned Finance/Manager participant is listed, with an "Open handover" link and status for managers. No permission change - the handover service already admitted the assigned manager. | Sign in as the Line Manager; dashboard should list the assigned case with "Open handover"; complete S7 from there. | RESOLVED - pending stakeholder retest |
| UAT-F-001 | MEDIUM | Rendered document PDFs not business-ready: letter signature block collapsed onto one line and duplicated below; footer overflow emitted a blank trailing page on every document; header lacked letterhead structure. | Facilitator | S1/S4 (documents) | Renderer layout redesign in `packages/db/src/services/renderService.ts` (2026-08-10): letterhead with approved logo + confidentiality tag, business-letter body preserving line breaks, attestation as anchored fine print, ruled two-column action-form body, footer pagination fix. Applied to both letters and the action form. Template wording untouched (versioned HR templates; content changes remain with wording owners). | Re-approve a letter draft (e.g. S4 corrected draft) and the action form; review downloaded PDFs. | RESOLVED - pending stakeholder retest |

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
