/**
 * Stage 4 acceptance scenarios (Directive 4 section X: Scenarios 1-7).
 * TEST records + synthetic providers only; nothing leaves the machine.
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

async function createTestCase(
  page: Page,
  opts: { employeeQuery: string; type: string },
): Promise<{ url: string; number: string }> {
  await page.goto('/cases/new');
  await page.getByLabel('Employee Name or Number').fill(opts.employeeQuery);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page.getByLabel('Departure Type').selectOption(opts.type);
  await page.getByLabel('Date and Time Received').fill('2026-07-21T09:30');
  await page.getByLabel('Final Working Date').fill('2026-08-14');
  // A resignation with notice ends at close of business on the final working
  // date, so the platform derives the instant and the field is not offered.
  if (opts.type !== 'RESIGNATION_WITH_NOTICE') {
    await page.getByLabel(/Employment Ends/).fill('2026-08-14T17:00');
  }
  await page.getByRole('button', { name: 'Create draft case' }).click();
  const banner = page.getByText(/Draft case OFF-\d{4}-\d{4,}(?:-\d)? created/);
  await expect(banner).toBeVisible();
  const number = /OFF-\d{4}-\d{4,}(?:-\d)?/.exec((await banner.textContent()) ?? '')![0];
  return { url: page.url().split('?')[0]!, number };
}

test('Scenario 1 - notification delivery through development capture', async ({ page }) => {
  test.setTimeout(300_000);
  // HR builds an ACTIVE TEST case; activation derives the IT notification.
  await signInAs(page, 'HR Officer');
  const { url: caseUrl, number: caseNo } = await createTestCase(page, {
    employeeQuery: 'avery',
    type: 'RESIGNATION_WITH_NOTICE',
  });
  await page.goto(caseUrl);
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Case submitted for review.')).toBeVisible();
  await signOut(page);
  await signInAs(page, 'HR Manager');
  await page.goto(caseUrl);
  await page.getByRole('button', { name: 'Approve case and capture snapshot' }).click();
  await expect(page.getByText(/Case approved/)).toBeVisible();
  await completeAssignmentPlan(page, caseUrl);
  await page.goto(`${caseUrl}/workflow`);
  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();

  // Directive 6.3: the IT access-removal email is DERIVED automatically at
  // activation (no manual preparation). Release any action still waiting on
  // review so the outbox has work to capture.
  await page.goto(`${caseUrl}/notifications`);
  await expect(
    page.locator('section[aria-label="IT access removal email action"]').first(),
  ).toBeVisible();
  for (let i = 0; i < 6; i++) {
    const release = page.getByRole('button', { name: /Review and release/ }).first();
    if ((await release.count()) === 0) break;
    await release.click();
    await expect(
      page.getByText(/Released\. Sending and confirmation are tracked automatically\./),
    ).toBeVisible();
  }

  // An outbox pass processes it into the capture mailbox. The background
  // worker may legitimately drain the queue first (the manual pass then
  // submits 0); the capture evidence for THIS case is the invariant.
  await page.goto('/admin/outbox');
  await page.getByRole('button', { name: 'Run outbox pass now' }).click();
  await expect(page.getByText(/Outbox pass: \d+ submitted/)).toBeVisible();
  await expect(
    page.locator('tbody tr', { hasText: caseNo }).filter({ hasText: 'CAPTURED' }).first(),
  ).toBeVisible();
  // Never represented as externally delivered (no DELIVERED status badge).
  await expect(page.locator('tbody .badge', { hasText: 'DELIVERED' })).toHaveCount(0);

  // A repeat pass does not duplicate the already-captured message.
  await page.getByRole('button', { name: 'Run outbox pass now' }).click();
  await expect(page.getByText(/Outbox pass: 0 submitted/)).toBeVisible();
  await expect(
    page.locator('tbody tr', { hasText: caseNo }).filter({ hasText: 'CAPTURED' }),
    // IT, Finance, the manager departure notice and the exit checklist -
    // once each. The point of the assertion is that a repeat pass duplicates
    // nothing, so it counts what activation derives rather than a fixed 3.
  ).toHaveCount(4);

  await page.goto('/dev/mailbox');
  await expect(page.getByText('DEVELOPMENT CAPTURE ONLY')).toBeVisible();
  await expect(
    page
      .locator('section[aria-label="Captured message"]', { hasText: caseNo })
      .filter({ hasText: /Access Removal/i })
      .first(),
  ).toBeVisible();
  await signOut(page);
});

test('Scenario 2 - integration administration with strict role separation', async ({ page }) => {
  test.setTimeout(240_000);
  // Technical admin: system config + health; NO case content.
  await signInAs(page, 'System Administrator');
  await page.goto('/admin/system');
  await expect(page.getByText('System administration')).toBeVisible();
  await page.locator('details.action > summary', { hasText: 'Set a configuration value' }).click();
  await page.locator('#sc-key').fill('pilot.privacyApprovalRequired');
  await page.locator('#sc-value').fill('false');
  await page.locator('#sc-reason').fill('Stage 4 acceptance run.');
  await page.getByRole('button', { name: 'Save configuration' }).click();
  await expect(page.getByText('Configuration saved')).toBeVisible();
  await page.goto('/admin/health');
  await expect(page.getByText('Integration and Operational Health')).toBeVisible();
  // SYSTEM_ADMIN cannot reach HR case content.
  await page.goto('/cases');
  await expect(page.getByText(/Avery Brown/)).toHaveCount(0);
  await signOut(page);

  // HR Manager: business configuration; NOT the technical area.
  await signInAs(page, 'HR Manager');
  await page.goto('/admin/recipients');
  await expect(page.getByText('Notification Recipient Directory')).toBeVisible();
  await expect(page.getByText('capture://it-offboarding').first()).toBeVisible();
  await page.goto('/admin/system');
  await expect(page.getByText('requires the SYSTEM_ADMIN role')).toBeVisible();
  await signOut(page);
});

test('Scenario 3 - pilot readiness gates, activation and suspension', async ({ page }) => {
  test.setTimeout(240_000);
  await signInAs(page, 'HR Manager');
  await page.goto('/admin/pilot');
  await expect(page.getByText('Readiness Gates')).toBeVisible();
  // Gates show real failures in a fresh development environment.
  await expect(page.getByText('BLOCKED').first()).toBeVisible();

  // A TRAINING-level activation needs no gates: propose and apply.
  await page
    .locator('details.action > summary', { hasText: 'Propose a new activation state' })
    .click();
  await page.locator('#pa-state').selectOption('TRAINING_ENABLED');
  await page.locator('#pa-rb').fill('Return to fully manual operations immediately on any issue.');
  await page.getByRole('button', { name: 'Record activation proposal' }).click();
  await expect(page.getByText('Activation proposal recorded')).toBeVisible();
  await page.getByRole('button', { name: 'Apply activation (gates re-checked)' }).click();
  await expect(page.getByText(/environment state is now TRAINING_ENABLED/)).toBeVisible();

  // Suspension stops new integration work at once.
  await page.locator('details.action > summary', { hasText: 'Suspend' }).click();
  await page.locator('#sus-reason').fill('Stage 4 acceptance suspension test.');
  await page.getByRole('button', { name: 'Suspend now' }).click();
  await expect(
    page.getByText(/SUSPENDED: new automated integration work is stopped/),
  ).toBeVisible();
  await signOut(page);
});

test('Scenario 4 - employee directory sync and reconciliation', async ({ page }) => {
  test.setTimeout(240_000);
  await signInAs(page, 'System Administrator');
  await page.goto('/admin/system');
  await page.getByRole('button', { name: 'Synchronize the directory now' }).click();
  await expect(page.getByText(/Employee sync \((fixture|live) adapter\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Run reconciliation report' }).click();
  await expect(page.getByText(/Reconciliation: \d+ finding/)).toBeVisible();
  await expect(page.getByText(/(fixture|live) source/i).first()).toBeVisible();
  await signOut(page);
});

test('Scenario 5 - privacy and retention operations', async ({ page }) => {
  test.setTimeout(240_000);
  // DEC-042: privacy/retention operations belong to the HR Manager.
  await signInAs(page, 'HR Manager');
  await page.goto('/admin/privacy');
  await expect(page.getByText('Privacy and Retention')).toBeVisible();

  // Synthetic retention policy: create + approve.
  await page.locator('details.action > summary', { hasText: 'Create a policy version' }).click();
  await page.locator('#rp-type').selectOption('OFFBOARDING_CASE');
  await page.locator('#rp-years').fill('7');
  await page
    .locator('#rp-basis')
    .fill('Synthetic development schedule (unapproved for production).');
  await page.locator('#rp-reason').fill('Stage 4 acceptance run.');
  await page.getByRole('button', { name: 'Create version (approval required)' }).click();
  await expect(page.getByText('Retention policy version created')).toBeVisible();
  await page.getByRole('button', { name: 'Approve + activate' }).first().click();
  await expect(page.getByText('Retention policy approved')).toBeVisible();

  // Dry run: identifies without deleting.
  await page.getByRole('button', { name: /Run retention DRY RUN/ }).click();
  await expect(page.getByText(/Dry run recorded: \d+ record\(s\) evaluated/)).toBeVisible();
  await expect(page.getByText(/nothing deleted/)).toBeVisible();
  await signOut(page);
});

test('Scenario 6 - backup and restore verification', async ({ page }) => {
  test.setTimeout(300_000);
  await signInAs(page, 'System Administrator');
  await page.goto('/admin/system');
  await page.getByRole('button', { name: 'Create database backup (pg_dump)' }).click();
  await expect(page.getByText(/Backup created \(\d+ bytes/)).toBeVisible();
  await page.getByRole('button', { name: 'Restore into isolated DB + verify' }).first().click();
  await expect(page.getByText(/Restore test PASSED/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('restore verified').first()).toBeVisible();
  await signOut(page);
});

test('Scenario 7 - restricted reporting with suppression', async ({ page }) => {
  test.setTimeout(240_000);
  await signInAs(page, 'HR Officer');
  await page.goto('/reports?report=voluntaryInvoluntary&purpose=TEST');
  await expect(page.getByText('Voluntary vs involuntary departures').first()).toBeVisible();
  await expect(page.getByText(/Small groups below \d+ are suppressed/)).toBeVisible();
  // No restricted-case employee identity leaks through report surfaces.
  await expect(page.getByText('Morgan Reed')).toHaveCount(0);
  await page.goto('/reports?report=surveyKeywords');
  await expect(page.getByText(/no AI|deterministic/i).first()).toBeVisible();
  await signOut(page);
});
