# Offboarding End-to-End Regression Suite and Evidence Pack

Owner directive, 2026-09-09: one controlled employee, every supported separation
type, a folder of evidence a reviewer can read without the test code.

## Running it

```text
pnpm regression:offboarding --employee "<Display Name>" [--mailbox <address>] [--port 3101] [--grep TEST-03]
```

- Stop the ordinary dev server first (`pnpm dev`). Next.js keeps one dev server
  per application directory; the runner refuses while `apps/web/.next/dev/lock`
  exists and while the chosen port is busy.
- The runner starts its **own** web server on port 3101 in the UAT posture and
  runs `playwright test -c playwright.regression.config.ts`.
- The evidence lands in `test-results/offboarding-e2e/<run-date>-<run-id>/`
  (gitignored). Open `summary.html` there.
- Defaults keep committed code synthetic: without `--employee` the suite uses
  the fixture person **Avery Brown**, and without `--mailbox` the redirect
  target is the reserved, undeliverable `uat-test-mailbox@example.test`.
  Name the controlled employee and the designated test mailbox on the command
  line; do not commit either.

## What "email test mode" means here

The platform has two layers, both used:

1. **UAT posture** (`APP_ENVIRONMENT=test`, requires `TEST_EMAIL`): routing is
   resolved exactly as production - the employee's and the manager's real work
   addresses from the directory, the configured departmental and provider
   recipients - and then **every** message is force-redirected to the one test
   mailbox. The outbox row keeps `intendedToMask`, `intendedCcMasks`,
   `actualToMask` and `wasTestMode`; the outgoing body carries the intended
   recipients in full above the intercept banner. This cannot be switched off
   in that posture.
2. **Provider**: development can only run the capture provider
   (`EMAIL_MODE=dev-capture`, alias `sink`). It writes the message to the
   database (`/dev/mailbox`) and never sends. The Microsoft Graph adapter is a
   fail-closed stub without credentials.

So "Actual Delivered To" in the evidence is the redirect target as recorded by
the platform, and the message itself is the captured record. **Nothing leaves
the machine in any run of this suite.** When a delivering provider is
configured in a real UAT deployment, the same redirect rules apply and the
test mailbox will receive the messages.

A defect found while building this: the `TEST_EMAIL` format check in
`packages/config` had lost its backslashes and refused any address containing
the letter "s", so the UAT posture could not start at all. Fixed with a unit
test (`packages/config/test/env.test.ts`, "UAT redirect mailbox").

## Isolation and metrics

- Cases are created through the real intake, which classifies every new case
  as OPERATIONAL (owner decision 2026-08-17). Immediately after creation, while
  still DRAFT, the suite calls the audited product service
  `correctRecordPurpose(..., 'TEST', reason)` through the database bridge. TEST
  records are excluded from every report and KPI (`isOperationalForReporting`),
  show the UAT banner, and still exercise every automation (the feature gate
  lets non-operational records through in non-production).
- The platform does not block a second live case for the same employee; it
  warns (REQ-CASE-020). Each scenario is its own case; the warning is asserted
  from the second scenario on.
- At the start of a run, still-live TEST cases for the employee from earlier
  runs are **voided** through `transitionCase` with an audited reason.
  Completed ones are terminal history and are left alone.
- The source directory record is read, never written. Whether the record holds
  a contract end date is reported, not assumed (the BambooHR field allow-list
  does not carry one, so contract expiry exercises the "HR types it" fallback).

## Structure

```text
playwright.regression.config.ts             own config: port 3101, UAT posture, serial
scripts/offboarding-regression.ts           runner (guards, run folder, summary print)
e2e/offboarding-regression/
  offboarding.spec.ts                       one test per separation type, discovered from the profiles
  global-setup.ts / global-teardown.ts      posture record, leftover cleanup / summary build
  support/run.ts                            run folder, execution.json
  support/evidence.ts                       ScenarioEvidence: checks, screenshots, matrices, result.md/json
  support/ui.ts                             the application as a person drives it
  support/db.ts + db-bridge.ts              read-back and the three audited writes, via tsx child process
  support/emails.ts                         .eml/.json per record, routing.md
  support/expectations.ts                   per-type expectations, mostly read from the separation profile
  support/dates.ts                          deterministic date plan from the execution date
  support/redact.ts                         token redaction
  support/summary.ts                        README.md, summary.md, summary.html
```

## What each scenario does

Intake from the keyboard (type the name, Enter, select, choose the type,
dates by profile, About step where the profile needs it, reason) - as the HR
Officer for ordinary types, as the HR Manager for restricted types
(termination, redundancy; see finding 3) - accordion and keyboard checks,
Review and create; purpose corrected to TEST; HR Manager approval (or the
manager's own one-step approval of a restricted draft); HR Officer
assignment and manager routing (the directory
manager is kept as the departure-notice recipient wherever the platform
offers them); activation; benefits confirmed per scenario (both YES/NO paths
covered across the run); assets ticked in two scenarios, the no-asset
behaviour confirmed in the rest; HR-review email actions released; letters
for the two resignation types (draft, address, submit, attested approval, PDF
saved, sent by email); Employee Action Form completed for every type (PDF
saved); the sweeps the worker runs; task matrix against the ACTIVE workflow
definition; employee checklist link completed in a fresh, logged-out browser
context; IT and Finance acknowledgement links used; invalid link refused;
exit survey link generated once, completed, and its single use confirmed;
same-day termination: internal notices held until the effective instant,
which falls inside the run; HR tasks completed with evidence; clearance
requested and, where the gate allows, approved to COMPLETED; every email
record written as .eml + .json with intended vs actual routing; audit
timeline exported and screenshotted; reports checked for TEST-only inclusion.

Every check is `AUTOMATED PASS/FAIL/WARN` or `HUMAN REVIEW REQUIRED`
(presentation and business wording). A failed check is recorded and the
scenario continues; a broken step is recorded under `failures/` with the
error, log and screenshot, and the remaining scenarios still run.

## BambooHR Directory proofs (added 2026-09-15)

After the separation scenarios, one more test - `DIR BambooHR Directory`
(select it alone with `--grep DIR`) - records the directory proofs the
BambooHR directory directive asks for, in `BambooHR Directory/`:

| Folder                   | What it proves                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `initial-sync/`          | The controlled employee's profile after synchronization, with last-sync time and freshness       |
| `manager-resolution/`    | The manager linked by BambooHR identifier, and the employee listed among the manager's reports   |
| `manual-refresh/`        | Refresh Directory Now: accepted at once, progress followed, result in the health panel           |
| `webhook-update/`        | An unsigned and a forged delivery refused (401); a correctly signed one accepted (202) and run    |
| `hourly-reconciliation/` | The worker tick queues nothing while fresh; an hourly reconciliation run completes                |
| `offline-cache/`         | A simulated BambooHR outage: sync fails safely, cache untouched, HR directory and intake search still work, then recovery |

Each folder holds numbered screenshots, the platform's own JSON (counts,
statuses, field names) and a `notes.md`; `BambooHR Directory/result.md`
lists every check, and `summary.html` gets a "BambooHR Directory" section.
The runner generates a per-run webhook private key for the web server so the
signed path is real; the key is never written to the evidence. When the suite
is started without the runner the signed-webhook proof is recorded as
skipped.

## Findings from the first runs (2026-09-09)

Recorded here so the next reader does not rediscover them; the evidence is in
the run folders of that day.

1. **`TEST_EMAIL` guard refused valid addresses** (packages/config). Fixed with
   unit tests; see above.
2. **An immediate resignation created with the platform's own defaults could
   not produce its letter.** The letter validation compared the last working
   day (a date-only column, midnight UTC) with the received instant, so a
   same-day case always read as "last working date is before the received
   date". Fixed in `documentService.submitDocument` to compare calendar days
   in the business zone; integration test "date-order check compares calendar
   days" in `packages/db/test-int/stage2Documents.test.ts`.
3. **Restricted intake by an HR Officer creates a case no HR Manager can
   reach.** A termination or redundancy opened by an HR Officer is RESTRICTED;
   approval, correction, voiding and participant management all require an
   HR Manager who is already a participant, and adding participants is HR
   Manager authority too - so the draft is invisible to every HR Manager and
   cannot be approved, corrected or voided through the product. The suite now
   opens restricted types as the HR Manager (who approves their own draft in
   one audited step, as the product intends). Two such drafts from the first
   baseline run remain in the dev database as OPERATIONAL drafts for the
   controlled employee (they were created before the purpose could be
   corrected); the sanctioned way to clear them is the environment reset
   (`scripts/reset-environment.ts uat --yes`). A product decision is owed:
   either refuse restricted types at officer intake, or add the approving HR
   Manager as a participant when a restricted case is created.
4. **Managers have no application login** (DEC-042), so the directory
   manager is never "resolved" and every case needs the alternate-manager
   step. The suite records the directory manager as the alternate whenever
   the directory offers them, so the departure notice still routes to the
   real manager; this is worth a product look, since the override exists only
   to satisfy a check that can no longer be met.
5. The not-found page renders its own `<main>` inside the layout's `<main>`
   (two main landmarks) - minor accessibility nit, seen when a restricted
   case was opened by a non-participant.
6. **A bare `next dev` and the worker do not share an object store.**
   `STORAGE_DIR=./storage` is resolved against the repository root only when
   a process has called `loadRootEnvFile` (the `pnpm dev` launcher and the
   worker do); a `next dev` started directly - as the Playwright configs do -
   resolves it against `apps/web`, so a PDF it renders is invisible to any
   other process's outbox pass, and the letter fails with "the provider did
   not accept the message". The suite now hands every process the same
   absolute `STORAGE_DIR`. The same split would affect the ordinary e2e
   config if a letter were ever dispatched by the worker rather than by the
   web server's own "Run outbox pass now"; worth making the object store
   resolution independent of how the server was started.
7. **The first three run folders of the day were destroyed by the suite
   itself.** Playwright empties its output directory at the start of every
   run, and the regression config had left that at the default
   `test-results/`, under which the evidence packs are written. The config
   now gives Playwright its own `test-results/offboarding-e2e-playwright/`
   for traces, and the ordinary `playwright.config.ts` its own
   `test-results/playwright/`, so no run of any config touches the evidence
   folders again (it happened twice before both were fixed). The two defects
   found by those runs are re-recorded in the surviving run's `failures/`
   from the vitest logs kept at the time.

8. **The letter greeted the employee by a truncated name** (an "Avery Brown"
   became "Dear Avery Bro,"). `firstNameOf`
   in `packages/domain/src/documents.ts` split on `/s+/` - the letter "s",
   not whitespace, another lost backslash. Fixed, with a unit test in
   `packages/domain/test/regressionFindings.test.ts`. (The notification
   service had its own, correct, first-name split; the letter and its cover
   email used the domain helper.)
9. **Clearance never recognised a letter the platform sent by email.** The
   gate and the service's live-letter lookup knew only RENDERED and
   MANUALLY_ISSUED, so after "Send to the employee by email" - the
   platform's own path - the documents condition read "Letter status: none"
   and a resignation case could not clear. ISSUED_BY_EMAIL now satisfies the
   condition (`packages/domain/src/clearance.ts`,
   `packages/db/src/services/clearanceService.ts`), with unit tests beside
   the fix.

10. **Suite defects worth knowing.** Besides the output-directory mistake (7): the
    with-notice scenario typed a fixed 09:30 receipt time, which the platform
    rightly refused as "in the future" when a run started earlier in the day
    (now "a few minutes before the run"); the checklist submission assumed a
    click had landed (now waits for the platform's own `?done=1` marker and
    retries); and the first case creation of a run needs a cold server's
    compile time (now allowed two minutes).

## Repeat runs

Nothing depends on manual cleanup or one-time state: the run voids its own
predecessors' live TEST cases, dates derive from the execution date, and the
employee's directory record is untouched. Rerun after any release with the
same command; compare `execution.json` and each `result.json`.
