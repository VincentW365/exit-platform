# Directive 6.3 Build Record - HR-Validated Workflow Simplification

Implementation record for the HR-validated workflow redesign. Companion
documents: `EndToEndLogicReview.md` (the section-A logic audit),
`HRValidatedWorkflowRedesign.md` (the design record) and
`../operations/HRDailyOffboardingWalkthrough.md` (the HR daily-use flow).
Product direction: HR OPERATIONAL FEEDBACK (Directive 6.2 UAT), recorded as
product direction in DEC-044..DEC-050 - not formal policy/legal approval.

## Scope delivered

1. **End-to-end logic audit (A).** 22 classified findings with dispositions
   (`EndToEndLogicReview.md`); the FIXED set drives everything below.
2. **Deterministic derived actions (B/C).** Pure rules engine
   (`packages/domain/src/derivedActions.ts`) deriving the full required-action
   set (IT/Finance emails, benefits/provider notifications, per-issued-item
   asset recovery, survey invitation, benefits confirmation) with rule
   provenance and the version stamp `hr-validated-workflow-v2`; idempotent
   persistence with authorized reasoned overrides
   (`derivedActionService.ts`); re-derivation on material input changes.
3. **Action Form redesign (D/E/F, corrections 1-2).** Manager approval
   removed; assigned-officer completion with `HR_FORM_COMPLETION`
   attestation and immutable PDF; optional configuration-gated HR-Manager
   review (`actionForm.requireHrReview`); suggested acknowledgement defaults
   per departure type; legacy statuses render forever and legacy live rows
   flow forward; `FORM_SUPERSEDED` now emitted.
4. **Email-first department actions (I/J/K/R/S/U).** IT_RESPONDER /
   FINANCE_RESPONDER retired as operational logins (historical read support
   only); derived notifications with send control levels (AUTO_SEND /
   HR_REVIEW_THEN_SEND / HR_MANAGER_APPROVAL_REQUIRED), restricted-case
   stricter-of override, AG safety gates retained (record purpose, cohort,
   feature flag, capture-only provider outside production), confidential
   termination timing via `scheduledSendAt`, SYSTEM-actor automated
   approve/enqueue with full audit, and actionable exceptions
   (`RECIPIENT_MISSING` HIGH, `AUTO_SEND_BLOCKED`) instead of silent skips.
5. **No-login acknowledgement links (T).** `ActionToken` with CSPRNG values,
   hash-only storage, purpose limitation, single-use atomic claims,
   worker-driven expiry that nulls the hash, neutral failures, minimum
   disclosure, and the HR-recorded evidence alternative (email/phone/other
   with note). Public route: `/ack/<token>`.
6. **Benefits applicability (V).** First-class YES/NO/UNKNOWN on the case
   with confirmation provenance; UNKNOWN opens
   `BENEFITS_APPLICABILITY_UNKNOWN` and blocks v2 clearance; YES derives the
   provider notification; NO records the decision and creates nothing.
7. **Configurable provider directory (N/O, correction 6).** Recipient
   purposes (incl. reserved PAYROLL_BANK / PENSION_PROVIDER classes),
   organization/contact display fields; HR enters a missing recipient
   case-only without HR-Manager approval (encrypted + masked + audited);
   saving for future cases requires recipient-directory authority and the
   controlled approval/verification lifecycle.
8. **Notification template management (Q).** Versioned plain-text templates
   with allow-listed placeholders; officers draft, preview and test-send
   (synthetic sample values, capture-only, refused in production);
   HR Manager activates with atomic supersession; full
   `TEMPLATE_NOTIFICATION_*` audit.
9. **Dual-mode clearance (AA/AD).** Legacy (v1) instances with IT/FINANCE
   tasks clear task-based; v2 clears from email-action evidence (IT needs
   confirmation-grade evidence - delivery is never completion, U.8; Finance
   needs the notification sent; providers sent-where-applicable; benefits
   resolved); per-item unresolved-asset exception coverage (LR-007).
10. **Worker supervision (U.6, AF).** Sweep additions: token expiry,
    acknowledgement-overdue escalation (CRITICAL for IT at the effective
    instant), auto-release retry for waiting AUTO_SEND records, automatic
    survey-invitation scheduling under the standard automation gates;
    heartbeat reports enabled flags as information (LR-010).
11. **Exception-first HR surface (X/Y, corrections 7-8).** Required-actions
    summary (attention → automatic → done), business-language labels
    everywhere HR works (LR-012), dashboard attention fed from the exception
    feed (LR-011), issued-asset-derived asset lists with ADD UNLISTED ASSET
    as the exception path (LR-013).
12. **Workflow v2 definitions (AD).** The three departure-type workflows
    re-issued without IT/Finance login tasks, manager form approval, manual
    applicability/dispatch/survey tasks; v1 superseded for new cases with
    running instances pinned and unreinterpreted.

## Changes by layer

- **Domain (`packages/domain/src`)**: new `derivedActions.ts`,
  `emailActions.ts`, `requiredActions.ts`; redesigned `actionForm.ts`;
  extended `notifications.ts` (types, statuses, transitions, labels),
  `clearance.ts` (dual mode, benefits, per-item assets), `assets.ts`
  (per-item exception coverage), `permissions.ts` (new case actions
  `form.complete`, `form.hrReview`, `benefits.confirm`,
  `derivedAction.override`, `notification.recordEvidence`,
  `notification.enterRecipient`; global `notifTemplate.view/draft/activate`;
  queue membership), `workflow.ts` (queue scope), `audit.ts` /
  `auditCategories.ts` / `auditHumanize.ts` (new events), `outbox.ts`,
  `nextAction.ts`.
- **Services (`packages/db/src/services`)**: new `derivedActionService.ts`,
  `ackTokenService.ts`, `notificationTemplateService.ts`; extended
  `notificationService.ts` (derived preparation, auto-release, case-only
  recipients, evidence chain), `actionFormService.ts` (new lifecycle),
  `clearanceService.ts`, `workflowSweepService.ts`, `surveyService.ts`
  (automatic scheduling), `caseService.ts`, `workflowService.ts`,
  `taskService.ts`, `exceptionService.ts`, `outboxService.ts`,
  `recipientService.ts`, `pilotService.ts`.
- **Web (`apps/web`)**: Action-Form surfaces for the new lifecycle; case
  Required-actions / Benefits & providers panels; notification surfaces for
  the email-action model incl. recipient entry; public `/ack/<token>` page;
  capture-mailbox demonstration surface; business-language labels.
- **Worker (`apps/worker`)**: sweep steps 6-9 (tokens, acknowledgement
  escalation, auto-release retry, survey scheduling); informational
  heartbeat.
- **Database (`packages/db/prisma`)**: two additive migrations (below);
  no-delete triggers extended to the new evidence tables; the
  one-live-form-per-case partial index recreated over the union of legacy
  and new live statuses.

## Migrations

| Migration | Content |
| --- | --- |
| `20260816043857_directive63_enum_additions` | Additive enum values only: ActionFormStatus (+4), AttestationKind (+HR_FORM_COMPLETION), ExceptionType (+4), NotificationStatus (+3), NotificationType (+2), RecipientClassDir (+2). Separate migration because new PostgreSQL enum values cannot be referenced in the transaction that adds them. |
| `20260816044013_directive63_email_actions_and_derived_rules` | New enums (NotificationOrigin, BenefitsApplicability, RequiredActionGroup, RequiredActionKind, DerivationResult, TokenPurpose); tables `case_required_action` and `action_token` (unique keys, indexes, FKs, no-delete triggers); NotificationRecord evidence/recipient/schedule columns; case benefits columns; RecipientConfig purpose columns; recreated `uniq_live_action_form_per_case`. |

Both migrations are additive; nothing is dropped, renamed or rewritten;
history and append-only evidence are untouched.

## Validation (executed 2026-08-16 against the finished tree)

| Check | Command | Result |
| --- | --- | --- |
| Formatting | `pnpm format:check` | PASS (all matched files use Prettier style) |
| Lint | `pnpm lint` (root ESLint + apps/web ESLint) | PASS, 0 findings |
| Strict typecheck | `pnpm typecheck` (all 5 workspace projects) | PASS |
| Unit tests | `pnpm test:unit` | 231 passed / 0 failed (21 files, incl. new `derivedActions` and `emailActions` suites) |
| Integration tests | `pnpm test:int` | 228 passed / 0 failed (23 files, incl. `directive63EmailActions`, `directive63Invariants` with all 20 AC invariants named) |
| Migration from head | `prisma migrate dev` / `migrate status` | Applied cleanly; "Database schema is up to date!", no drift |
| Migration from zero | drop + recreate `exitplatform_test`, then `pnpm test:int` (global setup runs `migrate deploy` + `grants.sql`) | Full 8-migration chain deploys; 228/228 pass |
| Runtime privileges | `runtimePrivileges.test.ts` (in test:int) | PASS incl. no-DELETE on `case_required_action` / `action_token` |
| End-to-end | `pnpm e2e` (Playwright, port 3100, seeded dev DB) | 45 passed / 0 failed (~10 min) incl. the new `directive63-flows` journey, public `/ack` route, accessibility (axe) and dark-mode/visual sweeps |
| Production build | `pnpm build` (next build + worker typecheck) | PASS |
| Sensitive-data scan | `pnpm exec tsx scripts/scan-real-names.ts` | PASS (no live directory rows; nothing to leak) |
| Secret / real-address scan | pattern scan over the full working diff | 0 findings (capture:// and @example.invalid destinations only) |
| Environment rebuild | `scripts/reset-environment.ts uat --yes` | Rebuilt dev DB with the v2 seeds; stakeholder UAT dataset (OFF-2026-0001..8) created through the real v2 services incl. benefits confirmation and derived email actions |

Pre-existing defect found and fixed during validation: the shared integration
fixture dates were fixed calendar instants that real time overtook, silently
flipping "early" access-completion semantics (recorded as LR entry in
`EndToEndLogicReview.md`); fixtures are now anchored to the test run's clock.

## Security and privacy implications

- **Attack surface**: one new unauthenticated route (`/ack/<token>`). It is
  token-gated with 256-bit hashed single-use tokens, neutral failures,
  bounded lifetime, worker expiry, and reveals only the action label and the
  case reference the email already carried - no case content, no session.
- **Authorization**: every new action is enforced server-side through the
  policy module (case-scoped HR permissions; management-grade review/void
  and template activation; directory authority for saved recipients);
  retired roles keep historical read support only.
- **PII**: case-only recipient addresses are stored encrypted with masked
  display; audit metadata carries masks and counts, never raw addresses or
  tokens; template previews/test sends use clearly synthetic sample values.
- **Live-side-effect safety unchanged**: capture-only email outside
  production (fail-closed), record-purpose/cohort/flag gates above every
  control level, GET-only BambooHR, no payroll computation anywhere.
- **Evidence integrity**: new tables are delete-protected; automated
  decisions are SYSTEM-actor audited with rule provenance; the IT clearance
  gate explicitly refuses delivery-as-completion.

## Deferrals

- PENSION derivation rule (no data source; no invented rule) - reserved
  recipient class only.
- DELIVERED provider evidence (DEC-034) - reserved for the live email
  increment; SENT records capture-provider dispatch only.
- Other-provider recipient derivation - YES surfaces a review action; HR
  prepares the specific notification(s).
- Asset dispositions remain HR-recorded decisions (no automation of
  physical recovery; no payroll effect).
- Reports cohort/location filter surfacing (LR-016) - unchanged scope.
- Survey-eligibility override surface for termination (LR-017) - awaits the
  DEC-014 policy decision.
