# Live-Data Stakeholder UAT Walkthrough (Directive 6.3; supersedes the Directive 6.2 sequence)

The operational rehearsal of the HR-VALIDATED workflow: real employees, real
hierarchy, real responsibilities - **simulated offboarding events only**.
Every UAT case is a TEST record with the "UAT — SIMULATED OFFBOARDING"
banner; no live email (everything lands in the capture mailbox), no BambooHR
write, no account deactivation of real identities, no payroll anything. Real
names live only in this machine's database and must never enter Git, shared
screenshots or written evidence (use case numbers and roles in notes).

What changed since the Directive 6.2 walkthrough (DEC-044..DEC-050):

- **No IT or Finance sign-ins for new cases.** Departments receive
  automated emails (shown in the capture mailbox) and confirm through
  secure links.
- **No manager approval of the Action Form.** The assigned HR Officer
  completes it; the manager keeps only the handover.
- **The platform derives the required actions**; HR confirms benefits once
  and works exceptions, not checklists.

Roles are written as functions ("the HR Manager"); people mapped through the
Organization screen act as themselves.

## Part 1 - Start the system

```
pnpm dev        # terminal 1 - web app on http://localhost:3000
pnpm worker     # terminal 2 - sweeps, escalations, outbox, auto-release
```

The worker matters more than before: it dispatches the automated emails,
expires links, escalates unconfirmed IT actions and schedules surveys. If
the environment looks broken: `pnpm exec tsx scripts/reset-environment.ts
status`, and see Part 20 for rebuild options.

## Part 2 - Verify safety

As the HR Manager (DEC-063), confirm on Administration → Health and → System:

1. Email provider mode: capture/sink (messages land in the Development
   mailbox - nothing external, including every "automated" send).
2. BambooHR credential: configured, READ-ONLY (no write method exists).
3. No payroll/pay-calculation surface exists anywhere (by design - it never
   will).
4. Identity: only local accounts; disabling drills use the synthetic
   "Second IT Responder", never a real mapped colleague.
5. The top banner reads "UAT environment - simulated offboarding only".

## Part 3 - Sync the live directory

As the HR Manager on Administration → System:

1. "Test connection (read-only)" - aggregate counts only.
2. Set `bamboohr.mode` = `live`, then "Run directory sync (live adapter)".
3. The red LIVE HR DIRECTORY DATA banner appears - expected for this UAT.
4. Review Administration → Organization: employees/departments/locations/
   manager links, the health findings and the Key officeholders table.
5. Resolve mapping issues the health screen raises (missing managers are
   expected for a few people - an alternate scenario covers the handling).

## Part 4 - Map actual responsibilities (fewer logins than before)

As the HR Manager on Administration → Organization →
"Map a directory person to an application account":

1. Map the actual HR Manager → HR_MANAGER.
2. Map the actual HR Officer(s) → HR_OFFICER.
3. Map a manager account (LINE_MANAGER) only for the managers participating
   in the UAT - their access stays scoped to their own cases and tasks.
4. **Do NOT map IT or Finance responders.** Under the HR-validated workflow
   they have no operational login (DEC-045); they participate in Part 11
   through the captured emails and secure links. Historical v1 cases remain
   readable to previously mapped responder accounts.
5. System administration stays with the person operating this environment.

Mapped colleagues appear on the sign-in screen under "Directory-mapped
staff" and can sign in as themselves.

## Part 5 - Prepare the email-action configuration

As the HR Manager:

1. Administration → Notification templates: verify at least 9 ACTIVE
   templates - one per notification type, including payroll/bank and
   other-external. Preview one; note the preview uses clearly synthetic
   sample values (Avery Brown / EMP-TEST-001), never a real person.
2. Review the send control levels: internal departments (IT, Finance,
   manager notice) = sent automatically; external providers = need HR
   review; restricted cases are never sent automatically. Since DEC-066 the
   HR person executing the approved case releases every held notification -
   there is no HR-Manager release.
3. Administration → Recipients: verify the provider directory (purpose,
   organization, contact, masked address) and deliberately leave ONE
   provider recipient missing - Part 12 demonstrates the handling.

## Part 6 - Create the standard UAT case (Scenario 1)

Seed the scenario set first (facilitator, once):

```
pnpm exec tsx scripts/live-uat-seed.ts
```

Then, as the HR Officer, create ONE case fully by hand to test the intake:

1. Cases → New case → search the real directory by name, id, department or
   position → Select.
2. Review the "From the directory (source data)" panel: name, number,
   position, department, location, direct manager, last sync. Nothing is
   re-typed.
3. Enter only the separation facts (dates, notice, reason capture) - set
   Record purpose to TEST.
4. Create draft → submit for HR review.

## Part 7 - HR Manager: ownership, manager confirmation, activation

As the HR Manager on the new case:

1. Approve the case.
2. Assignment tab: assign the actual HR Officer; confirm the derived real
   manager (or override with reason if wrong); review the responsibility
   plan.
3. Confirm the plan and activate the workflow.
4. Observe what activation now does: the platform derives the required
   actions (IT email, Finance email, benefits questions, assets from the
   issued list, survey) - and note what it does NOT do: no IT/Finance queue
   tasks, no manager form-approval task.

## Part 8 - Read the Required actions panel (exception-first)

As the HR Officer on the case overview:

1. "Requires your attention" lists only what needs a human decision right
   now (expect the benefits confirmation, and the recipient gap planted in
   Part 5).
2. "In progress automatically" shows the emails the platform is handling.
3. Completed items are collapsed. Every derived item explains itself
   ("derived from: departure type, effective time"). Confirm the language
   is business language throughout - no technical state names.

## Part 9 - Confirm benefits once

As the HR Officer, open Benefits and providers:

1. Answer group health YES, group life NO, other provider NO.
2. Watch the consequences: a provider notification is prepared for review
   (YES); nothing exists for group life (NO); the attention item clears.
3. Re-open and set one value UNKNOWN to see it return to the attention list
   - the case cannot clear while a benefit question is unanswered. Set it
   back.

## Part 10 - The automated IT and Finance emails

No clicks required - the internal emails prepare, approve (SYSTEM actor)
and dispatch automatically. As any HR participant:

1. Open the Development mailbox (`/dev/mailbox`): the IT access-removal
   email states the employee reference, case reference and the EXACT
   effective separation time; the Finance email carries its minimum field
   set. Neither contains reasons, survey content or pay data.
2. Note both carry secure confirmation links and that the case's IT/Finance
   items show "Sent".
3. Facilitator point: in production these go to the real IT/Finance
   mailboxes; in UAT the capture mailbox IS the demonstration that no real
   email leaves the machine.

## Part 11 - The department experience: secure links, no login

Acting as the IT recipient (from the captured email):

1. Open the acknowledgement link → a neutral confirmation page shows only
   the action and case reference - no case access, no sign-in.
2. Confirm receipt, then confirm completion (recording SIMULATED access
   removal only - no real system is touched).
3. Open the link again: it is dead, neutrally ("this link is no longer
   valid") - single use.
4. Back in the application: the IT item shows "Completed" with the
   evidence instants, and the audit trail shows the token issue/use events.
5. For Finance, demonstrate the alternative: as the HR Officer, record
   evidence "confirmed by phone" with a note instead of using the link.

## Part 12 - Recipient-entry demonstration

The provider notification whose recipient was left missing (Part 5):

1. The case shows "Recipient required" on the attention list - the platform
   never silently skips a send.
2. As the HR Officer, enter the recipient for THIS CASE ONLY (name,
   organization, email) - no HR-Manager approval needed; the address is
   stored encrypted and displayed masked.
3. Tick "save for future cases" to show the difference: that path requires
   recipient-directory authority and the approval/verification lifecycle.
4. Approve the provider notification from "Needs your review" and see it
   dispatch to the capture mailbox.

## Part 13 - The actual manager's experience

The mapped real manager signs in as themselves:

1. My queue shows exactly their handover tasks for their direct report -
   nothing else, and no Action-Form approval anywhere.
2. Open the case's Handover page, work the sections, complete it.
3. Verify they cannot see other cases, reasons, or the Audit centre.

## Part 14 - HR documents (finalized by the officer, DEC-066)

As the HR Officer: create the resignation acknowledgement draft → validate
and finalize (attested) → download the PDF - the real organizational details
appear correctly. No HR Manager approval of the document exists; the HR
Manager approved the case once. A termination letter remains impossible.

## Part 15 - Action Form: the officer completes it

As the assigned HR Officer:

1. The form opens pre-filled from the case; the employee-acknowledgement
   treatment is already suggested where the departure type warrants it.
2. Work the HR checklist, finish preparation and COMPLETE the form - no
   manager approval exists; completion is attested and renders the
   immutable PDF.
3. Facilitator note: if the optional review policy is enabled
   (`actionForm.requireHrReview`), show the HR-Manager review step before
   completion; it is off by default.

## Part 16 - Assets from the issued list

As the HR Officer on the Assets tab:

1. The checklist lists exactly the employee's issued items - no generic
   11-type dropdown.
2. Record dispositions; mark one LOST to see the exception (and confirm NO
   monetary/payroll consequence exists). Note each unresolved item needs
   its OWN decision or exception - one approved exception never covers the
   rest.
3. Show "Add unlisted asset" as the explicit exception path.

## Part 17 - Survey: scheduled automatically

Nothing to do - that is the demonstration. The invitation schedules itself
after the effective separation for eligible departures (the worker does
it); open the case's Survey tab to see the schedule and that it NEVER
blocks clearance. Then generate/complete the TEST invitation as before to
show the respondent experience; responses stay with case HR only.

## Part 18 - Clearance from evidence

As the HR Manager on the clearance screen:

1. Conditions group by HR / Manager / IT / Finance / Providers / Benefits /
   Assets / Documents / Handover / Security, unresolved first.
2. Point out the new evidence gates: IT is green only because completion
   was CONFIRMED (Part 11) - a merely-sent email would block; Finance
   because its notification went out; Benefits because nothing is UNKNOWN.
3. Resolve anything open, request clearance, approve. The case completes
   with the checksummed clearance snapshot.

## Part 19 - Audit and reporting

As the HR Manager in the Audit centre: filter to the case number and read
the timeline - directory selection, derivation (with rule provenance),
every automatic email, the token issue/use, the recipient entry, the
completion - who/what/why/when, with the automated steps carrying MORE
detail than manual ones. Export CSV (audited). Technical events (identity,
configuration, sync) sit in the same feed since DEC-063. Then run reports with
purpose TEST and confirm UAT cases stay out of operational KPIs.

## Part 20 - Alternate scenarios, clear-down and feedback

- **Immediate resignation**: the seeded case - IT email goes out
  immediately marked urgent; the Action Form suggests the NOT_OBTAINED
  acknowledgement treatment with the standard reason.
- **Restricted termination**: the seeded TERMINATION case - invisible
  outside participating HR; the IT email is HELD until one hour before the
  effective instant and Finance until the effective instant; sends are
  released by the assigned HR Officer under the case approval (DEC-066); no
  letter, no survey without an explicit decision.
- **Unconfirmed IT action**: let the effective instant pass without using
  the IT link (or expire it) - a CRITICAL attention item appears: verify
  with IT and record evidence, or approve a security exception. Delivery is
  never treated as completion.
- **Manager override / missing manager / officer reassignment /
  organizational change**: unchanged from the Directive 6.2 sequence and
  still worth a pass.
- **Legacy case check**: open a pre-redesign (v1) case and confirm it still
  shows its IT/Finance tasks and clears task-based - history is never
  reinterpreted.

**Clear-down** (one command, DEC-041/DEC-043):

```
pnpm exec tsx scripts/reset-environment.ts purge-live --yes   # remove real data, keep cases
pnpm exec tsx scripts/reset-environment.ts uat --yes          # full synthetic rebuild
pnpm exec tsx scripts/reset-environment.ts fresh --yes        # production-ready clean start
```

After any live round: run `pnpm exec tsx scripts/scan-real-names.ts` before
anything is committed or shared.

**Operational feedback (ask every participant, per Directive 6.2 Part 19):**
where did you still click too many times; what did you re-enter; what was
automatic that should require review (and the reverse); which attention
items would become noise; what would prevent daily use. Record answers per
role with case numbers (never names) in
`../delivery/StakeholderSyntheticUATReport.md`.
