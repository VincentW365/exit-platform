# Stage 1 Acceptance Report

**Directive:** 1.1 - Stage 1 acceptance audit, security hardening, and visual QA
**Commit under review:** `46b607c` - feat: establish secure offboarding foundation and baseline capture
**Audit performed:** 2026-07-29 (local, synthetic data only)
**Verdict:** **PASS - final Stage 1 technical acceptance recommended** (business gate remains with stakeholders; see section 21).

## 1. Scope of the audit

Independent re-verification of the Stage 1 foundation from a clean Git
worktree, plus hardening corrections limited strictly to Stage 1 behaviour:
local-database authentication and privilege separation, production fail-closed
guards, CSV export hardening, attachment-boundary hardening, an authorization
matrix across all eight roles, restricted-case non-disclosure, visual QA and
accessibility. No Stage 2+ functionality was implemented.

## 2. Files and modules inspected

All of `packages/config`, `packages/domain`, `packages/db` (schema, migration
SQL, services, tests), `apps/web` (auth/session, proxy, actions, routes, UI),
`apps/worker`, `e2e/`, the migration `20260729011428_stage1_foundation`, the
grants script, and the repository/manifest hygiene state. Inspection evidence
for section A of the directive is recorded in the final response of the
directive run.

## 3. Clean-worktree reproduction (section B)

A temporary worktree at `46b607c` (outside the repository, nothing copied from
the main tree except a fresh `.env` with locally generated secrets, per the
documented setup):

| Step | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS (13s, warm store; lockfile authoritative) |
| Node/pnpm requirements identified | `engines.node >=24`, `packageManager pnpm@10.33.0` |
| Migration from ZERO on an empty database | PASS (single migration applies cleanly) |
| Same migration valid on existing Stage 1 DB | PASS (`migrate status`: up to date) |
| Synthetic seed | PASS |
| Schema drift (`prisma migrate diff --from-config-datasource --to-schema … --exit-code`) | **No difference detected** (worktree AND main) |
| format:check | **FAIL initially - Defect D-1** (see section 18), PASS after fix |
| lint / strict typecheck | PASS |
| Unit tests | 70/70 PASS |
| Integration tests (fresh test DB) | 36/36 PASS |
| Production build | PASS |
| E2E critical path | 1/1 PASS |
| Worker smoke | PASS (heartbeat, `enabledAutomationFlags: 0`) |
| Untracked-file dependence | None beyond the documented `.env` local secrets |

The worktree was removed after evidence collection.

## 4. Fresh-database migration

The hardened cluster was created empty; `exitplatform_dev`, `exitplatform_test`
and the two verify databases each received the full migration from zero
followed by the least-privilege grants. `prisma migrate status`: up to date;
drift: none.

## 5-6. Database roles, privileges, and the trust-to-SCRAM correction

**Before:** single superuser `exitplatform`, `trust` authentication on
loopback, data directory inside the worktree (`data/pg17`, gitignored).

**After (section C):**

- cluster relocated to `..\hr-offboarding-local-runtime\postgres\data`
  (outside any Git worktree; path configurable);
- `listen_addresses = '127.0.0.1'`, port 5433; `pg_hba.conf` contains exactly
  two rules: `host all all 127.0.0.1/32 scram-sha-256` and deliberate
  `host all all ::1/128 scram-sha-256` - **no trust rule exists**;
- passwordless and wrong-password probes verified DENIED;
- roles separated: `exit_admin` (setup only), `exit_migrate` (schema owner,
  migrations/seed/test harness), `exit_app` (runtime; per-table
  SELECT/INSERT/UPDATE, INSERT-only on `audit_event`,
  `case_status_history`, `employee_snapshot`, `case_note`; **no DELETE, no
  DDL anywhere**); grants are codified in `scripts/db/grants.sql` and applied
  by the integration-test harness so tests exercise the real permission model;
- generated 28-character passwords exist only in the gitignored `.env`;
  `.env.example` carries placeholders;
- the old trust cluster was deleted; no Windows service was created;
- runs on demand via `pg_ctl` (start/stop/reset/recovery in DEVELOPMENT.md).

## 7 & 19. Production fail-closed guards (section D)

Verified against the **running production build**, not just development:

| Guard | Evidence |
| --- | --- |
| `ALLOW_DEV_LOGIN=true` + production | **Process exits at startup** (instrumentation hook); port not listening; `FATAL: ALLOW_DEV_LOGIN=true is not permitted when NODE_ENV=production` |
| `SCAN_MODE=dev-passthrough` + production | **Process exits at startup**; `FATAL: SCAN_MODE=dev-passthrough is not permitted in production` |
| Production `/signin` | 200; shows "Single sign-on is not configured"; **zero dev-login buttons, zero synthetic identities in HTML** |
| No production scanner configured (`SCAN_MODE=disabled`) | every upload stays `PENDING` (quarantined, not downloadable) - integration-tested |
| Feature flags | default disabled in schema and seed; worker heartbeat asserts `enabledAutomationFlags: 0`; BASELINE cohort and TRAINING/TEST purpose additionally hard-block automation in `automationPermitted` (unit-tested) |
| Seed/reset utilities | CLI-only (`tsx src/seed.ts`); no HTTP route exists; integration `resetDb` requires the schema-owner role on the test DB |
| Sessions | HttpOnly, SameSite=Lax, Secure in production, idle (30m) + absolute (12h) expiry, secret >= 32 chars enforced at startup, roles re-resolved from DB per request, logout deletes the cookie (E2E J.9: post-logout protected routes 401/redirect) |
| Request protections | every mutation is a POST server action (Next origin-checked); GET performs no state change; service-layer authorization on every read/mutation (matrix, section 8) |
| Redirect feedback | carries only fixed status sentences and validation phrasing - no employee names, ids, emails, tokens or document names (case numbers are non-personal opaque ids) |

## 20. Production CSP / headers (verified via HTTP on the production server)

```text
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic';
  style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self';
  frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'
X-Content-Type-Options: nosniff          X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
Cache-Control: no-store, private         X-Robots-Tag: noindex, nofollow
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

- **No `unsafe-eval`. No wildcard sources. No `unsafe-inline` for scripts** -
  scripts carry the per-request nonce (verified present in served HTML).
- `style-src 'unsafe-inline'` is the single retained exception: the UI uses
  style attributes, to which nonces cannot apply. Documented and deliberate.
- Exports and attachment downloads additionally send `Cache-Control: no-store`
  and attachment disposition.

## 8. Role-by-surface authorization matrix (section E)

Executed as automated integration tests (`authzMatrix.test.ts`) at the service
layer - the single server-side authorization choke point. ✔ = allowed,
✖F = FORBIDDEN, ✖N = NOT_FOUND (indistinguishable from non-existence).

| Surface | HR_MGR | HR_OFF | IT | FIN | LINE | AUDITOR | PRIVACY | SYSADMIN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Case list | ✔ | ✔ | ✖F | ✖F | ✖F | ✔ᵐ | ✔ᵐ | ✖F |
| Employee search | ✔ | ✔ | ✖F | ✖F | ✖F | ✖F | ✖F | ✖F |
| Case create | ✔ | ✔ | ✖F | ✖F | ✖F | ✖F | ✖F | ✖F |
| Normal case detail | ✔ | ✔ | ✖N | ✖N | ✖N | ✔ʳ | ✔ʳ | ✖N |
| Restricted case detail (unassigned) | ✖N | ✖N | ✖N | ✖N | ✖N | ✖Fᵈ | ✖Fᵈ | ✖N |
| HR dashboard | ✔ | ✔ | ✖F | ✖F | ✖F | ✖F | ✖F | ✖F |
| Baseline dashboard | ✔ | ✔ | ✖F | ✖F | ✖F | ✖F | ✖F | ✖F |
| Baseline CSV export | ✔ | ✔ | ✖F | ✖F | ✖F | ✖F | ✖F | ✖F |
| Global audit feed | ✖F | ✖F | ✖F | ✖F | ✖F | ✔ʳ | ✔ʳ | ✖F |
| Case audit timeline (normal) | ✔ | ✔ | ✖N | ✖N | ✖N | ✔ʳ | ✔ʳ | ✖N |
| Attachment metadata (normal) | ✔ | ✔ | ✖N | ✖N | ✖N | ✔ʳ | ✔ʳ | ✖N |
| Approve mutation | ✔ | ✖F | ✖N | ✖N | ✖N | ✖F | ✖F | ✖N |
| Admin users/roles | ✖F | ✖F | ✖F | ✖F | ✖F | ✖F | ✖F | ✔ |

ᵐ oversight discovery of restricted rows is minimized: `(restricted case)`
placeholder, no employee identity, department, or dates.
ʳ read-only. ᵈ discovery allowed as documented oversight, content refused
until explicitly assigned as a participant.
PRIVACY_OFFICER holds exactly the documented oversight authority - no case
creation, approval, editing or export (Directive 0.1 B preserved).

## 9. Restricted-termination non-disclosure

Integration + E2E verified: unassigned actors receive NOT_FOUND on direct URL
(identical to a non-existent id); restricted cases are absent from lists,
name search, dashboard totals (manager-vs-officer count differential equals
exactly the restricted case), baseline dashboard, CSV exports (row content
tested to exclude the restricted employee), and duplicate-warning text
(Defect D-2 fix); denied-access audit rows carry ids only. An explicitly
assigned HR officer gains access, and that assignment is itself audited.
E2E additionally proves IT/SYSTEM_ADMIN direct-URL probes and auditor
minimized rows in the UI.

## 10. Baseline export security (section F)

- New `csvCell`/`csvNumber`/`csvIso` encoder: text cells beginning with
  `=`, `+`, `-`, `@`, TAB, CR or LF are neutralized with a leading apostrophe
  **and** CSV-quoted; quotes/delimiters/line breaks escaped; numeric and ISO
  date values stay typed (negative numbers proven uncorrupted).
- Unit-tested against the directive's payloads including
  `=HYPERLINK(...)`, `+CMD`, `-1+2`, `@SUM(1,1)`, and TAB-prefixed formulas.
- Export contains only the approved baseline fields (case number, type,
  status, timestamps, missing-reason codes) - no free text, no employee name.
- TRAINING/TEST records excluded by construction; no option exists to include
  them (an explicit authorized include-synthetic option can be added when a
  need is approved); restricted cases excluded from rows/totals for
  unauthorized exporters; filename is the fixed `baseline-export.csv`.
- Every export audited with actor, correlation id, fixed filter criteria,
  cohort, purpose, row count, export type - never row content.
- `text/csv; charset=utf-8`, `Content-Disposition: attachment`, `no-store`.

## 11. Attachment security (section G)

Allow-list (pdf/png/jpg/jpeg) with extension + declared MIME + magic-byte
agreement; size cap enforced before storage; system-generated 48-hex object
keys (no employee/file name material); private storage outside any web root;
downloads only via the authorized API route with attachment disposition;
CLEAN-only serving with checksum verification. Tested: double extensions,
path traversal, RTLO/control-character filenames (new validation - Defect
D-3), empty and oversized files, MIME mismatch, executable-content polyglots,
unauthorized download (NOT_FOUND), quarantined download, REJECTED download,
checksum-mismatch download. All uploads/downloads/denials audited without
file contents.

## 12. Audit integrity

Three independent layers, all tested: (1) service layer has no update/delete
path; (2) database triggers reject UPDATE/DELETE on `audit_event` and DELETE
on cases/status history and any mutation of `employee_snapshot`; (3) the
runtime role lacks the SQL privileges entirely. `runtimePrivileges.test.ts`
proves as `exit_app`: UPDATE audit ✖, DELETE audit ✖, DISABLE TRIGGER ✖,
ALTER TABLE ✖, DROP ✖, DELETE case ✖, DELETE history ✖, snapshot
UPDATE/DELETE ✖, TRUNCATE ✖, self-GRANT gains nothing, CREATE TABLE ✖ -
while its legitimate read/insert work still succeeds.

## 13. Domain invariants (section H)

- Cohort/purpose: exactly BASELINE/PILOT/POST_ROLLOUT and
  OPERATIONAL/TRAINING/TEST; OPERATIONAL requires a cohort, TRAINING/TEST
  forbid one - enforced at schema validation, service, and a database CHECK
  constraint; TRAINING/TEST excluded from dashboards/exports and cannot
  activate automation (unit + integration + E2E).
- Epoch guard: null/empty/invalid dates now REJECT rather than coercing to
  1970 (`schemas.test.ts`); the Directive-1 fix is regression-tested.
- Snapshot exactly once at approval; immutable at three layers; corrections
  (effective time, record purpose, rehire) produce history + audit evidence.
- No hard delete of cases/history at any layer; case-number uniqueness under
  concurrency; racing approvals produce exactly one snapshot and one clean
  CONFLICT loser.
- **Maker-checker (authoritative rule, not invented):** StateMachines.md
  assigns PENDING_HR_REVIEW → APPROVED to HR_MANAGER; HR_OFFICER cannot
  approve (tested). No approved rule forbids a manager approving a case they
  created; a test documents that this is currently permitted. If stakeholders
  want four-eyes on manager-created cases, that is a business decision for
  the Decision Register.
- Timestamps stored UTC, displayed America/Jamaica; calendar tests cover
  weekend, synthetic holiday, consecutive holidays, year boundary,
  no-DST invariance (June/December offsets identical), changed effective
  date with audited old/new provenance.

## 14. Accessibility result (section I)

Automated axe scans (WCAG 2.1 A/AA tag set) on sign-in, dashboard, case list,
create case, review step, case overview, baseline, admin, audit feed,
unauthorized and not-found pages: **0 critical, 0 serious violations** after
correcting one serious color-contrast defect (D-6). Keyboard-only navigation
spot-checked (skip link, focus order, Enter activation); 200%-zoom-equivalent
viewport keeps all functions with no horizontal overflow; status is conveyed
with text labels, never colour alone; unauthorized/not-found wording explains
without disclosing.

## 15-16. Visual QA result and screenshots

30 screenshots (desktop 1280px + mobile 375px) captured to the gitignored
`artifacts/stage1-acceptance/` (synthetic data only): signin, HR dashboard,
case list, create case, review/submit, approved case overview, audit
timeline, baseline dashboard + export control, attachment area, admin,
unauthorized, not-found, restricted case as authorized (14a) and unauthorized
(14b) viewers. Automated checks assert no horizontal overflow at either
width; tables scroll within their own containers; development-mode and
baseline-automation banners are prominent; destructive actions (cancel/void)
sit behind expanding disclosures with required reasons.

## 17. Tests and exact counts (final run)

| Suite | Count | Result |
| --- | --- | --- |
| Unit (`pnpm test:unit`) | **84** | all pass |
| Integration (`pnpm test:int`, fresh hardened test DB) | **66** | all pass |
| E2E (`pnpm e2e`: critical path + 6 acceptance flows + visual/axe sweep) | **9** | all pass |
| format:check / lint / strict typecheck / production build / frozen install | - | all pass |

## 18. Defects found and corrected

| # | Severity | Defect | Correction |
| --- | --- | --- | --- |
| D-1 | Medium (reproducibility) | `.gitattributes` did not cover `*.css`; a fresh CRLF checkout failed `format:check` | eol=lf added for css/sql/toml/svg/example; verified on the new commit's worktree |
| D-2 | **High (disclosure)** | Duplicate-case warning revealed the case number/status of restricted cases to actors who may not discover them | Duplicate query now applies the actor's visibility predicate |
| D-3 | Medium | Filenames accepted control/bidirectional-override characters (RTLO extension spoofing) | Validation rejects U+0000-U+001F, U+007F, LRM/RLM and bidi override/isolate characters; tested |
| D-4 | Medium | CSV export had quoting but no spreadsheet-formula neutralization | `csvCell` neutralizer + typed numeric/date encoders + tests |
| D-5 | **High (config integrity)** | `updateDraftAction` sent null for form fields not present, silently clearing stored values (e.g. measurement cohort) on any draft edit | Action patches only posted fields; free-text clears remain deliberate; regression covered by E2E J.3 |
| D-6 | Serious (accessibility) | Success/warning status colours failed WCAG 1.4.3 contrast on tinted backgrounds | Tokens darkened (#116329 / #7a5200); axe re-scan clean |
| D-7 | Medium (hardening) | Local dev DB used trust auth, one superuser, data dir inside worktree | Full section C hardening (SCRAM, role separation, relocation, denial tests) |
| D-8 | Low | Config-guard violations surfaced on first request, not at startup; a failed prepare could leave the port held | `instrumentation.ts` validates at boot and hard-exits |
| D-9 | Low | Dev CSP triggered React eval warnings; prod CSP used `unsafe-inline` scripts | Per-request nonce CSP with strict-dynamic in production |

## 19. Known limitations retained (unchanged, documented)

Redirect-parameter feedback (safe text only); style-attribute
`unsafe-inline` in style-src; no real malware scanner (uploads quarantine
outside dev-passthrough); worker is a heartbeat skeleton; general
field-correction UI beyond the audited corrections is later-stage scope.

## 20. Repository hygiene

Tracked files: source, docs, config and the migration only. No `.env` values,
database files, uploads, screenshots, logs, Office files, DMAIC source,
credentials, keys or secrets are tracked or staged; `artifacts/` is
gitignored. A secret-pattern scan over tracked content found nothing.

## 21. Unresolved decisions (unchanged by this directive)

OPEN: DEC-014, DEC-015, DEC-017, DEC-020, DEC-021, DEC-022, DEC-023,
DEC-024, DEC-025, DEC-028, DEC-029, DEC-031, DEC-033.
PROVISIONAL: DEC-001..013 (others), DEC-016, DEC-018, DEC-019, DEC-026,
DEC-027, DEC-030, DEC-032, DEC-034, DEC-035 - statuses exactly as recorded in
`DecisionRegister.md`; no approval boxes were marked. Stage 1 constraints
IC-S1-001..011 continue to govern; pilot/production use remains blocked on
the business gate.

## 22. Data and integrations statement

No real employee data was used anywhere; all identities, cases, holidays and
reason categories are clearly synthetic. No live HR, identity, email,
storage, payroll, benefits, BambooHR or any other company business system was
called. Network access was limited to the npm registry (dependency
verification, `pg` and `@axe-core/playwright` needed for directive-mandated
checks) and the Playwright browser CDN (already cached).

## 23. Recommendation

**Final Stage 1 technical acceptance: RECOMMENDED.** All directive checks
pass; the two high-severity defects found by this audit are corrected and
regression-tested. Directive 2 remains blocked by its own preconditions:
approved document wording/formats, digital-attestation decision DEC-025
(OPEN), and the Stage 1/2 stakeholder approvals - none of which are technical
matters.
