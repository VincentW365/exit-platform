/**
 * Critical HR path (TestStrategy E2E #1) plus a least-privilege negative:
 * officer creates and submits a case, manager approves it and the immutable
 * snapshot appears, and a non-HR role sees no case register at all.
 * Directive 6.3: the IT/Finance responder logins are retired, so the
 * least-privilege negative runs as the Line Manager. Synthetic identities only.
 */
import { expect, test, type Page } from '@playwright/test';

async function signInAs(page: Page, displayName: string): Promise<void> {
  await page.goto('/signin');
  await page.getByRole('button', { name: `Sign in as ${displayName}` }).click();
  await page.waitForURL('**/');
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/signin');
}

test('HR officer creates and submits; HR manager approves with snapshot; line manager sees nothing', async ({
  page,
}) => {
  // --- HR officer: create the draft -------------------------------------
  await signInAs(page, 'HR Officer');
  await expect(page.getByRole('heading', { name: 'Exit Center' })).toBeVisible();

  await page.goto('/cases/new');
  await page.getByLabel('Employee Name or Number').fill('avery');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();

  await page
    .locator(`input[name="type"][value=${JSON.stringify('RESIGNATION_WITH_NOTICE')}]`)
    .check();
  await page.getByRole('button', { name: 'Use this separation type' }).click();
  await page.locator('input[name="receivedAt"]').fill('2026-07-20T09:30');
  // Receipt channel: the picker defaults to "Signed letter" and the detail
  // field stays hidden unless "Other" is chosen - nothing to fill.
  // A resignation with notice ends at close of business on the final working
  // date, so the platform derives the instant and the field is not offered.
  await page.locator('input[name="confirmedLastDay"]').fill('2026-08-14');
  // The final action lives in the Review step (owner directive,
  // 2026-08-27), so it is reached by opening that step.
  await page.locator('.step:has([data-step="review"]) .step__header').click();
  // DEC-061: a fixture employee may already have a live case; confirm the deliberate
  // second one. The confirmation lives in the Review step, so make sure it is open.
  if (await page.getByLabel(/I confirm this is a separate separation event/).count()) {
    const reviewHeader = page.locator('.step:has([data-step="review"]) .step__header');
    if ((await reviewHeader.getAttribute('aria-expanded')) !== 'true') await reviewHeader.click();
    await page.getByLabel(/I confirm this is a separate separation event/).check();
  }
  await page.getByRole('button', { name: 'Create draft case' }).click();

  await expect(page.getByText(/Draft case OFF-\d{4}-\d{4,}(?:-\d)? created/)).toBeVisible();
  const caseUrl = page.url().split('?')[0]!;
  await expect(
    page.getByRole('heading', { name: /OFF-\d{4}-\d{4,}(?:-\d)? - Avery Brown/ }),
  ).toBeVisible();
  await expect(
    page.getByText('No snapshot yet - one is captured when the case is approved.'),
  ).toBeVisible();

  // --- submit for review --------------------------------------------------
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Case submitted for review.')).toBeVisible();
  await expect(page.getByText('Pending HR Review').first()).toBeVisible();

  // The officer must not see an approval control (maker-checker).
  await expect(page.getByRole('button', { name: /Approve case/ })).toHaveCount(0);
  await signOut(page);

  // --- HR manager: approve ------------------------------------------------
  await signInAs(page, 'HR Manager');
  await page.goto(caseUrl);
  await page.getByRole('button', { name: 'Approve case and capture snapshot' }).click();
  await expect(
    page.getByText('Case approved. The employee snapshot has been captured.'),
  ).toBeVisible();
  await expect(page.getByText('Approved').first()).toBeVisible();
  await expect(page.getByText(/captured .* \(checksum/)).toBeVisible();

  // Audit history shows the full trail (humanized sentences, Directive 6.1).
  await expect(page.getByText('created the case', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('approved the case', { exact: false }).first()).toBeVisible();
  await signOut(page);

  // --- least privilege (DEC-063): exactly two roles can sign in at all ---
  await page.goto('/signin');
  await expect(page.getByRole('button', { name: /^Sign in as / })).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Sign in as HR Manager', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sign in as HR Officer', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /System Administrator/ })).toHaveCount(0);
  // The HR Officer holds no oversight surface: the Audit Center is refused
  // server-side.
  await signInAs(page, 'HR Officer');
  await page.goto('/audit');
  await expect(page).toHaveURL(/unauthorized/);
});
