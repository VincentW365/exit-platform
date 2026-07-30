/**
 * Focused Stage 3 visual QA + accessibility (Directive 3 section U).
 * Screenshot set to artifacts/stage3/ (gitignored, synthetic data only);
 * axe scans assert no critical/serious violations on every new surface.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const OUT = 'artifacts/stage3';
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 375, height: 812 };

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

async function snap(page: Page, name: string, mobileToo = false): Promise<void> {
  await page.setViewportSize(DESKTOP);
  await page.screenshot({ path: `${OUT}/${name}-desktop.png`, fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${name} desktop overflow`).toBeLessThanOrEqual(1);
  if (mobileToo) {
    await page.setViewportSize(MOBILE);
    await page.screenshot({ path: `${OUT}/${name}-mobile.png`, fullPage: true });
    const mOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(mOverflow, `${name} mobile overflow`).toBeLessThanOrEqual(1);
    await page.setViewportSize(DESKTOP);
  }
}

async function axeCheck(page: Page, name: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(
    serious.map((v) => `${name}: [${v.impact}] ${v.id} - ${v.help} (${v.nodes.length})`),
  ).toEqual([]);
}

test('stage 3 surfaces: visual + axe sweep', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize(DESKTOP);

  // HR dashboard with the workflow-operations block.
  await signInAs(page, 'Dana Field');
  await snap(page, '01-dashboard-stage3', true);
  await axeCheck(page, 'dashboard-stage3');

  // Workflow definition register + task-matrix preview.
  await page.goto('/admin/workflows');
  await snap(page, '02-workflow-definitions');
  await axeCheck(page, 'workflow-definitions');
  await page.getByRole('link', { name: /DEV Resignation with notice workflow/ }).click();
  await snap(page, '03-workflow-definition-matrix', true);
  await axeCheck(page, 'workflow-definition-matrix');

  // Build one case for the case-scoped surfaces.
  await page.goto('/cases/new');
  await page.getByLabel(/Search the employee source/).fill('taylor');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page.getByLabel('Departure type (required)').selectOption('RESIGNATION_WITH_NOTICE');
  await page.getByLabel('Receipt date and time (required)').fill('2026-07-21T10:00');
  await page.getByLabel('Source of the receipt timestamp (required)').fill('Visual QA synthetic');
  await page.getByLabel('Confirmed last working day').fill('2026-08-14');
  await page.getByLabel(/Effective separation date and exact time/).fill('2026-08-14T17:00');
  await page.getByLabel('Record purpose').selectOption('TEST');
  await page.getByRole('button', { name: 'Create draft case' }).click();
  const banner = page.getByText(/Draft case OFF-\d{4}-\d{4} created/);
  await expect(banner).toBeVisible();
  const caseNo = /OFF-\d{4}-\d{4}/.exec((await banner.textContent()) ?? '')![0];
  const caseUrl = page.url().split('?')[0]!;

  await page.goto(caseUrl);
  await page.getByRole('button', { name: 'Submit for HR review' }).click();
  await expect(page.getByText('Case submitted for HR review.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve case and capture snapshot' }).click();
  await expect(page.getByText(/Case approved/)).toBeVisible();

  // Read-only workflow preview before activation (B.8).
  await page.goto(`${caseUrl}/workflow`);
  await expect(page.getByText('Workflow preview (read-only, before activation)')).toBeVisible();
  await snap(page, '04-workflow-preview', true);
  await axeCheck(page, 'workflow-preview');

  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();
  await snap(page, '05-workflow-instance', true);
  await axeCheck(page, 'workflow-instance');

  // Exact-time access task detail (IT view via the department queue).
  await signOut(page);
  await signInAs(page, 'Sam Chen');
  await page.goto(`/queue?view=all&q=${caseNo}`);
  await snap(page, '06-department-queue', true);
  await axeCheck(page, 'department-queue');
  await page
    .getByRole('link', { name: 'Review systems and access requiring removal' })
    .first()
    .click();
  await snap(page, '07-task-detail');
  await axeCheck(page, 'task-detail');
  // Complete the review so THIS case's exact-time task releases.
  await page.locator('details.action > summary', { hasText: 'Complete with evidence' }).click();
  await page.locator('#c-note').fill('Access list reviewed for the visual QA case.');
  await page.getByRole('button', { name: 'Complete task' }).click();
  await expect(page.getByText('Task completed with evidence.')).toBeVisible();
  await page.goto(`/queue?view=all&q=${caseNo}`);
  await page
    .getByRole('link', { name: 'Revoke system access at the effective separation time' })
    .first()
    .click();
  await snap(page, '08-access-revocation-task', true);
  await axeCheck(page, 'access-revocation-task');
  await signOut(page);

  // Notifications, assets, handover, clearance and the exception feed.
  await signInAs(page, 'Dana Field');
  await page.goto(`${caseUrl}/notifications`);
  await page.locator('details.action > summary', { hasText: 'Prepare a notification' }).click();
  await snap(page, '09-notifications', true);
  await axeCheck(page, 'notifications');

  await page.goto(`${caseUrl}/assets`);
  await snap(page, '10-assets', true);
  await axeCheck(page, 'assets');

  await page.goto(`${caseUrl}/handover`);
  await snap(page, '11-handover', true);
  await axeCheck(page, 'handover');

  await page.goto(`${caseUrl}/clearance`);
  await snap(page, '12-clearance-review', true);
  await axeCheck(page, 'clearance-review');

  await page.goto('/exceptions');
  await snap(page, '13-exception-feed', true);
  await axeCheck(page, 'exception-feed');
  await signOut(page);
});
