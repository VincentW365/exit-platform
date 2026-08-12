# Training Guide

Role-based training for the offboarding platform pilot. Completion is
recorded per person per module in the Operations centre (`/operations`);
recorded completions feed the pilot readiness gate.

## How training runs

- Trainer: HR Manager (business modules) and System Administrator
  (technical modules).
- Environment: development/training instance, synthetic data only, record
  purpose TRAINING or TEST. Real employee data is never used in training.
- Format per module: walk-through, hands-on exercise from the SOP module,
  then the participant records completion in `/operations`.

## Modules by role

### All users (modules SOP-01, SOP-10)

- Signing in, navigation, your queue, raising a support ticket.
- Data handling rules: synthetic vs real data, no personal data in free
  text, credential text is rejected, everything is audited.

### HR Officer (SOP-02, SOP-03, SOP-04)

- Case intake: receipt capture, departure types, record purpose, snapshots.
- Employee lookup: searching the directory (name, id, department, position,
  location), source badges and last-sync status, reviewing pre-populated
  details before creating a draft, and the audited manual-entry fallback
  when the directory is unavailable. The organization directory view
  (`/directory`) for case preparation.
- Controlled documents: generation, approval binding, attestation; why a
  termination letter is impossible.
- Notifications: preparing drafts, placeholders as minimum-data, submitting
  for approval; what the outbox does after approval.

### HR Manager (SOP-05 plus all HR Officer modules)

- Approvals: case approval, external notification authority, clearance
  review and completion, reopening discipline.
- Pilot administration: readiness gates, proposing/approving activation,
  suspension; the reason taxonomy and calendar approval.
- Reports: catalogue, suppression behaviour, audited exports.

### IT (SOP-06)

- The work queue; the access review task; the exact-time revocation task,
  early-completion reasons, lateness escalation, partial completion.
- Asset dispositions and documentation vs physical recovery.

### Finance / Line Manager (SOP-07)

- Queue basics, department tasks, the handover module and attestation,
  clearance inputs. No payroll decisions exist in the platform.

### HR Manager privacy duties (SOP-08, DEC-042)

- Retention policies and holds, dry runs, anonymization limits, DSR search
  and package exclusions, disclosure logging - absorbed into the HR Manager
  role since DEC-042 removed the separate Privacy Officer.

### System Administrator (SOP-09)

- System configuration (references only - never secret values), user
  lifecycle + session revocation, access reviews, fixture sync and
  reconciliation, health monitoring, outbox operations, backup/restore
  verification. Explicit boundary: no access to HR case content.

## Completion evidence

`/operations` records user + module + instant (append-only). The pilot gate
requires at least the pilot user group's completions; the HR Manager reviews
the completion list before UAT starts.
