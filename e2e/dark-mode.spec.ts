/**
 * Dark mode: explicit toggle, persistence across reload and navigation, and
 * WCAG 2.2 AA contrast in the dark palette (axe). The default remains the
 * established light theme unless the visitor's system prefers dark.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('theme toggles, persists, and the dark palette passes axe', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Toggle available before sign-in.
  await page.goto('/signin');
  await page.getByRole('button', { name: 'Dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // The choice survives sign-in and navigation (cookie + server stamping).
  await page.getByRole('button', { name: 'Sign in as HR Manager', exact: true }).click();
  await page.waitForURL('**/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Dark palette meets contrast on business-heavy surfaces.
  for (const route of ['/', '/cases', '/queue', '/audit']) {
    await page.goto(route);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
      `axe (dark) on ${route}`,
    ).toEqual([]);
  }

  // Back to light; the choice persists the same way.
  await page.getByRole('button', { name: 'Light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/signin');
});

test('topbar quick search jumps to filtered cases', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/signin');
  await page.getByRole('button', { name: 'Sign in as HR Officer', exact: true }).click();
  await page.waitForURL('**/');
  const box = page.getByLabel('Find a case by number or employee');
  await box.fill('OFF-2026');
  await box.press('Enter');
  await page.waitForURL('**/cases?q=OFF-2026');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/cases/i);
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/signin');
});
