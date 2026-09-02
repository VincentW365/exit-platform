# Owner Testing Guide — full-operation mirror

_Last updated: 2026-08-16 (Directive 6.3 build). Audience: the product owner
testing the complete application alone, against the real organization
directory, with every automation enabled._

## 1. What is running and what is simulated

| Piece | State |
| --- | --- |
| Web app | http://localhost:3000 (development build of the current code) |
| Background worker | Running; sweeps every 60 seconds (releases tasks, sends scheduled emails, escalates, schedules surveys) |
| Database | Fresh — **zero cases**; all reference data seeded (workflows v2, 9 notification templates, recipients, send-control defaults) |
| Organization data | **Live BambooHR directory — 375 real people, real hierarchy** (read-only; re-synced automatically every 6 hours and after every rebuild) |
| Automation flags | All five enabled (letters, notifications, reminders/escalation, surveys, workflow engine) |
| Email | The ONLY simulated piece: messages are delivered to the in-app capture mailbox at **/dev/mailbox** instead of real inboxes. Content, timing, links and evidence flow are exactly what production would send — nothing ever leaves the machine. |

Everything else — screens, permissions, automation, audit — behaves exactly as
full operation.

## 2. Signing in

Open http://localhost:3000 on the host, or - for a tester on another
workstation - the LAN address printed by `pnpm dev` (it changes with the
host's DHCP lease, so read it from the banner each time; see
`LanAccessForInternalUAT.md` for the firewall rule that has to exist first).
Use the development role switcher. Active accounts after the rebuild:

| Account | Role | Use it for |
| --- | --- | --- |
| HR Manager | HR_MANAGER | Case approval, officer assignment, releases needing management authority, clearance |
| HR Officer | HR_OFFICER | Daily case work: create, prepare, complete |
| _(no manager login)_ | — | Line managers receive a departure notice by email and hold no login, queue or task (DEC-051/DEC-052) |
| System Administrator | SYSTEM_ADMIN | Technical administration; no case content |

IT and Finance responder logins no longer exist — those departments receive
automated controlled emails and confirm through secure links (section 6).

## 3. Record purpose — pick before you start

- **TEST** — best for experiments. Full automation runs (into the capture
  mailbox); excluded from every business report and KPI.
- **OPERATIONAL + PILOT cohort** — behaves identically AND appears in
  reports; use it to see the reporting side.
- **OPERATIONAL + BASELINE cohort** — automation is deliberately locked out
  (baseline control group). Expect activation to refuse; that refusal is
  correct behavior, not a bug.

## 4. The daily flow, end to end

1. **Create the case** — Cases → New case. Search the live directory by name,
   Employee # or department; pick a real employee. Identity, Employee #,
   position, department, location and manager arrive pre-populated. Enter only
   the separation facts: departure type, when it was received and how, the
   final working date (a resignation with notice ends at close of business on
   that date, so the platform sets the exact time itself), and whether a reason
   was given. Attach a resignation letter if you want the document flow.
2. **Submit → Approve** (HR Officer submits; HR Manager approves — an
   immutable employee snapshot is captured at approval).
3. **Assignment tab** — assign the operational HR Officer (the list shows
   every eligible active HR person with their real job title); the manager
   routing is derived from the live hierarchy (override with a reason if
   needed); tick the six confirmations.
4. **Activate** — the moment to watch. The rules engine derives everything:
   IT and Finance email actions, provider actions per benefits applicability,
   one recovery item per actually-issued asset, the line manager's departure
   notice, survey eligibility.
   Check the case Overview: the **Required actions** panel shows "Requires
   your attention" (only genuine decisions), "In progress automatically", and
   a collapsed "Completed" group.
5. **Benefits and providers** (Overview) — confirm Group health / Group life
   (Yes/No/Unknown) and Other provider (Yes/No). YES prepares the provider
   notification; NO creates nothing; UNKNOWN keeps an attention item open and
   blocks clearance until resolved.
6. **Email actions tab** — IT and Finance are AUTO_SEND: within a minute the
   worker dispatches them (statuses move to "Sent") with no clicks from you.
   External providers wait at "Needs your review" — release them yourself
   (HR-Manager authority for restricted cases). Missing recipient? A
   prominent "Recipient required" block lets you enter one for this case
   (use an `@example.invalid` address in development) or save it to the
   directory for future cases.
7. **The mailbox + secure links** — open /dev/mailbox. Each captured message
   is exactly what IT/Finance/providers would receive, including the
   `/ack/...` confirmation links. Open a link in a private/incognito window
   (no login!): acknowledge receipt, and for IT confirm completion. Watch the
   case's email action move to "Acknowledged" / "Completed". Links are
   single-use — a second visit shows the neutral "not valid" page.
   Alternative: on the Email actions tab, record evidence yourself
   ("confirmed by email/phone" with a note).
8. **Assets** — only the employee's actually-issued items appear. Record
   returns (status, date, condition). LOST/DAMAGED/UNRESOLVED need a reason;
   waivers and write-offs need the HR Manager. No pay effect exists anywhere.
9. **Handover** — sign in as the routed Line Manager: fill the handover
   sections and complete with attestation (credential-like content is
   rejected). This is the manager's only responsibility.
10. **Action form** — as the assigned HR Officer: the form arrives
    pre-populated; work the HR checklist and acknowledgement (immediate
    resignations pre-suggest "Not obtained"); record Finance evidence; then
    "Finish preparation" and **"Complete action form"** — you complete your
    own form; no manager approval exists. The attested PDF renders.
11. **Documents** — draft the resignation acceptance letter, submit, and have
    the HR **Manager** approve (maker-checker stands for employee-facing
    documents); download the rendered PDF.
12. **Survey** — scheduled automatically for eligible departures (watch the
    worker create the invitation). It never blocks clearance.
13. **Clearance** — as HR Manager: the page is a summary ("READY FOR
    CLEARANCE" or "CLEARANCE BLOCKED — N items") with only unresolved items
    prominent. IT clears on completion evidence (delivery alone never
    counts), Finance on sent, providers on sent-where-applicable. Request →
    approve final clearance → case COMPLETED with an immutable clearance
    record.
14. **Audit tab / Audit Centre** — read the automation trail in plain
    sentences: what the system determined, which rule, when each email was
    scheduled/sent/confirmed, every override with its reason.

## 5. Exception paths worth trying

- Leave benefits UNKNOWN and try to clear — blocked, with the item named.
- Suspend a provider recipient (Administration → Recipient directory), then
  confirm benefits YES — a "Recipient required" exception appears instead of
  a silent skip; enter a case-only recipient and watch it resolve and send.
- Let an IT email sit unconfirmed past the effective time — the worker opens
  a CRITICAL "unconfirmed at the deadline" exception on the Exit Center
  (the app's landing page — renamed so it is never confused with the separate
  HR Dashboard application).
- Return an action form for correction (reason required) and re-complete it.
- Change the effective separation time (audited correction) — documents and
  forms are superseded, due dates recalculate, derived schedules recompute.
- Mark an asset LOST — resolve the exception with an audited note.

## 6. Administration surfaces

| Surface | Where | What to check |
| --- | --- | --- |
| Recipient directory | Administration → Recipient directory | Organizations, purposes, contacts; approval + verification lifecycle; masked destinations |
| Notification templates | Administration → Notification templates | Draft a v-next, preview with sample values, test-send to capture, activate (HR Manager) |
| Feature flags & config | Administration → System | The five automation flags; escalation thresholds; send-control levels |
| Email delivery status | Administration → Email delivery status | Technical outbox view: captured/submitted rows, retries, dead letters |
| Organization | Administration → Organization | The live directory coverage and hierarchy health |
| Pilot readiness | Administration → Pilot | 24 readiness gates (9 active templates, verified recipients, backups, …) |
| Audit center | Audit center | Business lens (HR Manager) and technical lens (System Administrator) |
| Reports | Reports | Run any of the 22 reports; TEST records are excluded unless you filter for them |

## 7. Keeping the environment healthy

- **Status**: `pnpm exec tsx scripts/reset-environment.ts status`
- **Restart web/worker**: ask Claude to start them, or run `pnpm dev` and
  `pnpm worker` in two terminals. `pnpm dev` prints the LAN address for a
  tester on another workstation; `pnpm dev:local` keeps the app private to
  this machine. Restarting never needs a code change to restore LAN access -
  the host and port come from `.env` (`WEB_HOST`, `WEB_PORT`).
- **Postgres** (port 5433, on demand): see DEVELOPMENT.md `pg_ctl` commands.
- **Full reset, no cases**: `pnpm exec tsx scripts/reset-environment.ts fresh --yes`
  — since this build, a rebuild automatically reconnects the live directory
  and re-syncs it. Automation flags reset to off; re-enable them under
  Administration → System.
- **Safety guarantees that always hold**: BambooHR is read-only (nothing is
  ever written back); email never leaves the machine in development; history
  is append-only (no hard deletes anywhere).

## 8. If something looks wrong

1. Check the worker log (`..\hr-offboarding-local-runtime\logs\worker.log`) —
   automation waits up to 60 seconds for the next sweep.
2. Check the case's Audit tab — every automated decision explains itself.
3. Check /exceptions — anything needing a human is there, with a link to the
   fixing surface.
4. `pnpm exec tsx scripts/reset-environment.ts status` for the environment
   picture.
