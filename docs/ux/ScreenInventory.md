# Screen Inventory

| ID | Screen | Primary users | Purpose | Critical UX/control notes |
| --- | --- | --- | --- | --- |
| UX-001 | Sign in / SSO handoff | All internal users | Authenticate through approved IdP | Environment banner only in non-production; accessible errors. |
| UX-002 | Exit Center (HR dashboard) | HR Manager/Officer | See next actions, cases, approvals, exceptions and KPIs | Role-filtered; counts/denominators; no broad termination leak. Presentation pass 2026-09-23 (DEC-070): identity and primary action in one head; pipeline then five queue figures (zero reads calm); My Work (officer: assigned cases with next action; manager: cases awaiting approval first) before Requires your attention; business labels only, dates as `d LLL yyyy`, helper text only where it prevents a misreading. |
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
| UX-037 | Create Case — Benefits & Providers / HR Ownership | HR | Select the benefit providers to be told, and (HR Manager) name the executing officer, before the case is created | Selectable cards, not dropdowns; unticked = not applicable; the officer owns what they create (DEC-065/066). |
| UX-038 | Case Approval Summary | HR Manager (officers read it) | Approve the case once, or return it with a reason, after seeing the employee record, exit details, ownership, benefits, every recipient with its resolved destination and readiness, the planned documents and forms and the workflow | Two-column cards; addresses full for the HR Manager and masked for others; "Recipient not configured" is explicit; approval text states what it authorizes (DEC-066). |
| UX-039 | My Settings | All roles | Upload or remove the personal email signature banner (a supplied JPG) | Own account only; audited; the stored image previewed at its own size; applied only to emails written as coming from that person (DEC-067). |
| UX-040 | Administration — Email banner | HR Manager | Upload the department banner JPG, set alt text, enable/disable, optional hosted HTTPS URL | Configurable asset reference (DEC-067); never altered; audited; preview of the stored image. |
| UX-041 | Captured Email (development mailbox) | HR roles, non-production | Verify the complete email presentation: subject, recipient class, HTML part with links and the banner image, plain-text part | Banner named (kind, size, alt) or "No email banner"; the image scales to the reader's width without clipping. |

| UX-042 | Employee Action Form — Signatures | HR Manager anywhere; assigned HR Officer on owned cases; other HR Officers read only | Create a signature request, Copy Signing Link, Send by Email, Resend Email, Extend Link, Revoke Link; sign the Human Resources block in the application | One request per signer per form version, so copy and email address the same link; status card names signer, document, status, masked destination, created, expires and last emailed; business wording only, no token or expiry jargon; signing is not approval (DEC-068). |
| UX-043 | Review and Sign (public, no sign-in) | The named signer, by secure link | Read the employee, separation and status details, confirm the review, draw initials once and apply them to each section, sign, tick the declaration and submit | Mobile-first single column; company logo; pointer input for finger, stylus, trackpad and mouse; typed fallback shown as typed; shows nothing of the wider case; completed, expired and revoked links each say so in the owner's wording (DEC-068). |
| UX-044 | Document workspace (letters) | HR Manager; assigned HR Officer on owned cases; others read only | Edit the generated wording with case facts locked, preview, download the draft or final PDF, see the version history | Toolbar and editor on the Documents tab; plain-text editor with paragraphs, line breaks, undo/redo; facts as locked chips; every save is a version (DEC-069). |
| UX-045 | Form workspace (Employee Action Form) | As above | Status in the owner's words (Draft / Ready / Awaiting signature / Signed / Final), Download PDF at every stage, version history, Start new version when a signed or completed version must change | Lock banner when the officer's signature is on the version (DEC-069). |
| UX-046 | Communication workspace (Email Actions) | As above | See To with the auto-assigned recipient and its source, Change recipient (searchable picker or manual), Change email (this message only / update stored, where authorized), Restore auto-assigned recipient, Edit email, Preview, Download preview or record PDF, Send, Prepare corrected copy | Override shown as "Recipient overridden - Auto-assigned: ..."; unresolved recipient shown before sending; sent records read-only (DEC-069). |
| UX-047 | Receipt workspace (Exit Checklist for Return Items) | As above | Edit rows and notes, add rows, download the draft or final PDF, mark reviewed, collect signatures, finalize, start a new version | The company's ten rows never removed; version history; signatures panel shared with the form (DEC-069). |
| UX-048 | Administration — System Administration | HR Manager | Connect BambooHR in the app (company name + API key, DEC-072), see the directory's health and refresh it, manage the email banner, user access, the latest unexpected errors with their references, the database schema and worker state (DEC-073) and (folded away) the technical settings | Presentation pass 2026-10-27 to the DEC-070 standard: page head with secondary links, one panel per area with icon, chip and short description, compact tiles for the directory, buttons in one row (primary Refresh Directory Now), key/value form collapsed as "Advanced settings (for technical support)". The Administration Center hub got the same head, section icons, plain badges (On/Off, Awaiting approval) and "Reason (recorded)" labels. |

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
