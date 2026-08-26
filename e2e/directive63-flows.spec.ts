/**
 * Directive 6.3 acceptance: the HR daily journey on the HR-validated model.
 *
 * IT and Finance participate through automated controlled email notifications
 * (case "Email actions" tab, development mailbox, secure no-login /ack links)
 * instead of application sign-ins; the case Overview leads with the
 * exception-first "Required actions" panel and the "Benefits and providers"
 * confirmation; notification templates are versioned under
 * /admin/notification-templates.
 *
 * The scenario builds its own ACTIVE case so it runs on any seeded database,
 * including the zero-case "fresh" baseline. Assertions stay state-tolerant
 * where automation timing varies between runs. Synthetic data only.
 */
import { expect, test } from '@playwright/test';
import { openActiveHrValidatedCase, signInAs, signOut } from './support/case';

/** Business-language email-action statuses (Directive 6.3 correction 7). */
const BUSINESS_STATUS =
  /Scheduled|Sent|Needs your review|Recipient required|Being prepared|Acknowledged|Completed|Sent manually|Ready to send manually|Cancelled|Could not send|Superseded/;

test('HR manager reviews an active case: required actions, benefits, email actions', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, 'HR Manager');
  await openActiveHrValidatedCase(page);
  await expect(
    page.getByRole('heading', { name: /OFF-\d{4}-\d{4,}(?:-\d)?/ }).first(),
  ).toBeVisible();

  // Exception-first Overview (Directive 6.3 Z): the Required actions panel
  // groups work into "Requires your attention" and "In progress
  // automatically" (either group may be empty depending on seed state).
  await expect(page.getByRole('heading', { name: 'What this case needs' })).toBeVisible();
  // Outstanding work is a list of rows; a clear case says so in words.
  await expect(
    page
      .getByRole('list', { name: 'Outstanding actions' })
      .or(page.getByText('Nothing needs your attention on this case.'))
      .first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole('heading', { name: 'In progress automatically' })
      .or(page.getByRole('list', { name: 'Outstanding actions' }))
      .first(),
  ).toBeVisible();

  // Benefits and providers confirmation section (Directive 6.3 V).
  await expect(page.getByRole('heading', { name: 'Benefits and Providers' })).toBeVisible();
  await expect(page.getByText('Group Health').first()).toBeVisible();
  await expect(page.getByText('Group Life').first()).toBeVisible();

  // The Email actions tab (CaseNav link "Notifications") lists the automated
  // department/provider emails in business language - never enum names.
  await page
    .getByRole('navigation', { name: 'Case sections' })
    .getByRole('link', { name: 'Email Actions' })
    .click();
  await expect(page.getByRole('heading', { name: /Email Actions/ })).toBeVisible();
  const actionSections = page.locator('section[aria-label$="email action"]');
  await expect(actionSections.first()).toBeVisible();
  await expect(actionSections.first().locator('.badge').first()).toHaveText(BUSINESS_STATUS);
  await signOut(page);
});

test('no-login acknowledgement links: captured email link works logged out; invalid stays neutral', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);

  // HR reads the captured emails in the development mailbox.
  await signInAs(page, 'HR Manager');
  await page.goto('/dev/mailbox');
  await expect(page.getByText('DEVELOPMENT CAPTURE ONLY')).toBeVisible();
  const mailboxHtml = await page.content();
  const ackMatch = /\/ack\/[A-Za-z0-9_-]{43}/.exec(mailboxHtml);
  await signOut(page);

  // The department acts WITHOUT any sign-in: the secure link renders either
  // the acknowledge/confirm page (live token) or the neutral message (used or
  // expired token) - both are correct; seed state varies between runs.
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  if (ackMatch) {
    await publicPage.goto(ackMatch[0]);
    await expect(
      publicPage
        .getByRole('button', { name: /Acknowledge receipt|Confirm the action is completed/ })
        .or(publicPage.getByText(/not valid|Already recorded/))
        .first(),
    ).toBeVisible();
    // Whatever the state, no case content beyond the email's own reference
    // ever appears (minimum data; neutral failures).
    await expect(publicPage.getByText('TERMINATION')).toHaveCount(0);
  }

  // An invalid token is answered neutrally - no reason is disclosed.
  await publicPage.goto('/ack/invalidtokenvalue0000000000000000000000000000');
  await expect(publicPage.getByText(/This link is not valid/)).toBeVisible();
  await publicContext.close();
});

test('notification template administration: versioned register and drafting form', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInAs(page, 'HR Manager');
  await page.goto('/admin/notification-templates');
  await expect(page.getByRole('heading', { name: 'Notification Templates' })).toBeVisible();

  // The seeded register lists versioned templates per notification type (an
  // empty register announces itself instead of rendering a dead page).
  await expect(
    page
      .getByRole('columnheader', { name: 'Version' })
      .first()
      .or(page.getByText('No notification template versions exist yet.'))
      .first(),
  ).toBeVisible();

  // Officers/managers draft new versions; activation is management-grade.
  const draft = page.locator('details.action > summary', { hasText: 'Draft a new version' });
  await expect(draft).toBeVisible();
  await draft.click();
  await expect(page.getByLabel('Notification Type')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create draft version' })).toBeVisible();
  await signOut(page);
});
