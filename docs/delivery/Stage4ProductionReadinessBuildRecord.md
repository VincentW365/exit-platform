# Stage 4 Production Readiness Build Record

Directive 4 - integration adapters, transactional outbox, pilot operations,
advanced reporting, privacy/retention operations, continuity, deployment
packaging and release hardening. Synthetic, local, non-production use only.
Implementation commit follows this record; nothing was pushed.

## 1. Implemented scope

- **Transactional notification outbox (B).** Approved notifications enqueue an
  outbox record inside the same database transaction as the approval; a
  database-unique idempotency key derived from the notification's idempotency
  key makes duplicate enqueue impossible. The worker claims records with
  optimistic row-version/status guards, dispatches through the configured
  provider adapter and records SUBMITTED (provider acceptance) with a distinct
  delivery status. Failures are classified retryable/permanent; retryable
  failures use bounded exponential backoff with jitter and dead-letter after
  the configured attempt limit, raising a NOTIFICATION_FAILED exception.
  Manual-send recording and cancellation cancel pending outbox rows in the
  same transaction. Destinations appear only masked; retry/cancel/resolve are
  audited administrator actions on the outbox monitor.
- **Email provider adapters (C).** Provider interface with: development
  capture provider (writes to the local capture mailbox, refuses production),
  disabled provider, and a Microsoft Graph adapter boundary that validates
  configuration, builds the exact request shape and FAILS CLOSED with
  PROVIDER_NOT_CONFIGURED - no live Azure application exists and none was
  called. Live modes are configuration-gated; production refuses capture/sink
  modes at startup.
- **Recipient directory (D).** Central per-class recipient configuration with
  destinations encrypted at rest (AES-256-GCM) and displayed masked only,
  business/technical edit separation, HR-Manager approval for external
  classes, verification recording and environment scoping. Development seeds
  only `capture://` destinations.
- **Identity lifecycle (E).** OIDC adapter boundary (fails closed when
  unconfigured), claim-validated sign-in sync, JIT provisioning behind
  configuration, roles NEVER derived from claims, administrator disable with
  immediate session revocation (session issue-time vs invalidation timestamp),
  orphaned-work exceptions, append-only access reviews, expiring role
  assignments with worker revocation, and a break-glass status that is
  disabled unless explicitly configured.
- **BambooHR read adapter (F).** Fixture adapter over synthetic employees is
  the only executable path; the live adapter fails closed without credentials
  and written authorization. Sync updates source-record fields only (never
  case snapshots), records per-field diffs and produces append-only
  EmployeeSyncRun evidence plus a six-finding reconciliation report.
- **Object storage + scanner boundaries (G/H).** Local adapter gains
  retention deletion, health and production-refusal; S3-compatible adapter
  boundary validates configuration and fails closed without network calls.
  Scanner: dev-passthrough (non-production only), disabled (quarantine-by-
  default) and external boundary; scan failures quarantine and raise
  exceptions.
- **Administration centre (I) + reason taxonomy (J) + calendar (K).**
  Business vs technical administration hubs; versioned reason categories with
  approval, effective windows, reporting groups and sensitivity flags;
  calendar approval and compute-only impact preview.
- **Pilot activation (L/M).** Central activation state with 24 readiness
  gates evaluated from live facts (mandatory vs advisory), immutable
  activation proposals (frozen core + checksum via database trigger),
  HR/System-Admin/Privacy approvals, PILOT_ACTIVE and beyond blocked without
  mandatory gates + dual approval, and one-click suspension that cancels
  pending outbox work.
- **Advanced reporting (N) + schedules (O).** 22-report catalogue with
  server-side authorization, HR-visibility and record-purpose filters,
  small-group suppression (configurable threshold, default 5), reporting-group
  reason aggregation that hides sensitive labels, deterministic survey keyword
  counts (explicitly no AI), audited CSV exports with formula-injection
  controls, and scheduled reports that re-resolve the creator's authority at
  run time and store output through the storage adapter with dev-mailbox
  capture and append-only run evidence.
- **Privacy operations (P).** Versioned retention policies with approval,
  legal-hold placement/release, retention dry runs that identify without
  deleting (append-only evidence), anonymization of closed non-operational
  cases blocked by holds, data-subject search, DSR package preparation with
  the required exclusions, disclosure logging and a privacy overview.
- **Backup/restore (Q).** pg_dump custom-format backups with SHA-256
  checksums and recorded evidence; restore into an isolated scratch database
  with checksum verification and critical-table count comparison against the
  source; production disaster recovery remains documented, not claimed.
- **Continuity (R) + support (T) + SOP/training centre (S).** Outage
  declaration, sequential fallback reference numbers, one-time reconciliation
  per entry, closure only when fully reconciled; support tickets and PII-free
  diagnostic bundles; 10 SOP modules with recorded training completions.
- **Deployment packaging (U).** Multi-stage non-root Dockerfiles for web and
  worker (standalone Next.js output, HEALTHCHECK, secrets/DMAIC excluded via
  .dockerignore) and a full production fail-closed configuration matrix:
  production refuses dev login, capture/sink email, local storage,
  passthrough/disabled scanning and dev identity, and requires complete
  provider configuration to start.
- **Observability (V).** /api/health and /api/ready endpoints and an
  administrator health page: database/migration state, provider modes, worker
  heartbeat, outbox depth/failures, backup age and critical exceptions -
  PII-free.

## 2. Excluded scope (deliberate)

- No live call to Microsoft Graph, Azure AD/Entra, BambooHR, S3, a malware
  scanner or any OIDC provider was made; no such credentials exist in the
  repository or environment. All live adapters fail closed.
- No production deployment, hosting selection or DNS/TLS work.
- No real email; the capture mailbox is explicitly labelled and dev-only.
- No pay withholding/deduction/entitlement calculation anywhere.
- No AI decision-making; survey summaries are deterministic keyword counts.
- Production retention schedules, DSR SLAs and legal bases remain OPEN
  decisions; development values are clearly labelled synthetic.
- Container images are authored but were NOT built locally (Docker is not
  installed on the development workstation); this is recorded honestly in the
  validation evidence.

## 3. Data model additions (additive migration)

`notification_outbox`, `recipient_config`, `system_config`, `access_review`,
`employee_sync_run`, `pilot_activation`, `scheduled_report`, `report_run`,
`retention_policy`, `retention_hold`, `retention_run`, `disclosure_log`,
`data_subject_request`, `backup_record`, `outage`, `fallback_entry`,
`support_ticket`, `training_completion`; User gains identity-lifecycle
columns (department, manager, provisioning status, deactivation, session
invalidation); RoleAssignment gains expiry; ReasonCategory becomes a
versioned, approvable taxonomy; HolidayCalendar gains approval/effective
windows; OffboardingCase gains anonymization markers. All new tables carry
no-delete triggers; evidence tables are append-only; backup-record core
fields and pilot-activation cores are trigger-immutable.

## 4. Security posture

- Server-side authorization on every new read and mutation (30 new global
  actions in the permission matrix).
- SYSTEM_ADMIN retains zero access to HR case content; business vs technical
  administration is enforced in the permission matrix and verified by tests.
- Recipient destinations and any sensitive value at rest use AES-256-GCM with
  an HKDF-derived key; the UI shows masks only; logs carry no PII.
- System configuration refuses raw-secret-looking values (secret references
  only) and never audits values verbatim.
- Fail-closed production start-up; live integrations disabled by default;
  BASELINE records never trigger automation; TEST/TRAINING dispatch only in
  non-production.

## 5. Verification summary

Unit (config fail-closed matrix, domain rules), integration (X.1-X.27:
outbox transactionality/idempotency/backoff/dead-letter, provider gating,
recipient encryption, identity revocation, sync evidence, pilot gates and
approvals, reporting suppression and authority, retention dry-run/holds/
anonymization, backup restore-verify, runtime DB privileges), Playwright E2E
scenarios 1-7 plus a visual/axe sweep over the 14 new surfaces. Exact
commands and results are recorded in the directive evidence report.
