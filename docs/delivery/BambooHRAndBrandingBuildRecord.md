# BambooHR Directory Integration and Company Branding Build Record (Directive 5.1)

Adds the read-only BambooHR employee directory (local, credential-gated) and
the approved company branding to the offboarding platform. No write call to
BambooHR exists or was made; no credential or real employee data entered Git.

## Governance and authorization note

CLAUDE.md operating rule 8 ("do not connect local development to production
BambooHR") was written before any credential or authorization existed.
Directive 4 established the framework's condition: live access requires
credentials AND explicit written authorization. Directive 5.1 supplies both -
the product owner placed the credential in this project's gitignored
`.env.local` and issued the written instruction, with strict read-only,
minimum-data, purge and test-isolation safeguards that this build implements.
That directive is recorded HERE as the written authorization relied upon.
Recommended follow-ups for the Decision Register: a formal entry authorizing
read-only local directory access (and amending rule 8 accordingly), plus a
dedicated read-only BambooHR API user for any production use - the current
key is a personal/full-permission style key from another internal project and
is used strictly for GET requests by this application.

## Credential handling (A)

- The credential lives ONLY in the gitignored `.env.local`
  (`BAMBOOHR_API_KEY`, `BAMBOOHR_SUBDOMAIN`); `.env*` ignore rules verified
  and the file has never been committed.
- `.env.example` carries EMPTY placeholders and warnings only.
- Configuration reports a CATEGORY only - `configured` / `not configured` /
  `invalid configuration` - never the value; unit tests assert no status or
  error string can contain the key.
- Adapter errors are reduced to safe categories (AUTH_FAILED, FORBIDDEN,
  RATE_LIMITED, NETWORK_ERROR, UPSTREAM_ERROR, BAD_RESPONSE...).
- Production REFUSES the raw-key form outright at startup (fail-closed
  matrix extended; reference-based secrets remain the production pattern).
- The key is server-side only; no `NEXT_PUBLIC` exposure exists.

## Adapter (B) - read-only by construction

`LiveBambooDirectoryAdapter` performs exactly two kinds of GET request:
`/v1/meta/fields` (health; field metadata, no employee data) and
`/v1/employees/directory`. No method for create/update/terminate/upload/
payroll/time-off/compensation exists anywhere; an integration test asserts
the adapter surface has no write-like member. The fixture adapter remains the
default (`bamboohr.mode` = fixture) and the ONLY adapter automated tests use.

## Field mapping (C)

Approved minimum, mapped in ONE domain boundary
(`packages/domain/src/bambooDirectory.ts`): BambooHR id, employeeNumber,
first/last/preferred/display name, work email, department, division,
location, job title, supervisor (manager name), employment status. Everything
else the API returns is DISCARDED before persistence or display; a unit test
feeds a row containing salary, bank, tax, address, personal contact, medical,
emergency, benefit, birth and photo fields and proves none survive. Excluded
by policy (executable denylist): salary/pay/compensation, bank, tax/national
identifiers, home address, personal phone/email, medical, emergency
contacts, benefits, disciplinary/performance, attachments/notes/photos,
birth/demographic data.

## Synchronization (D)

- Manual sync via the existing `sync.run` boundary (HR_MANAGER or
  SYSTEM_ADMIN) from the system administration page; the button names the
  active adapter.
- Scheduled sync is PREPARED but hard-disabled unless the
  `bamboohr.scheduledSync` configuration flag is explicitly set (worker
  no-ops otherwise; integration-tested).
- Every run records: start/finish, initiating actor, adapter mode,
  retrieved/created/updated/unchanged/failed counts and a correlation ID in
  the append-only `employee_sync_run` evidence plus a SYNC_RUN_COMPLETED
  audit event (counts only).
- Raw API responses are never stored; the cached row holds only the mapped
  minimum plus `active`/`managerName`/sync provenance.
- For LIVE runs, difference evidence records changed FIELD NAMES only -
  never old/new values (no names or emails in sync evidence).
- Source records absent from a later feed are NEVER deleted - reconciliation
  reports `SOURCE_EMPLOYEE_MISSING`; duplicates, inactive employees,
  changed department/location/manager and unmatched case identifiers are
  also reported. Immutable case snapshots are never touched by sync.

## Employee lookup and case creation (E)

- `/cases/new` searches the LOCAL source cache by name, identifier,
  department, position or location (synthetic fixtures, synchronized
  BambooHR rows and manual entries together), showing the minimum columns
  plus source badge, active status and last-sync time.
- Selection pre-populates the intake form; HR reviews everything before the
  draft is created. Nothing is auto-created, no departure type inferred, no
  status changed.
- Manual fallback: an audited "enter the employee manually" form creates a
  MANUAL source record (reported by reconciliation until matched) and
  selects it - case creation continues when the directory is down.
- Approved snapshots stay immutable afterwards (existing Stage 4 guarantee,
  re-verified).

## Organization directory views (F)

`/directory` (HR_MANAGER and HR_OFFICER only, via `employeeSource.search`):
coverage counts, records per department/location, distinct positions,
manager-data coverage, missing department/position/manager lists and sync
history. Deliberately NOT an employee self-service directory; emails are not
displayed there. SYSTEM_ADMIN gets technical counts and controls on
`/admin/system` only and still has no case content; departmental users have
no directory surface.

## Real-data safeguards (G)

- Automated tests, fixtures, seeds and E2E use synthetic data only; the
  fixture adapter is the only adapter tests touch.
- Live sync is a deliberate manual admin action.
- A prominent red banner - "LIVE HR DIRECTORY DATA — DO NOT USE FOR
  SCREENSHOTS OR TEST EVIDENCE" - appears whenever unpurged live rows exist.
- Purge control on `/admin/system`: because the runtime role has no DELETE
  privilege anywhere (by design), purging ANONYMIZES cached live rows in
  place (name replaced by `PURGED-<id>`, email/title/department/location
  cleared); rows referenced by cases keep only identifier linkage; cases and
  immutable snapshots are untouched. Purged rows never resolve for new case
  intake. Audited as DIRECTORY_PURGED.
- Directory searches are audited with query LENGTH and result COUNT only -
  never the query or results (EMPLOYEE_DIRECTORY_SEARCHED).
- Live access is restricted to the existing HR/sync role boundaries.

## Logo and branding (H/I/J)

- Asset: the user-supplied approved logo (NOT the DMAIC screenshot), moved
  to the single source location `apps/web/public/brand/berts-auto-parts.png`
  (1184x880 PNG, sha256 `08de3c0a...29d5` recorded in
  `packages/domain/src/branding.ts` with version, alt text and web path).
- Replacement path (H.14): swap the asset / point `BRAND_LOGO_PATH`
  elsewhere and update the branding record - document templates never change.
- Screens: sign-in (centered logo), application shell header (single logo on
  a white plate with text), all pages inherit the shell; the logo is
  deliberately not repeated across panels (H.9/H.10). Accessible alt text
  "Bert's Auto Parts" everywhere; aspect ratio preserved via intrinsic
  dimensions; no layout shift (explicit width/height).
- PDFs: the letter and action-form headers embed the logo (Letter size,
  margins and typography unchanged); the previous "DEVELOPMENT BRANDING"
  line is gone. If the asset is unreadable the header falls back to the
  company name and rendering NEVER fails (integration-tested both ways).
  Reference/confidentiality/template-version/checksum behaviour unchanged;
  no wording changes; no signatures introduced. Only synthetic documents
  were rendered for verification.

## Tests (K)

Unit: configuration status categories + secret-free messages + production
raw-key refusal; field mapping allowed/denied policy; aggregates; branding
constants. Integration: adapter write-method absence; live adapter
fail-closed without config; DB-backed search + content-free audit; role
denial (IT, SYSTEM_ADMIN); manual fallback into case intake; purge/
deactivation with case/snapshot immutability; banner presence logic;
scheduled-sync gate; branded PDF render + missing-logo fallback. E2E:
logo asset loads with accessible alt text on sign-in and shell; single-logo
rule; desktop/mobile overflow; axe on sign-in; directory page HR scoping;
provenance badges and manual-fallback control on case creation; SYSTEM_ADMIN
technical panel. Full suites: 188 unit / 163 integration / 35 E2E pass.

## Live connection verification (L)

Performed once, read-only, in memory, audited; aggregate counts only:

| Measure | Count |
| --- | --- |
| Employees retrieved | 374 |
| Departments found | 24 |
| Positions found | 96 |
| Locations found | 4 |
| Records with manager data | 373 |
| Records with missing mapping | 0 |

No employee detail was printed, stored, screenshotted or used in tests. No
write request was made. No live sync was executed - populating the local
directory remains a deliberate admin action via `/admin/system`.

## Known limitations

- The live adapter reads the public directory endpoint only: employment
  status and hire date are not fetched per-employee (avoids hundreds of
  per-record calls); manager linkage is by name, not ID. Extend deliberately
  if pilot operations need more.
- The credential is a personal-style key from another internal project;
  replace with a dedicated read-only API user before any production use.
- Scheduled sync stays disabled; enabling it is a recorded configuration
  decision.
- Container images not built locally (Docker still absent).
