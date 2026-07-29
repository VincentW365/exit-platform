# Controlled Document Catalogue (Stage 2)

**Directive:** 1.2 **Prepared:** 2026-07-29
**Status:** PROPOSED - approval-ready. No template content here is issuable; every entry requires the owner sign-offs listed in `../requirements/Stage2ApprovalWorksheet.md`.

This catalogue defines the Stage 2 **controlled document** set in implementation-ready detail. It refines the broader `TemplateCatalogue.md` (which also lists notifications and later-stage documents). Cross-reference: catalogue IDs below map onto existing template IDs where they exist.

Boundaries for Directive 2:

- **Notification emails are not controlled documents in Directive 2** (they are `TPL-NOT-*`/`TPL-EXT-*`, Stage 5).
- **Exit-survey content belongs to Directive 3.**
- **Asset and clearance documents belong to later directives** (`TPL-DOC-005/006`, Stage 4).
- The **termination placeholder is not an approved termination letter** - see DOC-05.

## Catalogue summary

| Catalogue ID | Document type | Maps to | Stage | Approval readiness |
| --- | --- | --- | --- | --- |
| DOC-01 | RESIGNATION_ACCEPTANCE_WITH_NOTICE | TPL-DOC-001 | 2 | Wording sections defined; policy-sensitive clauses need owners (worksheet rows 5, 7, 8) |
| DOC-02 | IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT | TPL-DOC-002 | 2 | Wording sections defined; policy-sensitive clauses need owners (worksheet rows 6, 7, 8) |
| DOC-03 | EMPLOYEE_ACTION_FORM_OFFBOARDING | TPL-DOC-004 | 2 | Structure mapped; approval order requires HR/Sponsor confirmation (worksheet rows 9-14) |
| DOC-04 | MANUAL_EXCEPTION_DOCUMENT | (new) | 2 | Process defined; needs HR Manager approval (worksheet row 17) |
| DOC-05 | TERMINATION_DOCUMENT_PLACEHOLDER | TPL-DOC-003 | 2 boundary only | **Non-issuable by design**; content deferred |

---

## DOC-01 — RESIGNATION_ACCEPTANCE_WITH_NOTICE

| Attribute | Definition |
| --- | --- |
| Purpose | Formally acknowledge receipt of a resignation given with notice, accept it, and confirm the agreed dates. |
| Applicable departure type | RESIGNATION_WITH_NOTICE only. |
| Document owner | HR Manager (content/policy wording owner per worksheet rows 7-8). |
| Preparer | HR Officer (or HR Manager). |
| Required approver | HR Manager (maker-checker per DEC-005). |
| Intended recipient | The departing employee. |
| Confidentiality classification | CONFIDENTIAL (case-inherited; RESTRICTED if the case is restricted). |
| Required fields | See `DocumentFieldDictionary.md`: case reference, employee legal name, document date, resignation received date, confirmed last working date, effective separation date, approver name/title, template version, document version, checksum. |
| Optional fields | Preferred name (greeting only), notice status/period wording, approved optional clauses (property return, final-pay policy pointer, contact section). |
| Prohibited fields | Salary, final-pay/notice-pay/vacation-pay amounts, deductions, loan balances, commission, entitlement calculations; reason for leaving; rehire eligibility; recipient postal address unless the approved delivery method requires it; free-text body edits. |
| Output format | Accessible HTML preview + final PDF (per `DocumentOutputSpecification.md`, pending worksheet row 15). |
| Lifecycle | Document-instance lifecycle in `DocumentLifecycleAndApprovalSpecification.md`. |
| Retention class placeholder | `RET-DOC-EMPLOYEE-LETTER` - duration OPEN under DEC-023. |
| Manual fallback | DOC-04 manual-exception process; or fully manual letter recorded as a baseline fact during baseline capture. |
| Implementation stage | Directive 2. |
| Approval readiness | Sections specified (`ResignationDocumentSpecification.md`); final wording, final-pay and property-return clauses require the owners in worksheet rows 5/7/8. |

## DOC-02 — IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT

| Attribute | Definition |
| --- | --- |
| Purpose | Acknowledge a resignation effective immediately (or with unworkable notice) and confirm the effective separation date/time actually applied. |
| Applicable departure type | IMMEDIATE_RESIGNATION only. |
| Document owner | HR Manager. |
| Preparer | HR Officer (or HR Manager). |
| Required approver | HR Manager. |
| Intended recipient | The departing employee. |
| Confidentiality classification | CONFIDENTIAL (case-inherited). |
| Required fields | As DOC-01, except the confirmed-last-working-date section reflects immediate effect; effective separation date AND exact time are mandatory. |
| Optional fields | Approved optional clauses (property return, final-pay policy pointer, contact section); acknowledgement-of-non-notice wording (policy-sensitive). |
| Prohibited fields | As DOC-01. Additionally: no wording implying accepted/waived notice obligations unless the approved policy clause says so. |
| Output format | As DOC-01. |
| Lifecycle | As DOC-01. |
| Retention class placeholder | `RET-DOC-EMPLOYEE-LETTER` (OPEN under DEC-023). |
| Manual fallback | As DOC-01. |
| Implementation stage | Directive 2. |
| Approval readiness | As DOC-01 (worksheet rows 6/7/8). |

## DOC-03 — EMPLOYEE_ACTION_FORM_OFFBOARDING

| Attribute | Definition |
| --- | --- |
| Purpose | Digital offboarding instance of the Employee Action Form: the internal record of the separation action and its sign-off chain. |
| Applicable departure type | All approved departure types (per-type applicability matrix REQUIRES HR/SPONSOR CONFIRMATION). |
| Document owner | HR Manager. |
| Preparer | HR Officer. |
| Required approver | Existing hierarchy digitized without authority change (DEC-010): proposed Manager approval -> HR approval, plus employee acknowledgement handling; exact order pending worksheet row 10. |
| Intended recipient | Internal HR record (not sent to the employee; a printable output may support the manual process). |
| Confidentiality classification | RESTRICTED (contains rehire eligibility and reason references). |
| Required fields | See `EmployeeActionFormOffboardingSpecification.md` sections 1-18. |
| Optional fields | General HR remarks (restricted, length-limited); checklist placeholders. |
| Prohibited fields | All legacy non-offboarding action types and every pay/loan/commission calculation field (documented as OUTSIDE THE HR OFFBOARDING APPLICATION SCOPE, with the exclusion mapping preserved). |
| Output format | Digital record; approved printable output per `DocumentOutputSpecification.md`. |
| Lifecycle | Document-instance lifecycle plus the attestation rules of DEC-025. |
| Retention class placeholder | `RET-DOC-ACTION-FORM` (OPEN under DEC-023). |
| Manual fallback | Legacy paper form, retained as scanned evidence via the controlled attachment process. |
| Implementation stage | Directive 2. |
| Approval readiness | Structure mapped; blocked on worksheet rows 9-14 (scope, order, acknowledgement, checklist meaning). |

## DOC-04 — MANUAL_EXCEPTION_DOCUMENT

| Attribute | Definition |
| --- | --- |
| Purpose | Controlled path for an exceptional, individually drafted letter that the approved templates cannot express, without losing version, approval or audit evidence. |
| Applicable departure type | Any (exception-gated). |
| Document owner | HR Manager. |
| Preparer | HR Officer/HR Manager (drafted outside the system; uploaded as evidence). |
| Required approver | HR Manager (must not be the preparer where staffing allows; conflict noted in the record when it is). |
| Intended recipient | As approved per exception. |
| Confidentiality classification | Case-inherited; minimum CONFIDENTIAL. |
| Required fields | Exception reason; uploaded final document (controlled attachment, quarantine rules apply); preparer; approver; version; issue evidence (method/timestamp/recipient classification); audit history. |
| Optional fields | Reference to the template the exception replaces. |
| Prohibited fields | None enforceable on the uploaded body - which is exactly why the exception REQUIRES manager approval and is flagged in reporting. |
| Output format | Uploaded PDF (preferred); the system never renders exception content. |
| Lifecycle | Restricted subset of the instance lifecycle: DRAFT -> PENDING_APPROVAL -> APPROVED -> MANUALLY_ISSUED (+ SUPERSEDED/VOIDED). |
| Retention class placeholder | `RET-DOC-EMPLOYEE-LETTER` (OPEN under DEC-023). |
| Manual fallback | It IS the fallback. |
| Implementation stage | Directive 2. |
| Approval readiness | Process defined; needs HR Manager approval (worksheet row 17). |

## DOC-05 — TERMINATION_DOCUMENT_PLACEHOLDER

| Attribute | Definition |
| --- | --- |
| Purpose | Preserve the architectural boundary for future termination communications. **It is not an approved termination letter, contains no legal or policy wording, and exists only so the model does not need redesign later.** |
| Applicable departure type | TERMINATION (boundary only). |
| Document owner | HR Manager with authorized policy/legal owner. |
| Preparer / approver | Not applicable until an approved template is supplied by a later directive. |
| Intended recipient | Not applicable. |
| Confidentiality classification | RESTRICTED. |
| Required/optional fields | None defined; deliberately empty. |
| Prohibited fields | All content: **Directive 2 must not generate or issue any termination document.** The template record may exist only as non-issuable INACTIVE configuration. Resignation wording must never be substituted for a termination (existing TemplateCatalogue rule preserved). |
| Output format | None. |
| Lifecycle | Template lifecycle only, pinned at DRAFT/non-activatable. |
| Retention class placeholder | Not applicable. |
| Manual fallback | Current manual termination process continues unchanged. |
| Implementation stage | Boundary in Directive 2; content in a later, separately approved directive. |
| Approval readiness | Not applicable by design (worksheet row 13 records the handling rule). |
