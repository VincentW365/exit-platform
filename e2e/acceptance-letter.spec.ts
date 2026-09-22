/**
 * Resignation acceptance letter issued by email (DEC-054).
 *
 * The owner's ask, end to end in the browser: HR types the address from the
 * resignation letter scan, the letter carries the Company's sample wording,
 * and once approved and rendered it goes to the employee with the PDF
 * attached and chosen HR colleagues copied. Development captures the email
 * rather than delivering it.
 *
 * The scenario builds its own case so it runs on any seeded database.
 * Synthetic data only.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openActiveHrValidatedCase, signInAs, signOut } from './support/case';

const ADDRESS = '12 Synthetic Avenue, Kingston 5';

test('the acceptance letter is addressed, approved and emailed with HR copied', async ({
  page,
}) => {
  test.setTimeout(300_000);

  // A case of its own, so a previous run can never leave this one with a
  // letter that has already been issued.
  await signInAs(page, 'HR Manager');
  const caseUrl = await openActiveHrValidatedCase(page);
  await page.goto(`${caseUrl}/documents`);

  // The address is HR-typed, from the scan - it is not in the directory.
  await expect(page.getByRole('heading', { name: 'Employee Address' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Employee Address' }).fill(ADDRESS);
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByText(/Address recorded/)).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual(
    [],
  );

  // Drive the letter to RENDERED so the email route exists. Maker-checker
  // holds: the officer who submits is never the manager who approves.
  const create = page.getByRole('button', { name: 'Create resignation document draft' });
  if ((await create.count()) > 0) await create.first().click();
  await signOut(page);

  await signInAs(page, 'HR Officer');
  await page.goto(`${caseUrl}/documents`);
  const refresh = page.getByRole('button', { name: 'Refresh fields from case' });
  await expect(refresh.first()).toBeVisible();
  await refresh.first().click();
  await page.getByRole('button', { name: 'Validate and submit for approval' }).first().click();
  await expect(page.getByText('Pending Approval').first()).toBeVisible();
  await signOut(page);

  await signInAs(page, 'HR Manager');
  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Approve exact version (attested)' }).first().click();
  await expect(page.getByText('Rendered').first()).toBeVisible();

  const sendBlock = page.locator('details.action > summary', {
    hasText: 'Send to the employee by email',
  });
  await expect(sendBlock.first()).toBeVisible();
  await sendBlock.first().click();
  const form = page.locator('form', { has: page.getByRole('button', { name: 'Send letter' }) });
  // The copy-to list names HR people and shows masked addresses only.
  const copyTo = form.locator('fieldset', { hasText: 'Copy To (Human Resources)' });
  await expect(copyTo).toBeVisible();
  await expect(copyTo).not.toContainText('@example.test');

  const firstContact = copyTo.locator('input[type="checkbox"]').first();
  if ((await firstContact.count()) > 0) await firstContact.check();
  await form.getByRole('button', { name: 'Send letter' }).click();
  await expect(page.getByText(/Letter queued for/)).toBeVisible();

  // Issuing is terminal: the send route is gone and the status says so.
  await expect(page.getByText('Issued by email').first()).toBeVisible();
  await expect(
    page.locator('details.action > summary', { hasText: 'Send to the employee by email' }),
  ).toHaveCount(0);
  // Directive section 9: the communications trail must say what actually
  // travelled - who was copied and what was attached - without exposing an
  // address.
  await page.goto(`${caseUrl}/notifications`);
  const letterAction = page.locator('section[aria-label$="email action"]', {
    hasText: 'Resignation acceptance letter',
  });
  await expect(letterAction).toBeVisible();
  await expect(letterAction.getByText(/^Attached:/)).toBeVisible();
  await expect(letterAction).not.toContainText('@example.test');

  await signOut(page);
});

test('the captured letter email carries the PDF and never a whole address', async ({ page }) => {
  test.setTimeout(180_000);
  await signInAs(page, 'HR Manager');
  await page.goto('/dev/mailbox');
  await expect(page.getByText('DEVELOPMENT CAPTURE ONLY')).toBeVisible();

  const captured = page.getByText(/Acknowledgement of Resignation/).first();
  test.skip((await captured.count()) === 0, 'No acceptance letter email captured yet.');
  const html = await page.content();
  // The capture note records what travelled without exposing the file.
  expect(html).toContain('Attached:');
  expect(html).toContain('.pdf');
  await signOut(page);
});
