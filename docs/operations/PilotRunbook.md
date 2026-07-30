# Pilot Runbook

Operational procedure for moving the offboarding platform from manual
operation to a controlled pilot. All steps use the application's pilot
administration surface (`/admin/pilot`); nothing in this runbook authorizes a
live integration by itself. Live email, identity, BambooHR, storage and
scanning remain disabled until credentials AND written authorization exist
and the production configuration checklist is complete.

## Activation states

| State | Meaning |
| --- | --- |
| MANUAL_ONLY | Default. The platform records work; no automated dispatch. |
| TRAINING_ENABLED | TRAINING/TEST records may exercise automation in non-production. |
| PILOT_READY | Proposal stage for the pilot; no behavioural change yet. |
| PILOT_ACTIVE | Automation enabled for the approved pilot scope. |
| SUSPENDED | All new automated integration work stopped; evidence preserved. |
| POST_ROLLOUT_READY / POST_ROLLOUT_ACTIVE | Post-pilot rollout stages (out of scope for the pilot itself). |

BASELINE records never trigger automation in any state.

## Roles

- **HR Manager** - proposes/approves (business), owns pilot scope.
- **System Administrator** - approves (technical), owns configuration.
- **Privacy Officer** - approves when `pilot.privacyApprovalRequired` is set.

## Entering the pilot (PILOT_ACTIVE)

1. Open `/admin/pilot` and review the 24 readiness gates. Every MANDATORY
   gate must show PASS; advisory gates need a recorded rationale if failing.
   Gates are computed from live facts (approved calendar/reasons/policies,
   verified backup + restore, published SOPs, recorded training, UAT result,
   manual fallback readiness, health checks) - they cannot be hand-waved.
2. Propose the activation with the pilot scope and a rollback plan. The
   proposal core is frozen (database trigger) and checksummed.
3. Record HR Manager approval and System Administrator approval (distinct
   people; the UI enforces role separation). Record Privacy Officer approval
   if configured as required.
4. Apply the activation. Gates are re-evaluated at apply time; a failed
   mandatory gate blocks the transition.
5. Verify: `/admin/health` shows the expected provider modes; the outbox
   monitor is clean; audit log records PILOT_STATE_CHANGED.

## During the pilot

- Review `/admin/outbox` at least daily: retryable failures, dead letters and
  their resolutions (all audited).
- Review `/exceptions` for CRITICAL entries; access-revocation lateness is
  escalated automatically.
- Review `/admin/health` for worker heartbeat, backup age and provider state.
- Keep the manual fallback runbook ready; any doubt → suspend first.

## Suspension (immediate stop)

1. `/admin/pilot` → Suspend, with a recorded reason.
2. Suspension cancels pending outbox work and stops new automated
   integration work at once; existing evidence is preserved.
3. Manual operations continue per the Manual Fallback Runbook.
4. Resuming requires a fresh proposal + approvals + gates.

## Exit criteria and evidence

Pilot review uses the reporting catalogue (case throughput, notification
status, task SLA, access timeliness, integration failures) with small-group
suppression intact. Every state change, approval and suspension is in the
audit log with the activation record's checksum.
