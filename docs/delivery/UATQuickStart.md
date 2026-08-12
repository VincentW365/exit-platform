# UAT Quick Start (plain language)

A non-technical walkthrough of the stakeholder UAT. The formal companion
documents are `StakeholderUATGuide.md` (accounts, data, rules) and
`StakeholderSyntheticUATReport.md` (results). Everything below uses synthetic
data only - you cannot break anything, and the dataset can be rebuilt in one
command (guide, section 2).

## What you are actually doing

You pretend to be each employee in turn (click "Sign in as ..." - there are
no passwords) and walk fake offboarding cases through the system. Ten fake
cases are pre-loaded, numbered OFF-2026-0001 to OFF-2026-0010; most are
already set up so you just look and confirm something. Only Scenario 1
involves real work.

For every scenario write down three things: **scenario number, PASS or FAIL,
one sentence of comment.** That is the entire recording job; the facilitator
transfers it into the formal report.

Two rules: keep both terminals running (`pnpm dev` and `pnpm worker` - the
worker is what makes overdue tasks and mail delivery happen), and switch
users often - in real life these are different people.

## Part 1 - one case start to finish (Scenario 1, OFF-2026-0001, ~30-40 min)

As the **HR Officer**:

1. Cases → open OFF-2026-0001. Click through the tabs to see what is there.
2. Documents tab → "Create resignation document draft" → "Validate and
   submit for approval".

As the **HR Manager**:

3. Same case → Documents → "Approve exact version (attested)" → Download
   PDF; check it looks like a proper company letter.

As the **HR Officer** again:

4. Action form tab → "Create action form" → set the HR items to DONE, pick
   an acknowledgement status, save → "Submit for manager approval". (If the
   Finance or Manager section says nobody is assigned: as the HR Manager, use "Add
   participant" on the case to add Finance Responder - FINANCE and Line Manager -
   MANAGER, then return here.)

As the **Finance Responder**:

5. My queue → complete the Finance tasks with a short note each; on the
   case's action form, fill the finance checklist and save. Note that you
   cannot see HR remarks or the reason for leaving - that is deliberate.

As the **IT Responder**:

6. My queue → complete the "review systems and access" task with evidence.
   Note the second task: revoke access at the exact separation time - it can
   never be waived.

As the **Line Manager**:

7. My queue → open the case's Handover page → work through the sections and
   complete it; then approve the action form as manager.

As the **HR Manager**:

8. Action form → "Give HR final approval" → download the final PDF.
9. Notifications tab → "Prepare a notification" (IT access removal) →
   "Prepare draft" → "Submit for approval" → "Approve". Then Administration
   → Email/outbox status → "Run outbox pass now": the row shows
   SUBMITTED/CAPTURED, never "delivered" - no real email exists. The message
   is visible in the Development mailbox.

As the **HR Officer**:

10. Survey tab → generate the invitation → open the link → answer as the
    departing employee → submit. Submitting twice is politely refused.
11. Assets tab → mark the issued items as returned.

As the **HR Manager**:

12. When every task is done: Clearance tab → approve. The case completes.
    If clearance refuses, it lists exactly what is still open - that list is
    a feature; finish those items and retry.

## Part 2 - quick checks on the pre-built cases (2-5 min each)

- **S2, OFF-2026-0002 (immediate resignation).** As the IT Responder: the access-removal
  task is OVERDUE. As the HR Manager: Exceptions shows a CRITICAL escalation.
- **S3, OFF-2026-0003 (restricted termination).** As the HR Officer, the IT Responder, the Finance Responder,
  the Line Manager, the Auditor and the System Administrator: searching cases, queues, dashboards and reports
  finds NOTHING; pasting the case URL gives a plain denial. As the HR Manager it opens
  normally. No termination letter exists; the survey is off.
- **S4, OFF-2026-0004 (corrected document).** As the HR Officer: the old approved
  letter shows INVALIDATED with the correction reason; submit the corrected
  draft; as the HR Manager approve it. The old version stays in history only.
- **S5, OFF-2026-0005 (overdue tasks).** The IT and Finance Responder queues show
  overdue tasks; the HR Manager's Exceptions feed shows them ageing.
- **S6, OFF-2026-0006 (lost asset).** As the HR Manager: Assets shows a LOST item with
  an exception - and NO dollar amount, deduction or payroll anything,
  anywhere. That is a legal requirement, not a gap.
- **S7/S10, OFF-2026-0007 (blocked clearance).** As the HR Manager: Clearance refuses
  and says exactly why; resolve the blocker, finish the items, clear.
- **S8, OFF-2026-0008 (failed notification).** As the System Administrator: Administration →
  outbox → the FAILED_RETRYABLE row for this case; the address is masked;
  "Queue retry" is available.
- **S9, OFF-2026-0009 (finished case).** As the HR Manager: browse history, documents,
  captured mail, completed survey. Privacy check: the HR Officer, HR Manager and Privacy Officer can see
  the survey response; the Line Manager, the IT Responder, the Finance Responder and the System Administrator must not. Then Reports:
  run a report with purpose TEST, export CSV, confirm the case appears and
  small groups show "(suppressed)".

## Part 3 - admin drills

- **S11 (disable a user).** As the HR Manager: reassign an open task on OFF-2026-0010
  to Second IT Responder with a reason. As the System Administrator: Administration → System →
  disable Second IT Responder (banner: sessions revoked, orphaned task flagged). Sign out;
  "Sign in as Second IT Responder" must refuse. As the HR Manager: reassign the orphaned task
  back.
- **S12 (outage and fallback).** As the HR Manager: Continuity → declare a synthetic
  outage → record fallback entries → reconcile each once (a second
  reconcile is refused) → close the outage (only possible when everything
  is reconciled). A closed example outage is on the page to copy from.
- **S13 (reports).** Covered in S9 if you exported there.
- **S14 (pilot controls).** As the HR Manager: Administration → Pilot: read the gates
  (BLOCKED ones are honest - they await real approvals), propose a
  TRAINING_ENABLED activation with rollback text, apply it, then Suspend
  with a reason.

## The opinion part (the real purpose)

The checks above prove the system works. Your job as a stakeholder is the
judgment: as each role, note whether this matches how offboarding really
works at Bert's, whether the right person does each step, whether anything
is shown that should not be, and what must change before you would trust it
with a real departure. Answer the questionnaire in the guide (section 5)
and hand your notes to the facilitator.
