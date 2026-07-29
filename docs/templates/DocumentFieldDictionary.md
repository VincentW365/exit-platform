# Document Field Dictionary (Stage 2)

**Directive:** 1.2 **Prepared:** 2026-07-29
**Status:** PROPOSED - approval-ready; no field becomes generatable until Directive 2 implements it under the approved decisions.

Canonical definition of every field proposed for Stage 2 controlled documents (DOC-01, DOC-02, DOC-03, DOC-04 in `ControlledDocumentCatalogue.md`).

## Binding rules

1. **No pay data as generated fields.** Salary, final-pay amount, notice-pay amount, vacation-pay amount, deductions, loan balances, commission and entitlement calculations are **not** document fields in Directive 2. Any final-pay or deduction wording must be approved **static template wording** (policy-owner approved), and **the application must not calculate entitlements** (CLAUDE.md rule 10).
2. **Recipient postal address is restricted personal data** and is omitted unless the approved delivery method requires it (it does not in Stage 2, where issuance is manual).
3. **Last working date and effective separation timestamp are not interchangeable** (BR-CASE-005/006). Templates must reference the specific concept.
4. Every field has exactly one authoritative source and a verification rule; **an incorrect but technically valid source value must not pass silently** - fields marked "verify" below are displayed with their source and value on the review screen and require explicit preparer confirmation before approval can be requested.
5. Fields marked "invalidates approval" are **material fields** (DEC-005): changing one after approval invalidates the approval and forces a new document version.
6. "Audit metadata" = may the VALUE appear in audit metadata (the field NAME may always appear in changed-field lists).

## Field table A — identity and sourcing

Source key: SNAP = immutable employee snapshot; CASE = verified case field; SYS = system-generated; USER = authorized user at action time; TPLV = pinned template/version metadata.

| # | Canonical name | Display label | Type | Source of truth | From snapshot? | Verify on review? | Required? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `case.reference` | Case reference | string | CASE (caseNumber) | no | no (system) | yes |
| 2 | `employee.source_id` | Employee ID | string | SNAP | yes | yes | yes |
| 3 | `employee.legal_name` | Employee name | string | SNAP | yes | **yes** | yes |
| 4 | `employee.display_name` | Preferred name | string | SNAP | yes | yes | no (greeting only) |
| 5 | `employee.postal_address` | Recipient address | string | NOT COLLECTED in Stage 2 | - | - | **omitted** (rule 2) |
| 6 | `employee.department` | Department | string | SNAP | yes | yes | yes (DOC-03) |
| 7 | `employee.location` | Location | string | SNAP | yes | yes | yes (DOC-03) |
| 8 | `employee.position` | Position | string | SNAP (jobTitle) | yes | yes | DOC-03 yes; letters optional |
| 9 | `employee.manager_name` | Manager | string | CASE participant/assignment | no | **yes** | DOC-03 (pending row 10) |
| 10 | `case.departure_type` | Departure type | enum | CASE | no | yes | yes |
| 11 | `case.resignation_received_date` | Resignation received | date | CASE (receivedAt) | no | **yes** | DOC-01/02 yes |
| 12 | `case.proposed_last_working_date` | Proposed last working date | date | CASE | no | yes | no |
| 13 | `case.confirmed_last_working_date` | Confirmed last working date | date | CASE | no | **yes** | DOC-01 yes |
| 14 | `case.effective_separation_date` | Effective separation date | date | CASE (effectiveSeparationAt, Jamaica date part) | no | **yes** | yes |
| 15 | `case.effective_separation_time` | Effective separation time | time | CASE (effectiveSeparationAt, Jamaica time part) | no | **yes** | DOC-02/03 yes |
| 16 | `case.notice_status` | Notice status | string | CASE (recorded, never calculated) | no | yes | no |
| 17 | `case.notice_period` | Notice period (days) | integer | CASE (noticeProvidedDays) | no | yes | no |
| 18 | `document.date` | Document date | date | USER-confirmed, defaults today (Jamaica) | no | yes | yes |
| 19 | `approver.hr_manager` | Approving HR Manager | string+id | USER (authenticated approver at approval time) | no | no (system-bound) | yes at approval |
| 20 | `approver.manager` | Approving Manager | string+id | USER (authenticated approver) | no | no | DOC-03 (pending row 10) |
| 21 | `ack.employee_status` | Employee acknowledgement status | enum | USER (HR-recorded) | no | yes | DOC-03 yes |
| 22 | `ack.employee_method` | Acknowledgement method | enum | USER | no | yes | when status = obtained |
| 23 | `ack.employee_date` | Acknowledgement date | date | USER | no | yes | when status = obtained |
| 24 | `exception.reason` | Manual exception reason | string | USER | no | yes | DOC-04 yes |
| 25 | `template.version` | Template version | string | TPLV | no | no | yes |
| 26 | `document.version` | Document version | integer | SYS | no | no | yes |
| 27 | `document.generated_at` | Generated timestamp | instant | SYS | no | no | yes |
| 28 | `document.approved_at` | Approved timestamp | instant | SYS | no | no | at approval |
| 29 | `document.issued_at` | Issued timestamp | instant | SYS (on manual-issue record) | no | no | at issue |
| 30 | `document.issued_method` | Issued method | enum | USER (hand delivery / registered mail / other approved) | no | yes | at issue |
| 31 | `document.checksum` | Rendered-document checksum | sha256 | SYS | no | no | yes after render |

## Field table B — classification and control rules

Export = may appear in a controlled export; Audit = value may appear in audit metadata.

| # | Field | Classification | Validation | Formatting rule | Invalidates approval? | Export? | Audit value? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `case.reference` | Internal | `OFF-\d{4}-\d{4}` | verbatim | n/a (immutable) | yes | yes |
| 2 | `employee.source_id` | Confidential | non-empty; matches source | verbatim | **yes** | yes | yes |
| 3 | `employee.legal_name` | Confidential | non-empty, 1-200 chars; never silently re-cased (TemplateCatalogue rule) | as stored | **yes** | no (baseline export excludes names) | **no** |
| 4 | `employee.display_name` | Confidential | <=100 chars | as stored | no | no | **no** |
| 5 | `employee.postal_address` | RESTRICTED_HR | not collected | - | - | **no** | **no** |
| 6 | `employee.department` | Internal | active DEPARTMENT config value | verbatim | **yes** (DOC-03) | yes | yes |
| 7 | `employee.location` | Internal | active LOCATION config value | verbatim | **yes** (DOC-03) | yes | yes |
| 8 | `employee.position` | Internal | <=120 chars | verbatim | yes (DOC-03) | yes | yes |
| 9 | `employee.manager_name` | Internal | active user reference | display name at time | **yes** (DOC-03) | no | id only |
| 10 | `case.departure_type` | Confidential | enum | approved phrase per template | **yes** | yes | yes |
| 11 | `case.resignation_received_date` | Confidential | not future; matches case | `14 Aug 2026` | **yes** | yes (ISO) | yes (ISO) |
| 12 | `case.proposed_last_working_date` | Confidential | valid date | `14 Aug 2026` | no | yes (ISO) | yes (ISO) |
| 13 | `case.confirmed_last_working_date` | Confidential | valid date; >= received date | `14 Aug 2026` | **yes** | yes (ISO) | yes (ISO) |
| 14 | `case.effective_separation_date` | Confidential | derived from exact instant | `14 Aug 2026` | **yes** | yes (ISO) | yes (ISO) |
| 15 | `case.effective_separation_time` | Confidential | exact instant exists | `5:00 PM` + zone note | **yes** | yes (ISO) | yes (ISO) |
| 16 | `case.notice_status` | Confidential | approved phrases only | verbatim | **yes** | yes | yes |
| 17 | `case.notice_period` | Confidential | 0-365 | integer + "days" | **yes** | yes | yes |
| 18 | `document.date` | Internal | within case timeframe; not future beyond policy | `14 Aug 2026` | **yes** | yes (ISO) | yes (ISO) |
| 19 | `approver.hr_manager` | Internal | authenticated approver | name + title at time | n/a (set BY approval) | no | id only |
| 20 | `approver.manager` | Internal | authenticated approver | name + title at time | n/a | no | id only |
| 21 | `ack.employee_status` | Confidential | OBTAINED_SIGNED_UPLOAD / OBTAINED_WITNESSED / NOT_OBTAINED / NOT_APPLICABLE (proposed; DEC-025) | approved phrase | **yes** (DOC-03) | yes (status only) | yes (status only) |
| 22 | `ack.employee_method` | Confidential | enum per DEC-025 | approved phrase | **yes** (DOC-03) | yes | yes |
| 23 | `ack.employee_date` | Confidential | not future | `14 Aug 2026` | **yes** (DOC-03) | yes (ISO) | yes (ISO) |
| 24 | `exception.reason` | Confidential | 10-500 chars | verbatim | **yes** (DOC-04) | no | **no** (free text) |
| 25 | `template.version` | Internal | active approved version at generation | verbatim | n/a (pinned) | yes | yes |
| 26 | `document.version` | Internal | monotonic per case+type | integer | n/a | yes | yes |
| 27 | `document.generated_at` | Internal | system clock | ISO / Jamaica display | n/a | yes | yes |
| 28 | `document.approved_at` | Internal | system clock | ISO / Jamaica display | n/a | yes | yes |
| 29 | `document.issued_at` | Internal | not before approved_at | ISO / Jamaica display | n/a | yes | yes |
| 30 | `document.issued_method` | Confidential | approved enum | approved phrase | n/a (post-approval record) | yes | yes |
| 31 | `document.checksum` | Internal | sha256 hex | truncated display, full stored | n/a | yes | yes |

## Explicitly excluded fields (rule 1)

`salary`, `final_pay_amount`, `notice_pay_amount`, `vacation_pay_amount`, `deduction_*`, `loan_balance`, `commission_*`, any entitlement calculation, `reason_for_leaving` free text (restricted; never in documents), `rehire_eligibility` (restricted; DOC-03 stores it as a restricted record field, never rendered into employee-facing output). Where the source DMAIC sample letter mentions pay handling, the equivalent is **approved static wording** owned by the final-pay policy owner (worksheet row 7) - never a generated value.
