/**
 * Stage 4 visual QA + accessibility (Directive 4 section Y).
 * Screenshot set to artifacts/stage4/ (gitignored, synthetic data only);
 * axe scans assert no critical/serious violations on every new surface.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const OUT = 'artifacts/stage4';
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

test('stage 4 surfaces: visual + axe sweep', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize(DESKTOP);

  // Business administration surfaces (HR Manager).
  await signInAs(page, 'HR Manager');
  await page.goto('/admin');
  await snap(page, '01-administration-centre', true);
  await axeCheck(page, 'administration-centre');

  await page.goto('/admin/recipients');
  await snap(page, '02-recipient-directory', true);
  await axeCheck(page, 'recipient-directory');

  await page.goto('/admin/reasons');
  await snap(page, '03-reason-taxonomy', true);
  await axeCheck(page, 'reason-taxonomy');

  await page.goto('/admin/pilot');
  await snap(page, '04-pilot-readiness', true);
  await axeCheck(page, 'pilot-readiness');

  await page.goto('/admin/outbox');
  await snap(page, '05-outbox-monitor', true);
  await axeCheck(page, 'outbox-monitor');

  await page.goto('/reports');
  await snap(page, '06-report-catalog', true);
  await axeCheck(page, 'report-catalog');
  await page.goto('/reports?report=volumeTrend');
  await snap(page, '07-report-result');
  await axeCheck(page, 'report-result');

  await page.goto('/dev/mailbox');
  await snap(page, '08-dev-mailbox', true);
  await axeCheck(page, 'dev-mailbox');

  await page.goto('/continuity');
  await snap(page, '09-continuity', true);
  await axeCheck(page, 'continuity');

  await page.goto('/operations');
  await snap(page, '10-operations-sop', true);
  await axeCheck(page, 'operations-sop');

  await page.goto('/support');
  await snap(page, '11-support', true);
  await axeCheck(page, 'support');
  await signOut(page);

  // Technical administration surfaces (System Administrator).
  await signInAs(page, 'System Administrator');
  await page.goto('/admin/system');
  await snap(page, '12-system-administration', true);
  await axeCheck(page, 'system-administration');

  await page.goto('/admin/health');
  await snap(page, '13-integration-health', true);
  await axeCheck(page, 'integration-health');
  await signOut(page);

  // Privacy operations surface (Privacy Officer).
  await signInAs(page, 'Privacy Officer');
  await page.goto('/admin/privacy');
  await snap(page, '14-privacy-retention', true);
  await axeCheck(page, 'privacy-retention');
  await signOut(page);
});
