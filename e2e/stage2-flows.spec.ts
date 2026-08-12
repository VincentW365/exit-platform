/**
 * Stage 2 acceptance scenarios (Directive 2 section N: Scenarios 1-4).
 * All cases use TEST record purpose: feature flags stay disabled for
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
  await page.getByLabel(/Search the employee source/).fill(opts.employeeQuery);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page.getByLabel('Departure type (required)').selectOption(opts.type);
  await page.getByLabel('Receipt date and time (required)').fill('2026-07-20T09:30');
  await page
    .getByLabel('Source of the receipt timestamp (required)')
    .fill('Stage 2 synthetic receipt');
  if (opts.confirmedLastDay) {
    await page.getByLabel('Confirmed last working day').fill('2026-08-14');
  }
  await page.getByLabel(/Effective separation date and exact time/).fill('2026-08-14T17:00');
  await page.getByLabel('Record purpose').selectOption('TEST');
  await page.getByRole('button', { name: 'Create draft case' }).click();
  await expect(page.getByText(/Draft case OFF-\d{4}-\d{4} created/)).toBeVisible();
  return page.url().split('?')[0]!;
}

async function addParticipantOnCase(
  page: Page,
  caseUrl: string,
  userLabel: string,
  role: string,
): Promise<void> {
  await page.goto(caseUrl);
  await page.locator('details.action > summary', { hasText: 'Add participant' }).click();
  const value = await page.locator('#p-user option', { hasText: userLabel }).getAttribute('value');
  await page.getByLabel('User').selectOption(value!);
  await page.locator('#p-role').selectOption(role);
  await page.locator('#p-reason').fill('Stage 2 synthetic assignment.');
  await page.getByRole('button', { name: 'Add participant' }).click();
  await expect(page.getByText('Participant added.')).toBeVisible();
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

  // Unauthorized download: IT responder gets a non-disclosing failure.
  await signInAs(page, 'IT Responder');
  const denied = await page.request.get(pdfHref!);
  expect([403, 404]).toContain(denied.status());
  await signOut(page);
});

test('Scenario 2 - action form: HR -> Finance -> Manager -> HR final, PDF and audit', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInAs(page, 'HR Officer');
  const caseUrl = await createTestCase(page, {
    employeeQuery: 'jordan',
    type: 'IMMEDIATE_RESIGNATION',
  });
  await signOut(page);

  // HR Manager assigns finance + manager participants.
  await signInAs(page, 'HR Manager');
  await addParticipantOnCase(page, caseUrl, 'Finance Responder', 'FINANCE');
  await addParticipantOnCase(page, caseUrl, 'Line Manager', 'MANAGER');
  await signOut(page);

  // HR officer completes the draft.
  await signInAs(page, 'HR Officer');
  await page.goto(`${caseUrl}/action-form`);
  await page.getByRole('button', { name: 'Create action form' }).click();
  await expect(page.getByText('Action form draft created.')).toBeVisible();
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
    await page.locator(`#hr-${key}`).selectOption('DONE');
  }
  await page.locator('#ackStatus').selectOption('NOT_OBTAINED');
  await page.locator('#ackReason').fill('Employee left immediately; not obtainable.');
  await page.getByRole('button', { name: 'Save HR section' }).click();
  await expect(page.getByText('HR section saved.')).toBeVisible();
  await signOut(page);

  // Finance completes its checklist.
  await signInAs(page, 'Finance Responder');
  await page.goto(`${caseUrl}/action-form`);
  await expect(page.getByText(/minimum information required for your assigned role/)).toBeVisible();
  for (const key of [
    'financeNotified',
    'workpaperInitiated',
    'workpaperCompleted',
    'payrollActioned',
    'otherApprovedAction',
  ]) {
    await page.locator(`#fin-${key}`).selectOption('DONE');
  }
  await page.getByRole('button', { name: 'Save finance checklist' }).click();
  await expect(page.getByText('Finance checklist saved.')).toBeVisible();
  // Finance must not see restricted HR content.
  await expect(page.getByText('General HR remarks')).toHaveCount(0);
  await signOut(page);

  // Officer submits for manager approval.
  await signInAs(page, 'HR Officer');
  await page.goto(`${caseUrl}/action-form`);
  await page.getByRole('button', { name: 'Submit for manager approval' }).click();
  await expect(page.getByText('Form submitted for manager approval.')).toBeVisible();
  await signOut(page);

  // Assigned manager approves from the minimum view.
  await signInAs(page, 'Line Manager');
  await page.goto(`${caseUrl}/action-form`);
  await expect(page.getByText(/minimum information/)).toBeVisible();
  await expect(page.getByText('General HR remarks')).toHaveCount(0); // F.4 restriction
  await page.getByRole('button', { name: 'Approve as responsible manager (attested)' }).click();
  await expect(page.getByText('Manager approval recorded (attested).')).toBeVisible();
  await signOut(page);

  // HR Manager gives final approval; PDF is available; audit shows steps.
  await signInAs(page, 'HR Manager');
  await page.goto(`${caseUrl}/action-form`);
  await page.getByRole('button', { name: /Give HR final approval/ }).click();
  await expect(page.getByText(/HR final approval recorded/)).toBeVisible();
  await expect(page.getByText('APPROVED').first()).toBeVisible();
  const formPdf = await page.getByRole('link', { name: 'Download final PDF' }).getAttribute('href');
  const dl = await page.request.get(formPdf!);
  expect(dl.status()).toBe(200);
  expect(dl.headers()['content-type']).toContain('application/pdf');

  await page.goto(caseUrl);
  const timeline = page.locator('ul.timeline').last();
  await expect(timeline.getByText('form created', { exact: false })).toHaveCount(1);
  await expect(timeline.getByText('form manager approved', { exact: false })).toHaveCount(1);
  await expect(timeline.getByText('form hr approved', { exact: false })).toHaveCount(1);
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
  await expect(page.getByText('Secure invitation link (shown once)')).toBeVisible();
  const link = await page.locator('code').first().textContent();
  expect(link).toMatch(/^\/survey\/[A-Za-z0-9_-]{43}$/);
  await page.getByRole('button', { name: 'Record manually sent' }).click();
  await expect(page.getByText(/Recorded as manually sent/)).toBeVisible();
  await signOut(page);

  // Public completion through the token route (no authentication).
  await page.goto(link!);
  await expect(page.getByText(/reviewed by authorized/)).toBeVisible();
  await expect(page.getByText(/OFF-\d{4}-\d{4}/)).toHaveCount(0); // no case details
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
  await expect(page.getByText('Response (restricted HR data)')).toBeVisible();
  await signOut(page);

  // Line manager cannot view it (no case access at all).
  await signInAs(page, 'Line Manager');
  await page.goto(`${caseUrl}/survey`);
  await expect(page.getByText('Page or record not found')).toBeVisible();
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
    await expect(page.getByText('Page or record not found')).toBeVisible();
  }
  await signOut(page);

  // Departmental and admin roles: same non-disclosure.
  for (const who of ['IT Responder', 'System Administrator']) {
    await signInAs(page, who);
    await page.goto(`${caseUrl}/documents`);
    await expect(page.getByText('Page or record not found')).toBeVisible();
    await signOut(page);
  }
});
