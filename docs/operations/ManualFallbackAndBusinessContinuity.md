# Manual Fallback and Business Continuity

**Baseline version:** 0.1
**Prepared:** 2026-07-28
**Owner:** HR Manager with IT operational support
**Status:** Proposed; named contacts, channels, recovery objectives and storage locations must be approved before pilot.

## 1. Purpose

Ensure urgent offboarding work continues safely when the application, worker, identity provider, database, storage, email provider or BambooHR is unavailable.

Fallback must preserve:

- exact-time access-removal control;
- minimum necessary disclosure;
- approval evidence;
- asset and clearance records;
- later reconciliation into the system;
- incident and audit history.

Fallback is not permission to use uncontrolled personal email, public messaging apps or undocumented spreadsheets.

## 2. Activation

Fallback may be activated by an authorized HR Manager or designated incident lead when:

- the web application is unavailable;
- the worker cannot process due work;
- identity prevents authorized access;
- the email/integration provider is unavailable;
- data integrity is uncertain;
- an urgent departure cannot wait for restoration;
- security/privacy containment requires automation to be disabled.

Record:

- activation time;
- reason;
- incident/reference ID;
- decision maker;
- affected cases;
- systems unavailable;
- temporary communication channel;
- expected review time.

## 3. Priority order

1. **Protect access:** ensure IT receives and acknowledges the exact effective timestamp.
2. **Protect people/data:** prevent incorrect or excessive disclosure.
3. **Preserve evidence:** record approvals, recipients, timestamps and outcomes.
4. **Continue minimum operational tasks:** Finance, benefits, asset and manager actions.
5. **Reconcile:** enter verified fallback activity when service returns.
6. **Review:** investigate failure and update controls.

## 4. Approved fallback case record

Use a company-controlled secure form or encrypted file in the approved HR location. Assign a temporary ID:

```text
FALLBACK-YYYYMMDD-NNN
```

Minimum fields:

- employee ID or controlled internal reference;
- employee name only where necessary;
- departure type;
- confidentiality;
- receipt timestamp;
- approved effective separation timestamp;
- HR case owner and approver;
- IT/Finance/manager task owner;
- document/notification status;
- asset status;
- actions, timestamps, actor and evidence reference;
- incident ID.

Do not store survey free text or unnecessary personal details in the fallback log.

## 5. Urgent access removal

### Procedure

1. Authorized HR confirms identity and exact effective time.
2. HR uses the approved urgent IT channel and provides only:
   - employee/internal identity reference;
   - work account identifiers;
   - location/department where necessary;
   - exact effective time;
   - systems/access scope known;
   - HR contact and incident/reference ID.
3. IT repeats back or acknowledges the effective time.
4. HR records request time/channel/recipient.
5. IT records completion time, operator and evidence.
6. A miss is escalated immediately under the incident plan.
7. After restoration, both request and completion are reconciled to the case.

Do not wait for the general 24-hour notification window.

## 6. Controlled documents

When generation/approval is unavailable:

- use only the latest approved company template stored in the controlled fallback location;
- verify employee, date and applicable wording manually;
- require the same approval authority;
- record template/version or fallback file revision;
- store the issued copy securely;
- mark it for system reconciliation;
- never create new legal/policy wording during the outage.

A corrected document follows the same correction/supersession rules after restoration.

## 7. Notifications

When the outbox or provider is unavailable:

- determine whether the communication can wait safely;
- use only approved recipients and minimum fields;
- use the company-approved mailbox/channel;
- require approval where normally required;
- record subject/type, recipient, sender, approval, time and evidence;
- do not resend automatically after restoration until reconciliation confirms whether it was already sent.

For Sagicor/NCB or other external parties, verify applicability and the approved recipient before manual send.

## 8. Assets and handover

Use the controlled fallback checklist:

- item/identifier;
- issued/applicable status;
- disposition;
- received by/time;
- condition/evidence;
- exception/waiver approver;
- handover item, owner and attestation.

No fallback record may authorize an automatic deduction or final-pay hold.

## 9. Exit survey

If survey delivery is unavailable:

- do not send an insecure generic form;
- record the case as pending survey delivery;
- HR may conduct the approved verbal debrief and record it securely;
- reschedule the controlled invitation after restoration if still eligible;
- do not extend or change the confidentiality promise informally.

## 10. Restoration and reconciliation

When service is restored:

1. incident lead declares the system safe for use;
2. create/find the application case using the temporary fallback ID;
3. enter each fallback action as a manual/reconciled event with original timestamp;
4. attach or reference approved evidence;
5. mark affected queued notifications to avoid duplicate dispatch;
6. recalculate future tasks without rewriting historical deadlines;
7. verify closure integrity;
8. a second authorized HR user reviews reconciliation;
9. close the fallback record only after counts match.

Reconciled events must identify:

- original actor;
- original event time;
- recorder;
- reconciliation time;
- source/evidence;
- reason for manual entry.

## 11. Continuity scenarios

| Scenario | Immediate response | Recovery focus |
| --- | --- | --- |
| Web unavailable, database healthy | Activate fallback; IT monitors | Restore web; reconcile actions |
| Database unavailable/corrupt | Stop writes; fallback log | Recover to approved point; verify data/object consistency |
| Worker unavailable | Disable/review scheduled dispatch; manual urgent tasks | Resume idempotently; inspect backlog |
| Email provider unavailable | Record pending/manual critical sends | Prevent duplicates; reconcile provider evidence |
| Identity provider unavailable | Use approved emergency access only, otherwise fallback | Review emergency access and revoke |
| BambooHR unavailable | Use controlled HR-verified manual data | Reconcile snapshot/source when restored |
| Storage/scanner unavailable | Do not release unscanned uploads | Restore/quarantine and verify checksums |
| Suspected breach | Contain, preserve evidence, restrict automation | Follow incident/privacy process before resuming |

## 12. Tabletop exercise

Before pilot and annually thereafter, simulate at least:

- immediate resignation while the app is down;
- worker crash after provider submission but before local status update;
- identity outage;
- database restore;
- suspected wrong-recipient email;
- reconciliation of manual actions.

Record participants, elapsed times, missed steps and corrective actions.

## 13. Controlled fallback materials

Production owners must maintain outside the application:

- approved urgent IT contact tree;
- approved HR/IT/Finance escalation contacts;
- current controlled letter templates;
- minimum-field notification templates;
- fallback case/action/asset checklist;
- recipient register;
- restoration/reconciliation checklist;
- current runbook and last test date.

The location must be company controlled, access restricted and available during an application outage.
