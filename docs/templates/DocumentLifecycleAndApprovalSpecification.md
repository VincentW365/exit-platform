# Document Lifecycle and Approval Specification (Stage 2)

**Directive:** 1.2 **Prepared:** 2026-07-29
**Status:** PROPOSED - approval-ready. State names below refine the existing baseline; the deltas are recorded in section 4 rather than silently rewriting `../architecture/StateMachines.md` or `TemplateCatalogue.md` (change-discipline rule).

## 1. Template lifecycle (proposed)

```text
DRAFT -> IN_REVIEW -> APPROVED -> ACTIVE -> SUPERSEDED
                                    \-> RETIRED
```

| State | Entry conditions | Permitted roles | Allowed actions | Reason required | Audit events | Content may change | Usable for generation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DRAFT | template created/copied from prior version | HR Manager (author), HR Officer (draft assist) | edit, submit for review, abandon | abandon: yes | TEMPLATE_CREATED / TEMPLATE_UPDATED | yes | no |
| IN_REVIEW | submitted by author | content owner + policy/privacy reviewer where flagged | approve, return | return: yes | TEMPLATE_SUBMITTED / TEMPLATE_RETURNED | no | no |
| APPROVED | reviewer(s) approve exact content | approving owner | activate (with effective date) | no | TEMPLATE_APPROVED | **no - immutable from here on** | no |
| ACTIVE | activation recorded (approver, date, effective date) | HR Manager | supersede (publish new version), retire | supersede/retire: yes | TEMPLATE_ACTIVATED / TEMPLATE_RETIRED | no | **yes** |
| SUPERSEDED | a newer version becomes ACTIVE | - | none (history) | - | TEMPLATE_SUPERSEDED | no | no (existing pinned documents unaffected) |
| RETIRED | deliberate withdrawal without replacement | - | none (history) | - | TEMPLATE_RETIRED | no | no; emergency retirement blocks generation immediately |

Template versions are immutable once APPROVED; every change is a new version. Cases pin the version used at generation (existing REQ/BR baseline).

## 2. Document-instance lifecycle (proposed)

```text
DRAFT -> VALIDATION_FAILED (-> DRAFT)
DRAFT -> READY_FOR_REVIEW -> PENDING_APPROVAL -> RETURNED (-> DRAFT of new version)
PENDING_APPROVAL -> APPROVED -> RENDERED -> MANUALLY_ISSUED -> SUPERSEDED
any pre-issue state -> VOIDED
```

| State | Entry conditions | Permitted roles | Allowed actions | Reason | Audit | Content change | Downloadable | May be represented as final | May be manually issued |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DRAFT | preparer creates instance from ACTIVE template + case data | HR Officer / HR Manager | edit selected clauses/data refs, validate, abandon | abandon: yes | DOC_CREATED / DOC_UPDATED | yes | preview only, watermarked DRAFT | **no** | no |
| VALIDATION_FAILED | required fields unresolved/invalid | preparer | fix data, revalidate | no | DOC_VALIDATION_FAILED | yes | no | no | no |
| READY_FOR_REVIEW | validation passes; preparer confirms verified fields | preparer | submit for approval, reopen | no | DOC_READY | no (data frozen for this version) | watermarked preview | no | no |
| PENDING_APPROVAL | submitted | HR Manager (approver; not the preparer for maker-checker documents) | approve, return | return: yes | DOC_SUBMITTED / DOC_RETURNED | no | watermarked preview | no | no |
| RETURNED | approver returns with reason | preparer | start corrected version | carried | DOC_RETURNED | new version only | watermarked | no | no |
| APPROVED | approver attests to exact version+checksum (DEC-025) | system binds attestation | render final | no | DOC_APPROVED | **no** | not yet (render first) | no | no |
| RENDERED | final bytes rendered, SHA-256 stored | authorized case HR | download, record manual issue, supersede, void | void: yes | DOC_RENDERED / DOC_DOWNLOADED | no | **yes** (authorized, audited) | yes - it IS the approved final | **yes** |
| MANUALLY_ISSUED | authorized user records method, timestamp, recipient classification | recorder = authorized HR | supersede (with replacement), view | no | DOC_MANUALLY_ISSUED | no | yes | yes | already issued |
| SUPERSEDED | replacement RENDERED/ISSUED document exists | - | view history | carried | DOC_SUPERSEDED | no | yes (marked superseded) | no - superseded marking mandatory | no |
| VOIDED | abandoned before issue, or case cancelled/voided | HR Manager | view history | **yes** | DOC_VOIDED | no | history only, watermarked VOID | no | no |

**Result of a material case correction** (per `DocumentFieldDictionary.md` "invalidates approval" flags): any instance in READY_FOR_REVIEW, PENDING_APPROVAL, APPROVED or RENDERED that has not been MANUALLY_ISSUED is automatically moved to VOIDED (reason: material source change; audit DOC_APPROVAL_INVALIDATED), and a fresh version must be prepared. An already-issued document is never silently altered - correction happens by superseding it with a new approved version.

## 3. Binding rules

1. **Immutable template versions** (section 1).
2. **Immutable approved document versions** - APPROVED and later states never change content; corrections create versions.
3. **Exact approval-to-version binding** - the DEC-025 attestation stores document ID, version, and rendered checksum; approving anything else is impossible.
4. **Approval invalidation** - material change => DOC_APPROVAL_INVALIDATED + VOIDED (section 2).
5. **Corrected documents** - always a new version linked to its predecessor; full chain visible.
6. **Superseded handling** - predecessor becomes SUPERSEDED only when the replacement is RENDERED/ISSUED (existing StateMachines rule preserved).
7. **Voiding** - reason mandatory; bytes/history retained per policy; a VOIDED document is never deleted.
8. **Case cancellation** - open document instances are VOIDED (reason: case cancelled); issued documents remain immutable history.
9. **Case reopening** - never resurrects VOIDED instances; new work uses new versions; existing issued documents stand.
10. **Manual fallback** - DOC-04 manual-exception path or (during baseline) the fully manual process, recorded as baseline facts.
11. **Document access logging** - every preview, download, approval, return, render, issue, supersession and void produces an audit event; downloads record actor + document version + checksum.
12. **Restricted-case inheritance** - document visibility inherits the case's classification and participant rules; restricted-case documents are indistinguishable from non-existent ones to unauthorized actors.
13. **No hard deletion** - ever, at any state.
14. **Checksums** - SHA-256 computed at render, stored, verified on every download (mismatch blocks the download, as the Stage 1 attachment boundary already does).
15. **Idempotent rendering** - re-rendering the same document version with the same template version and data must produce byte-identical output or fail loudly; render requests carry an idempotency key.
16. **Concurrency** - optimistic version checks on instance transitions (Stage 1 pattern); racing approvals resolve to one winner, one clean conflict.
17. **Duplicate prevention** - one non-voided instance per (case, document type, version chain); creating a second active chain of the same type requires an explicit reason and is flagged.

## 4. Naming deltas vs the existing baseline (recorded, not silently resolved)

| Existing baseline | This proposal | Delta rationale | Resolution needed |
| --- | --- | --- | --- |
| StateMachines.md instance: DRAFT, GENERATED, PENDING_APPROVAL, APPROVED, ISSUED, SUPERSEDED, VOIDED | Adds VALIDATION_FAILED, READY_FOR_REVIEW, RETURNED, splits GENERATED into READY_FOR_REVIEW (pre-approval preview) and RENDERED (post-approval final); ISSUED becomes MANUALLY_ISSUED for Stage 2 (no dispatch exists) | Finer states make maker-checker and validation auditable; "MANUALLY_ISSUED" is honest while no electronic dispatch exists (Stage 5 may add SUBMITTED/DELIVERED per DEC-034) | Approve mapping at the Stage 2 meeting; update StateMachines.md in the same change that approves Directive 2 |
| TemplateCatalogue.md template statuses: DRAFT, PENDING_APPROVAL, ACTIVE, RETIRED, REVOKED | DRAFT, IN_REVIEW, APPROVED, ACTIVE, SUPERSEDED, RETIRED | IN_REVIEW≈PENDING_APPROVAL renamed for symmetry; APPROVED-before-ACTIVE makes the effective date explicit; SUPERSEDED replaces implicit retirement-by-newer-version; emergency REVOKED maps to RETIRED-with-immediate-effect | Same |

Until the owners approve this mapping, the existing baseline names remain authoritative.
