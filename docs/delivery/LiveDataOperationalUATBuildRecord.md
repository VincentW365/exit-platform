# Live-Data Operational UAT Build Record (Directive 6.2)

Implementation record for `feat: enable live-data UAT and optimize operational
workflow`. Companion documents:
`../operations/LiveDataStakeholderUATWalkthrough.md` (the 19-part testing
sequence) and `OperationalEffectivenessReview.md` (P0-P4 findings log).

## Scope delivered

1. **Six-role model (DEC-042).** AUDITOR and PRIVACY_OFFICER removed from the
   active model; HR_MANAGER absorbed privacy/retention operations,
   survey-response oversight and audit export; SYSTEM_ADMIN keeps technical
   administration and never case content. Restricted cases are now
   participant-only for content AND discovery. The pilot privacy approval
   tier was retired; activation requires HR Manager + System Administrator
   approval by two DIFFERENT people (code-enforced distinctness). Database
   enum values remain deprecated-in-place; stale assignments are revoked with
   reason by the seed; unknown role literals are filtered from every actor
   projection.
2. **Directory role mapping (E).** `createUserFromDirectory` +
   `enableUser` services (audited IDENTITY_USER_CREATED/ENABLED), the
   mapping surface on Administration → Organization (SYSTEM_ADMIN creates/
   grants; HR sees the mapped table), sign-in grouping "Directory-mapped
   staff", `User.department` populated for coverage reporting, and the
   manager-resolution logic de-duplicated into `managerResolution.ts` - a
   mapped real manager resolves automatically by work email.
3. **Live-data UAT (A/M/N, DEC-043).** The alias flow was retired
   (uat-alias/realistic-uat-seed deleted, banner removed);
   `scripts/live-uat-seed.ts` selects real employees BY ORG PATTERN
   (different departments/locations/managers, no senior titles, aggregates-
   only output) for scenarios 1/2/7/8 incl. the local UAT-SIM missing-manager
   copy; every TEST case shows the "UAT — SIMULATED OFFBOARDING" banner;
   `scan-real-names.ts` now derives its needles from the local live
   directory rows so the pre-commit gate stays meaningful.
4. **Side-effect safety (B).** Consolidated proof in
   `liveDataUatSafety.test.ts`: the BambooHR adapter exposes no write-capable
   method; automationPermitted refuses TEST/TRAINING (and BASELINE) even with
   flags enabled; feature gates admit TEST records without enabling live
   paths; the email provider never claims external delivery.
5. **Responsibility plan (L).** The task table now shows owning queue,
   individual assignee, projected due instant (same calendar logic as
   activation), dependency and required flag.
6. **Operational effectiveness (R/S/T/U/V/W/X/Y/Z/AA).** Work-aware shared
   next-action module; clearance regrouped into a decision screen
   (HR/Manager/IT/Finance/Assets/Documents/Handover/Security, unresolved
   first, satisfied collapsed); dashboard reordered Attention → Today →
   Process health with the critical-access list promoted and the duplicate
   exception concept unified; queue consolidated to one 8-filter row with an
   Overdue column; exception feed gained owner-as-person, due, type/
   department filters, per-type deep links and inline resolution; escalation
   thresholds moved to audited system-config keys; the intake screen gained
   the "From the directory (source data)" confirmation panel and a sticky
   action footer; operational diagnostics panel on Administration → Health.
7. **Performance (AB).** Dashboard's four serial service calls parallelized;
   `timed()` dev helper (EXIT_TIMING=1); measurements at live volume below.

## Validation results

(Recorded at commit time - see the directive FINAL RESPONSE for the full
command list.)

- Unit suite: 204 passing.
- Integration suite: 198 passing (incl. directive62RoleMapping 5,
  liveDataUatSafety 4; two intentionally-removed oversight assertions).
- E2E suite: 44 passing on a clean-slate database (route sweep now covers
  the six remaining roles; one spec gained a streamed-metadata title settle).
- Production build: clean; NO schema change, NO migration, no drift.
- Real-name scan (live rows present) and secret scan: clean.

## Performance at live directory volume

Measured with 375 live records, warm, median of 3 (service level):

| Surface | Duration |
| --- | --- |
| Employee search (searchEmployees) | 4 ms |
| Case list with search (listCases q) | 4 ms |
| Dashboard services (hr / stage3 / attention) | 2 / 14 / 4 ms (parallelized on the page) |
| Queue (listMyQueue, all) | 6 ms |
| Audit search (listGlobalAudit, category filter) | 7 ms |
| Assignment plan (getAssignmentPlan) | 13 ms |
| Org overview (getOrgOverview, 375+ graph) | 6 ms |

No N+1 pattern remains on the hot paths; the dashboard's four serial waits
were parallelized. All comfortably inside interactive budgets at company
scale.
