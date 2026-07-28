# State Machines

## 1. Case state machine

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> PENDING_HR_REVIEW: submit
    PENDING_HR_REVIEW --> DRAFT: return for correction
    PENDING_HR_REVIEW --> APPROVED: approve
    APPROVED --> ACTIVE: workflow instantiated
    ACTIVE --> CLEARANCE_REVIEW: closure preconditions met
    CLEARANCE_REVIEW --> COMPLETED: HR Manager completes
    CLEARANCE_REVIEW --> ACTIVE: return to resolve
    ACTIVE --> ON_HOLD: approved hold
    CLEARANCE_REVIEW --> ON_HOLD: approved hold
    ON_HOLD --> ACTIVE: resume
    ON_HOLD --> CLEARANCE_REVIEW: resume to prior stage
    DRAFT --> CANCELLED: cancel non-event
    PENDING_HR_REVIEW --> CANCELLED: cancel non-event
    APPROVED --> CANCELLED: cancel before active effects
    DRAFT --> VOIDED: void duplicate/error
    PENDING_HR_REVIEW --> VOIDED: void duplicate/error
    APPROVED --> VOIDED: void duplicate/error
    ACTIVE --> VOIDED: controlled void
    CLEARANCE_REVIEW --> VOIDED: controlled void
    COMPLETED --> REOPENED: authorized reopen
    REOPENED --> ACTIVE: resolve operational work
    REOPENED --> CLEARANCE_REVIEW: resolve closure issue
    CANCELLED --> VOIDED: correct cancelled duplicate if needed
    COMPLETED --> [*]
    CANCELLED --> [*]
    VOIDED --> [*]
```

### Case transition rules

| From | To | Actor/authority | Preconditions | Effects |
| --- | --- | --- | --- | --- |
| DRAFT | PENDING_HR_REVIEW | HR Officer/Manager | Required intake fields valid; source files clean | status history and review task |
| PENDING_HR_REVIEW | DRAFT | HR Manager/reviewer | Return reason | review comments; no workflow |
| PENDING_HR_REVIEW | APPROVED | HR Manager | Employee/date/type/classification validated | immutable snapshot; approval |
| APPROVED | ACTIVE | System | workflow instantiated exactly once | tasks and schedules created |
| ACTIVE | CLEARANCE_REVIEW | HR Officer/system command | mandatory tasks terminal or validly waived; assets have final dispositions; effective-time rules satisfied | closure report generated |
| CLEARANCE_REVIEW | COMPLETED | HR Manager | closure integrity passes; no unresolved blocking exception | completion timestamp/event |
| CLEARANCE_REVIEW | ACTIVE | HR Manager | identified deficiency | new/reactivated tasks as explicit actions |
| ACTIVE/CLEARANCE_REVIEW | ON_HOLD | HR Manager or configured HR role | reason, review date, pause policy | pause event; scheduled effects handled per rule |
| ON_HOLD | prior operational state | authorized HR | resume reason; schedule preview | append recalculation history |
| DRAFT/PENDING/APPROVED | CANCELLED | HR | case no longer proceeds; reason | cancel pending future work |
| any non-terminal operational | VOIDED | HR Manager | duplicate/error and reason | cancel pending effects; retain all history |
| COMPLETED | REOPENED | HR Manager | reason and target state | preserve prior completion; create reopen event |
| REOPENED | ACTIVE/CLEARANCE_REVIEW | HR Manager | explicit target and needed work | new/reopened work recorded |

### Forbidden shortcuts

- DRAFT directly to ACTIVE or COMPLETED.
- PENDING_HR_REVIEW directly to COMPLETED.
- ACTIVE directly to COMPLETED.
- ON_HOLD directly to COMPLETED.
- COMPLETED back to DRAFT.
- any user-facing hard delete.

## 2. Task state machine

```mermaid
stateDiagram-v2
    [*] --> NOT_READY
    NOT_READY --> READY: dependencies satisfied
    READY --> IN_PROGRESS: start/claim
    READY --> BLOCKED: blocker recorded
    IN_PROGRESS --> BLOCKED: blocker recorded
    BLOCKED --> READY: blocker resolved, not started
    BLOCKED --> IN_PROGRESS: blocker resolved, resume
    READY --> COMPLETED: valid one-step completion
    IN_PROGRESS --> COMPLETED: evidence validated
    NOT_READY --> CANCELLED: case/workflow cancelled
    READY --> CANCELLED: case/workflow cancelled
    IN_PROGRESS --> CANCELLED: case/workflow cancelled
    BLOCKED --> CANCELLED: case/workflow cancelled
    READY --> WAIVED: authorized waiver
    IN_PROGRESS --> WAIVED: authorized waiver
    BLOCKED --> WAIVED: authorized waiver
    COMPLETED --> [*]
    WAIVED --> [*]
    CANCELLED --> [*]
```

Rules:

- `NOT_READY` tasks are visible for planning only to authorized users and cannot be completed.
- a task may be completed directly from READY when its type does not require start tracking.
- `BLOCKED` requires category, explanation, owner and expected resolution.
- `WAIVED` requires configured eligibility, approver, reason and evidence.
- overdue is a derived flag, not a state.
- reassignment does not change task state.
- completion/waiver/cancellation is terminal unless the case is reopened through a controlled action that creates a new task or explicit reactivation history.

## 3. Document state machine

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> GENERATED: render succeeds
    GENERATED --> PENDING_APPROVAL: submit
    PENDING_APPROVAL --> GENERATED: return/reject for correction
    PENDING_APPROVAL --> APPROVED: approve
    APPROVED --> ISSUED: issue and store immutable bytes
    GENERATED --> VOIDED: abandon invalid draft
    PENDING_APPROVAL --> VOIDED: cancel
    ISSUED --> SUPERSEDED: replacement issued
    DRAFT --> VOIDED
    ISSUED --> [*]
    SUPERSEDED --> [*]
    VOIDED --> [*]
```

Rules:

- `GENERATED` is not sent/issued.
- issued content cannot be edited.
- correction creates a new document linked to the old one.
- the old document becomes `SUPERSEDED` only after the replacement is issued.
- a void does not delete bytes/history where already created and policy requires retention.

## 4. Notification state machine

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> PENDING_APPROVAL: submit
    PENDING_APPROVAL --> DRAFT: return/reject
    PENDING_APPROVAL --> APPROVED: approve
    APPROVED --> SCHEDULED: future due time
    APPROVED --> QUEUED: due now
    SCHEDULED --> QUEUED: schedule reached
    QUEUED --> SUBMITTED: provider accepts request
    QUEUED --> FAILED: permanent/exhausted failure
    SUBMITTED --> DELIVERED_IF_KNOWN: delivery evidence
    SUBMITTED --> BOUNCED: bounce/failure evidence
    DRAFT --> CANCELLED
    PENDING_APPROVAL --> CANCELLED
    APPROVED --> CANCELLED
    SCHEDULED --> CANCELLED
    FAILED --> QUEUED: authorized retry
    BOUNCED --> QUEUED: corrected recipient/resend approved
    FAILED --> CANCELLED: manual fallback or no longer applicable
    SUBMITTED --> [*]
    DELIVERED_IF_KNOWN --> [*]
    CANCELLED --> [*]
```

Rules:

- `202 Accepted` maps to `SUBMITTED`.
- `DELIVERED_IF_KNOWN` is used only with actual evidence supported by the provider/process.
- attempts are append-only.
- manual fallback is a linked evidence path; it does not rewrite a failed attempt as successful.
- date/applicability changes can cancel only unsent notifications; already submitted content remains historical.
- resend creates an explicit reason and new dispatch sequence/idempotency dimension.

## 5. Asset disposition state model

This is primarily a disposition state rather than a workflow state.

```mermaid
stateDiagram-v2
    [*] --> OPEN
    OPEN --> RETURNED
    OPEN --> NOT_ISSUED
    OPEN --> LOST
    OPEN --> DAMAGED
    OPEN --> WAIVED
    OPEN --> UNRESOLVED
    UNRESOLVED --> RETURNED
    UNRESOLVED --> LOST
    UNRESOLVED --> DAMAGED
    UNRESOLVED --> WAIVED
```

Rules:

- `UNRESOLVED` can count as a final disposition only when explicitly approved for closure and linked to an owned exception.
- `RETURNED` requires receipt evidence.
- `NOT_ISSUED` requires source/manual confirmation.
- `WAIVED` requires approval.
- none of these states modifies payroll.

## 6. Survey invitation state machine

```mermaid
stateDiagram-v2
    [*] --> NOT_ELIGIBLE
    [*] --> ELIGIBLE
    ELIGIBLE --> SCHEDULED
    SCHEDULED --> SENT
    SENT --> DELIVERED_IF_KNOWN
    SENT --> DELIVERY_FAILED
    SENT --> COMPLETED
    DELIVERED_IF_KNOWN --> COMPLETED
    SENT --> DECLINED
    DELIVERED_IF_KNOWN --> DECLINED
    SENT --> EXPIRED
    DELIVERED_IF_KNOWN --> EXPIRED
    ELIGIBLE --> SUPPRESSED
    SCHEDULED --> SUPPRESSED
    SENT --> REVOKED
    DELIVERED_IF_KNOWN --> REVOKED
    DELIVERY_FAILED --> SCHEDULED: corrected/rescheduled
```

Rules:

- eligibility outcome and invitation delivery outcome are separate.
- a completed HR/verbal route can close the feedback outcome without an online invitation.
- token is invalid after COMPLETED, EXPIRED, REVOKED or SUPPRESSED.
- reminders are sent only while eligible, not completed, not suppressed/revoked and before expiry.

## 7. Exception state machine

```mermaid
stateDiagram-v2
    [*] --> OPEN
    OPEN --> ACKNOWLEDGED
    OPEN --> IN_PROGRESS
    ACKNOWLEDGED --> IN_PROGRESS
    IN_PROGRESS --> RESOLVED
    IN_PROGRESS --> ACCEPTED_RISK
    OPEN --> ACCEPTED_RISK
    RESOLVED --> REOPENED
    ACCEPTED_RISK --> REOPENED
    REOPENED --> IN_PROGRESS
```

`ACCEPTED_RISK` requires configured authority and is not equivalent to silently closing the underlying failed business object.

## 8. Configuration version states

Workflow, document, notification and survey definitions should use:

```text
DRAFT -> PENDING_APPROVAL -> APPROVED -> ACTIVE -> RETIRED
```

- only one active version per type/scope/effective period unless an explicit routing rule permits more;
- used versions are immutable;
- retirement prevents new use but preserves existing cases.
