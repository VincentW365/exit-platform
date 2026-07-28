# Information Architecture

## 1. UX goal

Make the next required action, owner, deadline, blocker and evidence immediately clear while protecting restricted HR content. The product is a workflow tool first and a reporting tool second.

## 2. Global navigation by role

### HR Manager / HR Officer

```text
Dashboard
Cases
  All cases
  My cases
  Create case
Tasks
  My work
  Department queues
Approvals
  Cases
  Documents
  Notifications
  Waivers
Documents
Notifications
Assets
Handover
Exit Feedback
Exceptions
Reports
Audit (authorized roles)
Administration (authorized roles)
Help / Runbooks
```

### IT responder

```text
My IT Queue
Upcoming Revocations
Technology Assets
Exceptions / Blockers
Completed Tasks
Help
```

### Finance responder

```text
My Finance Queue
Upcoming Departures
Exceptions / Blockers
Completed Tasks
Help
```

### Line manager

```text
My Handover Tasks
Upcoming Departures (assigned only)
Completed Handovers
Help
```

### Auditor / Privacy officer

```text
Audit Scope
Case Evidence
Sensitive Access
Exports
Privacy / Retention
Incidents
Reports
```

### System administrator

```text
System Health
Integrations
Jobs / Outbox
Technical Configuration
Feature Flags
Access Provisioning
Runbooks
```

System administrator navigation must not expose normal HR case lists.

## 3. Route concept

Exact routes can change, but resource and authorization boundaries should be clear.

```text
/
  /dashboard
  /cases
  /cases/new
  /cases/[caseId]
    /overview
    /workflow
    /tasks
    /documents
    /notifications
    /assets
    /handover
    /feedback
    /exceptions
    /audit
  /tasks
  /approvals
  /documents
  /notifications
  /assets
  /handover
  /feedback
  /exceptions
  /reports
  /audit
  /admin
    /users
    /roles
    /workflows
    /templates
    /surveys
    /calendar
    /taxonomies
    /assets
    /recipients
    /feature-flags
    /retention
    /integrations
    /health

/survey/[opaqueToken]
```

## 4. Case page information hierarchy

1. Confidentiality/status banner.
2. Employee and departure summary.
3. Next required action.
4. deadlines and effective time.
5. exception/blocker alerts.
6. workflow progress/timeline.
7. module tabs.
8. audit/access history for authorized users.

Do not show all sensitive content on the overview. Use purposeful sections and role-specific summaries.

## 5. Dashboard hierarchy

### Top row

- active cases;
- departures in next 7/14/30 days;
- overdue mandatory tasks;
- urgent access tasks;
- notification failures;
- cases ready for clearance.

### Main work area

- “My next actions” list;
- active cases with next step;
- exception feed;
- upcoming effective departures;
- pending approvals.

### Secondary insight

- letter SLA;
- access timeliness;
- notification accuracy;
- asset documentation;
- survey completion;
- baseline/pilot/post-rollout selector.

Percentages show raw counts and period.

## 6. Search/filter model

### Cases

- employee/case number;
- status;
- departure type;
- classification;
- owner;
- department/location;
- effective date;
- receipt date;
- cohort;
- workflow version;
- has exception;
- due/overdue.

### Tasks

- role queue/assignee;
- task type;
- ready/in progress/blocked/terminal;
- due range;
- overdue age;
- departure type;
- location;
- severity.

### Reports

Filters must preserve small-cohort protection and record the filter set on export.

## 7. Progressive disclosure

- department users see task details, not full cases;
- HR overview shows essentials, with restricted notes/documents in dedicated tabs;
- survey free text is separate from aggregate report views;
- technical error detail is separate from business exception summary;
- advanced configuration is separated from operational pages.

## 8. Status language

Use plain labels:

- Draft
- Awaiting HR review
- Approved
- Active
- On hold
- Clearance review
- Completed
- Cancelled
- Voided
- Reopened

Avoid ambiguous “done” for provider acceptance, task acknowledgement or incomplete clearance.

## 9. Empty/error states

Every page should answer:

- what is missing;
- whether the user can fix it;
- who owns the next action;
- when it is due;
- how to use manual fallback;
- a safe reference ID for technical support.

Do not expose restricted object existence in unauthorized error messages.
