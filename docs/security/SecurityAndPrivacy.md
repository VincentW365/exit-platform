# Security and Privacy Baseline

## 1. Risk posture

The application processes confidential employee identity, resignation/termination records, personal contact details, benefit participation, rehire eligibility, documents, asset evidence and potentially sensitive exit-feedback allegations. A breach or inappropriate disclosure can harm employees and the company even at low case volume.

Security and privacy are release criteria, not post-build enhancements.

## 2. Reference baselines

- OWASP Application Security Verification Standard 5.0.0 as the current verification baseline:
  https://owasp.org/www-project-application-security-verification-standard/
- W3C WCAG 2.2 Level AA target:
  https://www.w3.org/WAI/standards-guidelines/wcag/
- Jamaica Office of the Information Commissioner data-protection standards:
  https://www.oic.gov.jm/page/data-protection-standards
- OIC data-controller obligations:
  https://oic.gov.jm/content/what-are-obligations-data-controllers

This project documentation is not legal advice. The authorized privacy/DPO and policy/legal functions must confirm obligations and retention/sharing decisions.

## 3. Data protection principles applied

### Fairness and lawfulness

- clearly state offboarding and survey purposes;
- present approved notices;
- do not misrepresent anonymity/confidentiality;
- do not reuse survey data for unrelated purposes without review.

### Purpose limitation

- each field, export, integration and external disclosure maps to an approved purpose;
- departmental queues cannot become a general employee directory;
- notification data is purpose-specific.

### Data minimization

- role/task-specific views;
- minimum external field sets;
- structured categories before free text;
- no source screenshots or unnecessary documents in case views;
- no employee data in logs.

### Accuracy

- show source and retrieval time;
- require HR validation before snapshot;
- use controlled corrections;
- preserve original history.

### Storage limitation

- configure record-class retention;
- implement legal hold;
- delete/anonymize with evidence;
- do not enable disposal until approved.

### Data-subject rights

- support authorized search/export and correction workflows;
- preserve request/response evidence;
- protect third-party information during disclosure.

### Security

- least privilege, encryption, secure upload, audit, backups, incident response and verified SDLC.

### Cross-border transfers

- identify hosting, email, storage, integration and AI processing locations;
- obtain approved assessment/contracts before enablement;
- minimize transferred fields.

## 4. Authentication

Production:

- company-approved OIDC or SAML;
- MFA enforced by identity provider;
- no local-password bypass;
- disabled-user access termination;
- secure session cookies;
- idle and absolute session timeouts;
- CSRF/origin protection;
- session revocation for high-risk events.

Development role switcher:

- only in non-production;
- requires `ALLOW_DEV_LOGIN=true`;
- startup fails or route is absent when production;
- synthetic identities only;
- visibly marked environment.

## 5. Authorization

Use RBAC plus record attributes:

```text
allow =
  role permits action
  AND case classification permits discovery/access
  AND user is within scope or explicit participant
  AND object-specific rule permits action
  AND state transition permits action
```

Controls:

- apply to list, count, search, export, file access and detail endpoints;
- test IDOR by swapping IDs;
- termination cases restricted by default;
- survey response permission separated from case permission;
- retired role assignments (SYSTEM_ADMIN and the others) grant nothing; only HR_MANAGER / HR_OFFICER exist (DEC-063);
- break-glass is time-bound and audited;
- deny by default.

## 6. Sensitive action controls

Require stronger authority and/or recent authentication for:

- role grants;
- break-glass;
- workflow/template activation;
- retention deletion/legal hold;
- restricted export;
- case void/reopen;
- asset waiver;
- sensitive communication approval;
- changing effective separation time after approval.

## 7. Input, output and file security

### Input

- server-side schema validation;
- length/range/enum allow-lists;
- canonicalize identifiers;
- parameterized database access through ORM and reviewed raw queries;
- reject unknown required structures;
- sanitize rich text or avoid it.

### Output

- contextual encoding;
- no untrusted HTML templates;
- safe Markdown/plain text where possible;
- Content Security Policy;
- no secret/internal errors to users.

### Uploads

- allow-listed business file types;
- extension, MIME and magic-byte validation;
- configurable size/count;
- generated object keys;
- quarantine;
- malware scan;
- no execution;
- no inline rendering of unsafe types;
- authorized download only;
- scan status visible;
- retention/legal hold.

## 8. Token-protected survey

- at least cryptographically strong random token;
- store hash, never raw token after issue;
- one invitation/purpose;
- expiry;
- single use;
- revocation/suppression;
- rate limit and generic errors;
- no employee/case identifiers in URL beyond opaque token;
- no internal data on page;
- HTTPS only;
- no indexing/caching of sensitive content;
- secure confirmation after submit;
- no response edit through token after submit.

## 9. Notifications and integrations

- outbox and bounded retries;
- idempotency;
- approved provider/service identity;
- least privilege;
- no credentials in repository;
- payload minimization;
- HMAC/timestamp verification for webhooks;
- replay protection;
- submitted versus delivered distinction;
- sandbox in non-production;
- recipient preview and approval;
- failure and manual fallback evidence.

## 10. Logging, audit and monitoring

### Operational logs

Allowed:

- correlation ID;
- technical route/job;
- status/error category;
- duration;
- provider/integration name;
- safe object IDs.

Disallowed:

- letter/email bodies;
- survey answers;
- personal/home addresses or emails unless essential and masked;
- raw tokens;
- API keys;
- session cookies;
- file contents;
- full source payloads;
- database connection strings.

### Audit

Use the event catalogue. Audit events are business evidence and append-only to operational users.

### Alerts

At minimum:

- failed/stuck urgent access task;
- notification queue age/failure/bounce;
- worker heartbeat failure;
- integration authentication/permission failure;
- repeated authorization denial/anomaly;
- malware/scanner outage;
- backup/restore failure;
- retention-job failure;
- break-glass use;
- critical application error.

## 11. Encryption and keys

- TLS for all production traffic and callbacks;
- managed encryption at rest for database/backups/objects;
- secrets in approved secret store;
- rotation and ownership;
- separate environment secrets;
- no custom encryption algorithms;
- application-level field encryption only after key-management and operational review.

## 12. Secure SDLC

Every implementation stage:

- threat-model update for new boundaries;
- peer/independent review of Claude output;
- lint/type check;
- unit/integration/authorization tests;
- dependency and secret scan;
- migration review;
- documentation update.

Before pilot:

- ASVS-based verification;
- authenticated DAST;
- upload/token/IDOR tests;
- accessibility test;
- backup/restore;
- incident/fallback tabletop;
- UAT;
- unresolved critical/high defects blocked or formally risk-accepted by authority.

## 13. Privacy operations

The product must support—not automatically decide:

- data-subject access/correction requests;
- sensitive-access reviews;
- external-sharing records;
- processor inventory references;
- legal holds;
- record-class retention/disposition;
- incident awareness and notification tracking;
- DPIA evidence.

The OIC currently states data-controller obligations including reporting certain security breaches/contraventions within 72 hours after awareness. The incident runbook must preserve awareness time and escalation, while the Privacy/DPO function determines applicability and content.

## 14. AI privacy/security gate

Before any real employee data is processed by AI:

- define exact use case and necessity;
- minimize/de-identify inputs;
- approve provider, model, hosting region and terms;
- prohibit provider training/retention unless explicitly approved;
- assess cross-border transfer;
- define human review;
- log provenance without storing unnecessary prompts;
- test hallucination/injection/data leakage;
- provide disable/rollback;
- update privacy notice/DPIA if required.

Until then, AI integration remains disabled and development uses synthetic data.

## 15. Security ownership

| Area | Accountable owner |
| --- | --- |
| HR content/process authorization | HR Manager |
| Identity, hosting, technical controls | IT |
| Privacy, retention, disclosure, incidents | Privacy/DPO function |
| Requirements and release gate | Product Owner/Business Analyst |
| Independent assurance | Auditor/security reviewer |
| Implementation evidence | Claude/technical implementer under review |
