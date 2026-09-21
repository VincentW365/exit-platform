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
through the existing host-agnostic `s3` mode against a **separate UAT bucket**. See
the storage section of the implementation notes for current status.

