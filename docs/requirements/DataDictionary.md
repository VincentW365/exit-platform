# Data Dictionary

## Purpose

This is the logical business data dictionary, not a final Prisma schema. Field names may be refined during implementation, but source, meaning, classification and invariants must remain traceable.

## Classification legend

- **Internal:** operational metadata with limited sensitivity.
- **Confidential:** employee/business information available only to authorized participants.
- **Restricted HR:** highly sensitive HR, termination, personal contact, survey, pay-related, rehire or free-text data.

## Core fields

| Entity | Field | Type | Classification | Authoritative source | Rule / note |
| --- | --- | --- | --- | --- | --- |
| User | id | UUID | Internal | System | Immutable internal identifier. |
| User | identity_subject | String | Confidential | Identity provider | OIDC/SAML subject; unique. |
| User | display_name | String | Confidential | Identity provider | Avoid unnecessary duplication in logs. |
| User | work_email | Email | Confidential | Identity provider | Used for internal routing only. |
| User | status | Enum | Internal | Identity provider/admin | ACTIVE, DISABLED, SUSPENDED. |
| RoleAssignment | role | Enum | Confidential | Admin approval | Role from approved catalogue. |
| RoleAssignment | scope | JSON/reference | Restricted HR | Admin approval | Department/case/record scope. |
| RoleAssignment | effective_from/to | Timestamp | Confidential | Admin approval | Supports temporary grants. |
| EmployeeSourceRecord | source_system | Enum | Internal | Integration | BAMBOOHR or approved fallback. |
| EmployeeSourceRecord | source_employee_id | String | Confidential | BambooHR | Stable external reference. |
| EmployeeSourceRecord | employee_number | String | Confidential | BambooHR | Business identifier. |
| EmployeeSourceRecord | full_name | String | Confidential | BambooHR | Display and document use. |
| EmployeeSourceRecord | work_email | Email | Confidential | BambooHR | Department/IT routing. |
| EmployeeSourceRecord | personal_email | Email | Restricted HR | BambooHR/HR verified | Survey only; hidden from departments. |
| EmployeeSourceRecord | department | Reference | Confidential | BambooHR | Reporting/routing. |
| EmployeeSourceRecord | location | Reference | Confidential | BambooHR | Reporting/routing. |
| EmployeeSourceRecord | position_title | String | Confidential | BambooHR | Document/task context. |
| EmployeeSourceRecord | manager_source_id | String | Confidential | BambooHR | Manager assignment. |
| EmployeeSourceRecord | employment_status | String | Restricted HR | BambooHR | Need-to-know. |
| EmployeeSourceRecord | retrieved_at | Timestamp | Internal | Integration | Freshness evidence. |
| EmployeeSnapshot | snapshot_json | Structured | Restricted HR | Approved case/source | Immutable approved subset. |
| EmployeeSnapshot | source_retrieved_at | Timestamp | Internal | Source record | Traceability. |
| OffboardingCase | id | UUID | Internal | System | Immutable. |
| OffboardingCase | case_number | String | Confidential | System | Human-readable unique reference. |
| OffboardingCase | departure_type | Enum | Restricted HR | HR decision | Three initial values. |
| OffboardingCase | received_at | Timestamp | Restricted HR | HR/source document | KPI trigger. |
| OffboardingCase | receipt_source | Enum/String | Restricted HR | HR | EMAIL, LETTER, MANAGEMENT_INSTRUCTION, OTHER. |
| OffboardingCase | proposed_last_working_date | Date | Restricted HR | Employee/HR | Not authoritative until confirmed. |
| OffboardingCase | confirmed_last_working_date | Date | Restricted HR | HR approval | Document/workflow source. |
| OffboardingCase | effective_separation_at | Timestamp | Restricted HR | HR approval | Exact security deadline source. |
| OffboardingCase | notice_status | Enum | Restricted HR | HR | No entitlement calculation. |
| OffboardingCase | case_owner_user_id | UUID | Confidential | HR assignment | Required for active case. |
| OffboardingCase | classification | Enum | Restricted HR | Rule/HR | TERMINATION defaults RESTRICTED. |
| OffboardingCase | measurement_cohort | Enum | Internal | Product owner/feature mode | BASELINE, PILOT, POST_ROLLOUT. Business-analysis dimension. Required when record_purpose is OPERATIONAL; must be null for TRAINING and TEST. Changes follow the audited-correction rule. |
| OffboardingCase | record_purpose | Enum | Internal | Set at record creation | OPERATIONAL, TRAINING, TEST. Data-use dimension, distinct from measurement_cohort. TRAINING and TEST must be synthetic, must never call live integrations, and are excluded from all business reporting. Changeable only by authorized, reasoned, audited correction before operational use. |
| OffboardingCase | status | Enum | Confidential | State machine | Current status; history separate. |
| OffboardingCase | reason_code | Reference | Restricted HR | HR | Versioned taxonomy. |
| OffboardingCase | reason_notes | Text | Restricted HR | HR | Optional, limited and restricted. |
| OffboardingCase | rehire_eligibility | Enum | Restricted HR | HR Manager | Not visible to departments. |
| OffboardingCase | created_at/approved_at/completed_at | Timestamp | Internal | System | KPI/audit evidence. |
| CaseStatusHistory | from_status/to_status | Enum | Confidential | State transition | Immutable event. |
| CaseStatusHistory | reason | Text | Restricted HR | Actor | Required for exceptional transitions. |
| WorkflowDefinition | code/version | String/Integer | Internal | Product configuration | Immutable once active/used. |
| WorkflowDefinition | departure_type | Enum | Internal | Product configuration | Maps workflow. |
| WorkflowInstance | workflow_definition_id | UUID | Internal | System | Pinned version. |
| TaskDefinition | code | String | Internal | Workflow config | Stable within version. |
| TaskDefinition | owner_role | Enum | Internal | Workflow config | Routing. |
| TaskDefinition | due_rule | Structured | Internal | Workflow config | Business day/exact time. |
| TaskDefinition | evidence_rule | Structured | Internal | Workflow config | Completion validation. |
| TaskInstance | status | Enum | Confidential | Workflow engine/user | State machine. |
| TaskInstance | assignee_user_id | UUID | Confidential | Assignment | Optional for queue tasks. |
| TaskInstance | due_at_original/current | Timestamp | Confidential | Rule engine | Preserve original. |
| TaskInstance | blocked_reason_code | Reference | Confidential | Assignee | Controlled taxonomy. |
| TaskInstance | completed_at/by | Timestamp/UUID | Confidential | System/user | Evidence. |
| Approval | object_type/object_id | Reference | Confidential | System | Document/case/template/etc. |
| Approval | decision | Enum | Confidential | Approver | APPROVE/REJECT/RETURN. |
| Approval | attestation | Text/version | Restricted HR | Approver | Approved wording reference. |
| StoredFile | storage_key | String | Restricted HR | System | Generated, never user path. |
| StoredFile | original_filename | String | Confidential | Uploader | Sanitized display only. |
| StoredFile | content_type/size/hash | Metadata | Internal | System | Validation/integrity. |
| StoredFile | scan_status | Enum | Internal | Scanner | QUARANTINED, CLEAN, REJECTED. |
| DocumentTemplate | type/version | Enum/Integer | Internal | HR governance | Controlled. |
| GeneratedDocument | status | Enum | Restricted HR | Document state | Issued snapshot immutable. |
| GeneratedDocument | template_version_id | UUID | Internal | System | Traceability. |
| GeneratedDocument | data_snapshot | Structured | Restricted HR | System | Exact populated values. |
| GeneratedDocument | issued_file_id/hash | Reference/String | Restricted HR | System | Evidence. |
| Notification | type/status | Enum | Confidential | Workflow/outbox | State machine. |
| Notification | due_at/scheduled_at/submitted_at | Timestamp | Confidential | Rules/provider | KPI evidence. |
| Notification | template_version_id | UUID | Internal | System | Traceability. |
| Notification | content_snapshot | Structured/Text | Restricted HR | System | Exact final content. |
| NotificationRecipient | address | Email | Restricted HR | Config/case | Minimum necessary; protected. |
| NotificationRecipient | recipient_type | Enum | Internal | System | INTERNAL, EMPLOYEE, EXTERNAL_PROVIDER. |
| NotificationAttempt | provider_reference | String | Internal | Provider | Troubleshooting. |
| NotificationAttempt | result/error_category | Enum/String | Internal | Provider/worker | No sensitive body. |
| AssetType | code/name | String | Internal | Admin | Versioned catalogue. |
| EmployeeIssuedAsset | source_asset_id | String | Confidential | Asset source/manual | Serialized when available. |
| CaseAsset | disposition | Enum | Confidential | Asset workflow | Final state. |
| CaseAsset | expected_return_at | Timestamp | Confidential | Workflow/HR | Reminder source. |
| CaseAsset | received_at/by | Timestamp/UUID | Confidential | Receiver | Return evidence. |
| CaseAsset | condition | Enum | Confidential | Receiver | Approved taxonomy. |
| CaseAsset | remarks | Text | Restricted HR | Receiver/HR | Limited free text. |
| HandoverPlan | manager_user_id | UUID | Confidential | Case/HR | Accountable owner. |
| HandoverItem | category/description | Enum/Text | Confidential | Manager/HR | No credentials. |
| HandoverItem | receiving_owner | Reference | Confidential | Manager | Required or escalated. |
| HandoverItem | risk | Text/level | Restricted HR | Manager | Visible at clearance. |
| SurveyDefinition | version/status | Integer/Enum | Internal | HR governance | Immutable once used. |
| SurveyInvitation | token_hash | Hash | Restricted HR | System | Never store raw token after issuance. |
| SurveyInvitation | eligibility/outcome | Enum | Restricted HR | HR/system | KPI denominator. |
| SurveyInvitation | sent_at/delivered_at/expires_at | Timestamp | Restricted HR | Outbox/provider | Evidence. |
| SurveyResponse | channel | Enum | Restricted HR | Respondent/HR | ONLINE, HR_INTERVIEW, VERBAL. |
| SurveyResponse | submitted_at | Timestamp | Restricted HR | System | Completion. |
| SurveyAnswer | question_version_id | UUID | Restricted HR | System | Version trace. |
| SurveyAnswer | answer | Structured/Text | Restricted HR | Respondent/HR | Most restricted content. |
| Exception | type/severity/status | Enum | Confidential | System/user | Operational control. |
| Exception | owner/due_at | Reference/Timestamp | Confidential | Rule/user | Accountability. |
| Waiver | type/reason/authority | Structured | Restricted HR | Approver | Immutable approval. |
| AuditEvent | event_type | String | Internal | System | Stable catalogue. |
| AuditEvent | actor/subject/object | References | Confidential | System | No unnecessary content. |
| AuditEvent | occurred_at/correlation_id | Timestamp/String | Internal | System | UTC and traceability. |
| IntegrationEvent | provider/type/status | Enum | Internal | Adapter | Sanitized metadata. |
| OutboxEvent | topic/payload_reference/status | Structured | Internal | System | No unnecessary raw PII. |
| Holiday | date/name/calendar_version | Date/String | Internal | Admin | Business-day rules. |
| RetentionPolicy | record_class/version/rule | Structured | Confidential | Privacy governance | Open until approved. |
| LegalHold | scope/reason/effective_dates | Structured | Restricted HR | Privacy/legal | Blocks disposal. |

## Source-of-truth rules

| Data domain | Primary source | Case behaviour |
| --- | --- | --- |
| Employee identity, work contact, department, location, position, manager | BambooHR or approved employee source | Retrieve and show source time; create immutable approved snapshot. |
| Receipt time and source | HR/source document | Entered/verified by HR; preserved for KPI. |
| Confirmed last day/effective time | HR-approved case decision | Authoritative for workflow and documents. |
| Departure type/reason/rehire eligibility | HR | Restricted; no departmental exposure. |
| Systems/access completion | IT task evidence | IT responder is authoritative for task completion, not employee source. |
| Finance completion | Finance task evidence | The offboarding app records status/evidence, not payroll calculations. |
| Benefits/provider applicability | Approved HR/benefits source or decision | Must be explicit before notification. |
| Issued assets | Approved asset register/manual evidence | Case snapshot can be supplemented with audited manual items. |
| Survey answers | Respondent or authorized HR interviewer | Immutable after submission; corrections follow controlled process. |
| Audit timestamps | System | UTC; immutable to application roles. |

## Data-model constraints

- Do not overwrite a case snapshot when live employee data changes.
- Do not store raw survey tokens.
- Do not store secret credentials in handover text.
- Do not use notification addresses as hard-coded source code values.
- Do not expose `Restricted HR` fields through broad list endpoints.
- Free text must be limited, guided and restricted.
- Issued documents and notification content snapshots are immutable.
- Deletion/retention must respect legal holds and approved policy versions.
