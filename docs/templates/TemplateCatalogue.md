# Controlled Template Catalogue

**Baseline version:** 0.1
**Prepared:** 2026-07-28
**Status:** Catalogue baseline. Content remains non-issuable until the named business owner records approval and an active immutable version is published.

## 1. Template controls

Every template must have:

- stable template ID;
- immutable version;
- purpose and applicable departure types;
- audience and classification;
- required/optional placeholders;
- source of every placeholder;
- approval owner;
- effective/retirement date;
- delivery/output channel;
- versioned recipient rule where applicable;
- retention class;
- tests;
- status: `DRAFT`, `PENDING_APPROVAL`, `ACTIVE`, `RETIRED` or `REVOKED`.

Active cases pin the template version. Editing an active version is prohibited.

## 2. Document templates

| ID | Template | Applies to | Output | Classification | Content owner | Approval required before issue |
| --- | --- | --- | --- | --- | --- | --- |
| `TPL-DOC-001` | Resignation acknowledgement/acceptance — notice | Resignation with notice | Approved PDF; optional DOCX only if policy approves | Confidential | HR Manager | HR content/policy owner |
| `TPL-DOC-002` | Immediate resignation acknowledgement | Immediate resignation | Approved PDF; optional DOCX only if policy approves | Confidential | HR Manager | HR content/policy owner |
| `TPL-DOC-003` | Termination communication | Termination | Approved controlled format | Restricted | HR Manager | Authorized HR/policy/legal owner |
| `TPL-DOC-004` | Employee Action Form — offboarding | Approved departure types | Digital record and approved printable output | Restricted | HR Manager | Existing approval hierarchy |
| `TPL-DOC-005` | Asset receipt/exception acknowledgement | Applicable assets | PDF/receipt | Confidential | HR Manager / Asset owner | HR/asset owner |
| `TPL-DOC-006` | Final clearance summary | All completed cases | PDF/internal record | Restricted | HR Manager | HR Manager |
| `TPL-DOC-007` | Manual fallback case record | Outage/continuity | Controlled form | Restricted | HR Manager / IT | Product/operations owner |

`TPL-DOC-003` must remain non-issuable until the authorized wording is approved. The system must not substitute resignation wording.

## 3. Internal notification templates

| ID | Notification | Recipient role | Trigger/anchor | Minimum content | Approval |
| --- | --- | --- | --- | --- | --- |
| `TPL-NOT-001` | IT access-removal task | IT responder/approved IT mailbox | Case approval or urgent HR authorization; due at exact effective time | employee/internal work identity, location if needed, exact effective time, systems scope, HR contact/case ref | approved HR/IT rule |
| `TPL-NOT-002` | Finance offboarding task | Finance responder | approved workflow event | employee ID/name as needed, approved effective date, departure category only if required, task/case ref | approved HR/Finance rule |
| `TPL-NOT-003` | Line-manager handover task | Assigned line manager | workflow activation | employee, effective date, handover due date, case/task link | workflow approval |
| `TPL-NOT-004` | Task reminder | Assigned internal user | approved schedule | task title, due/overdue state, case ref, action link | system rule |
| `TPL-NOT-005` | Escalation notice | approved supervisor/owner | approved breach threshold | task/case ref, due time, age, owner, required next action | system rule |
| `TPL-NOT-006` | HR document approval request | HR approver | document submitted | document type/version, case ref, review link | system rule |
| `TPL-NOT-007` | HR exception alert | HR Manager/Product owner | critical exception | safe summary, owner, deadline, case ref | system rule |

Internal messages must not include survey responses, broad termination detail, rehire eligibility or unnecessary document content.

## 4. External/provider notification templates

| ID | Notification | Applicability | Minimum fields | Owner/approver |
| --- | --- | --- | --- | --- |
| `TPL-EXT-001` | Sagicor group health/benefit separation | Only enrolled employees and approved event | approved identity/member fields, last/effective work date, company contact/reference | Benefits owner + HR + Privacy field-set approval |
| `TPL-EXT-002` | NCB group life/related separation | Only enrolled employees and approved event | approved identity/member fields, last/effective work date, company contact/reference | Benefits owner + HR + Privacy field-set approval |
| `TPL-EXT-003` | Other external programme | Separately approved | approved minimum field set only | programme owner + HR/Privacy |

Recipient addresses are configuration, not embedded source code. They require change control and two-person production review.

## 5. Departing-employee communications

| ID | Communication | Trigger | Channel | Notes |
| --- | --- | --- | --- | --- |
| `TPL-EMP-001` | Exit-survey invitation | approved day 3 after effective departure | verified personal email | one-time secure link; approved confidentiality notice |
| `TPL-EMP-002` | Exit-survey reminder | approved day 7, no response, not suppressed | verified personal email | one reminder unless policy changes |
| `TPL-EMP-003` | Survey confirmation | successful submission | respondent web page; optional approved email | no response content |
| `TPL-EMP-004` | Asset return reminder | approved schedule | approved contact channel | item-level minimum information; no pay threat |
| `TPL-EMP-005` | Document availability/issue notice | approved document issuance | approved channel | link/attachment control according to policy |

## 6. Required placeholder governance

Each placeholder definition records:

| Attribute | Example |
| --- | --- |
| Key | `employee.full_name` |
| Label | Employee full name |
| Source | Approved case snapshot |
| Classification | Confidential |
| Required | Yes |
| Validation | non-empty; approved characters/length |
| Transform | title case only if approved; never alter legal name silently |
| Applies to | named template versions |
| Review display | source/value shown before approval |
| Logging | key/result status only; not value |

High-risk placeholders include employee identity, effective date/time, address, provider/member identifiers, pay-related wording, approver/signatory and recipients.

## 7. Publication workflow

```text
DRAFT
  -> CONTENT_REVIEW
  -> PRIVACY/POLICY_REVIEW where applicable
  -> APPROVED
  -> ACTIVE
  -> RETIRED / REVOKED
```

- activation records approver/date/effective date;
- revoked versions cannot generate new artefacts;
- already issued artefacts remain in history;
- emergency revocation disables generation/dispatch immediately;
- cases using a retired version continue only under an explicit migration/exception decision.

## 8. Minimum template tests

- all required placeholders resolve;
- optional placeholders do not leave blank labels or markers;
- malicious input is safely encoded;
- date/time and business terms render correctly;
- template cannot be used for an inapplicable departure type;
- recipient/minimum-field rule is enforced;
- output/version/checksum is recorded;
- old active cases are unaffected by new version;
- accessibility and layout are reviewed for generated documents;
- snapshot test uses synthetic data only.

## 9. Source appendix treatment

The DMAIC appendices provide examples of the Employee Action Form, resignation letter, IT email, Sagicor/NCB email and asset checklist. They are process evidence, not approved machine-ready templates. Real names, addresses, signatures, email headers and contact details from those screenshots must never be copied into development or test content.
