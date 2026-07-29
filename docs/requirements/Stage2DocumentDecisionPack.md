# Stage 2 Document Decision Pack

**Directive:** 1.2 - Stage 2 document decision, template, and approval readiness
**Prepared:** 2026-07-29
**Status:** PROPOSAL FOR APPROVAL. **No Decision Register status has been changed by this pack.** Every recommendation below remains a recommendation until the named owner records approval in `DecisionRegister.md` and the `Stage2ApprovalWorksheet.md`.

This pack presents, in approval-ready form, the five decisions that govern Directive 2 (controlled documents and the digital Employee Action Form). It is the single reference for the Stage 2 approval meeting.

| Decision | Topic | Current status | Owner |
| --- | --- | --- | --- |
| DEC-004 | Authoritative automation model | PROVISIONAL | Project Sponsor / HR Manager / IT |
| DEC-005 | Communication approval | PROVISIONAL | HR Manager |
| DEC-007 | Baseline measurement protection | PROVISIONAL | Project Sponsor / HR Manager |
| DEC-010 | Employee Action Form hierarchy | PROVISIONAL | HR Manager / Project Sponsor |
| DEC-025 | Digital signatures and attestations | **OPEN** | HR Manager / Legal or policy owner |

---

## DEC-004 — Authoritative automation model

**Current status:** PROVISIONAL. **Owner:** Project Sponsor / HR Manager / IT.

**Source conflict/gap:** The DMAIC (pp. 9, 12, 16) proposes AI-generated letters while simultaneously requiring human sign-off; it never states which artefact is authoritative when they disagree.

**Options:**

- **Option A - Generative AI produces document wording.** Fast to demonstrate; non-deterministic output, unverifiable legal wording, requires sending employee data to an external AI service (prohibited during this stage by DEC-030/IC-S1), unauditable provenance.
- **Option B - Versioned, deterministic, approved templates produce document wording.** Every issued document traceable to an immutable approved template version plus validated structured data; reproducible; no external data flow.
- **Option C - Approved templates authoritative; optional AI may later PROPOSE a draft** that cannot be approved or issued without human review, added only under a separate approved AI change (DEC-030 gate).

**Recommendation (proposed, not approved):**

1. **Option B for MVP.**
2. Option C may be considered later only through an approved AI change request satisfying DEC-030.
3. AI must never determine legal wording, entitlement wording, dates, approvals, recipient details, or whether a document may be issued.
4. Template fields are populated exclusively from validated structured case data (the approved snapshot and verified case fields).
5. No external AI service receives employee data during this stage.

**Operational effect:** HR reviews known, stable wording; corrections change data or template version, never ad-hoc text. **Security/privacy effect:** no employee data leaves the platform; provenance is provable (template version + data + checksum). **Implementation effect:** Directive 2 builds a template-version model and renderer, no AI integration surface. **Consequence of deferral:** Directive 2 cannot start - the renderer's authority model is its foundation.

**Approval record:** Decision: ☐ Approve as recommended ☐ Approve with changes ☐ Defer ☐ Reject. Final wording: ______. Approver(s): ______. Date: ______. Conditions: ______.

---

## DEC-005 — Document and communication approval

**Current status:** PROVISIONAL. **Owner:** HR Manager.

**Source conflict/gap:** The DMAIC requires sign-off (pp. 12, 16) but does not define who prepares, who approves, what approval binds to, or what invalidates it.

**Recommended model (proposed, not approved):**

1. An **HR Officer may create or regenerate** a document draft.
2. An **HR Manager must approve** an employee-facing resignation document before it becomes final.
3. A creator must not be able to represent an unapproved draft as final (state model + rendering watermark + downloads gated on state).
4. Approval binds to an **exact document version and its rendered content checksum** - approving "the letter" means approving those bytes.
5. **Changing any material field after approval invalidates the approval** and creates a new document version requiring fresh approval (material fields are flagged in `../templates/DocumentFieldDictionary.md`).
6. **No email or external dispatch is part of Directive 2.** Issuance in Stage 2 means recording a manual issue.
7. Marking a document **manually issued** requires an authorized user, the issue method, timestamp, recipient classification, and an audit event.
8. **Termination communications are outside Directive 2** unless a later directive expressly includes an approved termination template (see DEC-010/DEC-025 and `TPL-DOC-003`).

**Operational effect:** two-person control on employee-facing letters; regeneration is cheap, approval is deliberate. **Security/privacy effect:** no unapproved content can leave; every issue has evidence. **Implementation effect:** maker-checker enforced at the service layer; version-bound approvals. **Consequence of deferral:** blocks Directive 2's approval workflow.

**Approval record:** Decision: ☐ Approve as recommended ☐ Approve with changes ☐ Defer ☐ Reject. Final wording: ______. Approver(s): ______. Date: ______. Conditions: ______.

---

## DEC-010 — Employee Action Form hierarchy

**Current status:** PROVISIONAL. **Owner:** HR Manager / Project Sponsor.

**Source conflict/gap:** The legacy Employee Action Form (DMAIC pp. 23-24) is a **generic HR action form** (new hire, promotion, salary change, transfer, leave, separation) with a sign-off block that appears to include: employee approval or acknowledgement; manager approval; Human Resources approval; Human Resources checklist initials; Payroll checklist initials. The DMAIC does not define whether checklist initials carry approval authority, and places sign-off structural change out of scope.

> **Do not assume checklist initials are equivalent to approval authority.** This pack treats them as distinct until HR confirms their meaning.

**Options:**

- **Option A - Digitize the entire generic Employee Action Form**, including promotion, new hire, salary change, transfer, leave and other non-offboarding actions.
- **Option B - Create an offboarding-specific digital instance** that preserves the existing offboarding sign-off authority while excluding unrelated HR action types from this application.

**Recommendation (proposed, not approved): Option B**, because recruitment/onboarding are out of scope; salary/payroll redesign is out of scope; this application is specifically for offboarding; implementing the generic HR action system would be major scope creep; and the sign-off hierarchy can be preserved without implementing unrelated transactions. Full structural mapping, including every excluded legacy field and why, is in `../templates/EmployeeActionFormOffboardingSpecification.md`.

**Items HR and the Project Sponsor must explicitly confirm** (REQUIRES HR/SPONSOR CONFIRMATION - the specification lists them as numbered questions):

1. the exact approval order;
2. whether employee acknowledgement is mandatory;
3. whether immediate resignation may use a NOT_OBTAINED outcome;
4. whether termination requires employee acknowledgement;
5. whether Manager approval is required for every departure type;
6. whether Payroll initials represent task completion or approval;
7. which role gives final HR approval.

**Operational effect:** the familiar form survives digitally for offboarding only. **Security/privacy effect:** restricted fields (rehire eligibility, reason) stay inside the offboarding access model. **Implementation effect:** one bounded form module, not a generic HR transaction engine. **Consequence of deferral:** the digital action form cannot be built; the paper form persists with its known filing and audit gaps.

**Approval record:** Decision: ☐ Approve as recommended ☐ Approve with changes ☐ Defer ☐ Reject. Final wording: ______. Approver(s): ______. Date: ______. Conditions: ______.

---

## DEC-025 — Digital signatures and attestations

**Current status:** **OPEN**. **Owner:** HR Manager / Legal or policy owner.

**Source conflict/gap:** The legacy forms rely on wet signatures and initials (DMAIC pp. 23-24, 27); no digital evidentiary requirement is defined anywhere.

**Options:**

- **Option A - Pasted or uploaded signature images.** Familiar-looking; trivially forgeable, no authentication binding, image handling risk; rejected practice.
- **Option B - Authenticated in-application approval and attestation records.** The signed fact is a database record bound to an authenticated user, a document version and a content checksum.
- **Option C - Third-party advanced/qualified electronic-signature service.** Strongest evidence; new vendor, cost, data-sharing and cross-border assessment (DEC-030-adjacent), unnecessary for internal attestations.

**Recommendation for MVP (proposed, not approved):**

1. **Option B for authenticated internal users.**
2. **No pasted signature images.**
3. The application must **not claim** to provide a qualified or advanced electronic signature.
4. Every attestation records: authenticated user ID; display name at the time; role; attestation meaning (the exact statement being attested); date and time; document ID; document version; rendered-document checksum; case reference; correlation/request ID; IP or device information **only where approved and proportionate** (Privacy Officer input required).
5. An approval is **invalidated if the approved content materially changes**.
6. **Employee acknowledgement** (the employee is not an authenticated user) remains one of: manual signed evidence uploaded through the controlled attachment process; recorded in-person acknowledgement with authorized witness details; **NOT_OBTAINED** with a required reason and HR Manager review; **NOT_APPLICABLE** where policy permits.
7. **No unauthenticated employee signature flow is implemented during Directive 2.**
8. HR/legal or the policy owner must determine whether any document class requires a stronger electronic-signature method; if yes, that class stays manual until a separate approval.

**Operational effect:** internal sign-offs become instant and evidenced; employee acknowledgement keeps its manual/evidence path. **Security/privacy effect:** no forgeable images; attestation evidence is append-only and checksum-bound. **Implementation effect:** attestation records + invalidation logic in Directive 2; no signature vendor. **Consequence of deferral:** **Directive 2 is blocked** - approvals are the core of the document workflow and DEC-025 is currently OPEN.

**Approval record:** Decision: ☐ Approve as recommended ☐ Approve with changes ☐ Defer ☐ Reject. Final wording: ______. Approver(s): ______. Date: ______. Conditions: ______.

---

## DEC-007 — Baseline protection (confirmation for Stage 2)

**Current status:** PROVISIONAL. **Owner:** Project Sponsor / HR Manager.

No new options - this entry **confirms** how the already-recommended baseline rules bind Stage 2:

1. Stage 2 functionality must not automatically affect OPERATIONAL/BASELINE records.
2. All document feature flags (`automation.letterGeneration` and any added by Directive 2) **default to disabled**.
3. Synthetic TRAINING and TEST records may be used for development and demonstration.
4. **No automatic document creation occurs from a case transition during Directive 2** - document creation is always an explicit, authorized HR action.
5. Operational activation requires a separately approved pilot decision (`PilotAndRolloutPlan.md`).
6. The existing manual process remains authoritative during baseline capture; a system-generated document during baseline would be a recorded deviation (BaselineDataCapturePlan section 6).

**Consequence of deferral:** none for Directive 2 development itself, but the confirmation prevents accidental baseline contamination when Stage 2 code lands.

**Approval record:** Decision: ☐ Approve as recommended ☐ Approve with changes ☐ Defer ☐ Reject. Final wording: ______. Approver(s): ______. Date: ______. Conditions: ______.

---

## Statement of status

As of this pack's preparation: DEC-004, DEC-005, DEC-007 and DEC-010 remain **PROVISIONAL**; DEC-025 remains **OPEN**. Nothing in this document changes any status, ticks any checklist box, or authorizes Directive 2. The approval path is: review this pack → record decisions in `Stage2ApprovalWorksheet.md` → update `DecisionRegister.md` with final wording, approver and date → only then evaluate Directive 2 readiness per `../delivery/Stage2DocumentReadinessReport.md`.
