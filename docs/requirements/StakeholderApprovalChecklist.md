# Stakeholder Approval Checklist

## How to use

Before each delivery stage, the named owner must mark the relevant decision `APPROVED`, `DEFERRED`, `REJECTED`, or provide revised wording in `DecisionRegister.md`. A checked box in this document is only a review aid; the Decision Register is authoritative.

**Constraints are not approvals.** `Stage1ImplementationConstraints.md` records reversible, non-production engineering constraints (IC-S1-001 to IC-S1-011) so that Stage 1 foundation work can proceed while decisions remain unresolved. A recorded constraint must **never** be treated as a reason to tick a box below. Every Stage 1 box remains unticked until its named owner approves in writing.

## Before Stage 1

| Confirm | Decision | Current status | Owner | Recommended decision |
| --- | --- | --- | --- | --- |
| [ ] DEC-001 | Knowledge transfer scope | PROVISIONAL | Project Sponsor / HR Manager | Include a configurable handover module in the product baseline. Enable it for resignation-with-notice by default; allow HR to mark it not applicable for immediate departures and restricted terminations. |
| [ ] DEC-002 | MVP case initiation | PROVISIONAL | Project Sponsor / HR Manager | Authorized HR users create cases. Employee self-service and automated mailbox ingestion are deferred change requests. |
| [ ] DEC-003 | Departure workflow variants | PROVISIONAL | HR Manager | Use separate versioned workflows for resignation with notice, immediate resignation, and termination. |
| [ ] DEC-007 | Baseline measurement | PROVISIONAL | Project Sponsor / HR Manager | Release a baseline-capture mode first, with automation feature flags disabled. Mark every case as BASELINE, PILOT, or POST_ROLLOUT. |
| [ ] DEC-021 | Production identity provider | OPEN | IT / Security | Use company-approved SSO through OIDC or SAML with MFA enforced by the identity provider. A development role switcher is allowed only outside production behind two independent safeguards. |
| [ ] DEC-022 | Deployment environment | OPEN | IT / Project Sponsor | Use a company-owned environment with managed PostgreSQL-compatible storage and private object storage. Final hosting choice remains open. |
| [ ] DEC-027 | Business-day calendar | PROVISIONAL | HR Manager | Use timezone America/Jamaica and a configurable holiday calendar owned by HR or Administration. Store the due date calculated at task creation and audit recalculations. |
| [ ] DEC-031 | Reason-for-leaving taxonomy | OPEN | HR Manager / Process Analyst | Use a controlled reason taxonomy plus restricted optional free text. HR owns the taxonomy and changes are versioned. |
| [ ] DEC-032 | Rehire eligibility | PROVISIONAL | HR Manager | Treat rehire eligibility as restricted HR data. Do not expose it to departmental users or external providers. |
| [ ] DEC-033 | Historical migration | OPEN | Project Sponsor / HR Manager | Do not migrate old paper files during MVP. Define a separate, approved migration project or load only a limited reporting baseline. |
| [ ] DEC-035 | Termination confidentiality | PROVISIONAL | HR Manager / Privacy Officer | Termination cases use RESTRICTED classification by default and are visible only to explicitly assigned HR personnel, necessary approvers, and task recipients receiving minimized views. |

## Before Stage 2

| Confirm | Decision | Current status | Owner | Recommended decision |
| --- | --- | --- | --- | --- |
| [ ] DEC-004 | Authoritative automation model | PROVISIONAL | Project Sponsor / HR Manager / IT | Use deterministic workflow rules and approved templates. Generative AI is optional assistance only and cannot be the authoritative source of letters, entitlements, decisions, or dispatch. |
| [ ] DEC-005 | Communication approval | PROVISIONAL | HR Manager | Require human approval for employee-facing, external-party, and termination communications in MVP. Departmental reminders may be auto-sent after the relevant task/workflow has been approved. |
| [ ] DEC-010 | Employee Action Form hierarchy | PROVISIONAL | HR Manager / Project Sponsor | Digitize the existing sign-off hierarchy without changing approvers or authority. Any structural change requires a separate change request. |
| [ ] DEC-011 | Exit feedback visibility | PROVISIONAL | HR Manager / Privacy Officer | Identifiable exit responses are restricted to authorized HR roles. Line managers receive only approved aggregate reporting with small-cohort suppression. |
| [ ] DEC-012 | Exit survey identity model | PROVISIONAL | HR Manager / IT | Use a single-purpose, time-limited, one-time token sent to a verified personal email. No normal employee account is required. |
| [ ] DEC-013 | Survey timing | PROVISIONAL | HR Manager | Schedule the initial post-departure survey for day 3 after the effective departure date and one reminder on day 7. Allow HR to suppress or reschedule. |
| [ ] DEC-014 | Survey eligibility | OPEN | HR Manager / Project Sponsor | HR must record whether a case is eligible for a survey. Termination cases are not assumed eligible; applicability is controlled by a workflow rule and policy. |
| [ ] DEC-015 | Survey anonymity | OPEN | HR Manager / Privacy Officer | Default to confidential but identifiable responses for HR follow-up; aggregate reports must suppress cohorts smaller than a sponsor-approved threshold. Decide whether an anonymous option is required. |
| [ ] DEC-025 | Digital signatures and attestations | OPEN | HR Manager / Legal or policy owner | Use authenticated approval/attestation records in MVP rather than pasted signature images. Determine whether any document requires a qualified electronic signature. |

## Before Stage 3

| Confirm | Decision | Current status | Owner | Recommended decision |
| --- | --- | --- | --- | --- |
| [ ] DEC-006 | Security-critical access removal | PROVISIONAL | HR Manager / IT Manager | Create IT revocation tasks due at the exact approved separation date and time. Immediate resignation and termination may require immediate execution; the 24-hour notification KPI must not delay revocation. |
| [ ] DEC-026 | Case completion gate | PROVISIONAL | HR Manager | A case can enter CLEARANCE_REVIEW when all mandatory tasks are completed or validly waived and each asset has a final disposition. HR Manager approval is required for COMPLETED. |

## Before Stage 4

| Confirm | Decision | Current status | Owner | Recommended decision |
| --- | --- | --- | --- | --- |
| [ ] DEC-008 | Asset KPI model | PROVISIONAL | HR Manager / Finance / IT | Separate asset disposition documentation compliance from physical asset recovery rate. |
| [ ] DEC-009 | Final pay and unreturned assets | PROVISIONAL | HR Manager / Finance / Legal or policy owner | The application records an exception and routes it to authorized HR/Finance personnel. It must not automatically withhold, deduct, or alter final pay. |

## Before Stage 5

| Confirm | Decision | Current status | Owner | Recommended decision |
| --- | --- | --- | --- | --- |
| [ ] DEC-016 | External provider applicability | PROVISIONAL | HR Manager / Benefits owner | Notify Sagicor and NCB only when the employee is enrolled in the applicable programme and the departure event requires removal. Record the rule and evidence. |
| [ ] DEC-017 | External provider data fields | OPEN | HR Manager / Privacy Officer / Benefits owner | Approve a minimum field set per provider before automation. Do not include resignation reasons, free text, or unnecessary contact details. |
| [ ] DEC-018 | BambooHR integration mode | PROVISIONAL | IT / BambooHR Administrator / HR Manager | Start with read-only employee lookup/snapshot and a controlled manual completion task. Add event-based webhooks only after the source field map, service identity, and reconciliation process are approved. |
| [ ] DEC-019 | BambooHR integration identity | PROVISIONAL | IT / BambooHR Administrator | Use a company-controlled dedicated integration identity or approved OAuth application, not a normal employee's personal API key. |
| [ ] DEC-020 | Email provider | OPEN | IT | Use an email-provider adapter. Microsoft Graph is the leading option because the source appendices show Outlook, but production choice and mailbox ownership remain open. |
| [ ] DEC-034 | Notification delivery evidence | PROVISIONAL | IT / HR Manager | Treat provider acceptance as SUBMITTED, not DELIVERED. Use bounce/delivery signals where available and allow manual confirmation for external providers. |

## Before Stage 6

| Confirm | Decision | Current status | Owner | Recommended decision |
| --- | --- | --- | --- | --- |
| [ ] DEC-024 | Small-cohort suppression threshold | OPEN | HR Manager / Privacy Officer | Do not display segmented exit-feedback results for cohorts below an approved minimum. Recommended starting threshold: five responses. |

## Before Stage 7

| Confirm | Decision | Current status | Owner | Recommended decision |
| --- | --- | --- | --- | --- |
| [ ] DEC-023 | Record retention | OPEN | Privacy Officer / HR Manager / Legal or policy owner | Make retention configurable by record class and support legal hold. HR/Privacy must approve actual durations before production. |
| [ ] DEC-028 | Support ownership | OPEN | Project Sponsor / IT / HR Manager | Assign a named product owner, technical owner, and support escalation path before pilot. Keep source, credentials, and runbooks in company-controlled systems. |
| [ ] DEC-029 | Availability and recovery objectives | OPEN | IT / HR Manager | Set production availability, RPO, and RTO after hosting is selected. The manual fallback process remains mandatory regardless of targets. |

## Before any AI feature

| Confirm | Decision | Current status | Owner | Recommended decision |
| --- | --- | --- | --- | --- |
| [ ] DEC-030 | AI processing of HR data | PROVISIONAL | Privacy Officer / IT / Project Sponsor | Do not send employee data to an external AI service until a privacy, security, contractual, and cross-border transfer assessment is approved. Use de-identified or synthetic data for development. |


## Stage 1 minimum approval meeting

Participants:

- Project Sponsor;
- HR Manager/process owner;
- Business Analyst/Product Owner;
- IT representative;
- Privacy/DPO representative where available.

Minimum agenda:

1. confirm MVP HR-led case intake;
2. confirm the three departure types and termination restriction;
3. confirm knowledge-transfer scope;
4. confirm baseline/pilot cohort approach;
5. confirm identity and hosting direction;
6. confirm BambooHR remains the source;
7. confirm Jamaica business calendar ownership;
8. assign product, technical and support owners;
9. confirm no real source documents/PII in the repository;
10. record decisions in `DecisionRegister.md`.

## Approval record template

| Field | Value |
| --- | --- |
| Meeting date | |
| Sponsor | |
| HR process owner | |
| Product owner | |
| IT representative | |
| Privacy representative | |
| Decisions approved | |
| Decisions deferred | |
| Conditions/actions | |
| Next review date | |

## Sponsor sign-off statement

> I confirm that the approved Decision Register and requirements baseline represent the intended scope for the next delivery stage. Items still marked OPEN are not authorized for implementation.
