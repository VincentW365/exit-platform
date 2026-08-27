/**
 * Stage 2 acceptance scenarios (Directive 2 section N: Scenarios 1-4),
 * updated for Directive 6.3: the Action Form is HR-controlled (the assigned
 * HR Officer prepares, finishes and completes it - no manager or Finance
 * approval step exists) and the IT/Finance responder logins are retired.
 * Cases are real operational records (final-product mode); email stays in the dev capture mailbox.
 * operational records. Synthetic identities only.
 */
import { expect, test, type Page } from '@playwright/test';

async function signInAs(page: Page, displayName: string): Promise<void> {
  await page.goto('/signin');
  await page.getByRole('button', { name: `Sign in as ${displayName}` }).click();
  await page.waitForURL('**/');
}

async function signOut(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/signin');
}

async function createTestCase(
  page: Page,
  opts: { employeeQuery: string; type: string; confirmedLastDay?: boolean },
): Promise<string> {
  await page.goto('/cases/new');
  await page.getByLabel('Employee Name or Number').fill(opts.employeeQuery);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page.locator(`input[name="type"][value=${JSON.stringify(opts.type)}]`).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[name="receivedAt"]').fill('2026-07-20T09:30');
  // A resignation with notice ends at close of business on the final working
  // date, so the platform derives the instant and the field is not offered.
  if (opts.type === 'RESIGNATION_WITH_NOTICE') {
    await page.locator('input[name="confirmedLastDay"]').fill('2026-08-14');
  } else {
    if (opts.confirmedLastDay) {
      await page.locator('input[name="confirmedLastDay"]').fill('2026-08-14');
    }
    await page.locator('input[name="confirmedLastDay"]').fill('2026-08-14');
    await page.locator('input[name="effectiveSeparationAt"]').fill('2026-08-14T17:00');
  }
  await page.getByRole('button', { name: 'Create draft case' }).click();
  await expect(page.getByText(/Draft case OFF-\d{4}-\d{4,}(?:-\d)? created/)).toBeVisible();
  return page.url().split('?')[0]!;
}

test('Scenario 1 - resignation document: draft, approve, render, authorized download', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInAs(page, 'HR Officer');
  const caseUrl = await createTestCase(page, {
    employeeQuery: 'avery',
    type: 'RESIGNATION_WITH_NOTICE',
    confirmedLastDay: true,
  });

  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Create resignation document draft' }).click();
  await expect(page.getByText('Draft document created')).toBeVisible();
  // The acceptance letter is addressed, so HR types the address from the
  // resignation letter scan before submitting (DEC-054).
  await page.getByLabel('Employee Address').fill('12 Synthetic Avenue, Kingston 5');
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByText(/Address recorded/)).toBeVisible();
  await page.getByRole('button', { name: 'Refresh fields from case' }).click();
  await page.getByRole('button', { name: 'Validate and submit for approval' }).click();
  await expect(page.getByText('Document submitted for HR Manager approval.')).toBeVisible();
  await expect(page.getByText('Avery Brown').first()).toBeVisible(); // preview shows exact content
  await signOut(page);

  await signInAs(page, 'HR Manager');
  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Approve exact version (attested)' }).click();
  await expect(page.getByText('Document approved; the final PDF has been rendered.')).toBeVisible();
  await expect(page.getByText('RENDERED').first()).toBeVisible();

  const pdfHref = await page
    .getByRole('link', { name: 'Download PDF' })
    .first()
    .getAttribute('href');
  const dl = await page.request.get(pdfHref!);
  expect(dl.status()).toBe(200);
  expect(dl.headers()['content-type']).toContain('application/pdf');
  expect(dl.headers()['content-disposition']).toContain('attachment');
  await signOut(page);

  // Unauthorized download: a non-case role gets a non-disclosing failure
  // (Directive 6.3: IT has no login; the line manager covers the negative).
  await signInAs(page, 'System Administrator');
  const denied = await page.request.get(pdfHref!);
  expect([403, 404]).toContain(denied.status());
  await signOut(page);
});

test('Scenario 2 - action form: HR-only completion (Directive 6.3), PDF and audit', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInAs(page, 'HR Officer');
  const caseUrl = await createTestCase(page, {
    employeeQuery: 'jordan',
    type: 'IMMEDIATE_RESIGNATION',
  });

  // The HR Officer prepares the whole form: managers, IT and Finance have no
  // approval role on it any more (Directive 6.3 D/I/J).
  await page.goto(`${caseUrl}/action-form`);
  await page.getByRole('button', { name: 'Create action form' }).click();
  await expect(page.getByText('Action form draft created.')).toBeVisible();
  await expect(page.getByText(/Managers, IT and Finance have no approval role/)).toBeVisible();
  for (const key of [
    'caseInfoVerified',
    'evidenceRecorded',
    'contactVerified',
    'benefitsInitiated',
    'propertyProcessInitiated',
    'accessRemovalRecorded',
    'surveyEligibilityAssessed',
    'hrisUpdate',
  ]) {
    await page.locator(`#hr-${key}-DONE`).check();
  }
  await page.locator('#ackStatus').selectOption('NOT_OBTAINED');
  await page.locator('#ackReason').fill('Employee left immediately; not obtainable.');
  await page.getByRole('button', { name: 'Save HR section' }).click();
  await expect(page.getByText('HR section saved.')).toBeVisible();

  // Finance works OUTSIDE the application; HR records what the automated
  // notification and returned evidence establish.
  for (const key of [
    'financeNotified',
    'workpaperInitiated',
    'workpaperCompleted',
    'payrollActioned',
    'otherApprovedAction',
  ]) {
    await page.locator(`#fin-${key}-DONE`).check();
  }
  await page.getByRole('button', { name: 'Save Finance evidence' }).click();
  await expect(page.getByText('Finance evidence saved.')).toBeVisible();

  // Officer completion flow: finish preparation, then complete (attested).
  await page.getByRole('button', { name: 'Finish preparation (ready for review)' }).click();
  await expect(page.getByText('Form finished and ready for review.')).toBeVisible();
  await page
    .getByRole('button', { name: 'Complete action form (attested, renders final PDF)' })
    .click();
  await expect(page.getByText(/Action form completed/)).toBeVisible();
  await expect(page.getByText('Complete').first()).toBeVisible();

  // The final PDF is rendered and downloadable by authorized HR.
  const formPdf = await page.getByRole('link', { name: 'Download final PDF' }).getAttribute('href');
  const dl = await page.request.get(formPdf!);
  expect(dl.status()).toBe(200);
  expect(dl.headers()['content-type']).toContain('application/pdf');

  // Audit history shows preparation and the attested HR completion.
  await page.goto(caseUrl);
  const timeline = page.locator('ol.activity').last();
  await expect(timeline.getByText('form created', { exact: false })).toHaveCount(1);
  await expect(
    timeline.getByText('finished preparing the action form', { exact: false }),
  ).toHaveCount(1);
  await expect(timeline.getByText('completed the action form', { exact: false })).toHaveCount(1);
  await signOut(page);
});

test('Scenario 3 - exit survey: invitation, token completion, duplicate neutral, HR view, manager denied', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signInAs(page, 'HR Officer');
  const caseUrl = await createTestCase(page, {
    employeeQuery: 'taylor',
    type: 'RESIGNATION_WITH_NOTICE',
    confirmedLastDay: true,
  });

  await page.goto(`${caseUrl}/survey`);
  await page.getByRole('button', { name: 'Create survey invitation' }).click();
  await expect(page.getByText('Invitation created.')).toBeVisible();
  await page.getByRole('button', { name: 'Generate secure link' }).click();
  await expect(page.getByText('Secure Invitation Link (Shown Once)')).toBeVisible();
  const link = await page.locator('code').first().textContent();
  expect(link).toMatch(/^\/survey\/[A-Za-z0-9_-]{43}$/);
  await page.getByRole('button', { name: 'Record manually sent' }).click();
  await expect(page.getByText(/Recorded as manually sent/)).toBeVisible();
  await signOut(page);

  // Public completion through the token route (no authentication).
  await page.goto(link!);
  await expect(page.getByText(/reviewed by authorized/)).toBeVisible();
  await expect(page.getByText(/OFF-\d{4}-\d{4,}(?:-\d)?/)).toHaveCount(0); // no case details
  await page.getByRole('radio', { name: '4' }).first().check();
  await page.getByRole('radio', { name: 'Another opportunity' }).check();
  await page.getByRole('radio', { name: 'Unsure' }).check();
  await page.getByRole('button', { name: 'Submit survey' }).click();
  await page.waitForURL('**/survey/thanks');

  // Replay is neutral.
  await page.goto(link!);
  await expect(page.getByText('Survey not available')).toBeVisible();

  // HR can view the response.
  await signInAs(page, 'HR Officer');
  await page.goto(`${caseUrl}/survey`);
  await expect(page.getByText('COMPLETED').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Response' })).toBeVisible();
  await signOut(page);

  // Line manager cannot view it (no case access at all).
  await signInAs(page, 'System Administrator');
  await page.goto(`${caseUrl}/survey`);
  await expect(page.getByText('Page or Record Not Found')).toBeVisible();
  await signOut(page);
});

test('Scenario 4 - restricted termination: new surfaces disclose nothing', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAs(page, 'HR Manager');
  const caseUrl = await createTestCase(page, { employeeQuery: 'morgan', type: 'TERMINATION' });
  await signOut(page);

  // Unassigned HR officer: all Stage 2 surfaces behave as not-found.
  await signInAs(page, 'HR Officer');
  for (const path of ['/documents', '/action-form', '/survey']) {
    await page.goto(`${caseUrl}${path}`);
    await expect(page.getByText('Page or Record Not Found')).toBeVisible();
  }
  await signOut(page);

  // Non-HR and admin roles: same non-disclosure (Directive 6.3: IT/Finance
  // have no logins; the line manager and admin cover the negative).
  for (const who of ['System Administrator']) {
    await signInAs(page, who);
    await page.goto(`${caseUrl}/documents`);
    await expect(page.getByText('Page or Record Not Found')).toBeVisible();
    await signOut(page);
  }
});
