# HR Offboarding Product Baseline

**Organization:** Bert's Auto Parts Ltd.
**Product:** Employee Offboarding Web Application
**Baseline version:** 0.1
**Prepared:** 2026-07-28
**Status:** Detailed proposed baseline — stakeholder approval is still required for open and provisional decisions.

This package converts the 27-page DMAIC for the employee offboarding process into a repository-ready product, requirements, architecture, security, UX, delivery, operations, and controlled-template baseline. It is designed to be handed to Claude as the implementation authority instead of asking Claude to invent the product while coding.

## What this package resolves

The source DMAIC correctly identifies the core failures: manual hand-offs, inconsistent documentation, weak exit-feedback completion, no central audit trail, no meaningful metrics, and fragmented paper/email records. It also contains conflicts and undefined rules that would create implementation risk. This package:

- separates resignation with notice, immediate resignation, and termination workflows;
- replaces an undefined “AI bot” core with a deterministic, versioned workflow engine;
- keeps optional AI as reviewed assistance rather than decision or dispatch authority;
- introduces exact-time access-revocation controls;
- separates asset documentation from physical recovery;
- protects final-pay decisions from automatic system action;
- defines role- and record-level access;
- establishes baseline, pilot, and post-rollout cohorts;
- defines metrics, state machines, evidence, exceptions, audit events, and release gates;
- provides staged Claude directives with proof-of-work requirements.

## Authority hierarchy

| Order | Source | How Claude must treat it |
| --- | --- | --- |
| 1 | Approved entries in `docs/requirements/DecisionRegister.md` | Binding business/product decisions. |
| 2 | Approved requirements in `RequirementsCatalogue.md` and `BusinessRules.md` | Binding functional and control requirements. |
| 3 | Approved workflow, state, security, privacy, and data specifications | Binding implementation design constraints. |
| 4 | The source DMAIC and appendices | Primary business source; contradictions are resolved through the Decision Register. |
| 5 | Unapproved suggestions, assumptions, wireframes, and future ideas | Informational only; do not implement as committed scope. |

## Start here

1. Review `docs/requirements/StakeholderApprovalChecklist.md`.
2. Resolve decisions that block Stage 1.
3. Read `Project.md`, `CLAUDE.md`, and `docs/INDEX.md`.
4. Give Claude `START_HERE_FOR_CLAUDE.md` together with the entire package.
5. Use the bounded directives in `docs/delivery/ClaudeBuildDirectives.md`.
6. Use `PACKAGE_MANIFEST.md` to verify the imported file set.
7. Return Claude's evidence after every directive for review before continuing.

## Package statistics

- **Requirements:** 313
- **User stories:** 40
- **Decision-register items:** 35
- **Defined KPIs:** 13
- **Expanded project/product risks:** 35
- **Initial application roles:** 8
- **Business rules:** 103
- **Audit-event types:** 95
- **Security verification checks:** 84

## Important status convention

- `PROVISIONAL`: recommended baseline that may be used for planning, but must be confirmed by the named owner before its blocking implementation stage.
- `OPEN`: unresolved; Claude must not invent the answer.
- `APPROVED`: binding.
- `DEFERRED`: explicitly outside the current release.
- `REJECTED`: not to be implemented.

## Sensitive-source warning

The original DMAIC appendices contain real or realistic personal information and screenshots. Do not place the source document, exported employee data, email screenshots, signatures, or real case files in the source repository. Use synthetic data only.
