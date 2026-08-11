# Realistic UAT Assignment Matrix (Directive 6.1)

Aliases only - the real-to-alias mapping exists solely in the local,
git-ignored `uat-local-real-person-mapping.json` (created and purged by
`scripts/uat-alias.ts`; never committed, never pasted into results). Real
organizational PATTERNS (department, manager depth, location split) come
from the synchronized read-only directory; every case is record purpose TEST
and labelled "UAT ONLY — SIMULATED OFFBOARDING — NOT A REAL EMPLOYEE
SEPARATION".

| Scenario | Employee alias | Org pattern exercised | Manager alias | HR Manager | HR Officer | IT | Finance | Workflow | Intentional override / reassignment | Exception tested | Expected outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A - standard resignation | UAT Employee A | Dept 1, manager with 2+ reports | UAT Manager A | UAT HR Manager A | UAT HR Officer A | Queue → UAT IT Responder A claims | Queue → UAT Finance Responder A claims | Resignation with notice | none | none | Full journey to COMPLETED; audit answers the whole history |
| B - immediate resignation | UAT Employee B | Different dept/location; same 2nd-level | UAT Manager B | UAT HR Manager A | UAT HR Officer A | Immediate critical queue task | Queue claim | Immediate resignation | none | overdue access + CRITICAL escalation; NOT_OBTAINED acknowledgement | Blocked clearance until items resolved, then complete |
| C - manager override | UAT Employee A2 (report of Manager A) | Derived manager present | UAT Manager A → B | UAT HR Manager A | UAT HR Officer A | Queue | Queue | Resignation with notice | Manager override (reason recorded) | none | Before/after in audit; A loses access, B gains it |
| D - IT reassignment | UAT Employee C | Any active | UAT Manager A | UAT HR Manager A | UAT HR Officer A | A claims → HR reassigns to B | - | Resignation with notice | IT reassignment | none | SLA unchanged; A loses update access; audit who-had/who-has/why |
| E - Finance reassignment | UAT Employee C | same case as D | UAT Manager A | UAT HR Manager A | UAT HR Officer A | - | A claims → HR reassigns to B | Resignation with notice | Finance reassignment | none | Same guarantees as D for Finance |
| F - missing manager | UAT Employee D (simulated copy, no manager) | Missing-manager record (local copy only; BambooHR untouched) | none → UAT Manager B (alternate) | UAT HR Manager A | UAT HR Officer A | Queue | Queue | Resignation with notice | Alternate-manager assignment (audited) | MISSING MANAGER — ACTION REQUIRED blocks activation | Activation only after audited alternate |
| G - restricted termination | EMP-TEST synthetic ONLY | n/a (never a real person) | dev fixture manager | UAT HR Manager A | UAT HR Manager A (self) | Minimum-data task | Minimum task | Termination (RESTRICTED) | none | non-disclosure matrix incl. minimized audit rows | No leak on any surface; restricted clearance by authorized HR |
| H - officer reassignment | UAT Employee A (case from A) | n/a | UAT Manager A | UAT HR Manager A | Officer A → Officer B | - | - | (existing case) | HR officer reassignment | none | CASE_OFFICER_REASSIGNED with previous/new/reason |
| I - audit investigation | (cases above) | n/a | - | - | - | - | - | - | - | - | Auditor walks the full history, filters, drawers, export; unauthorized values stay hidden |

Expected audit events per scenario (minimum): A - CASE_CREATED,
CASE_MANAGER_DERIVED, CASE_OFFICER_ASSIGNED, CASE_MANAGER_CONFIRMED,
WORKFLOW_ACTIVATED, TASK_CLAIMED (IT+Finance), approvals chain,
CLEARANCE_APPROVED. C - CASE_MANAGER_OVERRIDDEN (before/after). D/E -
TASK_CLAIMED, TASK_REASSIGNED (previous/new/reason), TASK_RETURNED_TO_QUEUE
where exercised. F - CASE_MANAGER_OVERRIDDEN after a blocked activation.
H - CASE_OFFICER_REASSIGNED. I - AUDIT_SEARCHED / AUDIT_EXPORTED.
