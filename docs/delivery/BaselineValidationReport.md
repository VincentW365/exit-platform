# Baseline Validation Report

**Directive:** 0 — Documentation import and baseline validation
**Baseline version:** 0.1
**Validated:** 2026-07-28
**Validator:** Claude, acting as bounded implementation engineer under `CLAUDE.md`
**Outcome:** Package is structurally sound and internally consistent.
**Updated:** 2026-07-28 by Directive 0.1 — all eight findings are now resolved or reconciled.

---

## 0. Directive 0.1 reconciliation status

Directive 0 recorded eight findings. Directive 0.1 reconciled them all. This report retains the original findings as the audit record and appends a **Resolution** line to each.

| Finding | Original severity | Status after Directive 0.1 |
| --- | --- | --- |
| F-01 Source DMAIC in repository | High — privacy | **Resolved** — moved outside the working tree |
| F-02 Role model 8 vs. 7 | Blocks Directive 1 | **Resolved** — `PRIVACY_OFFICER` restored |
| F-03 Cohort enum 3 vs. 5 | Blocks Directive 1 | **Resolved** — split into two dimensions |
| F-04 Case state name | Non-blocking | **Resolved** — `APPROVED` is authoritative |
| F-05 Directive 2 decisions | Quality | **Resolved** — corrected decision set |
| F-06 Directive-to-stage mapping | Quality | **Resolved** — mapping table added |
| F-07 Stray duplicate file | Hygiene | **Resolved** — duplicate removed |
| F-08 Line-ending drift | Hygiene | **Resolved** — `.gitattributes` added |

### Git author identity — provisional and unverified

> **The initial commit author identity is provisional.** Commit `f425ecb` was authored as `Vincent Wilson <vincentclaude@bertsautoparts.com>` using a repository-local Git configuration, because no Git identity was configured on the machine.
>
> **The email address has not been confirmed by the project owner.**
>
> - No remote push should occur until the project owner provides an approved corporate Git email.
> - The initial commit author should then be amended before the first push.
> - **No identity amendment is authorized during Directive 0.1.** The existing commit and history are preserved unchanged.
>
> Amending author identity after a push rewrites history for everyone who has cloned the repository, so the correction must happen before the first push or not at all.

---

## 1. Repository condition before work

| Item | Finding |
| --- | --- |
| Git repository | None. No `.git` directory existed. |
| Application code | **None.** No `package.json`, `tsconfig.json`, `prisma/`, `apps/`, `packages/`, `src/`, `node_modules/`, `Dockerfile` or CI configuration. |
| Content | 53 Markdown files, 1 `.docx`, 1 `.gitignore`. |
| Package integrity | All 52 `PACKAGE_MANIFEST.md` checksum rows recomputed and matched. The package is unmodified since construction. |

No application stack was installed and no application code was written.

## 2. Files inspected

**Read in full (11):** `README.md`, `Project.md`, `CLAUDE.md`, `START_HERE_FOR_CLAUDE.md`, `PACKAGE_MANIFEST.md`, `docs/INDEX.md`, `docs/requirements/DecisionRegister.md`, `docs/requirements/StakeholderApprovalChecklist.md`, `docs/requirements/RolesAndPermissions.md`, `docs/delivery/ClaudeBuildDirectives.md`, `docs/delivery/Roadmap.md`, `docs/delivery/TestStrategy.md`, `.gitignore`.

**Machine-validated (all 53 Markdown files):** every file in the package was parsed for identifier definitions, cross-references, link targets, code-fence balance, heading structure and sensitive-data patterns. Targeted extracts were additionally reviewed from `RequirementsCatalogue.md`, `RequirementsTraceabilityMatrix.md`, `BusinessRules.md`, `MetricsDictionary.md`, `DataDictionary.md`, `StateMachines.md`, `AuditEventCatalogue.md`, `SecurityVerificationChecklist.md`, `UserStoriesAndAcceptanceCriteria.md`, `RiskRegister.md`, `PilotAndRolloutPlan.md`, `WorkflowDesign.md` and `PRD.md`.

The source `.docx` was **not** opened or parsed, to avoid drawing personal data into the working context.

## 3. Checks performed and results

| # | Check | Result |
| --- | --- | --- |
| 1 | Identifier uniqueness (8 families) | **PASS** — no duplicates in any family |
| 2 | Identifier counts vs. published statistics | **PASS** — all 8 match exactly |
| 3 | Identifier sequence gaps | **PASS** — no gaps |
| 4 | Dangling cross-references (ID cited but never defined) | **PASS** — 0 dangling |
| 5 | Inline relative Markdown links | **PASS** — package uses backticked paths, not inline links |
| 6 | Backticked `.md` path references resolve | **PASS** — 111 checked, 0 unresolved |
| 7 | Code-fence balance | **PASS** — all 53 files balanced |
| 8 | Heading-level jumps | **PASS** — none |
| 9 | Duplicate headings within a file | **PASS (benign)** — repeats are intentional template sub-sections |
| 10 | Requirements traceability coverage | **PASS** — RTM maps all 313 requirements 1:1 |
| 11 | Manifest checksum verification | **PASS** — 52/52 match |
| 12 | Sensitive-data pattern scan | **PASS** — 0 hits |
| 13 | Decision status consistency (register vs. checklist) | **PASS** — no drift across all 35 |
| 14 | KPI target consistency (README / Project.md / MetricsDictionary) | **PASS** |
| 15 | Files on disk not covered by manifest | **REVIEW** — see F-01 and F-07 |
| 16 | Approved/provisional artefact contradictions | **FAIL** — see F-02, F-03, F-04 |

### Verified identifier counts

| Family | Defined | Unique | Published | Status |
| --- | --- | --- | --- | --- |
| `REQ-*` requirements | 313 | 313 | 313 | match |
| `BR-*` business rules | 103 | 103 | 103 | match |
| `DEC-*` decisions | 35 | 35 | 35 | match |
| `KPI-*` metrics | 13 | 13 | 13 | match |
| `US-*` user stories | 40 | 40 | 40 | match |
| `R-*` risks | 35 | 35 | 35 | match |
| Audit event types | 95 | 95 | 95 | match |
| `SEC-*` security checks | 84 | 84 | 84 | match |

### Requirement status distribution

295 `PROVISIONAL`, 18 `OPEN`. Two `OPEN` requirements sit in Stage 1: **REQ-SEC-001** (Production SSO) and **REQ-ADMIN-007** (Reason taxonomy).

## 4. Findings

### F-01 — Source DMAIC present in the repository and not excluded from commits *(blocker, corrected)*

**Severity:** High — privacy control failure.

`DMAIC HR Offboarding Process .docx` (794,280 bytes) sits in the repository root. The original `.gitignore` did not exclude it, so a routine `git add -A` would have committed real personal data, signatures and screenshots.

This directly contravenes three approved controls: `README.md` "Sensitive-source warning"; `CLAUDE.md` rule 7 and "Sensitive data"; and Directive 0's own "DO NOT copy the source DMAIC into the repository".

**Correction applied:** `.gitignore` now excludes Office document formats, with a comment citing the governing sections. The file was **not** committed. See §6.

**Action still required by the owner:** move the `.docx` out of the repository tree entirely to a company-controlled location. Ignoring it prevents commits but does not remove it from the working directory, where it remains exposed to backup, sync and search tooling.

**Resolution (Directive 0.1 §A.3):** the file was **moved** — not copied, not deleted — to `../hr-offboarding-sensitive-source/`, a sibling folder outside the Git working tree. Filename, byte size (794,280) and SHA-256 were verified identical after the move. A "do not commit" marker document was placed alongside it in that folder, explaining the handling rules. That marker lives outside the repository and is deliberately not a repository file. No Office document of any type (`.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`) now exists under the repository root, and none is tracked or staged. The ignore rules remain in `.gitignore` as defence in depth, with `*.ppt` added to close a gap in the original correction.

### F-02 — Role model contradiction: 8 approved roles vs. 7 in Directive 1 *(blocks Directive 1)*

`RolesAndPermissions.md` and `PRD.md` define **eight** roles: `HR_MANAGER`, `HR_OFFICER`, `IT_RESPONDER`, `FINANCE_RESPONDER`, `LINE_MANAGER`, `AUDITOR`, `PRIVACY_OFFICER`, `SYSTEM_ADMIN`. `README.md` also states eight.

Directive 1 ("AUTHENTICATION AND AUTHORIZATION", item 3) instructs implementation of **seven**, omitting `PRIVACY_OFFICER`.

This is not cosmetic. `PRIVACY_OFFICER` carries defined record-level rules in the approved role model — notably identifiable exit-response access and retention/legal-hold configuration authority. Building the Stage 1 role enum from Directive 1 would omit a role the approved authorization model depends on, and the omission would propagate into the database enum, policy layer and authorization test matrix.

**Not corrected in Directive 0.** Roles are explicitly reserved from unilateral change by `CLAUDE.md` and by the directive's own constraints.

**Resolution (Directive 0.1 §B):** Directive 1 now names all eight roles including `PRIVACY_OFFICER`, and carries an explicit scope boundary: the role covers privacy, retention, disclosure, access review, data-subject and unauthorized-access oversight, and must **not** receive authority to create ordinary cases, approve resignations or terminations, alter final-pay details, edit exit responses, or perform ordinary HR case processing. The restrictions in `RolesAndPermissions.md` are preserved and the role is not broadened into routine HR operations. Directive 10's UAT participant list now also includes the privacy officer. `RolesAndPermissions.md`, `PRD.md`, `InformationArchitecture.md`, `ScreenInventory.md` and `TestStrategy.md` already covered the role and needed no change.

### F-03 — Cohort enum contradiction: 3 values vs. 5 *(blocks Directive 1)*

| Source | Cohort values |
| --- | --- |
| `DataDictionary.md` (`OffboardingCase.cohort`) | `BASELINE, PILOT, POST_ROLLOUT` |
| `REQ-CASE-013` (Stage 1, MUST) | `BASELINE, PILOT, POST_ROLLOUT` |
| `BR-CASE-013`, `MetricsDictionary.md`, `DEC-007` | `BASELINE, PILOT, POST_ROLLOUT` |
| `PilotAndRolloutPlan.md` §2 | adds `TRAINING`, `TEST` |
| Directive 1 "BASELINE MODE" | adds `TRAINING`, `TEST` |

Directive 1 says "Support BASELINE, PILOT, POST_ROLLOUT, TRAINING and TEST cohorts **as specified**", but the field specification it would be implemented against specifies only three.

The two readings are plausibly reconcilable — `TRAINING` and `TEST` are excluded from all operational reporting, which may be why the analysis-cohort artefacts list only three — but the conflict lands directly on a Stage 1 database enum and an immutable, audited field. Per `CLAUDE.md`, this is recorded rather than resolved.

**Not corrected in Directive 0.** Requires a Decision Register entry or an amendment to `DataDictionary.md` and `REQ-CASE-013`.

**Resolution (Directive 0.1 §C):** the conflict was a conflated concept, not a disagreement about values. It is resolved by separating one enum into two dimensions — **no five-value cohort enum exists anywhere**:

| Dimension | Values | Meaning |
| --- | --- | --- |
| `measurement_cohort` | `BASELINE`, `PILOT`, `POST_ROLLOUT` | Business-analysis dimension. Required on `OPERATIONAL` records. |
| `record_purpose` | `OPERATIONAL`, `TRAINING`, `TEST` | Data-use dimension. Set at record creation. |

`TRAINING` and `TEST` are record purposes, never business cohorts. They must be synthetic, must carry no measurement cohort, must never reach a live integration, and are excluded from all business reporting. Reports default to `record_purpose = OPERATIONAL`. Neither dimension may be silently reassigned: measurement cohort follows the audited-correction rule, and record purpose may change only by authorized, reasoned, audited correction before operational use.

`REQ-CASE-013` was preserved and extended in place rather than duplicated, keeping its ID and its three-value measurement cohort. Reconciled across `DataDictionary.md`, `RequirementsCatalogue.md` (`REQ-CASE-013`, `REQ-REPORT-014`), `RequirementsTraceabilityMatrix.md`, `BusinessRules.md` (`BR-CASE-013`, `BR-CASE-014`), `MetricsDictionary.md`, `PilotAndRolloutPlan.md`, `ExitSurveySpecification.md` and Directives 1 and 7. No new requirement or business rule was added, so all published counts are unchanged.

### F-04 — Case state name contradiction: `APPROVED` vs. `APPROVED_OR_ACCEPTED` *(does not block Directive 1)*

`StateMachines.md` names the post-approval case state `APPROVED` throughout its diagram and transition table. Directive 4 enumerates `APPROVED_OR_ACCEPTED` — while simultaneously instructing "Use final names from the approved state specification; do not rename them for convenience without updating the baseline."

Directive 1 creates the case status enum, so the name should be settled before Stage 1 rather than discovered at Stage 3. `APPROVED_OR_ACCEPTED` appears only in `ClaudeBuildDirectives.md`; every other artefact uses `APPROVED`.

**Not corrected in Directive 0.** State names are approved architecture.

**Resolution (Directive 0.1 §D):** `APPROVED` is the single authoritative case state; `APPROVED_OR_ACCEPTED` is removed and no reference remains anywhere in the repository. The reasoning is recorded in Directive 4: "accepted" is not valid for every departure type — it is a resignation communication or document outcome, not a universal case-lifecycle state. Resignation acceptance and acknowledgement are represented through document records, document approval records, document status, communication records and communication status, never through a universal case status. The authoritative progression `DRAFT → PENDING_HR_REVIEW → APPROVED → ACTIVE → CLEARANCE_REVIEW → COMPLETED` and the controlled alternatives `ON_HOLD`, `CANCELLED`, `VOIDED`, `REOPENED` are preserved as specified in `StateMachines.md`.

### F-05 — Directive 2 cites decisions that do not match its stage *(quality, non-blocking)*

Directive 2 (controlled documents, Stage 2) instructs reading `DEC-007`, `DEC-008`, `DEC-010` and `DEC-025`. `DEC-008` is the **asset KPI model**, owned by Stage 4, with no bearing on document generation. Meanwhile the two Stage 2 decisions most relevant to controlled documents — `DEC-004` (authoritative automation model) and `DEC-005` (communication approval) — are not cited.

**Not corrected in Directive 0.** Changing which approved decisions govern a directive is substantive.

**Resolution (Directive 0.1 §E):** Directive 2 now cites the decisions that actually govern controlled documents and approvals — `DEC-004` (authoritative automation model), `DEC-005` (communication approval), `DEC-007` (baseline measurement and the prohibition on improvement automation during baseline capture), `DEC-010` (Employee Action Form approval hierarchy) and `DEC-025` (digital signatures and attestations). `DEC-008` is removed and explicitly noted as belonging to the asset-recovery stage, so it can no longer be read as a controlling document decision.

### F-06 — Roadmap-to-directive mapping is undocumented *(quality, non-blocking)*

The Roadmap defines 8 stages (0–7); `ClaudeBuildDirectives.md` defines 11 directives (0–10). Stages 2–7 each expand into two directives, but no mapping table records this. Consequently the Roadmap's "Expected local commit" strings match the directives only for Stage 0 and Stage 1; for Stages 2–7 the Roadmap names a commit message that no directive issues.

Stage 0 and Stage 1 — the only ones in play now — match exactly, so this does not block current work.

**Recommendation:** add a directive-to-stage mapping table to `Roadmap.md` or `ClaudeBuildDirectives.md`.

**Resolution (Directive 0.1 §F):** an authoritative mapping table now appears near the top of `ClaudeBuildDirectives.md` and is cross-referenced from `Roadmap.md` — Stage 0: Directives 0 and 0.1; Stage 1: Directive 1; Stage 2: Directives 2 and 3; Stage 3: Directives 4 and 5; Stage 4: Directive 6; Stage 5: Directives 7 and 8; Stage 6: Directive 9; Stage 7: Directive 10. Both documents now state that a stage may need several directives, that each directive has its own scope, exclusions, acceptance gate, tests, evidence and commit, that finishing the first directive in a stage does not finish the stage, that Claude stops after every directive for review, and that a later directive is never executed merely because an earlier one in the same stage passed. The Roadmap's "Expected local commit" column is clarified as the stage-level outcome; each directive's own COMMIT line is authoritative.

### F-07 — Stray duplicate file at repository root *(hygiene)*

A byte-identical copy of `docs/delivery/ClaudeBuildDirectives.md` (SHA-256 `eeca3428…c117a56`) appeared at the repository root during validation. It is not listed in `PACKAGE_MANIFEST.md` or `docs/INDEX.md` and is not part of the baseline.

It was **not committed** and **not deleted** — removing a file from the user's working tree is the owner's call. It appears in `git status --short` as untracked.

**Recommendation:** delete `./ClaudeBuildDirectives.md`; the canonical file is `docs/delivery/ClaudeBuildDirectives.md`.

**Resolution (Directive 0.1 §A.2):** the two files were compared by SHA-256 and byte-by-byte before any deletion — identical hash `eeca3428…c117a56`, identical length 38,490, zero differing bytes. Since the root copy held no unique material, it was removed under path A.2c. `docs/delivery/ClaudeBuildDirectives.md` is now the only canonical directive file, and `git status` is clean.

### F-08 — Line-ending normalization will break manifest checksum verification *(hygiene, non-blocking)*

Every package file uses LF endings, and the manifest's SHA-256 values are computed over LF content. Git reports `core.autocrlf=true` at system level on this machine, and no `.gitattributes` exists.

Content is committed as LF, so the repository itself is correct. But a fresh clone or checkout on Windows will materialize the working tree as CRLF, at which point **every** recomputed hash will differ from `PACKAGE_MANIFEST.md`. The manifest's own §Verification instructs exactly that recomputation, so the integrity procedure would report a false failure across all 52 rows.

**Recommendation:** add a `.gitattributes` containing `* text=auto eol=lf` so checkouts preserve LF and checksum verification stays meaningful.

**Not applied in Directive 0.** Adding a repository configuration file exceeded the corrections authorized for that directive.

**Resolution (Directive 0.1 §A.5):** a repository-level `.gitattributes` now normalizes `*.md`, `*.json`, `*.ts`, `*.tsx`, `*.js`, `*.mjs`, `*.cjs`, `*.prisma`, `*.yml`, `*.yaml` and `*.sh` to LF, keeps `*.ps1` as CRLF because some Windows PowerShell hosts are sensitive to LF-only scripts, and applies a conservative `* text=auto` default to everything else. Checkouts are now byte-stable across platforms, so hash comparison stays meaningful regardless of `core.autocrlf`. The file documents its own rationale inline.

## 5. OPEN decisions blocking Stage 1

Four of the thirteen `OPEN` decisions are marked "Before Stage 1":

| Decision | Topic | Owner | Effect on Directive 1 |
| --- | --- | --- | --- |
| **DEC-021** | Production identity provider | IT / Security | **Partial blocker.** The identity-provider *abstraction* and the guarded development login can be built without it. Binding a production IdP cannot. Directive 1 forbids inventing production SSO. Tracks `REQ-SEC-001` (Stage 1, OPEN). |
| **DEC-022** | Deployment environment | IT / Project Sponsor | **Constraint-resolvable.** Local development against PostgreSQL needs no hosting decision. Needs a written constraint deferring hosting. |
| **DEC-031** | Reason-for-leaving taxonomy | HR Manager / Process Analyst | **Hard blocker.** Directive 1 requires an "approved reason category" on the case-creation form. No taxonomy exists and Claude is forbidden from inventing HR categories. Tracks `REQ-ADMIN-007` (Stage 1, OPEN). |
| **DEC-033** | Historical migration | Project Sponsor / HR Manager | **Constraint-resolvable.** Migration is outside Directive 1 scope. Needs a written "no migration in Stage 1" constraint. |

Seven further Stage 1 decisions remain `PROVISIONAL` and unconfirmed: **DEC-001, DEC-002, DEC-003, DEC-007, DEC-027, DEC-032, DEC-035**. All eleven Stage 1 checklist boxes are unticked. `DEC-035` (termination confidentiality) is load-bearing for Directive 1's "restricted-by-default termination-case access with negative tests"; `DEC-027` (business-day calendar) is load-bearing for its business-calendar tests.

Decisions `OPEN` for later stages — DEC-014, DEC-015, DEC-017, DEC-020, DEC-023, DEC-024, DEC-025, DEC-028, DEC-029 — do not block Directive 1.

## 6. Personal data confirmation

No real personal data has been introduced into examples, fixtures or documentation.

- Automated scan across all 53 Markdown files for real-looking email addresses, Jamaican telephone numbers, TRN/NIS identifiers, account numbers, embedded base64 images and private-key blocks: **0 hits**.
- Synthetic conventions are used consistently: `EMP-TEST-001` … `EMP-TEST-005` with fictional names (`Avery Brown`, `Jordan Lee`, `Morgan Reed`, `Taylor Singh`, `Casey Grant`) in `TestStrategy.md`; `@example.test` addresses in template examples.
- The source `.docx` was not opened, and no content from it has entered any repository file.
- The `.docx` itself is the outstanding exposure — see **F-01**. It is excluded from version control but still present on disk.

## 7. Corrections applied

### Under Directive 0

Exactly one change was made. It is protective and non-behavioural: it alters no business rule, scope, architecture, status, target, role or decision.

| File | Change | Authority |
| --- | --- | --- |
| `.gitignore` | Added `*.docx`, `*.doc`, `*.xls`, `*.xlsx`, `*.pptx` under a commented "source DMAIC" block | `README.md` "Sensitive-source warning"; `CLAUDE.md` rule 7 and "Sensitive data"; Directive 0 "DO NOT copy the source DMAIC into the repository" |

No broken links, duplicate IDs, malformed numbering or duplicated headings were found, so no corrections of that class were needed.

### Under Directive 0.1

Directive 0.1 explicitly authorized the reconciliation of findings F-02 through F-08 and the recording of Stage 1 constraints. Those changes are documentation-only and are itemized in the delta table below and in each finding's Resolution line.

Two limits were observed throughout: **no decision status was changed**, and **no approval box was ticked**. The Decision Register still reports 13 OPEN and 22 PROVISIONAL, exactly as before.

Two further files changed as a direct product of this directive rather than as corrections: this report was created at `docs/delivery/BaselineValidationReport.md`, and `docs/INDEX.md` gained one row listing it, so the index remains complete.

### PACKAGE_MANIFEST.md is an immutable import receipt

`PACKAGE_MANIFEST.md` is the **integrity receipt for the package as originally imported**. It is deliberately not maintained as a live inventory of the repository, and its original checksum table intentionally remains unchanged.

The distinction matters:

- **`PACKAGE_MANIFEST.md` records the integrity of the originally imported package.** All 52 rows were verified to match at import, which is the evidence that the baseline arrived intact and unmodified. That fact is historical and permanent — rewriting the table would destroy it.
- **Post-import changes are governed by Git history.** Every subsequent change is authored, reviewed, committed and attributable through Git. That is the correct control for a living repository; a static hash table is not.
- **The original package checksum table is intentionally left unchanged.** Do not rewrite the original package hashes merely because the repository has legitimately changed after import. A row whose hash no longer matches is not a defect — it is evidence that the file has been deliberately changed since import, which Git already explains in detail.
- **Future repository validation should use Git status, Git history, tests and current documentation checks** rather than expecting the import receipt to match the modified repository. Re-running a whole-manifest comparison against a live repository will produce false failures and should not be treated as an integrity check.

Files that have legitimately diverged from the import receipt as a result of Directives 0 and 0.1:

| Path | Delta | Directive |
| --- | --- | --- |
| `.gitignore` | Office-file exclusions added | 0 (F-01), 0.1 (`*.ppt`) |
| `docs/INDEX.md` | Two rows added | 0, 0.1 |
| `docs/delivery/ClaudeBuildDirectives.md` | Findings F-02, F-04, F-05, F-06 and section C/G reconciliation | 0.1 |
| `docs/delivery/Roadmap.md` | Directive mapping section | 0.1 |
| `docs/delivery/PilotAndRolloutPlan.md` | Cohort/purpose split | 0.1 |
| `docs/requirements/DataDictionary.md` | Cohort/purpose fields | 0.1 |
| `docs/requirements/RequirementsCatalogue.md` | `REQ-CASE-013`, `REQ-REPORT-014` | 0.1 |
| `docs/requirements/RequirementsTraceabilityMatrix.md` | Traceability updates | 0.1 |
| `docs/requirements/BusinessRules.md` | `BR-CASE-013`, `BR-CASE-014` | 0.1 |
| `docs/requirements/MetricsDictionary.md` | Reporting default | 0.1 |
| `docs/requirements/DecisionRegister.md` | Constraint cross-reference | 0.1 |
| `docs/requirements/StakeholderApprovalChecklist.md` | "Constraints are not approvals" note | 0.1 |
| `docs/templates/ExitSurveySpecification.md` | No-send guard wording | 0.1 |
| `docs/delivery/BaselineValidationReport.md` | New file | 0, 0.1 |
| `docs/requirements/Stage1ImplementationConstraints.md` | New file | 0.1 |
| `.gitattributes` | New file | 0.1 (F-08) |

## 8. Recommended surgical corrections — all applied by Directive 0.1

Listed smallest-change-first. These were the Directive 0 recommendations; **all eight were carried out under Directive 0.1**, which authorized them. See §0 for the status summary and each finding's Resolution line for detail.

1. **F-02** — In Directive 1, add `PRIVACY_OFFICER` to the role list so it reads eight roles, matching `RolesAndPermissions.md` and `PRD.md`. *(One-line edit; requires HR/Privacy confirmation that the role is in Stage 1 scope.)*
2. **F-03** — Resolve the cohort enum to either three or five values, then align `DataDictionary.md`, `REQ-CASE-013`, `PilotAndRolloutPlan.md` and Directive 1 together. Record as a Decision Register entry or an amendment to `DEC-007`.
3. **F-04** — Replace `APPROVED_OR_ACCEPTED` with `APPROVED` in Directive 4, or amend `StateMachines.md`. One name, one place, before Stage 1 builds the enum.
4. **F-05** — Correct Directive 2's decision list: replace `DEC-008` with `DEC-004` and `DEC-005`.
5. **F-06** — Add a directive-to-stage mapping table and reconcile the Roadmap's "Expected local commit" column.
6. **F-01** — Move `DMAIC HR Offboarding Process .docx` out of the repository tree.
7. **F-07** — Delete the stray root-level `ClaudeBuildDirectives.md`.
8. **F-08** — Add a `.gitattributes` with `* text=auto eol=lf` to keep checksum verification valid on Windows checkouts.

## 9. Directive 1 readiness

**Assessment at Directive 0:** NOT ready — four OPEN Stage 1 decisions and three unresolved contradictions.

**Assessment after Directive 0.1:** **Directive 1 is technically ready to begin under the documented non-production constraints, and remains business-blocked for pilot and production.**

Both halves of that sentence matter.

### What is now unblocked

Directive 1's precondition requires Stage 1 checklist items to be "resolved **or** an approved written implementation constraint exists for each". `Stage1ImplementationConstraints.md` records a constraint for all eleven — IC-S1-001 to IC-S1-011 — so the precondition is satisfied by its second limb. The three contradictions that made the Stage 1 data model unbuildable are resolved:

| Former blocker | Now |
| --- | --- |
| DEC-031 / REQ-ADMIN-007 reason taxonomy | IC-S1-008 — versioned reference-data model, nullable `reason_category_id`, `reason_capture_status`. Directive 1 no longer requires an approved reason category at case creation, so no HR policy is invented. |
| F-02 role model | Eight roles, `PRIVACY_OFFICER` scoped to oversight only. |
| F-03 cohort enum | `measurement_cohort` (3) and `record_purpose` (3) as separate dimensions. |
| DEC-021 / REQ-SEC-001 production SSO | IC-S1-005 — interface, boundaries, doubly guarded dev login. No production IdP selected. |
| DEC-022 hosting | IC-S1-006 — local services and portable adapters only. |
| DEC-033 historical migration | IC-S1-010 — no migration; prospective and synthetic records only. |
| DEC-035, DEC-027 | IC-S1-011 and IC-S1-007 — restricted-by-default terminations; `America/Jamaica` with a versioned configurable calendar and synthetic test holidays. |

### What remains blocked

- **All eleven Stage 1 decisions remain OPEN or PROVISIONAL.** Four are OPEN: DEC-021, DEC-022, DEC-031, DEC-033. Seven are PROVISIONAL: DEC-001, DEC-002, DEC-003, DEC-007, DEC-027, DEC-032, DEC-035.
- **Every Stage 1 approval box remains unticked**, correctly. A constraint is not an approval.
- **Pilot and production remain prohibited.** So do real employee data, live identity, live email, live BambooHR, live external providers, live object storage, production hosting, deployment, credentials, secrets, and external AI processing of employee information.
- `REQ-SEC-001` and `REQ-ADMIN-007` remain OPEN and unverified.

### The distinction being drawn

Directive 1 builds a local, synthetic-data, non-production foundation. Every constraint is reversible, and none commits the organization to an HR policy, a vendor, a hosting region or a production behaviour. That is why engineering may proceed while the business decisions stay open.

What the constraints do **not** do is create approval. If a decision owner later chooses differently — a different identity provider, a different reason taxonomy, a different retention model — the affected Stage 1 code is expected to change. Building on a constraint is accepting that rework risk knowingly, not eliminating it.

`DEC-031` still requires real HR content, not merely a status change, and should be started first: IC-S1-008 defers the taxonomy but final case completion will eventually require either an approved category or an audited `NOT_PROVIDED`/`NOT_APPLICABLE` outcome.

## 10. Stop

Directive 0 stopped at validation. Directive 0.1 stopped at documentation reconciliation.

Across both: no application code was written, no application dependencies were installed, no database migration was created, no application source directory was introduced, no live system was contacted, no email was sent, and nothing was pushed.
