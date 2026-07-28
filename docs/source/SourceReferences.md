# Source and Standards References

## Primary business source

- `DMAIC HR Offboarding Process` — 27-page internal document completed July 2026.
- Page references in this repository refer to the rendered document pages.

## Official external references used for the baseline

These references inform security, privacy, accessibility and integration design. They do not replace review by Bert's authorized HR, privacy, legal/policy or IT functions.

### Jamaica data protection

- Office of the Information Commissioner — Data Protection Standards
  https://www.oic.gov.jm/page/data-protection-standards
- Office of the Information Commissioner — Obligations of Data Controllers
  https://oic.gov.jm/content/what-are-obligations-data-controllers
- Laws of Jamaica — Data Protection Act, 2020
  https://laws.moj.gov.jm/library/act-of-parliament/7-2020-the-data-protection-act

The OIC describes eight standards including fairness/lawfulness, purpose limitation, data minimization, accuracy, storage limitation, data-subject rights, security and cross-border transfer controls. The OIC also states data-controller breach-reporting obligations, including a 72-hour reporting period after awareness. The project must confirm how these obligations apply operationally rather than treating this documentation as legal advice.

### Application security

- OWASP Application Security Verification Standard
  https://owasp.org/www-project-application-security-verification-standard/

The current stable ASVS identified during preparation is 5.0.0. The project uses it as a verification baseline, not as a claim of certification.

### Accessibility

- W3C WCAG 2 Overview
  https://www.w3.org/WAI/standards-guidelines/wcag/

The product targets WCAG 2.2 Level AA.

### BambooHR

- Getting Started with the API
  https://documentation.bamboohr.com/docs/getting-started
- Webhooks
  https://documentation.bamboohr.com/docs/webhooks
- Permissioned Webhooks
  https://documentation.bamboohr.com/docs/permissioned-webhooks

BambooHR requests are permissioned as the associated user/application. Permissioned webhooks can stop when the creating user's account is deactivated. Current webhook guidance requires HTTPS and supports HMAC signature verification. These facts support the dedicated integration-identity and signed-webhook requirements.

### Microsoft Graph mail

- `sendMail` API
  https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0
- Microsoft Graph permissions reference
  https://learn.microsoft.com/en-us/graph/permissions-reference

The `sendMail` operation can return `202 Accepted`; this means accepted for processing, not proof of final delivery. The product therefore distinguishes `SUBMITTED` from `DELIVERED_IF_KNOWN` and keeps provider attempts/failures.

## Reference review date

2026-07-28. Re-check official integration and security documentation before implementing a later stage because APIs, permissions and standards can change.
