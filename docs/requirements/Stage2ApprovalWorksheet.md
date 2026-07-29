# Stage 2 Approval Worksheet

**Directive:** 1.2 **Prepared:** 2026-07-29
**Status:** BLANK - no row is approved. This worksheet is the capture instrument for the Stage 2 approval meeting. A completed row is transcribed into `DecisionRegister.md` (final wording, approver, date); a checked box here alone changes nothing.

Decision capture per row: **Decision:** ☐ Approve ☐ Revise ☐ Defer ☐ Reject | **Final wording:** ______ | **Approver:** ______ | **Date:** ______ | **Conditions:** ______

| # | Question | Recommendation (proposed) | Decision owner |
| --- | --- | --- | --- |
| 1 | DEC-004: which artefact is authoritative for document wording? | Option B - versioned deterministic approved templates; AI never decides wording/dates/approvals/issuance; no employee data to external AI (see `Stage2DocumentDecisionPack.md`) | Project Sponsor / HR Manager / IT |
| 2 | DEC-005: who prepares, who approves, what binds approval? | Officer prepares; Manager approves employee-facing letters; approval binds to exact version+checksum; material change invalidates; manual issue recorded with method/timestamp/recipient classification | HR Manager |
| 3 | DEC-010: digitize the whole generic action form, or an offboarding-specific instance? | Option B - offboarding-specific instance preserving existing sign-off authority | HR Manager / Project Sponsor |
| 4 | DEC-025: what constitutes a valid digital approval/attestation? | Option B - authenticated in-app attestation records; no signature images; no advanced/qualified e-signature claim; employee acknowledgement via upload/witness/NOT_OBTAINED/NOT_APPLICABLE | HR Manager / Legal or policy owner |
| 5 | Resignation-with-notice template: purpose and section list (DOC-01) | Approve the 14 sections in `../templates/ResignationDocumentSpecification.md` section 2 as the wording skeleton | HR Manager (content owner) |
| 6 | Immediate-resignation template: purpose and section list (DOC-02) | Approve sections per specification section 3, incl. notice-treatment placeholder policy | HR Manager (content owner) |
| 7 | Final-pay wording: who owns and writes the approved static clause? | Assign owner (HR Manager + Finance/policy); no amounts, no deduction statement unless expressly permitted | Project Sponsor to assign |
| 8 | Property-return wording: who owns the approved static clause? | Assign owner (HR Manager + asset owner) | Project Sponsor to assign |
| 9 | Employee Action Form scope | Offboarding-only instance; legacy non-offboarding fields excluded per specification section 2 | HR Manager / Project Sponsor |
| 10 | Employee Action Form approval order | Proposed: Employee acknowledgement -> Manager approval -> HR approval; confirm exact order and final HR approver (spec Q-1, Q-7) | HR Manager |
| 11 | Employee acknowledgement handling | Per DEC-025 r.6: upload / witnessed / NOT_OBTAINED(+reason+review) / NOT_APPLICABLE; confirm mandatoriness by type (Q-2/Q-3/Q-4) | HR Manager / policy owner |
| 12 | Immediate-resignation exception handling | NOT_OBTAINED permitted with reason and HR Manager review (Q-2) | HR Manager |
| 13 | Termination handling in Stage 2 | DOC-05 stays a non-issuable placeholder; no termination generation/issuance until an approved template arrives by later directive | HR Manager / Project Sponsor |
| 14 | HR/Payroll checklist meaning | Treat checklist initials as task-completion evidence, not approval authority (spec Q-6) | HR Manager (+ Payroll owner) |
| 15 | Final output format | Option A: accessible HTML preview + final PDF; no DOCX in MVP (also resolves REQ-DOC-009) | HR Manager / IT |
| 16 | Branding asset owner | Assign owner to supply approved brand asset before pilot; synthetic placeholder until then | Project Sponsor |
| 17 | Manual-exception document process | DOC-04 process as specified (upload + reason + approver + issue evidence + audit) | HR Manager |
| 18 | Pilot activation rule | Document features ship dark: flags default off; activation only via separately approved pilot decision (DEC-007 confirmation) | Project Sponsor / HR Manager |

## Row capture blocks

(One block per row for the meeting record; duplicate as needed.)

```text
Row #: ____
Decision: [ ] Approve   [ ] Revise   [ ] Defer   [ ] Reject
Final wording: _______________________________________________
Approver: ____________________  Approval date: ________________
Conditions: __________________________________________________
```

## Sign-off

| Role | Name | Signature/attestation | Date |
| --- | --- | --- | --- |
| Project Sponsor | | | |
| HR Manager / process owner | | | |
| Business Analyst / Product Owner | | | |
| IT representative | | | |
| Privacy representative (where applicable) | | | |
| Legal or policy owner (DEC-025 and policy-sensitive letter wording) | | | |

> Reminder: rows 4, 7 and 8 require the legal/policy owner; rows 1 and 15 require IT; nothing is implemented from this worksheet until `DecisionRegister.md` reflects the outcomes.
