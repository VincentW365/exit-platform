# Manual Fallback Runbook

Executable procedure for continuing secure offboarding when the platform (or
one of its integrations) is unavailable, and for reconciling that work
afterwards. Complements `ManualFallbackAndBusinessContinuity.md` (policy)
with the concrete in-application workflow (`/continuity`).

## When to invoke

- The application, database or worker is down or unhealthy (`/admin/health`
  red, no worker heartbeat).
- The pilot has been SUSPENDED and time-critical offboarding work must
  continue.
- A specific integration fails during the pilot (outbox dead letters piling
  up) and HR decides to revert affected steps to manual.

Invocation is a decision by the HR Manager (business impact) with the System
Administrator (technical assessment). Record it as soon as the application is
usable; if the outage prevents that, record it retroactively.

## During the outage - manual operating rules

1. Access revocation remains time-critical: the line to IT stays verbal or
   ticket-based, executed at the effective separation instant; note the exact
   completion time for later entry.
2. Use the printed/offline SOP checklists (Operations centre → SOP modules)
   for each departure type; they mirror the workflow task matrices.
3. Record every action on paper or a local file WITHOUT personal data beyond
   what the form requires; use employee numbers, not addresses/bank details.
4. No pay decision is made in fallback; unresolved assets remain a review
   item exactly as in the system.
5. Send no external notification that would normally require HR-Manager
   approval without that same approval recorded manually.

## In the application (`/continuity`)

1. **Declare the outage**: scope (full platform / a named integration),
   start instant, declarer. This is audited.
2. **Record fallback entries** as work happens (or immediately after
   service is restored): each entry gets a sequential reference
   (`FB-<year>-<seq>`), the case reference if known, the action performed,
   the actor and the real-world completion instant.
3. **Reconcile** each entry exactly once against the platform record: create
   or update the corresponding case/task/notification evidence, then mark the
   entry reconciled (one-time; the service rejects a second reconciliation).
4. **Close the outage** only when every entry is reconciled; the service
   enforces this.

## After restoration

- Run the outbox monitor: retry or resolve any dead letters produced during
  the outage window.
- Review `/exceptions` for CRITICAL items raised in the gap.
- If the pilot was suspended, resuming requires the Pilot Runbook path
  (fresh proposal + approvals + gates).
- Include the outage and reconciliation summary in the weekly pilot review.
