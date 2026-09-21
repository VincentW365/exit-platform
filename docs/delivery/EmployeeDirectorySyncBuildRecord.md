# BambooHR Internal Employee Directory and Continuous Synchronization - Build Record

Owner directive, 2026-09-15. The platform now keeps a persistent internal
Employee Directory that mirrors BambooHR (the system of record) and stays
current through webhooks, hourly reconciliation, a nightly full
reconciliation, a start-up staleness check and an administrator's manual
refresh. Every feature that needs an employee - search, intake, manager
routing, profiles - reads the local mirror; nothing calls BambooHR per user
request, and nothing ever writes employee data back to BambooHR.

## Repository condition before work

`main` at `cbef106` (offboarding regression suite; unpushed). Working tree
clean. The existing integration (Directive 5.1/6.1) already held a read-only
`employee_source_record` mirror, a fixture and a live GET-only adapter, a
synchronous `syncEmployees` and a 6-hourly scheduled sync behind
`bamboohr.scheduledSync`. `/directory` was an organization overview.

## What was built

### Data (`packages/db/prisma`, migration `20260915090000_employee_directory_sync`)

- `employee_source_record` gains the directory minimum: first/middle/last/
  preferred name, work phone and extension, employment status, hire date,
  the source's last-changed instant, an `archivedAt` marker and
  `managerDirectoryId` - the manager as a directory record linked by
  BambooHR identifier (self-relation). Eight indexes cover the search and
  filter columns per source system.
- New `directory_sync_run`: every synchronization as a row - kind (WEBHOOK,
  HOURLY, NIGHTLY, STARTUP, MANUAL), status (QUEUED, RUNNING, SUCCESS,
  PARTIAL, FAILED), requested/started/finished, requester, targeted
  employee id (webhooks), changed field names, counts checked/added/updated/
  unchanged/archived/failed, safe error code and detail, correlation id.
- Least-privilege grants (`scripts/db/grants.sql`) and the integration
  truncate list updated. Migration applied to the development database and
  the integration test database.

### Domain rules (`packages/domain/src/directorySync.ts`, pure)

Freshness thresholds (current < 2 h, refresh delayed 2-6 h, stale 6-24 h,
administrative alert > 24 h, never), configurable under `directory.sync`;
hourly and nightly (02:00 Jamaica) due rules; start-up staleness; BambooHR
webhook verification (HMAC-SHA256 of raw body + timestamp with the webhook
private key, timing-safe, replay window); webhook payload parsing (employee
ids and changed field names only); mirrored-field change detection (field
names, never values); record status words; run result from counts. The
BambooHR field allow-list gains `middleName`, `workPhone`,
`workPhoneExtension`, `hireDate`, `lastChanged`; the forbidden categories
are unchanged.

### Synchronization engine (`packages/db/src/services/directorySyncService.ts`)

- `requestDirectorySync` queues a run; non-webhook requests join an already
  queued or running run rather than duplicating it. Runs abandoned by a dead
  process are closed as FAILED/ABANDONED after 15 minutes.
- `executeDirectorySyncRun` reads the source (whole directory, or the named
  employees for a webhook). The nightly pass is exhaustive (every employee's
  detail record); the hourly, start-up and manual passes are INCREMENTAL -
  one listing request, compared with the mirror, with per-employee details
  fetched only for new, archived, never-detailed or changed rows, while
  unchanged rows keep the details the mirror holds. (The first evidence run
  showed three exhaustive reads of 380 employees within six minutes were
  enough for BambooHR to answer with upstream errors.) It upserts
  idempotently by BambooHR id, links
  managers by identifier (a name is used only when unique), archives records
  absent from a full feed (never deletes; restores in place on reappearance),
  keeps the Directive 6.1 manager-change flag for open cases, records counts
  and field names, and audits completion or failure. A source failure fails
  the run and leaves the cached mirror exactly as it was.
- Runs execute one at a time under a database lease in `system_config`
  shared by the web server, the worker and tests.
- `directorySyncTick` (worker, every minute) queues the hourly and nightly
  reconciliations when due (behind `bamboohr.scheduledSync`) and executes
  whatever is queued; `directoryStartupCheck` runs at worker start.
- `directorySyncStatus` reports connection, counts, last event/incremental/
  full/successful times, the last result, the active run and freshness -
  counts and instants only. `listDirectorySyncRuns` filters the log by date,
  kind, result, employee and errors only (permission `directory.viewSync`:
  SYSTEM_ADMIN, HR_MANAGER).
- The adapter gains `getEmployees(ids)` (fixture: from the list; live: one
  GET per employee with the approved field list). The live per-employee
  detail read now requests `employeeNumber, hireDate, status, supervisorEId,
  workPhoneExtension, middleName, lastChanged` in one call. A development/UAT
  only `bamboohr.simulateOutage` switch makes the source unreachable to prove
  the cache; production ignores it.
- `syncEmployees(actor)` and `scheduledDirectorySyncIfEnabled()` remain as
  compatibility wrappers over the engine.

### Web

- `/directory` - the Employee Directory: search (name parts, employee number,
  title, department, work email, manager, location), filters (department,
  location, division, manager, status - active by default), employee rows
  with avatar, title, department, manager, email, employee number and
  status, "View profile". The previous organization overview moved to
  `/directory/organization`.
- `/directory/[id]` - the profile: Employment, Reporting Structure (manager
  linked by id, direct reports), Work Contact, Offboarding (active cases with
  "Open existing case", history, "Start offboarding"), record provenance
  (source id, last synchronized, last changed in BambooHR, archived).
- A freshness note on every directory surface: one quiet line while current,
  a status note when delayed, a warning when stale, an alert for
  administrators after a day. "Unavailable" is said only when nothing has
  ever been synchronized.
- Intake (`/cases/new`): the employee is resolved from the local directory by
  id alone (profile hand-off); results show the manager; an existing live
  case is surfaced with "Open existing case" and a second case needs the
  review-step confirmation (DEC-061).
- `/admin/system` - Employee Directory health panel (connection, local
  employees, last event, last incremental, last full, last result with
  counts) and **Refresh Directory Now**: queued at once, executed after the
  response, the page follows progress; duplicates join the running run.
- `/admin/directory-sync` - the synchronization log with filters; linked
  from the administration hub.
- `POST /api/bamboohr/webhook` - closed (404) until
  `BAMBOOHR_WEBHOOK_PRIVATE_KEY` is set; signature verified before anything
  else; unsigned, forged and replayed deliveries refused (401) and audited by
  category; accepted deliveries queue one run per named employee (202) and
  execute after the response. Bodies over 256 KB are refused.
- Health dashboard: an "employee directory mirror" component with freshness.

### Worker

`stage4Sweep` calls `directorySyncTick` every minute; start-up runs
`directoryStartupCheck` without blocking the worker. Logs carry counts and
safe error codes only.

## Security and privacy

- No write path to BambooHR exists; the live adapter is GET-only.
- Only the approved minimum fields are requested and stored; SSN, banking,
  compensation, tax, medical, home address and personal contact categories
  remain forbidden by pattern.
- The webhook private key is an environment secret: never logged, never
  rendered, never in evidence; the endpoint does not exist without it.
- Runs and audit events hold counts, statuses, safe error codes and field
  names - never employee values.
- Directory reads are HR-only (`employeeSource.search`); the log is for
  administrators and HR Managers; production refuses `simulateOutage`.
- Platform-owned data (cases, tasks, documents, snapshots) is never touched
  by a synchronization; departed employees are archived, never deleted.

## Defects found by the evidence run and fixed (directive section 38)

The first BambooHR Directory evidence run (`test-results/offboarding-e2e/
20260915-151144`, kept as the failure baseline) recorded seven failures.
Their causes, and what changed:

1. **Three exhaustive reads of 380 employees within six minutes made
   BambooHR answer with `UPSTREAM_ERROR`** (the manual refresh, the first
   nightly and the hourly run all failed with `checked 0`). Each exhaustive
   read costs one listing request plus 380 per-employee detail requests.
   Fix: the hourly, start-up and manual passes are now incremental (one
   listing request; details only for new, archived, never-detailed or
   changed rows); only the nightly pass is exhaustive. Integration test
   "incremental reconciliation (section 13)".
2. **A webhook follow-up archived a live employee.** The second run
   (`20260915-152624`) showed the webhook run finishing with `checked 0,
   archived 1`: the stand-alone per-employee read asked BambooHR for the
   detail fields only, the field mapper found no name, the row looked
   "missing", and the engine treated that as a departure (the nightly pass
   restored the record minutes later). Fix: the per-employee read asks for
   the whole approved field set, and a row the mapper cannot use is a
   `BAD_RESPONSE` failure that fails the run - only a genuine 404 means the
   employee is no longer returned. Contract test with stubbed HTTP in
   `packages/db/test-int/bambooDirectory.test.ts`.
3. **Hire dates were never stored from the live source.** Writing the
   contract test for the per-employee read exposed it: the mapper's
   hire-date check had lost the backslashes of its `\d{4}-\d{2}-\d{2}`
   pattern when it was patched in, so every live hire date mapped to null
   (the fixture adapter bypasses the mapper, which is why the engine tests
   did not see it). Fixed; unit test "employee directory fields
   (2026-09-15)" covers hire date, extension, phone, middle name and the
   change stamp.
4. Three proof checks were wrong, not the product: fact labels are rendered
   upper-case (innerText), a fresh environment legitimately queues its first
   nightly reconciliation, and the health panel's labels are upper-case too.
5. The third run (`20260915-153721`) passed everything except the webhook
   read, which BambooHR answered with a single server-side error within
   150 ms; a read-only probe of the same endpoint with every approved field
   then returned 200 for all of them. The adapter now retries a throttled
   or server-failed read once after 1.5 s (still read-only, identical
   request), and a 400 is reported as `BAD_REQUEST` rather than as an
   upstream error so a misconfigured field list can never be mistaken for
   an outage.
6. The second run also lost its manual-refresh step to
   `net::ERR_NETWORK_IO_SUSPENDED` - the workstation went to sleep for six
   minutes mid-run (as on 2026-09-10). Environmental; retested.

## Decisions

- **DEC-061** (PROVISIONAL): existing-case protection at intake - the
  confirmation before a second live case; not a block (REQ-CASE-020).
- DEC-060 stays OPEN.

## Checks

The exact commands and results recorded at completion are in "Evidence"
below. The feature was reviewed as one unit on 2026-09-21 before it was
committed: migration, data model, engine, list service, pages, authorization,
error and empty states, fixture support, BambooHR isolation, webhook,
scheduling, the page rename and the tests.

## Evidence

Recorded 2026-09-21 on the working tree that became the feature commit.

| Check | Command | Result |
| --- | --- | --- |
| Formatting | `pnpm format:check` | All matched files use Prettier code style |
| Types | `pnpm -r typecheck` | 5/5 packages Done |
| Lint | `pnpm lint` | clean |
| Unit | `pnpm test:unit` | 31 files, 394 tests passed |
| Integration | `pnpm test:int` (local hardened cluster, `DATABASE_URL_TEST`) | 30 files, 318 tests passed - includes `directorySync.test.ts` (18), `bambooDirectory.test.ts` (13), `directive61OrgSync.test.ts` (7) |
| Seed | `pnpm exec tsx scripts/reset-environment.ts uat --yes --synthetic` | Synthetic directory loaded: 9 created, 5 updated (the 14 fixtures) |
| End to end | `pnpm e2e` | 80 tests: 79 passed, 1 skipped, 0 failed (12.7 min). `e2e/directory.spec.ts` 4/4 passed. The skip is a pre-existing seed-state condition in `acceptance-letter`/`return-checklist`, not in this feature |
| Build | `pnpm run build` | Prisma client generated, `next build` compiled, worker typecheck Done |

Directory proofs against the live directory were recorded on 2026-09-15
(`test-results/offboarding-e2e/20260915-154519`, gitignored evidence): the
BambooHR Directory section passed all 22 checks - initial sync, manager
resolution by identifier, manual refresh, webhook (unsigned and forged refused,
signed accepted and run), hourly reconciliation, and the offline cache. That
invocation ran the directory proofs only; the seven separation scenarios were
not run in it.

Three facts the review recorded, none a defect:

- The seeds do not populate the mirror. The first synchronization on a new
  database is **Refresh Directory Now** (or the local reset tool's synthetic
  mode). Until it runs, the directory pages show their empty state; intake
  search still finds the fixtures.
- `/api/ready` does not gate on the directory mirror or the worker heartbeat
  outside production; `/admin/health` is where both show.
- Fields the fixtures do not carry (hire date, work phone) render as
  "Not recorded" on the profile - the intended empty state.
