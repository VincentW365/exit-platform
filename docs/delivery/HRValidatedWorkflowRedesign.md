# HR-Validated Workflow Redesign (Directive 6.3)

Design record for the workflow simplification implemented in Directive 6.3.
Product direction comes from HR OPERATIONAL FEEDBACK (Directive 6.2 live-data
UAT and the Directive 6.3 logic review, `EndToEndLogicReview.md`); it is
recorded as product direction, not formal policy or legal approval. Decisions
DEC-044 to DEC-050 in `../requirements/DecisionRegister.md` capture the
individual direction items.

## 1. Operating model

The platform is **HR-centric, deterministic, email-first and
exception-based**:

- **HR-centric.** HR (Manager + assigned Officer) operates every case.
  IT and Finance no longer sign in for routine offboarding work; the line
  manager keeps only the handover. The Action Form is an HR-controlled
  operational record completed by the assigned HR Officer.
- **Deterministic automation.** A pure rules engine derives every required
  action from facts the platform already holds (departure type,
  classification, effective instant, benefits applicability, issued assets,
  survey eligibility). Same facts → same actions; injectable clock; no
  generative AI participates in any decision (DEC-004 unchanged). Every
  derivation records rule key, rules version, source fields and result.
- **Email-first department actions.** Departments and external providers are
  reached by controlled, versioned, minimum-data email through the
  transactional outbox, with secure no-login acknowledgement links for
  receipt/completion evidence. In development and UAT every email lands in
  the capture mailbox only.
- **Exception-based review.** HR reviews information and handles exceptions;
  the platform does the routine work. The case surface leads with "Requires
  your attention" (only unresolved items), then "In progress automatically",
  then "Completed" (`summarizeRequiredActions`). Anything the automation
  cannot safely do becomes an actionable exception, never a silent skip.

## 2. Data model additions (additive migrations `20260816043857`, `20260816044013`)

- **`CaseRequiredAction`** - one row per derived action per case, unique on
  `(caseId, actionKey)`. Carries group (HR/DOCUMENTS/MANAGER_HANDOVER/IT/
  FINANCE/BENEFITS/ASSETS/SURVEY/CLEARANCE), kind (EMAIL_ACTION/
  ASSET_RECOVERY/SURVEY_INVITATION/BENEFITS_CONFIRMATION), business-language
  title, applicability, determination (DERIVED/DEFAULTED/REQUIRES_REVIEW/
  EXCEPTION/NOT_APPLICABLE), rule provenance (`ruleKey`, `rulesVersion`,
  `sourceFields`, `result`, `derivedAt`), override fields (flag, reason,
  actor, instant), reference linkage (`refType`/`refId` to the notification
  record or asset item), supersession fields and optimistic `rowVersion`.
  Delete-protected by trigger like every evidence table.
- **`ActionToken`** - no-login acknowledgement tokens per notification
  record: purpose (ACKNOWLEDGE_RECEIPT/CONFIRM_COMPLETION), nullable
  `tokenHash` (hash-only storage; nulled on use/revoke/expiry), issue/expiry
  instants, single-use claim fields (`usedAt`, `usedNote`), revocation fields
  and `rowVersion`. Unique on `tokenHash`; delete-protected.
- **`NotificationRecord` extensions** - `origin` (MANUAL/DERIVED),
  `derivedActionId`, snapshotted `controlLevel`, `scheduledSendAt`, `sentAt`,
  acknowledgement evidence (`acknowledgedAt`, `acknowledgedVia`
  TOKEN/HR_RECORDED), completion evidence (`completionConfirmedAt`,
  `completionEvidenceNote`, `completionRecordedById`), recipient display
  fields (`recipientConfigId`, `recipientName`, `recipientOrg`,
  `recipientKind`) and the case-only HR-entered recipient
  (`caseRecipientCiphertext` encrypted, `caseRecipientMask`).
- **Benefits fields on `OffboardingCase`** - `groupHealthApplicability`,
  `groupLifeApplicability` (default UNKNOWN), `otherProviderApplicability`
  (default NO), plus confirmation provenance (`benefitsConfirmedById`,
  `benefitsConfirmedAt`, `benefitsSource`).
- **`RecipientConfig` purpose fields** - `purpose`, `organizationName`,
  `contactName`, so the recipient directory reads as a provider directory
  (who, for what) rather than bare addresses.
- **New/extended enums** - `NotificationType` + `PAYROLL_OR_BANK_NOTIFICATION`
  and `OTHER_EXTERNAL_OFFBOARDING_NOTIFICATION`; `NotificationStatus` +
  `SENT`, `ACKNOWLEDGED`, `CONFIRMED_COMPLETE`; `ActionFormStatus` +
  `READY_FOR_HR_REVIEW`, `HR_REVIEWED`, `COMPLETE`,
  `RETURNED_FOR_CORRECTION`; `AttestationKind` + `HR_FORM_COMPLETION`;
  `ExceptionType` + `RECIPIENT_MISSING`, `BENEFITS_APPLICABILITY_UNKNOWN`,
  `ACKNOWLEDGEMENT_OVERDUE`, `AUTO_SEND_BLOCKED`; `RecipientClassDir` +
  `PAYROLL_BANK`, `PENSION_PROVIDER`; new enums `NotificationOrigin`,
  `BenefitsApplicability`, `RequiredActionGroup`, `RequiredActionKind`,
  `DerivationResult`, `TokenPurpose`. All additions are additive; no value is
  removed or renamed.

## 3. Action Form state machine (Directive F, HR feedback corrections 1-2)

```text
DRAFT → READY_FOR_HR_REVIEW → COMPLETE
                 ↘ HR_REVIEWED ↗            (optional, configuration-gated)
READY_FOR_HR_REVIEW / HR_REVIEWED → RETURNED_FOR_CORRECTION → READY_FOR_HR_REVIEW
any live pre-completion state → VOIDED (reason required)
COMPLETE → SUPERSEDED (material case correction; FORM_SUPERSEDED audited)
```

- The **assigned HR Officer** prepares, reviews, returns-for-correction and
  **completes** ordinary forms (`form.edit`/`form.submit`/`form.complete`/
  `form.return` are HR-on-case permissions). Completion is operational HR
  work, not a management approval; it creates an `HR_FORM_COMPLETION`
  attestation with a content checksum and renders the immutable PDF.
- **HR_REVIEWED** is an optional oversight step gated by system
  configuration `actionForm.requireHrReview` (off by default). When the
  policy is on, completion from `READY_FOR_HR_REVIEW` requires the
  HR-Manager review first; `form.hrReview` and `form.void` remain
  management-grade.
- **No manager approval exists** for new forms. Legacy statuses
  (`PENDING_MANAGER`, `PENDING_HR`, `APPROVED`, `RETURNED`) remain
  representable forever: historical rows render with "(legacy)" labels,
  legacy live rows may flow forward into the new model (complete/return)
  so no case is stranded, and legacy `APPROVED` still satisfies clearance
  alongside new `COMPLETE` (`FORM_DONE_STATUSES`).
- Readiness gate unchanged in spirit: acknowledgement recorded (or
  NOT_OBTAINED/NOT_APPLICABLE with rules per departure type) and every HR
  checklist item resolved before finishing. Immediate resignations are
  pre-populated with the suggested NOT_OBTAINED treatment; terminations with
  NOT_APPLICABLE. The Finance checklist records evidence of work performed
  OUTSIDE the application; no field touches pay.

## 4. Send control levels and safety gates (Directives R/S/AG)

Per notification type, stored in system configuration
(`notifications.sendControl`; seeded defaults in `DEFAULT_SEND_CONTROL`):

| Level | Meaning | Seeded default for |
| --- | --- | --- |
| AUTO_SEND | Prepared, approved and enqueued by the SYSTEM actor with zero HR clicks when every condition holds. | IT access removal, Finance offboarding, manager handover notice |
| HR_REVIEW_THEN_SEND | Waits in "Needs your review"; ordinary HR case-work approval releases it. | External providers (Sagicor, NCB, payroll/bank, other), survey reference |
| HR_MANAGER_APPROVAL_REQUIRED | Management authority required. | Manual exception notifications |

- **Restricted (termination) cases** always resolve to the stricter of the
  configured level and the restricted override
  (`notifications.sendControl.restrictedOverride`, default
  HR_MANAGER_APPROVAL_REQUIRED).
- **AUTO_SEND conditions** (all must hold, `autoSendBlockers`): control
  level, recipient resolved AND approved/verified, ACTIVE template, rendered
  content with no missing fields, applicability confirmed. Any blocker opens
  an `AUTO_SEND_BLOCKED` exception instead of sending.
- **AG safety gates are retained above control levels**: record purpose
  (TEST/TRAINING never dispatch in production; OPERATIONAL requires the
  `automation.notifications` feature flag), BASELINE cohort never
  dispatches, and the development capture provider remains the only delivery
  path outside production (fail-closed at startup). The state order
  DRAFT → PENDING_APPROVAL → APPROVED never relaxes - the automated path
  performs the same transitions with a SYSTEM actor and full audit
  (`NOTIFICATION_AUTO_PREPARED`, `NOTIFICATION_AUTO_APPROVED`).
- **Confidential timing**: termination IT emails release no earlier than one
  hour before the effective instant; termination Finance emails at the
  effective instant; the outbox honours `scheduledSendAt` on both automatic
  and manual approval paths.

## 5. Dual-mode clearance (Directive AA/AD)

Clearance is evaluated from evidence, dual-mode by construction:

- **Legacy (v1) mode** - a workflow instance that carries IT/FINANCE
  department tasks is judged by task completions, exactly as it ran:
  historical cases clear under the rules they ran under; no retroactive
  reinterpretation, no double notification (derived email actions are not
  created for legacy instances).
- **v2 mode** - no department-login tasks exist. IT requires
  confirmation-grade evidence (completion confirmed via secure link or
  HR-recorded evidence, or an approved exception) - email delivery is never
  proof access was removed (U.8); Finance requires the notification sent (or
  approved exception); applicable provider notifications must be sent or
  covered; unresolved (UNKNOWN) benefits applicability blocks. Asset
  exception coverage is per item (logic-review fix LR-007). The Action Form
  gate accepts new `COMPLETE` or legacy `APPROVED`. The exit survey never
  blocks clearance, and manager approval of the Action Form is not an input
  anywhere.

## 6. Workflow v2 definitions summary

The three departure-type workflows are re-issued as v2 definitions and
activated per the versioning discipline (v1 superseded for NEW cases;
running instances stay pinned to v1 and finish under it):

- **No IT/FINANCE department tasks.** Access removal and Finance
  notification are derived email actions with evidence chains, not queue
  tasks. The v1 IT exact-time revocation control survives as the
  CRITICAL `ACKNOWLEDGEMENT_OVERDUE` escalation at the effective instant
  plus the v2 clearance IT-evidence gate.
- **No manager Action-Form approval task.** The manager keeps the handover
  tasks only.
- **No manual applicability/dispatch/survey-invite tasks.** Benefits
  confirmation, provider notification preparation and survey scheduling are
  derived actions and sweep automation.
- HR tasks (case validation, documents, HRIS update, clearance review) and
  the manager handover retain their v1 due rules and calendar behaviour.

Later versions: v3 (owner decision 2026-08-19) removed the line-manager
tasks; v4 (DEC-066, 2026-09-22) removed the duplicate "Authorized HR Manager
approval" task from the restricted termination and redundancy workflows -
the HR Manager approval of the case is the only management approval.

## 7. Token security properties (Directive T)

Acknowledgement tokens satisfy, in code (`emailActions.ts`,
`ackTokenService.ts`):

- T.1 - 256-bit CSPRNG values, same generator discipline as the proven exit
  survey tokens; hash-only storage (the raw value exists only in the
  outgoing email).
- T.2 - single purpose per token: ACKNOWLEDGE_RECEIPT or CONFIRM_COMPLETION;
  completion confirmation is enabled only for internal department actions;
  external providers get acknowledgement-only.
- T.3 - bounded lifetime: 72 hours for IT access-removal confirmations,
  14 days otherwise; the worker sweep expires stale tokens by nulling the
  hash so expired links die instantly.
- T.4 - single-use atomic claim (optimistic `rowVersion` claim that nulls
  the hash); replays and concurrent redemptions fail neutrally.
- T.5 - re-dispatch revokes prior live tokens for the same purpose;
  cancel/supersede/case closure revokes all live tokens for the record.
- T.6 - neutral failure: invalid, expired, used and revoked tokens are
  indistinguishable to the caller; the public page never explains why.
- T.7 - minimum disclosure: redemption reveals only the action label
  (subject snapshot) and the case reference the email already carried -
  no case content, no login session, no navigation into the application.
- T.8 - full audit: `ACK_TOKEN_ISSUED` / `USED` / `EXPIRED` / `REVOKED`
  plus the notification evidence events, all with correlation IDs and no
  raw token values.
- T.9 - an HR-recorded alternative always exists (confirmed by
  email/phone/other with a mandatory evidence note, audited with the actor),
  so a recipient who never clicks the link cannot stall a case.

## 8. Audit additions

New event types (see `../architecture/AuditEventCatalogue.md` delta):
`DERIVED_ACTIONS_COMPUTED`, `DERIVED_ACTION_OVERRIDDEN`,
`BENEFITS_APPLICABILITY_SET`, `NOTIFICATION_AUTO_PREPARED`,
`NOTIFICATION_AUTO_APPROVED`, `NOTIFICATION_SENT`,
`NOTIFICATION_ACKNOWLEDGED`, `NOTIFICATION_COMPLETION_CONFIRMED`,
`NOTIFICATION_RECIPIENT_SET`, `ACK_TOKEN_ISSUED`, `ACK_TOKEN_USED`,
`ACK_TOKEN_EXPIRED`, `ACK_TOKEN_REVOKED`, `FORM_SENT_FOR_HR_REVIEW`,
`FORM_HR_REVIEWED`, `FORM_COMPLETED`, `TEMPLATE_NOTIFICATION_DRAFTED` /
`UPDATED` / `ACTIVATED` / `RETIRED` / `TEST_SENT`; and the previously
declared `FORM_SUPERSEDED` is now actually emitted. Automated decisions are
SYSTEM-actor events with rule provenance in metadata - automation is more
auditable than the manual flow it replaces, never less.

## 9. Migration and backwards compatibility

- **Additive only.** Both migrations add enum values, columns and tables;
  nothing is dropped, renamed or rewritten. The one-live-form-per-case
  partial unique index is recreated to recognize the union of legacy and new
  live statuses (the enum additions live in a separate earlier migration
  because new enum values cannot be referenced in the transaction that adds
  them).
- **History preserved.** Legacy Action-Form statuses and manager-approval
  attestations render forever; append-only audit and attestation rows are
  untouched; the new evidence tables carry the same no-delete triggers.
- **v1 supersede, not rewrite.** v1 workflow definitions are superseded for
  new cases; pinned running instances finish task-based and are judged
  task-based at clearance (dual mode, section 5). Legacy live form rows may
  flow forward so no case dead-ends.
- **Roles retired in place.** IT_RESPONDER / FINANCE_RESPONDER enum values
  remain for historical assignments and read paths; they are no longer
  granted operational surfaces for new work.

## 10. Explicit deferrals

- **PENSION derivation rule** - the `PENSION_PROVIDER` recipient class is
  reserved in the directory, but no derivation rule exists because no data
  source records pension enrolment; inventing an applicability rule is
  prohibited (CLAUDE.md rule 4). Awaits a data source and recorded decision.
- **DELIVERED provider evidence** - provider acceptance remains SUBMITTED,
  never DELIVERED (DEC-034); the `SENT` status records dispatch through the
  capture provider. Delivery-evidence handling is reserved for the live
  email increment.
- **Other-provider recipients** - `otherProviderApplicability = YES`
  surfaces a review action rather than fabricating a recipient: the platform
  cannot know WHICH other institution applies, so HR prepares the specific
  notification(s) explicitly.
- **Asset dispositions stay HR-recorded** - physical recovery cannot be
  automated; the redesign derives WHAT must come back (issued assets), but
  every disposition remains an HR-recorded decision with no payroll effect
  (DEC-008/DEC-009 unchanged).
- **Reports cohort/location filters** - supported by services, still not
  surfaced (logic review LR-016); unchanged scope this directive.
