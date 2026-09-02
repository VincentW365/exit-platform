# Development Guide - Stage 1

Local development of the Employee Offboarding Web Application. **Synthetic data
only** (BR-GOV-004): never use real employee names, emails, letters or numbers
in this environment.

## Prerequisites

- Node.js >= 24 and pnpm >= 10 (`corepack enable` or a global install).
- PostgreSQL 17 binaries (any local install provides `initdb`/`pg_ctl`).

## First-time setup

```powershell
pnpm install
Copy-Item .env.example .env
# then edit .env: set SESSION_SECRET (generation command is in the file)
```

### Local database (isolated, hardened instance)

Stage 1 development uses a **project-local PostgreSQL instance** so nothing
touches any other database on the machine. This is synthetic development
infrastructure only - it is **not** a production-hosting decision (DEC-022 /
IC-S1-006 remain open).

Properties (Directive 1.1 section C):

- data directory lives **outside the Git worktree**:
  `..\hr-offboarding-local-runtime\postgres\data` (portable: pick any sibling
  path; nothing in the repo hard-codes it);
- listens on **127.0.0.1:5433 only** (IPv4 + deliberate ::1 loopback);
- authentication is **scram-sha-256 only** - no trust rules;
- runs on demand via `pg_ctl`, never as a Windows service;
- three separated roles:

| Role | Purpose | Powers |
| --- | --- | --- |
| `exit_admin` | cluster setup/recovery only | superuser; never used by code |
| `exit_migrate` | migrations, seed tooling, test harness | owns the schema; CREATEDB (shadow db) |
| `exit_app` | web app + worker runtime | SELECT/INSERT + permitted UPDATE only; **no DELETE, no DDL, no trigger control**; audit/history/snapshots are INSERT-only |

#### One-time setup

```powershell
$bin = "C:\Program Files\PostgreSQL\17\bin"
$rt  = "..\..\hr-offboarding-local-runtime\postgres"   # any path outside the worktree
# 1. init with SCRAM and a superuser password (write it to a temp pwfile):
& "$bin\initdb.exe" -D "$rt\data" -U exit_admin -A scram-sha-256 --pwfile=<pwfile> -E UTF8 --locale=C
# 2. bind loopback + port in $rt\data\postgresql.conf:
#      listen_addresses = '127.0.0.1'   port = 5433   password_encryption = 'scram-sha-256'
#    and replace $rt\data\pg_hba.conf with scram-only loopback rules.
# 3. start (see below), then create roles + databases as exit_admin:
#      CREATE ROLE exit_migrate LOGIN PASSWORD '<generated>' CREATEDB NOSUPERUSER NOCREATEROLE;
#      CREATE ROLE exit_app     LOGIN PASSWORD '<generated>' NOSUPERUSER NOCREATEROLE NOCREATEDB;
#      CREATE DATABASE exitplatform_dev  OWNER exit_migrate;
#      CREATE DATABASE exitplatform_test OWNER exit_migrate;
# 4. put the FOUR connection URLs in .env (see .env.example placeholders):
#    DATABASE_URL (exit_app), DATABASE_URL_MIGRATE, DATABASE_URL_TEST,
#    DATABASE_URL_TEST_RUNTIME. Generated passwords live ONLY in .env.
# 5. apply migrations and the runtime grants:
pnpm --filter '@exit/db' migrate:deploy
# then run scripts/db/grants.sql against each database as exit_migrate.
```

#### Start / stop / reset / recovery

```powershell
$bin = "C:\Program Files\PostgreSQL\17\bin"
$rt  = "C:\...\hr-offboarding-local-runtime\postgres"

# start (on demand; keeps running until stopped):
& "$bin\pg_ctl.exe" -D "$rt\data" -l "$rt\server.log" -w start
# stop:
& "$bin\pg_ctl.exe" -D "$rt\data" stop -m fast
# status:
& "$bin\pg_ctl.exe" -D "$rt\data" status

# reset the TEST database (safe; the harness re-migrates automatically):
#   as exit_admin: DROP DATABASE exitplatform_test; CREATE DATABASE exitplatform_test OWNER exit_migrate;
# reset the DEV database - one command (DEC-041):
#   pnpm exec tsx scripts/reset-environment.ts uat --yes    (UAT dataset)
#   pnpm exec tsx scripts/reset-environment.ts fresh --yes  (zero-case clean state)
#   pnpm exec tsx scripts/reset-environment.ts status       (read-only check)
# recovery: if the cluster is corrupt, delete $rt\data entirely and redo the
# one-time setup - everything in it is synthetic and reproducible.
```

All database credentials, logs and data files stay outside version control.

### Migrate and seed

```powershell
pnpm db:migrate   # prisma migrate dev (also regenerates the client)
pnpm db:seed      # synthetic users, disabled flags, TEST calendar/reasons
```

## Running

```powershell
pnpm dev          # web app: listens per WEB_HOST/WEB_PORT (default 0.0.0.0:3000)
pnpm dev:local    # web app: this machine only (127.0.0.1), whatever .env says
pnpm worker       # background worker (outbox dispatch, sweeps, heartbeat)
```

`pnpm dev` prints every address the app can be reached at, including the
LAN address for another workstation. The LAN address is read from the live
network interfaces at each start - a DHCP lease can change between days, so
never copy it into a document; read it from the banner. Reaching the app from
another workstation also needs a Windows Firewall rule on this host; the
procedure, the verification checklist and the security considerations are in
`docs/operations/LanAccessForInternalUAT.md`.

If port 3000 is taken by another project on this workstation, set `WEB_PORT`
in `.env` (Next honours the value; no code changes) and restart.

The Next.js development server only serves its own scripts to browser
origins it knows, so `next.config.ts` allows this machine's own network
addresses automatically at each start (plus `DEV_ALLOWED_ORIGINS` for a
hostname). Without that, a page opened from another workstation renders but
never hydrates - a blank-looking accordion is the symptom.

Sign in through the development role switcher (requires `NODE_ENV` not
production AND `ALLOW_DEV_LOGIN=true`; the app refuses to start if that flag is
ever set in production). All eight synthetic users from the seed are offered.

## Checks

| Command | What it runs |
| --- | --- |
| `pnpm lint` | ESLint (root flat config + Next config for the web app) |
| `pnpm format:check` | Prettier |
| `pnpm typecheck` | strict `tsc --noEmit` in every package |
| `pnpm test:unit` | Vitest unit tests (domain/config; no database) |
| `pnpm test:int` | Vitest integration tests against `DATABASE_URL_TEST` (migrations auto-applied; the test DB is truncated - never point it at real data) |
| `pnpm e2e` | Playwright critical path (starts the web app on port 3100; requires migrated + seeded dev DB and `pnpm exec playwright install chromium` once) |
| `pnpm build` | `next build` + worker typecheck |

## Notes and known limitations (Stage 1)

- **Scan mode:** `SCAN_MODE=disabled` quarantines every upload (not
  downloadable). `dev-passthrough` marks files CLEAN with an explicit
  "no real malware scan performed" note; it is refused in production.
- **CSP in dev:** the strict Content-Security-Policy blocks `eval`, which
  React dev tooling complains about in the browser console. Harmless;
  production React does not use eval. Revisited at Stage 7 hardening.
- **Action feedback:** mutations report success/errors through redirect query
  parameters rendered as an accessible summary. Field-level inline errors are
  a later refinement.
- **Stage 2 features (documents, action forms, exit surveys)** are built but
  gated: OPERATIONAL records require the `automation.*` feature flags (seeded
  disabled) and a non-BASELINE cohort; use TRAINING/TEST-purpose cases to
  exercise them locally. No email is ever sent - survey links are generated
  for HR to copy and send manually. See
  `docs/delivery/Stage2CombinedBuildRecord.md` section 10 for the operating
  steps.
- **Stage 3 features (workflows, queues, access revocation, notifications,
  assets, handover, clearance)** follow the same gating: activation of an
  OPERATIONAL case needs the `automation.workflowEngine` flag (seeded
  disabled); TRAINING/TEST cases exercise the complete engine. The three
  development workflow definitions, seven notification templates and the
  synthetic issued-asset register come from the seed and are labelled
  `DEVELOPMENT ... REQUIRES HR APPROVAL BEFORE OPERATIONAL USE`. The worker
  runs the release/escalation/readiness sweeps every 60 seconds; integration
  tests drive the same sweep with an injected clock. See
  `docs/delivery/Stage3OperationalWorkflowBuildRecord.md`.
- The holiday calendar and reason categories in the seed are **synthetic
  placeholders**; real values require DEC-027 / DEC-031 approval.
- **BambooHR read-only directory + branding (Directive 5.1):** put
  `BAMBOOHR_API_KEY` and `BAMBOOHR_SUBDOMAIN` in the gitignored `.env.local`
  (never `.env.example` or anything committed); the app reports only
  configured / not configured / invalid configuration. Switch the adapter
  with configuration key `bamboohr.mode` (`fixture` default | `live`) on
  `/admin/system`, which also offers a read-only connection test, manual
  directory sync, sync history, reconciliation and a purge control that
  anonymizes cached live rows without touching cases. A red banner marks the
  environment whenever unpurged live rows exist - never capture screenshots
  or test evidence in that state. Automated tests always use the fixture
  adapter. The approved logo lives at
  `apps/web/public/brand/berts-auto-parts.png` (checksum recorded in
  `packages/domain/src/branding.ts`; `BRAND_LOGO_PATH` overrides for
  containers); PDFs fall back to the company name if the asset is missing.
- **Stage 4 features (outbox, adapters, pilot, reporting, privacy,
  continuity, packaging):** the development email mode is `dev-capture` -
  approved notifications on eligible cases are enqueued transactionally and
  the worker (or the "Run outbox pass now" button on `/admin/outbox`)
  delivers them into the local capture mailbox at `/dev/mailbox`; nothing
  ever leaves the machine. All live adapters (Graph, OIDC, BambooHR, S3,
  scanner) FAIL CLOSED without configuration, and a production `NODE_ENV`
  refuses to start without complete provider configuration (see
  `docs/operations/ProductionConfigurationChecklist.md`). New surfaces:
  `/admin` hub, `/admin/system`, `/admin/health`, `/admin/outbox`,
  `/admin/recipients`, `/admin/reasons`, `/admin/pilot`, `/admin/privacy`,
  `/reports`, `/continuity`, `/operations`, `/support`, plus `/api/health`
  and `/api/ready`. Backups need `PG_BIN` (PostgreSQL 17 binaries) and write
  to the gitignored `BACKUP_DIR`; restore verification uses the isolated
  `exitplatform_restorecheck` database. Container images: `Dockerfile.web` /
  `Dockerfile.worker` (non-root; requires Docker, which is not installed on
  the reference workstation). See
  `docs/delivery/Stage4ProductionReadinessBuildRecord.md` and the runbooks
  in `docs/operations/`.
