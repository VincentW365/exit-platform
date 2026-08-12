/**
 * UAT visual spot-check (Directive 5 section F): TABLET viewport coverage of
 * representative role surfaces. Desktop and mobile (plus keyboard/zoom and
 * full axe sweeps) are already covered by the acceptance/stage visual suites;
 * this adds only the missing tablet evidence to artifacts/uat/ (gitignored).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const OUT = 'artifacts/uat';
const TABLET = { width: 768, height: 1024 };

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

async function tabletCheck(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/${name}-tablet.png`, fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${name} tablet overflow`).toBeLessThanOrEqual(1);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(
    serious.map((v) => `${name}: [${v.impact}] ${v.id} - ${v.help} (${v.nodes.length})`),
  ).toEqual([]);
}

test('UAT tablet spot-check: representative surfaces per role', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(TABLET);

  await signInAs(page, 'HR Manager');
  await tabletCheck(page, '01-dashboard');
  await page.goto('/cases');
  await tabletCheck(page, '02-case-list');
  await page.goto('/reports');
  await tabletCheck(page, '03-reports');
  await page.goto('/admin/pilot');
  await tabletCheck(page, '04-pilot');
  await page.goto('/continuity');
  await tabletCheck(page, '05-continuity');
  await signOut(page);

  await signInAs(page, 'IT Responder');
  await page.goto('/queue');
  await tabletCheck(page, '06-department-queue');
  await signOut(page);

  await signInAs(page, 'System Administrator');
  await page.goto('/admin/health');
  await tabletCheck(page, '07-health');
  await signOut(page);
});
