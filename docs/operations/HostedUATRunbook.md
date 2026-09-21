# Hosted UAT Runbook

The operational source of truth for creating, running and discarding a temporary
hosted UAT copy of the platform.

## What this is, and what it is not

This describes a **temporary hosted copy** of the platform so that testers can reach
it remotely and run UAT. Nothing here is a production deployment decision.

- The host used for the web application is a **convenience testing host only**. It is
  **not** the selected production architecture.
- **Production deployment remains host-agnostic and container-based** —
  `Dockerfile.web` and `Dockerfile.worker`, deployed wherever the business chooses.
  That path is unchanged by anything in this runbook.
- **`apps/worker` remains a separate long-running process.** It is not replaced by
  any host's scheduler, queue or workflow product, and no such product is used.
- **No host-specific service is required by the application.** The application
  depends on PostgreSQL, S3-compatible object storage and its own configuration —
  nothing else. Everything below works identically on a container host, another
  cloud provider, or a spare machine.

If the temporary host is discarded tomorrow, no application code changes.

## Topology

```
  Temporary web host                External machine or container
  ┌──────────────────┐              ┌──────────────────┐
  │   apps/web       │              │   apps/worker    │
  └────────┬─────────┘              └────────┬─────────┘
           │                                 │
           └─────────────┬───────────────────┘
                         │
          ┌──────────────┴───────────────┐
          │  UAT PostgreSQL (disposable) │
          │  UAT object storage (S3)     │
          └──────────────────────────────┘
```

Both processes are peers against shared UAT infrastructure. Neither knows or cares
where the other runs.

> **The worker must be running during full workflow testing.** See
> [What breaks without the worker](#what-breaks-without-the-worker).

## The `uat` application environment

`NODE_ENV` says how the process was **built**. `APP_ENVIRONMENT` says what the
deployment is **for**. A hosted test deployment is normally a production build
running as a non-production environment — which is why the two had to be separated
(DEC-062).

`uat` is an **application** environment, not a host's environment. It means the same
thing in a container, on any cloud provider, on a temporary web host or on a laptop.
It is never a synonym for any host's "preview" concept.

### Safety properties

| Property | How it is held |
| --- | --- |
| Production is unchanged | With `APP_ENVIRONMENT` absent, `NODE_ENV=production` resolves to `production`. The whole fail-closed matrix applies exactly as before |
| Production can never enable dev login | `devLoginEnabled` requires `APP_ENVIRONMENT !== 'production'`, plus a second gate in `devLoginAction` |
| A broken production config throws | There is no inference path to a weaker environment. Incomplete production configuration fails to start |
| UAT is never inferred | `APP_ENVIRONMENT=uat` **and** `UAT_HOSTED_ACK=true`. Either alone is refused |
| No silent non-production on a production build | Any non-production `APP_ENVIRONMENT` on `NODE_ENV=production` requires the acknowledgement |
| Dev login stays opt-in within UAT | `ALLOW_DEV_LOGIN` must also be set |
| UAT email cannot reach a real mailbox | `uat` falls into the strict branch of `destinationErrors`: only `capture://`, reserved `.test`/`.invalid` domains or localhost |

Pinned by `packages/config/test/hostedUat.test.ts`.

### UAT prohibits production resources, not production-capable providers

| Valid | Invalid |
| --- | --- |
| UAT + separate UAT S3 bucket | UAT + production storage bucket |
| UAT + separate UAT OIDC application | UAT + production BambooHR credential |
| UAT + controlled test email provider | UAT + production database |

This is an **operational** rule. Configuration cannot distinguish a UAT bucket from a
production one, so it is enforced by how the deployment is provisioned — not by a code
constraint. Do not add code that forbids production-capable adapters in UAT; a later
UAT cycle may legitimately want a real OIDC application against a UAT tenant.

## Synthetic data only

No real employee name, address, employee number, personal email or HR export may
enter this environment. The seeded fixture directory (`EMP-TEST-001` … `EMP-TEST-014`,
`Avery Brown` and colleagues) is sufficient to test everything UAT asks for:

| UAT need | Fixture support |
| --- | --- |
| Directory list, first-name and last-name search | 14 employees; the engine derives `firstName`/`lastName` from the display name and search matches both, plus employee number, title, department, email and manager |
| Employee detail | Every profile section renders; fields the fixtures do not carry (hire date, work phone) show "Not recorded" — an expected empty state, not a defect |
| Organization hierarchy, managers and subordinates | Three reporting roots (Operations Manager, an HR lead, one unmanaged employee), a two-level chain, a manager with three reports, one **inactive** manager and one employee with **no** manager |
| Department and location filtering | 7 departments, 4 locations |
| Employee selection, default manager assignment | Managers linked by identifier; intake shows the manager and offers an alternate where none is recorded |
| Resignation with notice, immediate resignation, termination | The stakeholder UAT dataset seeds cases of each type; fixtures without a live case (e.g. `EMP-TEST-008`) are free for new intakes |

## Configuration — web host

```bash
# What this deployment is for, asked for twice.
APP_ENVIRONMENT=uat
UAT_HOSTED_ACK=true

# Access. The deployment is access-protected at the host level; the switcher is
# passwordless and must never be reachable by the public.
IDENTITY_MODE=dev
ALLOW_DEV_LOGIN=true

# Nothing leaves the building: captures land in notification_capture and are
# read at /dev/mailbox. No external mail is sent.
EMAIL_MODE=dev-capture

# Uploads are accepted and clearly labelled as unscanned.
SCAN_MODE=dev-passthrough

# Disposable UAT database - never the production one. Use the POOLED endpoint.
DATABASE_URL=postgresql://exit_app:<pw>@<pooled-host>:<port>/exit_uat?sslmode=require

# Distinct from any other environment's secret. See the worker section: the
# worker must carry the SAME value.
SESSION_SECRET=<openssl rand -base64 48>

# Links in captured email are built from this. It must be the URL testers use.
APP_BASE_URL=https://<the-uat-url>

# Correct client IPs in the audit trail behind the host's proxy.
TRUSTED_PROXY=<proxy CIDR or address>

# Storage: see "Document storage".
STORAGE_MODE=s3
S3_ENDPOINT=https://<uat-endpoint>
S3_BUCKET=<uat-bucket>
S3_REGION=<region>
S3_FORCE_PATH_STYLE=false
S3_ACCESS_KEY_REF=env:UAT_S3_ACCESS_KEY
S3_SECRET_KEY_REF=env:UAT_S3_SECRET_KEY
UAT_S3_ACCESS_KEY=<set in the host's secret store>
UAT_S3_SECRET_KEY=<set in the host's secret store>

# Deliberately ABSENT: no BambooHR credential of any kind, no webhook key.
```

## Configuration — worker (minimised)

The worker receives only what its own code paths use. Determined by inspection of
`apps/worker/src/index.ts` and the `@exit/db` services it calls; nothing here is
copied from the web app "just in case".

```bash
APP_ENVIRONMENT=uat            # the container image bakes NODE_ENV=production,
UAT_HOSTED_ACK=true            # so the acknowledgement is REQUIRED or it refuses to start
DATABASE_URL=postgresql://exit_app:<pw>@<host>:<port>/exit_uat?sslmode=require
SESSION_SECRET=<IDENTICAL to the web app's value>
APP_BASE_URL=https://<the-uat-url>
EMAIL_MODE=dev-capture
STORAGE_MODE=s3
S3_ENDPOINT=…  S3_BUCKET=…  S3_REGION=…  S3_FORCE_PATH_STYLE=…
S3_ACCESS_KEY_REF=env:UAT_S3_ACCESS_KEY
S3_SECRET_KEY_REF=env:UAT_S3_SECRET_KEY
UAT_S3_ACCESS_KEY=…  UAT_S3_SECRET_KEY=…
```

| Variable | Why the worker has it |
| --- | --- |
| `SESSION_SECRET` | **Required, and it must equal the web app's.** Configuration validation refuses to start without it (min 32 chars), and `secretBox` derives the data-at-rest key from it (HKDF) unless `DATA_KEY` is set. The worker decrypts recipient ciphertext the web app encrypted; a different value means every dispatch fails with an undecryptable recipient. If you set `DATA_KEY` explicitly on both, it must likewise be identical |
| `APP_BASE_URL` | `ackTokenService` builds the acknowledgement and checklist links the worker inserts at dispatch |
| `EMAIL_MODE` | `processOutbox` selects the provider; `dev-capture` writes to the database |
| Storage set | Render-job retries write PDFs, scheduled reports write CSVs, and dispatch reads the attached letter |
| `DATABASE_URL` | Everything |

Deliberately **omitted** — not read on any worker path, and their non-production
defaults are correct: `IDENTITY_MODE` (sign-in only), `ALLOW_DEV_LOGIN` (only logged
as `devLoginEnabled: false` at startup — harmless), `SCAN_MODE` (upload path only),
`MAX_UPLOAD_MB`, `TRUSTED_PROXY`, `SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS`,
`WEB_HOST`/`WEB_PORT`, `BRAND_LOGO_PATH` (default path exists in the image). No
validation was weakened to remove any of them.

The worker's `started` log line reports `env: production` — that is `NODE_ENV`, the
build mode, and expected. The environment is confirmed by the sign-in page and by the
absence of any production provider.

## Document storage

Generated letters, action-form PDFs, attachments, retention packages and scheduled
report CSVs all go through the `StorageAdapter` boundary in
`packages/db/src/storage.ts`.

PDFs are rendered **synchronously in the web request** when a document is approved
(`documentService.ts`); the worker's render job is a retry path, not the primary one.
So the **web process** needs working storage, not just the worker.

A host with an ephemeral or read-only filesystem cannot use `LocalStorageAdapter`.
`/tmp` is explicitly **not** acceptable as the UAT document store: testers must be
able to generate a document and find it again later, including after a redeploy.

`S3StorageAdapter` is implemented against `@aws-sdk/client-s3` and is generic S3 —
endpoint, region and addressing style are all configuration, so it works against AWS
S3, MinIO, Ceph or any S3-compatible provider. Nothing in it is tied to a hosting
platform.

Behaviour worth knowing:

- **Never overwrites.** Writes use `IfNoneMatch: '*'`, the S3 equivalent of the local
  adapter's `flag: 'wx'`. A provider that does not honour conditional creation will
  fail the write rather than silently replace a stored document — if that happens,
  the provider is unsuitable, not the configuration.
- **Keys are unchanged** — the same system-generated 48-hex keys, with the existing
  `quarantine/`, `clean/`, `rejected/`, `generated/` prefixes. Invalid keys are
  refused before any credential is read.
- **Bucket must be private.** The adapter never makes an object public and never
  issues a public URL; every read passes through server authorization.
- **Health is non-mutating** — a `HeadBucket` probe, reported as a status only, never
  a credential.
- **Multipart upload is deliberately not implemented.** Offboarding documents are
  letters, forms and CSVs well under the threshold where it matters.
- Outside production, `/api/ready` does **not** gate on storage; a misconfigured
  bucket shows on `/admin/health` and at the first write.

### UAT bucket requirements

| Requirement | Detail |
| --- | --- |
| Private, separate | Block all public access; no public ACLs. A bucket that exists only for this UAT — never production's |
| Permissions on `<bucket>/*` | `PutObject`, `GetObject`, `DeleteObject` |
| Permission on `<bucket>` | `ListBucket` — **required by the `HeadBucket` health probe** under AWS-style IAM. The adapter never lists objects; without this permission `/admin/health` reports storage failing, and a GET of a missing key returns 403 instead of 404 |
| Scope | Resource-limit the policy to that one bucket and nothing else |
| Conditional creation | The provider must support `If-None-Match: *` on PUT. AWS S3 does; confirm before choosing another provider — one that does not will fail every write, loudly and by design |
| Versioning | **Off.** Keys are immutable and never overwritten, so versioning adds nothing; with it on, `DeleteObject` leaves bytes behind a delete marker, which contradicts retention disposal |
| Encryption at rest | Turn on the bucket's default server-side encryption. The adapter sends no SSE headers; it relies on the bucket default |
| CORS / lifecycle | Not needed (server-side access only; no browser uploads). At decommission, delete the bucket outright |
| Values to collect | Endpoint URL (https), region string, bucket name, whether path-style addressing is required (`S3_FORCE_PATH_STYLE=true` for MinIO/Ceph-style providers, `false` for AWS), access key id + secret |

## UAT PostgreSQL

| Requirement | Detail |
| --- | --- |
| Separate, disposable | A database that exists only for this UAT. Never the production database |
| Version | PostgreSQL 15 or newer (see ownership). Local development runs 17 |
| Roles are **not** created by migrations or `grants.sql` | Create them as the provider's admin. **The names are fixed** — `grants.sql` grants to `exit_app` and sets default privileges for role `exit_migrate` by name |
| Raw-SQL migrations | Four migrations create `plpgsql` trigger functions (append-only audit, DELETE prohibition, CHECK constraints). **Nothing superuser-only** — no extensions, no `SECURITY DEFINER`, no event triggers |
| TLS | The code sets no SSL options; it is governed by the URL. Use `sslmode=require` at minimum; supply the CA if the provider uses a private one |
| Network | Must accept connections from the hosted web app's egress and from the worker host. If the host has no fixed egress IPs, rely on TLS + strong passwords rather than an IP allow-list |
| Names | Database `exit_uat`; roles exactly `exit_migrate` and `exit_app`; passwords distinct from every other environment |

### Role creation (as the provider's admin, once)

```sql
CREATE ROLE exit_migrate LOGIN PASSWORD '<generated>' NOSUPERUSER NOCREATEROLE NOCREATEDB;
CREATE ROLE exit_app     LOGIN PASSWORD '<generated>' NOSUPERUSER NOCREATEROLE NOCREATEDB;
CREATE DATABASE exit_uat OWNER exit_migrate;
```

Make `exit_migrate` the **owner of the database**: `grants.sql` opens with
`REVOKE ALL ON SCHEMA public FROM PUBLIC`, which needs ownership of `public`, and on
PostgreSQL 15+ the database owner owns it. `CREATEDB` is not needed — that exists only
for the local reset tool's drop-and-recreate. If the provider will not let a role own
the database, run `grants.sql` as the provider's admin role instead.

`exit_app` receives exactly what `grants.sql` gives it: USAGE on `public`,
SELECT/INSERT/UPDATE on mutable tables, SELECT/INSERT on append-only ones, SELECT on
`_prisma_migrations`, sequences. **No DELETE, no DDL.** Both the web app and the
worker connect as this role.

### Direct versus pooled URLs

| URL | Role | Used by | Endpoint |
| --- | --- | --- | --- |
| `DATABASE_URL_MIGRATE` | `exit_migrate` | migrations, `grants.sql`, seeding | **Direct** — never in the hosted app's environment |
| `DATABASE_URL` (web) | `exit_app` | the hosted web app | **Pooled** — many short-lived function connections |
| `DATABASE_URL` (worker) | `exit_app` | the worker | Direct or pooled |

## Migrations

Run as a deliberate step, never from the web application and never from a build:

```bash
export DATABASE_URL_MIGRATE="postgresql://exit_migrate:<pw>@<direct-host>:5432/exit_uat?sslmode=require"
pnpm --filter @exit/db exec prisma migrate status
pnpm --filter @exit/db exec prisma migrate deploy
psql "$DATABASE_URL_MIGRATE" -f scripts/db/grants.sql
```

`migrate deploy` is forward-only. **Never run `prisma migrate dev` against a shared
database** — it can drop and recreate the schema. Re-run `grants.sql` after every
migration: new tables default to read-only for `exit_app`.

## Seeding the remote database

### Why `reset-environment.ts` refuses remote databases — and stays that way

`scripts/reset-environment.ts` **drops and recreates** the database it is pointed at.
It refuses any host that is not `localhost`/`127.0.0.1`/`::1`, refuses
`NODE_ENV=production`, and refuses unless `ALLOW_DEV_LOGIN=true`. That refusal is a
destructive-operation safeguard and is kept deliberately; no bypass or force flag
exists or should be added. For remote UAT, run its component steps by hand.

### The component sequence

Both seed commands were verified before this was written: they read the database
only from `DATABASE_URL` via the shared config loader, make no BambooHR or other
external call, contain no localhost or `NODE_ENV` assumption, and produce synthetic
data only.

```bash
# Point BOTH at the UAT database (seeds write as exit_app; grants allow INSERT).
export DATABASE_URL="postgresql://exit_app:<pw>@<direct-host>:5432/exit_uat?sslmode=require"
export DATABASE_URL_MIGRATE="postgresql://exit_migrate:<pw>@<direct-host>:5432/exit_uat?sslmode=require"

pnpm --filter @exit/db exec prisma migrate status      # 1. inspect
pnpm --filter @exit/db exec prisma migrate deploy      # 2. apply
psql "$DATABASE_URL_MIGRATE" -f scripts/db/grants.sql  # 3. least privilege
pnpm db:seed                                           # 4. baseline: accounts, templates, workflows, reference data
pnpm exec tsx scripts/uat-stakeholder-seed.ts          # 5. stakeholder UAT dataset (OFF-2026-0001…)
```

### The first directory synchronization

The seeds do **not** populate the employee directory mirror. Only a synchronization run
fills `employee_source_record`, and the local reset tool's synthetic mode is what
normally triggers it. On the remote database, after step 5:

1. Sign in to the hosted app as a **System Administrator**.
2. Open **Administration → System** and press **Refresh Directory Now**.
3. Watch the panel; the run should finish `SUCCESS: checked 14, added 14`.

With no BambooHR credential and `bamboohr.mode` unset, the engine reads the
**fixture** adapter — the fourteen synthetic employees — so this is safe and needs
nothing external. Until it has run, the `/directory` pages show "The directory is
empty" (intake search still finds fixtures, so case creation works either way).

The refresh is queued at once and executed after the response; on a serverless web
host that continuation can be cut short, so **have the worker running first** — its
minute tick executes any queued run regardless.

Optionally enable `bamboohr.scheduledSync` on the same page. In UAT this makes the
hourly and nightly reconciliations run against the fixture (harmless, and it keeps
freshness `CURRENT`); with it off, freshness moves to "delayed" after two hours and
"stale" after six, which is cosmetic — a status note on directory pages and a failing
"employee directory mirror" component on `/admin/health`. `/api/ready` is unaffected.

## Running the worker

Unchanged from the normal architecture. Preferred — the container that matches the
production model:

```bash
docker build -f Dockerfile.worker -t exit-platform-worker .
docker run --rm --env-file ./uat-worker.env exit-platform-worker
```

`Dockerfile.worker` is `node:24-slim`, non-root, runs `prisma generate` at build, and
starts `tsx apps/worker/src/index.ts`. Migrations are a release step, not part of
container start.

Directly on a machine instead: Node ≥ 24, pnpm 10.33 via corepack, `pnpm install`,
`pnpm --filter @exit/db exec prisma generate`, then `pnpm worker`. Use a **dedicated
checkout** whose root `.env` holds only UAT values — the worker loads the repo-root
`.env`, and a developer checkout's points at the local database.

| Requirement | Detail |
| --- | --- |
| Outbound connectivity | The UAT database, and the S3 endpoint (HTTPS). Nothing else in UAT — no BambooHR, no mail provider |
| Inbound ports | **None.** The worker opens no listener |
| Placement | Anywhere that can reach both; it does not need to be near the web app |

### Confirming the worker is healthy

Three independent signals:

1. **stdout** — a `started` JSON line at launch (it reports `appBaseUrl` and
   `devLoginEnabled`), then a `heartbeat` line every 60 s, and `stage4_sweep` lines
   whenever work was done.
2. **`/admin/health`** — the worker component is `ok` while
   `system_config['worker.lastHeartbeat']` is under 180 s old.
3. **the database row itself** — `SELECT value FROM system_config WHERE key =
   'worker.lastHeartbeat'` advances every minute.

`/api/ready` does **not** depend on the worker: outside production it gates on the
database only. A green readiness probe therefore says nothing about dispatch — use
`/admin/health`.

### What breaks without the worker

| Affected | Symptom |
| --- | --- |
| Notification dispatch | Approvals sit at `PENDING` forever. **No captures appear in `/dev/mailbox`** |
| Directory refresh | A queued refresh may never execute on a serverless web host |
| Survey expiry | Expired survey links keep working |
| Workflow task release | Tasks are never released; dependencies never resolve |
| SLA and due states | Overdue evaluation never runs |
| Access escalation | Timed access escalation never fires |
| Role expiry | Expired role assignments are not revoked |
| Scheduled reports | Never produced |
| Directory reconciliation | Hourly/nightly runs never happen |
| `/admin/health` | Worker component failing after 180 s. `/api/ready` stays 200 |

Still usable without it: sign-in, directory browsing, case creation, case views,
document approval and rendering, action forms, audit trail, admin pages.

## Deployment protection

Hosted UAT **must remain access-protected at the host layer** for the whole of its
life. `IDENTITY_MODE=dev` with `ALLOW_DEV_LOGIN=true` means the platform's own sign-in
is a deliberate passwordless role switcher: anyone who reaches the URL becomes an HR
Manager. Host-level protection (password, SSO or IP allow-list on the entire
deployment) is the control that makes this acceptable, together with synthetic-only
data.

Two consequences: `APP_BASE_URL` must be the protected URL, and the sign-in-free token
links the platform emails (`/checklist/<token>`, `/ack/<token>`, `/survey/<token>`)
sit behind that protection too — testers following them from `/dev/mailbox` need the
protection credentials.

## Acceptance checks

| # | Proves | Pass condition |
| --- | --- | --- |
| 1 | Reachable | `/api/health` returns 200 from off-network; `/signin` renders |
| 2 | Health is honest | `/admin/health`: every component `ok`, including the worker heartbeat under 180 s and the directory mirror `CURRENT` |
| 3 | Access protection | The URL is not usable without the host-level protection |
| 4 | Sign-in | Role switcher works; sign-in is audited; the page names the environment |
| 5 | Production guard intact | `APP_ENVIRONMENT=production` with `ALLOW_DEV_LOGIN=true` **fails to start** |
| 6 | Acknowledgement required | Removing `UAT_HOSTED_ACK` **fails to start** |
| 7 | First synchronization | Refresh Directory Now completes `SUCCESS: checked 14`; `/directory` lists 14 employees |
| 8 | Directory | First-name, last-name, employee-number search; department and location filters; a profile with manager and direct reports; the organization view |
| 9 | Case creation | Resignation with notice, immediate resignation and termination each create correctly, with the manager pre-assigned and an alternate offered where none exists |
| 10 | Documents persist | Generate a letter, redeploy, download it again — byte-identical |
| 11 | Private documents | Document URLs refuse unauthenticated and unauthorised access |
| 12 | Notifications | With the worker running, approval reaches `SUBMITTED` and appears in `/dev/mailbox` |
| 13 | No external mail | Nothing is delivered to any real mailbox; every destination is a capture or reserved domain |
| 14 | Uploads labelled | Attachments are accepted and clearly marked as not scanned |
| 15 | Audit persists | `audit_event` rows survive redeploy; `UPDATE`/`DELETE` refused |
| 16 | Worker recovery | Stop the worker mid-flow, restart it; outstanding work is picked up with no duplicates |

## Decommissioning

Delete the deployment, the UAT database and the UAT storage bucket. Rotate
`SESSION_SECRET`. No application code is reverted, because none was made
host-specific.

## References

- DEC-062 — Node runtime mode versus application deployment environment
- `packages/config/test/hostedUat.test.ts` — the safety properties, pinned
- `docs/operations/BambooHRDirectorySynchronization.md` — the directory engine's own
  runbook (webhook setup, schedules, freshness, outage handling)
- `CLAUDE.md` — authentication safeguard, runtime mode versus deployment environment
