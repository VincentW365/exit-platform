# Stage 3 Operational Workflow Build Record

Directive 3 - operational workflows, department queues, asset recovery,
handover, clearance and notification control. Synthetic, local, non-production
use only. Implementation commit follows this record; nothing was pushed.

## 1. Implemented scope

- Versioned, deterministic workflow definitions with one ACTIVE version per
  workflow type, immutable once activated (service rule + database trigger),
  configuration checksums, and a full task-matrix preview.
- One workflow instance per active case, pinned to the exact definition
  version + checksum at activation; duplicate activation is impossible
  (status-guarded update + partial unique index).
- Task engine: 7 task states, dependency resolution (codes within the
  instance), release instants (including the restricted effective-time-minus-
  offset rule), waivers with authority checks, reassignment, blockers,
  append-only corrections of completed tasks, credential rejection in text
  fields.
- Business-calendar due dates with retained provenance (rule text, source
  instant, calendar version, calculation timestamp, original due date,
  recalculation reason). Exact-time security tasks use elapsed clock time.
- Case operational lifecycle: activate, hold/resume (pause-eligible tasks
  only), clearance review, HR-Manager completion, audited reopening with a
  reactivation plan, widened cancel/void that cancels open work and preserves
  evidence, and controlled departure-type change that supersedes the workflow
  and carries forward only code-matched completed evidence.
- Exact-time IT access revocation: due at the approved effective instant,
  never waivable (service + DB trigger), early completion requires a recorded
  reason, lateness stored in minutes, CRITICAL escalation at the due instant
  with a second escalation after 15 minutes, partial completion keeps the task
  blocked behind a CRITICAL exception, HR-Manager security-exception path.
- Department work queues (HR / IT / Finance / Line manager) with the full
  filter set, minimum-data rows, and strict role/assignment scoping.
- Controlled notifications: 7 deterministic template types with allow-listed
  placeholders as executable minimum-data declarations, HR-Manager approval
  for external/employee-facing recipients, checksum-bound approvals,
  idempotency keys, manual-send recording (method + destination REFERENCE
  only), invalidation on material case change, provider-neutral delivery
  interface with a development capture adapter (fail-closed in production,
  TRAINING/TEST records only, never represented as delivered).
- Asset catalogue, synthetic employee-issued assets, per-case recovery items
  auto-created at activation, operational states + 7 final dispositions,
  reasoned dispositions, HR-Manager-only waive/write-off, distinct
  documentation vs physical recovery measures, review exceptions with NO
  payroll linkage of any kind.
- Handover module: 10 manager-owned sections, credential detection and
  rejection, manager attestation on completion, HR review notes, HR-Manager
  waiver/not-applicable with reasons, consistency with workflow handover
  tasks.
- Exception and escalation engine: 15 exception types, 4 severities, idempotent
  open-exception rows (partial unique index), business-day escalation defaults,
  restricted-case minimization in the global feed.
- Clearance gate: pure domain evaluation of 7 conditions; entry to
  CLEARANCE_REVIEW only when all pass; HR-Manager approval re-verifies and
  writes an immutable clearance record (actor, meaning, snapshot, checksum,
  approved exceptions); survey completion is never an input.
- Dashboard: 15 workflow-operations queues plus reports P.1-P.14; worker
  sweeps for release, escalation, notification/asset/handover due states and
  readiness recalculation (idempotent, injectable clock, PII-free logs).

## 2. Excluded scope (deliberate)

- No live email, Microsoft Graph, identity, BambooHR, payroll, benefits,
  banking or insurance integration - adapters/records only.
- No pay calculation, withholding, deduction or recommendation anywhere; an
  unresolved asset produces a review exception only.
- No generative AI in any decision (workflow selection, task creation, due
  dates, notification wording, asset/clearance/waiver decisions).
- Termination letters remain impossible (Stage 2 placeholder stays disabled).
- PILOT/POST_ROLLOUT operational activation remains configuration-gated and
  disabled (`automation.workflowEngine` seeded off).
- Departmental "department manager" delegation of reassignment is not
  modelled (no such role exists); HR_MANAGER reassigns.

## 3. Workflow model

`WorkflowDefinition` (type, name, version, status DRAFT/ACTIVE/SUPERSEDED/
RETIRED, description, activation conditions, change reason, configuration
checksum, actor/timestamp lifecycle columns) with `WorkflowTaskDefinition`
rows (code, order, department, required role, kind, priority, confidentiality,
required/waiver rules, due basis/offset/kind, release basis/offset, hold and
block pause flags, dependencies, evidence). Drafts are edited in place;
"removed" tasks are disabled, never deleted. `WorkflowInstance` pins caseId +
definitionId + version + checksum and carries denormalized counters plus the
persisted readiness snapshot. `WorkflowTask` copies every operative field at
activation so later definition edits cannot alter running cases.

## 4. Seeded development workflow matrices

All three carry `DEVELOPMENT WORKFLOW - REQUIRES HR APPROVAL BEFORE
OPERATIONAL USE` in the description and are ACTIVE v1:

- RESIGNATION_WITH_NOTICE - 24 tasks (F.1-F.24) across HR (13), LINE_MANAGER
  (4), IT (2), FINANCE (3), plus survey-invite (optional) and the final
  clearance tracking task; timings per section F (verification +1bd of
  receipt, letter +2bd, handover -2bd before the final working day with a
  short-notice clamp, assets by the final working day, access at the exact
  effective instant, survey per Stage 2 rules).
- IMMEDIATE_RESIGNATION - 16 tasks (G.1-G.15): urgent same-day HR/IT review,
  immediately released exact-time access revocation (immediately overdue and
  critically escalated when the approved time is past), manager-recorded
  handover with waiver path, NOT_OBTAINED acknowledgement handling, delayed
  survey.
- TERMINATION - 11 tasks (H.1-H.13), all confidential: restricted HR chain,
  access revocation released at effective-time minus 1 hour (restricted
  timing), Finance minimum-data task released at the effective instant,
  optional authorized manager handover, NO survey task, restricted clearance.

## 5. Task states and rules

NOT_READY -> READY (dependencies satisfied + release instant) -> IN_PROGRESS
-> COMPLETED, with BLOCKED, WAIVED and CANCELLED. Waivers need the definition
to permit them, the configured authority (default HR_MANAGER) and a reason;
access revocation is never waivable (service rule + `access_task_never_waived`
trigger). Completed tasks change only through `TaskCorrection` rows (append-
only, original + corrected value + reason + clearance effect). Comments and
completion notes are length-capped and rejected when they look like
credentials.

## 6. Due dates, holds and recalculation

`computeTaskDue` resolves basis (CASE_RECEIVED / WORKFLOW_ACTIVATION /
EFFECTIVE_SEPARATION / FINAL_WORKING_DAY / NONE) x kind (BUSINESS_DAYS /
CALENDAR_DAYS / EXACT_TIME) against the active versioned calendar
(America/Jamaica). Date-only anchors stored at midnight UTC are re-anchored to
the same calendar date in the app zone. Provenance is stored per task. Case
ON_HOLD stamps the instance and, on resume, shifts due dates of open
pause-eligible tasks by the hold duration - never access revocation or other
non-pausable tasks. An approved effective-time change recalculates affected
open tasks (old dues retained, per-task audit) and surfaces retrospective
moves as DUE_DATE_RETROSPECTIVE_CHANGE exceptions; the workflow tab lists the
affected tasks before the change is confirmed.

## 7. Department queues

`/queue` serves HR (case-visibility-scoped), IT and Finance (department-wide
released tasks, minimum data), and line managers (expressly assigned tasks
only). Rows carry title, safe case/employee reference, status, priority,
due/overdue, blocker, next action, confidentiality indicator; departure type
and location appear only for HR. 13 views (ready/in progress/blocked/due
today/due this week/overdue/critical overdue/completed/waived/reassigned/
assigned to me/unassigned/all) plus department/type/location/search filters.
NOT_READY work is never shown (premature-disclosure prevention). SYSTEM_ADMIN
has no queue. Task detail pages enforce the same server-side rules; denied
access returns NOT_FOUND with an audit record.

## 8. Exact-time access control

Fields per section I on the task row (systems, completed, unresolved, result,
early reason, incident reference, escalation state). Due = the exact approved
effective instant; preparation (system-list editing) is possible from release;
completion before the due time demands a recorded reason; lateness is stored
in whole minutes; the sweep opens a CRITICAL exception at the due instant and
escalates to level 2 after 15 minutes (audited); unresolved systems keep the
task BLOCKED behind a CRITICAL exception, and clearance can proceed only via
an HR-Manager-approved security exception. No live identity system is called.

## 9. Notification model

`NotificationTemplate` (type, version, recipient class, subject/body with
allow-listed placeholders, minimum-data note, checksum) - one ACTIVE per type,
7 development templates seeded. `NotificationRecord` lifecycle DRAFT ->
PENDING_APPROVAL -> APPROVED -> READY_FOR_MANUAL_SEND -> MANUALLY_SENT with
CANCELLED/FAILED/SUPERSEDED; approval binds actor + checksum; external and
employee-facing classes require HR_MANAGER; Sagicor/NCB records exist only
after a recorded applicability confirmation; the idempotency key is
case + type + recipient class + workflow version + effective event. Manual
send stores sender, timestamp, method and an approved destination REFERENCE -
never a personal address, and none appear in logs. The development capture
adapter (K.12-K.15) writes `notification_capture` rows for TRAINING/TEST
records only, never marks anything delivered, and `getDeliveryAdapter()`
throws in production configuration.

## 10. Asset model

`AssetCatalogueItem` (11 approved types), `IssuedAsset` (synthetic register
for EMP-TEST-001..005), `AssetRecoveryItem` per case (auto-created from
issued assets at activation, manual additions allowed). Operational states
EXPECTED/REQUESTED/PARTIALLY_RETURNED (OVERDUE is computed, never stored) and
final dispositions RETURNED/NOT_ISSUED/LOST/DAMAGED/WAIVED/WRITTEN_OFF/
UNRESOLVED. LOST/DAMAGED/WAIVED/WRITTEN_OFF/UNRESOLVED require reasons;
WAIVED/WRITTEN_OFF require HR_MANAGER. Documentation rate (final dispositions
/ required items) and physical recovery rate (RETURNED / issued-and-due,
NOT_ISSUED excluded) are computed separately. There is no pay field, no
deduction field and no payroll hook anywhere in the model or services.

## 11. Handover model

One `HandoverRecord` per case (created at activation; manager participant
becomes the owner). Ten content sections, all validated against credential
patterns (passwords, private keys, API tokens/keys, PINs, access codes,
recovery codes, AWS/GitHub-style secrets) with the visible warning "Do not
enter passwords, access codes, private keys or authentication credentials."
Completion requires reassignment duties + replacement owner and writes a
MANAGER_HANDOVER_ATTESTATION attestation; NOT_APPLICABLE and WAIVED are
HR_MANAGER actions with reasons; workflow handover tasks stay consistent
automatically. Finance and IT have no route to handover content.

## 12. Clearance gate

`evaluateClearance` checks: required tasks completed/waived; access revocation
completed (or HR-Manager security exception); resignation letter RENDERED/
MANUALLY_ISSUED where applicable (never for termination); action form
APPROVED; every required asset documented (UNRESOLVED only with an approved
exception); required handover satisfied; no open CRITICAL exception. Finance
workpaper and HRIS records are required tasks and covered by the task check.
Survey completion is not an input. `requestClearance` (HR) enforces the gate
and records CLEARANCE_BLOCKED exceptions on refused attempts;
`approveFinalClearance` (HR_MANAGER only) re-verifies, completes case +
workflow, and writes the immutable `ClearanceRecord` (actor, role, meaning,
snapshot, unresolved approved exceptions, checksum, correlation id).
Clearance records are append-only at the database level.

## 13. Metrics (section P)

Dashboard queues: active workflows, due today/this week, overdue, critical
access, blocked, pending department ownership, notifications awaiting
approval / ready for manual send, assets outstanding, asset exceptions,
handovers outstanding, ready/blocked for clearance, completed cases. Reports:
task SLA compliance, median completion hours by department, access-revocation
timeliness (count/late/max/median delay), notification preparation and
manual-send timeliness (explicitly labelled as manual-send recording, no
delivery claims), notification corrections, asset documentation vs physical
recovery, handover completion, clearance and end-to-end cycle times, overdue
ageing buckets, waiver/override frequency, exceptions by category and
department. TRAINING/TEST records are excluded; restricted rows follow the
viewer's authority.

## 14. Migration

`20260729183812_stage3_workflows_queues_assets_clearance` - additive only: 15
new tables, 17 new enums, 3 extended enums (AttachmentPurpose,
AttestationSubject, AttestationKind). Hand-authored SQL adds: partial unique
indexes (one ACTIVE definition per type; one live instance per case; one OPEN
exception per case+type+reference), no-hard-delete triggers on all 13 evidence
tables, content-freeze triggers on non-draft workflow definitions and their
task rows, append-only triggers on clearance records / task corrections /
notification captures, and the access-task-never-waived guard. Verified
against the existing schema and from an empty database; no drift. Runtime
grants: SELECT/INSERT/UPDATE for mutable Stage 3 tables; SELECT/INSERT only
for task_correction, clearance_record, notification_capture; still no DELETE
and no DDL anywhere for `exit_app`.

## 15. Worker jobs

`runStage3Sweep(now)` (in `@exit/db`, injectable clock, called every 60s by
the worker): task release passes, overdue detection + severity escalation
(WARNING -> HIGH at 3 business days; HR-Manager escalation marker at 2),
exact-time access escalation (CRITICAL at due, level 2 after 15 minutes),
stale ready-notification detection, asset and handover overdue detection,
counter + clearance-readiness recalculation. All idempotent claim-style
updates with correlation IDs and PII-free counts. Stage 2 sweeps (PDF retry,
survey expiry) unchanged. The worker sends no email, revokes no live access,
updates no live BambooHR, changes no payroll, calls no AI service.

## 16. Authorization

New case actions (activate/hold/resume/reopen, workflow view/supersede, task
hrManage/correct, clearance request/approve, notification prepare/approve
internal/approve external/record send, asset manage/waiveWriteOff, handover
review/waive, exception resolve/approveSecurity) in the central policy module,
all classification-aware (RESTRICTED requires explicit HR participation).
Global actions for workflow-definition governance (officers draft, managers
activate/retire), queues and the exception feed. Department task access is
task-scoped (role + released + assignment), never case-scoped; SYSTEM_ADMIN
has no business surface; oversight roles stay read-only.

## 17. Tests

- Unit (37 new in `packages/domain/test/workflow.test.ts`, plus updated case
  state-machine tests): definition validation/cycles/checksums, due-date and
  release calculation (calendar, holidays, exact-time, negative offsets,
  short-notice clamp), dependency release, waiver/authority rules, lateness,
  escalation defaults, queue role mapping, notification idempotency/approval
  classes/lifecycle, asset denominators/disposition authority, credential
  detection, clearance gate (including the security-exception path).
- Integration (27 new across `stage3Workflow.test.ts` and
  `stage3AssetsClearance.test.ts`): T.1-T.25 as numbered in the directive,
  including duplicate-activation prevention, minimum-data department views,
  critical overdue + level-2 escalation with an injected clock, DB-level
  waiver refusal, hold/resume pause behaviour, recalculation provenance,
  notification approval/idempotency/applicability, issued-asset sourcing,
  disposition authority, the no-pay-field assertion, handover completion/
  waiver/credential rejection, all clearance blockers, survey-independence,
  full HR-Manager completion, restricted-case non-discovery and TRAINING/TEST
  metric exclusion.
- E2E (`stage3-flows.spec.ts`): Scenario 1 full resignation-with-notice
  lifecycle to COMPLETED across all four departments; Scenario 2 immediate
  resignation (urgent tasks, overdue access, NOT_OBTAINED acknowledgement,
  waived handover, blocked clearance); Scenario 3 restricted termination
  (undiscoverable, minimum-data IT task, no letter, no survey); Scenario 4
  exception lifecycle (partial access completion -> CRITICAL exception ->
  security-exception resolution -> preserved history); Scenario 5 asset
  exception (lost/returned, no pay effect, distinct measures).

## 18. Screenshots

`e2e/stage3-visual.spec.ts` captures 13 surfaces (dashboard, definition
register + matrix, workflow preview + instance, department queue, task detail,
access-revocation task, notifications, assets, handover, clearance, exception
feed) at 1280px and 375px into `artifacts/stage3/` (gitignored), with axe
WCAG 2.x A/AA scans asserting zero critical/serious violations and zero
horizontal overflow.

## 19. Feature flags

`automation.workflowEngine` seeded DISABLED. TRAINING/TEST records exercise
the full engine; OPERATIONAL records refuse activation while the flag is off
or the case is in the BASELINE cohort (Stage 1 rule preserved). Existing Stage
1/2 flags unchanged and disabled.

## 20. Known limitations

- Escalation "notifications" are in-app only (queues, exception feed, audit);
  no email exists by design in this increment.
- The workflow-definition draft editor edits the task matrix as validated
  JSON - functional for development configuration, not a production authoring
  UI.
- The E2E Scenario 2 asserts the blocked-clearance side; the full
  resolution-to-completion path is proven in Scenario 1 and integration T.22.
- Department-manager-scoped reassignment (D.5) is not modelled - no
  department-manager role exists; HR_MANAGER reassigns with reasons.
- Notification "FAILED" is reachable only through the recorded manual
  process (no transport exists to fail).
- Reopened cases do not automatically instantiate a follow-up workflow; the
  audited reactivation plan governs manual follow-up (C.6 preserved).
- In-process rate limiting and single-node worker assumptions carry over from
  Stage 2.

## 21. Future live-integration boundaries

Live email/Graph dispatch would slot behind `NotificationDeliveryAdapter`;
live identity revocation would attach to the access-revocation task evidence
fields; BambooHR updates remain a manual status record pending DEC-018/019;
production calendars, workflow matrices and notification wording all require
HR approval and new ACTIVE versions before PILOT activation.
