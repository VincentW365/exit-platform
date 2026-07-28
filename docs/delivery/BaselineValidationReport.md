# Baseline Validation Report

**Directive:** 0 — Documentation import and baseline validation
**Baseline version:** 0.1
**Validated:** 2026-07-28
**Validator:** Claude, acting as bounded implementation engineer under `CLAUDE.md`
**Outcome:** Package is structurally sound and internally consistent. **Directive 1 is NOT ready to start.**

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

### F-02 — Role model contradiction: 8 approved roles vs. 7 in Directive 1 *(blocks Directive 1)*

`RolesAndPermissions.md` and `PRD.md` define **eight** roles: `HR_MANAGER`, `HR_OFFICER`, `IT_RESPONDER`, `FINANCE_RESPONDER`, `LINE_MANAGER`, `AUDITOR`, `PRIVACY_OFFICER`, `SYSTEM_ADMIN`. `README.md` also states eight.

Directive 1 ("AUTHENTICATION AND AUTHORIZATION", item 3) instructs implementation of **seven**, omitting `PRIVACY_OFFICER`.

This is not cosmetic. `PRIVACY_OFFICER` carries defined record-level rules in the approved role model — notably identifiable exit-response access and retention/legal-hold configuration authority. Building the Stage 1 role enum from Directive 1 would omit a role the approved authorization model depends on, and the omission would propagate into the database enum, policy layer and authorization test matrix.

**Not corrected.** Roles are explicitly reserved from unilateral change by `CLAUDE.md` and by the directive's own constraints.

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

**Not corrected.** Requires a Decision Register entry or an amendment to `DataDictionary.md` and `REQ-CASE-013`.

### F-04 — Case state name contradiction: `APPROVED` vs. `APPROVED_OR_ACCEPTED` *(does not block Directive 1)*

`StateMachines.md` names the post-approval case state `APPROVED` throughout its diagram and transition table. Directive 4 enumerates `APPROVED_OR_ACCEPTED` — while simultaneously instructing "Use final names from the approved state specification; do not rename them for convenience without updating the baseline."

Directive 1 creates the case status enum, so the name should be settled before Stage 1 rather than discovered at Stage 3. `APPROVED_OR_ACCEPTED` appears only in `ClaudeBuildDirectives.md`; every other artefact uses `APPROVED`.

**Not corrected.** State names are approved architecture.

### F-05 — Directive 2 cites decisions that do not match its stage *(quality, non-blocking)*

Directive 2 (controlled documents, Stage 2) instructs reading `DEC-007`, `DEC-008`, `DEC-010` and `DEC-025`. `DEC-008` is the **asset KPI model**, owned by Stage 4, with no bearing on document generation. Meanwhile the two Stage 2 decisions most relevant to controlled documents — `DEC-004` (authoritative automation model) and `DEC-005` (communication approval) — are not cited.

**Not corrected.** Changing which approved decisions govern a directive is substantive.

### F-06 — Roadmap-to-directive mapping is undocumented *(quality, non-blocking)*

The Roadmap defines 8 stages (0–7); `ClaudeBuildDirectives.md` defines 11 directives (0–10). Stages 2–7 each expand into two directives, but no mapping table records this. Consequently the Roadmap's "Expected local commit" strings match the directives only for Stage 0 and Stage 1; for Stages 2–7 the Roadmap names a commit message that no directive issues.

Stage 0 and Stage 1 — the only ones in play now — match exactly, so this does not block current work.

**Recommendation:** add a directive-to-stage mapping table to `Roadmap.md` or `ClaudeBuildDirectives.md`.

### F-07 — Stray duplicate file at repository root *(hygiene)*

A byte-identical copy of `docs/delivery/ClaudeBuildDirectives.md` (SHA-256 `eeca3428…c117a56`) appeared at the repository root during validation. It is not listed in `PACKAGE_MANIFEST.md` or `docs/INDEX.md` and is not part of the baseline.

It was **not committed** and **not deleted** — removing a file from the user's working tree is the owner's call. It appears in `git status --short` as untracked.

**Recommendation:** delete `./ClaudeBuildDirectives.md`; the canonical file is `docs/delivery/ClaudeBuildDirectives.md`.

### F-08 — Line-ending normalization will break manifest checksum verification *(hygiene, non-blocking)*

Every package file uses LF endings, and the manifest's SHA-256 values are computed over LF content. Git reports `core.autocrlf=true` at system level on this machine, and no `.gitattributes` exists.

Content is committed as LF, so the repository itself is correct. But a fresh clone or checkout on Windows will materialize the working tree as CRLF, at which point **every** recomputed hash will differ from `PACKAGE_MANIFEST.md`. The manifest's own §Verification instructs exactly that recomputation, so the integrity procedure would report a false failure across all 52 rows.

**Recommendation:** add a `.gitattributes` containing `* text=auto eol=lf` so checkouts preserve LF and checksum verification stays meaningful.

**Not applied.** Adding a repository configuration file exceeds the corrections authorized for this directive.

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

Exactly one change was made. It is protective and non-behavioural: it alters no business rule, scope, architecture, status, target, role or decision.

| File | Change | Authority |
| --- | --- | --- |
| `.gitignore` | Added `*.docx`, `*.doc`, `*.xls`, `*.xlsx`, `*.pptx` under a commented "source DMAIC" block | `README.md` "Sensitive-source warning"; `CLAUDE.md` rule 7 and "Sensitive data"; Directive 0 "DO NOT copy the source DMAIC into the repository" |

No broken links, duplicate IDs, malformed numbering or duplicated headings were found, so no corrections of that class were needed.

Two further files changed as a direct product of this directive rather than as corrections: this report was created at `docs/delivery/BaselineValidationReport.md`, and `docs/INDEX.md` gained one row listing it, so the index remains complete.

### Manifest delta

`PACKAGE_MANIFEST.md` records the package **as imported** and was deliberately left unmodified, so it now carries three known, expected deltas. Regenerating it is a package-construction act, not a validation correction, and is left to the owner.

| Path | Delta |
| --- | --- |
| `.gitignore` | Content changed (F-01 correction); checksum no longer matches |
| `docs/INDEX.md` | Content changed (one added row); checksum no longer matches |
| `docs/delivery/BaselineValidationReport.md` | New file; not in manifest |

All 52 manifest rows matched **before** these changes, which is the integrity evidence that matters: the imported package arrived intact.

## 8. Recommended surgical corrections (owner approval required)

Listed smallest-change-first. None were applied.

1. **F-02** — In Directive 1, add `PRIVACY_OFFICER` to the role list so it reads eight roles, matching `RolesAndPermissions.md` and `PRD.md`. *(One-line edit; requires HR/Privacy confirmation that the role is in Stage 1 scope.)*
2. **F-03** — Resolve the cohort enum to either three or five values, then align `DataDictionary.md`, `REQ-CASE-013`, `PilotAndRolloutPlan.md` and Directive 1 together. Record as a Decision Register entry or an amendment to `DEC-007`.
3. **F-04** — Replace `APPROVED_OR_ACCEPTED` with `APPROVED` in Directive 4, or amend `StateMachines.md`. One name, one place, before Stage 1 builds the enum.
4. **F-05** — Correct Directive 2's decision list: replace `DEC-008` with `DEC-004` and `DEC-005`.
5. **F-06** — Add a directive-to-stage mapping table and reconcile the Roadmap's "Expected local commit" column.
6. **F-01** — Move `DMAIC HR Offboarding Process .docx` out of the repository tree.
7. **F-07** — Delete the stray root-level `ClaudeBuildDirectives.md`.
8. **F-08** — Add a `.gitattributes` with `* text=auto eol=lf` to keep checksum verification valid on Windows checkouts.

## 9. Directive 1 readiness

**Directive 1 is NOT ready to start.**

Directive 1's own precondition requires that Stage 1 checklist items be "resolved or an approved written implementation constraint exists for each". None of the eleven are ticked, and four are `OPEN`.

Blocking items, in priority order:

1. **DEC-031 / REQ-ADMIN-007 (reason taxonomy)** — hard blocker. Directive 1 mandates an approved reason category at case creation; none exists, and inventing HR categories is prohibited.
2. **F-02 (role model)** — the Stage 1 role enum, policy layer and authorization test matrix cannot be built from two conflicting role lists.
3. **F-03 (cohort enum)** — the Stage 1 `cohort` field is immutable and audited; its permitted values must be settled before the migration is written.
4. **DEC-021 / REQ-SEC-001 (production SSO)** — the adapter and guarded dev login may proceed; production binding may not. Needs a written constraint.
5. **DEC-022, DEC-033** — resolvable by written constraint; both lie outside Directive 1's build scope.
6. **DEC-035, DEC-027** — `PROVISIONAL` but load-bearing for Directive 1's termination-restriction and business-calendar test requirements. Confirm before build.

**Minimum path to readiness:** hold the Stage 1 approval meeting described in `StakeholderApprovalChecklist.md`, approve or constrain all eleven Stage 1 decisions, resolve F-02 and F-03, and approve this report. `DEC-031` requires actual HR content — a reason taxonomy — not merely a status change, so it should be started first.

No other blocker was found. Aside from the contradictions above, the package is complete, internally consistent, fully traceable and free of real personal data.

## 10. Stop

Work stopped at the end of Directive 0 as required. No application code was written, no stack was installed, no live system was contacted, and nothing was pushed.
