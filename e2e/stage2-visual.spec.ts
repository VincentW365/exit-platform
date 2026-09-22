/**
 * Focused Stage 2 visual QA + accessibility (Directive 2 section O).
 * Small screenshot set to artifacts/stage2/ (gitignored, synthetic data only);
 * axe scans assert no critical/serious violations on the new surfaces.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const OUT = 'artifacts/stage2';
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 375, height: 812 };

async function signInAs(page: Page, displayName: string): Promise<void> {
  await page.goto('/signin');
  await page.getByRole('button', { name: `Sign in as ${displayName}` }).click();
  await page.waitForURL('**/');
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

test('stage 2 surfaces: visual + axe sweep', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(DESKTOP);

  await signInAs(page, 'HR Officer');

  // Dashboard with the new queues/metrics.
  await snap(page, '01-dashboard-stage2', true);
  await axeCheck(page, 'dashboard-stage2');

  // Template list/editor.
  await page.goto('/admin/templates');
  await snap(page, '02-template-list');
  await axeCheck(page, 'template-list');

  // Build one case through the document flow for the remaining captures.
  await page.goto('/cases/new');
  await page.getByLabel('Employee Name or Number').fill('casey');
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
  await expect(page.getByText(/Draft case OFF-\d{4}-\d{4,}(?:-\d)? created/)).toBeVisible();
  const caseUrl = page.url().split('?')[0]!;

  // DEC-066: on a draft case the letter can be drafted but not finalized;
  // the capture shows the draft with the case-approval gate explained.
  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Create resignation document draft' }).click();
  await expect(page.getByText(/has not been approved yet/)).toBeVisible();
  await snap(page, '03-document-preview-approval', true);
  await axeCheck(page, 'document-preview');

  await page.goto(`${caseUrl}/action-form`);
  await page.getByRole('button', { name: 'Create action form' }).click();
  // Streamed metadata (async root layout): wait for the title to land before
  // the axe scan - a mid-stream snapshot would flag document-title.
  await expect(page).toHaveTitle(/Action Form/);
  await snap(page, '04-action-form', true);
  await axeCheck(page, 'action-form');

  await page.goto(`${caseUrl}/survey`);
  await page.getByRole('button', { name: 'Create survey invitation' }).click();
  await page.getByRole('button', { name: 'Generate secure link' }).click();
  await snap(page, '05-survey-admin');
  await axeCheck(page, 'survey-admin');
  const link = await page.locator('code').first().textContent();

  // Mobile case detail.
  await page.goto(caseUrl);
  await snap(page, '06-mobile-case-detail', true);

  await page.getByRole('button', { name: 'Sign out' }).click();

  // Public survey (mobile-first) + neutral invalid-token page.
  await page.goto(link!);
  await snap(page, '07-public-survey', true);
  await axeCheck(page, 'public-survey');
  await page.goto('/survey/thanks');
  await snap(page, '08-survey-thanks');
  await page.goto(`/survey/${'A'.repeat(43)}`);
  await snap(page, '09-survey-neutral-invalid');
  await axeCheck(page, 'survey-neutral');
  await expect(page.getByText('Survey not available')).toBeVisible();
});
