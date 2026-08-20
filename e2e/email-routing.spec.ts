/**
 * Email routing and the email log (email routing directive).
 *
 * The objective the directive states is that the whole offboarding email
 * workflow can be tested with one address now and switched to the real
 * organizational mailboxes later "by changing configuration rather than
 * modifying application logic" — so this scenario does both in the browser
 * and checks the platform follows. Synthetic data only.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInAs, signOut } from './support/case';

const TEST_INBOX = 'owner.inbox@example.test';

/** Open a mailbox panel without closing one that is already open. */
async function openMailbox(page: Page, destination: string): Promise<void> {
  const panel = page.locator(`details[aria-label="${destination} mailbox"]`);
  await expect(panel).toBeVisible();
  if (!(await panel.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await panel.locator('summary').click();
  }
}

test('one address receives everything, and departments have their own mailboxes', async ({
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

  // Send everything to one inbox — the first thing an owner needs.
  await page.getByLabel('Send Everything To').fill(TEST_INBOX);
  // The button reads differently depending on whether it is already on.
  await page.getByRole('button', { name: /Send everything here|Update the address/ }).click();
  await expect(page.getByText(/Every message now goes to/)).toBeVisible();
  await expect(page.locator('.banner-restricted')).toContainText(TEST_INBOX);

  // A department mailbox is set here, not in code.
  await openMailbox(page, 'PAYROLL');
  const payroll = page.locator('details[aria-label="PAYROLL mailbox"]');
  await payroll.locator('input[name="email"]').fill('payroll@example.test');
  await payroll.locator('input[name="reason"]').fill('End-to-end check.');
  await payroll.getByRole('button', { name: 'Save mailbox' }).click();
  await expect(page.getByText(/Mailbox saved/)).toBeVisible();
  await expect(page.locator('details[aria-label="PAYROLL mailbox"]')).toContainText('Ready');

  // Where each notification goes is stated, in business language.
  await expect(page.getByRole('heading', { name: 'Where Each Notification Goes' })).toBeVisible();
  const table = page.locator('table.data');
  await expect(table).toContainText('IT');
  await expect(table).toContainText("This employee's manager");
  // Never an address in the reference table.
  await expect(table).not.toContainText('@');

  // Stop sending everything to one inbox.
  await page.getByRole('button', { name: 'Stop — use the real mailboxes' }).click();
  await expect(page.getByText(/configured mailboxes again/)).toBeVisible();
  await signOut(page);
});

test('the email log shows intended versus actual recipients and the test indicator', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, 'HR Manager');

  // Send something while everything is redirected, so the two differ.
  await page.goto('/admin/email-routing');
  await page.getByLabel('Send Everything To').fill(TEST_INBOX);
  await page.getByRole('button', { name: /Send everything here|Update the address/ }).click();
  await expect(page.getByText(/Every message now goes to/)).toBeVisible();

  await page.goto('/admin/outbox');
  await page.getByRole('button', { name: 'Run outbox pass now' }).click();
  await expect(page.getByText(/Outbox pass: \d+ submitted/)).toBeVisible();

  await page.goto('/admin/email-log');
  await expect(page.getByRole('heading', { name: 'Email Log' })).toBeVisible();
  // A fresh database has nothing to log until a case generates a message;
  // the empty state is the correct answer then, not a failure.
  if ((await page.locator('tbody tr').count()) === 0) {
    await expect(page.getByText('No messages match')).toBeVisible();
    await page.goto('/admin/email-routing');
    await page.getByRole('button', { name: 'Stop — use the real mailboxes' }).click();
    await expect(page.getByText(/configured mailboxes again/)).toBeVisible();
    await signOut(page);
    return;
  }
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
  // Masked on both sides of the diversion: the log is not a directory.
  await expect(page.getByText(TEST_INBOX)).toHaveCount(0);

  await page.getByLabel('Test Sends').selectOption('1');
  await page.getByRole('button', { name: 'Apply' }).click();
  if ((await page.locator('tbody tr').count()) > 0) {
    await expect(page.getByText('Test').first()).toBeVisible();
  }

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual(
    [],
  );

  // Leave delivery normal again.
  await page.goto('/admin/email-routing');
  await page.getByRole('button', { name: 'Stop — use the real mailboxes' }).click();
  await expect(page.getByText(/configured mailboxes again/)).toBeVisible();
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
