/**
 * Single authorization gate in the browser (owner directive 2026-09-22,
 * DEC-066): benefits and providers are selected while creating the case, the
 * draft overview shows them as a summary, the HR Manager approves ONCE from
 * a Case Approval Summary that names every recipient and artifact, and the
 * assigned HR Officer then finalizes and sends without another approval.
 *
 * Screenshots go to artifacts/approval-gate/ (gitignored; synthetic data
 * only) as the visual evidence the directive asks for.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInAs, signOut } from './support/case';

const OUT = 'artifacts/approval-gate';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

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
  await page.waitForLoadState('networkidle');
  await expect
    .poll(
      async () =>
        page.evaluate(() => document.querySelector('title')?.textContent?.trim().length ?? 0),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(
    serious.map((v) => `${name}: [${v.impact}] ${v.id} - ${v.help} (${v.nodes.length})`),
  ).toEqual([]);
}

test('create with benefits -> draft summary -> one approval -> officer executes without a second approval', async ({
  page,
}) => {
  test.setTimeout(420_000);
  await page.setViewportSize(DESKTOP);

  // --- HR Officer: Create Offboarding Case with the benefits step ----------
  await signInAs(page, 'HR Officer');
  await page.goto('/cases/new');
  await page.getByLabel('Employee Name or Number').fill('avery');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page.locator('input[name="type"][value="RESIGNATION_WITH_NOTICE"]').check();
  await page.getByRole('button', { name: 'Use this separation type' }).click();
  await page.locator('input[name="receivedAt"]').fill('2026-07-20T09:30');
  await page.locator('input[name="confirmedLastDay"]').fill('2026-08-14');

  // The Benefits & Providers step: selectable cards, not dropdowns.
  await page.locator('.step:has([data-step="benefits"]) .step__header').click();
  await expect(page.locator('[data-step="benefits"]')).toBeVisible();
  await page.locator('#ben-groupHealth').check();
  await expect(page.locator('#ben-groupLife')).not.toBeChecked();
  await snap(page, '01-create-case-benefits', true);
  await axeCheck(page, 'create-case-benefits');

  // HR Ownership: the officer owns what they create.
  await page.locator('.step:has([data-step="ownership"]) .step__header').click();
  await expect(page.getByText('You will be the assigned HR Officer for this case')).toBeVisible();

  await page.locator('.step:has([data-step="review"]) .step__header').click();
  await expect(page.locator('.review-group', { hasText: 'Benefits & Providers' })).toBeVisible();
  if (await page.getByLabel(/I confirm this is a separate separation event/).count()) {
    const reviewHeader = page.locator('.step:has([data-step="review"]) .step__header');
    if ((await reviewHeader.getAttribute('aria-expanded')) !== 'true') await reviewHeader.click();
    await page.getByLabel(/I confirm this is a separate separation event/).check();
  }
  await page.getByRole('button', { name: 'Create draft case' }).click();
  await expect(page.getByText(/Draft case OFF-\d{4}-\d{4,}(?:-\d)? created/)).toBeVisible();
  const caseUrl = page.url().split('?')[0]!;

  // --- Draft Overview: summary only, with a way to the edit experience -----
  const benefits = page.locator('section[aria-labelledby="benefits-h"]');
  await expect(benefits).toBeVisible();
  await expect(benefits.getByText('Selected at intake')).toBeVisible();
  await expect(benefits.getByRole('link', { name: 'Edit selections' })).toBeVisible();
  await expect(benefits.getByRole('button', { name: 'Confirm applicability' })).toHaveCount(0);
  await expect(
    benefits.locator('section[aria-label="Group health provider"] .chip', { hasText: 'Included' }),
  ).toBeVisible();
  await expect(
    benefits.locator('section[aria-label="Group life provider"] .chip', {
      hasText: 'Not applicable',
    }),
  ).toBeVisible();
  await snap(page, '02-draft-overview', true);

  // No manager approval controls for the officer - only submission.
  await expect(page.getByRole('button', { name: /Approve case/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByText('Case submitted for HR Manager approval.')).toBeVisible();
  await expect(page.getByText('Awaiting Approval').first()).toBeVisible();
  // My Work says what the case is waiting for.
  await page.goto('/queue');
  await expect(
    page
      .locator('section[aria-labelledby="my-cases-h"]')
      .getByText('Awaiting HR Manager approval')
      .first(),
  ).toBeVisible();
  await signOut(page);

  // --- HR Manager: the Case Approval Summary --------------------------------
  await signInAs(page, 'HR Manager');
  await page.goto(caseUrl);
  await page.getByRole('link', { name: 'Review and approve', exact: true }).click();
  await expect(page).toHaveURL(/\/approve$/);
  await expect(page.getByRole('heading', { name: /Case Approval Summary/ })).toBeVisible();
  for (const heading of [
    'Employee Record',
    'Exit Details',
    'HR Ownership',
    'Benefits & Providers',
    'Notifications & Recipients',
    'Documents & Forms',
    'Workflow Summary',
    'Decision',
  ]) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
  // Recipients are grouped by audience with resolved destinations: the
  // employee address is real (the case email), never a technical id.
  const comms = page.locator('section[aria-labelledby="ap-comms-h"]');
  await expect(comms.getByText('Employee', { exact: true })).toBeVisible();
  await expect(comms.getByText('Reporting Manager')).toBeVisible();
  await expect(comms.getByText('IT', { exact: true })).toBeVisible();
  await expect(comms.getByText('Finance', { exact: true })).toBeVisible();
  await expect(comms.getByText('Benefit providers')).toBeVisible();
  await expect(comms.getByText('avery.brown@example.test').first()).toBeVisible();
  await expect(comms.getByText('Group health cover removal')).toBeVisible();
  // Benefits exactly as selected; documents and forms as a plan.
  const ben = page.locator('section[aria-labelledby="ap-ben-h"]');
  await expect(ben.getByText('Included')).toBeVisible();
  await expect(ben.getByText('Not applicable')).toBeVisible();
  const docs = page.locator('section[aria-labelledby="ap-docs-h"]');
  await expect(docs.getByText('Resignation acknowledgement and acceptance letter')).toBeVisible();
  await expect(docs.getByText('Employee action form')).toBeVisible();
  await expect(
    page.getByText(/Approving this case authorizes the assigned HR Officer/),
  ).toBeVisible();
  await snap(page, '03-manager-approval-summary', true);
  await axeCheck(page, 'approval-summary');

  await page.getByRole('button', { name: 'Approve Case', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText(/Case approved/)).toBeVisible();
  await expect(page.getByText(/assigned HR Officer is authorized/)).toBeVisible();

  // Assignment plan (the officer already owns the case) and activation.
  await page.goto(`${caseUrl}/assignment`);
  await page.locator('details.action > summary', { hasText: 'Assign alternate manager' }).click();
  await page.locator('#am-user').selectOption({ index: 1 });
  await page.locator('#am-reason').fill('E2E manager routing.');
  await page.getByRole('button', { name: 'Record alternate manager' }).click();
  await expect(page.getByText('Alternate manager recorded')).toBeVisible();
  for (const box of await page.locator('input[name="confirmations"]').all()) {
    if (!(await box.isChecked())) await box.check();
  }
  await page.getByRole('button', { name: 'Confirm assignment plan' }).click();
  await expect(page.getByText('Assignment plan confirmed').first()).toBeVisible();
  await signOut(page);

  // --- HR Officer: executes the approved plan alone -------------------------
  await signInAs(page, 'HR Officer');
  await page.goto(`${caseUrl}/workflow`);
  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();

  await page.goto(`${caseUrl}/documents`);
  await expect(page.getByText(/awaiting HR Manager approval|not been approved/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Create resignation document draft' }).click();
  await expect(page.getByText('Draft document created')).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Employee Address' })
    .fill('12 Synthetic Avenue, Kingston 5');
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByText(/Address recorded/)).toBeVisible();
  await page.getByRole('button', { name: 'Refresh fields from case' }).click();
  await page.getByRole('button', { name: 'Validate and finalize (attested)' }).click();
  await expect(
    page.getByText('Document finalized; the final PDF has been rendered.'),
  ).toBeVisible();
  await expect(page.getByText('Rendered').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve exact version (attested)' })).toHaveCount(
    0,
  );
  await snap(page, '04-officer-documents-after-approval', true);

  // Sending is the officer's too.
  await page
    .locator('details.action > summary', { hasText: 'Send to the employee by email' })
    .first()
    .click();
  await page.getByRole('button', { name: 'Send letter' }).click();
  await expect(page.getByText(/Letter queued for/)).toBeVisible();

  // Provider notice selected at intake: released by the officer.
  await page.goto(`${caseUrl}/notifications`);
  const health = page.locator('section[aria-label="Sagicor group health removal email action"]');
  await expect(health).toBeVisible();
  await expect(page.getByText('(HR Manager authority)')).toHaveCount(0);
  const release = health.getByRole('button', { name: 'Review and release' });
  if ((await release.count()) > 0) {
    await release.click();
    await expect(page.getByText(/Released/)).toBeVisible();
  }
  await snap(page, '05-officer-email-actions', true);

  // The benefits selection is now an approved fact: no officer editor.
  await page.goto(caseUrl);
  await expect(page.getByRole('link', { name: 'Edit selections' })).toHaveCount(0);
  await expect(page.getByText('Correct the approved benefits selection')).toHaveCount(0);
  await signOut(page);

  // A different officer? Only one HR Officer login exists in development, so
  // the non-owner rule is proven server-side in the integration suite; the
  // manager keeps the audited correction control.
  await signInAs(page, 'HR Manager');
  await page.goto(caseUrl);
  await expect(page.getByText('Correct the approved benefits selection')).toBeVisible();
  await signOut(page);
});

test('my settings: a user keeps their own email banner', async ({ page }) => {
  await signInAs(page, 'HR Officer');
  await page.getByRole('link', { name: 'My settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByLabel('Banner lines').fill('Human Resources Department\n876-555-0100 ext. 12');
  await page.getByRole('button', { name: 'Save banner' }).click();
  await expect(page.getByText('Email banner saved.')).toBeVisible();
  await expect(page.getByLabel('Signature preview')).toContainText('876-555-0100 ext. 12');
  await snap(page, '06-my-settings-email-banner', true);
  await axeCheck(page, 'my-settings');
  await page.getByLabel('Banner lines').fill('');
  await page.getByRole('button', { name: 'Save banner' }).click();
  await expect(page.getByText('Email banner removed.')).toBeVisible();
  await signOut(page);
});
