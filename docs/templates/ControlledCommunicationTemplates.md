# Controlled Communication Templates

**Baseline version:** 0.1
**Prepared:** 2026-07-28
**Status:** **DRAFT FOR HR/POLICY/PRIVACY APPROVAL — NOT AUTHORIZED FOR ISSUE**

These templates are sanitized implementation specifications. They intentionally do not copy personal details, signatures, email addresses or exact wording from the source appendices.

## 1. General rules

- Render only from an approved immutable template version.
- Show source and value for high-risk fields before approval.
- Use the minimum necessary information for the recipient.
- Never include exit-survey responses, unrestricted notes or rehire eligibility.
- Do not promise pay, deductions, benefits or legal outcomes not approved by policy.
- Do not state that an email was delivered merely because the provider accepted it.
- Do not threaten pay withholding for unreturned assets.
- External recipient addresses are versioned configuration.
- Dates use approved company format; exact access times include timezone.
- Any `{placeholder}` left unresolved blocks generation/dispatch.

## 2. Resignation with notice acknowledgement/acceptance

**Template ID:** `TPL-DOC-001`
**Classification:** Confidential
**Approval:** HR content/policy owner
**Output:** Approved controlled document

### Required fields

- `document.issue_date`
- `employee.full_name`
- `employee.correspondence_address` only when policy requires it
- `case.receipt_date`
- `case.confirmed_last_working_date`
- `case.effective_separation_datetime`
- `organization.legal_name`
- `signatory.full_name`
- `signatory.title`
- approved clause variants for notice, final-pay process and asset return

### Draft structure

```text
PRIVATE AND CONFIDENTIAL

{document.issue_date}

{employee.full_name}
{#if employee.correspondence_address}
{employee.correspondence_address}
{/if}

Dear {employee.salutation_or_approved_name},

Re: Acknowledgement of Resignation

We acknowledge receipt of your resignation dated {case.receipt_date}.

Your confirmed last working day is {case.confirmed_last_working_date}.
Your employment separation will take effect at
{case.effective_separation_datetime}.

{approved.notice_clause}

{approved.final_pay_process_clause}

Please arrange the return or documented disposition of all applicable
company-issued property through the HR offboarding process by the agreed date.
Questions about outstanding items should be directed to
{organization.hr_contact_role_or_channel}.

{approved.closing_clause}

Sincerely,

{signatory.full_name}
{signatory.title}
{organization.legal_name}
```

### Prohibited dynamic content

- unapproved deduction amounts;
- assertion that final pay will be held;
- invented legal conclusions;
- AI-generated free-form clauses;
- resignation reason unless policy explicitly requires it.

## 3. Immediate resignation acknowledgement

**Template ID:** `TPL-DOC-002`
**Classification:** Confidential
**Approval:** HR content/policy owner

```text
PRIVATE AND CONFIDENTIAL

{document.issue_date}

Dear {employee.salutation_or_approved_name},

Re: Acknowledgement of Immediate Resignation

We acknowledge receipt of your resignation on {case.receipt_datetime}.

The approved effective separation date and time is
{case.effective_separation_datetime}.

{approved.immediate_resignation_clause}
{approved.final_pay_process_clause}
{approved.asset_return_clause}
{approved.closing_clause}

Sincerely,

{signatory.full_name}
{signatory.title}
{organization.legal_name}
```

The system must not assume that “immediate” means the receipt timestamp; HR confirms the effective timestamp.

## 4. Termination communication placeholder

**Template ID:** `TPL-DOC-003`
**Classification:** Restricted
**Status:** Non-issuable until authorized wording is approved

```text
[CONTROLLED TERMINATION TEMPLATE PLACEHOLDER]

This template intentionally contains no termination wording.
An authorized HR/policy/legal owner must approve the complete content,
applicability, signatory, delivery method and evidence requirements before an
ACTIVE version can be published.
```

The application must reject generation while this template has `DRAFT`, `PENDING_APPROVAL`, `REVOKED` or no active version.

## 5. IT exact-time access-removal task

**Template ID:** `TPL-NOT-001`
**Classification:** Confidential
**Recipient:** Approved IT responder or controlled IT mailbox

### Subject

```text
Action required: access removal at {case.effective_separation_datetime} —
{case.case_number}
```

### Body

```text
IT Team,

Please complete the approved access-removal task for the employee/work account
below at the exact effective separation date and time.

Case reference: {case.case_number}
Employee/internal reference: {employee.employee_id}
Employee name: {employee.full_name}
Work email/account: {employee.work_account_identifiers}
Department/location: {employee.department_location_if_required}
Effective separation: {case.effective_separation_datetime}
Systems/scope: {task.approved_system_scope}

Record completion and evidence in the assigned task:
{task.secure_action_link}

HR owner: {case.hr_owner_name_or_role}
Urgency: {task.priority}

Do not reply with passwords, tokens or unnecessary personal information.
```

### Control

The due timestamp equals the approved effective separation timestamp. This message does not make IT task completion optional and does not use the general 24-hour notification rule as its due time.

## 6. Finance offboarding task

**Template ID:** `TPL-NOT-002`
**Classification:** Confidential
**Recipient:** Approved Finance responder/queue

### Subject

```text
Finance offboarding action — {case.case_number} —
effective {case.effective_separation_date}
```

### Body

```text
Finance Team,

An approved offboarding case requires the Finance actions defined in the
assigned task.

Case reference: {case.case_number}
Employee ID: {employee.employee_id}
Employee name: {employee.full_name}
Department/location: {employee.department_location_if_required}
Approved effective separation: {case.effective_separation_datetime}
Task due: {task.due_datetime}

Complete the assigned checklist and record the outcome here:
{task.secure_action_link}

This notice does not authorize an automatic deduction, final-pay hold or change
to entitlement. Any exception must follow the approved HR/Finance decision
process.
```

Do not include the resignation/termination narrative unless an approved minimum-field rule requires a specific category.

## 7. Line-manager handover task

**Template ID:** `TPL-NOT-003`
**Classification:** Confidential

```text
Subject: Handover action due {task.due_date} — {case.case_number}

{manager.display_name},

Please complete the assigned handover items for the departing employee by
{task.due_datetime}.

Employee: {employee.full_name}
Approved last working/effective date: {case.confirmed_last_working_date}
Secure task: {task.secure_action_link}

Record duties, open work, document locations, owners, training and unresolved
risks. Do not enter passwords, tokens, shared secrets or personal credentials.
```

## 8. Internal reminder

**Template ID:** `TPL-NOT-004`

```text
Subject: {task.status_label}: {task.title} — due {task.due_datetime}

Task: {task.title}
Case: {case.case_number}
Due: {task.due_datetime}
Status: {task.status}
Next action: {task.next_action}
Secure link: {task.secure_action_link}
```

The notification engine may add no additional personal details unless the recipient is authorized and the field is approved.

## 9. Escalation

**Template ID:** `TPL-NOT-005`

```text
Subject: Escalation: {task.title} — {task.age_or_due_status}

Case: {case.case_number}
Task: {task.title}
Assigned owner: {task.assignee_role_or_name}
Due: {task.due_datetime}
Current status: {task.status}
Blocker: {task.safe_blocker_summary}
Required response by: {task.escalation_response_due}

Review: {task.secure_action_link}
```

For restricted termination cases, omit employee identity from broad escalation subject/body unless the recipient is an explicit case participant.

## 10. Sagicor provider notification

**Template ID:** `TPL-EXT-001`
**Status:** Draft pending approved field set and recipient configuration
**Applicability:** Employee is enrolled and approved separation rule requires provider notification

### Subject

```text
Group programme separation request — {provider.company_reference}
```

### Body

```text
Dear {provider.approved_contact_salutation},

Please process the approved separation action for the employee/member below.

{#each provider.approved_identity_fields}
{label}: {value}
{/each}

Effective/last working date: {case.approved_provider_effective_date}
Employer reference: {organization.approved_provider_reference}
Contact: {organization.approved_benefits_contact}

Please confirm receipt or advise if additional approved information is required.

Regards,
{sender.approved_name_or_role}
{organization.legal_name}
```

No departure reason, survey data, address, phone or free text is included unless the Privacy/Benefits owner explicitly approves the field.

## 11. NCB provider notification

**Template ID:** `TPL-EXT-002`
**Status:** Draft pending approved field set and recipient configuration

Use the same minimum-data structure as `TPL-EXT-001`, with NCB-specific programme and member fields approved by the Benefits owner and Privacy function.

## 12. Exit-survey invitation

**Template ID:** `TPL-EMP-001`
**Classification:** Confidential
**Recipient:** Verified personal email

### Subject

```text
Optional feedback about your experience with {organization.display_name}
```

### Body

```text
Hello {employee.approved_greeting_name},

You are invited to complete a short optional exit survey about your experience
with {organization.display_name}.

The survey normally takes approximately {survey.estimated_minutes} minutes.
Please review the confidentiality/privacy notice on the survey page before
submitting.

Secure survey link:
{survey.one_time_link}

The link expires on {survey.expiry_datetime} and can be used once.

Participation is voluntary. Choosing not to respond will not change the
offboarding actions already being processed. For questions, contact
{organization.approved_hr_contact}.

Thank you.
```

Do not include departure reason or internal case status. The wording about voluntary participation and consequences must be approved by HR/privacy.

## 13. Exit-survey reminder

**Template ID:** `TPL-EMP-002`

```text
Subject: Reminder: optional exit survey

Hello {employee.approved_greeting_name},

This is the scheduled reminder for the optional exit survey previously sent to
you. The secure link expires on {survey.expiry_datetime}:

{survey.one_time_link}

No further automated reminder is planned. For questions, contact
{organization.approved_hr_contact}.
```

The system sends this only when no response exists and HR has not suppressed/rescheduled it.

## 14. Survey submission confirmation

**Template ID:** `TPL-EMP-003`

```text
Thank you. Your response has been submitted.

This confirmation does not display or email your answers. You may close this
page. For questions about the survey or privacy notice, use the contact shown on
the invitation.
```

## 15. Asset-return reminder

**Template ID:** `TPL-EMP-004`
**Status:** Draft pending approved contact channel and policy wording

```text
Subject: Company property follow-up — {case.case_number}

Hello {employee.approved_greeting_name},

Our records show that the following applicable company item(s) still require a
documented outcome:

{asset.safe_outstanding_item_list}

Please contact {organization.approved_asset_contact} by
{asset.follow_up_due_date} to arrange return or clarify the item status.

This message does not state or imply an automatic deduction or final-pay hold.
Any exceptional decision follows the authorized HR/Finance process.
```

## 16. Template review checklist

Before activation, the owner confirms:

- purpose and audience;
- departure-type applicability;
- legal/policy wording;
- minimum fields;
- recipient source;
- sender/signatory;
- confidentiality;
- output/channel;
- placeholder sources and validation;
- approval route;
- retention;
- synthetic rendering;
- accessibility;
- error/fallback behaviour;
- version/effective date;
- tests;
- no source personal data.
