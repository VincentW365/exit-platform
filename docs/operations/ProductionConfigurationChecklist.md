# Production Configuration Checklist

Every item below must be satisfied before the application is ever started
with `NODE_ENV=production`. The configuration loader enforces the FAIL-CLOSED
rows at startup - the process refuses to boot if they are violated. Nothing
in this checklist is currently satisfied: no production credentials exist in
this repository or environment, and none may be committed to Git.

Legend: **[ENFORCED]** = the config loader refuses to start;
**[MANUAL]** = must be verified by the operator/approver.

## Core

- [ ] [ENFORCED] `ALLOW_DEV_LOGIN` is absent/false; dev login route refuses
      to exist in production.
- [ ] [ENFORCED] `SESSION_SECRET` >= 32 chars, generated for production,
      stored in the host's secret manager - never in Git or the UI.
- [ ] [MANUAL] `DATA_KEY` set (dedicated at-rest encryption key) so recipient
      destinations do not fall back to the session-secret-derived key.
- [ ] [ENFORCED] `DATABASE_URL` uses the least-privilege runtime role
      (`exit_app`); `DATABASE_URL_MIGRATE` is provided only to the migration
      step, not the web/worker runtime.
- [ ] [MANUAL] `scripts/db/grants.sql` applied after every migration.

## Email (Microsoft Graph)

- [ ] [ENFORCED] `EMAIL_MODE=graph` (production rejects `sink`,
      `dev-capture`); `disabled` is permitted for a no-email start.
- [ ] [ENFORCED] `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`,
      `GRAPH_CLIENT_SECRET_REF`, `GRAPH_SENDER` complete when mode is graph.
- [ ] [MANUAL] Azure application registered with least privilege
      (`Mail.Send` restricted to the offboarding mailbox), admin consent
      recorded, secret in the secret manager (the app stores a REFERENCE).
- [ ] [MANUAL] Written authorization to send real mail exists (Decision
      Register); recipient directory entries for production are approved and
      verified; allowed-domain list confirmed.

## Identity (OIDC)

- [ ] [ENFORCED] `IDENTITY_MODE=oidc` (production rejects `dev`);
      `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET_REF` complete.
- [ ] [MANUAL] Role assignments administered in-app only (claims never grant
      roles); break-glass disabled unless explicitly configured with a
      recorded reason.

## Storage and scanning

- [ ] [ENFORCED] `STORAGE_MODE=s3` (production rejects `local`); `S3_BUCKET`,
      `S3_REGION`, `S3_ENDPOINT`, credential references complete.
- [ ] [ENFORCED] `SCAN_MODE=external` (production rejects `disabled` and
      `dev-passthrough`); `SCANNER_URL` configured.
- [ ] [MANUAL] Bucket is private, versioned, encrypted at rest; scanner
      quarantine flow tested with a synthetic EICAR-style object.

## BambooHR

- [ ] [ENFORCED] The raw-key form (`BAMBOOHR_API_KEY`) is REFUSED at startup
      in production; production access requires the reference-based secret
      pattern like every other provider: `BAMBOOHR_API_KEY_REF=env:<SECRET>`
      plus `BAMBOOHR_SUBDOMAIN`, on the web service AND the worker. A
      malformed reference is refused at startup (DEC-071).
- [ ] [MANUAL] After the first deploy, `/admin/system` shows the directory
      credential `configured`, the adapter `live` and live records present;
      the worker log shows `directory_startup_check` with `STARTUP:SUCCESS`.
- [ ] [MANUAL] Dedicated READ-ONLY BambooHR integration identity provisioned
      by the HR-system administrator (replace the local personal-style key);
      written authorization for the approved minimum field set recorded in
      the Decision Register; sync remains source-record-only (never case
      snapshots); scheduled sync enabled only by recorded configuration
      decision.
- [ ] [MANUAL] Employee directory synchronization (2026-09-15): the BambooHR
      employee-change webhook is created against `/api/bamboohr/webhook`
      and its private key is set as `BAMBOOHR_WEBHOOK_PRIVATE_KEY` (secret
      store, never a file in Git); `bamboohr.scheduledSync` is true so the
      hourly and nightly (02:00 Jamaica) reconciliations run; the worker is
      running (it executes queued runs and the start-up staleness check);
      `bamboohr.simulateOutage` is absent or false (ignored in production
      anyway). See `docs/operations/BambooHRDirectorySynchronization.md`.

## Operations

- [ ] [MANUAL] Worker deployed as its own process/container with the same
      fail-closed environment; heartbeat visible on `/admin/health`.
- [ ] [MANUAL] `/api/health` + `/api/ready` wired into the host's probes.
- [ ] [MANUAL] Backup schedule + restore verification working against the
      production database host (Backup and Restore Runbook), with approved
      RPO/RTO.
- [ ] [MANUAL] Retention policies, DSR SLAs and legal bases approved by the
      HR Manager (DEC-042; currently OPEN decisions; development values are
      synthetic).
- [ ] [MANUAL] Container images rebuilt from the committed Dockerfiles
      (non-root user, HEALTHCHECK) and scanned; images never contain secrets
      or the DMAIC source.
- [ ] [MANUAL] Pilot readiness gates all PASS and the activation is dually
      approved before `PILOT_ACTIVE`.

## Explicitly forbidden

- Production secrets in Git, in the UI, in logs or in audit metadata
  (references only - enforced in the system-config service).
- Connecting development/CI to production BambooHR, email, identity, storage
  or databases.
- Automatic pay withholding/deduction/entitlement calculation (never built).
