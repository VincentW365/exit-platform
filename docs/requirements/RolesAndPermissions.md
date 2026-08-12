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
| HR_MANAGER | Accountable process owner and approval authority. | All non-restricted HR cases; restricted cases only when explicitly assigned or within approved leadership scope. | Create, view, edit, approve, place on hold, reopen, waive, close, manage sensitive documents, view identifiable survey responses, run HR reports, operate privacy/retention workflows and the Audit Centre (DEC-042). | Cannot alter immutable audit events; cannot bypass mandatory controls without recorded override authority and reason. |
| HR_OFFICER | Executes day-to-day offboarding work. | Cases assigned to the officer or within permitted HR operational scope. | Create and update draft/active cases, prepare documents, initiate tasks, record assets, manage survey invitations, resolve routine exceptions. | Cannot approve own restricted communications, close cases requiring manager sign-off, change retention policy, or grant roles. |
| IT_RESPONDER | Performs access and technology-asset tasks. | Only assigned IT tasks and the minimum employee fields needed for execution. | View assigned task, system identifiers, effective revocation time, technology assets; complete/block/reassign within IT rules; upload evidence. | No access to resignation letters, reasons, pay details, identifiable survey responses, or unrelated cases. |
| FINANCE_RESPONDER | Performs final-pay and finance clearance tasks. | Only assigned Finance tasks and approved separation data. | View approved dates, pay-cycle references, authorized deduction/exception decisions, and task evidence; complete or block finance tasks. | No access to exit feedback, unrestricted HR notes, or technology/access details. |
| LINE_MANAGER | Completes handover, duty reassignment, and manager confirmations. | Direct reports or cases explicitly assigned to the manager. | View manager-facing case summary, handover plan, assigned assets where relevant, and assigned tasks; record handover evidence and blockers. | No access to confidential exit responses, HR-only reasons, rehire eligibility, pay details, or termination preparation unless explicitly authorized. |
| SYSTEM_ADMIN | Maintains technical configuration and platform availability. | Technical administration; business-record access is denied by default. | Manage deployments, integrations, health settings, feature flags, technical users, and configuration where assigned. | No default access to HR case content. Break-glass access requires explicit approval, time limitation, reason, and enhanced audit. |

### Directive 6.1 implementation note (2026-08-11)

- **Case ownership (E):** every case distinguishes the accountable owner
  (HR Manager) from the operational owner (`assignedOfficerId`); the HR
  Manager assigns/reassigns manually with reason and full audit. Activation
  requires the assignment plan: officer + resolved manager (or audited
  override) + six recorded confirmations.
- **Manager routing (F):** LINE_MANAGER behaviour derives from the
  directory's employee→manager relationship; access remains assignment-
  scoped (the routed manager sees exactly the routed case's work).
- **Department queues (G/H/I):** IT/Finance tasks start unassigned in their
  queues; department responders may claim, return to queue, and assign
  unassigned work within their department; reassignment of held work stays
  HR-Manager authority. No assignment operation moves a due date.
- **Audit Centre (K):** `audit.viewGlobal` now includes HR_MANAGER with
  service-level minimization of restricted-case rows; new
  `audit.viewTechnical` gives SYSTEM_ADMIN technical categories only with no
  case linkage; `audit.export` (HR_MANAGER) is itself audited. New `org.view` / `admin.organization` gate the
  organization health surfaces.

### Six-role model (DEC-042, 2026-08-12, supersedes DEC-037)

The owner removed AUDITOR and PRIVACY_OFFICER from the active model.
HR_MANAGER absorbs privacy/retention operations, survey-response oversight
and audit export; SYSTEM_ADMIN keeps technical administration and never
gains case content. Accepted consequences, recorded in DEC-042: restricted
cases are participant-only for content AND discovery; full restricted-case
audit review requires participation (minimized rows otherwise, DEC-039);
the pilot privacy approval tier is retired - activation requires HR Manager
and System Administrator approval by two DIFFERENT people (code-enforced).
Database enum values remain deprecated-in-place so historical records are
untouched. Real staff are mapped to these six roles for live-data UAT via
the Organization screen (Directive 6.2 E).

## Capability matrix

Legend: `Full` means within approved record scope, not unrestricted database access.

| Capability | HR Manager | HR Officer | IT Responder | Finance Responder | Line Manager | System Admin |
| --- | --- | --- | --- | --- | --- | --- |
| Case creation/edit | Full | Create/edit assigned | Task summary only | Task summary only | Assigned manager summary | Technical only |
| Case approval/closure | Approve/close/reopen/void | Prepare only | No | No | No | No |
| Termination preparation | Explicit assigned access | Only if explicitly assigned | Only released task | Only released task | Only if explicitly assigned | No content by default |
| Documents | Prepare/approve/issue | Prepare/submit | Only assigned evidence | Only assigned evidence | Handover evidence | Technical metadata only |
| Notifications | Approve/manual fallback/config as assigned | Prepare/manage routine | Receive/complete IT task | Receive/complete Finance task | Receive assigned manager task | Provider health only |
| Assets | Approve exception/waiver | Manage checklist | Technology assets only | Finance exception only | Assigned items where relevant | Technical metadata only |
| Handover | View/approve exception | Coordinate | No | No | Own plan | No content by default |
| Exit responses | Identifiable access | Identifiable access if authorized | No | No | Aggregate only | No content |
| Reports/exports | HR reports/controlled export | Operational reports | Own queue only | Own queue only | Own queue/aggregate | Health only |
| Configuration | HR business config approval (incl. retention/privacy, DEC-042) | Limited draft/config | No | No | No | Technical config |
| Roles/access | No self-grant; approve HR assignment where defined | No | No | No | No | Technical provisioning without business-content grant |

## Stage 2 implementation note (Directive 2, 2026-07-29)

The document/action-form/survey build maps this model as follows, without
changing any authority: HR_OFFICER drafts documents/templates and edits the
action form; HR_MANAGER activates templates, approves documents, and gives
final form approval (all as authenticated attestations, DEC-025 Option B
recommendation); FINANCE_RESPONDER and LINE_MANAGER receive **participant-
scoped action-form surfaces only** (finance checklist; manager minimum
review/approval view) when explicitly assigned - never case content;
identifiable survey responses are restricted to case HR (DEC-042).

## Stage 3 implementation note (Directive 3, 2026-07-29)

The workflow build maps this model without changing any authority:
HR_OFFICER drafts workflow definitions and performs HR case work (activation,
task work, notification preparation, asset management, exception resolution);
HR_MANAGER activates/retires workflow versions and holds every override
authority (holds, reopening, waivers, reassignment, corrections, external and
employee-facing notification approval, asset waive/write-off, handover
waiver, security exceptions, final clearance). IT_RESPONDER and
FINANCE_RESPONDER work **released tasks of their department only**, on a
minimum-data task surface that grants no case access and never discloses the
departure type; LINE_MANAGER works only tasks expressly assigned to them and
owns the handover content. Restricted termination cases require explicit HR
participation everywhere (queues, tasks, assets, handover, notifications,
exceptions, clearance) and never leak through totals, feeds or errors.
SYSTEM_ADMIN has no queue and no workflow surface.

## Stage 4 implementation note (Directive 4, 2026-07-30)

The production-readiness build adds ~30 global actions to the enforced
server-side matrix without changing any authority above:

- **Business vs technical administration is a hard split.** HR_MANAGER /
  HR_OFFICER hold business configuration (recipient directory business
  fields, reason taxonomy, calendar approval); SYSTEM_ADMIN holds technical
  configuration (`admin.system`, system config references, user lifecycle,
  access reviews, fixture sync, backup/restore, technical recipient fields)
  and still has **zero access to HR case content** - verified by tests.
- **Outbox**: monitor view is HR_MANAGER + SYSTEM_ADMIN; retry/resolve of
  failures is SYSTEM_ADMIN; every action is audited with masked destinations.
- **Pilot**: propose/apply/suspend is HR_MANAGER + SYSTEM_ADMIN
  (`pilot.manage`); the three approvals are role-exclusive
  (`pilot.hrApprove` HR_MANAGER, `pilot.adminApprove` SYSTEM_ADMIN, by two
  different people - DEC-042) so no single person can activate.
- **Reports** (`reports.view`, audited exports): HR_MANAGER, HR_OFFICER -
  all output passes visibility filters and
  small-group suppression; department roles keep queue-only visibility.
- **Privacy operations** (`privacy.operate`: retention, holds, dry runs,
  anonymization, DSR, disclosures): HR_MANAGER (DEC-042); no other role.
- **Backup** (`backup.operate`) and health administration: SYSTEM_ADMIN;
  read-only health for authorized viewers.
- **Continuity** (`continuity.operate`), support tickets, SOP/training
  surfaces follow the operational roles; the development capture mailbox
  (`mailbox.dev`) is HR + SYSTEM_ADMIN and refuses production.
- **Identity lifecycle**: roles are NEVER granted from identity-provider
  claims; expiring role assignments are revoked by the worker; disabling a
  user revokes sessions immediately; break-glass stays disabled unless
  explicitly configured and is enhanced-audited.

## Record-level access rules

### Normal resignation cases

- HR Manager: permitted within HR scope.
- HR Officer: assigned/operational scope.
- IT/Finance/manager: assigned tasks and minimum fields.
- system admin: technical metadata only.

### Restricted termination cases

- only explicitly assigned HR users and approved leadership participants can discover the case;
- IT/Finance/manager users see a task only after it is intentionally released to them;
- task views do not reveal preparation notes, exit reason, rehire status or unrelated participants;
- system administrators require break-glass approval for content.

### Exit-feedback records

- identifiable response: HR Manager and specifically authorized HR Officer (DEC-042);
- manager: aggregates only;
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
