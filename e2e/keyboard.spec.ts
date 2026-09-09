/**
 * Keyboard interaction standards (owner directive, 2026-09-09).
 *
 * Every test here keeps the mouse out of it: focus is moved with Tab or by
 * naming the control, and activation is Enter, Space, arrows or Escape.
 * `locator.focus()` is used to reach a control by name; it does not click.
 *
 * The first test is the reported defect: Enter in the employee search used
 * to trigger "Please fill out this field" from an unrelated form, because
 * the accordion intercepted Enter for every field on the page regardless of
 * which form owned it. Synthetic data only.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

async function signInWithKeyboard(page: Page, displayName: string): Promise<void> {
  await page.goto('/signin');
  await page.getByRole('button', { name: `Sign in as ${displayName}` }).focus();
  await page.keyboard.press('Enter');
  await page.waitForURL('**/');
}

/** The employee search field, once the accordion has revealed step 1. */
async function searchField(page: Page) {
  const q = page.getByLabel('Employee Name or Number');
  await expect(q).toBeVisible();
  return q;
}

/**
 * Move focus to a control the way a person does: once they can see it.
 * The accordion reveals its open step a frame after hydration, and
 * `locator.focus()` does not wait for visibility - a focus call on a still
 * hidden field silently does nothing and the keys that follow go to the body.
 */
async function reach(target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  await target.focus();
  await expect(target).toBeFocused();
}

/**
 * Count browser validation reports across the page's navigations. Every
 * "Please fill out this field" bubble is preceded by an `invalid` event on
 * the control, so this catches the reported defect directly - and survives
 * the navigation the search causes, which a window variable would not.
 */
async function countValidationReports(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener(
      'invalid',
      () => {
        const n = Number(sessionStorage.getItem('validationReports') ?? '0');
        sessionStorage.setItem('validationReports', String(n + 1));
      },
      true,
    );
  });
}

async function validationReports(page: Page): Promise<number> {
  return page.evaluate(() => Number(sessionStorage.getItem('validationReports') ?? '0'));
}

test('Enter in the employee search runs the search - and nothing else', async ({ page }) => {
  await countValidationReports(page);
  await signInWithKeyboard(page, 'HR Officer');
  await page.goto('/cases/new');
  const q = await searchField(page);
  // The cursor is already there (section 14); typing needs no click.
  await expect(q).toBeFocused();
  await page.keyboard.type('avery');
  await page.keyboard.press('Enter');

  // The search ran: the address carries the query and matches are listed.
  await page.waitForURL(/\/cases\/new\?q=avery/);
  await expect(page.getByRole('link', { name: /^Select / }).first()).toBeVisible();
  // The main case form was NOT submitted, and no unrelated field complained:
  // the defect was "Please fill out this field" from the manual-entry form.
  await expect(page.getByText(/Draft case OFF-/)).toHaveCount(0);
  expect(await validationReports(page), 'no field reported a validation message').toBe(0);
});

test('Enter and the Search button do the same thing', async ({ page }) => {
  await signInWithKeyboard(page, 'HR Officer');
  await page.goto('/cases/new');
  const q = await searchField(page);
  await q.fill('avery');
  await page.getByRole('button', { name: 'Search' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/cases\/new\?q=avery/);
  // Count once a match is on screen: a bare count() does not wait, and the
  // fixture directory has at least one Avery.
  const matches = page.getByRole('link', { name: /^Select / });
  await expect(matches.first()).toBeVisible();
  const byButton = await matches.count();

  await page.goto('/cases/new');
  const q2 = await searchField(page);
  await q2.fill('avery');
  await q2.press('Enter');
  await page.waitForURL(/\/cases\/new\?q=avery/);
  await expect(matches.first()).toBeVisible();
  const byEnter = await matches.count();
  expect(byEnter).toBe(byButton);
});

test("an empty search is answered in the search's own words", async ({ page }) => {
  await signInWithKeyboard(page, 'HR Officer');
  await page.goto('/cases/new');
  const q = await searchField(page);
  await q.press('Enter');
  await page.waitForURL(/\/cases\/new\?q=$/);
  await expect(page.locator('#emp-q-error')).toContainText(/Enter an employee name/);
  // ...and the search box is marked, not some other form's field.
  await expect(page.getByLabel('Employee Name or Number')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Please fill out this field')).toHaveCount(0);
});

test('search results are chosen with the arrow keys and Enter', async ({ page }) => {
  await signInWithKeyboard(page, 'HR Officer');
  await page.goto('/cases/new?q=a');
  const links = page.getByRole('link', { name: /^Select / });
  await expect(links.first()).toBeVisible();
  const count = await links.count();
  expect(count, 'the synthetic directory has several matches for "a"').toBeGreaterThan(1);

  // Focus lands on the first match without a click (section 14) ...
  await expect(links.first()).toBeFocused();
  // ... ↓ moves to the second, ↑ back, Home/End to the ends ...
  await page.keyboard.press('ArrowDown');
  await expect(links.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(links.nth(count - 1)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(links.first()).toBeFocused();
  // ... Escape hands focus back to the search box ...
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Employee Name or Number')).toBeFocused();
  // ... and Tab + Enter still selects, because they are ordinary links. Tab
  // passes the Search button and the scrollable table region on the way.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    if (await links.first().evaluate((el) => el === document.activeElement)) break;
  }
  await expect(links.first()).toBeFocused();
  const chosen = (await links.first().getAttribute('aria-label'))!.replace(/^Select /, '');
  await page.keyboard.press('Enter');
  await page.waitForURL(/employee=/);
  await expect(page.getByText(chosen).first()).toBeVisible();
});

test('Enter in an ordinary field finishes the step; it never creates the case', async ({
  page,
}) => {
  await signInWithKeyboard(page, 'HR Officer');
  await page.goto('/cases/new?q=avery');
  await page
    .getByRole('link', { name: /^Select / })
    .first()
    .focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/employee=/);
  await reach(page.locator('input[name="type"][value="RESIGNATION_WITH_NOTICE"]'));
  await page.keyboard.press('Space');
  await reach(page.getByRole('button', { name: 'Use this separation type' }));
  await page.keyboard.press('Enter');
  await page.waitForURL(/type=RESIGNATION_WITH_NOTICE/);

  await reach(page.locator('input[name="receivedAt"]'));
  await page.keyboard.press('Enter');
  // Still on the intake, nothing created, and the next step opened.
  await expect(page).toHaveURL(/\/cases\/new\?/);
  await expect(page.getByText(/Draft case OFF-/)).toHaveCount(0);
  const openHeaders = page.locator('.step__header[aria-expanded="true"]');
  await expect(openHeaders).toHaveCount(1);
  await expect(openHeaders).not.toContainText('When employment ends');
});

test('a completed accordion step reopens from the keyboard', async ({ page }) => {
  await signInWithKeyboard(page, 'HR Officer');
  await page.goto('/cases/new?q=avery');
  await page
    .getByRole('link', { name: /^Select / })
    .first()
    .focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/employee=/);

  // Step 1 is now settled and collapsed. Reach its header by Tab from the
  // top of the page, then Enter to expand, Space to collapse again.
  const header = page.locator('.step__header').first();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await page.locator('body').press('Tab');
  for (let i = 0; i < 30; i++) {
    if (await header.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(header).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Employee Name or Number')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(header).toHaveAttribute('aria-expanded', 'false');
});

test('a confirmation dialog owns focus, closes on Escape and hands focus back', async ({
  page,
}) => {
  await signInWithKeyboard(page, 'HR Manager');
  await page.goto('/cases/new?q=avery');
  await page
    .getByRole('link', { name: /^Select / })
    .first()
    .focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/employee=/);
  await reach(page.locator('input[name="type"][value="RESIGNATION_WITH_NOTICE"]'));
  await page.keyboard.press('Space');
  await reach(page.getByRole('button', { name: 'Use this separation type' }));
  await page.keyboard.press('Enter');
  await page.locator('input[name="receivedAt"]').fill('2026-07-20T09:30');
  await page.locator('input[name="confirmedLastDay"]').fill('2026-08-14');
  await reach(page.locator('.step:has([data-step="review"]) .step__header'));
  await page.keyboard.press('Enter');
  await reach(page.getByRole('button', { name: 'Create draft case' }));
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Draft case OFF-/)).toBeVisible();

  const trigger = page.getByRole('button', { name: 'Void case (entered in error)' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Focus went INTO the dialog, onto the field the reader is there to fill.
  await expect(dialog.getByLabel('Why was this case raised in error?')).toBeFocused();
  // Tab stays inside: after enough presses we are still within the dialog.
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() => !!document.activeElement?.closest('dialog[open]')),
    'focus never escapes an open dialog',
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('the whole case is created without a mouse', async ({ page }) => {
  await signInWithKeyboard(page, 'HR Officer');
  await page.goto('/cases/new');
  // A person waits for the cursor before typing; so does this test.
  await expect(page.getByLabel('Employee Name or Number')).toBeFocused();
  await page.keyboard.type('avery');
  await page.keyboard.press('Enter');
  await page.waitForURL(/q=avery/);
  // Focus lands on the first match; Enter selects it.
  await expect(page.getByRole('link', { name: /^Select / }).first()).toBeFocused();
  await page.keyboard.press('Enter');
  await page.waitForURL(/employee=/);

  // Separation type: Tab to the radio group, Space picks, Enter continues.
  await reach(page.locator('input[name="type"][value="IMMEDIATE_RESIGNATION"]'));
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  for (let i = 0; i < 12; i++) {
    const onContinue = await page.evaluate(
      () => document.activeElement?.textContent?.trim() === 'Use this separation type',
    );
    if (onContinue) break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');
  await page.waitForURL(/type=IMMEDIATE_RESIGNATION/);

  // Dates: they arrive prefilled to today for an immediate resignation; Enter
  // finishes the step and opens the next.
  await reach(page.locator('input[name="receivedAt"]'));
  await page.keyboard.press('Enter');
  // Reason: Enter again finishes it.
  await reach(page.locator('select[name="reasonCaptureStatus"]'));
  await page.keyboard.press('Enter');
  // Review step is open now; Tab to Create, Enter.
  await reach(page.getByRole('button', { name: 'Create draft case' }));
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Draft case OFF-/)).toBeVisible();
});

test('a submit button cannot be pressed twice', async ({ page }) => {
  await signInWithKeyboard(page, 'HR Officer');
  await page.goto('/cases/new?q=avery');
  await page
    .getByRole('link', { name: /^Select / })
    .first()
    .focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/employee=/);
  await reach(page.locator('input[name="type"][value="RESIGNATION_WITH_NOTICE"]'));
  await page.keyboard.press('Space');
  await reach(page.getByRole('button', { name: 'Use this separation type' }));
  await page.keyboard.press('Enter');
  await page.locator('input[name="receivedAt"]').fill('2026-07-20T09:30');
  await page.locator('input[name="confirmedLastDay"]').fill('2026-08-14');
  await reach(page.locator('.step:has([data-step="review"]) .step__header'));
  await page.keyboard.press('Enter');
  const create = page.getByRole('button', { name: 'Create draft case' });
  await reach(create);
  await page.keyboard.press('Enter');
  // The button locks the instant the form submits.
  await expect(create).toBeDisabled();
  await expect(create).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByText(/Draft case OFF-/)).toBeVisible();
  // One case, not two: the address is one case and the register shows it once.
  const caseNo = /OFF-\d{4}-\d{4,}(?:-\d)?/.exec(await page.locator('body').innerText())![0];
  await page.goto('/cases');
  await expect(page.getByText(caseNo)).toHaveCount(1);
});

test('"/" focuses the case search from anywhere, but not while typing', async ({ page }) => {
  await signInWithKeyboard(page, 'HR Officer');
  await page.goto('/cases');
  await page.locator('body').focus();
  await page.keyboard.press('/');
  await expect(page.locator('#topbar-q')).toBeFocused();
  // Typing "/" inside a field is just a character.
  const filter = page.getByLabel('Case Number or Employee');
  await filter.focus();
  await page.keyboard.type('a/b');
  await expect(filter).toHaveValue('a/b');
  await expect(page.locator('#topbar-q')).not.toBeFocused();
});
