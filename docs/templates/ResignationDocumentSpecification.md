# Resignation Document Specification (Stage 2)

**Directive:** 1.2 **Prepared:** 2026-07-29
**Status:** PROPOSED - approval-ready. **This document deliberately contains no final legal wording.** It specifies approved-content SECTIONS with sanitized placeholders; the actual clause wording is written and approved by the owners named in `../requirements/Stage2ApprovalWorksheet.md` (rows 5-8).

Refines the draft structures in `ControlledCommunicationTemplates.md` sections 2-3 into implementation-ready section specifications for DOC-01 and DOC-02.

## 0. Vocabulary the wording owners must respect

These four concepts are distinct and templates must not blur them:

| Concept | Meaning | Field |
| --- | --- | --- |
| Acknowledgement of receipt | "We received your resignation on X." States a fact; accepts nothing. | `case.resignation_received_date` |
| Acceptance of resignation | "The company accepts your resignation." A decision by the employer. | approved wording + approver identity |
| Confirmation of last working date | The final day the employee performs duties. | `case.confirmed_last_working_date` |
| Confirmation of effective separation date | The date (DOC-02: and exact time) employment/access ends - may differ from the last working date. | `case.effective_separation_date` / `_time` |

## 1. Common rules (both documents)

1. **No wording is copied from the DMAIC sample letter** - no real person, address, date, signature or phrasing from the appendices may enter any template, fixture or test.
2. Placeholders use the `[[FIELD]]` form and bind 1:1 to `DocumentFieldDictionary.md` entries. No placeholder may exist without a dictionary row.
3. **Policy-sensitive sections** (final pay, deductions, notice pay, leave pay, property return) are placeholders for APPROVED STATIC WORDING owned by the final-pay/property owners. Templates must not state that any deduction will occur unless the approved policy wording expressly permits it. **No amounts are ever generated.**
4. **No AI rewriting or "improvement" of approved wording at generation time** (DEC-004). Rendering is substitution only.
5. Variability comes from **optional approved clauses** (each individually approved, versioned and selectable by the preparer), not unrestricted free-text editing.
6. An exceptional letter that the sections cannot express uses the **manual-exception process** (DOC-04), retaining uploaded final document, reason, preparer, approver, version, issue evidence and audit history.
7. Encoding-safe rendering; no placeholder may leak (`[[...]]` must never appear in output); locale/timezone-correct dates (America/Jamaica display).

## 2. DOC-01 — Resignation acceptance (with notice): section specification

| # | Section | Content rule | Fields / clause owner |
| --- | --- | --- | --- |
| 1 | Company letterhead area | Approved brand asset via the controlled branding mechanism (`DocumentOutputSpecification.md` section 5); synthetic placeholder in development. | brand owner (worksheet row 16) |
| 2 | Confidentiality marking | Approved marking, e.g. classification label; wording owner HR Manager. | static |
| 3 | Recipient block | `[[EMPLOYEE_LEGAL_NAME]]` followed by `[[EMPLOYEE_ADDRESS]]`. **Superseded by DEC-054**: the Stage 2 "no postal address" rule no longer holds for DOC-01, because the supplied HR sample letter is addressed. The address is typed by HR from the resignation letter scan (the directory holds none), is required before the letter can be submitted, and appears in the letter only - never in logs, emails or audit metadata. | `case.employee_address` (HR-entered) |
| 4 | Document date | `[[DOCUMENT_DATE]]` | `document.date` |
| 5 | Greeting | Approved salutation + `[[EMPLOYEE_NAME]]` (or approved preferred-name rule). | wording owner |
| 6 | Subject | Approved subject naming the case: includes `[[CASE_REFERENCE]]`. | `case.reference` |
| 7 | Resignation acknowledgement section | States receipt on `[[RESIGNATION_RECEIVED_DATE]]` and the employer's acceptance. Acknowledgement and acceptance wording are separate approved sentences (section 0). | wording owner (row 5) |
| 8 | Confirmed-date section | Confirms `[[CONFIRMED_LAST_WORKING_DATE]]` as the last working date and `[[EFFECTIVE_SEPARATION_DATE]]` as the effective separation date; the two sentences are distinct and both required. | wording owner (row 5) |
| 9 | Property-return wording | Approved HR sample wording naming the items and a return date: `[[PROPERTY_RETURN_DEADLINE]]`. The deadline is NOT a new rule - it restates `[[CONFIRMED_LAST_WORKING_DATE]]`, the date already confirmed on the case (DEC-054). Required before submission. | property wording owner |
| 10 | Final-pay policy wording | APPROVED STATIC WORDING ONLY - policy-sensitive (row 7). The HR sample supplied under DEC-054 is that approved wording, and it does state that outstanding amounts will be deducted from the final payment. The platform reproduces the sentence and **computes nothing**: no amount, entitlement or deduction is calculated, stored or sent (CLAUDE.md rule 10). | final-pay wording owner |
| 11 | Contact/follow-up section | Approved sentence naming the HR contact route (role-based, not personal contact details). | wording owner |
| 12 | Closing | Approved closing phrase. | wording owner |
| 13 | Approver identity | `[[APPROVER_NAME]]`, `[[APPROVER_TITLE]]` - the authenticated HR Manager who approved this version (DEC-025 Option B record; **no signature image**). | `approver.hr_manager` |
| 14 | Document reference/version | Case reference, document version, template version, generation timestamp, checksum (short form). | system fields 25-27, 31 |

Optional approved clauses (each versioned; preparer selects, never edits): notice-period statement using `[[NOTICE_PERIOD]]`; handover-expectation sentence; benefits-contact pointer. Each requires its own owner approval before activation.

### 2.1 Issuing DOC-01 by email (DEC-054)

After the existing maker-checker approval and rendering, the HR Manager may issue
the letter to the employee by email. This is the same authority that approves it:
employee-facing documents keep maker-checker, so issuing stays management-grade.

- **Recipient**: the employee email recorded on the case. No address, no send.
- **Copies**: HR colleagues the manager selects from a directory dropdown -
  directory records whose department reads as Human Resources plus the people
  holding HR roles in the application. The dropdown shows masked addresses only.
- **Attachment**: the rendered PDF, read from object storage and verified against
  the checksum recorded at render time. The bytes are never duplicated into the
  notification record or the outbox, and a tampered or missing object fails the
  send rather than mailing an empty letter.
- **Transport**: the ordinary transactional outbox and provider boundary, so
  development captures the message instead of delivering it. Copied addresses are
  encrypted together as one value with readable names and masks alongside.
- **Finality**: an issued letter cannot be recalled. A correction goes through
  supersession, which opens a new version through the same approval chain.
- **Audit**: `DOC_ISSUED_BY_EMAIL` records the document, version, notification
  record, destination mask and the copied names and masks - never an address.

## 3. DOC-02 — Immediate resignation acknowledgement: section specification

Sections 1-6, 9-14 as DOC-01, with these differences:

| # | Section | Content rule |
| --- | --- | --- |
| 7 | Resignation acknowledgement section | States receipt on `[[RESIGNATION_RECEIVED_DATE]]` of a resignation **effective immediately** and the employer's acknowledgement. Whether the wording is "acceptance" or "acknowledgement" is a policy choice for the wording owner (row 6) - the vocabulary distinction in section 0 applies. |
| 8 | Effective-date section | Confirms `[[EFFECTIVE_SEPARATION_DATE]]` **and the exact effective time** as applied. A confirmed-last-working-date sentence appears only when it differs meaningfully and policy wording covers it. |
| 8b | Notice-treatment placeholder | APPROVED STATIC WORDING ONLY (row 6): any statement about un-served notice is policy wording; **no generated amounts, no implied deductions** unless expressly permitted by approved wording. |

## 4. Placeholder inventory (both documents)

```text
[[DOCUMENT_DATE]]                 -> document.date
[[EMPLOYEE_NAME]]                 -> employee.legal_name
[[CASE_REFERENCE]]                -> case.reference
[[RESIGNATION_RECEIVED_DATE]]     -> case.resignation_received_date
[[CONFIRMED_LAST_WORKING_DATE]]   -> case.confirmed_last_working_date
[[EFFECTIVE_SEPARATION_DATE]]     -> case.effective_separation_date
[[EFFECTIVE_SEPARATION_TIME]]     -> case.effective_separation_time   (DOC-02)
[[NOTICE_PERIOD]]                 -> case.notice_period               (optional clause)
[[APPROVER_NAME]]                 -> approver.hr_manager (name)
[[APPROVER_TITLE]]                -> approver.hr_manager (title)
```

## 5. Policy-sensitive approval flags

The following are flagged as policy-sensitive approval items and CANNOT be finalized by the implementation team: final-pay wording; deduction wording (only permitted if approved policy wording expressly allows a deduction statement); notice-pay wording; leave-pay wording; property-return wording; immediate-resignation notice-treatment wording. Owners are assigned in worksheet rows 6, 7 and 8.
