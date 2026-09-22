# HR Daily Offboarding Walkthrough (Directive 6.3)

How HR runs one offboarding from start to finish under the HR-validated
workflow. Written for HR users in business language - no technical
vocabulary is needed to operate the platform.

> **The platform does the routine work automatically. HR primarily reviews
> the information, handles exceptions and maintains control.**

Roles in this walkthrough: the **HR Officer** (assigned to the case, does
the day-to-day work) and the **HR Manager** (assigns the officer, approves
letters and outside-company notifications where review is configured, and
gives final clearance). IT and Finance do not sign in - they receive
controlled emails and confirm through secure links. The employee's manager
no longer signs in at all.

## Step 1 - Select the employee from the directory

Cases → New case → search the employee directory by name, employee number,
department or position → Select. You never type employee details by hand;
the directory is the source.

## Step 2 - Review the pre-populated details

The "From the directory (source data)" panel shows name, employee number,
position, department, location, direct manager and the last directory sync.
Review it - do not re-enter it. If something is wrong, it is wrong at the
source; the case snapshot records exactly what was used.

## Step 3 - Enter the separation facts

Enter only what the platform cannot know: departure type (resignation with
notice / immediate resignation / termination), the dates and times, how the
resignation was received, and the reason capture. Everything else is derived
from these facts. Create the draft and submit it for review.

## Step 4 - HR Manager approves and assigns the officer

The HR Manager opens the Case Approval Summary, reads what the approval
authorizes - who will be contacted and where, which documents and forms will
be produced, the benefits and providers the officer selected at intake - and
approves the case **once** (this freezes the employee snapshot and authorizes
the assigned HR Officer for everything downstream, DEC-066). The manager
assigns the HR Officer where the case was created unassigned, confirms the
derived manager (or overrides with a reason if the directory hierarchy is
wrong), and the workflow is activated.

## Step 5 - The platform derives the required actions

At activation the platform works out everything this case needs - IT
access-removal email, Finance notification, benefit-provider notifications,
asset recovery, survey scheduling - from the facts on the case. Each item
shows WHY it exists ("derived from: departure type, effective time"). Open
the case's **Required actions** panel: items needing your decision are at
the top ("Requires your attention"); everything progressing automatically
sits below it; completed items are collapsed.

## Step 6 - Confirm benefits once

Under **Benefits and providers**, answer three questions once: group health
(YES / NO / UNKNOWN), group life (YES / NO / UNKNOWN), any other provider
(YES / NO). YES prepares the provider notification automatically; NO records
the decision and nothing is created; UNKNOWN keeps the item on your
attention list - the case cannot clear while a benefit question is
unanswered, because uncertainty is open work.

## Step 7 - Work exceptions only

You do not walk a 20-row checklist. If the automation cannot safely do
something, it raises an item on your attention list with a plain
explanation and the action to take - for example "Recipient required"
(enter who receives this email), "Confirm benefits applicability" or
"Automatic sending blocked". Resolve the item and the automation continues.

## Step 8 - The letter is finalized by the officer

The resignation acknowledgement letter is the assigned HR Officer's work
from start to finish: generate the draft from the approved template,
validate and finalize it (attested, under the case approval - DEC-066), and
send it. The issued PDF is immutable. A termination letter remains impossible
by design.

## Step 9 - IT and Finance are notified automatically

The IT access-removal email (with the exact effective time) and the Finance
notification go out automatically - no clicks - once their conditions are
met. In UAT and development every email lands in the capture mailbox
(Development mailbox screen), never a real inbox. For a termination the
timing is confidential: the IT email is held until shortly before the
effective time, Finance until the effective time.

The recipient confirms through a secure link in the email ("Confirm
receipt" / "Confirm completed"). No account, no sign-in. If they confirm by
email or phone instead, record that evidence on the notification with a
note. If IT has not confirmed completion by the effective time, the case
raises a CRITICAL attention item - an email having been sent is never
treated as proof access was removed.

## Step 10 - Provider notifications follow your review

Outside-company notifications (Sagicor, NCB, payroll/bank, other) wait in
"Needs your review" - approve to send. The provider directory records who
receives each kind of notification; if no recipient is on file yet, the
platform asks you: enter one for this case only, or save an approved
recipient for future cases.

## Step 11 - The manager is told, and that is all

At activation the platform emails the employee's own line manager: who is
leaving, the final working date, when employment ends, and what is expected of
them (reassign open work, arrange any knowledge transfer, make sure company
property comes back, tell HR anything that moves the date).

The manager has no login, no queue and no task here. Handover happens in their
team, not in this system, and the platform records none of it (DEC-051,
DEC-052). If the directory holds no work email for the manager, the case
raises a Recipient required exception so HR can fix it.

## Step 12 - Assets come from the issued list

The Assets tab lists exactly what is recorded as issued to this employee -
one line per item, nothing generic. Record each return or decision (lost /
damaged / waived). "Add unlisted asset" exists for the exception where
something was issued off the books. Asset outcomes never touch pay.

## Step 13 - The officer completes the Action Form

The Action Form opens pre-filled from the case. Work the HR checklist,
record the employee acknowledgement (for an immediate resignation the
correct treatment - not obtained, with the standard reason - is already
suggested), and complete the form. Completion is the assigned officer's
job; if your organization has switched on HR-Manager review, the form shows
a review step before completion. The completed form renders an immutable
PDF.

## Step 14 - The survey schedules itself

For eligible departures the exit survey invitation is scheduled
automatically after the effective separation (day 3, reminder day 7).
Termination cases are not eligible without an explicit HR-Manager decision.
The survey never delays clearance.

## Step 15 - Read the clearance summary

The clearance screen shows every condition grouped (HR / Manager / IT /
Finance / Providers / Benefits / Assets / Documents / Handover / Security)
with unresolved items first. IT shows as ready only with confirmed
completion or an approved exception; Finance when its notification went
out; each unresolved asset needs its own decision or its own approved
exception.

## Step 16 - HR Manager clears the case

When everything is green (or covered by an approved, recorded exception),
the HR Manager approves clearance and completes the case. The approval
binds to a checksummed snapshot of exactly what was cleared.

## Step 17 - Everything is in the audit trail

The Audit centre replays the whole case - what was derived and why, every
automatic email, every confirmation link used, every override with its
reason, every approval - by who/what/when. Automated steps are recorded
with MORE detail than manual ones, not less.

## If something goes wrong

- **An email could not be sent** - it appears on your attention list with
  the reason; fix the cause (usually the recipient or template) and it
  retries, or record a manual send.
- **A confirmation link expired** - re-sending issues a fresh link; the old
  one is dead the moment it expires.
- **A derived item is wrong for this case** - override it with a reason
  (authorized HR only); the override wins until you remove it, and it is
  audited.
- **The case facts change** (dates, departure type) - the platform
  re-derives; superseded items are marked, nothing is silently deleted, and
  a completed Action Form is superseded with a fresh one to complete.
