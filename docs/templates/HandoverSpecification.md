# Knowledge Transfer and Handover Specification

**Baseline version:** 0.1
**Prepared:** 2026-07-28
**Status:** Provisionally in scope because the DMAIC lists knowledge transfer in both in-scope and out-of-scope areas and later requires an SOP update. Sponsor/HR must confirm the final Stage 4 scope.

## 1. Objective

Provide a structured, role-appropriate record of work continuity before departure without turning the application into a document repository, password vault or performance-management system.

## 2. Applicability

The workflow definition determines whether handover is:

- required;
- optional;
- not applicable;
- shortened for an immediate departure;
- restricted for termination;
- waived by an authorized HR Manager.

Applicability and waiver are recorded with reason. The module must not assume that every departure permits direct contact with the employee.

## 3. Handover plan

One plan per applicable case, pinned to a checklist/template version.

Plan fields:

- case and employee reference;
- responsible line manager;
- HR owner;
- target completion date/time;
- status;
- applicability/waiver;
- replacement or interim owner where known;
- overall risk rating;
- manager attestation;
- HR review;
- completion/reopen history.

## 4. Item categories

| Category | Examples | Required fields |
| --- | --- | --- |
| Duties/responsibilities | routine activities, reporting cycles | description, new owner, effective date |
| Open tasks/projects | work in progress, deadline, status | task, due date, owner, next action |
| Customer/vendor matters | active matter and authorized contact context | safe summary, owner, deadline |
| Documents/records | approved file/system location | location/link, access owner |
| Scheduled commitments | meetings, renewals, deliveries | date, owner, action |
| Training/knowledge session | walkthrough or shadowing | participants, date, outcome |
| Risks/issues | unresolved operational concern | safe description, severity, owner |
| Equipment/physical custody | business items transferred internally | item/ref, receiver, date |
| Other approved category | process-specific | configured fields |

Do not use handover items as a substitute for the asset-disposition module.

## 5. Prohibited content

The interface must prominently state:

> Do not enter passwords, authentication codes, private keys, API tokens, shared
> secrets, PINs, personal credentials or confidential information unrelated to
> the operational handover.

Where credentials need transfer:

- assign an IT/security task to reset/reassign access;
- reference the approved password/secret-management process;
- do not copy the secret into the case.

Also avoid:

- detailed employee relations allegations;
- medical details;
- unrestricted personal contacts;
- customer personal data beyond approved need;
- full document content when a controlled location/link is sufficient.

## 6. Item lifecycle

```text
DRAFT
  -> ASSIGNED
  -> IN_PROGRESS
  -> READY_FOR_REVIEW
  -> ACCEPTED
```

Alternative controlled outcomes:

- `BLOCKED`;
- `NOT_APPLICABLE`;
- `WAIVED`;
- `CANCELLED`;
- `REOPENED`.

Final enum/state names follow the approved requirements.

## 7. Workflow

1. Handover plan is created from the approved workflow/checklist.
2. Line manager reviews applicability and adds missing items.
3. Each item receives a responsible owner and due date.
4. Departing employee contribution is optional and policy/workflow controlled.
5. Owners record transfer/action evidence.
6. Manager reviews and attests that the plan is complete or exceptions are documented.
7. HR reviews the handover result for clearance where required.
8. Later correction/reopening preserves prior attestation.

Immediate resignation may use a manager-led reconstruction. Termination handover may be prepared confidentially and activated only at the approved time.

## 8. Item fields

- item ID;
- category;
- title;
- safe description;
- source/checklist version;
- assigned owner;
- receiving owner;
- due date/time and provenance;
- status;
- blocker/reason;
- document/system location;
- training date/participants;
- risk level;
- evidence/attestation;
- created/updated/completed timestamps;
- audit history.

## 9. Authorization

- HR Manager/Officer sees applicable plan according to case restriction.
- Assigned line manager sees only cases/items assigned to them.
- Replacement/interim owner sees only assigned item detail if approved.
- IT/Finance do not see handover content unless explicitly assigned a relevant item.
- Auditors see approved evidence.
- Technical administrators have no routine content access.
- Termination participation and timing must prevent premature disclosure.

List, count, search and notifications must obey the same record-level rules.

## 10. Due dates

Default due date may be before the confirmed last working day, but the exact rule is workflow/version controlled.

On effective-date change:

- preview affected handover tasks;
- authorized HR approves recalculation;
- store original/new due dates and rule;
- notify only appropriate participants;
- do not make a past-due item appear timely by rewriting history.

## 11. Evidence and attestation

Evidence may include:

- safe completion note;
- link to approved company repository;
- training session record;
- receiving owner acknowledgement;
- manager attestation.

Do not require file upload when a system/location reference is enough. Uploaded evidence follows file security and retention controls.

Attestation records actor, role, statement version, timestamp and result. It is not a legal electronic signature unless separately approved.

## 12. Exceptions

Examples:

- no replacement owner;
- employee unavailable;
- critical information missing;
- access to source files unavailable;
- customer/vendor commitment at risk;
- training incomplete;
- confidential matter requires restricted handling.

Each exception gets owner, severity, due date, action and resolution/waiver. A critical unresolved handover issue may block clearance under the approved workflow.

## 13. Reporting

- handover applicability/completion;
- overdue items;
- blocked/waived items;
- items without receiving owner;
- high-risk unresolved items;
- completion before effective date;
- departure-type trend.

Reports must avoid broad disclosure of item descriptions. Operational dashboards may show safe counts/status with authorized drill-through.

## 14. Tests

- applicability by three departure workflows;
- termination confidentiality/timing;
- item assignment and record-level access;
- prohibited-secret warning and PII-safe logs;
- due-date recalculation;
- block/waive/attest/reopen;
- closure integrity;
- no IT/Finance leakage;
- file/location evidence;
- version pinning;
- E2E standard, immediate and restricted scenarios.

## 15. Acceptance criteria

- line managers receive only assigned handover work;
- the plan captures owner, due date, status and evidence;
- secrets are explicitly prohibited and not logged;
- immediate/termination exceptions are controlled;
- manager and HR attestations are auditable;
- unresolved mandatory handover work affects clearance according to the approved rule;
- changes preserve history.
