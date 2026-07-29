# Document Output and Rendering Decision Specification (Stage 2)

**Directive:** 1.2 **Prepared:** 2026-07-29
**Status:** PROPOSED - approval-ready (worksheet row 15 decides). Related OPEN requirement: `REQ-DOC-009` (editable output) stays OPEN until this decision is made.

## 1. Output-format options

| Option | Formats | Assessment |
| --- | --- | --- |
| **A** | Accessible HTML preview + final PDF | Stable immutable final record; controlled browser review; no editable artefact leaves the system. |
| **B** | HTML preview + final PDF + editable DOCX | DOCX invites uncontrolled modification of approved wording after export; weakens the "approved bytes are the record" model. |
| **C** | DOCX only | No stable final record; requires desktop Word; couples output fidelity to user machines. |

**Recommendation (proposed, not approved): Option A for MVP**, because PDF provides a stable final record; browser preview supports controlled review; editable DOCX increases uncontrolled-modification risk; the manual-exception upload (DOC-04) already covers unusual cases; and DOCX may be added later **only if HR confirms a business requirement** (which would also resolve REQ-DOC-009).

## 2. Proposed output standard

- accessible browser preview (semantic HTML, WCAG 2.2 AA target, watermarked until final);
- **Letter page size** (8.5in x 11in), print-ready final PDF;
- deterministic layout - same template version + data => byte-identical output (idempotent rendering, lifecycle rule 15);
- embedded or approved system fonts only - **no dependency on a user's desktop Word installation** or machine-local fonts;
- every final document carries: document ID, case reference, template version, document version, confidentiality marking, page numbering where appropriate ("Page n of m");
- **PDF metadata scrubbed** of developer identities, tool defaults and local paths (title/author fields carry only approved neutral values);
- SHA-256 computed and stored immediately after rendering (verified on every download);
- no sensitive temporary files left in any public or shared directory; render scratch space is private and cleaned;
- **no public object URL, ever** - authorized download only, via the authenticated route, with attachment disposition;
- no shared-cache storage (`Cache-Control: no-store` as already enforced by the Stage 1 proxy);
- **all downloads audited** (actor, document, version, checksum, correlation ID).

## 3. Renderer boundary (implementation guidance for Directive 2)

Rendering sits behind a testable interface (Directive 2's RENDERING section): deterministic output, safe encoding, locale/timezone-correct dates, no missing-placeholder leakage. The choice of PDF engine is a Directive 2 implementation decision made from the live registry at build time; this specification constrains the OUTPUT, not the library.

## 4. Branding rules

- **Do not use a low-resolution screenshot extracted from the DMAIC as the production logo.**
- Development uses a clearly synthetic placeholder mark ("BERT'S AUTO PARTS - DEVELOPMENT" text treatment).
- An approved company brand asset (vector or print-resolution) is **required before pilot**; owner assigned in worksheet row 16.
- Branding is stored through a controlled asset/version mechanism (versioned asset record with approval metadata), so a brand change never silently alters previously rendered documents.

## 5. Explicitly out of scope for Directive 2

Live dispatch of any output; DOCX generation (pending row 15 + REQ-DOC-009); qualified/advanced e-signature embedding (DEC-025); termination document rendering (DOC-05 boundary).
