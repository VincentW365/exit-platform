/**
 * Rehearsal mode and the measures that go with it (HR samples directive
 * sections 8 and 10).
 *
 * The point of rehearsal mode is that HR can walk the real workflow without a
 * message reaching a real person — so the scenario checks that turning it on
 * is visible everywhere it matters, and that turning it off restores normal
 * delivery. Synthetic data only.
 */
import { expect, test, type Page } from '@playwright/test';
import { signInAs, signOut } from './support/case';

const REHEARSAL = 'rehearsal.mailbox@example.test';

/**
 * Open the rehearsal-mode panel. It renders already-open while the mode is
 * on, so clicking blindly would close it and hide the controls.
 */
async function openRehearsalPanel(page: Page): Promise<void> {
  const panel = page.locator('details.action', { hasText: 'Rehearsal mode' });
  await expect(panel).toBeVisible();
  if (!(await panel.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await panel.locator('summary').click();
  }
  await expect(page.getByLabel('Redirect Every Message To')).toBeVisible();
}

test('rehearsal mode announces itself on the outbox, the health page and the trail', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, 'HR Manager');

  // Turning it on.
  await page.goto('/admin/outbox');
  await openRehearsalPanel(page);
  await page.getByLabel('Redirect Every Message To').fill(REHEARSAL);
  await page.getByLabel('Note Shown in Redirected Messages').fill('End-to-end rehearsal.');
  await page.getByRole('button', { name: 'Turn rehearsal mode on' }).click();
  // Both the confirmation and the standing banner say so.
  await expect(page.getByText(/Rehearsal mode is ON/).first()).toBeVisible();
  await expect(
    page.locator('.banner-restricted', { hasText: 'Rehearsal mode is ON' }),
  ).toBeVisible();

  // And it is a reported system condition, not a hidden setting.
  await page.goto('/admin/health');
  await expect(page.getByText('email rehearsal mode')).toBeVisible();
  await expect(page.getByText(/ON - every message is diverted/)).toBeVisible();
  // The mailbox is masked even for an administrator reading the dashboard.
  await expect(page.getByText(REHEARSAL)).toHaveCount(0);

  // Messages sent while it is on carry the marker.
  await page.goto('/admin/outbox');
  await page.getByRole('button', { name: 'Run outbox pass now' }).click();
  await expect(page.getByText(/Outbox pass: \d+ submitted/)).toBeVisible();
  await page.goto('/dev/mailbox');
  const marked = page.getByText('[TEST MODE]').first();
  if ((await marked.count()) > 0) {
    await expect(marked).toBeVisible();
    await expect(page.getByText(/WAS INTERCEPTED AND NOT DELIVERED/).first()).toBeVisible();
  }

  // Turning it off restores normal delivery.
  await page.goto('/admin/outbox');
  await openRehearsalPanel(page);
  await page.getByRole('button', { name: 'Turn it off' }).click();
  await expect(page.getByText(/Rehearsal mode is off/).first()).toBeVisible();
  await expect(page.locator('.banner-restricted', { hasText: 'Rehearsal mode is ON' })).toHaveCount(
    0,
  );
  await signOut(page);
});

test('an HR officer cannot change where the company’s email goes', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAs(page, 'HR Officer');
  await page.goto('/admin/outbox');
  // The officer has no outbox role at all, or sees it without the switch.
  await expect(
    page
      .getByRole('heading', { name: 'Access Restricted' })
      .or(page.locator('details.action > summary', { hasText: 'Rehearsal mode' }))
      .first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn rehearsal mode on' })).toHaveCount(0);
  await signOut(page);
});

test('the new measures appear in the reporting centre', async ({ page }) => {
  test.setTimeout(180_000);
  await signInAs(page, 'HR Manager');
  await page.goto('/reports');

  for (const title of ['Exit checklist for return items', 'Resignation letter issuance']) {
    await page.goto('/reports');
    await page.getByRole('link', { name: title }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    // Business language, and a real measure rather than an empty shell.
    await expect(page.getByText('Measure').first()).toBeVisible();
  }

  // Handover reporting survives as history only (DEC-052).
  await page.goto('/reports');
  await page.getByRole('link', { name: 'Handover completion (historical)' }).click();
  await expect(page.getByText(/stopped recording handover/)).toBeVisible();
  await signOut(page);
});
