/**
 * Case creation as a progressive step accordion (owner directive,
 * 2026-08-27).
 *
 * The behaviour worth protecting is not "an accordion renders" - it is that
 * finishing a step moves it out of the way WITHOUT costing the reader
 * anything: the value is still there, the step still reopens, and a step
 * that stops holding what it needs stops claiming to be complete.
 */
import { expect, test, type Page } from '@playwright/test';

// A last working day that stays in the future whenever the suite runs; a
// fixed date fell behind the calendar and the wizard rightly refused it.
const LAST_DAY = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
// The same day as the wizard summarises it: "25 Sep 2026".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LAST_DAY_TEXT = `${Number(LAST_DAY.slice(8, 10))} ${MONTHS[Number(LAST_DAY.slice(5, 7)) - 1]} ${LAST_DAY.slice(0, 4)}`;

async function signInAs(page: Page, displayName: string): Promise<void> {
  await page.goto('/signin');
  await page.getByRole('button', { name: `Sign in as ${displayName}` }).click();
  await page.waitForURL('**/');
}

/** Choose an employee and a separation type, landing on the dates step. */
async function openWizard(page: Page, type: string): Promise<void> {
  await page.goto('/cases/new?q=avery');
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page.locator(`input[name="type"][value="${type}"]`).check();
  await page.getByRole('button', { name: 'Use this separation type' }).click();
  await page.waitForLoadState('networkidle');
}

const step = (page: Page, id: string) => page.locator(`.step:has([data-step="${id}"])`);

test('choosing an employee settles that step and opens the next', async ({ page }) => {
  await signInAs(page, 'HR Officer');
  await page.goto('/cases/new?q=avery');

  // Before anything is chosen the first step is the workspace.
  await expect(step(page, 'employee')).toHaveClass(/step--active/);
  await expect(page.locator('[data-step="employee"]')).toBeVisible();

  await page.getByRole('link', { name: 'Select' }).first().click();

  // It resolves into a one-line summary and the next step takes over.
  const employee = step(page, 'employee');
  await expect(employee).toHaveClass(/step--settled/);
  await expect(employee).toContainText('Avery Brown');
  await expect(step(page, 'separation')).toHaveClass(/step--active/);
});

test('a settled step still reopens, and its content was never lost', async ({ page }) => {
  await signInAs(page, 'HR Officer');
  await openWizard(page, 'RESIGNATION_WITH_NOTICE');

  const lastDay = page.locator('input[name="confirmedLastDay"]');
  await lastDay.fill(LAST_DAY);
  await page
    .locator('[data-step="dates"]')
    .getByRole('button', { name: 'Save & continue' })
    .click();

  // Collapsed, summarised - and the value is still in the form, not thrown
  // away with the panel (directive section 10).
  const dates = step(page, 'dates');
  await expect(dates).toHaveClass(/step--settled/);
  // The summary reads as a date, not as the control's raw input format.
  await expect(dates).toContainText(LAST_DAY_TEXT);
  await expect(page.locator('[data-step="dates"]')).toBeHidden();
  await expect(lastDay).toHaveValue(LAST_DAY);

  // The header reopens it without any backwards navigation.
  await dates.getByRole('button').first().click();
  await expect(page.locator('[data-step="dates"]')).toBeVisible();
  await expect(lastDay).toHaveValue(LAST_DAY);
});

test('a step that stops holding what it needs stops claiming to be complete', async ({ page }) => {
  await signInAs(page, 'HR Officer');
  await openWizard(page, 'RESIGNATION_WITH_NOTICE');

  await page
    .locator('[data-step="dates"]')
    .getByRole('button', { name: 'Save & continue' })
    .click();
  await expect(step(page, 'dates')).toHaveClass(/step--settled/);

  // Reopen and empty a required field: the checkmark is not a sticker.
  await step(page, 'dates').getByRole('button').first().click();
  await page.locator('input[name="receivedAt"]').fill('');
  await expect(step(page, 'dates')).toHaveClass(/step--attention/);
  await expect(step(page, 'dates')).toContainText('Needs attention');
});

test('the separation type decides which steps exist at all', async ({ page }) => {
  await signInAs(page, 'HR Officer');

  // A termination has no notice concept, so the step is not called notice
  // and the contract date is absent entirely (directive section 6).
  await openWizard(page, 'TERMINATION');
  await expect(step(page, 'dates')).toContainText('Dates');
  await expect(page.locator('input[name="contractEndDate"]')).toHaveCount(0);
  await expect(page.locator('[data-step="dates"]')).not.toContainText('Notice arrangement');
  // An employer-initiated separation asks who authorized it.
  await expect(step(page, 'about')).toBeVisible();

  // "Other" cannot be inferred, so it gains a step that a resignation does
  // not have at all.
  await openWizard(page, 'OTHER');
  await expect(page.locator('input[name="separationTypeDetail"]')).toHaveCount(1);

  await openWizard(page, 'RESIGNATION_WITH_NOTICE');
  await expect(page.locator('[data-step="dates"]')).toContainText('Notice arrangement');
  await expect(page.locator('input[name="separationTypeDetail"]')).toHaveCount(0);
  await expect(step(page, 'about')).toHaveCount(0);
});

test('the review step restates every earlier step and can reopen each one', async ({ page }) => {
  await signInAs(page, 'HR Officer');
  await openWizard(page, 'IMMEDIATE_RESIGNATION');

  await step(page, 'review').getByRole('button').first().click();
  const review = page.locator('[data-step="review"]');
  await expect(review).toBeVisible();
  await expect(review).toContainText('Avery Brown');
  await expect(review).toContainText('Resignation - immediate');

  // Each block leads straight back to the step it summarises.
  await review.locator('.review-group', { hasText: 'Dates' }).getByRole('button').click();
  await expect(page.locator('[data-step="dates"]')).toBeVisible();
});

test('the wizard creates the case, and only from the final action', async ({ page }) => {
  await signInAs(page, 'HR Officer');
  await openWizard(page, 'RESIGNATION_WITH_NOTICE');

  await page.locator('input[name="confirmedLastDay"]').fill(LAST_DAY);
  // Enter inside a field must not submit the half-finished form.
  await page.locator('input[name="confirmedLastDay"]').press('Enter');
  await page.waitForTimeout(500);
  expect(page.url()).toContain('/cases/new');

  await step(page, 'review').getByRole('button').first().click();
  // DEC-061: a fixture employee may already have a live case; confirm the deliberate
  // second one. The confirmation lives in the Review step, so make sure it is open.
  if (await page.getByLabel(/I confirm this is a separate separation event/).count()) {
    const reviewHeader = page.locator('.step:has([data-step="review"]) .step__header');
    if ((await reviewHeader.getAttribute('aria-expanded')) !== 'true') await reviewHeader.click();
    await page.getByLabel(/I confirm this is a separate separation event/).check();
  }
  await page.getByRole('button', { name: 'Create draft case' }).click();
  // Assert on the confirmation banner itself: by the time the whole suite has
  // run, this employee has several open cases and the banner carries a
  // duplicate warning after the case number.
  await expect(page.locator('.ok-summary')).toContainText(/Draft case OFF-/);
});

test('progress counts steps that are genuinely complete', async ({ page }) => {
  await signInAs(page, 'HR Officer');
  await openWizard(page, 'RESIGNATION_WITH_NOTICE');

  const progress = page.locator('.step-progress__text');
  // Employee, separation type and (for an officer) HR ownership are settled
  // by the server; the date step opens prefilled with the notice date, so it
  // counts too. Six steps collect something since DEC-066 added Benefits &
  // Providers and HR Ownership; the review step is the destination.
  await expect(progress).toContainText('of 6 steps complete');
  await expect(progress).not.toContainText('0 of');
});
