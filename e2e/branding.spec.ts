/**
 * Directive 5.1 K.16/K.17/K.20: the approved brand asset loads with
 * accessible alternative text on the shell and sign-in screens, and layouts
 * stay usable on desktop and mobile. Synthetic accounts only.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 375, height: 812 };

async function noOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} horizontal overflow`).toBeLessThanOrEqual(1);
}

test('brand asset and accessible alt text on sign-in and application shell', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(DESKTOP);

  // Sign-in branding (H.8) with accessible alternative text (H.6).
  await page.goto('/signin');
  const signinLogo = page.getByRole('img', { name: "Bert's Auto Parts" });
  await expect(signinLogo).toBeVisible();
  const assetResponse = await page.request.get('/brand/berts-auto-parts.png');
  expect(assetResponse.status()).toBe(200);
  expect(assetResponse.headers()['content-type']).toContain('image/png');
  const axeSignin = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    axeSignin.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
  ).toEqual([]);
  await noOverflow(page, 'signin desktop');

  // Application shell branding after sign-in (H.8/H.10) - the logo lives in
  // the sidebar since the shell redesign.
  await page.getByRole('button', { name: 'Sign in as HR Manager' }).click();
  await page.waitForURL('**/');
  await expect(
    page.locator('.sidebar').getByRole('img', { name: "Bert's Auto Parts" }),
  ).toBeVisible();
  await noOverflow(page, 'dashboard desktop');

  // The logo is intentionally NOT repeated across content panels (H.9).
  expect(await page.getByRole('img', { name: "Bert's Auto Parts" }).count()).toBe(1);

  // Mobile usability (H.11/K.20): the brand sits in the drawer menu.
  await page.setViewportSize(MOBILE);
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('img', { name: "Bert's Auto Parts" }).first()).toBeVisible();
  // The backdrop spans the viewport; click the strip right of the drawer.
  await page
    .getByRole('button', { name: 'Close the menu' })
    .click({ position: { x: 330, y: 300 } });
  await noOverflow(page, 'dashboard mobile');
  await page.goto('/cases/new');
  await noOverflow(page, 'case creation mobile');
  await page.setViewportSize(DESKTOP);
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/signin');
});

test('directory page is HR-scoped and the employee selector shows provenance', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(DESKTOP);

  // HR Officer: directory + provenance-badged employee search.
  await page.goto('/signin');
  await page.getByRole('button', { name: 'Sign in as HR Officer' }).click();
  await page.waitForURL('**/');
  await page.goto('/directory');
  await expect(page.getByRole('heading', { name: 'Employee Directory' })).toBeVisible();
  await page.goto('/directory/organization');
  await expect(page.getByRole('heading', { name: 'Organization Overview' })).toBeVisible();
  await page.goto('/cases/new?q=avery');
  // Final-product surface (owner request, 2026-08-17): no cache/provenance
  // chrome in the selector - plain results with a match count.
  await expect(page.getByText(/match(es)? for "avery"/)).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Source' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Last sync' })).toHaveCount(0);
  await expect(
    page.locator('details.action > summary', {
      hasText: 'Directory unavailable? Enter the employee manually',
    }),
  ).toBeVisible();
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/signin');

  // SYSTEM_ADMIN: no directory access, but technical status on /admin/system.
  await page.getByRole('button', { name: 'Sign in as System Administrator' }).click();
  await page.waitForURL('**/');
  await page.goto('/directory');
  await expect(
    page.getByText('The employee directory is limited to authorized HR roles.'),
  ).toBeVisible();
  await page.goto('/admin/system');
  await expect(page.getByText('Credential status:')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test connection (read-only)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Purge live directory cache' })).toBeVisible();
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/signin');
});
