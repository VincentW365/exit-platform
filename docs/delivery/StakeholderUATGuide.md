# Stakeholder Synthetic UAT Guide (Directive 6)

Everything a stakeholder tester needs: how to start the environment, which
account to use, what to test, and which questions to answer. All data is
SYNTHETIC STAKEHOLDER UAT DATA (record purpose TEST, EMP-TEST employees).
Results are captured in `StakeholderSyntheticUATReport.md`.

**New to this?** Read `UATQuickStart.md` first - the same testing in plain
language, in the order easiest to follow. Testing is asynchronous: each role
needs 20-30 minutes and can run their slice whenever they have time.

## 1. Access (section D)

- **URL:** http://localhost:3000
- **Start the environment** (facilitator, once):
  1. Start PostgreSQL: `pg_ctl -D <runtime>\postgres\data start` (see
     DEVELOPMENT.md).
  2. `pnpm dev` (web application, port 3000).
  3. `pnpm worker` in a second terminal (sweeps, escalations, outbox).
- **Sign in:** the development role switcher lists every synthetic user -
  click "Sign in as ...". No passwords exist; no credential is ever shown.
- **Switch role / log out:** "Sign out" (top right), then pick another user.
- **Troubleshooting:** blank page → confirm `pnpm dev` is running; queue
  looks empty → check the "view: all" filter and the case-number search;
  overdue states not moving → confirm the worker terminal is running; any
  error banner is safe to read aloud - it never contains sensitive data. If
  the red "LIVE HR DIRECTORY DATA" banner is visible, STOP capturing
  evidence and call the facilitator (section 3).

| Role | Synthetic account | Landing surface | Primary scenarios |
| --- | --- | --- | --- |
| HR Officer | HR Officer | Dashboard → Cases / New case | S1, S2, S4, S6, S9 |
| HR Manager | HR Manager | Dashboard → Cases / Reports / Administration | S1-S4, S8, S13, S14 |
| IT Responder | IT Responder | My queue | S1, S2, S5 |
| Finance Responder | Finance Responder | My queue | S1, S5 |
| Line Manager | Line Manager | My queue / handover | S1, S7(handover) |
| HR Manager (privacy/audit duties, DEC-042) | HR Manager | Administration → Privacy; Audit centre | S8, cross-scenario |
| System Administrator | System Administrator | Administration → System / Health | S11, S12, integration status |
| (fixture for S11) | Second IT Responder | - | disabled during Scenario 11 |

## 2. Prepared synthetic scenario data (section B)

Rebuild at any time with one command (DEC-041):
`pnpm exec tsx scripts/reset-environment.ts uat --yes`, then
`pnpm exec playwright test e2e/uat-scenarios.spec.ts -g "UAT-1"` for the
completed-case artifacts. (`... fresh --yes` gives the zero-case
production-readiness state instead; `... status` is a read-only check.)

| Case | Scenario |
| --- | --- |
| OFF-2026-0001 | S1 - resignation with notice, ACTIVE: work the full journey across every role. |
| OFF-2026-0002 | S2 - immediate resignation: exact-time access removal is OVERDUE with a CRITICAL escalation. |
| OFF-2026-0003 | S3 - restricted termination (HR Manager only): verify non-disclosure everywhere else. |
| OFF-2026-0004 | S4 - approved letter INVALIDATED by an audited correction: re-submit (officer) and re-approve (manager) the corrected draft. |
| OFF-2026-0005 | S5 - departmental tasks overdue: review escalations in queues and exceptions. |
| OFF-2026-0006 | S6 - LOST asset: review the exception; confirm NO payroll figure exists anywhere. |
| OFF-2026-0007 | S8/S10-journey - blocked clearance: a recorded task blocker plus unmet gate conditions; unblock, finish, clear. |
| OFF-2026-0008 | S10 - the notification outbox shows a synthetic FAILED_RETRYABLE dispatch for this case (admin: retry control). |
| OFF-2026-0009 | S7+S9 - COMPLETED case with rendered documents, captured IT notification (dev mailbox) and completed exit survey: use for reports and history review. |
| OFF-2026-0010 | Spare ACTIVE case (left by the automated deactivation drill); usable for Scenario 11 reassignment practice. A CLOSED synthetic outage drill is also visible on the Continuity page as a worked example. |

Scenario 11 (user deactivation): reassign an open task to Second IT Responder, then
as System Administrator disable that account and watch the session revoke and the
orphaned task get reassigned. Scenario 12 (fallback): declare a synthetic
outage on the Continuity page, record FB entries, reconcile once, close.
Scenario 13: Reports → run any report with purpose TEST, export CSV.
Scenario 14: Administration → Pilot: gates, TRAINING activation, suspension.

## 3. BambooHR directory options (section C)

**Option 1 - synthetic directory (default, use for ALL evidence capture).**
The fixture adapter serves EMP-TEST employees; nothing leaves the machine.

**Option 2 - private live demonstration (authorized HR only).** Facilitator
procedure, in this exact order:

1. `/admin/system` (System Administrator): confirm credential status "configured"; press
   "Test connection (read-only)" - the result shows aggregate counts only.
2. Set configuration `bamboohr.mode` = `live`, then "Run directory sync
   (live adapter)". The RED banner appears: "LIVE HR DIRECTORY DATA — DO NOT
   USE FOR SCREENSHOTS OR TEST EVIDENCE".
3. Demonstrate to authorized HR viewers only: employee search with
   department/position/location/manager data and case-form pre-population.
   **Do not press "Create draft case". Do not screenshot. Do not record
   names in any UAT document.**
4. Immediately afterwards: press "Purge live directory cache", set
   `bamboohr.mode` back to `fixture`, and CONFIRM the red banner is gone
   before any further testing or evidence capture.

## 4. What each role must validate (section E)

Work your scenarios, then judge your area:

- **HR Officer:** employee lookup + manual fallback, case creation, document
  drafting, action form, survey administration, assets, notifications, case
  progress, exceptions.
- **HR Manager:** case/document/form approvals, workflow activation,
  reassignment, waivers, final clearance, reports, pilot controls.
- **IT Responder:** queue, exact-time access removal, minimum data only,
  blockers/evidence, escalation behaviour.
- **Finance Responder:** queue, checklist, external workpaper status,
  minimum data, and that NO payroll calculation/deduction exists.
- **Line Manager:** assigned tasks, handover, duty reassignment, form
  approval, restricted-field protection.
- **HR Manager (privacy/audit duties, DEC-042):** privacy dashboard,
  retention/holds, disclosures, survey-response restrictions, and the Audit
  centre evidence trail (history, approvals, corrections, exceptions).
- **System Administrator:** integration health, provider status, users/
  roles, backup, worker health, support - and confirm HR case content stays
  unavailable to you.

## 5. Feedback questionnaire (section G - answer per role)

1. Does the workflow match the actual process?
2. Are the correct people responsible for each task?
3. Is enough information shown to complete the work?
4. Is any unnecessary or sensitive information shown?
5. Are statuses and next actions clear?
6. Are due dates and escalations practical?
7. Are approval steps correct?
8. Are the documents and forms understandable?
9. Are notification templates appropriate?
10. Does asset recovery reflect the real process?
11. Does handover reflect the real process?
12. Are reports useful for decision-making?
13. Is the system usable without developer assistance?
14. What must change before a pilot?
15. Which suggestions are enhancements rather than pilot blockers?

Record answers, PASS/FAIL per scenario and any findings in
`StakeholderSyntheticUATReport.md`. Evidence screenshots are stored under
the gitignored `artifacts/stakeholder-uat/` folder and must never contain
live directory data.
