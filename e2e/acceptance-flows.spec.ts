/**
 * Stage 1 acceptance scenarios (Directive 1.1 section J). Synthetic data only.
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

async function createDraftCase(
  page: Page,
  opts: { employeeQuery: string; type: string; purpose?: 'OPERATIONAL' | 'TEST' },
): Promise<string> {
  await page.goto('/cases/new');
  await page.getByLabel(/Search the employee source/).fill(opts.employeeQuery);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page.getByLabel('Departure type (required)').selectOption(opts.type);
  await page.getByLabel('Receipt date and time (required)').fill('2026-07-20T09:30');
  await page
    .getByLabel('Source of the receipt timestamp (required)')
    .fill('Synthetic acceptance-test receipt');
  await page.getByLabel(/Effective separation date and exact time/).fill('2026-08-14T17:00');
  if (opts.purpose === 'TEST') {
    await page.getByLabel('Record purpose').selectOption('TEST');
  }
  await page.getByRole('button', { name: 'Create draft case' }).click();
  await expect(page.getByText(/Draft case OFF-\d{4}-\d{4} created/)).toBeVisible();
  return page.url().split('?')[0]!;
}

test('J.3 return with reason -> correction -> resubmit; history preserved', async ({ page }) => {
  await signInAs(page, 'Riley Okafor');
  const caseUrl = await createDraftCase(page, {
    employeeQuery: 'jordan',
    type: 'IMMEDIATE_RESIGNATION',
  });
  await page.getByRole('button', { name: 'Submit for HR review' }).click();
  await expect(page.getByText('Case submitted for HR review.')).toBeVisible();
  await signOut(page);

  await signInAs(page, 'Dana Field');
  await page.goto(caseUrl);
  await page.getByText('Return for correction').click();
  await page.getByLabel('Reason (required)').first().fill('Effective time must be end of shift.');
  await page.getByRole('button', { name: 'Return to draft' }).click();
  await expect(page.getByText('Case returned to draft for correction.')).toBeVisible();
  await signOut(page);

  await signInAs(page, 'Riley Okafor');
  await page.goto(caseUrl);
  await page.getByLabel(/Effective separation \(exact date and time\)/).fill('2026-08-14T18:00');
  await page.getByRole('button', { name: 'Save draft changes' }).click();
  await expect(page.getByText('Draft updated.')).toBeVisible();
  await page.getByRole('button', { name: 'Submit for HR review' }).click();
  await expect(page.getByText('Case submitted for HR review.')).toBeVisible();

  // Original history remains: two submissions and one return in the timeline.
  const timeline = page.locator('ul.timeline').last();
  await expect(timeline.getByText('submitted the case', { exact: false })).toHaveCount(2);
  await expect(timeline.getByText('returned the case to draft', { exact: false })).toHaveCount(1);
  await signOut(page);
});

test('J.4 void requires a reason; history and audit remain visible', async ({ page }) => {
  await signInAs(page, 'Dana Field');
  const caseUrl = await createDraftCase(page, {
    employeeQuery: 'taylor',
    type: 'RESIGNATION_WITH_NOTICE',
  });
  await page.getByText('Void case (entered in error)').click();
  await page
    .getByLabel('Reason (required)')
    .last()
    .fill('Synthetic duplicate for acceptance test.');
  await page.getByRole('button', { name: 'Void case' }).click();
  await expect(page.getByText('Case voided.')).toBeVisible();
  await expect(page.getByText('Voided').first()).toBeVisible();
  await expect(page.getByText('Synthetic duplicate for acceptance test.')).toBeVisible();
  const timeline = page.locator('ul.timeline').last();
  await expect(timeline.getByText('case voided', { exact: false })).toHaveCount(1);
  await page.goto(caseUrl); // still reachable read-only, never deleted
  await expect(page.getByRole('heading', { name: /OFF-\d{4}-\d{4}/ })).toBeVisible();
  await signOut(page);
});

test('J.5 restricted termination: assignment-gated access; no discovery for others', async ({
  page,
}) => {
  await signInAs(page, 'Dana Field');
  const caseUrl = await createDraftCase(page, { employeeQuery: 'morgan', type: 'TERMINATION' });
  await expect(page.getByText(/RESTRICTED case - visible to explicitly assigned/)).toBeVisible();
  const caseNumber = (await page
    .getByRole('heading', { name: /OFF-\d{4}-\d{4}/ })
    .textContent())!.split(' ')[0]!;
  await signOut(page);

  // Unassigned HR officer: absent from list and search; direct URL -> not found.
  await signInAs(page, 'Riley Okafor');
  await page.goto('/cases');
  await expect(page.getByText(caseNumber)).toHaveCount(0);
  // Search by the restricted employee's name must not surface THIS case
  // (prior synthetic runs may have left older cases the officer was later
  // assigned to - the invariant is per-case non-disclosure).
  await page.goto('/cases?q=morgan');
  await expect(page.getByText(caseNumber)).toHaveCount(0);
  await page.goto(caseUrl);
  await expect(page.getByText('Page or record not found')).toBeVisible();
  await signOut(page);

  // Departmental + admin roles: nothing anywhere.
  for (const who of ['Sam Chen', 'Marley Thompson']) {
    await signInAs(page, who);
    await page.goto(caseUrl);
    await expect(page.getByText('Page or record not found')).toBeVisible();
    await signOut(page);
  }

  // Auditor: minimized discovery row without identity; content refused.
  await signInAs(page, 'Quinn Baptiste');
  await page.goto('/cases');
  await expect(page.getByText(caseNumber)).toBeVisible();
  await expect(page.getByText('(restricted case)').first()).toBeVisible();
  await page.goto(caseUrl);
  await expect(page.getByText(/content requires explicit assignment/)).toBeVisible();
  await signOut(page);

  // Explicit assignment opens access for the assigned HR officer.
  await signInAs(page, 'Dana Field');
  await page.goto(caseUrl);
  await page.locator('details.action > summary', { hasText: 'Add participant' }).click();
  const officerValue = await page
    .locator('#p-user option', { hasText: 'Riley Okafor' })
    .getAttribute('value');
  await page.getByLabel('User').selectOption(officerValue!);
  await page.locator('#p-reason').fill('Assigned to support preparation.');
  await page.getByRole('button', { name: 'Add participant' }).click();
  await expect(page.getByText('Participant added.')).toBeVisible();
  await signOut(page);

  await signInAs(page, 'Riley Okafor');
  await page.goto(caseUrl);
  await expect(page.getByRole('heading', { name: new RegExp(caseNumber) })).toBeVisible();
  await signOut(page);
});

test('J.6+J.8 cohort/purpose exclusion and audited export without restricted rows', async ({
  page,
}) => {
  await signInAs(page, 'Riley Okafor');
  // A TEST-purpose record must not enter operational reporting.
  await createDraftCase(page, {
    employeeQuery: 'casey',
    type: 'RESIGNATION_WITH_NOTICE',
    purpose: 'TEST',
  });
  await page.goto('/baseline');
  await expect(page.getByText('Casey Grant')).toHaveCount(0);

  // Authorized export succeeds and contains no restricted employee identity.
  const res = await page.request.get('/api/baseline-export');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/csv');
  expect(res.headers()['content-disposition']).toContain('attachment');
  const csv = await res.text();
  expect(csv).toContain('case_number');
  expect(csv).not.toContain('Morgan'); // restricted employee never exported
  expect(csv).not.toContain('Casey'); // TEST purpose excluded
  await signOut(page);

  // Unauthorized roles cannot export.
  await signInAs(page, 'Sam Chen');
  const denied = await page.request.get('/api/baseline-export');
  expect(denied.status()).toBe(403);
  await signOut(page);
});

test('J.7 attachment upload with clearly-labelled development scan transition', async ({
  page,
}) => {
  await signInAs(page, 'Riley Okafor');
  const caseUrl = await createDraftCase(page, {
    employeeQuery: 'avery',
    type: 'RESIGNATION_WITH_NOTICE',
  });
  await page.locator('details.action > summary', { hasText: 'Upload a file' }).click();
  await page.getByLabel('File').setInputFiles({
    name: 'resignation-letter.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nsynthetic acceptance letter'),
  });
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText('File uploaded.')).toBeVisible();
  await expect(page.getByText('CLEAN').first()).toBeVisible();
  await expect(page.getByText(/no real malware scan performed/).first()).toBeVisible();
  const link = page.getByRole('link', { name: 'Download' }).first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  const dl = await page.request.get(href!);
  expect(dl.status()).toBe(200);
  expect(dl.headers()['content-disposition']).toContain('attachment');
  await signOut(page);

  // Unauthorized role: download denied without disclosure.
  await signInAs(page, 'Alex Romero');
  const denied = await page.request.get(href!);
  expect([403, 404]).toContain(denied.status());
  await signOut(page);
  void caseUrl;
});

test('J.9 logout invalidates the session for protected routes', async ({ page }) => {
  await signInAs(page, 'Riley Okafor');
  await page.goto('/cases');
  await expect(page.getByRole('heading', { name: 'Offboarding cases' })).toBeVisible();
  await signOut(page);
  await page.goto('/cases');
  await page.waitForURL('**/signin**');
  const res = await page.request.get('/api/baseline-export');
  expect(res.status()).toBe(401);
});
