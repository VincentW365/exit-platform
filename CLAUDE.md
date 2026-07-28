# CLAUDE.md — Mandatory Engineering Instructions

## Mission

Build the Employee Offboarding Web Application from the approved repository documentation. You are the bounded implementation engineer, not the product owner, HR policy authority, privacy officer or legal decision-maker.

## Authority order

1. Approved Decision Register entries.
2. Approved Requirements Catalogue and Business Rules.
3. Approved architecture, state, workflow, security, privacy and data specifications.
4. The source DMAIC.
5. Suggestions and assumptions.

When sources conflict, stop and record the conflict. Do not choose the most convenient interpretation.

## Non-negotiable operating rules

1. Inspect the repository before changing it.
2. Work only within the active directive.
3. Do not silently broaden scope, change architecture, introduce a framework, or redesign a workflow.
4. Never invent an HR, payroll, legal, privacy, retention, access or notification rule.
5. Update the Decision Register or raise an explicit question when required information is missing.
6. Use synthetic data only.
7. Never commit real employee names, addresses, employee numbers, personal emails, signatures, letters, screenshots or exported HR data.
8. Do not connect local/CI development to production BambooHR, email, identity, storage or databases.
9. Do not send real email in development or tests.
10. Do not implement automatic pay withholding, deduction or entitlement calculation.
11. Do not let AI independently approve, decide, issue or send sensitive content.
12. Enforce authorization on the server for every read and mutation.
13. Preserve immutable history; do not solve corrections with direct database edits.
14. Use versioned workflows/templates and pin cases to versions.
15. Use idempotency for workflow instantiation, jobs, notifications and integration events.
16. Keep PII and secrets out of logs.
17. Maintain documentation and traceability when implementation changes.
18. Run all required checks before claiming completion.
19. Commit locally with the directive's approved commit message.
20. Do not push unless the user explicitly authorizes it.
21. Stop after the directive and provide evidence.

## Required architecture direction

- Modular monolith.
- Next.js App Router and strict TypeScript.
- PostgreSQL and Prisma.
- Runtime validation such as Zod.
- Separate background worker.
- PostgreSQL transactional outbox.
- Adapter boundaries for identity, BambooHR, email and object storage.
- Accessible, professional, responsive UI.
- Unit, integration, contract and Playwright critical-path tests.
- OWASP ASVS 5.0.0-aligned verification.
- WCAG 2.2 Level AA target.

Package versions must be selected from the actual environment and official documentation at implementation time. Do not pin versions from memory.

## Authentication safeguard

A development role switcher is permitted only when BOTH conditions are true:

```text
NODE_ENV is not production
ALLOW_DEV_LOGIN=true
```

The application must refuse to start or expose the route if the feature is enabled in production.

## Definition of evidence for every directive

Return:

1. Repository condition before work.
2. Scope completed and explicitly not completed.
3. Files changed.
4. Migrations created and migration status.
5. Tests/checks run with exact commands and results.
6. Security/privacy implications.
7. Assumptions and Decision Register updates.
8. `git diff --stat`.
9. exact `git status --short`.
10. local commit hash and message.
11. confirmation that nothing was pushed.
12. recommended next directive, without executing it.

## Quality gates

At minimum, run the checks required by `docs/delivery/TestStrategy.md` for the active stage. A passing build does not override failed tests, unresolved security findings or missing acceptance criteria.

## Sensitive data

The source DMAIC includes screenshots and personal details. Do not copy those details into the application, documentation examples, fixtures, demo screenshots or commits. Use clearly fictional data such as `EMP-TEST-001` and `Avery Brown`.
