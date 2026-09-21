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
  // The root layout streams its metadata. A scan fired while that stream is
  // still open can catch the document between head writes and report a
  // document-title violation that is not real - the title is present before
  // and after. Wait for the stream to finish AND for the element to exist in
  // the DOM (page.title() alone can read a stale value).
  await page.waitForLoadState('networkidle');
  await expect
    .poll(
      async () =>
        page.evaluate(() => document.querySelector('title')?.textContent?.trim().length ?? 0),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
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
  await signInAs(page, 'HR Manager');
  await snap(page, '01-dashboard-stage3', true);
  await axeCheck(page, 'dashboard-stage3');

  // Workflow definition register + task-matrix preview.
  await page.goto('/admin/workflows');
  await snap(page, '02-workflow-definitions');
  await axeCheck(page, 'workflow-definitions');
  // Directive 6.3 seeds a v2 of each workflow definition; open the first
  // matching register entry (both versions share the display name).
  await page
    .getByRole('link', { name: /DEV Resignation with notice workflow/ })
    .first()
    .click();
  await snap(page, '03-workflow-definition-matrix', true);
  await axeCheck(page, 'workflow-definition-matrix');

  // Build one case for the case-scoped surfaces.
  await page.goto('/cases/new');
  await page.getByLabel('Employee Name or Number').fill('taylor');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page
    .locator(`input[name="type"][value=${JSON.stringify('RESIGNATION_WITH_NOTICE')}]`)
    .check();
  await page.getByRole('button', { name: 'Use this separation type' }).click();
  await page.locator('input[name="receivedAt"]').fill('2026-07-21T10:00');
  // A resignation with notice ends at close of business on the final working
  // date, so the platform derives the instant and the field is not offered.
  await page.locator('input[name="confirmedLastDay"]').fill('2026-08-14');
  // The final action lives in the Review step (owner directive,
  // 2026-08-27), so it is reached by opening that step.
  await page.locator('.step:has([data-step="review"]) .step__header').click();
  // DEC-061: a fixture employee may already have a live case; confirm the deliberate
  // second one. The confirmation lives in the Review step, so make sure it is open.
  if (await page.getByLabel(/I confirm this is a separate separation event/).count()) {
    const reviewHeader = page.locator('.step:has([data-step="review"]) .step__header');
    if ((await reviewHeader.getAttribute('aria-expanded')) !== 'true') await reviewHeader.click();
    await page.getByLabel(/I confirm this is a separate separation event/).check();
  }
  await page.getByRole('button', { name: 'Create draft case' }).click();
  const banner = page.getByText(/Draft case OFF-\d{4}-\d{4,}(?:-\d)? created/);
  await expect(banner).toBeVisible();
  const caseNo = /OFF-\d{4}-\d{4,}(?:-\d)?/.exec((await banner.textContent()) ?? '')![0];
  const caseUrl = page.url().split('?')[0]!;

  await page.goto(caseUrl);
  // The manager approves her own draft in one audited step.
  await page.getByRole('button', { name: 'Approve case and capture snapshot' }).click();
  await expect(page.getByText(/Case approved/)).toBeVisible();

  // Directive 6.1: complete the assignment plan (officer + manager + confirm).
  await page.goto(`${caseUrl}/assignment`);
  await snap(page, '14-assignment-plan', true);
  await axeCheck(page, 'assignment-plan');
  await page.locator('details.action > summary', { hasText: 'Assign HR Officer' }).click();
  // Directive 6.3 correction 7: options read "<name> - <job title>".
  const officerValue = await page
    .locator('#of-user option', { hasText: 'HR Officer' })
    .first()
    .getAttribute('value');
  await page.locator('#of-user').selectOption(officerValue!);
  await page.locator('#of-reason').fill('Visual QA assignment.');
  await page.getByRole('button', { name: 'Assign officer' }).click();
  await expect(page.getByText('HR Officer assigned (audited).')).toBeVisible();
  await page.locator('details.action > summary', { hasText: 'Assign alternate manager' }).click();
  await page.locator('#am-user').selectOption({ index: 1 });
  await page.locator('#am-reason').fill('Visual QA manager routing.');
  await page.getByRole('button', { name: 'Record alternate manager' }).click();
  await expect(page.getByText('Alternate manager recorded')).toBeVisible();
  for (const box of await page.locator('input[name="confirmations"]').all()) {
    if (!(await box.isChecked())) await box.check();
  }
  await page.getByRole('button', { name: 'Confirm assignment plan' }).click();
  await expect(page.getByText('Assignment plan confirmed').first()).toBeVisible();

  // Read-only workflow preview before activation (B.8).
  await page.goto(`${caseUrl}/workflow`);
  await expect(page.getByText('Workflow Preview (Read-only, Before Activation)')).toBeVisible();
  await snap(page, '04-workflow-preview', true);
  await axeCheck(page, 'workflow-preview');

  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();
  await snap(page, '05-workflow-instance', true);
  await axeCheck(page, 'workflow-instance');

  // Work queue + task detail (Directive 6.3: IT/Finance have no logins - the
  // "My work" queue serves HR and line managers; the HR view is captured).
  await page.goto(`/queue?view=all&q=${caseNo}`);
  await snap(page, '06-department-queue', true);
  await axeCheck(page, 'department-queue');
  await page.getByRole('link', { name: 'Verify resignation and case information' }).first().click();
  await snap(page, '07-task-detail');
  await axeCheck(page, 'task-detail');

  // Email actions (Directive 6.3), assets, clearance, exceptions.
  await page.goto(`${caseUrl}/notifications`);
  await snap(page, '08-email-actions', true);
  await axeCheck(page, 'email-actions');
  await page
    .locator('details.action > summary', { hasText: 'Prepare a manual notification (exceptional)' })
    .click();
  await snap(page, '09-notifications', true);
  await axeCheck(page, 'notifications');

  await page.goto(`${caseUrl}/assets`);
  await snap(page, '10-assets', true);
  await axeCheck(page, 'assets');

  await page.goto(`${caseUrl}/clearance`);
  await snap(page, '12-clearance-review', true);
  await axeCheck(page, 'clearance-review');

  await page.goto('/exceptions');
  await snap(page, '13-exception-feed', true);
  await axeCheck(page, 'exception-feed');
  await signOut(page);
});
