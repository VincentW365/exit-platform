# Stage 1 Build Record

**Directive:** 1 - Secure application foundation and baseline capture
**Built:** 2026-07-28/29
**Commit message:** `feat: establish secure offboarding foundation and baseline capture`

This record captures the material engineering decisions of the Stage 1 build:
selected versions (from the live registry and runtime, not from memory), the
repository shape, deviations worth knowing about, and the evidence summary.
Run instructions live in `../../DEVELOPMENT.md`.

## 1. Toolchain and version decisions

Environment at build time: Node.js **v24.12.0**, pnpm **10.33.0**, PostgreSQL
**17.9** (local), Windows 11.

| Package | Version | Notes |
| --- | --- | --- |
| next | 16.2.12 | Latest stable; App Router; Turbopack build. |
| react / react-dom | 19.2.8 | Peer-matched to Next 16. |
| typescript | 6.0.3 | **Deliberately not 7.0.2** (latest): typescript-eslint 8.65.0 supports `>=4.8.4 <6.1.0`. 6.0.3 is the newest stable inside the supported range. Revisit when the lint toolchain supports TS 7. |
| prisma / @prisma/client | 7.9.1 | Prisma 7 model: no datasource URL in the schema; `prisma.config.ts` carries it for Migrate and the runtime uses the driver adapter. |
| @prisma/adapter-pg | 7.9.1 | Required driver adapter for PostgreSQL under Prisma 7. |
| zod | 4.4.3 | Runtime validation at all external boundaries. |
| vitest | 4.1.10 | Unit + integration runner. |
| @playwright/test | 1.62.0 | Critical-path E2E. |
| luxon | 3.7.2 | America/Jamaica business-calendar math. |
| jose | 6.2.4 | HS256-signed session cookie. |
| eslint | 10.8.0 (workspace) / 9.x (apps/web) | eslint-config-next 16.2.12's react plugin does not support ESLint 10 yet, so the web app stays on the 9.x line the generator produced; shared packages lint under 10 with typescript-eslint 8.65.0. |
| prettier | 3.9.6 | Repo-wide formatting; governed docs excluded. |
| tsx | 4.23.1 | Worker/seed TS execution. |

## 2. Repository shape

```text
apps/
  web/        Next.js App Router UI + server actions + API routes
  worker/     separate background worker (heartbeat skeleton in Stage 1)
packages/
  config/     env schema validation, fail-closed guards (@exit/config)
  domain/     roles, policy, state machine, cohort rules, calendar, audit
              vocabulary, attachment rules, synthetic employee source
  db/         Prisma schema/migrations/client, services, seed (@exit/db)
e2e/          Playwright critical-path specs
```

Simplified from the Architecture.md package sketch as it explicitly permits:
auth/validation/observability live inside `config`/`domain`/the web app until
they earn separate packages. Domain boundaries match the module table.

## 3. Material design decisions

1. **Authorization is one policy module** (`packages/domain/permissions.ts`)
   consulted by every service read/mutation; list queries embed the same
   predicates so counts cannot leak (REQ-SEC-005/007/008).
2. **Restricted cases return NOT_FOUND** to actors who may not discover them -
   indistinguishable from missing records (IC-S1-011). Oversight roles get
   minimized discovery rows; content still requires explicit participation.
3. **Database-level guarantees in the migration** (hand-authored SQL section):
   cohort/purpose CHECK constraint, append-only triggers on `audit_event`,
   no-delete triggers on cases/status history, immutable `employee_snapshot`.
4. **Approval transaction** creates snapshot + status history + audit in one
   transaction with optimistic-concurrency version checks (Architecture 8).
5. **Sessions**: jose-signed HttpOnly/SameSite=Lax cookie carrying only the
   user id + activity claim; roles re-resolved from the database per request
   so revocation is immediate; idle + absolute timeouts (REQ-SEC-004).
6. **Reason taxonomy deferred per IC-S1-008**: versioned `reason_category`
   reference table (seeded TEST-ONLY), nullable `reasonCategoryId`,
   `reasonCaptureStatus` enum; case intake does not require a category.
7. **Cohort model per Directive 0.1 C**: `measurementCohort` (3 values,
   nullable) + `recordPurpose` (3 values) with DB constraint, service
   validation, audited corrections, and OPERATIONAL-only reporting.
8. **Uploads quarantine-first**: allow-list (pdf/png/jpg) with magic-byte
   check, random object keys, local adapter under `storage/`; downloads only
   for CLEAN files, with checksum verification and audit.
9. **Local development database**: project-local PostgreSQL 17 instance on
   127.0.0.1:5433 (see DEVELOPMENT.md) - no shared or production database is
   reachable from this repository (REQ-INT-018, REQ-SEC-037).

## 4. Known limitations / deferred refinements

- Action feedback via redirect query parameters (accessible summary); inline
  field-level error association is a refinement for a later pass.
- CSP blocks `eval` which React dev-mode logs complaints about; harmless,
  production unaffected; full CSP tightening is Stage 7 work.
- `SCAN_MODE=dev-passthrough` is clearly labelled and refused in production;
  no real scanner exists yet (Stage 8 integration decision).
- Worker is a heartbeat/boundary skeleton by design: the outbox arrives at
  Stage 5, scheduling at Stage 3.
- Case correction after approval currently covers effective-time change,
  purpose correction, rehire setting and participant management; a general
  field-correction UI is Stage 2+ scope.

## 5. Evidence summary (executed 2026-07-28/29, local)

| Check | Result |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm format:check` | PASS |
| `pnpm typecheck` (strict, all packages) | PASS |
| `pnpm test:unit` | **70/70 PASS** |
| `prisma migrate dev` + `migrate status` | applied; "Database schema is up to date!" |
| `pnpm db:seed` | PASS (synthetic only) |
| `pnpm test:int` (real PostgreSQL test DB) | **36/36 PASS** |
| `pnpm e2e` (Playwright, chromium) | **1/1 PASS** (critical path + least-privilege negatives) |
| `pnpm build` (next build + worker typecheck) | PASS |
| Worker smoke run | started, heartbeat with `enabledAutomationFlags: 0`, clean termination |

Integration coverage includes: cohort/purpose CHECK constraint, append-only
audit triggers, case no-delete trigger, unique concurrent case numbering,
full lifecycle with snapshot immutability and audit trail, optimistic
concurrency under racing approvals, restricted-case invisibility (detail,
list, search, dashboard counts), oversight minimized discovery, SYSTEM_ADMIN
denial, rehire/reason-notes masking, baseline fact recording/supersession/
export, quarantine gating in both scan modes, upload allow-list and size
limits, role grant/revoke with self-grant refusal, and audit access rules.

One defect was found by the integration suite during the build and fixed
before commit: `z.coerce.date()` coerces `null` to the 1970 epoch, which
would have let a case without an effective separation time pass submit
validation. Dates now reject null/empty before coercion.
