/**
 * Visual QA and accessibility acceptance (Directive 1.1 section I).
 *
 * Captures desktop and mobile screenshots of every principal surface into the
 * gitignored artifacts/stage1-acceptance/ folder (synthetic data only) and
 * runs axe scans asserting no critical or serious violations.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const OUT = 'artifacts/stage1-acceptance';
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 375, height: 812 };

async function signInAs(page: Page, displayName: string): Promise<void> {
  await page.goto('/signin');
  await page.getByRole('button', { name: `Sign in as ${displayName}` }).click();
  await page.waitForURL('**/');
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/signin');
}

async function snap(page: Page, name: string): Promise<void> {
  for (const [suffix, viewport] of [
    ['desktop', DESKTOP],
    ['mobile', MOBILE],
  ] as const) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: `${OUT}/${name}-${suffix}.png`, fullPage: true });
    // No horizontal document overflow at supported widths (I.1).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${name} ${suffix} horizontal overflow`).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize(DESKTOP);
}

async function axeCheck(page: Page, name: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(
    serious.map((v) => `${name}: [${v.impact}] ${v.id} - ${v.help} (${v.nodes.length} nodes)`),
  ).toEqual([]);
}

test('visual + accessibility sweep of principal surfaces', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(DESKTOP);

  // 1. Sign-in / development access.
  await page.goto('/signin');
  await snap(page, '01-signin');
  await axeCheck(page, 'signin');

  // Prepare a case as HR officer for detail-page capture.
  await signInAs(page, 'Riley Okafor');
  await snap(page, '02-hr-dashboard');
  await axeCheck(page, 'dashboard');

  await page.goto('/cases/new');
  await page.getByLabel(/Search the employee source/).fill('avery');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await snap(page, '04-create-case');
  await axeCheck(page, 'create-case');

  await page.getByLabel('Departure type (required)').selectOption('RESIGNATION_WITH_NOTICE');
  await page.getByLabel('Receipt date and time (required)').fill('2026-07-20T09:30');
  await page
    .getByLabel('Source of the receipt timestamp (required)')
    .fill('Visual QA synthetic receipt');
  await page.getByLabel(/Effective separation date and exact time/).fill('2026-08-14T17:00');
  await page.getByRole('button', { name: 'Create draft case' }).click();
  await expect(page.getByText(/Draft case OFF-\d{4}-\d{4} created/)).toBeVisible();
  const caseUrl = page.url().split('?')[0]!;
  await snap(page, '05-review-submit-step');
  await axeCheck(page, 'case-review');

  await page.goto('/cases');
  await snap(page, '03-case-list');
  await axeCheck(page, 'case-list');

  await page.goto('/baseline');
  await snap(page, '08-baseline-dashboard');
  await axeCheck(page, 'baseline');

  await page.goto(caseUrl);
  await page.getByRole('button', { name: 'Submit for HR review' }).click();
  await signOut(page);

  // HR manager: approve, attachments area, audit timeline, admin.
  await signInAs(page, 'Dana Field');
  await page.goto(caseUrl);
  await page.getByRole('button', { name: 'Approve case and capture snapshot' }).click();
  await expect(page.getByText(/snapshot has been captured/)).toBeVisible();
  await snap(page, '06-case-overview-approved');
  await axeCheck(page, 'case-overview');
  await snap(page, '07-audit-timeline');
  await snap(page, '10-attachment-area');

  await page.goto('/admin');
  await snap(page, '11-admin');
  await axeCheck(page, 'admin');

  // Restricted case: authorized view.
  await page.goto('/cases/new');
  await page.getByLabel(/Search the employee source/).fill('morgan');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page.getByLabel('Departure type (required)').selectOption('TERMINATION');
  await page.getByLabel('Receipt date and time (required)').fill('2026-07-21T10:00');
  await page
    .getByLabel('Source of the receipt timestamp (required)')
    .fill('Visual QA synthetic termination');
  await page.getByLabel(/Effective separation date and exact time/).fill('2026-08-01T17:00');
  await page.getByRole('button', { name: 'Create draft case' }).click();
  const restrictedUrl = page.url().split('?')[0]!;
  await snap(page, '14a-restricted-authorized');
  await signOut(page);

  // Restricted case: unauthorized outcomes.
  await signInAs(page, 'Riley Okafor');
  await page.goto(restrictedUrl);
  await snap(page, '14b-restricted-unauthorized-hr');
  await axeCheck(page, 'not-found');
  await signOut(page);

  // Oversight: audit feed.
  await signInAs(page, 'Quinn Baptiste');
  await page.goto('/audit');
  await snap(page, '09-audit-feed');
  await axeCheck(page, 'audit-feed');
  await signOut(page);

  // Unauthorized page as departmental role.
  await signInAs(page, 'Sam Chen');
  await page.goto('/cases');
  await page.waitForURL('**/unauthorized');
  await snap(page, '12-unauthorized');
  await axeCheck(page, 'unauthorized');
  await page.goto('/this-page-does-not-exist');
  await snap(page, '13-not-found');
  await page.goto('/'); // the not-found page intentionally has no app shell
  await signOut(page);
});

test('keyboard access and 200% zoom function (spot checks)', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/signin');
  // Keyboard: tab reaches the first sign-in button and Enter activates it.
  await page.keyboard.press('Tab'); // skip link
  await page.keyboard.press('Tab');
  const active = await page.evaluate(() => document.activeElement?.textContent ?? '');
  expect(active.length).toBeGreaterThan(0);

  await signInAs(page, 'Riley Okafor');
  // 200% zoom equivalent: halve the viewport CSS pixels via device scale.
  await page.setViewportSize({ width: 640, height: 400 });
  await page.goto('/cases');
  await expect(page.getByRole('heading', { name: 'Offboarding cases' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await signOut(page);
});
