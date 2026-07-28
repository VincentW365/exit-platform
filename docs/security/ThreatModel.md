# Threat Model

## 1. Method

Use a practical STRIDE/abuse-case review focused on high-risk assets and trust boundaries. Revisit after each new integration or public surface.

## 2. Protected assets

| Asset | Why valuable/sensitive |
| --- | --- |
| Restricted termination case | Premature disclosure can cause serious employee relations and security harm. |
| Exit survey answers/free text | May contain allegations, health, management or third-party information. |
| Personal email/contact | Used post-employment and should not be visible to departments. |
| Resignation/termination documents | Confidential employment record and evidence. |
| Exact effective separation time | Controls access-removal timing. |
| Roles/permissions | Compromise permits broad data access or unauthorized decisions. |
| Notification recipients/content | Wrong send can disclose personal data. |
| Audit events | Evidence of compliance and wrongdoing. |
| Survey tokens | Grant limited public access. |
| Integration credentials/webhook secrets | Permit external access/forged events. |
| Backups/object storage | Contain full historical records. |
| Workflow/template configuration | Malicious change can affect every case. |

## 3. Trust boundaries

1. employee/public survey browser ↔ web application;
2. internal browser ↔ web application;
3. web application ↔ database;
4. web/worker ↔ object storage/scanner;
5. worker ↔ email provider;
6. app/worker ↔ BambooHR;
7. application ↔ identity provider;
8. technical operations/administrators ↔ production environment;
9. reporting/export ↔ local files/email;
10. future AI provider ↔ employee data.

## 4. Threat catalogue

| ID | Threat/abuse case | STRIDE | Impact | Primary controls | Required tests/evidence |
| --- | --- | --- | --- | --- | --- |
| T-001 | User changes a case ID in a URL/API and reads another department's or restricted termination case. | Information disclosure / elevation | Critical | Server-side record authorization, deny-by-default list filters, explicit participants | IDOR tests for every protected route/list/export/file |
| T-002 | HR Officer approves their own restricted document or communication. | Elevation / repudiation | High | Maker-checker rule, approval authority, audit | Negative authorization tests |
| T-003 | SYSTEM_ADMIN uses technical access to browse HR content. | Information disclosure | High | No default content role, break-glass, database/admin separation, access review | Role tests, break-glass tabletop |
| T-004 | Survey token is guessed or brute-forced. | Spoofing | High | High entropy, hashing, rate limit, generic errors, HTTPS | Entropy review, brute-force/rate test |
| T-005 | Survey link is reused after submission or expiry. | Spoofing/tampering | High | Single use, expiry, atomic consume, revocation | Replay/concurrency tests |
| T-006 | Survey page reveals employee/case details to someone who receives a forwarded link. | Disclosure | High | Minimal page, no internal data, privacy notice | UI/data-leak test |
| T-007 | Malicious file upload compromises user/browser/server. | Tampering/DoS | Critical | Allow-list, magic/MIME, quarantine, scanner, safe serving, CSP | Polyglot/executable/oversize tests |
| T-008 | Stored filename/path traversal overwrites or exposes files. | Tampering/disclosure | Critical | Generated object key, no filesystem path trust | Traversal tests |
| T-009 | Notification worker sends duplicate email after retry/crash. | Repudiation/disclosure | High | Transactional outbox, idempotency, provider reference, dispatch sequence | Crash/retry/duplicate tests |
| T-010 | Notification goes to wrong or stale recipient. | Disclosure | Critical | Recipient configuration/effective dates, preview, validation, approval, minimum data | Recipient-resolution tests and UAT |
| T-011 | Provider returns 202 and UI reports delivered. | Repudiation | Medium/High | SUBMITTED status, delivery evidence model | Contract/UI tests |
| T-012 | Attacker forges BambooHR webhook to change source data. | Spoofing/tampering | High | HTTPS, HMAC raw-body verification, timestamp/replay check | Signature/replay tests |
| T-013 | Valid BambooHR webhook is replayed and duplicates work. | Tampering | High | Event/idempotency record and atomic processing | Replay tests |
| T-014 | Personal BambooHR integration user leaves and sync silently stops. | DoS/integrity | High | Dedicated identity, health checks, reconciliation | Credential ownership review, failure test |
| T-015 | Stale source data produces wrong letter/effective time. | Tampering/integrity | High | Source timestamp, HR validation, immutable snapshot, mismatch warning | Stale data scenarios |
| T-016 | Attacker changes effective separation time after approval to delay access removal. | Tampering/elevation | Critical | Restricted command, impact preview, reason, audit, alert | Authorization and audit tests |
| T-017 | User marks mandatory task complete without required evidence. | Tampering/repudiation | High | Typed evidence validation, server command, closure check | Negative completion tests |
| T-018 | User closes case while access/asset/Finance work is incomplete. | Tampering | Critical | Closure integrity, HR Manager approval | End-to-end closure negative tests |
| T-019 | Asset status automatically reduces final pay. | Integrity/abuse | High | Domain separation, no payroll effect, policy exception route | Architecture/code review and negative tests |
| T-020 | Sensitive answers appear in logs, analytics or error tracking. | Disclosure | Critical | Log allow-list, payload redaction, no body capture | Log inspection and synthetic canary test |
| T-021 | Exported report is emailed/downloaded by unauthorized user. | Disclosure | High | Export permission, redaction, audit, short retention, optional watermark | Authorization/export tests |
| T-022 | Small survey cohort identifies an employee. | Disclosure | High | Suppression threshold, no drill-through, filter protection | Privacy reporting tests |
| T-023 | Compromised template injects malicious content or wrong legal wording into all cases. | Tampering | Critical | Version approval, safe render engine, checksum, pinning, UAT | Template activation tests/review |
| T-024 | Compromised workflow removes a required IT task. | Tampering | Critical | Versioned maker-checker workflow, validation, regression tests | Workflow diff/activation tests |
| T-025 | Feature flag enables real email in development. | Disclosure | Critical | Safe defaults, external domain block, startup guard, separate credentials | Configuration tests |
| T-026 | Database backup is restored without corresponding objects or re-sends outbox work. | Integrity/repudiation | High | Consistent restore, outbox reconciliation, no-send restore mode | Restore exercise |
| T-027 | Retention job deletes legally held or wrong records. | Tampering/disclosure | Critical | Versioned policy, dry-run, legal hold, approval, evidence, backup | Retention dry-run/test |
| T-028 | Retention never runs and data is kept indefinitely. | Disclosure/compliance | High | Scheduled monitoring, policy reports, alert | Job monitoring/report |
| T-029 | Error message exposes SQL, stack, object key or token. | Disclosure | Medium/High | Safe errors/reference IDs | Error-path tests |
| T-030 | Insider bulk-enumerates cases or downloads documents. | Disclosure | Critical | Scope filters, access audit, rate/anomaly monitoring, export restrictions | Access review and anomaly scenarios |
| T-031 | Session remains active after role removal/employee departure. | Elevation | High | IdP lifecycle, session revocation/short timeout, periodic access review | Revocation test |
| T-032 | CSRF causes an authenticated HR user to approve/send/void. | Tampering | Critical | SameSite, CSRF/origin checks, confirmation/re-auth for high risk | CSRF tests |
| T-033 | XSS in notes/template/survey text steals session or changes content. | Tampering/disclosure | Critical | Validation, output encoding, sanitized limited markup, CSP | XSS tests |
| T-034 | Worker retries indefinitely and floods provider/system. | DoS | High | bounded retry, concurrency, dead-letter, alert | Failure injection/load test |
| T-035 | Future AI prompt/document content is retained or used for training. | Disclosure | Critical | AI disabled, approved provider/terms, minimization, de-identification | Governance evidence and provider tests |
| T-036 | Prompt injection in uploaded resignation controls an AI agent. | Tampering/elevation | High | no autonomous agent, untrusted document separation, structured extraction review | AI threat tests if feature approved |
| T-037 | Audit events are deleted/edited to hide wrongdoing. | Repudiation | Critical | append-only permissions, backup, integrity monitoring | Database/authorization tests |
| T-038 | User disputes an action because time/source is unclear. | Repudiation | High | UTC timestamps, actor, attestation, correlation, immutable content hashes | Audit trace UAT |
| T-039 | Public survey endpoint is abused for DoS. | DoS | Medium | rate limits, bounded body, no expensive unauthenticated operations | Load/rate tests |
| T-040 | Cross-border processor receives data without review. | Disclosure/compliance | High | processor inventory, DPIA/transfer gate, feature disabled | Governance/release checklist |

## 5. High-risk abuse stories

### Premature termination disclosure

An unauthorized manager searches the employee's name and discovers a restricted pending termination.

Required defense:

- restricted case absent from search/counts;
- no timing/status leak;
- no broad notifications;
- explicit release of manager task only;
- access denials audited without revealing object existence.

### Duplicate urgent access message

Worker crashes after provider acceptance but before local update, then retries.

Required defense:

- persisted attempt/correlation;
- provider/idempotency strategy;
- deduplication key;
- manual reconciliation rather than blind repeat;
- test crash at each step.

### Exit-feedback retaliation

A manager filters reports to a small location/month and infers the respondent.

Required defense:

- threshold applies after every filter;
- combine/suppress rather than show zero/one;
- no drill-through/free text;
- HR-only identifiable view;
- export uses same rules.

## 6. Threat-model review triggers

Update this document when:

- identity/hosting provider is selected;
- BambooHR webhooks or write-back are added;
- Microsoft Graph/live email is enabled;
- public survey changes;
- file types/rendering change;
- AI is proposed;
- direct system revocation/payroll APIs are proposed;
- retention rules are approved;
- a security/privacy incident or test reveals a new threat.
