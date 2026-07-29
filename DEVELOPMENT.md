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

### Local database (isolated instance)

Stage 1 development uses a **project-local PostgreSQL instance** so nothing
touches any other database on the machine. It lives in the gitignored `data/`
folder, listens on **127.0.0.1:5433 only**, and uses trust authentication for
the current user - acceptable here because the instance is loopback-only and
contains synthetic data exclusively. Production hosting is a separate, open
decision (DEC-022 / IC-S1-006).

```powershell
$bin = "C:\Program Files\PostgreSQL\17\bin"
& "$bin\initdb.exe"  -D data\pg17 -U exitplatform -A trust -E UTF8 --locale=C
& "$bin\pg_ctl.exe"  -D data\pg17 -l data\pg17\server.log -o "-p 5433 -h 127.0.0.1" -w start
& "$bin\createdb.exe" -h 127.0.0.1 -p 5433 -U exitplatform exitplatform_dev
& "$bin\createdb.exe" -h 127.0.0.1 -p 5433 -U exitplatform exitplatform_test
```

Stop it with `pg_ctl -D data\pg17 stop`. The matching connection strings are
already in `.env.example`:

```text
DATABASE_URL=postgresql://exitplatform@127.0.0.1:5433/exitplatform_dev
DATABASE_URL_TEST=postgresql://exitplatform@127.0.0.1:5433/exitplatform_test
```

### Migrate and seed

```powershell
pnpm db:migrate   # prisma migrate dev (also regenerates the client)
pnpm db:seed      # synthetic users, disabled flags, TEST calendar/reasons
```

## Running

```powershell
pnpm dev          # web app on http://localhost:3000
pnpm worker       # background worker (heartbeat only in Stage 1)
```

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
- **No automation:** letters, surveys, notifications, reminders are all
  Stage 2+ and their feature flags are seeded disabled (DEC-007 / IC-S1-004).
- The holiday calendar and reason categories in the seed are **synthetic
  placeholders**; real values require DEC-027 / DEC-031 approval.
