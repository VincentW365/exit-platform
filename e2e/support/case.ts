/**
 * Shared end-to-end scaffolding.
 *
 * Scenarios that need a live case build their own rather than depending on
 * what a seed left behind - so they are repeatable, and a previous run can
 * never put the next one into an unusable state. Synthetic data only.
 */
import { expect, type Page } from '@playwright/test';

export async function signInAs(page: Page, displayName: string): Promise<void> {
  await page.goto('/signin');
  await page.getByRole('button', { name: `Sign in as ${displayName}` }).click();
  await page.waitForURL('**/');
}

export async function signOut(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/signin');
}

/**
 * Build an ACTIVE case on the HR-validated (v2) workflow and leave the browser
 * on its Overview. Self-contained: intake, approval, assignment routing and
 * activation, so the scenario never depends on what a seed left behind.
 */
export async function openActiveHrValidatedCase(page: Page): Promise<string> {
  // Intake (HR Officer).
  await page.goto('/cases/new');
  await page.getByLabel('Employee Name or Number').fill('avery');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page.getByLabel('Departure Type').selectOption('RESIGNATION_WITH_NOTICE');
  await page.getByLabel('Date and Time Received').fill('2026-07-20T09:30');
  await page.getByLabel('Final Working Date').fill('2026-08-14');
  await page.getByRole('button', { name: 'Create draft case' }).click();
  await expect(page.getByText(/Draft case OFF-\d{4}-\d{4,}(?:-\d)? created/)).toBeVisible();
  const caseUrl = page.url().split('?')[0]!;

  // Approval: the signed-in HR Manager approves her own draft in one
  // audited step (owner, 2026-08-25) - no submit-to-self detour.
  await page.getByRole('button', { name: 'Approve case and capture snapshot' }).click();
  await expect(page.getByText(/Case approved/)).toBeVisible();

  // Assignment routing.
  await page.goto(`${caseUrl}/assignment`);
  await page.locator('details.action > summary', { hasText: 'Assign HR Officer' }).click();
  const officerValue = await page
    .locator('#of-user option', { hasText: 'HR Officer' })
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

  // Activation derives the email actions this scenario inspects.
  await page.goto(`${caseUrl}/workflow`);
  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();

  await page.goto(caseUrl);
  return caseUrl;
}
