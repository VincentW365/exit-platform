/**
 * Section 27 (owner design directive): a responsive sweep across the surfaces
 * the redesign actually rebuilt.
 *
 * The existing tablet spot-check covers the dashboard, case list, reports,
 * pilot, continuity, queue and health screens - none of the case working
 * surfaces. Those are the ones carrying the new patterns (department
 * sections, entity rows, paper-form replicas, the filter toolbar, the
 * analytics band), and they are the ones with the widest content, so they
 * are where a layout breaks first.
 *
 * The assertion is deliberately narrow and mechanical: nothing may push the
 * document wider than the viewport. Wide content is allowed to scroll, but
 * only inside its own container - a page that scrolls sideways as a whole is
 * a layout failure at that width, whatever it looks like.
 */
import { expect, test, type Page } from '@playwright/test';

const WIDTHS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1280, height: 800 },
] as const;

async function signInAs(page: Page, displayName: string): Promise<void> {
  await page.goto('/signin');
  await page.getByRole('button', { name: `Sign in as ${displayName}` }).click();
  await page.waitForURL('**/');
}

/** The document itself must never scroll sideways. */
async function assertNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
}

test('every rebuilt surface holds its width from mobile to laptop', async ({ page }) => {
  // 13 routes at 3 widths is 39 full page loads on the dev server, at about
  // 1.5 s each once compiled and 3-4 s each cold (measured 2026-09-23). The
  // default 60 s budget was met only on a fast day; the assertion is about
  // layout, not speed, so give the sweep the time its loads need.
  test.setTimeout(180_000);
  await signInAs(page, 'HR Officer');

  // Work from a real case so the case surfaces have content to lay out. A
  // fresh database has none, and a sweep that silently skipped them would
  // report coverage it never had - so this creates one rather than looking
  // for one.
  await page.goto('/cases/new');
  await page.getByLabel('Employee Name or Number').fill('avery');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page
    .locator(`input[name="type"][value=${JSON.stringify('RESIGNATION_WITH_NOTICE')}]`)
    .check();
  await page.getByRole('button', { name: 'Use this separation type' }).click();
  await page.locator('input[name="receivedAt"]').fill('2026-07-20T09:30');
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
  const caseHref = new URL(page.url()).pathname;
  expect(caseHref, 'the sweep needs a case to lay out').toContain('/cases/');

  const routes: Array<{ name: string; path: string }> = [
    { name: 'dashboard', path: '/' },
    { name: 'case-list', path: '/cases' },
    { name: 'case-list-filtered', path: '/cases?attention=yes&leaving=month' },
    { name: 'new-case', path: '/cases/new' },
    { name: 'reports', path: '/reports?report=volumeTrend' },
    { name: 'directory', path: '/directory' },
    { name: 'exceptions', path: '/exceptions' },
  ];
  if (caseHref) {
    for (const tab of ['', '/workflow', '/documents', '/action-form', '/assets', '/clearance']) {
      routes.push({
        name: `case${tab.replace('/', '-') || '-overview'}`,
        path: `${caseHref}${tab}`,
      });
    }
  }

  for (const vp of WIDTHS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const route of routes) {
      await page.goto(route.path, { waitUntil: 'networkidle' });
      await assertNoHorizontalOverflow(page, `${route.name} at ${vp.name} (${vp.width}px)`);
    }
  }
});

test('the primary navigation is reachable at every width', async ({ page }) => {
  await signInAs(page, 'HR Officer');
  for (const vp of WIDTHS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/cases', { waitUntil: 'networkidle' });
    // Either the persistent side navigation is visible, or the small-screen
    // menu control that opens it is. A width where neither is reachable
    // strands the reader on whatever page they happened to land on.
    const sideNav = page.locator('nav a[href="/cases"]').first();
    const menu = page.getByRole('button', { name: /menu/i }).first();
    const reachable =
      (await sideNav.isVisible().catch(() => false)) || (await menu.isVisible().catch(() => false));
    expect(reachable, `no route to the rest of the app at ${vp.width}px`).toBe(true);
  }
});
