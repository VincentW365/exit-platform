# Roles and Permissions

## Principles

1. Permission is enforced server-side.
2. A role alone is insufficient for restricted records; case classification and explicit assignment also apply.
3. Only two kinds of user exist: the HR Manager and the HR Officer (DEC-063). Everyone else the platform knows about - employees, reporting managers, IT, Finance, providers - is a directory record, a workflow participant, a notification recipient or a token-link holder, never an application login.
4. Platform administration is an HR Manager responsibility; it never widens the HR Manager's record scope, and technical functions that are not HR operations (backups, restore tests) live outside the application.
5. Sensitive views, downloads and exports are audited.
6. No user may approve their own privileged access grant or self-escalate.
7. The survey respondent is not an internal role.

## The two-role model (DEC-063, 2026-09-22)

Supersedes the six-role model of DEC-042 and completes the retirements of
DEC-045 (IT/Finance) and the owner decision of 2026-08-19 (line manager).

| Role | Purpose | Record scope | Key permissions | Restrictions |
| --- | --- | --- | --- | --- |
| HR_MANAGER | Accountable process owner, approval authority and platform administrator. | All non-restricted HR cases; restricted cases only when explicitly assigned. | Everything the HR Officer holds, plus: approve, return, cancel, void, correct, place on hold, reopen, waive, assign officers and participants, activate templates / workflow definitions / notification templates, schedule reports, the Audit Centre and audited export, calendar and configuration lists, reason taxonomy, privacy and retention operations, business continuity, support management, and the HR-operational administration listed below. | Cannot alter immutable audit events; cannot grant a role to themself; cannot bypass mandatory controls without recorded override authority and reason; restricted cases require participation even for the HR Manager. |
| HR_OFFICER | Executes day-to-day offboarding work. | Cases assigned to the officer or within permitted HR operational scope. | Create and update draft/active cases, prepare documents, complete ordinary action forms, work tasks, record assets and the return-items checklist, manage survey invitations, resolve routine exceptions, enter a recipient for one case, view the recipient directory, run operational reports and exports, use support and SOPs. | Operational only: no approval-level case actions, no activation of versioned content, no Audit Centre, no administration area, no role or recipient configuration. |

### HR-operational administration held by the HR Manager

Transferred from the former System Administrator because each one is an HR
operation with a technical shape, not a technical operation:

- `admin.system` - system configuration REFERENCES (never secret values), identity lifecycle (accounts mapped from the directory, enable/disable with session revocation, access-review snapshots) and the employee directory (Refresh Directory Now, synchronize, test connection, reconciliation, purge of the live cache).
- `sync.run`, `directory.viewSync` - manual synchronization and the synchronization log.
- `admin.roles`, `identity.admin`, `identity.accessReview` - role administration (no self-grant, every change audited).
- `admin.flags`, `admin.organization` - automation feature flags and organization mapping.
- `recipients.editBusiness`, `recipients.editTechnical`, `recipients.approveExternal`, `notifications.routing`, `notifications.testMode` - recipient configuration, routing and rehearsal mode.
- `outbox.view`, `outbox.resolve` - outbox oversight and resolution.
- `health.view` - integration and operational health.
- `pilot.view`, `pilot.manage`, `pilot.hrApprove` - pilot readiness, proposal, ONE approval, apply and suspend.

### Retired roles (deprecated-in-place)

`SYSTEM_ADMIN`, `IT_RESPONDER`, `FINANCE_RESPONDER`, `LINE_MANAGER`,
`AUDITOR` and `PRIVACY_OFFICER` remain values of the database `Role` enum so
that historical role assignments, task attributions on superseded workflow
versions and append-only evidence stay intact and readable. Nothing grants,
selects or honours them:

- `isRole()` in `@exit/domain` is the single gate; the active union is exactly `HR_MANAGER | HR_OFFICER`.
- Session hydration drops stored retired assignments, so a legacy account with only retired roles holds no active role and is refused everywhere.
- Role grants, directory account mapping and workflow-definition validation refuse retired values.
- Seeded accounts are exactly `HR Manager` and `HR Officer`; the System Administrator and named UAT persona logins are deactivated with reason, never converted.

### Technical functions outside the application

- **Backups and restore tests** are infrastructure operations (see `docs/operations/BackupRestoreRunbook.md`). The in-app tooling is removed; the readiness gates read the HR Manager's attestation (`readiness.backupVerified`, `readiness.restoreTested`).
- **The technical audit feed** is retired: technical events (identity, configuration, system) sit in the single HR Manager feed.
- **Integration configuration** has no application surface; integration health remains an HR Manager view.

### People who are not logins

- **Reporting managers** are resolved from directory data only (`managerName`, `managerSourceId`); `managerUserId` is never linked to an account. They are reached by controlled email and secure links.
- **IT and Finance** act on controlled emails with secure acknowledgement links, or HR records the evidence.
- **Case participants** are HR users only; `FINANCE` and `MANAGER` participant roles are refused.
- **Task definitions** carrying a retired `requiredRole` or `waiverAuthority` exist only on superseded workflow versions and are historical; new definitions must name `HR_MANAGER` or `HR_OFFICER`, and residual departmental tasks on legacy instances can be held only by HR.

## Case ownership: Cases versus My Work (DEC-065)

Every case carries two distinct facts:

- **Created By** (`createdById`) - immutable audit information: who originally
  created the case. It never determines authorization.
- **Assigned HR Officer** (`assignedOfficerId`) - mutable operational
  ownership: who is responsible for the case now. It decides My Work
  membership and an HR Officer's edit authority.

Rules:

- An HR Officer who creates a case is assigned to it automatically; a case
  the HR Manager creates starts **Unassigned** until the manager assigns an
  officer on the Assignment tab.
- **Cases** is the organisation's register: both roles see and search every
  case they may view (restricted cases stay participant-only).
- **My Work** lists the cases currently assigned to the signed-in person
  (drafts included), above the task queue.
- Edit authority is one server-side policy, `canEditCase(actor, case)`:
  HR Manager → every case they can view; HR Officer → only the case assigned
  to them; otherwise read-only. Workflow-state rules (draft-only edits,
  closed cases, restricted participation) apply on top for everyone.
- Only the HR Manager assigns or reassigns the officer; every assignment,
  automatic or manual, is audited with the previous officer, the new
  officer, the actor and the instant. The creator and task history are never
  rewritten.

| Case capability | HR Manager | HR Officer |
| --- | --- | --- |
| View all cases | Yes | Yes |
| Search all cases | Yes | Yes |
| Create case | Yes | Yes (assigned to self automatically) |
| Edit case assigned to self | Yes | Yes |
| Edit case assigned to another officer | Yes | No (view only) |
| Edit unassigned case | Yes | No (view only) |
| Assign HR Officer | Yes | No |
| Reassign HR Officer | Yes | No |
| View ownership history | Yes | Yes, where case audit visibility permits |
| View other officer's case | Yes | Yes |
| Add case to My Work | Via assignment | Automatic through assignment |
| Remove case from officer My Work | Via reassignment or case state | No |

## Single authorization gate (DEC-066, 2026-09-22)

The HR Manager approves the offboarding case **once**, on the Case Approval
Summary (`/cases/{id}/approve`), which shows what the approval authorizes:
the employee record, the exit details, who will execute the case, the
benefits and providers selected at intake, who will be contacted (with the
resolved destination and a readiness state), the documents and forms the
case will produce, and the workflow that follows. That approval authorizes
the assigned HR Officer to execute the downstream workflow without coming
back for approval of routine documents, forms or communications.

| Action | Before DEC-066 | Since DEC-066 |
| --- | --- | --- |
| Finalize a document (`doc.finalize`) | officer submits, HR Manager approves (`doc.approve`) | assigned officer or HR Manager, on an approved case |
| Issue a document (`doc.markIssued`, email or manual) | HR Manager | assigned officer or HR Manager, on an approved case |
| Supersede / void a document | HR Manager | assigned officer or HR Manager |
| Release an external, employee-facing or restricted notification | HR Manager (`notification.approveExternal`) | assigned officer or HR Manager (`notification.approveInternal`) |
| Amend benefits and providers | any HR on the case, any time | officer while drafting; HR Manager only after submission (audited) |
| Workflow task "Authorized HR Manager approval" | termination and redundancy workflows | removed (definition v4) |

Retained as distinct controls: the case approval itself; the final
clearance decision; the optional configuration-gated Action Form HR review
and form voiding; recipient-directory approval and verification; waivers,
overrides, holds, reopening and security exceptions; template and workflow
activation; employee and external acknowledgements. Ownership (DEC-065)
still decides *who* executes: another HR Officer reads the case only.

## Capability matrix

Legend: `Full` means within approved record scope, not unrestricted database access.

| Capability | HR Manager | HR Officer | Everyone else (no login) |
| --- | --- | --- | --- |
| Case creation/edit | Full | Create/edit assigned | None |
| Case approval/closure | Approve once on the Case Approval Summary, return to draft, close/reopen/void | Prepare and submit | None |
| Termination preparation | Explicit assigned access | Only if explicitly assigned | None |
| Documents | Finalize/issue/supersede/void on any case (intervention); no per-document approval | Finalize, issue, supersede and void on the assigned case under the case approval; complete ordinary forms | Recipient of issued documents only |
| Notifications | Release on any case, configure recipients and routing, oversee the outbox | Prepare, release every waiting notification on the assigned case (internal, external, employee-facing, restricted), enter a recipient for one case | Receive; acknowledge through secure links |
| Benefits and providers | Select at intake; amend after submission (audited) | Select at intake; correct while the case is a draft | None |
| Assets and return items | Approve exception/waiver | Manage checklist | Confirm through secure link |
| Exit responses | Identifiable access | Identifiable access if authorized | Respond through the survey link only |
| Reports/exports | HR reports, controlled export, scheduling | Operational reports and exports | None |
| Audit Centre | Full (restricted rows minimized unless participating) | None | None |
| Configuration | HR business configuration and platform administration, including the department email banner (DEC-067) | None | None |
| Personal email banner | Own account only | Own account only | None |
| Roles/access | Grant/revoke (no self-grant), directory account mapping, access reviews | None | None |
| Pilot | Propose, approve (one approval), apply, suspend | None | None |
| Backups / restore tests | Attest the runbook evidence | None | Performed by the infrastructure operator outside the application |

## Record-level access rules

### Normal resignation cases

- HR Manager: permitted within HR scope.
- HR Officer: assigned/operational scope.
- Nobody else holds a login; managers, IT and Finance receive controlled email.

### Restricted termination cases

- only explicitly assigned HR users can discover the case - the HR Manager included;
- notifications to IT, Finance and the manager are released intentionally and carry minimum data;
- no view reveals preparation notes, exit reason, rehire status or unrelated participants;
- administration surfaces carry configuration, counts and identifiers only, never case content.

### Exit-feedback records

- identifiable response: HR Manager and specifically authorized HR Officer (DEC-042);
- nobody else has content access.

## Segregation of duties

The product should support:

- HR Officer prepares and submits the case; HR Manager approves it once, on a summary of everything the approval authorizes (DEC-066). After that, the assigned officer executes and the manager intervenes; there is no per-document or per-notification second approver.
- role grant requester is not the sole approver; nobody grants a role to themself.
- template/workflow author is not the sole activator.
- break-glass user cannot approve their own access.
- audit events cannot be altered by operational roles.

## Access review

At least before pilot and periodically thereafter:

- confirm active users and roles - exactly the two active roles;
- verify terminated/transferred users have no inappropriate access;
- review restricted-record access;
- review exports/downloads;
- review break-glass events;
- verify integration/service identities and owners.

## Historical implementation notes

The notes below record how earlier directives mapped the model at the time.
Where they name a retired role or a capability the HR Manager now holds,
DEC-063 governs; they are kept so the history of each decision stays
readable.

### Directive 6.1 implementation note (2026-08-11)

- **Case ownership (E):** every case distinguishes the accountable owner
  (HR Manager) from the operational owner (`assignedOfficerId`); the HR
  Manager assigns/reassigns manually with reason and full audit. Activation
  requires the assignment plan: officer + resolved manager (or audited
  override) + six recorded confirmations.
- **Manager routing (F):** the reporting manager derives from the
  directory's employee→manager relationship. (Since DEC-063 the manager is
  never an application account; the notice goes by controlled email.)
- **Department queues (G/H/I):** introduced department queues for IT and
  Finance responders; retired by DEC-045 (Directive 6.3) and DEC-063 - HR
  holds residual legacy department work.
- **Audit Centre (K):** `audit.viewGlobal` includes HR_MANAGER with
  service-level minimization of restricted-case rows; `audit.export`
  (HR_MANAGER) is itself audited. The `audit.viewTechnical` feed introduced
  here for SYSTEM_ADMIN is retired (DEC-063). `org.view` / `admin.organization`
  gate the organization health surfaces.

### Six-role model (DEC-042, 2026-08-12, superseded by DEC-063)

The owner removed AUDITOR and PRIVACY_OFFICER from the active model.
HR_MANAGER absorbed privacy/retention operations, survey-response oversight
and audit export. Restricted cases became participant-only for content AND
discovery, and full restricted-case audit review requires participation
(minimized rows otherwise, DEC-039) - both still in force. The two-person
pilot approval (HR Manager + System Administrator) introduced here is retired
by DEC-063.

### Directive 6.3 implementation note (2026-08-16, HR-validated workflow)

Product direction from HR operational feedback (DEC-044..DEC-050); not
formal policy/legal approval.

- **IT_RESPONDER / FINANCE_RESPONDER retired as login roles.** New cases
  create no IT/Finance queue tasks; the departments receive controlled,
  versioned emails and confirm through secure no-login links (or HR records
  the evidence). Residual IT/FINANCE tasks on legacy (v1) instances are
  worked by HR (`queueDepartmentsForActor` grants HR the IT/FINANCE queues).
- **Officer completion authority.** The assigned HR Officer prepares,
  reviews, returns-for-correction and COMPLETES ordinary Action Forms
  (`form.complete` is HR-on-case work). The optional HR-Manager review step
  (`form.hrReview`) and form voiding stay management-grade and are gated by
  configuration `actionForm.requireHrReview` (off by default). Manager
  approval of the form no longer exists (DEC-044).
- **Case-scoped permissions** (enforced server-side like all others):
  `form.complete`, `form.hrReview`, `benefits.confirm`,
  `derivedAction.override`, `notification.recordEvidence`,
  `notification.enterRecipient` - all HR-on-case except `form.hrReview`
  (HR Manager). Overrides of derived actions require a recorded reason and
  are audited.
- **Global permissions**: `notifTemplate.view` / `notifTemplate.draft`
  (HR Manager + HR Officer) and `notifTemplate.activate` (HR Manager only -
  activation of outgoing-communication content stays management-grade).
- **Recipient entry split**: entering a recipient for one case is
  officer-grade (`notification.enterRecipient`); saving a recipient for
  future cases requires `recipients.editBusiness` plus the external-approval
  lifecycle (`recipients.approveExternal`, HR Manager).

### HR samples implementation note (2026-08-20)

- **Exit checklist for return items (DEC-053)** reuses the asset permissions:
  `asset.view` to see it on the case, `asset.manage` to record or correct it.
  The recipient needs no permission at all - the secure single-use link is the
  authorization, under the DEC-048 token discipline.
- **Issuing the acceptance letter by email (DEC-054)** is `doc.markIssued`.
  Since DEC-066 this is edit authority on the case: the assigned HR Officer
  (or the HR Manager intervening) finalizes the letter (`doc.finalize`) and
  issues it under the HR Manager approval of the case. The per-document
  maker-checker this note originally described is retired. Typing the
  address from the resignation scan remains officer work (`doc.edit`).
- **`notifications.routing`** edits the routing table (DEC-056) and
  **`notifications.testMode`** turns rehearsal mode on and off (DEC-055).
  Both were held by the HR Manager and the System Administrator; since
  DEC-063 the HR Manager holds them alone. Reading the email log and the
  current rehearsal setting rides on `outbox.view`.

### Stage 2 implementation note (Directive 2, 2026-07-29)

HR_OFFICER drafts documents/templates and edits the action form; HR_MANAGER
activates templates and approves documents (authenticated attestations,
DEC-025 Option B). The participant-scoped Finance and manager form surfaces
introduced here were retired by Directive 6.3 and DEC-063; identifiable
survey responses are restricted to case HR (DEC-042).

### Stage 3 implementation note (Directive 3, 2026-07-29)

HR_OFFICER drafts workflow definitions and performs HR case work
(activation, task work, notification preparation, asset management,
exception resolution); HR_MANAGER activates/retires workflow versions and
holds every override authority (holds, reopening, waivers, reassignment,
corrections, external and employee-facing notification approval, asset
waive/write-off, handover waiver, security exceptions, final clearance).
Restricted termination cases require explicit HR participation everywhere
(queues, tasks, assets, handover, notifications, exceptions, clearance) and
never leak through totals, feeds or errors. The department and manager task
surfaces described by the original note are historical.

### Stage 4 implementation note (Directive 4, 2026-07-30)

The production-readiness build added ~30 global actions to the enforced
server-side matrix. The business/technical split it introduced (HR versus
SYSTEM_ADMIN) is superseded by DEC-063; what remains in force:

- **Reports** (`reports.view`, audited exports): HR_MANAGER, HR_OFFICER -
  all output passes visibility filters and small-group suppression.
- **Privacy operations** (`privacy.operate`: retention, holds, dry runs,
  anonymization, DSR, disclosures): HR_MANAGER (DEC-042); no other role.
- **Continuity** (`continuity.operate`), support tickets, SOP/training
  surfaces follow the operational roles; the development capture mailbox
  (`mailbox.dev`) is HR-only and refuses production.
- **Identity lifecycle**: roles are NEVER granted from identity-provider
  claims; expiring role assignments are revoked by the worker; disabling a
  user revokes sessions immediately; break-glass stays disabled unless
  explicitly configured and is enhanced-audited.
