# Stage 2 Document Readiness Report

**Directive:** 1.2 **Prepared:** 2026-07-29
**Verdict:** **Directive 2 is NOT ready.** The technical foundation is complete; every remaining blocker is a business approval listed in section 20.

## 1. Stage 1 technical acceptance reference

Commits `46b607c` + `927f9ad`; acceptance evidence in `Stage1AcceptanceReport.md` (84 unit / 66 integration / 9 E2E tests, hardened local database, production fail-closed guards). Acceptance covers synthetic, local, non-production development only.

## 2. Directive 2 scope

Controlled, versioned document generation and approval: template definitions and immutable versions; typed placeholders; validation-gated generation; preview and review; maker-checker approval; correction/supersession; checksum-bound evidence; restricted access; the digital Employee Action Form (offboarding instance); manual-exception documents.

## 3. Directive 2 exclusions

Live email/dispatch, AI-generated wording, full workflow engine, surveys, payroll action, electronic-signature claims not approved by the policy/legal owner, termination document generation (placeholder boundary only), notification templates (Stage 5), asset/clearance documents (Stage 4).

## 4. Governing decisions and statuses

| Decision | Status | Owner |
| --- | --- | --- |
| DEC-004 authoritative automation model | PROVISIONAL | Sponsor / HR Manager / IT |
| DEC-005 communication approval | PROVISIONAL | HR Manager |
| DEC-007 baseline protection | PROVISIONAL | Sponsor / HR Manager |
| DEC-010 action form hierarchy | PROVISIONAL | HR Manager / Sponsor |
| DEC-025 signatures/attestations | **OPEN** | HR Manager / Legal or policy owner |

Presented approval-ready in `../requirements/Stage2DocumentDecisionPack.md`; capture instrument `../requirements/Stage2ApprovalWorksheet.md` (18 rows).

## 5. Source-document issues discovered

1. The legacy Employee Action Form is a **generic** HR action form; digitizing it whole would drag recruitment/salary/transfer/leave into scope (resolved by the DEC-010 Option B recommendation).
2. The form's signature block mixes approvals, acknowledgements and checklist initials without stating which carry authority (worksheet row 14 / spec Q-6).
3. The DMAIC sample resignation letter interleaves acknowledgement, acceptance and date confirmation and contains personal data; concepts are separated in `ResignationDocumentSpecification.md` section 0 and no wording was copied.
4. Existing baseline state names differ from the finer-grained lifecycle needed for maker-checker evidence; deltas recorded (not silently resolved) in `DocumentLifecycleAndApprovalSpecification.md` section 4.
5. Final-pay/property wording in the sample letter is policy-sensitive; owners are unassigned (worksheet rows 7-8).

## 6. Sensitive-data handling

No name, address, employee number, phone number, personal email, signature, completed form or screenshot from the DMAIC appendices was copied into any new document. All examples are synthetic placeholders. The source DMAIC remains outside the Git working tree.

## 7. Controlled document catalogue

Five types (`../templates/ControlledDocumentCatalogue.md`): DOC-01 RESIGNATION_ACCEPTANCE_WITH_NOTICE, DOC-02 IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT, DOC-03 EMPLOYEE_ACTION_FORM_OFFBOARDING, DOC-04 MANUAL_EXCEPTION_DOCUMENT, DOC-05 TERMINATION_DOCUMENT_PLACEHOLDER (non-issuable by design).

## 8. Document field count

**31 defined fields** (+1 explicitly not collected: recipient postal address) in `../templates/DocumentFieldDictionary.md`, plus an explicit exclusion list for all pay/entitlement data.

## 9. Field source-of-truth summary

Snapshot-sourced: 7 (employee identity/org fields). Verified case fields: 9 (dates, type, notice). User-at-action-time: 8 (document date, acknowledgement set, issue method, exception reason, approvers). System/template: 7 (versions, timestamps, checksum). Every field carries a verification rule; 17 fields are material (change invalidates approval).

## 10. Approval model recommendation

DEC-005 model: Officer prepares -> Manager approves; approval bound to exact version + rendered checksum; material change invalidates; manual issue requires user/method/timestamp/recipient classification/audit. DEC-025 Option B attestations; no signature images; employee acknowledgement via upload/witnessed/NOT_OBTAINED/NOT_APPLICABLE.

## 11. Output-format recommendation

Option A: accessible HTML preview + final Letter-size PDF; deterministic rendering; scrubbed metadata; SHA-256; authorized audited downloads only; no DOCX in MVP (also resolves OPEN REQ-DOC-009 if approved as recommended).

## 12. Employee Action Form scope recommendation

DEC-010 Option B: offboarding-specific instance, 18 sections, existing authority preserved pending confirmation of the 7 hierarchy questions.

## 13. Legacy-form fields excluded

New hire/rehire, promotion/demotion, salary change (+ increase reasons), transfer, leave processing, salary/rate fields, payroll/loan/commission/final-pay calculation - each recorded with its reason in `EmployeeActionFormOffboardingSpecification.md` section 2 (mapping preserved, not silently removed).

## 14. Policy-sensitive wording requiring approval

Final-pay clause; deduction wording (only if approved policy wording expressly permits); notice-pay; leave-pay; property-return; immediate-resignation notice-treatment. Owners to be assigned in worksheet rows 7-8; legal/policy owner participates per DEC-025 row.

## 15. Unresolved questions

Worksheet rows 1-18; Employee Action Form questions Q-0 through Q-11; lifecycle naming deltas (section 5.4 above); REQ-DOC-009 output decision.

## 16. Approval owners

Project Sponsor; HR Manager/process owner; Business Analyst/Product Owner; IT representative; Privacy representative (attestation IP/device proportionality, restricted fields); Legal or policy owner (DEC-025, policy-sensitive wording).

## 17. Technical prerequisites already satisfied by Stage 1

Authenticated roles + maker-checker enforcement pattern; restricted-case access model with participant gating; immutable audit with checksum discipline; attachment quarantine boundary (used by acknowledgement uploads and DOC-04); optimistic concurrency; version-pinning patterns (snapshot); feature flags defaulting off; synthetic seed and test harnesses; hardened local database with least-privilege runtime.

## 18. Remaining blockers

All business-side: DEC-025 is OPEN; DEC-004/005/010 (+DEC-007 confirmation) are PROVISIONAL; template wording owners unassigned; action-form hierarchy unconfirmed; output format unapproved; no approved brand asset (pilot-blocking only).

## 19. Is Directive 2 ready?

**No.**

## 20. Exact conditions before Directive 2 may run

1. Worksheet rows 1-4 approved and transcribed into `DecisionRegister.md` (DEC-004, DEC-005, DEC-010, DEC-025 with final wording, approver, date). DEC-025 must leave OPEN status.
2. Rows 5-6 approved: section skeletons for DOC-01/DOC-02, with the policy-sensitive placeholders assigned to named owners (rows 7-8). The actual clause wording may follow during Directive 2, but templates remain non-issuable until content status is approved (existing Directive 2 TEMPLATE SCOPE rule).
3. Rows 9-14 confirmed: action-form scope, approval order, acknowledgement handling, checklist meaning, termination boundary.
4. Row 15 approved: output format (resolving REQ-DOC-009).
5. Rows 17-18 approved: manual-exception process and dark-launch/pilot activation rule.
6. Directive 1.1 Stage 1 acceptance acknowledged by the reviewer (already recommended technically).
7. Lifecycle naming deltas (`DocumentLifecycleAndApprovalSpecification.md` section 4) approved so `StateMachines.md`/`TemplateCatalogue.md` can be updated in the same change.

Row 16 (brand asset) blocks **pilot**, not Directive 2 development (synthetic placeholder is permitted in development).
