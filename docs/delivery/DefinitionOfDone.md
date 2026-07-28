# Definition of Done

**Baseline version:** 0.1
**Prepared:** 2026-07-28

## 1. Principle

“Done” means the approved outcome is usable, secure, testable, traceable and supportable. Code completion, a green build or a visually finished page is not sufficient.

## 2. Work-item Definition of Done

A story, defect or technical task is done only when all applicable items are true.

### Scope and behaviour

- requirement IDs and acceptance criteria are identified;
- implementation matches approved decisions and business rules;
- no unrelated scope is included;
- edge cases, failures and permissions are implemented;
- error messages are actionable and do not disclose sensitive data;
- changes to active-case/version behaviour are explicit.

### Data and migrations

- schema and constraints enforce important invariants;
- migrations are reviewed, deterministic and tested on a clean database;
- rollback or recovery approach is documented;
- seed/fixture data is synthetic;
- classification, retention and audit effects are addressed;
- no real source-DMAIC personal data is present.

### Security and privacy

- server-side authorization covers every read and mutation;
- negative authorization tests exist;
- input/output validation and safe encoding are applied;
- secrets and PII are absent from code and logs;
- upload, token, export, webhook or integration controls are tested where applicable;
- privacy minimization and purpose are preserved;
- new processor/sharing/AI use has required approval.

### Reliability

- asynchronous actions are idempotent;
- transaction/outbox boundaries are tested;
- retry, permanent failure and manual fallback are defined;
- race/concurrency behaviour is tested where material;
- operational metrics/logs permit diagnosis without exposing HR data.

### User experience and accessibility

- loading, empty, success, warning and error states exist;
- status is not communicated by colour alone;
- keyboard and focus behaviour works;
- labels, instructions and errors are accessible;
- responsive behaviour is verified for relevant screens;
- terminology matches the glossary and process.

### Testing

- unit/integration/contract/E2E tests required by `TestStrategy.md` pass;
- regression coverage is added for defects;
- lint, formatting, strict type checks and build pass;
- security/accessibility checks for the changed surface pass;
- failures are reported honestly and not waived silently.

### Documentation and traceability

- affected requirements, rules, diagrams, data fields, risks and runbooks are updated;
- any new assumption is recorded as a decision, not hidden in code;
- configuration/environment changes are documented;
- user/admin guidance is updated;
- requirement-to-test mapping remains clear.

### Delivery evidence

- code review/self-review completed;
- `git diff` contains no credentials, PII, generated junk or unrelated edits;
- local commit uses the approved message;
- exact commands and results are reported;
- repository is clean except for explicitly disclosed files;
- nothing is pushed without authorization.

## 3. Stage Definition of Done

A delivery stage is done when:

1. every included requirement is implemented or has an approved disposition;
2. every stage acceptance criterion and critical path passes;
3. no blocking decision is open;
4. no unresolved Critical defect exists;
5. High defects have approved, time-bound risk treatment;
6. role/record authorization and restricted-data tests pass;
7. data migrations and restoration are verified;
8. stage-specific security, privacy and accessibility evidence is complete;
9. manual fallback exists for newly automated operational actions;
10. documentation, support and training are updated;
11. an evidence report and local commit are available;
12. Product Owner/HR/IT approvers accept the stage.

## 4. Release Definition of Done

A release candidate additionally requires:

- environment-specific configuration reviewed by two authorized people;
- production identity, recipients, permissions and feature flags verified;
- no-send controls verified in non-production;
- backups and restore tested;
- deployment and rollback rehearsed;
- monitoring/alerts and incident ownership active;
- retention/legal-hold configuration approved for production scope;
- vulnerability, dependency and secret scans reviewed;
- accessibility review complete;
- UAT signed off;
- release notes and known limitations approved;
- support runbook and escalation contacts published;
- sponsor go/no-go recorded.

## 5. Documentation-only stage Definition of Done

For Stage 0:

- all listed Markdown files exist and are internally consistent;
- requirement, decision, metric and risk IDs are unique;
- open decisions are clearly identified;
- no false claim of approval or legal compliance is made;
- source personal data is not reproduced;
- links and file references resolve;
- package manifest/checksums are created;
- Claude baseline validation is completed before implementation.

## 6. Directive completion report

Claude must return the evidence required in `../../CLAUDE.md`:

1. repository condition before work;
2. completed and excluded scope;
3. files changed;
4. migrations and status;
5. exact checks and results;
6. security/privacy implications;
7. assumptions/decision updates;
8. `git diff --stat`;
9. exact `git status --short`;
10. local commit hash/message;
11. no-push confirmation;
12. next recommended directive only.

A statement such as “everything works” without this evidence does not meet the Definition of Done.

## 7. Reopening done work

A completed item is reopened when:

- acceptance criteria were misunderstood;
- a defect proves the requirement is not met;
- authorization/privacy/reliability evidence fails;
- a dependency/version change invalidates prior evidence;
- an approved change request alters the expected outcome.

The original completion evidence remains in history.
