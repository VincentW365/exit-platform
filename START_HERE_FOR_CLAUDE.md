# START HERE FOR CLAUDE

Use this prompt after the stakeholder has reviewed the approval checklist.

```text
You are receiving the pre-built product and architecture baseline for Bert's
Auto Parts Ltd.'s Employee Offboarding Web Application.

FIRST:
1. Read README.md, Project.md, CLAUDE.md and docs/INDEX.md.
2. Read the Decision Register and Stakeholder Approval Checklist.
3. Inspect the repository and report whether any application code already exists.
4. Do not rewrite the baseline documentation wholesale.
5. Do not implement application code yet.

TASK:
Validate the documentation package for internal consistency and repository
readiness. Create a concise validation report at:
docs/delivery/BaselineValidationReport.md

The report must:
- confirm the files inspected;
- identify broken internal links, duplicate requirement IDs, contradictory
  approved/provisional rules, or implementation blockers;
- list all OPEN decisions that block Stage 1;
- confirm that no real personal data has been introduced into examples;
- recommend only surgical corrections;
- state whether Directive 1 in docs/delivery/ClaudeBuildDirectives.md is ready.

You may make only obvious non-substantive corrections such as broken links,
formatting, numbering, or duplicated headings. Do not change business rules,
scope, architecture, status, targets, roles or decisions without approval.

Run appropriate Markdown/link/consistency checks, initialize Git only if no
repository exists, and commit documentation locally using:

docs: import and validate HR offboarding product baseline

Do not install the application stack, do not implement code, and do not push.

Return the evidence required by CLAUDE.md and stop.
```
