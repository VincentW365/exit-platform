# Screen Inventory

| ID | Screen | Primary users | Purpose | Critical UX/control notes |
| --- | --- | --- | --- | --- |
| UX-001 | Sign in / SSO handoff | All internal users | Authenticate through approved IdP | Environment banner only in non-production; accessible errors. |
| UX-002 | HR Dashboard | HR Manager/Officer | See next actions, cases, approvals, exceptions and KPIs | Role-filtered; counts/denominators; no broad termination leak. |
| UX-003 | Case List | HR authorized roles | Search/filter/sort authorized cases | Confidentiality badges; saved filters; controlled export. |
| UX-004 | Create Case — Employee | HR | Find employee or start approved manual fallback | Source/retrieved time; duplicate warning; minimum data. |
| UX-005 | Create Case — Departure Details | HR | Enter type, receipt, dates, owner, classification, cohort | Exact time; validation; terminations restricted. |
| UX-006 | Create Case — Review | HR | Review source, dates, scope and attachments before save/submit | Shows missing fields and no automatic effects. |
| UX-007 | Case Overview | HR/authorized participant | Understand status, next action, deadlines and exceptions | Role-specific; restricted banner; effective time prominent. |
| UX-008 | Case Workflow Timeline | HR | See tasks, dependencies, owners, states and history | Original/current due dates; waivers/blockers visible. |
| UX-009 | Task Detail | Assigned role | Complete/block/reassign task with evidence | Minimum case data; typed evidence; audit. |
| UX-010 | Department Queue | IT/Finance/Managers | Work assigned tasks efficiently | No unrelated HR data; urgency and due sorting. |
| UX-011 | Case Approval | HR Manager | Approve/return case and instantiate workflow | Source/date/classification review; attestation. |
| UX-012 | Document Workspace | HR | Generate, preview, approve, issue and supersede documents | Template/version/source fields; classification; no free-form issue. |
| UX-013 | Notification Workspace | HR | Review recipients/content/schedule and approve/send/fallback | Submitted vs delivered; attempts/failures. |
| UX-014 | Asset Checklist | HR/asset owners | Track issued items, return, disposition and evidence | Separate recovery/documentation; no pay action. |
| UX-015 | Handover Plan | Line manager/HR | Assign duties, owners, sessions and risks | No secrets; manager attestation. |
| UX-016 | Exit Feedback Administration | HR | Set eligibility/contact, schedule, suppress, see outcome | Identifiable data restricted. |
| UX-017 | Survey Respondent Page | Departing employee | Read notice and complete short survey | Opaque token; mobile; no internal data. |
| UX-018 | Survey Thank-you/Expired | Departing employee | Receive non-disclosing result | No employee/case details; support contact if approved. |
| UX-019 | Exception Feed | HR/role owner | Triage overdue, blocked, failed and control issues | Severity, owner, age, next action. |
| UX-020 | Clearance Review | HR Manager/Officer | Run closure integrity and resolve missing conditions | Deterministic checklist; completion approval. |
| UX-021 | Reports Home | HR/authorized leaders | Select operational/control reports | Cohort/date/filter context; privacy safeguards. |
| UX-022 | KPI Detail | HR/Process Analyst | Inspect numerator, denominator, cases and trends | Permission-aware drilldown; exclusions visible. |
| UX-023 | Aggregate Exit Report | HR/approved managers | View protected trends/themes | Small-cohort suppression; no identifiable drillthrough. |
| UX-024 | Audit History | HR Manager | Search case/object/access/change events | Read-only; safe metadata. |
| UX-025 | Sensitive Access Review | HR Manager | Review restricted views/downloads/exports/break glass | No unnecessary content in listing. |
| UX-026 | User/Role Administration | Authorized admin | Grant/revoke scoped roles | Maker-checker; no self-escalation. |
| UX-027 | Workflow Administration | HR/Product governance | Draft, validate, diff and activate workflow versions | Impact/effective date; used versions immutable. |
| UX-028 | Template Administration | HR governance | Manage document/notification/survey versions | Placeholder validation; preview; approval. |
| UX-029 | Business Calendar | HR admin | Manage Jamaica holidays and versions | Existing due dates do not silently change. |
| UX-030 | Recipient/Applicability Configuration | HR/Benefits/IT | Manage provider/internal recipients and rules | Minimum field set; effective dates; verification. |
| UX-031 | Integration Health | Technical admin/HR summary | See provider health, failures and reconciliation | Technical view has no content; HR view has business impact. |
| UX-032 | Outbox/Job Health | Technical admin | Inspect queue age, retries and dead letters | No email bodies/PII. |
| UX-033 | Feature Flags | Product/technical owner | Control staged capabilities by environment/cohort | Safe defaults; audit; production safeguards. |
| UX-034 | Retention/Legal Hold | Privacy role | Manage approved policies, dry runs and holds | Restricted; maker-checker; disposal evidence. |
| UX-035 | Manual Fallback Record | HR/assigned role | Record work completed outside platform | Reason, method, evidence, reconciliation. |
| UX-036 | Help/Runbooks | All roles | Find role-specific SOP and fallback guidance | No sensitive examples. |

## Screen acceptance pattern

Every operational screen must define:

- allowed roles and record scope;
- primary task/decision;
- required data and validation;
- empty/loading/error states;
- audit events;
- keyboard/focus/error behaviour;
- responsive behaviour;
- restricted-field handling;
- test IDs only where they support stable testing rather than expose internals.
