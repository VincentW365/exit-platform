/**
 * Directive 6.1 acceptance (sections E/F/G/K/N/U): assignment-plan gating
 * with a missing manager, department-queue claim/return through the UI, and
 * an end-to-end audit investigation. Synthetic data only (scenarios that
 * overlap the stage suites are covered there; see the build record).
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
  opts: { employeeQuery: string; type: string },
): Promise<{ url: string; number: string }> {
  await page.goto('/cases/new');
  await page.getByLabel('Employee Name or Number').fill(opts.employeeQuery);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page.getByLabel('Departure Type').selectOption(opts.type);
  await page.getByLabel('Date and Time Received').fill('2026-07-22T09:30');
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

test('Scenario F - missing manager blocks activation until an audited override', async ({
  page,
}) => {
  test.setTimeout(300_000);
  // EMP-TEST-009 (Kai Mendes) has NO manager in the synthetic directory.
  await signInAs(page, 'HR Officer');
  const { url: caseUrl } = await createTestCase(page, {
    employeeQuery: 'kai',
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

  // The assignment plan shows the hard blocker.
  await page.goto(`${caseUrl}/assignment`);
  await expect(page.getByText('No manager — action required').first()).toBeVisible();

  // Assign the officer, then resolve the manager with an audited override.
  await page.locator('details.action > summary', { hasText: 'Assign HR Officer' }).click();
  // Directive 6.3 correction 7: options read "<name> - <job title>".
  const officerValueF = await page
    .locator('#of-user option', { hasText: 'HR Officer' })
    .first()
    .getAttribute('value');
  await page.locator('#of-user').selectOption(officerValueF!);
  await page.locator('#of-reason').fill('Scenario F assignment.');
  await page.getByRole('button', { name: 'Assign officer' }).click();
  await expect(page.getByText('HR Officer assigned (audited).')).toBeVisible();
  await page.locator('details.action > summary', { hasText: 'Assign alternate manager' }).click();
  await page.locator('#am-user').selectOption({ index: 1 });
  await page.locator('#am-reason').fill('Directory records no manager for this employee.');
  await page.getByRole('button', { name: 'Record alternate manager' }).click();
  await expect(page.getByText('Alternate manager recorded')).toBeVisible();
  await expect(page.getByText('No manager — action required')).toHaveCount(0);
  for (const box of await page.locator('input[name="confirmations"]').all()) {
    if (!(await box.isChecked())) await box.check();
  }
  await page.getByRole('button', { name: 'Confirm assignment plan' }).click();
  await expect(page.getByText('Assignment plan confirmed').first()).toBeVisible();

  await page.goto(`${caseUrl}/workflow`);
  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();

  // The override is visible in the case audit history (before → after).
  await page.goto(`${caseUrl}?auditChip=ASSIGNMENTS#audit-h`);
  await expect(page.getByText(/overrode the derived manager/).first()).toBeVisible();
  await signOut(page);
});

// Directive 6.3: the IT responder logins are retired, so the claim/return
// journey runs on the HR department queue - the mechanics (claim from the
// unassigned view, audited return, reclaim) are identical.
test('Scenario D - queue claim, return to queue and reclaim through the UI', async ({ page }) => {
  test.setTimeout(300_000);
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
  await page.goto(`${caseUrl}/assignment`);
  await page.locator('details.action > summary', { hasText: 'Assign HR Officer' }).click();
  // Directive 6.3 correction 7: options read "<name> - <job title>".
  const officerValueD = await page
    .locator('#of-user option', { hasText: 'HR Officer' })
    .first()
    .getAttribute('value');
  await page.locator('#of-user').selectOption(officerValueD!);
  await page.locator('#of-reason').fill('Scenario D assignment.');
  await page.getByRole('button', { name: 'Assign officer' }).click();
  await expect(page.getByText('HR Officer assigned (audited).')).toBeVisible();
  await page.locator('details.action > summary', { hasText: 'Assign alternate manager' }).click();
  await page.locator('#am-user').selectOption({ index: 1 });
  await page.locator('#am-reason').fill('Scenario D routing.');
  await page.getByRole('button', { name: 'Record alternate manager' }).click();
  await expect(page.getByText('Alternate manager recorded')).toBeVisible();
  for (const box of await page.locator('input[name="confirmations"]').all()) {
    if (!(await box.isChecked())) await box.check();
  }
  await page.getByRole('button', { name: 'Confirm assignment plan' }).click();
  await expect(page.getByText('Assignment plan confirmed').first()).toBeVisible();
  await page.goto(`${caseUrl}/workflow`);
  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();
  await signOut(page);

  // The HR Officer claims an unassigned HR task from the queue.
  await signInAs(page, 'HR Officer');
  await page.goto(`/queue?view=unassigned&q=${caseNo}`);
  const row = page
    .locator('.row-item', { hasText: 'Verify resignation and case information' })
    .first();
  await row.getByRole('button', { name: 'Claim' }).click();
  await expect(page.getByText('Task claimed - it is now assigned to you (audited).')).toBeVisible();

  // My-tasks view shows the claimed task with the assignee name.
  await page.goto(`/queue?view=myTasks&q=${caseNo}`);
  await expect(page.getByText('HR Officer').first()).toBeVisible();

  // Return it to the queue with a reason; it becomes claimable again.
  const mine = page
    .locator('.row-item', { hasText: 'Verify resignation and case information' })
    .first();
  await mine.locator('details.action > summary', { hasText: 'Return to queue' }).click();
  await mine.locator('input[name="reason"]').fill('Scenario D - handing back for reallocation.');
  await mine.getByRole('button', { name: 'Return task' }).click();
  await expect(page.getByText('Task returned to the department queue (audited).')).toBeVisible();
  await page.goto(`/queue?view=unassigned&q=${caseNo}`);
  await expect(
    page
      .locator('.row-item', { hasText: 'Verify resignation and case information' })
      .first()
      .getByRole('button', { name: 'Claim' }),
  ).toBeVisible();
  await signOut(page);
});

test('Scenario I - audit investigation in the Audit Centre', async ({ page }) => {
  test.setTimeout(240_000);
  // The HR Manager investigates recent assignment activity.
  await signInAs(page, 'HR Manager');
  await page.goto('/audit');
  await expect(page.getByRole('heading', { name: 'Audit center' })).toBeVisible();
  await expect(page.getByText('Events today')).toBeVisible();
  await page.locator('#af-category').selectOption('ASSIGNMENT');
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await expect(page.locator('tbody .badge', { hasText: 'ASSIGNMENT' }).first()).toBeVisible();
  // Drawer shows structured detail with before/after where present.
  await page.locator('tbody details.action > summary', { hasText: 'Details' }).first().click();
  await expect(page.getByText('Correlation').first()).toBeVisible();
  // Export control exists for authorized users (download itself is audited).
  await expect(page.getByRole('link', { name: 'Export CSV (audited)' })).toBeVisible();
  await signOut(page);

  // The HR Manager filters by outcome (DEC-042: HR is the audit audience).
  await signInAs(page, 'HR Manager');
  await page.goto('/audit');
  await expect(page.getByRole('heading', { name: 'Audit center' })).toBeVisible();
  await page.locator('#af-result').selectOption('DENIED');
  await page.getByRole('button', { name: 'Filter' }).click();
  // Either denials exist or the empty state explains itself.
  const anyRow = await page.locator('tbody tr').count();
  if (anyRow === 0) {
    await expect(page.getByText('No audit events match these filters.')).toBeVisible();
  }
  await signOut(page);

  // SYSTEM_ADMIN sees the technical feed - never case content.
  await signInAs(page, 'System Administrator');
  await page.goto('/audit');
  await expect(page.getByText(/technical events only/)).toBeVisible();
  await expect(page.getByText(/OFF-\d{4}-\d{4,}(?:-\d)?/)).toHaveCount(0);
  await signOut(page);
});
