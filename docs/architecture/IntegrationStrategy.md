# Integration Strategy

## 1. Integration principles

- Core business rules remain provider-independent.
- Every provider sits behind a narrow adapter.
- Integrations use company-owned identities and least privilege.
- External failure must not corrupt case state or hide required work.
- Calls are idempotent, observable and reconcilable.
- Development uses stubs/sinks and cannot reach production by default.
- Payloads are minimized and sanitized in logs.
- Provider-specific acceptance/status is mapped carefully into domain status.

## 2. Identity provider

### Required capability

- OIDC or SAML SSO.
- MFA enforced by the company identity provider.
- stable subject identifier;
- user display/work-email claims;
- group or attribute mapping to application roles where approved;
- disabled-user/session revocation process;
- optional just-in-time user profile with no automatic privileged role grant.

### Open decisions

- actual provider;
- group-to-role model;
- session timeout policy;
- role approval/provisioning workflow;
- service/admin account treatment.

### Security rule

No production local-password or development role-switcher fallback.

## 3. BambooHR

### MVP approach

1. HR searches for an employee.
2. Adapter retrieves only approved fields.
3. UI shows source and retrieval time.
4. HR validates and approves the case snapshot.
5. Workflow uses the snapshot.
6. Local case data is not silently overwritten by later source changes.
7. A manual/update task records the separation update until write-back is separately approved.

### Authentication and ownership

BambooHR's API permissions reflect the associated user/application. Use a company-controlled dedicated integration identity or approved OAuth application. Do not use a normal employee's personal key.

Official API starting point:
https://documentation.bamboohr.com/docs/getting-started

### Webhook option

Current BambooHR documentation distinguishes event-based and field-based webhooks and recommends event-based webhooks for new integrations. Webhook requests require HTTPS and support HMAC signature verification using timestamp/signature headers.

Official webhook documentation:
https://documentation.bamboohr.com/docs/webhooks

Recommended later design:

- monitor only approved employment/identity fields;
- use event notification to trigger a current API fetch;
- verify HMAC over raw body and timestamp;
- reject stale/replayed requests;
- process batches idempotently;
- ignore unknown optional fields;
- reconcile missed/failed events;
- monitor provider delivery logs where available.

Permissioned webhooks can stop if the creating user's account is deactivated:
https://documentation.bamboohr.com/docs/permissioned-webhooks

### Failure handling

- source unavailable: allow controlled manual entry with `source_status=UNAVAILABLE`;
- stale cache: display warning and require reason to continue;
- permissions changed: health alert and integration exception;
- event missed: scheduled reconciliation;
- employee not found: controlled manual case plus source-resolution task;
- never discard an approved snapshot because later lookup fails.

## 4. Email provider

### Provider abstraction

Example interface concepts:

```text
send(message, idempotencyContext) -> providerAcceptance
getDeliveryEvidence(providerReference) -> optional evidence
validateRecipient(address) -> syntax/config result
health() -> provider health
```

The notification domain stores content, recipients, status and attempts. The adapter translates to Microsoft Graph, SMTP relay or another approved provider.

### Microsoft Graph option

The source screenshots show Outlook, making Graph a likely option. The official `sendMail` operation returns `202 Accepted`; Microsoft notes this means accepted for processing and does not indicate completed delivery.

Official documentation:
https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0

Therefore:

- map 202 to `SUBMITTED`;
- do not claim delivery;
- retain provider reference/correlation where available;
- use bounce/delivery signals only when actually integrated;
- maintain manual fallback;
- use the least privileged approved `Mail.Send` arrangement and constrain mailbox access.

Permissions reference:
https://learn.microsoft.com/en-us/graph/permissions-reference

### Mailbox model

Preferred:

- dedicated HR offboarding service/shared mailbox;
- approved From identity;
- application permission constrained to that mailbox where supported, or delegated service flow approved by IT;
- sent-item/audit/reconciliation expectations documented;
- no user's personal mailbox dependency.

### Development safety

- sink provider captures messages in a local/test UI or database;
- external domains blocked;
- startup/config guard prevents live provider credentials outside approved environment;
- synthetic recipients only.

## 5. External providers: NCB and Sagicor

These are recipients, not necessarily API integrations in MVP.

Required configuration:

- provider;
- programme type;
- recipient addresses;
- effective dates;
- owner and verifier;
- approved template;
- minimum field set;
- applicability rule;
- confirmation/fallback method;
- retention/sharing record.

Do not assume every employee is enrolled. Do not include departure reason, survey data, address or unnecessary contact data.

A later direct API integration requires its own contract, privacy and security assessment.

## 6. Object storage

Adapter responsibilities:

- quarantine upload;
- generated safe object key;
- content-type/size/hash metadata;
- read/write authorization;
- short-lived scoped download where approved;
- immutable issued-object mode or versioning;
- retention/deletion and legal-hold support;
- health/reconciliation.

The database owns business identity and classification; the storage provider key is not a document ID.

## 7. Malware scanner

Boundary:

```text
upload -> QUARANTINED -> scanner -> CLEAN or REJECTED
```

Requirements:

- asynchronous scanning supported;
- timeout/failure leaves file unavailable;
- scanner result and signature/version recorded where feasible;
- files never rendered or attached to email before CLEAN;
- operations alert on prolonged quarantine or scanner outage.

## 8. Future AI adapter

Disabled by default.

Potential later uses:

- suggest fields extracted from a resignation letter;
- draft text within an approved template;
- suggest de-identified themes.

Prohibited without further approval:

- legal/HR decisions;
- entitlement calculations;
- autonomous recipient selection;
- unreviewed issue/send;
- processing real data in an unassessed external service;
- training/retention of employee data contrary to approved terms.

The adapter must support data minimization, de-identification, provider/model/version evidence and human approval.

## 9. Integration correlation and idempotency

Every external operation should carry:

- application correlation ID;
- case/object ID;
- idempotency key;
- integration connection/version;
- request time;
- safe response category;
- provider reference;
- attempt number.

Never put personal or sensitive data into an idempotency key or URL.

## 10. Integration health

Technical health page:

- configured/enabled state;
- last success/failure;
- queue depth/oldest age;
- credential expiry warning where available;
- webhook last event and reconciliation result;
- sanitized error category;
- owner/runbook link.

HR exception feed receives business-impacting failures; technical users receive provider diagnostics without HR content.

## 11. Reconciliation

Required reconciliations:

- approved cases versus BambooHR/source status;
- notifications due versus submitted/fallback;
- provider failures/bounces versus resolved exceptions;
- database file records versus object existence;
- issued document hashes;
- worker outbox pending/dead-letter age;
- scheduled survey invitations/reminders;
- access tasks due versus completed.

Reconciliation produces explicit exceptions; it does not silently “fix” business state.
