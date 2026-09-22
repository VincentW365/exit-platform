# Support and Incident Runbook

Concrete in-application procedure for support requests and incidents during
the pilot. Complements `SupportAndIncidentManagement.md` (ownership/policy)
with the shipped tooling (`/support`, `/admin/health`, `/admin/outbox`).

## Channels and intake

All support requests become tickets in `/support` (any authenticated role
can raise one): category, severity, PII-free description, affected case
reference (case number only - never employee personal details in ticket
text). Tickets carry status history; updates are audited.

## Severity and response (pilot targets)

| Severity | Examples | Target first response |
| --- | --- | --- |
| CRITICAL | Access revocation cannot be executed; data exposure suspected; platform down during an active offboarding | Immediately; invoke Manual Fallback Runbook in parallel |
| HIGH | Outbox dead letters; a department queue unusable; sign-in broken for a role | Same business day |
| MEDIUM | A report/surface defect with a workaround | 2 business days |
| LOW | Cosmetic issues, wording, requests | Weekly triage |

Targets are pilot working agreements, not contractual SLAs; production SLAs
are an open decision.

## Triage procedure

1. Check `/admin/health` first: database, worker heartbeat, provider modes,
   outbox depth, backup age. Most operational reports trace to one of these.
2. For notification issues, use `/admin/outbox`: the status, attempt count,
   masked destination and last error code identify the failure class.
   Retry/resolve actions are audited; a dead letter always has a matching
   exception on `/exceptions`.
3. For access/authorization reports, verify the role assignment on
   `/admin/system` (users panel) - remember business vs technical separation
   is intentional, not a defect.
4. Attach a **diagnostic bundle** (generated from `/support`): it contains
   versions, configuration MODES (never values), health summary and counts -
   it is PII-free by construction and safe to share with support staff.

## Incidents (security/privacy)

- Suspected data exposure, credential leak or unauthorized access: treat as
  CRITICAL, notify the HR Manager and the infrastructure operator immediately, preserve
  evidence (no database edits - history is immutable by design), record a
  disclosure log entry if personal data left the platform, and record the
  incident review outcome on the ticket.
- An open security/privacy incident blocks pilot activation (readiness gate)
  until closed with a recorded outcome.

## Escalation ladder

Reporter → HR Manager (business, privacy and platform administration,
DEC-042/DEC-063; the infrastructure operator joins for hosting-level faults) →
Sponsor (business continuity decision, suspension of the pilot).
