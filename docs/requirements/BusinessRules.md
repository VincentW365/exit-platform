# Business Rules

## Purpose

These rules convert the DMAIC and Decision Register into deterministic behaviour. Requirements describe what the product must provide; business rules describe constraints that must remain true.

## Rule catalogue

| Rule ID | Area | Rule |
| --- | --- | --- |
| BR-GOV-001 | Authority | An approved Decision Register entry overrides conflicting wording in the source DMAIC. |
| BR-GOV-002 | Authority | Claude shall not implement an OPEN decision as though it were approved. |
| BR-GOV-003 | Change control | Any change to scope, workflow authority, privacy model, KPI formula or architecture requires a change request and traceability update. |
| BR-GOV-004 | Data | Real employee data shall not be used in development, tests, screenshots or demos. |
| BR-GOV-005 | AI | AI output shall never be treated as an approved HR decision, legal interpretation or final communication without human approval. |
| BR-CASE-001 | Creation | Only an authorized HR role may create an MVP offboarding case. |
| BR-CASE-002 | Creation | A case remains DRAFT until required receipt, employee, departure, date, owner and classification fields are valid. |
| BR-CASE-003 | Approval | Only an authorized HR approval action creates the employee snapshot and workflow instance. |
| BR-CASE-004 | Departure type | A case shall have exactly one active departure type. |
| BR-CASE-005 | Dates | Receipt date/time, proposed last day, confirmed last day and effective separation time are distinct concepts. |
| BR-CASE-006 | Dates | Security-critical deadlines use the exact effective separation time, not the end of the calendar day. |
| BR-CASE-007 | Dates | A changed effective date/time requires reason, impact preview, confirmation and an audit event. |
| BR-CASE-008 | History | Prior values and schedules shall remain in history after a correction. |
| BR-CASE-009 | Deletion | Operational users cannot hard-delete cases. |
| BR-CASE-010 | Void | A void requires HR Manager authority and cancels future work without deleting history. |
| BR-CASE-011 | Reopen | A completed case may be reopened only by authorized HR with reason. |
| BR-CASE-012 | Confidentiality | Termination cases default to RESTRICTED and are excluded from unauthorized lists. |
| BR-CASE-013 | Cohort and purpose | BASELINE, PILOT and POST_ROLLOUT measurement cohorts shall not be mixed by default in improvement reporting. Measurement cohort and record purpose are separate dimensions: TRAINING and TEST are record purposes, never business cohorts. Reporting defaults to `record_purpose = OPERATIONAL`, and TRAINING/TEST records are excluded from all business reporting. An OPERATIONAL record requires a measurement cohort; a TRAINING or TEST record must have none, must be synthetic, and must never reach a live integration. |
| BR-CASE-014 | Cohort and purpose | A completed case measurement cohort cannot change without an audited correction by authorized governance. Record purpose is set at creation and may change only by authorized, reasoned, audited correction before operational use; an OPERATIONAL record shall never be silently converted to TRAINING or TEST, nor the reverse. |
| BR-CASE-015 | Duplicates | The system warns on overlapping non-voided cases for the same employee; proceeding requires a reason. |
| BR-WF-001 | Versioning | A workflow definition used by a case is immutable for that case. |
| BR-WF-002 | Instantiation | Workflow instantiation is exactly-once and idempotent. |
| BR-WF-003 | Separation | Every separation type has its own workflow definition; none inherits another's. (DEC-058 extends this from three types to seven.) |
| BR-CASE-013 | Separation model | What a separation type implies - notice, required dates, defaults, urgency, classification, survey eligibility and wording - is defined once in the separation profile and read by every surface. Frontend presentation, backend validation and workflow generation use the same source. (DEC-058) |
| BR-CASE-014 | Notice | Employee notice applies only where the separation type says so. A termination carries no notice concept; an immediate resignation carries a notice date with no period served. Neither is asked of HR - both are derived. (DEC-058) |
| BR-CASE-015 | Dates | Notice received, last working day, separation effective and contract end are distinct concepts. Operational timing - access removal, asset deadlines, payroll and provider notification - is measured from the separation effective instant, never from the date notice arrived. (DEC-058) HR enters one end date: the last working day is the employment end date and the effective instant is derived at close of business on it; no time is asked (DEC-064). |
| BR-CASE-016 | Backdating | Today is a default for separation dates, never a rule. Historical and future-dated separations are both supported; a departure already past is flagged as a historical record. Unusual date relationships are accepted with an audited reason rather than blocked. (DEC-058) |
| BR-CASE-018 | Single authorization gate | HR Manager approval of the case authorizes the assigned HR Officer to execute the approved downstream offboarding workflow without additional HR Manager approval for routine case documents, forms or communications. The approval is taken on a Case Approval Summary that shows the employee record, exit details, HR ownership, the benefits and providers selected at intake, the communication plan with resolved recipients and their readiness, the documents and forms to be produced, and the workflow that follows; returning the case to draft requires a reason the officer sees on the draft. Retained as distinct controls: the case approval itself, the final clearance decision, the optional configuration-gated Action Form HR review, recipient-directory approval and verification, waivers, overrides, holds, reopening, security exceptions, template and workflow activation, and employee or external acknowledgements. (DEC-066) |
| BR-CASE-019 | Approved facts | Benefits and providers are selected during Create Offboarding Case, may be corrected while the case is a draft, and become an approved fact once the case is submitted: only the HR Manager amends them afterwards, and every amendment is audited with the previous values. The other material facts (separation type, dates, ownership) keep their existing safeguards - draft edits are DRAFT-only, live corrections are the HR Manager's audited actions, and a material correction supersedes finalized-but-unissued documents and open notifications - so the officer executes only what was approved. (DEC-066) |
| BR-CASE-017 | Ownership | Every case carries an immutable creator (`createdById`, an audit fact) and a mutable assigned HR Officer (`assignedOfficerId`, the operational owner). An HR Officer who creates a case is assigned to it automatically; a case the HR Manager creates starts unassigned until the manager assigns an officer. Cases (the register) is visible to both roles; My Work lists the cases assigned to the signed-in person. An HR Officer edits only the case assigned to them and reads every other case; the HR Manager edits every case and assigns or reassigns the officer. Every assignment - automatic or manual - is audited with the previous officer, the new officer, the actor and the instant, and reassignment never rewrites the creator or task history. (DEC-065) |
| BR-WF-004 | Dependencies | A task becomes READY only when its dependencies and conditions are satisfied. |
| BR-WF-005 | Mandatory work | A mandatory task cannot be silently skipped. |
| BR-WF-006 | Waiver | A waiver is allowed only for configured task types and roles and requires reason/evidence. |
| BR-WF-007 | Blocker | Blocking a task does not remove its due date, overdue status or accountability. |
| BR-WF-008 | Assignment | Every actionable task has a role queue or named assignee. |
| BR-WF-009 | Reassignment | Reassignment preserves the prior assignee and reason. |
| BR-WF-010 | Due dates | Business-day deadlines use the approved calendar version and timezone. |
| BR-WF-011 | Due dates | The originally calculated due timestamp is preserved after rescheduling. |
| BR-WF-012 | Escalation | Reminders and escalations must be idempotent. |
| BR-WF-013 | Conditional tasks | NCB, Sagicor, survey and handover tasks are created only when applicability is true. |
| BR-WF-014 | Cancellation | Case cancellation/void cancels pending work but not completed evidence or history. |
| BR-WF-015 | Closure | CLEARANCE_REVIEW requires all mandatory tasks terminal in an acceptable state and every asset item to have a final disposition. |
| BR-WF-016 | Completion | COMPLETED requires HR Manager approval and a passing closure-integrity check. |
| BR-WF-017 | Hold | A hold must specify which SLA clocks pause; this policy must be approved before implementation. |
| BR-DOC-001 | Templates | Only an active approved template version may produce a controlled document. |
| BR-DOC-002 | Source | Documents use the case snapshot and approved case fields, not unreviewed live source data. |
| BR-DOC-003 | Validation | Missing or inconsistent required placeholders block generation or finalization. |
| BR-DOC-004 | Preview | The person finalizing a document must be able to see the full rendered content and key field sources. |
| BR-DOC-005 | Finalization | Generation does not equal finalization or issue. A document is finalized in one attested, checksum-bound step by the HR person executing the approved case (the assigned HR Officer, or the HR Manager intervening); no separate per-document HR Manager approval exists. Nothing is finalized or issued unless the case is in an execution status (APPROVED, ACTIVE, CLEARANCE_REVIEW, REOPENED). (DEC-066) |
| BR-DOC-006 | Separation | Termination cases may not use resignation-acceptance templates. No separation type may borrow another's letter: a type with no approved template issues nothing. (DEC-058) |
| BR-DOC-007 | Issue | Issued bytes, checksum, template version, data snapshot, finalizer attestation and issue time are immutable. |
| BR-DOC-008 | Correction | A correction supersedes rather than overwrites an issued document. |
| BR-DOC-009 | Access | Restricted document views/downloads are authorized per request and audited. |
| BR-DOC-010 | Signature | Authenticated attestation is the MVP signature evidence unless a stronger approved e-signature is required. |
| BR-DOC-011 | Electronic signatures | The Employee Action Form carries the approved company logo and signable blocks: the employee initials the three sections the printed form already contains and signs the acknowledgement it already records; the assigned HR Officer signs the Human Resources block. No HR Manager signature block exists, because this form has no HR Manager approval. A signature is evidence of who signed, never an authorization, and approval is never inferred from a signature image. Marks are PNG images held in private object storage with a checksum verified on every read, never in a case column, an audit event or a public URL. Each placement is recorded separately even when one drawn set of initials was applied to several sections. A mistaken HR signature is superseded, never deleted. Completing the form locks its signatures; a material case correction revokes the open requests rather than transplanting marks onto the replacement version. (DEC-068) |
| BR-DOC-012 | Signing links | A signature request names one signer and one form version. Creating it is not sending it: copying the link and emailing it address the same request, and a resend reuses the live one. The link runs for a configured number of days (default 30) and may be extended, never beyond a configured ceiling measured from issue (default 90), so the platform never issues a permanently valid link. It ends at the earliest of completion, revocation, supersession of the form version, or expiry, and is unaffected by restarts, redeploys or the signer closing their browser. The raw link is never written to an audit event, a log, a stored email body or an analytics payload; audit records the request identifier. An expired, revoked or completed link says exactly that and reveals nothing of the case. The external signer receives no platform role, account or session. (DEC-068) |
| BR-NOT-001 | Templates | Every outbound notice uses an approved template/version or an explicitly approved manual exception. |
| BR-NOT-002 | Applicability | A notification cannot be generated solely because it exists in the general process map; applicability must be true. |
| BR-NOT-003 | Minimum data | The recipient sees only the approved field set for the purpose. |
| BR-NOT-004 | Release | External, employee-facing and termination communications are never sent automatically: a human releases each one. That human is the HR person executing the approved case - the assigned HR Officer or the HR Manager - because the HR Manager approval of the case already covered every audience the approval summary showed. A stored `HR_MANAGER_APPROVAL_REQUIRED` control level reads as "held for HR review". (DEC-066) |
| BR-NOT-005 | Outbox | A notification is persisted before provider dispatch. |
| BR-NOT-006 | Idempotency | The same logical notification/recipient/effective event may not be submitted twice without an approved resend reason. |
| BR-NOT-007 | Status | Provider acceptance means SUBMITTED, not DELIVERED. |
| BR-NOT-008 | Retry | Only transient failures are automatically retried; retries are bounded. |
| BR-NOT-009 | Failure | Permanent failure or bounce creates an exception and manual next action. |
| BR-NOT-010 | Fallback | Manual fallback requires recipient, method, timestamp, sender, reason and evidence. |
| BR-NOT-011 | Development | Non-production environments cannot send to real external recipients. |
| BR-NOT-012 | Urgency | Urgent IT access work is not delayed by the general 24-hour communication target. |
| BR-ASSET-001 | Generation | Case assets come from issued-asset records plus applicable workflow defaults. |
| BR-ASSET-002 | Disposition | Every required asset item must end with an explicit final disposition. |
| BR-ASSET-003 | Return evidence | RETURNED requires receiver, time and condition; configured classes may require evidence. |
| BR-ASSET-004 | Exception | LOST, DAMAGED, WAIVED or UNRESOLVED items require an owned exception or approval. |
| BR-ASSET-005 | Pay | No asset state directly creates or changes a payroll deduction or final-pay amount. |
| BR-ASSET-006 | Metrics | Documentation compliance and physical recovery are separate KPIs. |
| BR-ASSET-007 | Closure | Physical non-return does not make closure impossible when an authorized final disposition and exception are recorded. |
| BR-HAND-001 | Applicability | Handover is enabled by workflow and can be marked not applicable only with authority and reason. |
| BR-HAND-002 | Secrets | Passwords, API keys, security codes and secret values are prohibited in handover content. |
| BR-HAND-003 | Ownership | Every handover item must have a receiving owner or an explicit escalation. |
| BR-HAND-004 | Immediate departures | Immediate departure may use manager-led reconstruction without employee participation. |
| BR-SUR-001 | Eligibility | No survey is sent without an eligibility decision. |
| BR-SUR-002 | Termination | Termination surveys default to suppressed until an approved policy rule says otherwise. |
| BR-SUR-003 | Contact | The personal contact must be verified or the case uses an approved alternative/no-contact outcome. |
| BR-SUR-004 | Token | Survey links use high-entropy, single-use, expiring tokens stored as hashes. |
| BR-SUR-005 | Privacy | The respondent page exposes no internal case data. |
| BR-SUR-006 | Timing | Default send timing is day 3 and reminder day 7 after effective departure, subject to suppression/reschedule. |
| BR-SUR-007 | Response | The respondent can review before submit but cannot edit through the token after submission. |
| BR-SUR-008 | Visibility | Identifiable responses are restricted to approved HR/privacy roles. |
| BR-SUR-009 | Manager reports | Managers receive aggregates, not identifiable responses. |
| BR-SUR-010 | Small cohorts | Segmented results below the approved threshold are suppressed or combined. |
| BR-SUR-011 | Metric | Completion uses eligible successfully delivered invitations plus approved verbal routes; exclusions remain visible. |
| BR-REP-001 | Metrics | A dashboard percentage must use the approved metric definition and show/report denominator and exclusions. |
| BR-REP-002 | Access | Report data and exports are filtered by the user's effective permissions. |
| BR-REP-003 | Exports | Sensitive exports require authorization, redaction and audit. |
| BR-REP-004 | Freshness | Reports display data-as-of time and relevant integration health. |
| BR-SEC-001 | Authorization | Hiding a UI control is not authorization; every request is checked server-side. |
| BR-SEC-002 | Admin | SYSTEM_ADMIN is retired (DEC-063). No login outside HR_MANAGER / HR_OFFICER exists; platform administration never widens the HR Manager's record scope. |
| BR-SEC-003 | Break glass | Break-glass access is approved, time-bound, reasoned and reviewed. |
| BR-SEC-004 | Uploads | Unsafe/unscanned files are not served. |
| BR-SEC-005 | Logs | Logs exclude secrets, tokens, document bodies, survey answers and unnecessary PII. |
| BR-SEC-006 | Sessions | Production has no local development login bypass. |
| BR-SEC-007 | Environment | Development/test/staging/production use separate credentials and data. |
| BR-PRIV-001 | Purpose | Personal data is collected/used only for an approved offboarding purpose. |
| BR-PRIV-002 | Minimization | Department queues and external notices expose only necessary fields. |
| BR-PRIV-003 | Retention | Production deletion is not enabled until record-class retention rules are approved. |
| BR-PRIV-004 | Legal hold | A legal hold blocks automated disposal without broadening access. |
| BR-PRIV-005 | Cross-border | External cloud/AI processing is not enabled without approved assessment. |
| BR-PRIV-006 | Breach | Incident records preserve awareness time and evidence needed for regulatory/subject notification decisions. |
| BR-INT-001 | BambooHR | MVP BambooHR access is read-only unless a separate write scope is approved. |
| BR-INT-002 | Identity | Integration credentials belong to the company, not a normal employee. |
| BR-INT-003 | Webhook | Webhook signatures, timestamps and idempotency are verified before processing. |
| BR-INT-004 | Fallback | Integration failure does not prevent approved manual case progression. |
| BR-INT-005 | Reconciliation | Manual/stale source data creates a reconciliation obligation. |

## Rule implementation standard

Each implemented rule must have:

- a stable rule/reference ID in code or tests where practical;
- server-side enforcement;
- a clear user-facing validation or exception message;
- an audit event when the rule governs a sensitive state change;
- unit/integration/end-to-end evidence appropriate to the risk;
- no contradictory client-only implementation.

## Conflict handling

When a requested change conflicts with a rule:

1. do not weaken the rule silently;
2. raise a change request;
3. identify impacted requirements, workflows, metrics, privacy/security controls and tests;
4. obtain the approval owner specified in the Decision Register;
5. version the affected configuration or document.
