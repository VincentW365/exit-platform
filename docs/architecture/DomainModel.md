# Domain Model

## 1. Domain philosophy

The domain model makes important business transitions explicit. A case is not “complete” because a boolean changed; it is complete only when a closure command verifies mandatory tasks, assets, approvals, documents and exceptions.

## 2. Aggregate roots and ownership

### OffboardingCase aggregate

Owns:

- employee snapshot reference;
- departure type and approved dates;
- classification, owner, cohort and case status;
- participants;
- case-level notes/attachments references;
- status history;
- workflow instance reference;
- closure outcome.

Key invariants:

- one departure type;
- exact effective time required before approval;
- restricted termination default;
- approval creates one snapshot and one workflow instance;
- no hard delete;
- exceptional transitions require reason/authority;
- completion requires closure integrity.

### WorkflowInstance aggregate

Owns:

- pinned workflow definition version;
- task instances;
- dependencies/readiness;
- task due dates, assignment and status;
- escalations;
- task evidence references;
- workflow-level completion state.

Key invariants:

- definition version does not change silently;
- mandatory tasks cannot disappear;
- task readiness follows dependencies;
- waiver authority is configured;
- date changes append schedule history;
- scheduler actions are idempotent.

### GeneratedDocument aggregate

Owns:

- document type;
- template version;
- populated data snapshot;
- state and approvals;
- rendered file reference/hash;
- issue/supersession relationship.

Key invariants:

- only approved active template versions;
- required fields validated;
- issue is immutable;
- correction creates a new version;
- termination/resignation types cannot cross incorrectly.

### Notification aggregate

Owns:

- type, template version and content snapshot;
- recipients;
- approval and schedule;
- status;
- attempt history;
- idempotency/correlation;
- manual fallback.

Key invariants:

- applicability true;
- approved recipient field set;
- sensitive sends approved;
- provider acceptance is not delivery;
- logical duplicate prevented;
- permanent failure remains visible.

### CaseAsset aggregate/item collection

Owns:

- asset type/identifier;
- expected return;
- disposition;
- receiver, condition and evidence;
- exception/waiver reference.

Key invariants:

- final disposition required;
- RETURNED evidence requirements;
- no pay mutation;
- separate documentation/recovery measurement.

### HandoverPlan aggregate

Owns:

- accountable manager/delegate;
- handover items;
- receiving owners;
- sessions/document locations;
- residual risks and attestation.

Key invariants:

- no credentials/secrets;
- every item has owner or escalation;
- applicability/waiver controlled.

### SurveyInvitation / SurveyResponse aggregates

Invitation owns:

- case/eligibility;
- contact channel;
- token hash;
- schedule, expiry, delivery outcome;
- suppression/revocation.

Response owns:

- survey version;
- channel;
- answer set;
- submission time;
- confidentiality classification.

Key invariants:

- invitation requires eligibility;
- raw token is not stored;
- token single-use/expiry;
- no internal case data exposed;
- response immutable after submit;
- identifiable content restricted.

### Exception aggregate

Owns:

- type, severity and source object;
- owner, due date and status;
- resolution/evidence;
- escalation.

Exceptions do not replace domain state. A failed notification remains failed even after an exception is acknowledged.

## 3. Supporting entities/value objects

- `EmployeeSourceRecord`
- `EmployeeSnapshot`
- `CaseParticipant`
- `Approval`
- `StoredFile`
- `TaskEvidence`
- `NotificationRecipient`
- `NotificationAttempt`
- `AssetType`
- `EmployeeIssuedAsset`
- `SurveyDefinition` and `QuestionVersion`
- `HolidayCalendar`
- `RetentionPolicy`
- `LegalHold`
- `AuditEvent`
- `IntegrationEvent`
- `OutboxEvent`
- `IdempotencyRecord`

## 4. Commands

Representative domain commands:

- `CreateCase`
- `SubmitCaseForReview`
- `ApproveCase`
- `ReturnCaseToDraft`
- `ChangeEffectiveSeparationTime`
- `PlaceCaseOnHold`
- `ResumeCase`
- `VoidCase`
- `ReopenCase`
- `AssignTask`
- `BlockTask`
- `CompleteTask`
- `WaiveTask`
- `GenerateDocument`
- `SubmitDocumentForApproval`
- `ApproveAndIssueDocument`
- `SupersedeDocument`
- `PrepareNotification`
- `ApproveNotification`
- `ScheduleNotification`
- `RecordNotificationAttempt`
- `RecordManualNotification`
- `SetAssetDisposition`
- `ApproveAssetWaiver`
- `CompleteHandover`
- `CreateSurveyInvitation`
- `SuppressSurveyInvitation`
- `SubmitSurveyResponse`
- `OpenException`
- `ResolveException`
- `RunClosureCheck`
- `CompleteCase`

Commands are preferable to generic `update` endpoints because they encode authority and invariants.

## 5. Domain events

Representative events:

- `CaseCreated`
- `CaseSubmittedForReview`
- `CaseApproved`
- `WorkflowInstantiated`
- `CaseEffectiveTimeChanged`
- `TaskBecameReady`
- `TaskOverdue`
- `TaskCompleted`
- `TaskWaived`
- `DocumentGenerated`
- `DocumentIssued`
- `NotificationApproved`
- `NotificationSubmitted`
- `NotificationFailed`
- `AssetDispositionRecorded`
- `HandoverCompleted`
- `SurveyInvitationScheduled`
- `SurveyResponseSubmitted`
- `ExceptionOpened`
- `ClosureCheckPassed`
- `CaseCompleted`

Events feed audit/history and may create outbox work. They are not an excuse to introduce distributed event sourcing.

## 6. Concurrency and integrity

- Every aggregate has a version or update timestamp checked on mutation.
- Unique constraints protect case number, active workflow instantiation, document issue sequence and notification idempotency.
- Worker claims use transactional locking.
- Commands return conflict errors when another actor changed the object.
- UI refreshes and presents the latest state rather than overwriting.

## 7. Anti-corruption boundaries

External providers are translated into domain concepts:

- BambooHR field names do not leak across the domain.
- Microsoft Graph statuses do not become business statuses without mapping.
- object-storage keys are not document identities.
- identity-provider group names are mapped to approved roles.
- future AI provider output is a draft suggestion, never a domain decision.
