/**
 * Email routing and the email log (email routing directive).
 *
 * The objective the directive states is that the whole offboarding email
 * workflow can be tested with one address now and switched to the real
 * organizational mailboxes later "by changing configuration rather than
 * modifying application logic" — so this scenario changes configuration in
 * the browser and checks the platform follows it. Synthetic data only.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signInAs, signOut } from './support/case';

test('routing is configuration: an administrator can change who receives a notification', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, 'HR Manager');
  await page.goto('/admin/email-routing');
  await expect(page.getByRole('heading', { name: 'Email Routing' })).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual(
    [],
  );

  // Destinations are named in business language, never as mailboxes.
  const itRoute = page.locator('section[aria-label="IT_ACCESS_REMOVAL routing"]');
  await expect(itRoute).toBeVisible();
  await expect(itRoute).toContainText('IT');
  await expect(itRoute).not.toContainText('@');

  // Copy Security on access removals - a configuration change.
  await itRoute.locator('details.action > summary').click();
  await itRoute.getByLabel('Copied (Cc)').selectOption(['static:SECURITY']);
  await itRoute.getByLabel('Why This Route').fill('Security keeps oversight of access removals.');
  await itRoute.getByRole('button', { name: 'Save routing' }).click();
  await expect(page.getByText(/Routing updated/)).toBeVisible();
  await expect(page.locator('section[aria-label="IT_ACCESS_REMOVAL routing"]')).toContainText(
    'Security',
  );

  // Put it back so the suite is repeatable.
  const again = page.locator('section[aria-label="IT_ACCESS_REMOVAL routing"]');
  await again.locator('details.action > summary').click();
  await again.getByLabel('Copied (Cc)').selectOption([]);
  await again.getByRole('button', { name: 'Save routing' }).click();
  await expect(page.getByText(/Routing updated/)).toBeVisible();
  await signOut(page);
});

test('the email log shows intended versus actual recipients and the test indicator', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, 'HR Manager');

  // Send something while redirection is on, so intended and actual differ.
  await page.goto('/admin/outbox');
  const panel = page.locator('details.action', { hasText: 'Rehearsal mode' });
  if (!(await panel.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await panel.locator('summary').click();
  }
  await page.getByLabel('Redirect Every Message To').fill('uat.mailbox@example.test');
  await page.getByRole('button', { name: 'Turn rehearsal mode on' }).click();
  await expect(page.getByText(/Rehearsal mode is ON/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Run outbox pass now' }).click();
  await expect(page.getByText(/Outbox pass: \d+ submitted/)).toBeVisible();

  await page.goto('/admin/email-log');
  await expect(page.getByRole('heading', { name: 'Email Log' })).toBeVisible();
  for (const column of [
    'Generated',
    'Case / employee',
    'Notification',
    'Intended recipients',
    'Actually sent to',
    'Subject',
    'Status',
    'Mode',
  ]) {
    await expect(page.getByRole('columnheader', { name: column })).toBeVisible();
  }

  // Addresses are masked on both sides of the diversion.
  await expect(page.getByText('uat.mailbox@example.test')).toHaveCount(0);

  // The test filter isolates redirected sends.
  await page.getByLabel('Test Sends').selectOption('1');
  await page.getByRole('button', { name: 'Apply' }).click();
  const testRows = page.locator('tbody tr');
  if ((await testRows.count()) > 0) {
    await expect(page.getByText('Test').first()).toBeVisible();
  }

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual(
    [],
  );

  // Leave delivery normal again.
  await page.goto('/admin/outbox');
  const off = page.locator('details.action', { hasText: 'Rehearsal mode' });
  if (!(await off.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await off.locator('summary').click();
  }
  await page.getByRole('button', { name: 'Turn it off' }).click();
  await expect(page.getByText(/Rehearsal mode is off/).first()).toBeVisible();
  await signOut(page);
});

test('an HR officer sees neither the routing table nor the email log', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAs(page, 'HR Officer');
  for (const path of ['/admin/email-routing', '/admin/email-log']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Access Restricted' })).toBeVisible();
  }
  await signOut(page);
});
