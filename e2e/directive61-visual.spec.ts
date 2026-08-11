/**
 * Directive 6.1 visual + accessibility QA (section AN): the new surfaces at
 * 1440 / 1280 / 768 / 375, axe wcag2a+aa with zero critical/serious, no
 * horizontal overflow. Screenshots to gitignored artifacts/directive61/.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const OUT = 'artifacts/directive61';
const WIDTHS = [
  ['desktop-xl', 1440, 900],
  ['laptop', 1280, 800],
  ['tablet', 768, 1024],
  ['mobile', 375, 812],
] as const;

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

async function sweep(page: Page, name: string): Promise<void> {
  for (const [label, width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `${OUT}/${name}-${label}.png`, fullPage: true });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${name} ${label} overflow`).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(
    serious.map((v) => `${name}: [${v.impact}] ${v.id} - ${v.help} (${v.nodes.length})`),
  ).toEqual([]);
}

test('directive 6.1 surfaces: responsive + axe sweep', async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1280, height: 800 });

  await signInAs(page, 'Dana Field');
  // Dashboard with the attention row.
  await sweep(page, '01-dashboard-attention');

  // A case for header/progress/assignment surfaces.
  await page.goto('/cases');
  await page
    .getByRole('link', { name: /OFF-\d{4}-\d{4}/ })
    .first()
    .click();
  await page.waitForLoadState('load');
  await sweep(page, '02-case-header-progress');
  const caseUrl = page.url().split('?')[0]!.replace(/#.*$/, '');
  await page.goto(`${caseUrl}/assignment`);
  await sweep(page, '03-assignment-plan');

  await page.goto('/admin/organization');
  await sweep(page, '04-organization-mapping');

  await page.goto('/audit');
  await sweep(page, '05-audit-centre');
  await signOut(page);

  await signInAs(page, 'Sam Chen');
  await page.goto('/queue?view=unassigned');
  await sweep(page, '06-it-queue-claim');
  await signOut(page);
});
