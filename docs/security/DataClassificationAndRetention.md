# Data Classification and Retention

## 1. Classification scheme

| Class | Description | Examples | Default access | Handling |
| --- | --- | --- | --- | --- |
| PUBLIC | Approved public information. | None expected in case records; public privacy notice wording. | Public | Integrity/version control still required. |
| INTERNAL | Low-sensitivity operational metadata. | Template codes, task codes, technical health, non-sensitive configuration. | Authorized employees/technical users by role | Do not publish externally by default. |
| CONFIDENTIAL | Employee/business data needed by case participants. | Name, employee number, work email, department, location, task status, asset tag. | HR and task-specific authorized users | Encrypt, minimize, no public links, controlled export. |
| RESTRICTED_HR | Highest application class. | Termination preparation, personal email/address, resignation/termination documents, exit answers/free text, rehire eligibility, pay-related details, sensitive notes. | Explicit authorized HR/privacy participants only | Strong record-level authorization, access audit, export restrictions, limited free text, strict retention. |
| SECRET | Credentials/cryptographic material. | API keys, webhook secret, private key, session secret. | Approved technical secret store only | Never in database business fields, logs, tickets, docs or source control. |

## 2. Field/record classification rules

- The highest-class field determines the protection required for a combined view/export.
- A departmental task can contain CONFIDENTIAL fields but not unrelated RESTRICTED_HR content.
- Termination cases are RESTRICTED_HR by default.
- Identifiable survey responses are RESTRICTED_HR.
- Personal email is RESTRICTED_HR.
- Audit metadata is normally CONFIDENTIAL; audit metadata must not copy restricted content.
- Generated documents inherit their template/data classification.
- Notification content inherits the highest field classification and recipient-sharing rule.
- Secrets are never placed in normal application data.

## 3. Record-class retention model

Actual durations are OPEN and require HR/privacy/policy approval. The product must support the following classes independently.

| Record class | Examples | Retention start event | Proposed disposition capability | Duration status |
| --- | --- | --- | --- | --- |
| CASE_CORE | Case, snapshot, status history, closure report | Case completion or effective separation | Delete or anonymize according to approved policy | OPEN |
| EMPLOYMENT_DOCUMENT | Issued letters, Employee Action Form | Effective separation/case completion | Secure deletion after approved period unless hold | OPEN |
| SOURCE_UPLOAD | Resignation letter and supporting uploads | Case completion | May have shorter or equal period to official case record | OPEN |
| TASK_EVIDENCE | IT/Finance/manager attestations and evidence | Case completion | Delete with case policy or evidence-specific rule | OPEN |
| NOTIFICATION_RECORD | Content snapshot, recipients, attempts, fallback | Submission/case completion | Retain proof; minimize raw provider data | OPEN |
| ASSET_RECORD | Asset dispositions and evidence | Case completion/asset resolution | Retain according to asset/accounting policy | OPEN |
| HANDOVER_RECORD | Handover items/risks | Case completion | Consider shorter period once operational purpose ends | OPEN |
| SURVEY_IDENTIFIABLE | Invitation, response, free text | Response/expiry | Recommended separate shorter review; anonymize where feasible | OPEN |
| SURVEY_AGGREGATE | De-identified trends/categories | Aggregation period | May be retained longer if re-identification risk controlled | OPEN |
| AUDIT_EVENT | Business/security access and change events | Event time | Retain for assurance/investigation period | OPEN |
| SECURITY_INCIDENT | Incident/breach support record | Incident closure | Retain per security/privacy/legal policy | OPEN |
| INTEGRATION_METADATA | Sanitized attempts/errors/reconciliation | Event time | Short operational retention unless audit evidence | OPEN |
| EXPORT_ARTEFACT | Generated downloadable export file | Export creation | Short automatic expiry/deletion; export audit retained separately | OPEN |
| BACKUP | Database/object backups | Backup creation | Rotation plus legal-hold/incident considerations | OPEN |

## 4. Retention policy requirements

A policy version must specify:

- record class;
- scope/conditions;
- retention start event;
- duration;
- disposition action: delete, anonymize, aggregate or review;
- legal/policy authority reference;
- owner and approver;
- effective date;
- treatment of linked objects and backups;
- legal hold behaviour;
- dry-run/review rules;
- evidence retained after disposal.

## 5. Disposal workflow

Recommended:

1. scheduled job identifies eligible records;
2. legal hold and open-case/incident checks;
3. produce dry-run counts and exceptions;
4. require approval for a new policy/version's first live run;
5. dispose in safe dependency order;
6. reconcile database and object storage;
7. record evidence without retaining deleted content;
8. alert on partial failure;
9. support restore only under approved incident/legal process.

Do not hard-code a duration before `DEC-023` is approved.

## 6. Legal holds

A legal hold:

- identifies scope/subject/record classes;
- records authority and reason;
- has effective/review dates;
- blocks automated disposal;
- does not grant broader access;
- is itself restricted and audited;
- requires separate authorization to release.

## 7. Exports and local copies

The application cannot fully control a file after an authorized user downloads it. Reduce risk through:

- minimum necessary export fields;
- role/scope checks;
- warning/classification banner;
- optional watermark with user/time/reference;
- short-lived server-side export object;
- audit;
- user policy/training;
- avoid exporting identifiable survey free text unless specifically approved.

## 8. Backup considerations

- backups inherit the highest data classification;
- encryption and access controls are mandatory;
- retention/rotation approved by IT/privacy;
- restore exercises use controlled environments;
- restore must not emit queued notifications;
- disposed data in backups is handled by approved backup lifecycle rather than ad hoc editing.

## 9. Data-subject request support

Authorized privacy/HR users need:

- search by employee identifiers;
- collection of case, documents, sharing, access and survey records;
- redaction of third-party/confidential information as directed;
- export package evidence;
- controlled correction without history loss;
- request/decision/deadline tracking.

The Privacy/DPO function determines applicability and response content.
