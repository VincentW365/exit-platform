# Backup and Restore Runbook

Local/synthetic backup discipline for the offboarding platform. Production
disaster recovery is NOT approved and NOT claimed here; hosting, storage
location, encryption-at-rest custody and RPO/RTO targets are open decisions
recorded in the Decision Register.

## What is implemented

- **Create backup** (`/admin/system`, System Administrator only): runs
  `pg_dump -Fc` against the configured database using the migrate credential,
  writes the dump to the gitignored `BACKUP_DIR`, records size + SHA-256
  checksum as an immutable `backup_record` row and audits BACKUP_CREATED.
- **Restore + verify** (same page): re-hashes the file against the recorded
  checksum (refuses a tampered file), drops/recreates the isolated scratch
  database `exitplatform_restorecheck`, restores with
  `pg_restore --no-owner --no-privileges`, then compares critical-table
  counts (cases, snapshots, documents, attestations, surveys, workflow
  instances/tasks, assets, clearance records, audit events) between the
  restored copy and the source database. Result, note and verification
  timestamp are recorded and audited (BACKUP_VERIFIED).
- The health page surfaces latest backup age; a verified restore is a
  mandatory pilot readiness gate.

## Cadence (development/pilot)

| Action | Frequency | Owner |
| --- | --- | --- |
| Backup | Before every migration; at least weekly during the pilot | System Administrator |
| Restore verification | After every backup taken before a migration; at least monthly | System Administrator |
| Checksum spot-check | With each restore verification (automatic) | - |

## Restore verification procedure

1. `/admin/system` → "Create database backup (pg_dump)" → confirm the
   banner shows size + checksum.
2. Press "Restore into isolated DB + verify" on the newest record.
3. Confirm "Restore test PASSED" and the "restore verified" badge.
4. If it FAILS: do not delete anything. Check `BACKUP_DIR` disk space, the
   PostgreSQL service and the note on the record; take a fresh backup and
   verify again. A checksum mismatch means the file changed after capture -
   treat as an incident (Support runbook).

## Actual data-loss event (development scope)

1. Declare an outage (`/continuity`) and stop the worker.
2. Choose the newest VERIFIED backup record.
3. Restore into a NEW database name (never over the damaged one), using the
   same `pg_restore` flags as the verification path.
4. Repoint `DATABASE_URL`/`DATABASE_URL_MIGRATE` at the restored database,
   run `prisma migrate status` to confirm schema state, re-apply
   `scripts/db/grants.sql`, restart web + worker.
5. Reconcile the gap window through fallback entries; keep the damaged
   database for investigation.

## Constraints

- Backup files contain synthetic data only in this environment but are
  treated as sensitive: gitignored directory, no copies into the repository,
  no upload anywhere.
- `backup_record` rows are immutable (database trigger) apart from the
  verification fields; history is never rewritten.
