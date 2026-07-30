# Synthetic UAT Report (Directive 5)

Automated execution of the synthetic user acceptance test plan
(`../operations/UATPlan.md`) against the production-readiness build. All
identities, employees and data are synthetic; no live system was contacted.
This report supports - and does not replace - stakeholder UAT sign-off.

## 1. Commit tested

`8021fd16916da258231dc4aed22c5baf34409785` -
"feat: prepare integrations pilot operations and production readiness",
plus the Directive 5 defect fix recorded below (committed with this report).

## 2. Environment

Windows 11 workstation; Node 24.12; pnpm 10.33; local PostgreSQL 17.9
(127.0.0.1:5433, roles exit_admin/exit_migrate/exit_app); Next.js dev server
on port 3100 driven by Playwright 1.62 (Chromium); `EMAIL_MODE=sink`
(maps to the development capture provider), `SCAN_MODE=dev-passthrough`,
identity=dev role switcher, BambooHR=fixture adapter, storage=local.
NODE_ENV=development throughout; every live adapter fail-closed.

## 3. Synthetic participants (tester identities)

| Role | Synthetic tester |
| --- | --- |
| HR_MANAGER | Dana Field |
| HR_OFFICER | Riley Okafor |
| IT_RESPONDER | Sam Chen (+ disposable Devon Temple for Scenario 10) |
| FINANCE_RESPONDER | Alex Romero |
| LINE_MANAGER | Jamie Douglas |
| PRIVACY_OFFICER | Rowan Silvera |
| AUDITOR | Quinn Baptiste |
| SYSTEM_ADMIN | Marley Thompson |

Synthetic employees: EMP-TEST-001..005 (Avery Brown et al.). Every case used
record purpose TEST.

## 4. Scenario execution and results

Execution date: 2026-07-30. Every scenario was driven through the real UI by
Playwright as the role accounts above (service-level integration tests are
cited only where a step is not UI-reachable, e.g. injected provider
failures). Executable evidence: `e2e/uat-scenarios.spec.ts` (new UAT
journeys) plus the stage acceptance suites listed per scenario - the full
suite re-runs the entire plan.

| # | Scenario | Evidence (spec → test) | Result |
| --- | --- | --- | --- |
| 1 | Resignation with notice (integrated, one case: intake → approval → workflow → document + PDF → action form (HR/Finance/Manager) → IT access removal → handover → assets → notification captured → survey completed → clearance → completed → reports) | uat-scenarios "UAT-1" | **PASS** |
| 2 | Immediate resignation (urgent workflow, overdue access + CRITICAL escalation, acknowledgement NOT_OBTAINED with reason, blocked clearance until resolution) | stage3-flows Sc2; stage2-flows Sc2 (NOT_OBTAINED); survey-delay rule by domain/integration tests | **PASS** |
| 3 | Restricted termination (discovery only for authorized HR; minimum-data IT/Finance/manager surfaces; SYSTEM_ADMIN no case content; no termination letter; survey disabled; no leakage through dashboards/queues/reports/counts/feeds/exports/errors/direct URLs; restricted clearance) | stage3-flows Sc3; stage2-flows Sc4; acceptance-flows J.5/J.6+J.8; stage4-flows Sc2/Sc7 | **PASS** |
| 4 | Document correction (audited correction of approved data → approval INVALIDATED but historically visible → automatic supersede + corrected draft → fresh submission/approval → old copy never current) | uat-scenarios "UAT-4"; stage2Documents integration (D.12/N.6 + new UAT-4 fix tests) | **PASS** (after fixing UAT-D1, below) |
| 5 | Task and exception management (overdue → escalation, queue visibility, unauthorized invisibility, block with reason, HR resolve/reassign, complete history, exception ageing) | stage3-flows Sc4 | **PASS** |
| 6 | Asset exception (returned/damaged/lost mix; documentation rate separate from physical recovery; NO pay linkage; authorized disposition; clearance responds) | stage3-flows Sc5 | **PASS** |
| 7 | Survey privacy (manual invitation, token completion, neutral duplicate block, HR view, Privacy Officer read-only, manager/IT/Finance/SYSTEM_ADMIN denied, small-group suppression, no free text in ordinary exports) | stage2-flows Sc3; stage4-flows Sc7; reporting integration tests | **PASS** |
| 8 | Notification outbox (one record per approval; worker capture; CAPTURED/SUBMITTED never DELIVERED; duplicate run sends nothing; retryable backoff; dead-letter; manual-send cancels pending dispatch; exception feed; masked destinations) | stage4-flows Sc1; uat-scenarios UAT-1; stage4Outbox integration X.1-X.11 (fault injection) | **PASS** |
| 9 | BambooHR fixture reconciliation (sync; source change updates source records only; approved snapshots never change silently; differences reported; HR decides corrections) | stage4-flows Sc4; bamboohr integration tests | **PASS** |
| 10 | User deactivation (live session revoked at once, sign-in refused, orphaned assignment flagged, HR reassigns, audit complete) | uat-scenarios "UAT-10" (two live browser sessions) | **PASS** |
| 11 | Outage and manual fallback (declare; FB-references; one-time reconciliation; duplicate prevention; closure gated on full reconciliation) | uat-scenarios "UAT-11" | **PASS** |
| 12 | Backup and restore (pg_dump; checksum; restore into isolated DB; critical-table verification incl. cases/snapshots/documents/attestations/surveys/workflows/tasks/assets/clearance/audit) | stage4-flows Sc6; backup integration test | **PASS** |
| 13 | Reports and exports (catalogue; cohort/purpose filters; TRAINING/TEST excluded from operational defaults; restricted exclusion; suppression; CSV formula-injection protection; audited exports; no unintended personal data) | stage4-flows Sc7; acceptance-flows J.6+J.8; reporting/csv integration + unit tests | **PASS** |
| 14 | Pilot readiness and suspension (gates show real blockers; TRAINING activation; BASELINE untouched; suspension stops new automated work; evidence preserved; rollback guidance visible) | stage4-flows Sc3; pilot integration tests X.16-X.19 | **PASS** |

Per-run detail (tester, steps, timings, traces) is retained by Playwright in
`test-results/` and the gitignored `artifacts/` evidence set; each listed
test IS the executable step record.

## 5. Defects found

| ID | Severity | Description | Resolution |
| --- | --- | --- | --- |
| UAT-D1 | **HIGH** | Maker-checker on document approval compared the approver against the mechanical DRAFT CREATOR. `supersedeAndRecreate` (and the automatic supersede after an audited case correction) creates the corrected draft under the superseding HR Manager - so in a single-HR-Manager organization (the pilot reality) the corrected document could NEVER be approved: the correction journey deadlocked. | **FIXED.** Additive migration `20260730171234_uat_document_submitter_maker_checker` records `submittedById`; approval now rejects the user who VALIDATED AND SUBMITTED the version (fallback to creator for legacy rows). Two distinct humans are still required on every approval - the control is preserved, verified in both directions by new integration tests ("submitter can never also approve" + single-manager supersede flow) and E2E UAT-4. |
| UAT-D2 | LOW | Outage status badge/hint wording ("DECLARED" badge next to a "Declared <time>" hint) is visually duplicative on the continuity page. | Retained (cosmetic); recorded for later prioritization. |
| UAT-D3 | LOW | `scripts/perf-seed.ts` (new in this directive) had two authoring errors caught during the run (invalid cohort literal; notification branch parity). | Fixed in the script itself; no application impact. |

No BLOCKER defects were found. No MEDIUM defects remained open: the only
non-cosmetic finding was UAT-D1 (fixed + retested). Test-design errors made
by the UAT author (wrong locators, wrong role choreography that the
application CORRECTLY refused) are not application defects; notably, the
application correctly refused a manager approving a document they had
themselves submitted - that control refusal was verified and kept.

## 6. Retest results

After the UAT-D1 fix: stage2Documents integration 12/12 (including the two
new maker-checker tests), uat-scenarios 4/4, uat-visual 1/1, and the full
J-section validation sweep below all pass.

## 7. Visual and accessibility outcome

- Desktop (1280) + mobile (375): already covered by the acceptance/stage
  visual suites (axe WCAG 2.1 A/AA, zero critical/serious; overflow ≤ 1px;
  keyboard + 200% zoom spot-checks) - re-run in this directive's full sweep.
- Tablet (768×1024), added this directive (`e2e/uat-visual.spec.ts`):
  dashboard, case list, reports, pilot, continuity, department queue and
  health - zero critical/serious axe violations, zero horizontal overflow;
  screenshots in gitignored `artifacts/uat/`.
- Jamaica-timezone timestamps, development warnings and role-scoped
  navigation verified in the journeys themselves.

## 8. Performance smoke (section G)

Volume: `scripts/perf-seed.ts` created **500 synthetic TEST cases through
the real service layer in 23 s** (250 activated with full task/asset sets,
50 with document drafts), on top of the existing acceptance data. Dev-server
timings (production builds are faster); bound 20 s, no timeouts:

| Surface | ms |
| --- | --- |
| Dashboard | 727 |
| Case list p1 / p2 | 554 / 395 |
| Exception feed | 689 |
| Report: volume trend / task SLA | 379 / 197 |
| Outbox monitor | 210 |
| Pilot gates | 560 |
| CSV export (audited) | 1766 |
| IT queue (mine / all) | 580 / 537 |
| Worker stage-3 sweep (200 active instances re-evaluated) | 3806 |
| Worker outbox pass | 6 |

No N+1 explosion or obvious bottleneck observed; the worker sweep fits
comfortably inside its 60-second interval. This is a local smoke, NOT a
production load certification.

Isolation note: the volume data is disposable. It floods the exception feed
and reuses fixture employees, so the development database was reset (the
documented DEVELOPMENT.md procedure) after the measurements and before the
final acceptance-suite validation run; `scripts/perf-seed.ts` carries the
same warning. The observation that 500 extra cases change first-page/count
assertions in the acceptance suites is expected test-fixture behaviour, not
an application defect.

## 9. Container-build outcome (section H)

Docker and Podman remain unavailable on this workstation (verified
2026-07-30); no system software was installed. Container verification is the
one remaining external check and blocks production deployment readiness -
not synthetic UAT. Exact CI commands:

```bash
docker build -f Dockerfile.web    -t exit-web:candidate .
docker build -f Dockerfile.worker -t exit-worker:candidate .
docker run --rm --entrypoint id exit-web:candidate        # expect non-root "app"
docker run --rm --entrypoint id exit-worker:candidate     # expect non-root "app"
# fail-closed proof: production env WITHOUT live providers must refuse to start
docker run --rm -e NODE_ENV=production -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e DATABASE_URL=postgresql://exit_app:x@db:5432/exitplatform exit-web:candidate; test $? -ne 0
# stack smoke against an ISOLATED synthetic database, then:
curl -f http://localhost:3000/api/health && curl -f http://localhost:3000/api/ready
```

## 10. Unresolved limitations

- Container images authored but unbuilt locally (above).
- Stakeholder (human) UAT sign-off outstanding; `readiness.uatPassed` must
  stay unset until the HR Manager signs the plan results.
- Live email/identity/BambooHR/storage/scanner remain fail-closed synthetic
  boundaries - deliberately untested against real endpoints.
- Performance smoke is dev-mode and local only.
- UAT-D2 cosmetic wording retained.

## 11. Remaining pilot prerequisites

Unchanged from the Stage 4 record: Azure app + consent + sender mailbox and
written email authorization; OIDC provider; BambooHR read-only identity +
written authorization; S3 bucket + scanner endpoint; production secrets
custody (DATA_KEY etc.); Privacy Officer approval of retention/DSR
schedules; hosting/DR decisions; container verification in CI; pilot gates +
dual approval per the Pilot Runbook.

## 12. Recommendation

**Ready for stakeholder synthetic UAT.** All 14 scenarios pass after one
HIGH defect (UAT-D1) was fixed and retested; no BLOCKER was found; visual,
accessibility and performance smokes are clean. A controlled pilot
additionally requires the named approvals and the container/CI verification
in sections 9 and 11 - none of which can be satisfied from this workstation.
