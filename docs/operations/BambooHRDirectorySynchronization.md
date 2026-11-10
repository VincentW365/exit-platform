# BambooHR Directory Synchronization - Runbook

Owner directive, 2026-09-15. BambooHR is the system of record for employee
demographic and employment data. The platform keeps a **read-only mirror**
(the Employee Directory) that every feature reads - search, intake, manager
routing, profiles. The platform never writes employee data back to BambooHR.

## How the mirror stays current

| Layer                       | Trigger                                              | What it does                                                                |
| --------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| Webhook                     | BambooHR posts an employee change                    | Re-reads the named employee(s) from BambooHR; one run per employee          |
| Hourly reconciliation       | Worker, when no sync has succeeded in the last hour  | Incremental: one listing request; details re-read only for new or changed rows |
| Nightly full reconciliation | Worker, once a day after 02:00 Jamaica               | Exhaustive: every employee's detail record; archives records no longer fed  |
| Start-up check              | Worker start, when the last success is 2+ hours old  | Immediate incremental read                                                  |
| Manual refresh              | Administrator: **Refresh Directory Now**             | Incremental read, executed right after the click; the page follows its progress |

"Incremental" means the directory listing (one request) is compared with the
mirror and a per-employee detail request is made only for rows that are new,
archived, never detailed, or whose listing fields changed. A change to a
detail-only field (hire date, employee number) with an unchanged listing
therefore arrives with the next webhook or the nightly pass. Three
exhaustive reads of 380 employees within six minutes were enough to make
BambooHR answer with upstream errors during the first evidence run
(2026-09-15); the incremental design keeps ordinary hours to one request.

Every run is a row in the synchronization log (`/admin/directory-sync`):
kind, result (success / completed with failures / failed), counts checked,
added, updated, archived and failed, the safe error code where one occurred,
and - for webhooks - the changed field **names** BambooHR reported. Employee
values are never stored on a run.

Runs execute **one at a time** under a database lease shared by the web
server and the worker. A run left behind by a process that died is closed as
FAILED (ABANDONED) after 15 minutes so it can never block later refreshes.

## Rules the engine keeps

- **Idempotent upserts** by BambooHR employee id: a repeated webhook or an
  overlapping reconciliation never creates a duplicate.
- **Archive, never delete.** An employee absent from a full feed becomes
  Inactive with an archive time. The record stays because cases, snapshots
  and audit events point at it. It is restored in place if BambooHR lists
  the employee again.
- **BambooHR wins** for BambooHR-owned fields (name, title, department,
  division, location, employee number, manager, work email, work phone,
  employment status, hire date). Those fields cannot be edited here.
- **Platform-owned data is untouched**: cases, tasks, documents, notes and
  the employee snapshot captured at approval are never rewritten by a sync.
- **Minimum data only.** No SSN, banking, compensation, tax, medical or home
  address fields are requested or stored; the allow-list lives in
  `packages/domain/src/bambooDirectory.ts`.
- **Failures are contained.** A row that fails is counted and the run
  continues (result: completed with failures). A source failure fails the
  run and leaves the cached directory exactly as it was.

## Freshness and what HR sees

Freshness is judged by the last **successful** synchronization (thresholds
configurable under `directory.sync`, defaults shown):

| Age of last success | State                | Shown to                          |
| ------------------- | -------------------- | --------------------------------- |
| under 2 h           | Current              | one quiet line                    |
| 2 - 6 h             | Refresh delayed      | HR, as a status note              |
| 6 - 24 h            | Stale                | HR, as a warning                  |
| over 24 h           | Administrative alert | administrators, as an alert       |
| never               | Not yet synchronized | the only "unavailable" wording    |

During a BambooHR outage the directory, intake search and profiles keep
working from the cache. Nobody sees "Employee Directory unavailable because
BambooHR is down" unless there has never been a successful synchronization.

## Setting up the webhook in BambooHR

1. Generate a private key for the webhook (BambooHR creates one when the
   webhook is added through the API, or supply your own long random value).
2. In BambooHR, create an employee-change webhook that posts to
   `https://<platform host>/api/bamboohr/webhook` with the `employees` array
   payload (employee id and changed fields) and the HMAC signature headers
   `X-BambooHR-Timestamp` and `X-BambooHR-Signature`.
3. Put the private key in the platform's secret store as
   `BAMBOOHR_WEBHOOK_PRIVATE_KEY` (locally: the gitignored `.env.local`).
   While it is empty the endpoint does not exist (404) and nothing is
   accepted.
4. Watch `/admin/directory-sync` filtered to "BambooHR webhook": each
   delivery appears as a run for the employee it named. Rejected deliveries
   (no signature, wrong key, stale timestamp - default skew 5 minutes,
   `directory.sync.webhookMaxSkewSeconds`) are audited by category only.

The webhook payload is trusted for one thing: **which** employees changed.
Their current record is then read from BambooHR by the engine.

## Configuration keys

| Key                          | Meaning                                                                 |
| ---------------------------- | ----------------------------------------------------------------------- |
| `bamboohr.mode`              | `fixture` (synthetic) or `live` (read-only BambooHR). Unset: `live` whenever a credential is configured, except in a test environment (DEC-071) |
| `bamboohr.scheduledSync`     | `true`/`false` for the hourly, nightly and start-up reconciliations. Unset: follows the mode - on when live (DEC-071) |
| `directory.sync`             | JSON: `hourlyMinutes`, `nightlyHour`, `nightlyMinute`, `staleDelayedHours`, `staleWarningHours`, `staleAlertHours`, `startupStaleHours`, `webhookMaxSkewSeconds` |
| `bamboohr.simulateOutage`    | Development/UAT only: makes the source unreachable to prove the cache; ignored in production |

## When the health panel says Failing or the directory says Stale

1. Open `/admin/system` - Employee Directory. Read the last result and its
   error code (`AUTH_FAILED`, `NETWORK_ERROR`, `RATE_LIMITED`,
   `UPSTREAM_ERROR`, `BAD_REQUEST` for a rejected request such as an unknown
   field name, `BAD_RESPONSE` for a body the field mapper cannot use). A
   throttled read (`429`, or a `503`, which BambooHR says is usually rate
   limiting) waits for the source's `Retry-After` - at most 15 seconds a
   time, three times - and every other read on that run waits with it; any
   other server failure is retried once. **Test connection (read-only)**
   reads the directory listing alone, one request, so it never causes the
   throttling it is checking for. `RATE_LIMITED` passes by itself: wait a
   few minutes, then press **Refresh Directory Now**.
   The System page itself makes no BambooHR request; **Run reconciliation
   report** reads the listing once (one request) and shows the result under
   Latest reconciliation.
2. Fix the cause (credential, network, BambooHR incident). The cached
   directory stays in use meanwhile; offboarding is never blocked.
3. Press **Refresh Directory Now**, or wait for the next reconciliation. The
   first success clears the warning.
4. For a long outage, tell HR that manager and title changes made in
   BambooHR during the outage arrive with the first successful run.

## Evidence

`pnpm regression:offboarding` records the directory proofs under
`BambooHR Directory/` in the run folder: the controlled employee's profile
after synchronization, the manager linked by identifier, a manual refresh,
a signed webhook update (with unsigned and forged deliveries refused), an
hourly reconciliation and a simulated outage with the cached directory in
use, followed by recovery. See `docs/delivery/OffboardingRegressionSuite.md`.
