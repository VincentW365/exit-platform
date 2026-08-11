/**
 * Stage 3 acceptance scenarios (Directive 3 section T: Scenarios 1-5).
 * All cases use TEST record purpose: workflow automation stays disabled for
 * operational records. Synthetic identities only.
 */
import { expect, test, type Page } from '@playwright/test';

async function signInAs(page: Page, displayName: string): Promise<void> {
  await page.goto('/signin');
  await page.getByRole('button', { name: `Sign in as ${displayName}` }).click();
  await page.waitForURL('**/');
}

async function signOut(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/signin');
}

async function createTestCase(
  page: Page,
  opts: {
    employeeQuery: string;
    type: string;
    confirmedLastDay?: boolean;
    receivedAt?: string;
    effectiveAt?: string;
  },
): Promise<string> {
  await page.goto('/cases/new');
  await page.getByLabel(/Search the employee source/).fill(opts.employeeQuery);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page.getByLabel('Departure type (required)').selectOption(opts.type);
  await page
    .getByLabel('Receipt date and time (required)')
    .fill(opts.receivedAt ?? '2026-07-20T09:30');
  await page
    .getByLabel('Source of the receipt timestamp (required)')
    .fill('Stage 3 synthetic receipt');
  if (opts.confirmedLastDay) {
    await page.getByLabel('Confirmed last working day').fill('2026-08-14');
  }
  await page
    .getByLabel(/Effective separation date and exact time/)
    .fill(opts.effectiveAt ?? '2026-08-14T17:00');
  await page.getByLabel('Record purpose').selectOption('TEST');
  await page.getByRole('button', { name: 'Create draft case' }).click();
  const banner = page.getByText(/Draft case OFF-\d{4}-\d{4} created/);
  await expect(banner).toBeVisible();
  const number = /OFF-\d{4}-\d{4}/.exec((await banner.textContent()) ?? '')![0];
  return { url: page.url().split('?')[0]!, number };
}

async function submitAndApprove(page: Page, caseUrl: string): Promise<void> {
  await page.goto(caseUrl);
  await page.getByRole('button', { name: 'Submit for HR review' }).click();
  await expect(page.getByText('Case submitted for HR review.')).toBeVisible();
  await signOut(page);
  await signInAs(page, 'Dana Field');
  await page.goto(caseUrl);
  await page.getByRole('button', { name: 'Approve case and capture snapshot' }).click();
  await expect(page.getByText(/Case approved/)).toBeVisible();
}

/** Directive 6.1: activation requires the assignment plan (run as HR Manager). */
async function completeAssignmentPlan(
  page: Page,
  caseUrl: string,
  officerLabel = 'Riley Okafor',
): Promise<void> {
  await page.goto(`${caseUrl}/assignment`);
  await page.locator('details.action > summary', { hasText: 'Assign HR Officer' }).click();
  await page.locator('#of-user').selectOption({ label: officerLabel });
  await page.locator('#of-reason').fill('E2E assignment.');
  await page.getByRole('button', { name: 'Assign officer' }).click();
  await expect(page.getByText('HR Officer assigned (audited).')).toBeVisible();
  await page.locator('details.action > summary', { hasText: 'Assign alternate manager' }).click();
  await page.locator('#am-user').selectOption({ label: 'Jamie Douglas' });
  await page.locator('#am-reason').fill('E2E manager routing.');
  await page.getByRole('button', { name: 'Record alternate manager' }).click();
  await expect(page.getByText('Alternate manager recorded')).toBeVisible();
  for (const box of await page.locator('input[name="confirmations"]').all()) {
    if (!(await box.isChecked())) await box.check();
  }
  await page.getByRole('button', { name: 'Confirm assignment plan' }).click();
  await expect(page.getByText('Assignment plan confirmed').first()).toBeVisible();
}

async function addParticipantOnCase(
  page: Page,
  caseUrl: string,
  userLabel: string,
  role: string,
): Promise<void> {
  await page.goto(caseUrl);
  await page.locator('details.action > summary', { hasText: 'Add participant' }).click();
  const value = await page.locator('#p-user option', { hasText: userLabel }).getAttribute('value');
  await page.getByLabel('User').selectOption(value!);
  await page.locator('#p-role').selectOption(role);
  await page.locator('#p-reason').fill('Stage 3 synthetic assignment.');
  await page.getByRole('button', { name: 'Add participant' }).click();
  await expect(page.getByText('Participant added.')).toBeVisible();
}

/** Open a task from the case workflow tab (HR users) and complete it. */
async function completeTaskFromWorkflow(
  page: Page,
  caseUrl: string,
  title: string,
  note = 'Completed in the Stage 3 acceptance run.',
): Promise<void> {
  await page.goto(`${caseUrl}/workflow`);
  await page.getByRole('link', { name: title, exact: true }).click();
  await page.locator('details.action > summary', { hasText: 'Complete with evidence' }).click();
  await page.locator('#c-note').fill(note);
  await page.getByRole('button', { name: 'Complete task' }).click();
  await expect(page.getByText('Task completed with evidence.')).toBeVisible();
}

/**
 * Department users (IT / Finance / line manager) have no case access by
 * design - they reach their released tasks through the work queue (J).
 */
async function completeTaskViaQueue(
  page: Page,
  caseNumber: string,
  title: string,
  note = 'Completed in the Stage 3 acceptance run.',
): Promise<void> {
  await page.goto(`/queue?view=all&q=${caseNumber}`);
  await page.getByRole('link', { name: title, exact: true }).first().click();
  await page.locator('details.action > summary', { hasText: 'Complete with evidence' }).click();
  await page.locator('#c-note').fill(note);
  await page.getByRole('button', { name: 'Complete task' }).click();
  await expect(page.getByText('Task completed with evidence.')).toBeVisible();
}

/**
 * Record a status/disposition on the FIRST actionable asset row. A dev-server
 * re-render can close the freshly opened <details>; retry until the select
 * inside an OPEN details is actually visible.
 */
async function recordFirstAssetDisposition(
  page: Page,
  status: string,
  reason?: string,
): Promise<void> {
  // The whole open-select-submit cycle retries: a late dev-server re-render
  // can reset the <details> disclosure mid-interaction.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await page.waitForLoadState('load');
      await page.waitForTimeout(600);
      const summary = page
        .locator('details.action > summary', { hasText: 'Record status / disposition' })
        .first();
      if ((await summary.count()) === 0) return; // nothing actionable left
      await summary.click({ timeout: 5000 });
      const details = page
        .locator('details[open]', { has: page.locator('select[name="status"]') })
        .first();
      await details.locator('select[name="status"]').selectOption(status, { timeout: 4000 });
      if (reason) {
        await details.locator('input[name="reason"]').fill(reason, { timeout: 4000 });
      }
      await details.getByRole('button', { name: 'Record', exact: true }).click({ timeout: 4000 });
      await expect(page.getByText(/Asset status recorded/)).toBeVisible({ timeout: 10_000 });
      return;
    } catch (e) {
      if (attempt === 3) throw e;
      await page.reload();
    }
  }
}

/** HR Manager reassigns a task to a named user from the task page. */
async function reassignTaskFromWorkflow(
  page: Page,
  caseUrl: string,
  title: string,
  assigneeLabel: string,
): Promise<void> {
  await page.goto(`${caseUrl}/workflow`);
  await page.getByRole('link', { name: title, exact: true }).click();
  await page.locator('details.action > summary', { hasText: 'Reassign task (HR Manager)' }).click();
  await page.locator('#r-user').selectOption({ label: assigneeLabel });
  await page.locator('#r-reason').fill('Assigning to the direct manager.');
  await page.getByRole('button', { name: 'Reassign' }).click();
  await expect(page.getByText('Task reassigned.')).toBeVisible();
}

test('Scenario 1 - resignation with notice: activate, work every department, clear, complete', async ({
  page,
}) => {
  test.setTimeout(600_000);

  // HR creates and routes the case; HR Manager approves and assigns the manager.
  await signInAs(page, 'Riley Okafor');
  const { url: caseUrl, number: caseNo } = await createTestCase(page, {
    employeeQuery: 'avery',
    type: 'RESIGNATION_WITH_NOTICE',
    confirmedLastDay: true,
  });
  await submitAndApprove(page, caseUrl);
  await addParticipantOnCase(page, caseUrl, 'Jamie Douglas', 'MANAGER');
  await completeAssignmentPlan(page, caseUrl);
  await signOut(page);

  // HR activates from the read-only preview (B.8): tasks, owners, due dates.
  await signInAs(page, 'Riley Okafor');
  await page.goto(`${caseUrl}/workflow`);
  await expect(page.getByText('Workflow preview (read-only, before activation)')).toBeVisible();
  await expect(page.getByText('EXACT TIME').first()).toBeVisible();
  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();

  // HR verification chain.
  await completeTaskFromWorkflow(page, caseUrl, 'Verify resignation and case information');
  await completeTaskFromWorkflow(page, caseUrl, 'Confirm proposed and final working dates');

  // Resignation document: draft + submit (officer), approve + render (manager).
  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Create resignation document draft' }).click();
  await expect(page.getByText('Draft document created')).toBeVisible();
  await page.getByRole('button', { name: 'Validate and submit for approval' }).click();
  await expect(page.getByText('Document submitted for HR Manager approval.')).toBeVisible();

  // Action form: HR section with the acknowledgement outcome.
  await page.goto(`${caseUrl}/action-form`);
  await page.getByRole('button', { name: 'Create action form' }).click();
  await expect(page.getByText('Action form draft created.')).toBeVisible();
  for (const key of [
    'caseInfoVerified',
    'evidenceRecorded',
    'contactVerified',
    'benefitsInitiated',
    'propertyProcessInitiated',
    'accessRemovalRecorded',
    'surveyEligibilityAssessed',
    'hrisUpdate',
  ]) {
    await page.locator(`#hr-${key}`).selectOption('DONE');
  }
  await page.locator('#ackStatus').selectOption('NOT_OBTAINED');
  await page.locator('#ackReason').fill('Employee unavailable for signature; recorded per policy.');
  await page.getByRole('button', { name: 'Save HR section' }).click();
  await expect(page.getByText('HR section saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Submit for manager approval' }).click();
  await expect(page.getByText('Form submitted for manager approval.')).toBeVisible();
  await completeTaskFromWorkflow(page, caseUrl, 'Complete employee action form HR section');
  await signOut(page);

  // HR Manager approves the letter (renders the controlled PDF).
  await signInAs(page, 'Dana Field');
  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Approve exact version (attested)' }).click();
  await expect(page.getByText('Document approved; the final PDF has been rendered.')).toBeVisible();
  await reassignTaskFromWorkflow(
    page,
    caseUrl,
    'Approve the action form (manager)',
    'Jamie Douglas (LINE_MANAGER)',
  );
  await signOut(page);

  // The line manager: handover record, form approval, duty reassignment.
  await signInAs(page, 'Jamie Douglas');
  await page.goto(`${caseUrl}/handover`);
  await expect(
    page.getByText(/Do not enter passwords, access codes, private keys/).first(),
  ).toBeVisible();
  await page.locator('#ho-dutiesToReassign').fill('Parts counter scheduling and escalations.');
  await page.locator('#ho-openWorkDeadlines').fill('August stock count preparation.');
  await page.locator('#ho-replacementOwner').fill('Interim owner: warehouse coordinator.');
  await page.getByRole('button', { name: 'Save handover record' }).click();
  await expect(page.getByText('Handover record saved.')).toBeVisible();
  await page
    .locator('details.action > summary', { hasText: 'Complete handover (manager attestation)' })
    .click();
  await page.getByRole('button', { name: 'Complete with attestation' }).click();
  await expect(page.getByText('Handover completed with manager attestation.')).toBeVisible();

  await page.goto(`${caseUrl}/action-form`);
  await page.getByRole('button', { name: 'Approve as responsible manager (attested)' }).click();
  await expect(page.getByText('Manager approval recorded (attested).')).toBeVisible();
  await completeTaskViaQueue(page, caseNo, 'Approve the action form (manager)');
  await signOut(page);

  // Manager duties task released by the handover plan; assign then complete.
  await signInAs(page, 'Dana Field');
  await page.goto(`${caseUrl}/action-form`);
  await page.getByRole('button', { name: /Give HR final approval/ }).click();
  await expect(page.getByText(/HR final approval recorded/)).toBeVisible();
  await reassignTaskFromWorkflow(
    page,
    caseUrl,
    'Reassign open duties and deadlines',
    'Jamie Douglas (LINE_MANAGER)',
  );
  await completeTaskFromWorkflow(page, caseUrl, 'Approve the final action form');
  await signOut(page);

  await signInAs(page, 'Jamie Douglas');
  await completeTaskViaQueue(page, caseNo, 'Reassign open duties and deadlines');
  await signOut(page);

  // IT: review, then the exact-time revocation with recorded early authority.
  await signInAs(page, 'Sam Chen');
  await completeTaskViaQueue(page, caseNo, 'Review systems and access requiring removal');
  await page.goto(`/queue?view=all&q=${caseNo}`);
  await page
    .getByRole('link', { name: 'Revoke system access at the effective separation time' })
    .first()
    .click();
  await expect(page.getByText('Exact-time access revocation')).toBeVisible();
  await page.locator('#acc-note').fill('All listed access removed; evidence ticket IT-TEST-77.');
  await page
    .locator('#acc-early')
    .fill('HR Manager approved early removal for the acceptance run.');
  await page.getByRole('button', { name: 'Record completion' }).click();
  await expect(page.getByText(/Access revocation recorded: COMPLETED_EARLY/)).toBeVisible();
  await signOut(page);

  // Finance: acknowledgement and the external workpaper records.
  await signInAs(page, 'Alex Romero');
  await completeTaskViaQueue(page, caseNo, 'Acknowledge offboarding case');
  await completeTaskViaQueue(page, caseNo, 'Initiate external final-pay workpaper');
  await completeTaskViaQueue(
    page,
    caseNo,
    'Record external final-pay workpaper completion',
    'Workpaper completed OUTSIDE the application; reference FIN-TEST-9.',
  );
  await signOut(page);

  // HR: benefits applicability, notifications, assets, HRIS and survey tasks.
  await signInAs(page, 'Riley Okafor');
  await completeTaskFromWorkflow(page, caseUrl, 'Determine Sagicor group-health applicability');
  await completeTaskFromWorkflow(page, caseUrl, 'Determine NCB group-life applicability');
  await completeTaskFromWorkflow(
    page,
    caseUrl,
    'Prepare applicable external-provider notifications',
    'Neither provider applicable for this synthetic employee.',
  );
  await completeTaskFromWorkflow(
    page,
    caseUrl,
    'Prepare and approve resignation acceptance document',
    'Letter approved and rendered on the Documents tab.',
  );
  await completeTaskFromWorkflow(page, caseUrl, 'Confirm employee-issued asset list');

  // Assets: every required item receives a final documented disposition.
  await page.goto(`${caseUrl}/assets`);
  for (let i = 0; i < 3; i++) {
    await recordFirstAssetDisposition(page, 'RETURNED');
  }
  await expect(page.getByText('Disposition documentation rate')).toBeVisible();

  await completeTaskFromWorkflow(page, caseUrl, 'Complete asset recovery or final disposition');
  await completeTaskFromWorkflow(page, caseUrl, 'Complete employee acknowledgement handling');
  await completeTaskFromWorkflow(page, caseUrl, 'Record HRIS/BambooHR update status');
  await completeTaskFromWorkflow(page, caseUrl, 'Assess survey eligibility');

  // Clearance: every gate condition met; HR requests, HR Manager approves.
  await page.goto(`${caseUrl}/clearance`);
  await expect(page.getByText('ALL CONDITIONS MET')).toBeVisible();
  await expect(page.getByText(/never\s+blocks clearance/i)).toBeVisible();
  await page.getByRole('button', { name: 'Request clearance review' }).click();
  await expect(page.getByText(/Case moved to clearance review/)).toBeVisible();
  await signOut(page);

  await signInAs(page, 'Dana Field');
  await page.goto(`${caseUrl}/clearance`);
  await page.getByRole('button', { name: 'Approve final clearance' }).click();
  await expect(page.getByText(/Final clearance approved/)).toBeVisible();
  await expect(page.getByText('Clearance records (immutable)')).toBeVisible();
  await page.goto(caseUrl);
  await expect(page.getByText('Completed').first()).toBeVisible();
  await signOut(page);
});

test('Scenario 2 - immediate resignation: urgent tasks, overdue access, blocked clearance', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, 'Riley Okafor');
  const { url: caseUrl } = await createTestCase(page, {
    employeeQuery: 'casey',
    type: 'IMMEDIATE_RESIGNATION',
    receivedAt: '2026-07-28T09:30',
    effectiveAt: '2026-07-28T14:00', // already past: revocation immediately overdue (G.2)
  });
  await submitAndApprove(page, caseUrl);
  await completeAssignmentPlan(page, caseUrl);
  await signOut(page);

  await signInAs(page, 'Riley Okafor');
  await page.goto(`${caseUrl}/workflow`);
  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();
  // Security-critical tasks are released immediately and already overdue.
  await expect(page.getByText('Urgent HR case review')).toBeVisible();
  await expect(page.getByText('OVERDUE').first()).toBeVisible();

  // The acknowledgement outcome uses NOT_OBTAINED with a reason.
  await page.goto(`${caseUrl}/action-form`);
  await page.getByRole('button', { name: 'Create action form' }).click();
  await page.locator('#ackStatus').selectOption('NOT_OBTAINED');
  await page
    .locator('#ackReason')
    .fill('Employee left immediately; acknowledgement not obtainable.');
  await page.getByRole('button', { name: 'Save HR section' }).click();
  await expect(page.getByText('HR section saved.')).toBeVisible();
  await signOut(page);

  // IT sees the critical overdue task in its queue.
  await signInAs(page, 'Sam Chen');
  await page.goto('/queue?view=criticalOverdue');
  await expect(
    page.getByRole('link', { name: 'Immediate or exact-time access revocation' }).first(),
  ).toBeVisible();
  await signOut(page);

  // Handover is manager-recorded or HR-Manager waived (G.11).
  await signInAs(page, 'Dana Field');
  await page.goto(`${caseUrl}/handover`);
  await page
    .locator('details.action > summary', { hasText: 'Waive handover (HR Manager)' })
    .click();
  await page
    .locator('#wv-reason')
    .fill('No open duties; waiver approved for the urgent departure.');
  await page.getByRole('button', { name: 'Waive handover' }).click();
  await expect(page.getByText(/Handover waived by HR Manager/)).toBeVisible();

  // Clearance stays blocked while mandatory tasks are unresolved.
  await page.goto(`${caseUrl}/clearance`);
  await expect(page.getByText('NOT READY')).toBeVisible();
  await expect(page.getByText('BLOCKED').first()).toBeVisible();
  await page.getByRole('button', { name: 'Request clearance review' }).click();
  await expect(page.getByText('There is a problem')).toBeVisible();
  await signOut(page);
});

test('Scenario 3 - restricted termination: undiscoverable, minimum-data IT task, no letter, no survey', async ({
  page,
}) => {
  test.setTimeout(240_000);
  // The HR Manager runs the restricted case (explicit participation only).
  await signInAs(page, 'Dana Field');
  const soon = new Date(Date.now() + 30 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const effectiveLocal = `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}T${pad(soon.getHours())}:${pad(soon.getMinutes())}`;
  const { url: caseUrl, number: caseNo } = await createTestCase(page, {
    employeeQuery: 'morgan',
    type: 'TERMINATION',
    receivedAt: '2026-07-28T09:30',
    effectiveAt: effectiveLocal,
  });
  await page.goto(caseUrl);
  await page.getByRole('button', { name: 'Submit for HR review' }).click();
  await expect(page.getByText('Case submitted for HR review.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve case and capture snapshot' }).click();
  await expect(page.getByText(/Case approved/)).toBeVisible();
  // Restricted case: the manager keeps operational ownership herself so the
  // non-participant discovery assertions below stay meaningful.
  await completeAssignmentPlan(page, caseUrl, 'Dana Field');
  await page.goto(`${caseUrl}/workflow`);
  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();
  // H.11: no survey task exists in the restricted workflow.
  await expect(page.getByRole('link', { name: /survey eligibility/i })).toHaveCount(0);
  await expect(page.getByText('Assess survey eligibility')).toHaveCount(0);
  // H.1/H.2: no termination letter path exists.
  await page.goto(`${caseUrl}/documents`);
  await expect(page.getByRole('button', { name: /Create resignation document draft/ })).toHaveCount(
    0,
  );

  // Complete the restricted HR chain so the access task releases (-1h rule).
  await completeTaskFromWorkflow(page, caseUrl, 'Restricted HR preparation');
  await completeTaskFromWorkflow(page, caseUrl, 'Authorized HR Manager approval');
  await completeTaskFromWorkflow(page, caseUrl, 'Confirm exact effective separation date and time');
  await signOut(page);

  // A non-participant HR officer cannot discover the case anywhere (H.3).
  await signInAs(page, 'Riley Okafor');
  await page.goto(caseUrl);
  await expect(page.getByText('Page or record not found')).toBeVisible();
  await page.goto('/queue');
  await expect(page.getByText('Morgan Reed')).toHaveCount(0);
  await page.goto('/exceptions');
  await expect(page.getByText('Morgan Reed')).toHaveCount(0);
  await signOut(page);

  // IT receives ONLY the minimum-data access task (H.4): no departure type,
  // no case link, but the identity needed to act.
  await signInAs(page, 'Sam Chen');
  await page.goto(`/queue?view=all&q=${caseNo}`);
  await expect(page.getByText('TERMINATION')).toHaveCount(0);
  await page
    .getByRole('link', { name: 'Revoke system access at the effective time' })
    .first()
    .click();
  await expect(page.getByText('Morgan Reed')).toBeVisible();
  await expect(page.getByText('Restricted').first()).toBeVisible();
  await expect(page.getByText('TERMINATION')).toHaveCount(0);
  await expect(page.getByText('Departure type')).toHaveCount(0);
  await signOut(page);
});

test('Scenario 4 - exception handling: blocker raised, escalated, HR resolves with audit history', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, 'Riley Okafor');
  const { url: caseUrl, number: caseNo } = await createTestCase(page, {
    employeeQuery: 'taylor',
    type: 'IMMEDIATE_RESIGNATION',
    receivedAt: '2026-07-28T09:30',
    effectiveAt: '2026-07-28T14:00',
  });
  await submitAndApprove(page, caseUrl);
  await completeAssignmentPlan(page, caseUrl);
  await signOut(page);
  await signInAs(page, 'Riley Okafor');
  await page.goto(`${caseUrl}/workflow`);
  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();
  await signOut(page);

  // IT records partial completion: one system cannot be removed (I.10).
  await signInAs(page, 'Sam Chen');
  await page.goto(`/queue?view=all&q=${caseNo}`);
  await page
    .getByRole('link', { name: 'Immediate or exact-time access revocation' })
    .first()
    .click();
  await page.locator('#acc-unres').fill('Building access');
  await page.locator('#acc-note').fill('Door controller offline; incident raised.');
  await page.locator('#acc-incident').fill('INC-TEST-42');
  await page.getByRole('button', { name: 'Record completion' }).click();
  await expect(page.getByText(/Partial completion recorded/)).toBeVisible();
  await signOut(page);

  // The CRITICAL exception appears in the HR exception feed.
  await signInAs(page, 'Dana Field');
  await page.goto('/exceptions?status=OPEN&severity=CRITICAL');
  await expect(page.getByText(/Access revocation incomplete/).first()).toBeVisible();

  // HR Manager resolves it as an approved security exception (audited).
  await page.goto(`${caseUrl}/clearance`);
  await page.locator('details.action > summary', { hasText: 'Resolve' }).first().click();
  await page
    .locator('textarea[name="resolution"]')
    .first()
    .fill('Door controller isolated from the network; residual risk accepted.');
  await page.locator('input[name="securityException"]').first().check();
  await page.getByRole('button', { name: 'Resolve exception' }).click();
  await expect(page.getByText('Exception resolved.')).toBeVisible();

  // Creation and resolution both remain visible in the history.
  await page.goto('/exceptions?status=RESOLVED');
  await expect(page.getByText(/Access revocation incomplete/).first()).toBeVisible();
  await expect(page.getByText(/security exception/).first()).toBeVisible();
  await signOut(page);
});

test('Scenario 5 - asset exception: lost/unresolved assets, no pay effect, distinct measures', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, 'Riley Okafor');
  const { url: caseUrl } = await createTestCase(page, {
    employeeQuery: 'jordan',
    type: 'RESIGNATION_WITH_NOTICE',
    confirmedLastDay: true,
  });
  await submitAndApprove(page, caseUrl);
  await completeAssignmentPlan(page, caseUrl);
  await signOut(page);
  await signInAs(page, 'Riley Okafor');
  await page.goto(`${caseUrl}/workflow`);
  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();

  await page.goto(`${caseUrl}/assets`);
  // The recovery list came from the issued-asset records (EMP-TEST-002).
  await expect(page.getByText('Warehouse keys')).toBeVisible();
  await expect(page.getByText(/NEVER creates a payroll instruction/i)).toBeVisible();

  // One asset returned; one lost WITH a documented reason (L.4).
  await recordFirstAssetDisposition(page, 'RETURNED');
  await recordFirstAssetDisposition(
    page,
    'LOST',
    'Employee reports the access card was lost in June.',
  );

  // Documentation and physical recovery remain DISTINCT measures (L.1).
  await expect(page.getByText('Disposition documentation rate')).toBeVisible();
  await expect(page.getByText('Physical recovery rate')).toBeVisible();
  await expect(page.getByText(/NOT_ISSUED excluded/)).toBeVisible();
  // No pay/amount input exists anywhere on the asset surface (default 18).
  await expect(page.locator('input[name*="amount" i], input[name*="pay" i]')).toHaveCount(0);
  await expect(page.getByText('$')).toHaveCount(0);
  await signOut(page);

  // The lost-asset review exception is visible to HR with no pay instruction.
  await signInAs(page, 'Dana Field');
  await page.goto('/exceptions?status=OPEN');
  await expect(page.getByText(/Asset lost/).first()).toBeVisible();
  await expect(page.getByText(/no payroll instruction/).first()).toBeVisible();
  await signOut(page);
});
