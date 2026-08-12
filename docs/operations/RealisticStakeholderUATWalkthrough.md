# Realistic Stakeholder UAT Walkthrough (RETIRED)

This alias-based walkthrough was retired by Directive 6.2 / DEC-043 on
2026-08-12. Stakeholder UAT now runs directly against the live read-only
directory with real personnel mapped to their responsibilities and simulated
offboarding events only.

Use **`LiveDataStakeholderUATWalkthrough.md`** in this folder.

The alias tooling (`scripts/uat-alias.ts`, `scripts/realistic-uat-seed.ts`,
the local mapping file and its banner) was removed; clear-down is
`scripts/reset-environment.ts purge-live --yes`, and the pre-commit
real-name scan now derives its needles from the local directory itself.
