# Roles and Permissions

## Principles

1. Permission is enforced server-side.
2. A role alone is insufficient for restricted records; case classification and explicit assignment also apply.
3. Departmental users receive task-specific views, not full HR cases.
4. System administration does not imply HR-data access.
5. Sensitive views, downloads and exports are audited.
6. No user may approve their own privileged access grant or self-escalate.
7. The survey respondent is not an internal role.

## Role definitions

| Role | Purpose | Record scope | Key permissions | Restrictions |
| --- | --- | --- | --- | --- |
| HR_MANAGER | Accountable process owner and approval authority. | All non-restricted HR cases; restricted cases only when explicitly assigned or within approved leadership scope. | Create, view, edit, approve, place on hold, reopen, waive, close, manage sensitive documents, view identifiable survey responses, run HR reports. | Cannot alter immutable audit events; cannot bypass mandatory controls without recorded override authority and reason. |
| HR_OFFICER | Executes day-to-day offboarding work. | Cases assigned to the officer or within permitted HR operational scope. | Create and update draft/active cases, prepare documents, initiate tasks, record assets, manage survey invitations, resolve routine exceptions. | Cannot approve own restricted communications, close cases requiring manager sign-off, change retention policy, or grant roles. |
| IT_RESPONDER | Performs access and technology-asset tasks. | Only assigned IT tasks and the minimum employee fields needed for execution. | View assigned task, system identifiers, effective revocation time, technology assets; complete/block/reassign within IT rules; upload evidence. | No access to resignation letters, reasons, pay details, identifiable survey responses, or unrelated cases. |
| FINANCE_RESPONDER | Performs final-pay and finance clearance tasks. | Only assigned Finance tasks and approved separation data. | View approved dates, pay-cycle references, authorized deduction/exception decisions, and task evidence; complete or block finance tasks. | No access to exit feedback, unrestricted HR notes, or technology/access details. |
| LINE_MANAGER | Completes handover, duty reassignment, and manager confirmations. | Direct reports or cases explicitly assigned to the manager. | View manager-facing case summary, handover plan, assigned assets where relevant, and assigned tasks; record handover evidence and blockers. | No access to confidential exit responses, HR-only reasons, rehire eligibility, pay details, or termination preparation unless explicitly authorized. |
| AUDITOR | Performs read-only assurance and control reviews. | Approved audit scope and date range. | Read case history, task evidence, approvals, notifications, configuration history, and audit events; export approved audit reports. | Identifiable exit free text and restricted termination content are masked unless separately authorized; no operational changes. |
| PRIVACY_OFFICER | Reviews data protection, access, retention, breach, and data-subject matters. | Privacy-relevant records and incidents. | Review classifications, retention, access logs, data-sharing records, privacy notices, deletion/legal hold, and breach-support records. | No routine operational edits except privacy workflows; cannot change HR decisions. |
| SYSTEM_ADMIN | Maintains technical configuration and platform availability. | Technical administration; business-record access is denied by default. | Manage deployments, integrations, health settings, feature flags, technical users, and configuration where assigned. | No default access to HR case content. Break-glass access requires explicit approval, time limitation, reason, and enhanced audit. |

## Capability matrix

Legend: `Full` means within approved record scope, not unrestricted database access.

| Capability | HR Manager | HR Officer | IT Responder | Finance Responder | Line Manager | Auditor | Privacy Officer | System Admin |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Case creation/edit | Full | Create/edit assigned | Task summary only | Task summary only | Assigned manager summary | Read approved scope | Privacy workflows | Technical only |
| Case approval/closure | Approve/close/reopen/void | Prepare only | No | No | No | Read | No | No |
| Termination preparation | Explicit assigned access | Only if explicitly assigned | Only released task | Only released task | Only if explicitly assigned | Masked unless approved | Privacy oversight | No content by default |
| Documents | Prepare/approve/issue | Prepare/submit | Only assigned evidence | Only assigned evidence | Handover evidence | Read approved scope | Privacy access review | Technical metadata only |
| Notifications | Approve/manual fallback/config as assigned | Prepare/manage routine | Receive/complete IT task | Receive/complete Finance task | Receive assigned manager task | Read evidence | Review disclosures | Provider health only |
| Assets | Approve exception/waiver | Manage checklist | Technology assets only | Finance exception only | Assigned items where relevant | Read approved scope | Review sensitive access | Technical metadata only |
| Handover | View/approve exception | Coordinate | No | No | Own plan | Read approved scope | No routine edit | No content by default |
| Exit responses | Identifiable access | Identifiable access if authorized | No | No | Aggregate only | Masked unless approved | Identifiable for privacy role | No content |
| Reports/exports | HR reports/controlled export | Operational reports | Own queue only | Own queue only | Own queue/aggregate | Audit reports | Privacy reports | Health only |
| Configuration | HR business config approval | Limited draft/config | No | No | No | No | Retention/privacy config | Technical config |
| Roles/access | No self-grant; approve HR assignment where defined | No | No | No | No | Read audit | Privacy review | Technical provisioning without business-content grant |

## Stage 2 implementation note (Directive 2, 2026-07-29)

The document/action-form/survey build maps this model as follows, without
changing any authority: HR_OFFICER drafts documents/templates and edits the
action form; HR_MANAGER activates templates, approves documents, and gives
final form approval (all as authenticated attestations, DEC-025 Option B
recommendation); FINANCE_RESPONDER and LINE_MANAGER receive **participant-
scoped action-form surfaces only** (finance checklist; manager minimum
review/approval view) when explicitly assigned - never case content;
identifiable survey responses are restricted to case HR plus read-only
PRIVACY_OFFICER oversight, with AUDITOR receiving metadata only.

## Record-level access rules

### Normal resignation cases

- HR Manager: permitted within HR scope.
- HR Officer: assigned/operational scope.
- IT/Finance/manager: assigned tasks and minimum fields.
- Auditor/privacy: approved review scope.
- system admin: technical metadata only.

### Restricted termination cases

- only explicitly assigned HR users and approved leadership participants can discover the case;
- IT/Finance/manager users see a task only after it is intentionally released to them;
- task views do not reveal preparation notes, exit reason, rehire status or unrelated participants;
- audit/privacy access follows approved review scope;
- system administrators require break-glass approval for content.

### Exit-feedback records

- identifiable response: HR Manager, specifically authorized HR Officer and Privacy Officer;
- manager: aggregates only;
- auditor: masked unless an approved audit scope requires identity;
- IT/System Admin: no content access.

## Segregation of duties

The product should support:

- HR Officer prepares; HR Manager approves sensitive document/notification.
- role grant requester is not the sole approver.
- template/workflow author is not the sole activator.
- break-glass user cannot approve their own access.
- audit events cannot be altered by operational roles.

## Access review

At least before pilot and periodically thereafter:

- confirm active users and roles;
- verify terminated/transferred users have no inappropriate access;
- review restricted-record access;
- review exports/downloads;
- review break-glass events;
- verify integration/service identities and owners.
