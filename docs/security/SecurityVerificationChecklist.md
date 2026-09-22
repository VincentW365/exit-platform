# Security Verification Checklist

## Use

This checklist operationalizes the security/privacy baseline and supports OWASP ASVS 5.0.0-aligned verification. It is not a certification claim. Each checked item requires evidence: test output, configuration, screenshot, review record, runbook result or risk acceptance.

| Check | Area | Stage | Verification item |
| --- | --- | --- | --- |
| [ ] SEC-GOV-001 | Governance | 1 | Security/privacy owners assigned and contact/escalation documented. |
| [ ] SEC-GOV-002 | Governance | 1 | Threat model reviewed for active stage. |
| [ ] SEC-GOV-003 | Governance | 1 | No real employee data in repo, seeds, tests or screenshots. |
| [ ] SEC-GOV-004 | Governance | 1 | Open security/privacy decisions relevant to stage are resolved or block release. |
| [ ] SEC-GOV-005 | Governance | 7 | DPIA/privacy assessment approved before production. |
| [ ] SEC-GOV-006 | Governance | 7 | Processor/subprocessor and cross-border review complete. |
| [ ] SEC-AUTH-001 | Authentication | 1 | Production uses approved OIDC/SAML; no local bypass. |
| [ ] SEC-AUTH-002 | Authentication | 1 | MFA is enforced through the identity provider. |
| [ ] SEC-AUTH-003 | Authentication | 1 | Development login requires non-production and explicit flag. |
| [ ] SEC-AUTH-004 | Authentication | 1 | Production startup fails or route is absent if development login is enabled. |
| [ ] SEC-AUTH-005 | Authentication | 1 | Session cookies/credentials use Secure, HttpOnly and appropriate SameSite. |
| [ ] SEC-AUTH-006 | Authentication | 1 | Idle/absolute timeout and logout behaviour are tested. |
| [ ] SEC-AUTH-007 | Authentication | 7 | Role removal/identity disable revokes access within approved target. |
| [ ] SEC-AUTHZ-001 | Authorization | 1 | Every protected list/detail/mutation enforces server-side authorization. |
| [ ] SEC-AUTHZ-002 | Authorization | 1 | IDOR tests cover case, task, document, file, survey, export and audit IDs. |
| [ ] SEC-AUTHZ-003 | Authorization | 1 | Restricted termination cases are absent from unauthorized search/counts. |
| [ ] SEC-AUTHZ-004 | Authorization | 2 | Identifiable survey responses use separate permission checks. |
| [ ] SEC-AUTHZ-005 | Authorization | 1 | No login outside HR_MANAGER / HR_OFFICER exists; stored retired-role assignments (SYSTEM_ADMIN and the others) grant nothing (DEC-063). |
| [ ] SEC-AUTHZ-006 | Authorization | 7 | Break-glass request/approval/expiry/review is tested. |
| [ ] SEC-AUTHZ-007 | Authorization | 1 | Role grants cannot be self-approved or self-escalated. |
| [ ] SEC-AUTHZ-008 | Authorization | 6 | Exports apply effective record/field permissions and are audited. |
| [ ] SEC-INPUT-001 | Validation | 1 | All server boundaries use explicit schemas and length/type limits. |
| [ ] SEC-INPUT-002 | Validation | 1 | Database queries are parameterized/ORM-safe; raw SQL is reviewed. |
| [ ] SEC-INPUT-003 | Validation | 1 | XSS payloads in notes, names, templates and survey inputs are safely handled. |
| [ ] SEC-INPUT-004 | Validation | 1 | CSRF/origin protections cover state-changing browser operations. |
| [ ] SEC-INPUT-005 | Validation | 1 | Errors do not expose stack, SQL, object keys, tokens or secrets. |
| [ ] SEC-FILE-001 | File upload | 1 | Allowed file types/sizes are documented and enforced. |
| [ ] SEC-FILE-002 | File upload | 1 | Extension, MIME and magic-byte checks are tested. |
| [ ] SEC-FILE-003 | File upload | 1 | Object keys are generated; path traversal is impossible. |
| [ ] SEC-FILE-004 | File upload | 1 | Files remain quarantined until scanner result CLEAN. |
| [ ] SEC-FILE-005 | File upload | 1 | Rejected/timeout/scanner-down files cannot be viewed or attached. |
| [ ] SEC-FILE-006 | File upload | 1 | Downloads re-check current authorization. |
| [ ] SEC-FILE-007 | File upload | 1 | Short-lived signed URLs, if used, are scoped and non-enumerable. |
| [ ] SEC-TOKEN-001 | Survey token | 2 | Token uses cryptographically secure randomness and adequate entropy. |
| [ ] SEC-TOKEN-002 | Survey token | 2 | Only token hash is stored. |
| [ ] SEC-TOKEN-003 | Survey token | 2 | Single-use consumption is atomic under concurrent requests. |
| [ ] SEC-TOKEN-004 | Survey token | 2 | Expired/revoked/suppressed tokens fail generically. |
| [ ] SEC-TOKEN-005 | Survey token | 2 | Rate limiting prevents brute force and abuse. |
| [ ] SEC-TOKEN-006 | Survey token | 2 | Survey page reveals no internal case data. |
| [ ] SEC-CRYPTO-001 | Cryptography/secrets | 1 | TLS is enforced in production and external callbacks. |
| [ ] SEC-CRYPTO-002 | Cryptography/secrets | 1 | Database, backups and object storage are encrypted at rest. |
| [ ] SEC-CRYPTO-003 | Cryptography/secrets | 1 | Secrets are outside source control and logs. |
| [ ] SEC-CRYPTO-004 | Cryptography/secrets | 5 | Integration secret ownership/rotation/revocation is documented. |
| [ ] SEC-CRYPTO-005 | Cryptography/secrets | 1 | Secret scan runs in CI and pre-commit/review process. |
| [ ] SEC-NOT-001 | Notifications | 5 | Transactional outbox is atomic with domain state. |
| [ ] SEC-NOT-002 | Notifications | 5 | Idempotency/duplicate-send tests include worker crash/retry. |
| [ ] SEC-NOT-003 | Notifications | 5 | Non-production blocks real recipients/providers. |
| [ ] SEC-NOT-004 | Notifications | 5 | Recipient preview/approval and minimum-data rules are tested. |
| [ ] SEC-NOT-005 | Notifications | 5 | 202/provider acceptance is not displayed as delivered. |
| [ ] SEC-NOT-006 | Notifications | 5 | Retries are bounded; permanent failure creates an exception. |
| [ ] SEC-NOT-007 | Notifications | 5 | Manual fallback captures evidence without rewriting failed attempts. |
| [ ] SEC-INT-001 | Integrations | 5 | BambooHR uses company-owned identity and approved fields. |
| [ ] SEC-INT-002 | Integrations | 5 | Webhook HMAC is verified over raw body and timestamp. |
| [ ] SEC-INT-003 | Integrations | 5 | Webhook replay/idempotency and batch handling are tested. |
| [ ] SEC-INT-004 | Integrations | 5 | Stale/unavailable source uses visible fallback and reconciliation. |
| [ ] SEC-INT-005 | Integrations | 5 | Health/credential failures alert without exposing sensitive payloads. |
| [ ] SEC-LOG-001 | Logging/audit | 1 | Operational logs contain no document/email body, survey answer, raw token or secret. |
| [ ] SEC-LOG-002 | Logging/audit | 1 | Sensitive audit events are appended in same transaction as business change where required. |
| [ ] SEC-LOG-003 | Logging/audit | 1 | Audit events cannot be edited/deleted by operational roles. |
| [ ] SEC-LOG-004 | Logging/audit | 6 | Restricted views/downloads/exports are audited. |
| [ ] SEC-LOG-005 | Logging/audit | 7 | Clock/timezone/correlation evidence is consistent. |
| [ ] SEC-PRIV-001 | Privacy | 1 | Field classification and minimum-view matrices are implemented. |
| [ ] SEC-PRIV-002 | Privacy | 2 | Survey notice matches actual confidentiality/anonymity design. |
| [ ] SEC-PRIV-003 | Privacy | 5 | External provider field sets and applicability are approved. |
| [ ] SEC-PRIV-004 | Privacy | 6 | Small-cohort suppression works after all filters/exports. |
| [ ] SEC-PRIV-005 | Privacy | 7 | Retention policy versions, legal hold and dry-run are tested. |
| [ ] SEC-PRIV-006 | Privacy | 7 | Data-subject search/export/correction support is reviewed. |
| [ ] SEC-PRIV-007 | Privacy | 7 | Incident record captures awareness time and notification evidence. |
| [ ] SEC-SDLC-001 | Secure SDLC | 1 | Strict type check, lint and tests pass. |
| [ ] SEC-SDLC-002 | Secure SDLC | 1 | Dependency vulnerability scan passes approved threshold. |
| [ ] SEC-SDLC-003 | Secure SDLC | 1 | Static security scan findings are resolved/risk accepted. |
| [ ] SEC-SDLC-004 | Secure SDLC | 7 | Authenticated DAST covers critical routes. |
| [ ] SEC-SDLC-005 | Secure SDLC | 7 | Independent review of Claude-generated security-sensitive code completed. |
| [ ] SEC-SDLC-006 | Secure SDLC | 7 | Migrations reviewed for data exposure, defaults, rollback and constraints. |
| [ ] SEC-OPS-001 | Operations | 1 | Environments use separate credentials/data/providers. |
| [ ] SEC-OPS-002 | Operations | 5 | Worker queue age, failure and heartbeat monitoring is active. |
| [ ] SEC-OPS-003 | Operations | 7 | Database/object backup and restore exercise succeeds. |
| [ ] SEC-OPS-004 | Operations | 7 | Restore/test mode prevents notification dispatch. |
| [ ] SEC-OPS-005 | Operations | 7 | Manual fallback tabletop covers urgent termination/access removal. |
| [ ] SEC-OPS-006 | Operations | 7 | Security/privacy incident escalation contacts and runbooks are approved. |
| [ ] SEC-A11Y-001 | Accessibility | 1 | Keyboard, focus, labels, errors and status semantics pass accessibility checks. |
| [ ] SEC-A11Y-002 | Accessibility | 1 | No status/action relies solely on colour. |
| [ ] SEC-A11Y-003 | Accessibility | 2 | Survey works with screen reader/mobile/zoom. |
| [ ] SEC-A11Y-004 | Accessibility | 7 | Automated and manual WCAG 2.2 AA review evidence exists. |

## Release blocking

A release is blocked by:

- unresolved critical/high vulnerability without authorized risk acceptance;
- unauthorized access/IDOR;
- real external email possible from non-production;
- restricted termination/survey exposure;
- unsafe upload path;
- weak/reusable survey token;
- no exact-time access task support for applicable workflows;
- failed backup/restore before production pilot;
- missing privacy approvals for retention/external sharing;
- critical audit gaps;
- production development-login bypass.

## Evidence package

Before pilot/full rollout, archive:

- security test report;
- authorization test matrix;
- dependency/secret/SAST results;
- DAST result;
- upload/token test result;
- accessibility report;
- backup/restore result;
- incident/fallback tabletop;
- processor/DPIA/retention approvals;
- unresolved findings and risk acceptances;
- release commit/tag and deployment configuration record.
