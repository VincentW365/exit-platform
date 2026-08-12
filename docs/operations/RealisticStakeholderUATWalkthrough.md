# Realistic Stakeholder UAT Walkthrough (Directive 6.1)

The complete facilitator journey for realistic UAT on the organization-aware
platform. **Aliases only in this document and in every captured result** -
real names live exclusively in the local, git-ignored mapping (Part 4). The
red banners are law: if either "LIVE HR DIRECTORY DATA" or "REAL DIRECTORY
MAPPING ACTIVE" is visible, no screenshots and no committed evidence.

## Part 1 - Startup

1. Start PostgreSQL if stopped (`pg_ctl ... start`, DEVELOPMENT.md).
2. `pnpm dev` (web, http://localhost:3000) and `pnpm worker` (second terminal).
3. Health: open `/admin/health` as the System Administrator - database,
   provider modes and worker heartbeat must be green/expected.
4. Safety state: every UAT case carries record purpose TEST; automation flags
   stay OFF; the only live system permitted anywhere is READ-ONLY BambooHR.

## Part 2 - Directory

1. `/admin/system` (System Administrator): credential status must read
   `configured`; press **Test connection (read-only)** - aggregate counts only.
2. Set `bamboohr.mode` = `live`, press **Run directory sync**. The red LIVE
   banner appears - evidence capture stops until Part 15 purges it.
3. `/admin/organization`: review the health banner, the 19 hierarchy checks,
   responder coverage and manager/direct-report counts. ACTION_REQUIRED
   findings (missing managers, inactive managers, loops) are UAT inputs -
   scenario F uses one of them deliberately.
4. `/directory`: review coverage and data gaps; run the reconciliation report
   from `/admin/system` and note finding kinds.

## Part 3 - Role mapping

Map real people to application roles for the session (Administration → Users
and roles). Record only aliases here:

| Alias | Application role |
| --- | --- |
| UAT HR Manager A | HR_MANAGER |
| UAT HR Officer A | HR_OFFICER |
| UAT IT Responder A / B | IT_RESPONDER |
| UAT Finance Responder A | FINANCE_RESPONDER |
| UAT Manager A / B | LINE_MANAGER |
| UAT Privacy A (dual-hat) | PRIVACY_OFFICER |
| UAT Auditor A (dual-hat) | AUDITOR |
| UAT SysAdmin A | SYSTEM_ADMIN |

LINE_MANAGER access is assignment-scoped: a manager sees only the cases
routed to them - granting the role is safe for exactly-one-case exposure.

## Part 4 - Alias mapping (facilitator only)

1. `pnpm exec tsx scripts/uat-alias.ts create` - selects employees from the
   SYNCED directory by organizational pattern (different departments,
   locations and manager depths; never top executives or the facilitator),
   writes `uat-local-real-person-mapping.json` (git- and docker-ignored) and
   raises the "REAL DIRECTORY MAPPING ACTIVE — UAT ONLY" banner.
2. `pnpm exec tsx scripts/uat-alias.ts view` prints the local mapping for the
   facilitator's eyes only. Never paste it anywhere.

## Part 5 - Banner verification

Confirm both banners are visible before any realistic case is created: the
LIVE directory banner (Part 2) and the REAL MAPPING banner (Part 4). They
gate evidence capture, not testing.

## Part 6 - Scenario A: standard resignation with notice

Run `pnpm exec tsx scripts/realistic-uat-seed.ts` once (creates the aliased
TEST cases below), or drive intake manually:

1. As UAT HR Officer A: New case → search **UAT Employee A** by name →
   verify position/department/location/source/last-sync on the results →
   select → review pre-populated details → create the TEST draft → submit.
2. As UAT HR Manager A: approve (snapshot) → open the **Assignment tab**:
   employee block, derived manager (**UAT Manager A**) with position and
   second level, HR ownership → assign **UAT HR Officer A** → review IT and
   Finance rosters with workload → tick all six confirmations → confirm.
3. Workflow tab → review the preview → **Activate**.
4. Manager tasks routed automatically to UAT Manager A; IT and Finance tasks
   sit in their queues (Part 7-8 claims them). Complete the journey exactly
   as in `UATQuickStart.md` Part 1 (document, action form, handover, access
   revocation, assets, survey, clearance) and finish with Part 13's audit
   review of the same case.

## Part 7 - Manager experience (UAT Manager A)

My queue shows only this case's manager tasks; handover; duty reassignment;
action-form approval; confirm no other employee data is visible anywhere.

## Part 8 - IT experience (UAT IT Responder A/B)

Quick views (My tasks / Unassigned / All authorized / Critical / Overdue);
**Claim** from Unassigned; task detail shows the assignee; **Return to
queue** with a reason; a colleague claims it back; the exact-time revocation
deadline never moves. Scenario D: after A claims, UAT HR Manager A reassigns
to B with a reason; check the audit trail answers who-had/who-has/why/when.

## Part 9 - Finance experience (UAT Finance Responder A)

Finance queue claim → checklist → completion. Confirm no exit-survey,
restricted-note or payroll-like content is visible (Scenario E mirrors
Scenario D for reassignment).

## Part 10 - Documents / Part 11 - Assets / Part 12 - Survey

As in `UATQuickStart.md`: branded PDF letter (approve + download), asset
returns with one exception (no monetary field anywhere), survey invitation →
completion → privacy checks per role.

## Part 13 - Audit

1. Case audit history: open the case → Audit history → filter chips (All /
   Assignments / Approvals / ...). Identify: creator, manager derivation,
   the officer assignment, IT claim, Finance claim, approvals, the
   correction, asset disposition, clearance.
2. Audit Centre (`/audit`, as UAT HR Manager A or UAT Auditor A): summary
   cards, filter by category ASSIGNMENT, open a detail drawer (before/after
   values; restricted values show "VALUE CHANGED — RESTRICTED"), filter by
   case number, export CSV (the export itself is audited).
3. As UAT SysAdmin A: `/audit` shows technical events only - verify no case
   number or employee name appears.

## Part 14 - Reporting

Reports → run 2-3 operational reports with purpose TEST → export CSV →
confirm small-group suppression and no restricted-case leakage.

## Part 15 - Alternate scenarios

- **B immediate resignation** - second department/manager pair (aliases
  UAT Employee B / UAT Manager B); urgent overdue access task + escalation.
- **C manager override** - propose derived manager, override to UAT Manager
  B with a reason; original loses access, replacement gains it; audit shows
  before/after.
- **F missing manager** - use the simulated copy the alias script creates
  (a directory row cloned WITHOUT a manager; BambooHR itself is never
  written): activation blocks with MISSING MANAGER — ACTION REQUIRED until
  an audited alternate is assigned.
- **G restricted termination** - synthetic employee only (EMP-TEST); verify
  the full non-disclosure matrix incl. the minimized Audit-Centre rows.
- **H officer reassignment** - UAT HR Manager A reassigns the case to a
  second officer; audit records previous/new/reason.

## Part 16 - Purge, reset and evidence

One command handles every clear-down need (DEC-041):

```
pnpm exec tsx scripts/reset-environment.ts status            # read-only state check
pnpm exec tsx scripts/reset-environment.ts purge-live --yes  # remove real data, keep cases
pnpm exec tsx scripts/reset-environment.ts uat --yes         # full rebuild + UAT dataset
pnpm exec tsx scripts/reset-environment.ts fresh --yes       # production-readiness clean slate
```

- `purge-live` deletes the local alias mapping, anonymizes the live cache,
  lowers both red banners and returns the directory to fixture mode - the
  same effect as `scripts/uat-alias.ts purge --purge-directory`.
- `uat` and `fresh` drop and recreate the development database (migrations,
  grants, seed), so nothing real can survive them; `fresh` is the state a
  production go-live starts from - zero cases, zero real data.

After any UAT round that touched live data:

1. Run `purge-live` (or a full rebuild) and verify BOTH red banners are gone.
2. `pnpm exec tsx scripts/scan-real-names.ts` must pass (no real name from
   the mapping appears in any tracked file).
3. Record results by alias in `StakeholderSyntheticUATReport.md`; screenshots
   only from banner-free synthetic state, stored under gitignored
   `artifacts/stakeholder-uat/`.
