# Backup and Restore Runbook

Backup discipline for the offboarding platform. Production disaster recovery
is NOT approved and NOT claimed here; hosting, storage location,
encryption-at-rest custody and RPO/RTO targets are open decisions recorded in
the Decision Register.

## Where backups live since DEC-063

Backups and restore tests are **infrastructure operations, not HR
operations**. The two-role model (DEC-063, 2026-09-22) retired the System
Administrator login together with the in-application pg_dump / restore
tooling that used to sit on `/admin/system`. Nothing in the application takes
a backup any more:

- the operator of the hosting environment takes and verifies backups with the
  database tooling below, outside the application;
- the HR Manager **attests** that evidence in the application by setting the
  configuration values `readiness.backupVerified` and `readiness.restoreTested`
  (Administration → System → "Set a configuration value", reason required,
  audited), which is what the two mandatory pilot readiness gates read - the
  same shape as the SOP, UAT and manual-fallback attestations;
- the historical `backup_record` rows written by the retired tooling remain
  in the database, immutable and read-only; history is never rewritten.

## Procedure (development, UAT and pilot)

1. **Backup**: `pg_dump -Fc` against the environment's database using the
   migrate credential, written to a location outside the repository that is
   never committed or uploaded. Record the size and the SHA-256 checksum of
   the file with the run.
2. **Restore verification**: check the file against its recorded checksum
   (a mismatch means the file changed after capture - treat as an incident,
   Support runbook); restore into a NEW, isolated database with
   `pg_restore --no-owner --no-privileges`; compare critical-table counts
   (cases, snapshots, documents, attestations, surveys, workflow
   instances/tasks, assets, clearance records, audit events) between the
   restored copy and the source. Record the result with the run.
3. **Attest**: the HR Manager sets `readiness.backupVerified` = `true` and
   `readiness.restoreTested` = `true` with a reason that names the run
   (date, checksum prefix). Re-attest after each verified restore; the pilot
   readiness page shows the attestation status.

## Cadence (development/pilot)

| Action | Frequency | Owner |
| --- | --- | --- |
| Backup | Before every migration; at least weekly during the pilot | Infrastructure operator (outside the application) |
| Restore verification | After every backup taken before a migration; at least monthly | Infrastructure operator (outside the application) |
| Attestation in the application | After each verified restore | HR Manager |

## Actual data-loss event (development scope)

1. Declare an outage (`/continuity`, HR Manager) and stop the worker.
2. Choose the newest VERIFIED backup.
3. Restore into a NEW database name (never over the damaged one), using the
   same `pg_restore` flags as the verification path.
4. Repoint `DATABASE_URL`/`DATABASE_URL_MIGRATE` at the restored database,
   run `prisma migrate status` to confirm schema state, re-apply
   `scripts/db/grants.sql`, restart web + worker.
5. Reconcile the gap window through fallback entries; keep the damaged
   database for investigation.

## Constraints

- Backup files contain synthetic data only in development and UAT but are
  treated as sensitive: never inside the repository, no copies anywhere the
  runbook does not name, no upload.
- `backup_record` rows are immutable (database trigger); the retired tooling
  is not reinstated to "clean up" history.
