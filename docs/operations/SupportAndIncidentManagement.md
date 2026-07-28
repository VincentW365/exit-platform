# Support and Incident Management

**Baseline version:** 0.1
**Prepared:** 2026-07-28
**Status:** Proposed; named people, service hours, contact channels and target times require approval before pilot.

## 1. Operating ownership

At minimum assign:

| Role | Responsibility |
| --- | --- |
| Product Owner | requirements, prioritization, change control and business acceptance |
| HR Operational Owner | process continuity, case correction, templates, workflow decisions |
| Technical Owner | application, worker, database, storage, integrations and deployment |
| Security Owner | vulnerability, access-control and security-incident response |
| Privacy/DPO function | personal-data incident assessment, notices, rights and retention |
| Integration Owners | identity, BambooHR, email, storage/scanner and provider contacts |
| Support Coordinator | intake, triage, communication, ticket quality and closure |
| Secondary technical owner | continuity when primary developer/owner is unavailable |

Claude and the original developer are not substitutes for assigned company ownership.

## 2. Support boundaries

Support covers:

- user/access issues;
- case/workflow defects;
- failed scheduled work and notifications;
- document rendering/storage;
- survey links;
- asset/handover/clearance;
- reports/exports;
- integrations;
- suspected privacy/security events;
- data correction through approved application processes.

Support must not:

- modify production data directly without approved emergency procedure;
- change final pay or HR policy;
- disclose case data to verify a caller without authorization;
- request passwords/tokens in tickets;
- paste sensitive document or survey contents into general ticketing systems.

## 3. Severity model

| Severity | Definition | Examples | Initial action |
| --- | --- | --- | --- |
| SEV-1 Critical | Active or imminent material harm, broad outage or critical control failure | unauthorized HR-data access; urgent access-removal failure; wrong-recipient sensitive email; data loss | immediate containment and incident command |
| SEV-2 High | Major feature unavailable or high-risk defect with workaround | notification worker failure; restricted case visible to wrong role but contained; document issue blocking departure | urgent owner response and controlled workaround |
| SEV-3 Medium | Limited impact; core process continues | one report incorrect; non-urgent integration delay; isolated UI failure | prioritize and use documented workaround |
| SEV-4 Low | Minor defect, question or enhancement | wording, cosmetic defect, low-risk usability request | normal backlog/change control |

Targets are not set in this baseline. IT/HR must approve service and response targets before pilot.

## 4. Incident lifecycle

```text
DETECTED
  -> TRIAGED
  -> CONTAINED
  -> INVESTIGATING
  -> REMEDIATING
  -> RECOVERING
  -> MONITORING
  -> CLOSED
  -> POST_INCIDENT_REVIEW
```

Preserve the original detection and event timestamps. Do not alter evidence to make targets appear met.

## 5. Intake record

Capture:

- incident/ticket ID;
- reporter and safe contact;
- detected time and event time;
- environment;
- affected feature/case IDs without unnecessary personal data;
- observed behaviour and error/correlation ID;
- severity rationale;
- systems/integrations involved;
- whether personal data, wrong recipient, access or loss may be involved;
- containment;
- owner and escalation;
- status updates;
- resolution and verification;
- linked risk, defect, decision or change request.

## 6. Privacy and security escalation

Immediately involve Security and Privacy/DPO functions when there is suspected:

- unauthorized access or disclosure;
- wrong recipient;
- lost or exposed file/token/credential;
- altered/deleted audit evidence;
- compromised account;
- malicious upload;
- cross-border/processor issue;
- inability to honour a data-subject request;
- retention deletion failure affecting personal data.

The Privacy/DPO function determines whether the event is a personal-data breach, which authorities/data subjects must be notified, content, timing and legal basis. The OIC reference in `../source/SourceReferences.md` identifies a 72-hour controller reporting obligation after awareness; the company must translate that into an approved incident procedure and must not wait for the outer deadline to escalate internally.

## 7. Immediate containment examples

| Event | Containment |
| --- | --- |
| Wrong recipient notification | stop queue/template; contact approved security/privacy owners; preserve provider evidence; assess recall/recipient action |
| Restricted case visible | remove access/disable affected path; preserve logs; identify exposure scope |
| Urgent IT task late | invoke fallback channel; complete revocation; record exact late duration and cause |
| Duplicate notification | pause related idempotency/type; identify all submissions; prevent retries |
| Compromised account | revoke sessions/credentials; restrict account; review audit events |
| Malicious upload | quarantine/delete only under evidence procedure; disable download; inspect scanner/control |
| Suspected data corruption | stop writes/automation; snapshot/preserve; begin recovery validation |
| AI data exposure | disable AI feature/key; preserve request/provider evidence; invoke privacy/security assessment |

## 8. Communication

- Use need-to-know incident channels.
- Do not include full document/survey content in status messages.
- Provide factual, time-stamped updates.
- Separate confirmed facts, hypotheses and actions.
- HR owns employee-facing process communication; Privacy/Legal/Security approve breach-related communication.
- Sponsor receives business-impact updates for SEV-1/2.
- Do not claim delivery, recovery or containment without evidence.

## 9. Technical diagnosis requirements

Operational telemetry should support:

- request/correlation ID;
- case/task/notification technical IDs;
- worker job status;
- provider attempt/result ID;
- safe error code;
- feature flag/config version;
- deployment version;
- database/outbox backlog health;
- integration health and last successful reconciliation.

Telemetry must not contain raw survey responses, document bodies, addresses, tokens, secrets or unnecessary personal data.

## 10. Data correction

Correct production information through approved domain actions:

- correct/supersede document;
- update confirmed date with audited recalculation;
- record manual action/reconciliation;
- reopen case;
- void incorrect case;
- correct employee snapshot through approved process.

Direct SQL edits are exceptional, require documented approval, before/after evidence, backup and a compensating audit event.

## 11. Problem management

Create a problem record when:

- an incident repeats;
- two or more related failures occur in a month;
- a control-plan reaction threshold is reached;
- root cause is systemic;
- workaround creates material operational burden.

Problem analysis records root cause, contributing factors, corrective/preventive action, owner, due date and validation.

## 12. Post-incident review

Required for SEV-1 and material SEV-2 events.

Include:

- timeline;
- impact and data scope;
- detection and containment effectiveness;
- root cause and contributing conditions;
- what worked/failed in fallback;
- notification decisions;
- corrective actions;
- requirement/risk/test/runbook updates;
- owner and deadline;
- follow-up verification.

Use blameless analysis while preserving accountability for control ownership.

## 13. Routine support review

Monthly during pilot and quarterly thereafter:

- incidents by severity/type;
- repeated user errors/workarounds;
- notification/integration failure rates;
- overdue support items;
- access requests and reviews;
- security/privacy events;
- restore/fallback test status;
- open risks and problems;
- product backlog and approved changes;
- knowledge/secondary-owner coverage.

## 14. Release and support handover

Before pilot, Support receives:

- architecture and dependency overview;
- environments and health checks;
- safe configuration inventory;
- deployment/rollback;
- backup/restore;
- integration owners and scopes;
- common failure playbooks;
- feature-flag/no-send controls;
- incident/privacy escalation;
- data-correction procedures;
- known limitations;
- training environment and synthetic cases.
