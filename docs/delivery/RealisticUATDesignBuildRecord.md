# Realistic UAT Design Build Record (Directive 6.1)

Organization-aware assignment, realistic UAT design, the Audit Centre and
business-ready UI refinement. Synthetic, local, non-production use; the sole
approved live interaction remains READ-ONLY BambooHR directory access.

## 1. Organization synchronization and graph (A/B/C)

- `employee_source_record` gained typed organization columns (managerName,
  managerSourceId, division, employeeNumber, active, lastSyncedAt) with a
  backfill from the existing payload; the payload is retained as provenance.
- The domain mapper additionally accepts `supervisorId`/`supervisorEId`
  (approved manager-relationship fields); the denylist is unchanged and
  still discards salary/bank/tax/address/medical/etc. before persistence.
- Sync writes the columns, resolves name-only manager references when the
  display name is unique (ambiguity stays null and becomes a finding), and
  flags post-activation manager drift exactly once per change - it NEVER
  reassigns existing case work (F).
- Pure org graph in `packages/domain/src/orgGraph.ts`: managerOf, direct
  reports, second-level manager, cycle/self-reference detection, and
  `validateOrg` computing the full check set (counts; missing/unresolved/
  inactive/ambiguous managers; self/circular references; duplicate employee
  numbers/emails; missing department/position/location; responder coverage)
  with HEALTHY / WARNING / ACTION_REQUIRED severities.
- `/admin/organization` (HR business + technical split) renders statistics,
  the findings table, responder coverage, manager/direct-report counts and
  post-activation hierarchy warnings. Fixture directory enriched to 11
  synthetic employees with a real manager graph (two managers, one
  missing-manager row, one inactive manager) so everything above is testable
  without any live data.

## 2. Assignment model (D/E/F/G/H/I/J)

- Case ownership: accountable owner (HR Manager) + operational
  `assignedOfficerId` assigned manually by the HR Manager (validated target,
  CASE_OFFICER_ASSIGNED / CASE_OFFICER_REASSIGNED with previous/new/reason,
  outstanding-task count recorded; completed evidence keeps its original
  actor).
- Manager routing: derived from the directory at draft creation
  (CASE_MANAGER_DERIVED), resolved to an application account only when an
  ACTIVE user holding LINE_MANAGER matches by work email (unique display
  name as fallback); audited HR-Manager override (CASE_MANAGER_OVERRIDDEN
  with original/replacement/reason); LINE_MANAGER authority remains strictly
  assignment-scoped (D) - verified by test.
- OFFBOARDING ASSIGNMENT PLAN (`/cases/[id]/assignment`): employee,
  management (with source badge and MISSING MANAGER — ACTION REQUIRED),
  HR ownership, IT/Finance rosters with open-task workload, workflow + task
  summary with initial owners, and the six required confirmations
  (`employee-identity`, `manager-routing`, `hr-ownership`, `it-routing`,
  `finance-routing`, `workflow-selection`).
- Activation now requires: assigned officer AND resolved manager (or audited
  override) AND all confirmations recorded after the last manager change.
  On activation the confirmed manager is auto-added as the MANAGER
  participant and LINE_MANAGER tasks are auto-assigned to them; IT/Finance
  tasks start in their department queues.
- Queue lifecycle (generic across departments - I): claim (released +
  unassigned, department role), assign (HR any-unassigned / same-department
  peer), return-to-queue (assignee or HR, reason required, IN_PROGRESS→READY
  with history preserved), reassign (target-validated, previous assignee now
  recorded). Due dates and the exact revocation deadline are never touched
  by any assignment operation. Queue UI: quick views (My tasks / Unassigned
  / All authorized / Critical / Overdue), assignee column, per-row Claim and
  Return-to-queue.

## 3. Audit Centre (K-R)

- 20 business categories derived from event types in the domain
  (`auditCategories.ts`) - no schema change; exhaustiveness unit-tested.
- Human-readable sentences (`auditHumanize.ts`) answer who/what/why/when for
  every assignment situation; before/after pairs extracted from metadata;
  restricted values render as "VALUE CHANGED — RESTRICTED".
- `/audit` Audit Centre: summary cards (today / assignments / approvals /
  security / denied), filter toolbar (date range, actor, category, event
  type, case number, outcome, record purpose), humanized table with detail
  drawers, keyset pagination, audited CSV export (csvCell injection
  protection) via `/api/audit-export`.
- Authorization: HR_MANAGER joined `audit.viewGlobal` with service-level
  minimization (restricted-case rows collapse to timestamp+category, case
  lookups do not leak existence); AUDITOR/PRIVACY_OFFICER keep full
  oversight; SYSTEM_ADMIN has `audit.viewTechnical` = technical categories
  (IDENTITY/CONFIG/SYSTEM) AND no case linkage - HR case content is
  structurally unreachable. Searches and exports are themselves audited
  (AUDIT_SEARCHED / AUDIT_EXPORTED).
- Case audit history: filter chips (All/Case/Assignments/Approvals/Tasks/
  Documents/Communications/Assets/Security/Clearance), humanized sentences,
  low-level noise hidden by default. Append-only protections unchanged and
  still proven by the runtime-privilege suite.

## 4. UI refinement (V-AH; theme preserved)

Same palette, family, layout and navigation architecture. Added: deliberate
type scale and spacing tokens; tabular numerals; opt-in sticky table
headers; `.empty` states with next steps; aligned filter toolbars; the
business case header (case reference, employee, routing, next action) with
the clickable eight-stage progress strip; the dashboard "Needs attention
now" row (critical/overdue/pending approval/due today/missing manager/
hierarchy changes/unassigned dept work); SubmitButton pending states on the
highest-traffic mutation forms. No renamed selectors or success strings.

## 5. Realistic UAT design (S/T/U)

Committed tests, seeds and documents are 100% synthetic. Live realism is a
facilitator-only flow: read-only sync → `scripts/uat-alias.ts create`
(pattern-based selection from the synced directory; writes the git/docker-
ignored `uat-local-real-person-mapping.json`; raises the "REAL DIRECTORY
MAPPING ACTIVE — UAT ONLY" banner) → `scripts/realistic-uat-seed.ts`
(service-layer TEST cases chosen by organizational queries - no hard-coded
names) → walkthrough (`docs/operations/RealisticStakeholderUATWalkthrough.md`,
16 parts) and matrix (`docs/operations/RealisticUATAssignmentMatrix.md`) →
`uat-alias.ts purge` + live-cache purge BEFORE any commit, verified by
`scripts/scan-real-names.ts` in the validation list.

## 6. Test coverage (AM)

- Unit: `packages/domain/test/orgGraph.test.ts` (graph, cycles, 19 checks),
  `auditCategories.test.ts` (category totality, humanized assignment
  sentences, redaction, before/after) + mapper/permission updates.
- Integration: `directive61OrgSync.test.ts` (columns, resolution, merge-fix
  regression, org validation service, hierarchy-flag safety, record-purpose
  gate), `directive61Assignment.test.ts` (officer assignment authority +
  audit, override, confirmations, the three activation blockers, auto-
  routing, claim/assign/return/reassign incl. SLA preservation and evidence
  attribution, LINE_MANAGER scoping, queue views), `directive61AuditCentre.
  test.ts` (filters, pagination, minimization + no-leak lookup, technical
  scoping, audited injection-protected export). Existing suites updated for
  the activation gate via the shared `readyAssignment` helper.
- E2E: `directive61-flows.spec.ts` (missing-manager gate + audited override,
  IT claim/return through the UI, Audit-Centre investigation incl. the
  technical view), `directive61-visual.spec.ts` (1440/1280/768/375 + axe on
  the new surfaces). All stage suites extended with the assignment-plan step
  and re-run.

## 7. Decisions and risks

Decisions D1-D9 as planned (typed columns + backfill; derived org graph; new
nullable case columns; assign authority split HR/peer; HR_MANAGER audit
widening with minimization; keyset pagination; return-to-queue semantics;
synthetic-first realism with facilitator-only live flow; searches audited
only when filtered). Residual risks: name-based manager resolution depends
on unique display names (ambiguity is surfaced, never guessed); the
realistic flow depends on facilitator discipline for banner/purge - enforced
by scan-real-names and the walkthrough's Part 16 checklist.
