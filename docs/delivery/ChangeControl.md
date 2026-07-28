# Change Control

**Baseline version:** 0.1
**Prepared:** 2026-07-28

## 1. Purpose

Prevent suggestions, convenience changes and Claude assumptions from becoming production requirements without analysis, traceability and approval.

The change process applies to:

- scope;
- business rules;
- workflows and task timing;
- roles and access;
- data fields and classification;
- templates and recipient lists;
- metrics;
- integrations;
- architecture;
- security/privacy controls;
- deployment and operational procedures.

## 2. Change types

| Type | Examples | Minimum approval |
| --- | --- | --- |
| Clarification | Correcting wording without changing behaviour | Product Owner; affected owner notified |
| Requirement change | New field, rule, task, screen or report | Product Owner and business owner |
| Policy-sensitive change | termination handling, final pay, survey eligibility, retention | HR Manager plus policy/legal/privacy owner as applicable |
| Security/privacy change | new data sharing, role, processor, AI service, log content | IT Security and Privacy Officer |
| Integration change | new provider, permission or write-back | IT and system owner |
| Architecture change | microservice, database, framework or hosting change | Technical owner, Product Owner and sponsor when cost/risk changes |
| Template change | wording, placeholders, recipients or approval route | HR content owner and privacy/legal reviewer where applicable |
| Emergency change | urgent production correction | Emergency approvers; retrospective review mandatory |

## 3. Change-request record

Every material request receives a stable ID such as `CR-2026-001` and records:

- title and requestor;
- date;
- problem/opportunity;
- proposed change;
- reason and expected benefit;
- affected users and cases;
- urgency;
- source/evidence;
- alternatives, including no change;
- affected requirements, rules, decisions, workflows, templates and metrics;
- data/security/privacy assessment;
- technical and operational impact;
- test and migration impact;
- schedule/effort estimate;
- backward compatibility;
- rollout/rollback plan;
- approval and decision date;
- implementation commit/release;
- post-change validation.

## 4. Workflow

```text
SUBMITTED
  -> TRIAGED
  -> ANALYSIS
  -> PENDING_APPROVAL
  -> APPROVED / REJECTED / DEFERRED
  -> SCHEDULED
  -> IMPLEMENTED
  -> VERIFIED
  -> CLOSED
```

A request may be returned for information or withdrawn. Status transitions and reasons are retained.

## 5. Triage

The Product Owner determines:

- whether the request is a defect, clarification, decision, risk response or enhancement;
- whether it is already covered by an approved requirement;
- which stage/release is affected;
- whether it blocks current work;
- which approvers are required;
- whether the request needs urgent containment before full implementation.

A defect fix can still require change approval when it changes approved behaviour.

## 6. Impact analysis

At minimum, assess:

1. **Business:** process, workload, employee experience, policy.
2. **Data:** fields, source of truth, classification, retention, migration.
3. **Access:** roles, record visibility, segregation of duties.
4. **Privacy:** purpose, minimization, notice, sharing, processor/transfer.
5. **Security:** threats, secrets, attack surface, auditability.
6. **Workflow:** state transitions, due dates, active cases, versioning.
7. **Documents/notifications:** wording, recipient, approval, reissue.
8. **Metrics:** numerator, denominator, historical comparability.
9. **Technology:** schema, adapters, dependencies, operations.
10. **Testing:** unit, integration, E2E, regression, accessibility and security.
11. **Delivery:** effort, sequencing, training and rollback.

## 7. Approval matrix

| Change impact | Required approval |
| --- | --- |
| No behavioural impact | Product Owner |
| HR workflow or template behaviour | HR Manager + Product Owner |
| Scope, budget or target change | Project Sponsor + Product Owner + affected owner |
| IT/security architecture or production permission | IT/Technical owner + Security |
| Personal-data purpose, sharing, retention or external processor | Privacy Officer/DPO function + business owner |
| Final-pay, legal wording or termination policy | Authorized HR/policy/legal owner |
| KPI definition or baseline comparability | Process Analyst + HR Manager |
| Emergency production change | HR operational owner + technical owner; privacy/security owner when relevant |

Claude is never an approver.

## 8. Versioning rules

- Workflow and template changes create new immutable versions.
- Existing cases remain pinned to their original version unless an explicit migration is approved.
- Configuration versions record effective dates and approvers.
- Data migrations are reversible where practical and tested on synthetic/staging data.
- Requirement and rule text retains history through Git and decision/change records.
- A changed KPI must indicate whether historical series remain comparable.

## 9. Active-case impact

Every approved change must choose one:

- applies only to new cases;
- applies to active cases after an explicit case-level migration;
- emergency correction to specified cases;
- reporting-only reclassification;
- no case-data change.

Silent retrospective alteration is prohibited.

## 10. Emergency changes

Emergency change is reserved for:

- active security/privacy exposure;
- incorrect external dispatch;
- urgent access-removal failure;
- data-integrity or availability issue;
- critical regulatory/policy direction.

Procedure:

1. contain the issue;
2. preserve evidence;
3. obtain available authorized approval;
4. implement the smallest safe change;
5. run targeted verification;
6. document deployment and rollback;
7. complete full impact analysis and retrospective approval within the agreed incident window;
8. update requirements/tests/runbooks.

Emergency status does not authorize bypassing privacy, evidence or access controls.

## 11. Required traceability update

An approved change is not ready for implementation until affected artefacts are identified:

- `DecisionRegister.md`;
- `RequirementsCatalogue.md`;
- `BusinessRules.md`;
- acceptance criteria;
- roles/permissions;
- data dictionary/model;
- state/workflow design;
- templates;
- metrics;
- risk register/threat model;
- tests;
- active Claude directive;
- operations/training.

## 12. Claude rule

When a requested implementation conflicts with the baseline:

1. stop the conflicting portion;
2. identify exact artefacts/IDs;
3. draft a change request or Decision Register entry;
4. describe impact and options;
5. continue only unaffected work;
6. wait for approval before implementing the changed behaviour.

## 13. Change completion

A change closes only after:

- approved behaviour is implemented;
- migrations/configuration are applied;
- required tests pass;
- documentation and traceability are updated;
- monitoring is in place;
- affected users are informed/trained;
- post-change result is verified;
- commit/release identifiers are recorded.
