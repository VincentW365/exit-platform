/**
 * Critical HR path (TestStrategy E2E #1) plus a least-privilege negative:
 * officer creates and submits a case, manager approves it and the immutable
 * snapshot appears, and a departmental role sees no case register at all.
 * Synthetic identities only.
 */
import { expect, test, type Page } from '@playwright/test';

async function signInAs(page: Page, displayName: string): Promise<void> {
  await page.goto('/signin');
  await page.getByRole('button', { name: `Sign in as ${displayName}` }).click();
  await page.waitForURL('**/');
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/signin');
}

test('HR officer creates and submits; HR manager approves with snapshot; IT sees nothing', async ({
  page,
}) => {
  // --- HR officer: create the draft -------------------------------------
  await signInAs(page, 'HR Officer');
  await expect(page.getByRole('heading', { name: 'HR dashboard' })).toBeVisible();

  await page.goto('/cases/new');
  await page.getByLabel(/Search the employee source/).fill('avery');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();

  await page.getByLabel('Departure type (required)').selectOption('RESIGNATION_WITH_NOTICE');
  await page.getByLabel('Receipt date and time (required)').fill('2026-07-20T09:30');
  await page
    .getByLabel('Source of the receipt timestamp (required)')
    .fill('Signed resignation letter at HR front desk (synthetic)');
  await page.getByLabel(/Effective separation date and exact time/).fill('2026-08-14T17:00');
  await page.getByRole('button', { name: 'Create draft case' }).click();

  await expect(page.getByText(/Draft case OFF-\d{4}-\d{4} created/)).toBeVisible();
  const caseUrl = page.url().split('?')[0]!;
  await expect(page.getByRole('heading', { name: /OFF-\d{4}-\d{4} - Avery Brown/ })).toBeVisible();
  await expect(page.getByText('not yet captured (created at approval)')).toBeVisible();

  // --- submit for review --------------------------------------------------
  await page.getByRole('button', { name: 'Submit for HR review' }).click();
  await expect(page.getByText('Case submitted for HR review.')).toBeVisible();
  await expect(page.getByText('Pending HR review').first()).toBeVisible();

  // The officer must not see an approval control (maker-checker).
  await expect(page.getByRole('button', { name: /Approve case/ })).toHaveCount(0);
  await signOut(page);

  // --- HR manager: approve ------------------------------------------------
  await signInAs(page, 'HR Manager');
  await page.goto(caseUrl);
  await page.getByRole('button', { name: 'Approve case and capture snapshot' }).click();
  await expect(
    page.getByText('Case approved. The employee snapshot has been captured.'),
  ).toBeVisible();
  await expect(page.getByText('Approved').first()).toBeVisible();
  await expect(page.getByText(/captured .* \(checksum/)).toBeVisible();

  // Audit history shows the full trail (humanized sentences, Directive 6.1).
  await expect(page.getByText('created the case', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('approved the case', { exact: false }).first()).toBeVisible();
  await signOut(page);

  // --- IT responder: least privilege --------------------------------------
  await signInAs(page, 'IT Responder');
  await expect(
    page.getByText(/Departmental work queues arrive with the Stage 3 workflow engine/),
  ).toBeVisible();
  // No Cases navigation is offered...
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByText('Cases')).toHaveCount(0);
  // ...and going there directly is refused server-side.
  await page.goto('/cases');
  await expect(page).toHaveURL(/unauthorized/);
  // A direct case URL leaks nothing.
  await page.goto(caseUrl);
  await expect(page.getByText('Page or record not found')).toBeVisible();
});
