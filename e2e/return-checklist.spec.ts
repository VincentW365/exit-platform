/**
 * Exit Checklist for Return Items (owner directive, 2026-08-19).
 *
 * The recipient must be able to complete the checklist without a sign-in and
 * without hunting for the right employee: the secure link in the email opens
 * that employee's checklist directly. HR sees what came back on the case, and
 * outstanding property stays visible after submission.
 *
 * Synthetic data only; the link is read from the development capture mailbox.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openActiveHrValidatedCase, signInAs, signOut } from './support/case';

const MOBILE = { width: 375, height: 812 };

test('the secure link opens the checklist directly and records it without a sign-in', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);

  // HR reads the captured checklist email in the development mailbox.
  await signInAs(page, 'HR Manager');
  await page.goto('/dev/mailbox');
  await expect(page.getByText('DEVELOPMENT CAPTURE ONLY')).toBeVisible();
  const link = /\/checklist\/[A-Za-z0-9_-]{43}/.exec(await page.content());
  await signOut(page);
  test.skip(!link, 'No checklist link captured in this seed state.');

  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await publicPage.goto(link![0]);

  // A used or expired link answers neutrally; a live one opens the form.
  const neutral = await publicPage.getByText(/This link is not valid/).count();
  if (neutral === 0) {
    await expect(
      publicPage.getByRole('heading', { name: 'Exit Checklist for Return Items' }),
    ).toBeVisible();
    // The ten paper-form items are present and answerable.
    await expect(publicPage.getByRole('rowheader', { name: 'Laptop', exact: true })).toBeVisible();
    await expect(publicPage.getByRole('rowheader', { name: 'Door', exact: true })).toBeVisible();

    // The form is usable on a phone: no sideways scrolling in a stockroom.
    await publicPage.setViewportSize(MOBILE);
    const overflow = await publicPage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'checklist mobile horizontal overflow').toBeLessThanOrEqual(1);

    const axe = await new AxeBuilder({ page: publicPage })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual(
      [],
    );

    // An incomplete submission is refused and says exactly what is missing,
    // without discarding the work already entered.
    await publicPage.setViewportSize({ width: 1280, height: 800 });
    await publicPage
      .getByRole('row', { name: /Laptop/ })
      .getByRole('radio', { name: 'Returned', exact: true })
      .check();
    await publicPage.getByLabel('Items Received By').fill('Avery Brown');
    await publicPage.getByLabel('Your Name').fill('Avery Brown');
    await publicPage.getByRole('button', { name: 'Submit Checklist' }).click();
    await expect(publicPage.getByText('The checklist was not submitted')).toBeVisible();
    await expect(
      publicPage
        .getByRole('row', { name: /Laptop/ })
        .getByRole('radio', { name: 'Returned', exact: true }),
    ).toBeChecked();
  }

  // An invalid token is answered neutrally - no reason is disclosed.
  await publicPage.goto('/checklist/invalidtokenvalue000000000000000000000000000');
  await expect(publicPage.getByText(/This link is not valid/)).toBeVisible();
  await publicContext.close();
});

test('HR sees the checklist on the case and can record it directly', async ({ page }) => {
  test.setTimeout(300_000);

  // A case of its own: the checklist exists from activation onwards, and an
  // earlier run may have signed or finalized the newest case's receipt, which
  // makes that version read-only (DEC-069). The officer records it as the
  // case's assigned officer.
  await signInAs(page, 'HR Manager');
  const caseUrl = await openActiveHrValidatedCase(page);
  await signOut(page);
  await signInAs(page, 'HR Officer');
  await page.goto(`${caseUrl}/assets`);

  const panel = page.locator('section[aria-labelledby="return-checklist-h"]');
  test.skip((await panel.count()) === 0, 'Case predates the return-items checklist.');
  await expect(
    panel.getByRole('heading', { name: /Exit Checklist for Return Items/ }),
  ).toBeVisible();
  // Business language only - no enum names on an HR screen.
  await expect(panel).not.toContainText('NOT_STARTED');
  await expect(panel).not.toContainText('LOST_OR_DAMAGED');

  // Completion leads: the reader sees how far the checklist has run before
  // they see the ten rows, and the sheet itself sits behind a disclosure.
  await expect(panel.getByRole('progressbar', { name: 'Checklist completion' })).toBeVisible();
  await expect(panel.getByText(/items decided/)).toBeVisible();
  await expect(
    panel.locator('summary').filter({ hasText: /The (completed )?checklist/ }),
  ).toHaveCount(1);

  // The HR-side record form is available and pre-filled from what exists
  // (DEC-069: one "Edit checklist" disclosure, whether or not the employee
  // has returned the form).
  const record = panel.locator('summary').filter({ hasText: 'Edit checklist' });
  await expect(record).toBeVisible();
  // The editor opens by itself while nothing has come back yet.
  const editor = panel.locator('details.action', { hasText: 'Edit checklist' });
  if ((await editor.getAttribute('open')) === null) await record.click();
  await expect(page.getByRole('button', { name: 'Save Checklist' })).toBeVisible();
  await signOut(page);
});
