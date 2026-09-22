# Training Guide

Role-based training for the offboarding platform pilot. Completion is
recorded per person per module in the Operations centre (`/operations`);
recorded completions feed the pilot readiness gate.

## How training runs

- Trainer: HR Manager (business and platform-administration modules;
  DEC-063).
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
- Action form completion (Directive 6.3): the officer prepares, reviews and
  COMPLETES ordinary forms; the suggested acknowledgement treatment per
  departure type; when the optional HR-Manager review step applies.

### HR Benefits and providers (SOP-03a, Directive 6.3 - HR Officer and HR Manager)

- Confirming benefits applicability once (group health / group life / other
  provider, YES/NO/UNKNOWN); why UNKNOWN blocks clearance; what YES and NO
  each cause downstream.
- The provider directory: purposes, organizations, contacts; entering a
  recipient for one case vs saving an approved recipient for future cases
  (who may do which, and why).

### HR Email actions (SOP-04a, Directive 6.3 - HR Officer and HR Manager)

- How the platform derives the required actions from the case facts, and
  how to read the provenance ("derived from ...").
- Send control levels in business terms: sent automatically / needs your
  review / needs HR-Manager approval; restricted-case behaviour;
  confidential termination timing.
- The evidence chain: sent → acknowledged → completed; recording evidence
  received by email or phone; why a delivered email is never proof that IT
  access was removed.
- Overriding a derived action with a reason; what happens on re-derivation.
- Notification templates: drafting, previewing and test-sending with
  synthetic sample values (HR Manager activates).

### HR exception-first dashboard (SOP-04b, Directive 6.3)

- Working from "Requires your attention": recipient required, benefits
  unresolved, automatic sending blocked, confirmation overdue - what each
  means and the one action that resolves it.
- What "In progress automatically" is telling you, and why completed items
  are collapsed.

### HR Manager (SOP-05 plus all HR Officer modules)

- Approvals: case approval, letter approval, provider-notification review
  and HR-Manager-approval-level sends, clearance review and completion,
  reopening discipline. The optional Action-Form review configuration
  (`actionForm.requireHrReview`) and when to enable it.
- Pilot administration: readiness gates, proposing/approving activation,
  suspension; the reason taxonomy and calendar approval; send-control
  configuration and notification-template activation.
- Reports: catalogue, suppression behaviour, audited exports.

### IT and Finance recipients (SOP-06, Directive 6.3 - guidance, not app training)

IT and Finance no longer sign in for routine offboarding. This module is
recipient-side guidance distributed to the departments:

- What the email contains: employee reference, case reference, the exact
  effective separation time (IT), the minimum data the work needs - never
  reasons, survey content or pay information.
- How the secure link works: one click to confirm receipt, one to confirm
  completion (IT/Finance); links are single-use, expire (72 hours for IT
  access removal, 14 days otherwise), and open a neutral page if reused or
  expired - ask HR to re-send if a link has died.
- No account, no password, no case access: the link confirms the one action
  only. If clicking is impossible, reply by email or phone and HR records
  the evidence.
- Timing expectations: IT access removal is confirmed BY the effective
  time; an unconfirmed removal escalates to HR as critical.

### Line Manager (SOP-07)

- Queue basics, the handover module and attestation, credential rejection
  in text fields. Managers no longer approve the Action Form (Directive
  6.3). No payroll decisions exist in the platform.

### HR Manager privacy duties (SOP-08, DEC-042)

- Retention policies and holds, dry runs, anonymization limits, DSR search
  and package exclusions, disclosure logging - absorbed into the HR Manager
  role since DEC-042 removed the separate Privacy Officer.

### Platform administration - HR Manager (SOP-09)

- System configuration (references only - never secret values), user
  lifecycle + session revocation, access reviews, directory refresh and
  reconciliation, health monitoring, outbox operations, attestation of the
  backup/restore evidence. Backups and restore tests themselves are
  infrastructure operations outside the application (DEC-063). Explicit
  boundary: administration never widens the HR Manager's case scope.

## Completion evidence

`/operations` records user + module + instant (append-only). The pilot gate
requires at least the pilot user group's completions; the HR Manager reviews
the completion list before UAT starts.
