# Employee Action Form — Offboarding Specification (Stage 2)

**Directive:** 1.2 **Prepared:** 2026-07-29
**Status:** PROPOSED - approval-ready. Maps the legacy form **structurally**; no completed data, names, dates, initials or signatures from the DMAIC appendices appear here or may appear in any implementation artefact.

Implements DEC-010 **Option B** (recommended, not yet approved): an offboarding-specific digital instance preserving the existing sign-off authority, excluding unrelated HR action types.

## 1. Proposed digital sections

| # | Section | Content | Notes |
| --- | --- | --- | --- |
| 1 | Case and employee identification | `case.reference`, `employee.source_id`, `employee.legal_name` | From snapshot after approval; from verified case fields before. |
| 2 | Effective date | `document.date` context + the action's effective date | See sections 7-8; the concepts stay distinct. |
| 3 | Department and location | `employee.department`, `employee.location` | Snapshot-sourced; verified on review. |
| 4 | Offboarding action type | resignation; retirement **only if confirmed in scope** (question Q-0 below); termination; other approved separation type | Enum; maps to `case.departure_type` plus an approved separation-subtype list owned by HR. |
| 5 | Prior employment status snapshot | position, department, status before separation | Snapshot-sourced, read-only. |
| 6 | New employment status | fixed value: separated/offboarded (with subtype) | Never a general status-change field (that is the legacy generic form's job). |
| 7 | Last working date | `case.confirmed_last_working_date` | Distinct from 8. |
| 8 | Effective separation date and time | `case.effective_separation_date` + `_time` | Exact instant; security-relevant (BR-CASE-006). |
| 9 | Reason capture | `reasonCaptureStatus` + approved reason category reference | Taxonomy remains OPEN (DEC-031/IC-S1-008): the form shows the capture status and the category once a taxonomy exists; free-text reason notes stay restricted and are NOT part of the printable output. |
| 10 | Rehire eligibility | restricted field | HR-Manager-only visibility (DEC-032); never in employee-visible output. |
| 11 | General HR remarks | restricted, length-limited text | Guidance text warns against pay data and narrative reasons. |
| 12 | HR operational checklist | checklist items completed by HR | **Completion evidence, not approval** - pending Q-6. |
| 13 | Payroll/Finance operational checklist placeholder | placeholder only in Stage 2 | Meaning (completion vs approval) pending Q-6; the checklist's task content belongs to later workflow stages. |
| 14 | Employee acknowledgement | status/method/date per DEC-025 recommendation 6 | OBTAINED_SIGNED_UPLOAD / OBTAINED_WITNESSED / NOT_OBTAINED(+reason, HR Manager review) / NOT_APPLICABLE (proposed enum). |
| 15 | Manager approval | authenticated attestation record | DEC-025 Option B; order pending Q-1. |
| 16 | HR approval | authenticated attestation record | Which role is final pending Q-7. |
| 17 | Exception and not-obtained handling | reasons, reviewer, evidence references | Q-3/Q-4/Q-5 govern. |
| 18 | Audit and version information | document version, template version, timestamps, checksum, attestation list | System-generated. |

**Explicitly separated concepts** (the legacy form mixes them in one signature block):

- **approval steps** - authority decisions (sections 15-16);
- **acknowledgements** - the employee's acknowledgement (section 14), which is not an approval;
- **operational checklist completions** - work done (sections 12-13), which is evidence, not authority;
- **task evidence** - attachments/references supporting checklist entries;
- **signatures/attestations** - the DEC-025 records that evidence all of the above.

## 2. Legacy fields OUTSIDE THE HR OFFBOARDING APPLICATION SCOPE

The legacy generic form carries fields this application deliberately does not implement. The mapping is preserved here (not silently removed) with the reason for exclusion:

| Legacy field/area | Why excluded |
| --- | --- |
| New hire / rehire action | Recruitment and onboarding are outside product scope (Project.md). |
| Promotion / demotion action | Not an offboarding action; belongs to the legacy/general HR process. |
| Salary change action + salary-increase reasons | Salary/payroll redesign is explicitly out of scope; no pay data in this application's documents. |
| Transfer action | Not an offboarding action. |
| Leave processing | Not an offboarding action. |
| Salary / rate fields | Pay data prohibited in Stage 2 documents (DocumentFieldDictionary rule 1). |
| Payroll calculation, loan balance, commission, final-pay calculation | CLAUDE.md rule 10 and DEC-009: the application never calculates or automatically withholds pay. Final-pay handling stays in the existing payroll process. |

Where the legacy paper form is still needed for those actions, the legacy process continues unchanged - this application neither replaces nor blocks it.

## 3. Proposed approval matrix by departure type — REQUIRES HR/SPONSOR CONFIRMATION

Every cell below is a PROPOSAL for the owners to confirm, amend or reject (worksheet rows 9-14). Nothing here digitizes authority changes: the intent is to mirror current authority exactly once HR states it.

| Departure type | Employee acknowledgement | Manager approval | HR approval |
| --- | --- | --- | --- |
| Resignation with notice | Proposed: required (method per DEC-025 r.6) | Proposed: required | Required - final approver pending Q-7 |
| Immediate resignation | Proposed: NOT_OBTAINED permitted with reason + HR Manager review | Proposed: required; fallback per Q-9 | Required |
| Termination | Pending Q-4 (policy question; restricted handling per DEC-035) | Pending Q-5 | Required |
| Other approved separation | Per subtype policy | Per subtype policy | Required |

## 4. Confirmation questions for HR / Project Sponsor

- **Q-0:** Is retirement in scope as a separation subtype for the MVP?
- **Q-1 (resignation with notice):** exact approval order - proposed Employee acknowledgement -> Manager approval -> HR approval. Confirm or correct.
- **Q-2 (immediate resignation):** may the form proceed with employee acknowledgement NOT_OBTAINED (reason + HR Manager review), given the employee may already be gone?
- **Q-3 (employee unavailable):** what is the approved handling when the employee cannot or will not acknowledge - NOT_OBTAINED with evidence of the attempt?
- **Q-4 (termination):** does termination require employee acknowledgement at all, and if so in what form? (Restricted-case handling per DEC-035 applies regardless.)
- **Q-5 (Manager unavailable / restricted termination):** is Manager approval required for every departure type, and who substitutes when the manager is unavailable or is the subject of restriction?
- **Q-6 (checklists):** do HR and Payroll checklist initials represent task COMPLETION (evidence) or APPROVAL (authority)? The proposal treats them as completion evidence.
- **Q-7 (final HR approval):** which role gives final HR approval - HR Manager, or another authorized HR role?
- **Q-8 (returned for correction):** when an approver returns the form, do prior attestations on unchanged sections survive, or does any return void all attestations? Proposed: any material change voids all attestations (DEC-025 r.5).
- **Q-9 (corrected form after attestations):** confirm the proposed rule - a corrected form is a NEW version; prior versions and their attestations remain visible history.
- **Q-10 (cancellation/voiding):** when a case is cancelled or voided, the form instance is voided with reason and full history retained - confirm.
- **Q-11 (manual fallback):** during outage or baseline capture, the paper form remains authoritative and is retained as scanned evidence via the controlled attachment process - confirm.

## 5. Not implemented in Directive 2

Promotions, new hires, salary changes, transfers, general leave processing, salary-increase reasons, payroll calculation, loan calculation, commission calculation, final-pay calculation (section 2); any UI implementation at all (this directive is documentation-only); unauthenticated employee signature capture (DEC-025 r.7).
