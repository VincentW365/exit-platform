# Stage 2 Combined Build Record

**Directive:** 2 - Controlled documents, digital action form, and exit survey
**Built:** 2026-07-29
**Commit message:** `feat: add controlled documents action forms and exit surveys`

## 1. Implemented scope

1. **Controlled template system** - five document types (`RESIGNATION_ACCEPTANCE_WITH_NOTICE`, `IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT`, `OFFBOARDING_ACTION_FORM`, `MANUAL_EXCEPTION_DOCUMENT`, `TERMINATION_DOCUMENT_PLACEHOLDER`), versioned and immutable once ACTIVE; one ACTIVE per type (DB partial unique index); officers draft, HR Managers activate/supersede/retire; plain-text bodies with an explicit placeholder allow-list; no HTML/scripting/template-engine syntax; seeded development templates marked `DEVELOPMENT TEMPLATE - REQUIRES HR APPROVAL BEFORE OPERATIONAL USE`.
2. **Document workflow** - full lifecycle DRAFT → VALIDATION_FAILED → PENDING_APPROVAL → RETURNED → APPROVED → RENDERING → RENDERED → MANUALLY_ISSUED → SUPERSEDED / VOIDED / RENDER_FAILED; per-version field snapshots that never silently refresh; validation view with missing-field / date-order / changed-case-data checks; maker-checker (creator can never approve); checksum-bound attestations; manual-issue recording (actor, method, timestamp, recipient class, audit) with **no email**; material case corrections supersede affected versions, invalidate their attestations and open v+1 automatically.
3. **PDF rendering** - pdfkit 0.19.1 (pure JS, standard PDF fonts, no desktop dependency, kept `serverExternalPackages` so bundling cannot break its font data); Letter size, development branding, confidentiality marking, page numbers, template/document versions in the footer; neutral scrubbed metadata pinned to the approval instant → **byte-identical idempotent re-renders**; SHA-256 stored and verified before every audited, authorized, attachment-disposition download from private storage.
4. **Digital offboarding action form** - one versioned form per case with the 9 required section groups; HR/Finance checklists as completion evidence distinct from approvals; acknowledgement ACKNOWLEDGED / NOT_OBTAINED(+reason) / NOT_APPLICABLE(termination); manager then HR-Manager attested approvals; final immutable version + PDF; **no financial amount fields anywhere**.
5. **Exit surveys** - versioned templates with six question types; seeded 7-question development survey; per-case invitations with 3/7/14-day reminder/expiry schedule anchored on the manual send; HR controls (generate/copy link, record sent/reminders, cancel, regenerate, invalid-contact, not-eligible, declined, verbal debrief); 256-bit tokens stored **hash-only**, single-use, neutral failure pages, transactional duplicate-safe submission; responses append-only (DB triggers).
6. **Dashboards** - case-detail section navigation (Overview / Documents / Action Form / Exit Survey / Attachments / Audit); HR dashboard queues (drafts, approvals, render failures, form stages, invitations/reminders due, completions), turnaround/correction/completion metrics, exception list; assigned-form queues for Finance/Manager participants.
7. **Worker** - render-retry jobs (bounded, 3 attempts), survey expiry sweep, due-state visibility logging; idempotent claims, correlation IDs, no PII, clean shutdown.

## 2. Exclusions (per directive)

Live email/notification outbox (boundary documented in section 10); operational termination letters (placeholder is non-activatable and non-renderable); DOCX; qualified/advanced e-signature claims; pay calculation or modification of any kind; recruitment/onboarding/promotion/transfer/salary/leave functions; AI anywhere in the pipeline.

## 3. Migration

`20260729155539_stage2_documents_forms_surveys` - additive only. New tables: document_template, document_instance, attestation, action_form_version, survey_template, survey_question, survey_invitation, survey_response, survey_answer, render_job; new enum values on ParticipantRole (FINANCE, MANAGER) and AttachmentPurpose. Hand-authored SQL: one-ACTIVE-template-per-type and one-live-instance partial unique indexes; no-hard-delete triggers on all evidence tables; attestation core-column immutability trigger; survey response/answer append-only triggers. Verified from the existing schema and from zero; no drift. `scripts/db/grants.sql` extended: runtime role gets INSERT/SELECT only on responses/answers, no DELETE anywhere, trigger-guarded UPDATE on attestations.

## 4. Permissions

New case actions (doc.*, form.*, survey.*) in the single policy module; FINANCE_RESPONDER / LINE_MANAGER gain **participant-scoped form surfaces only** (`caseAccessLevel`: FINANCE_FORM / MANAGER_FORM) - never case content; manager view excludes restricted reason notes, rehire, HR remarks, finance notes; survey responses restricted to case HR + Privacy Officer (read-only), auditors metadata-only; templates: view HR+oversight, draft HR, activate HR Manager. All restricted-termination non-disclosure rules inherit unchanged.

## 5. Security controls verified

Case-restriction inheritance on every new surface (integration + E2E Scenario 4); XSS-safe: template bodies reject markup, previews render as React text nodes, PDFs are text-drawn; approval endpoints role+state+rowVersion guarded server-side; replay/concurrency: optimistic rowVersion everywhere, DB partial indexes prevent duplicate active templates/instances, atomic claim prevents duplicate survey submissions; raw tokens never logged/stored/audited (integration-verified); production fail-closed guards untouched; feature flags default off - OPERATIONAL/BASELINE records refuse document/survey creation (tested), TRAINING/TEST records exercise everything.

## 6. Tests

- Unit **111** (placeholders, validation, escaping, lifecycles, checksums, tokens, schedules, answers, completion rate, epoch guards, calendars, policy matrix...).
- Integration **89** across 9 files, including all 22 required Stage 2 integration points (N.1-N.22).
- E2E **14**: Stage 1 suite (critical path, 6 acceptance flows, visual+keyboard) plus Scenario 1-4 and the Stage 2 visual/axe sweep.
- Accessibility: axe (WCAG A/AA) on dashboard, template list, document preview/approval, action form, survey admin, public survey, neutral token page - **0 critical/serious**; no horizontal overflow at 1280/375 px.

## 7. Screenshots

`artifacts/stage2/01-dashboard-stage2 … 09-survey-neutral-invalid` (desktop + mobile where relevant; gitignored; synthetic data only).

## 8. Feature flags

`automation.letterGeneration` gates document/action-form creation for OPERATIONAL records; `automation.surveyInvitations` gates invitations. Both **seeded disabled**; BASELINE cohort remains blocked even if enabled (`automationPermitted`); operational activation is a pilot decision.

## 9. Known limitations

- Survey rate limiting is in-process (fine for local dev; production needs shared limiting - Stage 7).
- Verbal debrief entry reuses the survey question set; partial answers allowed by design.
- Manual-exception documents rely on the attachment quarantine boundary; the uploaded file itself is not re-rendered.
- Reminder/invitation "due" states surface in queues and worker logs only - sending remains entirely manual (no email exists).
- Template editing is plain-text; a rich preview-diff for template review is a later refinement.

## 10. Manual operating steps (Stage 2 features)

1. HR creates a case (TRAINING/TEST purpose while flags are off).
2. Documents tab → create draft → validate/submit → HR Manager approves → PDF renders → record manual issue after physically delivering it.
3. Action Form tab → HR completes checklist + acknowledgement → assign Finance/Manager participants (case Overview) → Finance checklist → manager approval → HR final approval → PDF.
4. Survey tab → create invitation → generate link (copy once) → send manually via an approved channel → record sent → record reminders likewise → response arrives online via the token link, or HR records a verbal debrief; expiry is automatic.

## 11. Future email/outbox boundary

When Stage 5 introduces the transactional outbox and provider adapter (DEC-020/DEC-034), the manual-send actions become outbox writes: `SurveyInvitation.manualSent*` fields generalize to dispatch records, reminder due-states become outbox triggers, and document issue gains an electronic channel beside `MANUALLY_ISSUED`. Nothing in the Stage 2 model requires rework for that step - the worker, idempotency-key discipline and status vocabulary (DEC-034 SUBMITTED≠DELIVERED) are already in place.
