/**
 * Stage 3 acceptance scenarios (Directive 3 section T), rewritten for the
 * Directive 6.3 HR-validated workflow (v2): IT and Finance participate through
 * automated controlled email notifications (visible on the case "Email
 * actions" tab and in the development mailbox) instead of application logins,
 * and the Action Form is completed by the assigned HR Officer - no manager
 * approval step exists. Cases are real operational records (final-product mode); email stays in the dev capture mailbox.
 * identities only.
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
): Promise<{ url: string; number: string }> {
  await page.goto('/cases/new');
  await page.getByLabel('Employee Name or Number').fill(opts.employeeQuery);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page.getByLabel('Departure Type').selectOption(opts.type);
  await page.getByLabel('Date and Time Received').fill(opts.receivedAt ?? '2026-07-20T09:30');
  // A resignation with notice ends at close of business on the final working
  // date, so the platform derives the instant and the field is not offered.
  if (opts.type === 'RESIGNATION_WITH_NOTICE') {
    await page.getByLabel('Final Working Date').fill('2026-08-14');
  } else {
    if (opts.confirmedLastDay) {
      await page.getByLabel('Final Working Date').fill('2026-08-14');
    }
    await page.getByLabel(/Employment Ends/).fill(opts.effectiveAt ?? '2026-08-14T17:00');
  }
  await page.getByRole('button', { name: 'Create draft case' }).click();
  const banner = page.getByText(/Draft case OFF-\d{4}-\d{4,}(?:-\d)? created/);
  await expect(banner).toBeVisible();
  const number = /OFF-\d{4}-\d{4,}(?:-\d)?/.exec((await banner.textContent()) ?? '')![0];
  return { url: page.url().split('?')[0]!, number };
}

async function submitAndApprove(page: Page, caseUrl: string): Promise<void> {
  await page.goto(caseUrl);
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Case submitted for review.')).toBeVisible();
  await signOut(page);
  await signInAs(page, 'HR Manager');
  await page.goto(caseUrl);
  await page.getByRole('button', { name: 'Approve case and capture snapshot' }).click();
  await expect(page.getByText(/Case approved/)).toBeVisible();
}

/** Directive 6.1: activation requires the assignment plan (run as HR Manager). */
async function completeAssignmentPlan(
  page: Page,
  caseUrl: string,
  officerLabel = 'HR Officer',
): Promise<void> {
  await page.goto(`${caseUrl}/assignment`);
  await page.locator('details.action > summary', { hasText: 'Assign HR Officer' }).click();
  // Directive 6.3 correction 7: options read "<name> - <job title>", so pick
  // the option by its name fragment rather than an exact label.
  const officerValue = await page
    .locator('#of-user option', { hasText: officerLabel })
    .first()
    .getAttribute('value');
  await page.locator('#of-user').selectOption(officerValue!);
  await page.locator('#of-reason').fill('E2E assignment.');
  await page.getByRole('button', { name: 'Assign officer' }).click();
  await expect(page.getByText('HR Officer assigned (audited).')).toBeVisible();
  await page.locator('details.action > summary', { hasText: 'Assign alternate manager' }).click();
  await page.locator('#am-user').selectOption({ index: 1 });
  await page.locator('#am-reason').fill('E2E manager routing.');
  await page.getByRole('button', { name: 'Record alternate manager' }).click();
  await expect(page.getByText('Alternate manager recorded')).toBeVisible();
  for (const box of await page.locator('input[name="confirmations"]').all()) {
    if (!(await box.isChecked())) await box.check();
  }
  await page.getByRole('button', { name: 'Confirm assignment plan' }).click();
  await expect(page.getByText('Assignment plan confirmed').first()).toBeVisible();
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
        .locator('details.action > summary', { hasText: 'Record outcome' })
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

/**
 * Directive 6.3 S: release every email action waiting on HR review from the
 * case "Email actions" tab. Records that were auto-released have no button
 * and are left alone.
 */
async function releaseWaitingEmailActions(page: Page, caseUrl: string): Promise<void> {
  await page.goto(`${caseUrl}/notifications`);
  for (let i = 0; i < 6; i++) {
    const release = page.getByRole('button', { name: /Review and release/ }).first();
    if ((await release.count()) === 0) break;
    await release.click();
    await expect(
      page.getByText(/Released\. Sending and confirmation are tracked automatically\./),
    ).toBeVisible();
  }
}

/** Business-language email-action statuses (Directive 6.3 correction 7). */
const BUSINESS_STATUS =
  /Scheduled|Sent|Needs your review|Recipient required|Being prepared|Acknowledged|Completed|Sent manually/;

test('Scenario 1 - resignation with notice: activate, HR journey, email evidence, clear, complete', async ({
  page,
}) => {
  test.setTimeout(600_000);

  // HR creates and routes the case; HR Manager approves and assigns the manager.
  await signInAs(page, 'HR Officer');
  const { url: caseUrl, number: caseNo } = await createTestCase(page, {
    employeeQuery: 'avery',
    type: 'RESIGNATION_WITH_NOTICE',
    confirmedLastDay: true,
  });
  await submitAndApprove(page, caseUrl);
  // The assignment plan routes manager work: activation auto-adds the
  // recorded manager as a participant (no manual participant step exists).
  await completeAssignmentPlan(page, caseUrl);
  await signOut(page);

  // HR activates from the read-only preview (B.8): tasks, owners, due dates.
  await signInAs(page, 'HR Officer');
  await page.goto(`${caseUrl}/workflow`);
  await expect(page.getByText('Workflow Preview (Read-only, Before Activation)')).toBeVisible();
  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();

  // Directive 6.3: activation derives the IT and Finance email actions - no
  // department logins exist. The rows carry business-language statuses.
  await page.goto(`${caseUrl}/notifications`);
  await expect(page.getByRole('heading', { name: /Email Actions/ })).toBeVisible();
  const itAction = page.locator('section[aria-label="IT access removal email action"]');
  await expect(itAction.first()).toBeVisible();
  await expect(itAction.first().locator('.badge').first()).toHaveText(BUSINESS_STATUS);
  await expect(
    page.locator('section[aria-label="Finance offboarding email action"]').first(),
  ).toBeVisible();
  await releaseWaitingEmailActions(page, caseUrl);

  // HR verification chain.
  await completeTaskFromWorkflow(page, caseUrl, 'Verify resignation and case information');
  await completeTaskFromWorkflow(page, caseUrl, 'Confirm proposed and final working dates');

  // Resignation document: draft + submit (officer), approve + render (manager).
  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Create resignation document draft' }).click();
  await expect(page.getByText('Draft document created')).toBeVisible();
  // The acceptance letter is addressed, so HR types the address from the
  // resignation letter scan before submitting (DEC-054).
  await page.getByLabel('Employee Address').fill('12 Synthetic Avenue, Kingston 5');
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByText(/Address recorded/)).toBeVisible();
  await page.getByRole('button', { name: 'Refresh fields from case' }).click();
  await page.getByRole('button', { name: 'Validate and submit for approval' }).click();
  await expect(page.getByText('Document submitted for HR Manager approval.')).toBeVisible();

  // Directive 6.3 V: one benefits confirmation feeds the provider rules.
  await page.goto(caseUrl);
  // The confirm form opens itself while a benefit is undecided; toggle it
  // open only when it is not already.
  {
    const benefitsDetails = page.locator('details.action', {
      has: page.locator('summary', { hasText: 'Confirm which benefits apply' }),
    });
    if (!(await benefitsDetails.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await benefitsDetails.locator('summary').click();
    }
  }
  await page.locator('#ben-health').selectOption('NO');
  await page.locator('#ben-life').selectOption('NO');
  await page.getByRole('button', { name: 'Confirm applicability' }).click();
  await expect(page.getByText(/Benefits applicability confirmed/)).toBeVisible();
  await completeTaskFromWorkflow(page, caseUrl, 'Confirm benefits and provider applicability');

  // Action form: the officer prepares, finishes and completes it (attested) -
  // no manager approval step exists (Directive 6.3 D).
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
    await page.locator(`#hr-${key}-DONE`).check();
  }
  await page.locator('#ackStatus').selectOption('NOT_OBTAINED');
  await page.locator('#ackReason').fill('Employee unavailable for signature; recorded per policy.');
  await page.getByRole('button', { name: 'Save HR section' }).click();
  await expect(page.getByText('HR section saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Finish preparation (ready for review)' }).click();
  await expect(page.getByText('Form finished and ready for review.')).toBeVisible();
  await page
    .getByRole('button', { name: 'Complete action form (attested, renders final PDF)' })
    .click();
  await expect(page.getByText(/Action form completed/)).toBeVisible();
  await completeTaskFromWorkflow(page, caseUrl, 'Complete employee action form HR section');
  await signOut(page);

  // HR Manager approves the letter (renders the controlled PDF), then runs
  // the outbox pass: the internal emails are CAPTURED locally, never
  // represented as delivered.
  await signInAs(page, 'HR Manager');
  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Approve exact version (attested)' }).click();
  await expect(page.getByText('Document approved; the final PDF has been rendered.')).toBeVisible();
  // The background worker may legitimately drain the queue first, so the
  // manual pass can submit 0; the capture evidence for THIS case is the
  // invariant (CAPTURED locally, never DELIVERED).
  await page.goto('/admin/outbox');
  await page.getByRole('button', { name: 'Run outbox pass now' }).click();
  await expect(page.getByText(/Outbox pass: \d+ submitted/)).toBeVisible();
  await expect(
    page.locator('tbody tr', { hasText: caseNo }).filter({ hasText: 'CAPTURED' }).first(),
  ).toBeVisible();
  await expect(page.locator('tbody .badge', { hasText: 'DELIVERED' })).toHaveCount(0);

  // IT evidence (Directive 6.3 T/AA): delivery is not completion - HR records
  // the completion evidence the department returned outside the application.
  await page.goto(`${caseUrl}/notifications`);
  const itSent = page.locator('section[aria-label="IT access removal email action"]').first();
  await expect(itSent.locator('.badge').first()).toHaveText(/Sent/);
  await itSent.locator('details.action > summary', { hasText: 'Record evidence' }).click();
  await itSent.locator('select[name="kind"]').selectOption('COMPLETED');
  await itSent
    .locator('textarea[name="note"]')
    .fill('IT confirmed by email: all listed access removed; ticket IT-TEST-77.');
  await itSent.getByRole('button', { name: 'Record evidence' }).click();
  await expect(page.getByText('Completion evidence recorded.')).toBeVisible();
  await signOut(page);

  // HR: document task, assets, acknowledgement and HRIS tasks.
  await signInAs(page, 'HR Officer');

  // The line manager holds no login and no task: the platform simply tells
  // them their team member is leaving (owner decision, 2026-08-19).
  await page.goto(`${caseUrl}/notifications`);
  await expect(page.getByText(/departure notice/i).first()).toBeVisible();
  await completeTaskFromWorkflow(
    page,
    caseUrl,
    'Prepare and approve resignation acceptance document',
    'Letter approved and rendered on the Documents tab.',
  );

  // Assets: every required item receives a final documented disposition.
  await page.goto(`${caseUrl}/assets`);
  for (let i = 0; i < 3; i++) {
    await recordFirstAssetDisposition(page, 'RETURNED');
  }
  await expect(page.getByText('Disposition Documentation Rate')).toBeVisible();

  await completeTaskFromWorkflow(page, caseUrl, 'Complete asset recovery or final disposition');
  await completeTaskFromWorkflow(page, caseUrl, 'Complete employee acknowledgement handling');
  await completeTaskFromWorkflow(page, caseUrl, 'Record HRIS/BambooHR update status');

  // Clearance: every gate condition met; HR requests, HR Manager approves.
  await page.goto(`${caseUrl}/clearance`);
  await expect(page.getByText('All conditions met')).toBeVisible();
  await expect(page.getByText(/never\s+blocks clearance/i)).toBeVisible();
  await page.getByRole('button', { name: 'Request clearance review' }).click();
  await expect(page.getByText(/Case moved to clearance review/)).toBeVisible();
  await signOut(page);

  await signInAs(page, 'HR Manager');
  await page.goto(`${caseUrl}/clearance`);
  await page.getByRole('button', { name: 'Approve final clearance' }).click();
  await expect(page.getByText(/Final clearance approved/)).toBeVisible();
  await expect(page.getByText('Clearance Records')).toBeVisible();
  await page.goto(caseUrl);
  await expect(page.getByText('Completed').first()).toBeVisible();
  await signOut(page);
});

test('Scenario 2 - immediate resignation: urgent tasks, automated IT email, blocked clearance', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, 'HR Officer');
  const { url: caseUrl } = await createTestCase(page, {
    employeeQuery: 'casey',
    type: 'IMMEDIATE_RESIGNATION',
    receivedAt: '2026-07-28T09:30',
    effectiveAt: '2026-07-28T14:00', // already past: the IT email is urgent (G.2)
  });
  await submitAndApprove(page, caseUrl);
  await completeAssignmentPlan(page, caseUrl);
  await signOut(page);

  await signInAs(page, 'HR Officer');
  await page.goto(`${caseUrl}/workflow`);
  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();
  // The urgent HR review task is released immediately.
  await expect(page.getByText('Urgent HR case review')).toBeVisible();

  // Directive 6.3: no IT login works this case - the derived IT access-removal
  // email action carries the obligation, in business language.
  await page.goto(`${caseUrl}/notifications`);
  const itAction = page.locator('section[aria-label="IT access removal email action"]').first();
  await expect(itAction).toBeVisible();
  await expect(itAction.locator('.badge').first()).toHaveText(
    /Scheduled|Sent|Needs your review|Recipient required/,
  );

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

  await signInAs(page, 'HR Manager');
  // Clearance stays blocked while mandatory work is unresolved (including the
  // unconfirmed IT email evidence - delivery is not completion).
  await page.goto(`${caseUrl}/clearance`);
  await expect(page.getByText('Not ready')).toBeVisible();
  await expect(page.getByText('BLOCKED').first()).toBeVisible();
  await page.getByRole('button', { name: 'Request clearance review' }).click();
  await expect(page.getByText('There Is a Problem')).toBeVisible();
  await signOut(page);
});

test('Scenario 3 - restricted termination: undiscoverable, minimum-data IT email, no letter, no survey', async ({
  page,
}) => {
  test.setTimeout(240_000);
  // The HR Manager runs the restricted case (explicit participation only).
  await signInAs(page, 'HR Manager');
  const soon = new Date(Date.now() + 30 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const effectiveLocal = `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}T${pad(soon.getHours())}:${pad(soon.getMinutes())}`;
  const { url: caseUrl } = await createTestCase(page, {
    employeeQuery: 'morgan',
    type: 'TERMINATION',
    receivedAt: '2026-07-28T09:30',
    effectiveAt: effectiveLocal,
  });
  await page.goto(caseUrl);
  // The reviewer approves her own draft in one audited step - no
  // submit-to-self detour (owner, 2026-08-25).
  await page.getByRole('button', { name: 'Approve case and capture snapshot' }).click();
  await expect(page.getByText(/Case approved/)).toBeVisible();
  // Restricted case: the manager keeps operational ownership herself so the
  // non-participant discovery assertions below stay meaningful.
  await completeAssignmentPlan(page, caseUrl, 'HR Manager');
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

  // Complete the restricted HR chain (all tasks are confidential HR work).
  await completeTaskFromWorkflow(page, caseUrl, 'Restricted HR preparation');
  await completeTaskFromWorkflow(page, caseUrl, 'Authorized HR Manager approval');
  await completeTaskFromWorkflow(page, caseUrl, 'Confirm exact effective separation date and time');

  // Directive 6.3 H.4/U: IT is reached ONLY by the derived minimum-data email
  // (exact effective time, no departure type, no reason) - never a login. The
  // restricted control level holds the email for an HR Manager release.
  await page.goto(`${caseUrl}/notifications`);
  const itAction = page.locator('section[aria-label="IT access removal email action"]').first();
  await expect(itAction).toBeVisible();
  await expect(itAction.locator('.badge').first()).toHaveText(
    /Needs your review|Scheduled|Sent|Recipient required/,
  );
  await expect(page.getByText('TERMINATION')).toHaveCount(0);
  await expect(page.getByText('Departure Type')).toHaveCount(0);
  await signOut(page);

  // A non-participant HR officer cannot discover the case anywhere (H.3).
  await signInAs(page, 'HR Officer');
  await page.goto(caseUrl);
  await expect(page.getByText('Page or Record Not Found')).toBeVisible();
  await page.goto('/queue');
  await expect(page.getByText('Morgan Reed')).toHaveCount(0);
  await page.goto('/exceptions');
  await expect(page.getByText('Morgan Reed')).toHaveCount(0);
  await signOut(page);
});

test('Scenario 4 - exception handling: lost asset raised, visible to HR, resolved with audit history', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, 'HR Officer');
  const { url: caseUrl, number: caseNo } = await createTestCase(page, {
    employeeQuery: 'jordan',
    type: 'IMMEDIATE_RESIGNATION',
    receivedAt: '2026-07-28T09:30',
    effectiveAt: '2026-07-28T14:00',
  });
  await submitAndApprove(page, caseUrl);
  await completeAssignmentPlan(page, caseUrl);
  await signOut(page);
  await signInAs(page, 'HR Officer');
  await page.goto(`${caseUrl}/workflow`);
  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();

  // A lost asset opens a review exception (L.7) - with no payroll effect.
  await page.goto(`${caseUrl}/assets`);
  await recordFirstAssetDisposition(
    page,
    'LOST',
    'Employee reports the item was lost; incident raised.',
  );
  await signOut(page);

  // The exception appears in the HR exception feed for THIS case.
  await signInAs(page, 'HR Manager');
  await page.goto('/exceptions?status=OPEN');
  const openRow = page
    .locator('tr', { hasText: caseNo })
    .filter({ hasText: /Asset lost/ })
    .first();
  await expect(openRow).toBeVisible();
  await expect(openRow.getByText(/no payroll instruction/)).toBeVisible();

  // HR Manager resolves it directly from the feed (audited).
  await openRow.locator('details.action > summary', { hasText: 'Resolve' }).click();
  await openRow
    .locator('textarea[name="resolution"]')
    .fill('Replacement issued from stock; loss recorded with no payroll effect.');
  await openRow.getByRole('button', { name: 'Resolve exception' }).click();
  await expect(page.getByText('Exception resolved (audited).')).toBeVisible();

  // Creation and resolution both remain visible in the history.
  await page.goto('/exceptions?status=RESOLVED');
  const resolvedRow = page
    .locator('tr', { hasText: caseNo })
    .filter({ hasText: /Asset lost/ })
    .first();
  await expect(resolvedRow).toBeVisible();
  await expect(resolvedRow.getByText(/Resolved:/)).toBeVisible();
  await signOut(page);
});

test('Scenario 5 - asset exception: lost/unresolved assets, no pay effect, distinct measures', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, 'HR Officer');
  const { url: caseUrl } = await createTestCase(page, {
    employeeQuery: 'jordan',
    type: 'RESIGNATION_WITH_NOTICE',
    confirmedLastDay: true,
  });
  await submitAndApprove(page, caseUrl);
  await completeAssignmentPlan(page, caseUrl);
  await signOut(page);
  await signInAs(page, 'HR Officer');
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
  await expect(page.getByText('Disposition Documentation Rate')).toBeVisible();
  await expect(page.getByText('Physical Recovery Rate')).toBeVisible();
  await expect(page.getByText(/NOT_ISSUED excluded/)).toBeVisible();
  // No pay/amount input exists anywhere on the asset surface (default 18).
  await expect(page.locator('input[name*="amount" i], input[name*="pay" i]')).toHaveCount(0);
  await expect(page.getByText('$')).toHaveCount(0);
  await signOut(page);

  // The lost-asset review exception is visible to HR with no pay instruction.
  await signInAs(page, 'HR Manager');
  await page.goto('/exceptions?status=OPEN');
  await expect(page.getByText(/Asset lost/).first()).toBeVisible();
  await expect(page.getByText(/no payroll instruction/).first()).toBeVisible();
  await signOut(page);
});
