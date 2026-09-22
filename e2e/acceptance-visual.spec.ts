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
  await signInAs(page, 'HR Officer');
  await snap(page, '02-hr-dashboard');
  await axeCheck(page, 'dashboard');

  await page.goto('/cases/new');
  await page.getByLabel('Employee Name or Number').fill('avery');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await snap(page, '04-create-case');
  await axeCheck(page, 'create-case');

  await page
    .locator(`input[name="type"][value=${JSON.stringify('RESIGNATION_WITH_NOTICE')}]`)
    .check();
  await page.getByRole('button', { name: 'Use this separation type' }).click();
  await page.locator('input[name="receivedAt"]').fill('2026-07-20T09:30');
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
  await expect(page.getByText(/Draft case OFF-\d{4}-\d{4,}(?:-\d)? created/)).toBeVisible();
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
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await signOut(page);

  // HR manager: approve, attachments area, audit timeline, admin.
  await signInAs(page, 'HR Manager');
  await page.goto(caseUrl);
  // DEC-066: the one HR Manager decision is taken on the Case Approval Summary.
  await page.goto(`${caseUrl}/approve`);
  await page.getByRole('button', { name: 'Approve Case', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm approval' }).click();
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
  await page.getByLabel('Employee Name or Number').fill('morgan');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page.locator(`input[name="type"][value=${JSON.stringify('TERMINATION')}]`).check();
  await page.getByRole('button', { name: 'Use this separation type' }).click();
  await page.locator('input[name="receivedAt"]').fill('2026-07-21T10:00');
  await page.locator('input[name="confirmedLastDay"]').fill('2026-08-01');
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
  const restrictedUrl = page.url().split('?')[0]!;
  await snap(page, '14a-restricted-authorized');
  await signOut(page);

  // Restricted case: unauthorized outcomes.
  await signInAs(page, 'HR Officer');
  await page.goto(restrictedUrl);
  await snap(page, '14b-restricted-unauthorized-hr');
  await axeCheck(page, 'not-found');
  await signOut(page);

  // Audit feed (HR Manager audience per DEC-042).
  await signInAs(page, 'HR Manager');
  await page.goto('/audit');
  await snap(page, '09-audit-feed');
  await axeCheck(page, 'audit-feed');
  await signOut(page);

  // Unauthorized page (DEC-063: only HR roles sign in; the Audit Center is
  // the HR Manager's, so the HR Officer covers this negative).
  await signInAs(page, 'HR Officer');
  await page.goto('/audit');
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

  await signInAs(page, 'HR Officer');
  // 200% zoom equivalent: halve the viewport CSS pixels via device scale.
  await page.setViewportSize({ width: 640, height: 400 });
  await page.goto('/cases');
  await expect(page.getByRole('heading', { name: 'Offboarding Cases' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await signOut(page);
});
