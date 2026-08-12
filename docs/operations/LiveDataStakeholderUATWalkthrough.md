# Live-Data Stakeholder UAT Walkthrough (Directive 6.2, DEC-043)

The operational rehearsal: real employees, real hierarchy, real responsibilities -
**simulated offboarding events only**. Every UAT case is a TEST record with the
"UAT — SIMULATED OFFBOARDING" banner; no live email, no BambooHR write, no
account deactivation of real identities, no payroll anything. Real names live
only in this machine's database and must never enter Git, shared screenshots or
written evidence (use case numbers and roles in notes).

Roles are written as functions ("the HR Manager"); people mapped through the
Organization screen act as themselves.

## Part 1 - Start the system

```
pnpm dev        # terminal 1 - web app on http://localhost:3000
pnpm worker     # terminal 2 - sweeps, escalations, outbox
```

If the environment looks broken: `pnpm exec tsx scripts/reset-environment.ts status`,
and see Part 18 for rebuild options.

## Part 2 - Verify safety

As the System Administrator, confirm on Administration → Health and → System:

1. Email provider mode: capture/sink (messages land in the Development mailbox).
2. BambooHR credential: configured, READ-ONLY (no write method exists).
3. No payroll/pay-calculation surface exists anywhere (by design - it never will).
4. Identity: only local accounts; disabling drills use the synthetic
   "Second IT Responder", never a real mapped colleague.
5. The top banner reads "UAT environment - simulated offboarding only".

## Part 3 - Sync the live directory

As the System Administrator on Administration → System:

1. "Test connection (read-only)" - aggregate counts only.
2. Set `bamboohr.mode` = `live`, then "Run directory sync (live adapter)".
3. The red LIVE HR DIRECTORY DATA banner appears - expected for this UAT.
4. Review Administration → Organization: employees/departments/locations/manager
   links, the health findings and the Key officeholders table.
5. Resolve mapping issues the health screen raises (missing managers are
   expected for a few people - scenario 7 covers the handling).

## Part 4 - Map actual responsibilities

As the System Administrator on Administration → Organization →
"Map a directory person to an application account":

1. Map the actual HR Manager → HR_MANAGER.
2. Map the actual HR Officer(s) → HR_OFFICER.
3. Map the actual IT responder(s) → IT_RESPONDER.
4. Map the actual Finance responder(s) → FINANCE_RESPONDER.
5. Managers are hierarchy-derived: map a manager account (LINE_MANAGER) only
   for the managers participating in the UAT - their access stays scoped to
   their own cases and tasks.
6. System administration stays with the person operating this environment.

Mapped colleagues appear on the sign-in screen under "Directory-mapped staff"
and can sign in as themselves. The function accounts remain for anyone absent.

## Part 5 - Create the standard UAT case (Scenario 1)

Seed the scenario set first (facilitator, once):

```
pnpm exec tsx scripts/live-uat-seed.ts
```

It selects real employees by organizational pattern (different departments,
locations and managers; no senior executives) and prints case numbers only.
Then, as the HR Officer, create ONE case fully by hand to test the intake:

1. Cases → New case → search the real directory by name, id, department or
   position → Select.
2. Review the "From the directory (source data)" panel: name, number, position,
   department, location, direct manager, last sync. Nothing is re-typed.
3. Enter the separation-specific details (dates, notice, reason capture) -
   set Record purpose to TEST.
4. Create draft → submit for HR review.

## Part 6 - HR Manager: ownership, manager confirmation, activation

As the HR Manager on the new case:

1. Approve the case.
2. Assignment tab (the responsibility plan): assign the actual HR Officer;
   confirm the derived real manager (or override with reason if wrong);
   review the department routing, workload and the full task table
   (owning queue, assignee, due, dependency).
3. Tick the six confirmations, confirm the plan.
4. Workflow tab → activate. Manager tasks route to the real manager's account;
   IT and Finance tasks land unassigned in their queues.

## Part 7 - The actual manager's experience

The mapped real manager signs in as themselves:

1. My queue shows exactly their tasks for their direct report - nothing else.
2. Open the case's Handover page, work the sections, complete it.
3. Verify they cannot see other cases, reasons, or the Audit centre.

## Part 8 - The actual IT experience

A mapped IT responder signs in:

1. My queue → Unassigned → Claim the access-review task (one click, no reason).
2. Complete it with evidence; note the exact-time revocation task and that it
   can never be waived. Record SIMULATED access removal only - no real system
   is touched.
3. Try "Return to queue" and a reassignment to a second IT responder (reason
   required; the due date never changes).

## Part 9 - The actual Finance experience

Same flow in the Finance queue: claim, complete with the minimum data shown,
record the simulated external-workpaper status. Confirm no exit reasons,
survey answers or pay calculations are visible anywhere.

## Part 10 - HR documents

As the HR Officer: create the resignation acknowledgement draft → validate →
submit. As the HR Manager: approve and download the PDF - the real
organizational details appear correctly.

## Part 11 - Action form

HR section (officer) → manager approval (the real manager) → HR final approval
(manager). Note the acknowledgement handling options.

## Part 12 - Handover

Covered in Part 7; verify the completed handover feeds clearance.

## Part 13 - Assets

As the HR Officer on the Assets tab: record dispositions; mark one LOST to see
the exception (and confirm NO monetary/payroll consequence exists).

## Part 14 - Survey

Generate the invitation (TEST channel), open the link, answer as the departing
employee, submit. Responses are visible to case HR only.

## Part 15 - Clearance

As the HR Manager: the clearance decision screen groups conditions by
HR / Manager / IT / Finance / Assets / Documents / Handover / Security with
only unresolved items prominent. Resolve what's open, request clearance,
approve. The case completes.

## Part 16 - Audit

As the HR Manager in the Audit centre: filter to the case number and read the
timeline from directory selection through clearance - every assignment, claim,
override and approval with who/what/why/when. Export CSV (the export itself is
audited). As the System Administrator: confirm the technical feed shows no
case content.

## Part 17 - Reporting

As the HR Manager: run reports with purpose TEST; confirm UAT cases stay out
of operational KPIs; export CSV.

## Part 18 - Alternate scenarios and clear-down

- **Scenario 2 (immediate resignation)**: the seeded case in another
  department - urgent exact-time task, overdue escalation.
- **Scenario 3 (manager override)**: on any case, override the derived
  manager with reason; verify the old manager loses access, the new one gains
  scoped access, open manager tasks move.
- **Scenario 4/5 (claim + reassignment)**: Part 8/9 with a second responder.
- **Scenario 6 (HR officer reassignment)**: HR Manager reassigns the case to
  another officer; completed work keeps its attribution.
- **Scenario 7 (missing manager)**: the seeded UAT-SIM case - activation is
  blocked with MISSING MANAGER until an alternate is assigned (audited).
- **Scenario 8 (restricted termination)**: the seeded TERMINATION case -
  invisible to everyone but participating HR; IT/Finance see minimum data;
  no letter, no survey.
- **Scenario 9 (personnel change)**: disable the synthetic "Second IT
  Responder" (never a real person), watch sessions revoke and orphaned tasks
  flag, reassign, re-enable.
- **Scenario 10 (organizational change)**: re-run the directory sync after HR
  changes something in BambooHR (or wait for a natural change); active cases
  flag the hierarchy change for review - nothing reroutes silently.

**Clear-down** (one command, DEC-041/DEC-043):

```
pnpm exec tsx scripts/reset-environment.ts purge-live --yes   # remove real data, keep cases
pnpm exec tsx scripts/reset-environment.ts uat --yes          # full synthetic rebuild
pnpm exec tsx scripts/reset-environment.ts fresh --yes        # production-ready clean start
```

After any live round: run `pnpm exec tsx scripts/scan-real-names.ts` before
anything is committed or shared.

## Part 19 - Operational efficiency feedback (ask every participant)

- Where did you click too many times?
- Where did you re-enter information the system already had?
- Which task owner was wrong? What should have been automatic?
- What was automatic that should require review?
- Which approval adds no value - and which is essential?
- Which screen was confusing? What information was missing or unnecessary?
- Which alerts would become noise in daily use?
- Which reports would you actually use?
- What would prevent you from using this every day?

Record answers per role, PASS/FAIL per scenario, and case numbers (never
names) in `docs/delivery/StakeholderSyntheticUATReport.md`; findings feed
`docs/delivery/OperationalEffectivenessReview.md`.
