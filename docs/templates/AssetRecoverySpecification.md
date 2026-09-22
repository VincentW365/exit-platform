# Asset Recovery Specification

**Baseline version:** 0.1
**Prepared:** 2026-07-28
**Status:** Proposed. HR, IT, Finance and asset owners must approve catalogue ownership, evidence, waiver and exception rules before activation.

## 1. Objective

Ensure every applicable company-issued item receives a trustworthy documented disposition without treating physical recovery and documentation compliance as the same outcome.

## 2. Core measures

### Asset disposition documentation

```text
Required asset items with an approved final disposition
divided by
All required asset items due for disposition
```

Target: 100% before case completion.

### Physical asset recovery

```text
Issued assets physically returned
divided by
Issued assets due for return
```

Report separately. `NOT_ISSUED`, `WAIVED`, `LOST` and `DAMAGED` are documented outcomes but not physical recoveries.

## 3. Asset sources

An offboarding case may receive items from:

1. approved employee-issued asset source/integration;
2. standard departure checklist by location/role;
3. controlled HR/IT manual addition;
4. approved imported record.

Every item records source and source timestamp. A source change after case approval does not silently replace the case item; an authorized user reconciles it.

## 4. Suggested catalogue categories

The source checklist includes identification/employee card, health card, access/door pass, uniforms, laptop, lunch card, employee handbook, phone and keys. The application should support a configurable catalogue, including:

- employee identification card;
- health/benefit card;
- access card/door pass;
- building/desk/vehicle keys;
- uniform/protective clothing;
- laptop/desktop/tablet;
- mobile phone/SIM;
- charger/peripherals;
- lunch card;
- company documents/handbook - retired as recoverable asset types on 2026-09-22 (owner request); the enum values stay in the database for historical items, and the Employee Handbook line remains on the Exit Checklist for Return Items (DEC-053);
- tools/equipment;
- vehicle/fuel card;
- payment/purchase card;
- other assigned item.

Do not hard-code every organization asset into workflow logic.

## 5. Asset item fields

| Field | Purpose |
| --- | --- |
| Case/asset item ID | stable identity |
| Catalogue item/type | reporting and instructions |
| Description | safe item description |
| Unique asset identifier | tag/serial/card number where appropriate |
| Source/source reference | issued register, standard checklist or manual |
| Issued/applicable status | whether the employee is responsible for it |
| Quantity | where appropriate |
| Expected return date/time | usually on/before approved event |
| Responsible receiving role/user | owner |
| Reminder rule | configured schedule |
| Status/disposition | lifecycle/result |
| Received by/time | custody evidence |
| Condition | returned condition |
| Evidence reference | receipt/photo/form as approved |
| Employee acknowledgement | approved attestation where used |
| Remarks | bounded and access controlled |
| Exception/waiver | reason, owner, approval |
| Created/updated/audit | history |

Sensitive identifiers should be masked in lists where full display is not necessary.

## 6. Lifecycle

Recommended operational states:

```text
PENDING_REVIEW
EXPECTED
RETURN_SCHEDULED
RETURNED
EXCEPTION_REVIEW
FINALIZED
CANCELLED_AS_NOT_APPLICABLE
```

Final disposition values:

| Disposition | Meaning | Physical recovery? | Minimum evidence |
| --- | --- | --- | --- |
| `RETURNED` | Item was received | Yes | receiver and timestamp; condition; identifier where relevant |
| `NOT_ISSUED` | Verified not issued/applicable | Excluded | source/reviewer |
| `LOST` | Employee/owner reports item cannot be returned | No | report, follow-up and exception owner |
| `DAMAGED` | Returned or located damaged | Returned only if received | condition/evidence and exception owner |
| `WAIVED` | Authorized owner accepts no return/recovery requirement | No | approver, authority, reason |
| `UNRESOLVED` | Outcome not yet approved | No | blocker/follow-up; prevents completion unless authorized exception rule changes |

Use final enum names from the approved requirements/state specification.

## 7. Checklist generation

At case/workflow activation:

1. copy applicable standard checklist version;
2. add employee-specific issued assets;
3. deduplicate using source/type/identifier rules;
4. flag source conflicts;
5. allow authorized manual item with reason;
6. pin checklist/catalogue rules to a version;
7. assign receiver and due date;
8. show employee/department only the items they are authorized to see.

A new catalogue version does not silently add items to active cases.

### 7.1 Exit Checklist for Return Items (as implemented, DEC-053)

Alongside the asset recovery items above, activation creates one **Exit Checklist for
Return Items** per case: the HR paper form, carrying its ten items in the printed order
(Identification Card, Health Cards, Access Card / Door Pass, Uniforms, Laptop, ePay Card,
Employee Handbook, Phone, and the two `KEYS` rows Desk and Door).

- **Request.** A derived, controlled email (`RETURN_ITEMS_CHECKLIST`, AUTO_SEND) carries a
  single-use secure link under the DEC-048 token discipline. The link opens **that
  employee's** checklist directly at `/checklist/<token>` - no sign-in, no searching.
  Sending is recorded on the checklist itself (`RETURN_CHECKLIST_SENT`, recipient **mask**
  only).
- **Statuses.** Each item takes exactly one of `RETURNED`, `NOT_RETURNED`,
  `NOT_APPLICABLE` or `LOST_OR_DAMAGED`; `OUTSTANDING` is the absence of a decision.
  A remark is required for anything not returned.
- **Overall status is derived, never chosen:** `NOT_STARTED` → `IN_PROGRESS` →
  `COMPLETED` or `COMPLETED_WITH_OUTSTANDING`. Property still owed keeps its items
  visible after submission; submitting never clears an item.
- **Rejected submissions keep their work.** An incomplete form is refused with named
  reasons, but what was entered is saved (`RETURN_CHECKLIST_SAVED`) and the checklist
  stays `IN_PROGRESS`.
- **HR side.** The case Assets tab shows the checklist and lets an officer with
  `asset.manage` record it (paper form returned) or correct it afterwards - audited as
  `RETURN_CHECKLIST_SUBMITTED` or `RETURN_CHECKLIST_CORRECTED`.
- **Boundaries.** The checklist never marks an asset recovery record cleared on its own
  and never creates a payroll instruction. It blocks clearance only once it has actually
  come back reporting outstanding property; before that the asset recovery items above are
  the operative gate.

## 8. Return recording

The authorized receiver:

- verifies item/identifier;
- records received date/time;
- records condition;
- records quantity;
- attaches approved evidence where required;
- adds safe remarks;
- submits/finalizes.

For high-value or security-sensitive items, require a second review or IT confirmation where approved.

Employee signature/attestation requirements remain subject to Decision Register approval. Do not use pasted signature images.

## 9. Follow-up and reminders

- reminders are based on approved item/case rules;
- avoid separate duplicate messages per item when one consolidated reminder is safer;
- do not send to unverified personal contacts;
- reminders stop after final disposition or suppression;
- every attempt is idempotent and auditable;
- after the approved follow-up count/time, create an exception rather than sending indefinitely.

The source Control Plan mentions up to three follow-ups within three business days. HR must approve the exact schedule and contact channel before automation.

## 10. Exceptions

Possible exception categories:

- item cannot be located;
- employee disputes issue/ownership;
- return logistics pending;
- damaged;
- lost/stolen;
- source register incorrect;
- receiver unavailable;
- evidence missing;
- policy decision required;
- other approved category.

Record:

- category;
- safe description;
- owner;
- due date;
- actions/contact attempts;
- evidence;
- decision;
- approver;
- relation to case clearance.

## 11. Final-pay safeguard

The product must not:

- calculate a deduction;
- alter final pay;
- place an automated hold;
- tell the employee a deduction/hold will occur;
- make a legal/policy decision.

It may:

- identify an unresolved asset exception;
- notify the authorized HR/Finance decision owner;
- record that an external approved decision was made;
- record only the minimum result needed for clearance/audit.

Any pay-related decision remains outside the automated asset module.

## 12. Clearance behaviour

A case cannot complete until every required asset has:

- a final approved disposition; or
- an approved exception/waiver that satisfies the closure rule.

`UNRESOLVED` does not count as final documentation. A case may enter `CLEARANCE_REVIEW` with exceptions only under the approved workflow, but HR Manager decides completion.

## 13. Authorization

| Role | Typical capability |
| --- | --- |
| HR Officer | create/review applicable checklist, coordinate follow-up |
| HR Manager | approve exception/waiver within authority, clearance |
| IT responder | update assigned IT assets only |
| Line manager/asset custodian | update assigned physical items |
| Finance responder | view only approved exception result needed for Finance process |
| Auditor | read approved evidence |
| System administrator | configure technical service; no routine asset-case content access |

Record-level assignment and restricted termination visibility still apply.

## 14. Evidence and documents

- store evidence through the secure file boundary;
- scan/quarantine uploads;
- restrict download;
- hash/checksum;
- avoid unnecessary photos of people/documents;
- generate an asset receipt/clearance summary from an approved template;
- retain prior versions/corrections.

## 15. Reports

- disposition documentation compliance;
- physical recovery rate;
- outstanding by age/type/owner;
- lost/damaged/waived counts;
- source-data conflicts;
- items due in next period;
- follow-up effectiveness;
- closure exceptions;
- baseline/pilot/post-rollout comparison.

All reports show counts and authorized drill-through only.

## 16. Tests

- checklist version pinning;
- source/manual item merge and duplicate handling;
- every disposition and evidence rule;
- identifier masking/access;
- reminder idempotency/suppression;
- exception/waiver authority;
- no automated pay side effect;
- 100% disposition closure gate;
- physical recovery calculation;
- restricted termination/department views;
- file security;
- correction/reopen history;
- end-to-end returned and unresolved scenarios.

## 17. Acceptance criteria

- applicable items are generated consistently;
- each item has source, owner and due date;
- final disposition is unambiguous and auditable;
- recovery and documentation KPIs differ correctly;
- unresolved item blocks closure unless an approved exception resolves it;
- no pay modification path exists;
- unauthorized users cannot see or alter unrelated assets;
- source appendices' real data is not reused.
