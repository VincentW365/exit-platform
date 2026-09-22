/**
 * Employee Directory (owner directive, 2026-09-15): the HR directory over the
 * local mirror, an employee's profile, "Start offboarding" pre-selecting the
 * employee at intake, existing-case protection, and the administrator's
 * synchronization views. Synthetic fixture directory only.
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

test('HR browses the directory, opens a profile and starts an offboarding from it', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInAs(page, 'HR Officer');

  await page.goto('/directory');
  await expect(page.getByRole('heading', { name: 'Employee Directory' })).toBeVisible();
  // Freshness is stated, quietly or loudly, but the directory is never
  // declared unavailable once anything has been synchronized.
  await expect(page.locator('[data-directory-freshness]')).toBeVisible();
  await expect(
    page.getByText('Employee Directory unavailable because BambooHR is down'),
  ).toHaveCount(0);

  // Harper Nunez (EMP-TEST-008) has no seeded case, so the profile offers
  // "Start offboarding"; Avery Brown carries the UAT dataset's cases.
  await page.getByLabel('Name, employee number, title or email').fill('Harper');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('Matching "Harper"')).toBeVisible();
  const card = page.getByRole('link', { name: 'Harper Nunez' }).first();
  await expect(card).toBeVisible();
  await expect(page.getByText(/Manager: /).first()).toBeVisible();
  await card.click();

  await expect(page.getByRole('heading', { name: 'Employment' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reporting Structure' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Work Contact' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Offboarding', exact: true })).toBeVisible();
  // The manager is a directory record, linked by identifier (fixture:
  // EMP-TEST-008 reports to EMP-TEST-006).
  const managerLink = page.locator('[aria-label="Manager"] a').first();
  await expect(managerLink).toBeVisible();
  await expect(page.getByText('BambooHR id', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Start offboarding' }).click();
  await page.waitForURL(/\/cases\/new\?.*employee=EMP-TEST-008/);
  // The employee step is settled by the server and shows the person chosen.
  const employeeStep = page.locator('.step:has([data-step="employee"])');
  await expect(employeeStep).toContainText('Harper Nunez');
  await expect(page.locator('.step:has([data-step="separation"])')).toBeVisible();

  // The intake resolves the employee from the id alone, without a search.
  await page.goto('/cases/new?employee=EMP-TEST-008');
  await expect(page.locator('.step:has([data-step="employee"])')).toContainText('Harper Nunez');
  // And the results table shows the manager next to each match.
  await page.goto('/cases/new?q=Avery');
  await expect(page.getByRole('columnheader', { name: 'Manager' })).toBeVisible();
  await signOut(page);
});

test('an existing active case is surfaced on the profile and at intake, and a duplicate needs confirmation', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, 'HR Officer');
  // A draft for the fixture employee EMP-TEST-013 (Devon Marsh), who has no
  // seeded case; the first run creates it, a repeat run finds it.
  await page.goto('/cases/new?employee=EMP-TEST-013&q=Devon');
  await expect(page.locator('.step:has([data-step="employee"])')).toContainText('Devon Marsh');
  const alreadyOpen = await page.locator('[data-existing-case]').count();
  if (alreadyOpen === 0) {
    await page.locator('input[name="type"][value="RESIGNATION_WITH_NOTICE"]').check();
    await page.getByRole('button', { name: 'Use this separation type' }).click();
    await page.locator('input[name="receivedAt"]').fill('2026-07-21T09:30');
    await page.locator('input[name="confirmedLastDay"]').fill('2026-08-14');
    await page.locator('.step:has([data-step="review"]) .step__header').click();
    await page.getByRole('button', { name: 'Create draft case' }).click();
    await expect(page.getByText(/Draft case OFF-\d{4}-\d{4,}(?:-\d)? created/)).toBeVisible();
  }

  // Profile: the existing case is offered first.
  await page.goto('/directory?q=Devon&status=all');
  await page.getByRole('link', { name: 'Devon Marsh' }).first().click();
  await expect(page.locator('[data-existing-case]')).toContainText(
    'already has an active offboarding case',
  );
  await expect(page.getByRole('link', { name: /Open existing case/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start offboarding', exact: true })).toHaveCount(0);

  // Intake: the notice, the way to the existing case, and the confirmation
  // the server insists on before a second case is created.
  await page.goto('/cases/new?employee=EMP-TEST-013&q=Devon&type=RESIGNATION_WITH_NOTICE');
  await expect(page.locator('[data-existing-case]')).toContainText(
    'already has an active offboarding case',
  );
  await expect(page.getByRole('link', { name: /Open existing case/ }).first()).toBeVisible();
  await page.locator('input[name="receivedAt"]').fill('2026-07-21T09:30');
  await page.locator('input[name="confirmedLastDay"]').fill('2026-08-14');
  await page.locator('.step:has([data-step="review"]) .step__header').click();
  await expect(page.getByLabel(/I confirm this is a separate separation event/)).toBeVisible();
  await page.getByRole('button', { name: 'Create draft case' }).click();
  await expect(page.locator('.error-summary')).toContainText('already exists for this employee');
  await signOut(page);
});

test('the HR Manager sees the synchronization health, the log and the manual refresh; the HR Officer sees no admin view', async ({
  page,
}) => {
  test.setTimeout(180_000);
  // DEC-063: Refresh Directory Now is an HR Manager capability.
  await signInAs(page, 'HR Manager');
  await page.goto('/admin/system');
  await expect(page.locator('[data-directory-health]')).toBeVisible();
  await expect(page.getByText('Local employees')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh Directory Now' }).click();
  await expect(page.getByText(/Directory refresh started|already queued or running/)).toBeVisible();

  await page.goto('/admin/directory-sync');
  await expect(page.getByRole('heading', { name: 'Directory Synchronization' })).toBeVisible();
  await expect(page.locator('[data-sync-run]').first()).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Kind').selectOption('MANUAL');
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect(page.locator('[data-sync-run="MANUAL"]').first()).toBeVisible();
  await signOut(page);

  await signInAs(page, 'HR Officer');
  await page.goto('/admin/directory-sync');
  await expect(page.getByText('requires the HR Manager')).toBeVisible();
  await signOut(page);
});

test('the webhook endpoint is closed without a key and refuses unsigned requests', async ({
  request,
}) => {
  // In the ordinary e2e posture no webhook key is configured: the endpoint
  // does not exist. (The regression suite exercises the signed path.)
  const res = await request.post('/api/bamboohr/webhook', {
    data: { employees: [{ id: 1, changedFields: ['jobTitle'] }] },
  });
  expect([401, 404]).toContain(res.status());
});
