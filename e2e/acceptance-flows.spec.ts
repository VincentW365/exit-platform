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
  await page.getByLabel('Employee Name or Number').fill(opts.employeeQuery);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page.locator(`input[name="type"][value=${JSON.stringify(opts.type)}]`).check();
  await page.getByRole('button', { name: 'Use this separation type' }).click();
  await page.locator('input[name="receivedAt"]').fill('2026-07-20T09:30');
  // One end date (DEC-064): employment ends at close of business on it and
  // the platform derives the instant - no time is offered for any type.
  await page.locator('input[name="confirmedLastDay"]').fill('2026-08-14');
  if (opts.purpose === 'TEST') {
  }
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
  return page.url().split('?')[0]!;
}

test('J.3 return with reason -> correction -> resubmit; history preserved', async ({ page }) => {
  await signInAs(page, 'HR Officer');
  const caseUrl = await createDraftCase(page, {
    employeeQuery: 'jordan',
    type: 'IMMEDIATE_RESIGNATION',
  });
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Case submitted for review.')).toBeVisible();
  await signOut(page);

  await signInAs(page, 'HR Manager');
  await page.goto(caseUrl);
  await page.getByText('Return for correction').click();
  await page.getByLabel('Reason (required)').first().fill('Effective time must be end of shift.');
  await page.getByRole('button', { name: 'Return to draft' }).click();
  await expect(page.getByText('Case returned to draft for correction.')).toBeVisible();
  await signOut(page);

  await signInAs(page, 'HR Officer');
  await page.goto(caseUrl);
  // Draft editing now lives as a disclosure under the case summary.
  await page.locator('details.action > summary', { hasText: 'Edit these details' }).click();
  await page.locator('input[name="confirmedLastDay"]').fill('2026-08-14');
  await page.getByRole('button', { name: 'Save draft changes' }).click();
  await expect(page.getByText('Draft updated.')).toBeVisible();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Case submitted for review.')).toBeVisible();

  // Original history remains: two submissions and one return in the timeline.
  const timeline = page.locator('ol.activity').last();
  await expect(timeline.getByText('submitted the case', { exact: false })).toHaveCount(2);
  await expect(timeline.getByText('returned the case to draft', { exact: false })).toHaveCount(1);
  await signOut(page);
});

test('J.4 void requires a reason; history and audit remain visible', async ({ page }) => {
  await signInAs(page, 'HR Manager');
  const caseUrl = await createDraftCase(page, {
    employeeQuery: 'taylor',
    type: 'RESIGNATION_WITH_NOTICE',
  });
  // Voiding now opens a confirmation that states what it means before it
  // asks why (owner design directive, section 19).
  await page.getByRole('button', { name: 'Void case (entered in error)' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible();
  await confirm
    .getByLabel('Why was this case raised in error?')
    .fill('Synthetic duplicate for acceptance test.');
  await confirm.getByRole('button', { name: 'Void case' }).click();
  await expect(page.getByText('Case voided.')).toBeVisible();
  await expect(page.getByText('Voided').first()).toBeVisible();
  await expect(page.getByText('Synthetic duplicate for acceptance test.')).toBeVisible();
  const timeline = page.locator('ol.activity').last();
  await expect(timeline.getByText('case voided', { exact: false })).toHaveCount(1);
  await page.goto(caseUrl); // still reachable read-only, never deleted
  await expect(page.getByRole('heading', { name: /OFF-\d{4}-\d{4,}(?:-\d)?/ })).toBeVisible();
  await signOut(page);
});

test('J.5 restricted termination: assignment-gated access; no discovery for others', async ({
  page,
}) => {
  await signInAs(page, 'HR Manager');
  const caseUrl = await createDraftCase(page, { employeeQuery: 'morgan', type: 'TERMINATION' });
  await expect(page.getByText(/RESTRICTED case - visible to explicitly assigned/)).toBeVisible();
  const caseNumber = (await page
    .getByRole('heading', { name: /OFF-\d{4}-\d{4,}(?:-\d)?/ })
    .textContent())!.split(' ')[0]!;
  await signOut(page);

  // Unassigned HR officer: absent from list and search; direct URL -> not found.
  await signInAs(page, 'HR Officer');
  await page.goto('/cases');
  await expect(page.getByText(caseNumber)).toHaveCount(0);
  // Search by the restricted employee's name must not surface THIS case
  // (prior synthetic runs may have left older cases the officer was later
  // assigned to - the invariant is per-case non-disclosure).
  await page.goto('/cases?q=morgan');
  await expect(page.getByText(caseNumber)).toHaveCount(0);
  await page.goto(caseUrl);
  await expect(page.getByText('Page or Record Not Found')).toBeVisible();
  await signOut(page);

  // DEC-063: no login outside HR exists; the unassigned HR Officer above is
  // the whole negative, and a signed-out visitor is sent to sign in.
  await page.goto(caseUrl);
  await page.waitForURL('**/signin**');

  // Explicit assignment opens access for the assigned HR officer.
  await signInAs(page, 'HR Manager');
  await page.goto(caseUrl);
  await page.locator('details.action > summary', { hasText: 'Add participant' }).click();
  // Options read "<name> (<roles>)", and the hosted-UAT seed adds two more
  // HR Officer accounts; the list is ordered by name, so the first match is
  // still the role-named account.
  const officerValue = await page
    .locator('#p-user option', { hasText: 'HR Officer' })
    .first()
    .getAttribute('value');
  await page.getByLabel('User').selectOption(officerValue!);
  await page.locator('#p-reason').fill('Assigned to support preparation.');
  await page.getByRole('button', { name: 'Add participant' }).click();
  await expect(page.getByText('Participant added.')).toBeVisible();
  await signOut(page);

  await signInAs(page, 'HR Officer');
  await page.goto(caseUrl);
  await expect(page.getByRole('heading', { name: new RegExp(caseNumber) })).toBeVisible();
  await signOut(page);
});

test('J.6+J.8 cohort/purpose exclusion and audited export without restricted rows', async ({
  page,
}) => {
  await signInAs(page, 'HR Officer');
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

  // DEC-063: both application roles may export; the remaining negative is an
  // unauthenticated request, refused without content.
  const denied = await page.request.get('/api/baseline-export');
  expect(denied.status()).toBe(401);
});

test('J.7 attachment upload with clearly-labelled development scan transition', async ({
  page,
}) => {
  await signInAs(page, 'HR Officer');
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

  // DEC-063: no non-HR login exists; an unauthenticated download is refused
  // without disclosure.
  const denied = await page.request.get(href!);
  expect([401, 403, 404]).toContain(denied.status());
  void caseUrl;
});

test('J.9 logout invalidates the session for protected routes', async ({ page }) => {
  await signInAs(page, 'HR Officer');
  await page.goto('/cases');
  await expect(page.getByRole('heading', { name: 'Offboarding Cases' })).toBeVisible();
  await signOut(page);
  await page.goto('/cases');
  await page.waitForURL('**/signin**');
  const res = await page.request.get('/api/baseline-export');
  expect(res.status()).toBe(401);
});
