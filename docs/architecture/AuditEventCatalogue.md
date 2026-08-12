# Audit Event Catalogue

## Purpose

Audit events provide evidence of who did what, to which object, when, under which authority, and with what result. They are not verbose application logs and must not copy sensitive content.

## Required common fields

- event ID;
- stable event type;
- occurred-at UTC timestamp;
- actor type and actor ID;
- effective role/scope where relevant;
- object type and object ID;
- case ID where relevant;
- action result;
- correlation/request ID;
- safe structured metadata;
- source environment/application version.

## Event catalogue

| Event type | Area | Meaning | Minimum safe metadata |
| --- | --- | --- | --- |
| AUTH_LOGIN_SUCCESS | Identity | User authenticated successfully | actor, identity subject, session ID, time, safe device/IP metadata |
| AUTH_LOGIN_FAILURE | Identity | Authentication failed | claimed subject if safe, reason category, time, safe device/IP metadata |
| AUTH_LOGOUT | Identity | Session ended | actor, session ID, reason |
| AUTH_ROLE_GRANTED | Access | Role/scope granted | subject user, role, scope, approver, effective dates, reason |
| IDENTITY_USER_CREATED | Identity | Application account created from the synchronized directory (Directive 6.2 role mapping) | actor, subject user, source system/id, department, roles granted, reason |
| IDENTITY_USER_ENABLED | Identity | Previously disabled account re-enabled | actor, subject user, reason |
| AUTH_ROLE_REVOKED | Access | Role/scope revoked | subject user, role, scope, actor, reason |
| AUTH_BREAK_GLASS_REQUESTED | Access | Exceptional access requested | requester, scope, reason, duration |
| AUTH_BREAK_GLASS_APPROVED | Access | Exceptional access approved | request, approver, conditions, expiry |
| AUTH_BREAK_GLASS_USED | Access | Exceptional access used | actor, object/action, time, correlation |
| AUTH_BREAK_GLASS_ENDED | Access | Exceptional access expired/revoked | actor/system, scope, outcome |
| CASE_CREATED | Case | Draft case created | case, actor, employee source reference, cohort |
| CASE_SUBMITTED | Case | Case submitted for HR review | case, actor, validation result |
| CASE_RETURNED_TO_DRAFT | Case | Reviewer returned case | case, actor, reason |
| CASE_APPROVED | Case | Case approved and snapshot created | case, actor, snapshot hash, departure type |
| CASE_WORKFLOW_INSTANTIATED | Case | Pinned workflow created | case, workflow/version, idempotency key |
| CASE_OWNER_CHANGED | Case | Case owner/participant changed | case, old/new owner, actor, reason |
| CASE_CLASSIFICATION_CHANGED | Case | Classification changed | case, old/new, actor, reason |
| CASE_EFFECTIVE_TIME_CHANGED | Case | Confirmed date/time changed | case, old/new, actor, reason, impact reference |
| CASE_HOLD_STARTED | Case | Case put on hold | case, actor, reason, pause policy, review date |
| CASE_HOLD_ENDED | Case | Case resumed | case, actor, reason, schedule impact |
| CASE_CANCELLED | Case | Case cancelled | case, actor, reason |
| CASE_VOIDED | Case | Case voided | case, actor, reason, downstream cancellation result |
| CASE_REOPENED | Case | Completed case reopened | case, actor, reason, target state |
| CASE_CLEARANCE_REVIEW_STARTED | Case | Closure review opened | case, actor, check result reference |
| CASE_COMPLETED | Case | Case completed | case, actor, closure check hash/result |
| CASE_VIEWED_RESTRICTED | Access | Restricted case viewed | case, actor, view type, correlation |
| CASE_EXPORTED | Access | Case/report exported | actor, export type, filter/scope, row count, redaction profile |
| FILE_UPLOAD_STARTED | File | Upload initiated | actor, case/object, declared type/size |
| FILE_UPLOAD_ACCEPTED | File | Upload stored in quarantine | file, actor, hash, type/size |
| FILE_SCAN_COMPLETED | File | Scan result recorded | file, scanner/version, result |
| FILE_UPLOAD_REJECTED | File | Upload rejected | actor, reason category, safe metadata |
| FILE_VIEWED | Access | Stored file viewed | file, actor, source object |
| FILE_DOWNLOADED | Access | Stored file downloaded | file, actor, source object |
| FILE_DISPOSED | Retention | Stored file deleted/anonymized | file class, policy/version, job/actor, result |
| TASK_READY | Workflow | Task became ready | case, task, dependency result |
| TASK_ASSIGNED | Workflow | Task assigned/reassigned | task, old/new assignee, actor, reason |
| TASK_STARTED | Workflow | Task work started | task, actor |
| TASK_BLOCKED | Workflow | Task blocked | task, actor, category, resolver, expected date |
| TASK_UNBLOCKED | Workflow | Blocker resolved | task, actor, outcome |
| TASK_COMPLETED | Workflow | Task completed | task, actor, evidence references, due/completed times |
| TASK_WAIVED | Workflow | Task waived | task, approver, reason, evidence |
| TASK_CANCELLED | Workflow | Task cancelled by case/workflow action | task, source action, reason |
| TASK_DUE_DATE_CHANGED | Workflow | Task due time recalculated/changed | task, old/new, rule/calendar, actor/system |
| TASK_OVERDUE | Workflow | Task crossed overdue threshold | task, due time, owner, escalation level |
| ESCALATION_CREATED | Workflow | Escalation generated | source object, level, owner, idempotency key |
| DOCUMENT_TEMPLATE_VERSION_CREATED | Configuration | Document template draft created | template/type/version, actor |
| DOCUMENT_TEMPLATE_VERSION_ACTIVATED | Configuration | Template version activated | template/version, approver, effective date |
| DOCUMENT_GENERATED | Document | Document preview rendered | case, document, template/version, data hash |
| DOCUMENT_SUBMITTED_FOR_APPROVAL | Document | Document submitted | document, actor |
| DOCUMENT_APPROVED | Document | Document approved | document, approver, attestation/version |
| DOCUMENT_REJECTED | Document | Document returned/rejected | document, actor, reason |
| DOCUMENT_ISSUED | Document | Immutable document issued | document, file/hash, approver, issued time |
| DOCUMENT_SUPERSEDED | Document | Issued document superseded | old/new document, reason, actor |
| DOCUMENT_VOIDED | Document | Draft/non-issued document voided | document, actor, reason |
| NOTIFICATION_PREPARED | Notification | Notification draft created | case, notification, type, template/version |
| NOTIFICATION_RECIPIENTS_RESOLVED | Notification | Final recipient set resolved | notification, recipient count/types, config versions |
| NOTIFICATION_SUBMITTED_FOR_APPROVAL | Notification | Notification submitted | notification, actor |
| NOTIFICATION_APPROVED | Notification | Notification approved | notification, approver, schedule |
| NOTIFICATION_CANCELLED | Notification | Unsent notification cancelled | notification, actor/system, reason |
| NOTIFICATION_QUEUED | Notification | Outbox work claimed/queued | notification, worker, attempt |
| NOTIFICATION_SUBMITTED | Notification | Provider accepted request | notification, provider reference, attempt |
| NOTIFICATION_DELIVERY_CONFIRMED | Notification | Delivery evidence received | notification, provider reference, evidence type |
| NOTIFICATION_BOUNCED | Notification | Bounce/non-delivery recorded | notification, provider reference, category |
| NOTIFICATION_FAILED | Notification | Dispatch failed permanently/exhausted | notification, attempt count, category |
| NOTIFICATION_MANUAL_FALLBACK | Notification | Manual send recorded | notification, actor, method, recipient, evidence |
| ASSET_ITEM_CREATED | Asset | Case asset item created | case, item, source/default/manual reason |
| ASSET_DUE_DATE_CHANGED | Asset | Expected return changed | item, old/new, actor, reason |
| ASSET_DISPOSITION_RECORDED | Asset | Disposition recorded | item, old/new, actor, receiver/condition refs |
| ASSET_WAIVER_APPROVED | Asset | Waiver approved | item, approver, reason, evidence |
| HANDOVER_PLAN_CREATED | Handover | Handover plan created | case, manager, workflow version |
| HANDOVER_ITEM_CHANGED | Handover | Handover item status/owner changed | item, old/new safe metadata, actor |
| HANDOVER_COMPLETED | Handover | Manager attested completion | plan, actor, residual risk count |
| SURVEY_ELIGIBILITY_SET | Survey | Eligibility decided | case, actor/rule, outcome, reason |
| SURVEY_INVITATION_CREATED | Survey | Invitation/token created | case, invitation, survey version, expiry; never raw token |
| SURVEY_INVITATION_SUPPRESSED | Survey | Invitation suppressed | invitation, actor, reason |
| SURVEY_INVITATION_SENT | Survey | Invitation submitted | invitation, notification/provider reference |
| SURVEY_REMINDER_SENT | Survey | Reminder submitted | invitation, sequence, idempotency key |
| SURVEY_TOKEN_REVOKED | Survey | Token revoked | invitation, actor/system, reason |
| SURVEY_RESPONSE_SUBMITTED | Survey | Final response submitted | response, channel, survey version, time; no answer body |
| SURVEY_VERBAL_DEBRIEF_RECORDED | Survey | HR verbal route recorded | response, interviewer, notice/consent reference |
| EXCEPTION_OPENED | Exception | Control exception opened | exception, source object, type, severity, owner |
| EXCEPTION_ACKNOWLEDGED | Exception | Exception acknowledged | exception, actor |
| EXCEPTION_RESOLVED | Exception | Exception resolved | exception, actor, resolution/evidence |
| EXCEPTION_RISK_ACCEPTED | Exception | Risk accepted | exception, approver, reason, expiry/review |
| CONFIG_CHANGED | Configuration | Business/technical configuration changed | config type/key, old/new hashes, actor, approval |
| FEATURE_FLAG_CHANGED | Configuration | Feature flag changed | flag, environment, old/new, actor |
| INTEGRATION_CALL_COMPLETED | Integration | External operation completed | provider, operation, correlation, outcome, duration; no payload |
| INTEGRATION_WEBHOOK_ACCEPTED | Integration | Verified webhook accepted | provider, event ID/type, signature/timestamp result |
| INTEGRATION_WEBHOOK_REJECTED | Integration | Webhook rejected | provider, safe reason, timestamp |
| INTEGRATION_RECONCILIATION_COMPLETED | Integration | Reconciliation run | provider, scope/counts, mismatches |
| RETENTION_JOB_COMPLETED | Retention | Retention job completed | policy/version, counts by result, legal-hold skips |
| LEGAL_HOLD_CREATED | Retention | Legal hold created | hold, scope, actor, authority, dates |
| LEGAL_HOLD_RELEASED | Retention | Legal hold released | hold, actor, authority, reason |
| BACKUP_RESTORE_TEST_COMPLETED | Operations | Restore exercise completed | environment, backup reference, result, RPO/RTO |
| SECURITY_INCIDENT_CREATED | Security | Security/privacy incident opened | incident, awareness time, severity, owner |
| PRIVACY_BREACH_NOTIFICATION_RECORDED | Security | Regulatory/data-subject notification evidence recorded | incident, notification type/time/actor; no unnecessary content |

## Audit integrity rules

- append-only to normal application roles;
- no document bodies, notification bodies, survey answers, raw tokens, secrets or unnecessary personal addresses;
- actor and object references remain interpretable after a user is disabled;
- viewing/downloading/exporting restricted records is auditable;
- audit failures for sensitive mutations should fail the transaction rather than silently proceed;
- audit retention follows an approved record class and legal hold;
- access to audit data is itself restricted and monitored;
- operational logs may reference an audit/correlation ID but do not replace business audit events.
