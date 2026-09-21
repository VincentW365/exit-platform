# Hosted UAT Runbook

## What this is, and what it is not

This describes a **temporary hosted copy** of the platform so that testers can reach
it remotely and run UAT. Nothing here is a production deployment decision.

- The host currently used for the web application is a **convenience testing host
  only**. It is **not** the selected production architecture.
- **Production deployment remains host-agnostic and container-based** —
  `Dockerfile.web` and `Dockerfile.worker`, deployed wherever the business chooses.
  That path is unchanged by anything in this runbook.
- **`apps/worker` remains a separate long-running process.** It is not replaced by
  any host's scheduler, queue or workflow product, and no such product is used.
- **No host-specific service is required by the application.** The application
  depends on PostgreSQL, object storage and its own configuration — nothing else.
  Everything below works identically on a container host, another cloud provider,
  or a spare machine.

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
          │  UAT object storage          │
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

## Configuration for this deployment

Web host environment variables:

```bash
# What this deployment is for, asked for twice.
APP_ENVIRONMENT=uat
UAT_HOSTED_ACK=true

# Access. The deployment itself is access-protected at the host level; the
# switcher is passwordless and must never be reachable by the public.
IDENTITY_MODE=dev
ALLOW_DEV_LOGIN=true

# Nothing leaves the building: captures land in notification_capture and are
# read at /dev/mailbox. No external mail is sent.
EMAIL_MODE=dev-capture

# Uploads are accepted and clearly labelled as unscanned.
SCAN_MODE=dev-passthrough

# Disposable UAT database - never the production one. Use the POOLED endpoint.
DATABASE_URL=postgresql://exit_app:...@<uat-host>/<uat-db>

# Distinct from any other environment's secret.
SESSION_SECRET=<openssl rand -base64 48>

# Links in captured email are built from this. It must be the URL testers use.
APP_BASE_URL=https://<the-uat-url>

# Correct client IPs in the audit trail behind the host's proxy.
TRUSTED_PROXY=<proxy CIDR or address>

# Storage: see "Document storage" below.
STORAGE_MODE=...

# Deliberately ABSENT: no BambooHR credential of any kind.
```

The worker gets the same `DATABASE_URL`, `SESSION_SECRET`, `APP_BASE_URL`, storage
configuration and `APP_ENVIRONMENT`/`UAT_HOSTED_ACK` pair.

> **Access protection is what makes the passwordless switcher acceptable.** Without
> it, anyone who finds the URL becomes an HR Manager. Protect the deployment at the
> host level before sharing the link.

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

UAT therefore requires **durable object storage shared by both processes**, configured
through the host-agnostic `s3` mode against a **separate UAT bucket**.

`S3StorageAdapter` is implemented against `@aws-sdk/client-s3` and is generic S3 —
endpoint, region and addressing style are all configuration, so it works against AWS
S3, MinIO, Ceph or any S3-compatible provider. Nothing in it is tied to a hosting
platform.

```bash
STORAGE_MODE=s3
S3_ENDPOINT=https://<uat-endpoint>
S3_BUCKET=<uat-bucket>          # a SEPARATE UAT bucket, never production's
S3_REGION=<region>
S3_FORCE_PATH_STYLE=false       # true for MinIO/Ceph-style path addressing

# Credential REFERENCES, never credentials.
S3_ACCESS_KEY_REF=env:UAT_S3_ACCESS_KEY
S3_SECRET_KEY_REF=env:UAT_S3_SECRET_KEY
UAT_S3_ACCESS_KEY=<set in the deployment's secret store>
UAT_S3_SECRET_KEY=<set in the deployment's secret store>
```

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

## BambooHR and directory data

**No live BambooHR credentials in this environment.** The production configuration
refuses a raw key outright, and connecting a temporary hosted copy to the live HR
system is forbidden regardless (CLAUDE.md rule 8).

This costs nothing, because the directory reads `employee_source_record` **from the
database**. BambooHR is only a synchronisation source. A seeded synthetic directory
exercises every directory feature.

Seed with the existing tooling:

```bash
pnpm exec tsx scripts/reset-environment.ts uat --yes --synthetic
```

`--synthetic` skips the live BambooHR reconnect and leaves the fixture directory in
place. The synthetic dataset must be sufficient to test directory search,
organizational views, employee selection, manager assignment, case creation, and the
resignation-with-notice, immediate-resignation and termination workflows.

**Synthetic data only** — `EMP-TEST-001`, `Avery Brown` and similar. No real employee
name, address, employee number, personal email or HR export may enter this
environment.

## Database

A **disposable UAT PostgreSQL instance**, never the production database.

It must support the two-role model in `scripts/db/grants.sql` (`exit_migrate` owns the
schema; `exit_app` is the runtime with no DELETE and no DDL) and the raw-SQL triggers
the migrations install — append-only `audit_event`, the DELETE prohibition on
`offboarding_case`, and the cohort/purpose CHECK constraint.

Migrations run as a deliberate step, never from the web application and never from a
build:

```bash
export DATABASE_URL_MIGRATE="postgres://exit_migrate@<direct-endpoint>/<uat-db>"
pnpm --filter @exit/db exec prisma migrate status
pnpm --filter @exit/db exec prisma migrate deploy
psql "$DATABASE_URL_MIGRATE" -f scripts/db/grants.sql
```

`migrate deploy` is forward-only. Never run `prisma migrate dev` against a shared
database. Re-run `grants.sql` after every migration: new tables default to read-only
for `exit_app`.

## Running the worker

Unchanged from the normal architecture:

```bash
# Container, matching the production model:
docker build -f Dockerfile.worker -t exit-platform-worker .
docker run --env-file ./uat.env exit-platform-worker

# Or directly on a test machine:
pnpm worker
```

It needs only to reach the UAT database and the UAT object storage. It does not need
to run on the same host as the web application.

### What breaks without the worker

| Affected | Symptom |
| --- | --- |
| Notification dispatch | Approvals sit at `PENDING` forever. **No captures appear in `/dev/mailbox`** |
| Survey expiry | Expired survey links keep working |
| Workflow task release | Tasks are never released; dependencies never resolve |
| SLA and due states | Overdue evaluation never runs |
| Access escalation | Timed access escalation never fires |
| Role expiry | Expired role assignments are not revoked |
| Scheduled reports | Never produced |
| Directory sync | Hourly/nightly reconciliation never runs |
| Readiness | `/api/ready` returns 503 once the heartbeat passes 180 s |

Still usable without it: sign-in, directory browsing, case creation, case views,
document approval and rendering, action forms, audit trail, admin pages.

## Acceptance checks

| # | Proves | Pass condition |
| --- | --- | --- |
| 1 | Reachable | `/api/health` returns 200 from off-network; `/signin` renders |
| 2 | Environment is honest | Startup log and sign-in page both name `uat` |
| 3 | Access protection | The URL is not usable without the host-level protection |
| 4 | Sign-in | Role switcher works; sign-in is audited |
| 5 | Production guard intact | Setting `APP_ENVIRONMENT=production` with `ALLOW_DEV_LOGIN=true` **fails to start** |
| 6 | Acknowledgement required | Removing `UAT_HOSTED_ACK` **fails to start** |
| 7 | Directory | Search, org view, manager assignment all work on synthetic records |
| 8 | Case creation | Resignation with notice, immediate resignation and termination each create correctly |
| 9 | Documents persist | Generate a letter, redeploy, download it again — byte-identical |
| 10 | Private documents | Document URLs refuse unauthenticated and unauthorised access |
| 11 | Notifications | With the worker running, approval reaches `SUBMITTED` and appears in `/dev/mailbox` |
| 12 | No external mail | Nothing is delivered to any real mailbox; every destination is a capture or reserved domain |
| 13 | Uploads labelled | Attachments are accepted and clearly marked as not scanned |
| 14 | Audit persists | `audit_event` rows survive redeploy; `UPDATE`/`DELETE` refused |
| 15 | Worker recovery | Stop the worker mid-flow, restart it; outstanding work is picked up with no duplicates |

## Decommissioning

Delete the deployment, the UAT database and the UAT storage bucket. Rotate
`SESSION_SECRET`. No application code is reverted, because none was made
host-specific.

## References

- DEC-062 — Node runtime mode versus application deployment environment
- `packages/config/test/hostedUat.test.ts` — the invariants above, pinned
- `CLAUDE.md` — authentication safeguard, runtime mode versus deployment environment
