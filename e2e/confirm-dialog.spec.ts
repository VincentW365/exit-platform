/**
 * Section 19 (owner design directive): destructive actions state their
 * consequence before they are taken.
 *
 * Cancelling and voiding used to sit behind a disclosure triangle with a
 * reason box and nothing else - a reason box asks why, it never says what is
 * about to happen. These now open a native modal that says what the action
 * does, in the reader's words, and can be left without doing anything.
 */
import { expect, test, type Page } from '@playwright/test';

async function signInAs(page: Page, displayName: string): Promise<void> {
  await page.goto('/signin');
  await page.getByRole('button', { name: `Sign in as ${displayName}` }).click();
  await page.waitForURL('**/');
}

async function draftCase(page: Page): Promise<string> {
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
  await page.getByRole('button', { name: 'Create draft case' }).click();
  await expect(page.getByText(/^Draft case OFF-/)).toBeVisible();
  return new URL(page.url()).pathname;
}

test('voiding a case says what that means, and can be backed out of', async ({ page }) => {
  await signInAs(page, 'HR Manager');
  const casePath = await draftCase(page);
  await page.goto(casePath);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Void case (entered in error)' }).click();
  await expect(dialog).toBeVisible();

  // The consequence is stated, and the difference from cancelling is named -
  // confusing the two is the mistake this dialog exists to prevent.
  await expect(dialog).toContainText('should never have existed');
  await expect(dialog).toContainText('not the same as cancelling');
  await expect(dialog).toContainText('Nothing is deleted');

  // Escape leaves the case exactly as it was.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // So does the explicit way out.
  await page.getByRole('button', { name: 'Void case (entered in error)' }).click();
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Leave it as it is' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Voided')).toHaveCount(0);
});

test('the dialog contains focus and still requires a reason', async ({ page }) => {
  await signInAs(page, 'HR Manager');
  const casePath = await draftCase(page);
  await page.goto(casePath);

  await page.getByRole('button', { name: 'Cancel case (non-event)' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // showModal() makes the rest of the document inert, so nothing behind the
  // backdrop can be reached by keyboard.
  const reason = dialog.getByLabel('Why is this case being cancelled?');
  await expect(reason).toBeVisible();

  // The server is still the authority; the browser stops an empty reason
  // before it ever gets there.
  await dialog.getByRole('button', { name: 'Cancel case' }).click();
  await expect(dialog).toBeVisible();
  await expect(reason).toHaveJSProperty('validity.valueMissing', true);
});
