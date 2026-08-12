# Operational Effectiveness Review (Directive 6.2 R/AI)

Findings from the systematic inefficiency inspection of every major process
surface, with what was implemented in Directive 6.2 and what remains for
stakeholder review. Priorities: P0 prevents operation/security issue; P1 major
operational inefficiency; P2 meaningful productivity improvement; P3 polish;
P4 optional.

| ID | Pri | Area | Observed problem | Root cause | Change | Implemented? |
| --- | --- | --- | --- | --- | --- | --- |
| OE-01 | P1 | Case header | "Next action" was a status label, not work-aware - every ACTIVE case showed the same text; users opened tabs to find what was actually open. | Status-only switch in the header component; task/blocker data unread. | Shared next-action module consuming progress stages + open/overdue/blocked counts; attention tone highlights urgency. | YES |
| OE-02 | P1 | Clearance | The decision screen listed all 7 gate conditions flat (met and blocked alike), full notification list and every resolved exception - the HR Manager had to read everything to find the one blocker. | No grouping/priority in the readiness item model. | Conditions grouped by HR/Manager/IT/Finance/Assets/Documents/Handover/Security; unresolved first; satisfied groups + notifications + resolved exceptions collapsed. | YES |
| OE-03 | P1 | Dashboard | ~29 equally-weighted stat tiles; the critical-access list buried mid-page; two unrelated "exceptions" concepts; four serial service round trips. | Sections accreted per stage without hierarchy. | Attention Required (with the critical list + review items) → Today → Process Health ordering; serial awaits parallelized. | YES |
| OE-04 | P1 | Queue | 18 view buttons across two duplicated rows; overdue age hidden inside the Status cell; a filter (departureType) silently dropped on view switch. | Two generations of nav coexisting. | One 8-filter row (My tasks/Unassigned/Due today/Overdue/Blocked/Critical/Completed/All); Overdue as a column; filter carry-over fixed. Old view keys still work by URL. | YES |
| OE-05 | P1 | Exceptions | Feed rows were not actionable (no resolve control), owner shown as a department even when a person was known, due date captured but never displayed, every type deep-linked to /clearance regardless of where the fix lives. | Projection dropped ownerId; page predated the richer model. | Owner-as-person + due columns; type & owning-department filters; per-type deep links (assets→/assets etc.); resolve directly from the feed. | YES |
| OE-06 | P1 | Duplicate entry | The intake screen re-offered department/location and showed the directory data only as a heading - operators could not confirm what would be copied. | No source-data confirmation view. | "From the directory (source data)" panel (name, number, position, dept, location, manager, source, last sync) clearly separated from separation-specific fields; org-unit selects pre-filled and union-derived. | YES (6.1+6.2) |
| OE-07 | P2 | Escalation | All escalation thresholds were compile-time constants (one even a stray literal); HR could not review or tune them. | No configuration keys. | escalation.accessSecondMinutes / ordinaryEscalateBusinessDays / ordinaryHighBusinessDays system-config keys (audited) read by the sweep with safe defaults. | YES |
| OE-08 | P2 | Long forms | Submit actions sat below the fold (intake ~330 lines; action form has six separate submit buttons scattered). | No sticky footer pattern. | .form-footer sticky action bar applied to intake; action form consolidation deferred (six forms are six distinct server actions - merging risks control clarity). | PARTIAL |
| OE-09 | P2 | Diagnostics | No way to see queue ageing, reassignment churn or approval wait without ad-hoc queries. | No diagnostic surface. | "Operational diagnostics" panel on Administration → Health (unassigned/blocked ages, claims & reassignments 30d, approval wait, intake field split) - explicitly not KPIs. | YES |
| OE-10 | P2 | Re-enable accounts | Disabling a user was one click; re-enabling required a seed script. | Missing enableUser service. | enableUser service + re-enable control on the Organization mapping table (audited IDENTITY_USER_ENABLED). | YES |
| OE-11 | P2 | Manager provisioning | Real managers could not receive routed work without hand-crafted accounts. | No directory→account path. | createUserFromDirectory + mapping screen; manager auto-resolution then binds by work email. | YES |
| OE-12 | P2 | Escalation notifications | escalatedAt/level are recorded but nobody is actively notified beyond the feed/dashboard. | No notification routing engine for internal escalations. | RECORDED for stakeholder review - candidate: notification records to HR_MANAGER + department owner on level changes. | NO (review) |
| OE-13 | P2 | Cross-case exception rollup | A systemic failure (e.g. template break) creates N identical exceptions across N cases with no root-cause grouping. | Dedup is per case+type+ref. | RECORDED for stakeholder review - candidate: grouped display by type with count when >3 cases share a type. | NO (review) |
| OE-14 | P3 | Case overview | Employee/department/departure/effective repeated in the Summary panel immediately under the header showing the same facts. | Header added later than the summary. | Duplicated rows removed; the summary keeps source-record, dates, notice, reason and snapshot details. | YES |
| OE-15 | P3 | Case creation steps | Draft → submit → approve → plan → activate spans 5 screens/6 submits. | Deliberate maker-checker gates (DEC controls). | KEPT AS IS - each step is a distinct control (creation vs approval vs routing confirmation vs activation); collapsing them would remove real approvals (X). Recorded for stakeholder feedback. | NO (by design) |
| OE-16 | P3 | Approvals review (X) | Full inventory reviewed: document approval, form manager+HR approval, external notification approval, clearance, pilot dual-approval, template/workflow activation. | - | No approval removed - each maps to a documented control. Pilot approval STRENGTHENED: two-different-people check now code-enforced. | YES (review done) |
| OE-17 | P4 | Queue sorting | Fixed dueAt/priority ordering; no user-selectable sort or pagination beyond 200. | Not yet needed at current volume. | RECORDED - revisit if task volume grows. | NO (review) |

## Diagnostic metrics (AJ)

Live instrumentation: `EXIT_TIMING=1` logs per-service durations in
development; Administration → Health carries the operational diagnostics
panel. Intake data-entry split: 6 fields copy from the directory, 13
separation-specific fields are entered by HR (the directive's
duplicate-entry target: zero re-typed source fields - met).

Measured at live directory volume (375+ records) during the Directive 6.2
validation pass - see `LiveDataOperationalUATBuildRecord.md` for the numbers.
